import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  onRequestDelete,
  onRequestGet,
  onRequestPatch,
  onRequestPost
} from "../../functions/api/admin/torneo";
import type { UsuarioSesion } from "../../functions/_lib/auth";
import { ctx } from "../helpers/ctx";
import { crearAdmin, crearEquipo, crearUsuario, crearUsuarioConPermisos, peticion } from "../helpers/db";

interface GrupoSalida {
  id: number;
  nombre: string;
  equipos: { id: number; nombre: string }[];
  reglas: { partido: { sets: number; puntosPorSet: number } };
  reglasPropias: unknown | null;
  clasificacion: { equipoId: number; nombre: string; posicion: number }[];
}

interface FaseSalida {
  id: number;
  clave: string;
  tipo: string;
  clasifican: number;
  reglas: { partido: { sets: number; puntosPorSet: number } };
  grupos: GrupoSalida[];
  partidos: {
    id: string;
    ronda: string;
    grupoId: number | null;
    rondaOrden: number | null;
    posicion: number | null;
    teams: { A: { id: number | null; name: string }; B: { id: number | null; name: string } };
    siguientePartidoId: string | null;
  }[];
}

interface Torneo {
  fases: FaseSalida[];
  equipos: { id: number; nombre: string; grupoId: number | null }[];
}

const leer = async (user: UsuarioSesion): Promise<Torneo> => {
  const respuesta = await onRequestGet(ctx(await peticion("/api/admin/torneo", { user }), env));
  return (await respuesta.json()) as Torneo;
};

const post = async (user: UsuarioSesion, query: string, json: Record<string, unknown> = {}) =>
  onRequestPost(ctx(await peticion(`/api/admin/torneo?${query}`, { method: "POST", user, json }), env));

const patch = async (user: UsuarioSesion, query: string, json: Record<string, unknown> = {}) =>
  onRequestPatch(ctx(await peticion(`/api/admin/torneo?${query}`, { method: "PATCH", user, json }), env));

const del = async (user: UsuarioSesion, query: string) =>
  onRequestDelete(ctx(await peticion(`/api/admin/torneo?${query}`, { method: "DELETE", user }), env));

/** Una fase de grupos con un grupo y los equipos que se le pidan. */
async function montarGrupo(admin: UsuarioSesion, nombres: string[]) {
  await post(admin, "accion=fase", { clave: "grupos", nombre: "Fase de grupos", tipo: "grupos", clasifican: 2 });
  const fase = (await leer(admin)).fases[0]!;
  await post(admin, `accion=grupo&fase=${fase.id}`, { nombre: "Grupo A" });
  const grupo = (await leer(admin)).fases[0]!.grupos[0]!;

  const equipos = [];
  for (const nombre of nombres) {
    const equipo = await crearEquipo({ nombre });
    await post(admin, `accion=asignar&grupo=${grupo.id}`, { equipoId: equipo.id });
    equipos.push(equipo);
  }
  return { faseId: fase.id, grupoId: grupo.id, equipos };
}

describe("permisos", () => {
  it("leer exige torneo.ver y escribir torneo.editar", async () => {
    const sinNada = await crearUsuario();
    expect((await onRequestGet(ctx(await peticion("/api/admin/torneo", { user: sinNada }), env))).status).toBe(403);

    const mirón = await crearUsuarioConPermisos(["torneo.ver"]);
    expect((await onRequestGet(ctx(await peticion("/api/admin/torneo", { user: mirón }), env))).status).toBe(200);
    expect((await post(mirón, "accion=fase", { clave: "x", nombre: "X", tipo: "grupos" })).status).toBe(403);
  });
});

describe("fases y grupos", () => {
  it("crea una fase con sus reglas y las devuelve normalizadas", async () => {
    const admin = await crearAdmin();
    const respuesta = await post(admin, "accion=fase", {
      clave: "grupos",
      nombre: "Fase de grupos",
      tipo: "grupos",
      clasifican: 2,
      reglas: { partido: { sets: 1, puntosPorSet: 15 } }
    });

    expect(respuesta.status).toBe(201);
    const fase = (await leer(admin)).fases[0]!;
    expect(fase).toMatchObject({ clave: "grupos", tipo: "grupos", clasifican: 2 });
    expect(fase.reglas.partido.sets).toBe(1);
    expect(fase.reglas.partido.puntosPorSet).toBe(15);
  });

  it("no admite dos fases con la misma clave", async () => {
    const admin = await crearAdmin();
    const cuerpo = { clave: "grupos", nombre: "Grupos", tipo: "grupos" };
    expect((await post(admin, "accion=fase", cuerpo)).status).toBe(201);
    expect((await post(admin, "accion=fase", cuerpo)).status).toBe(409);
  });

  it("rechaza reglas fuera de rango con error por campo", async () => {
    const admin = await crearAdmin();
    const respuesta = await post(admin, "accion=fase", {
      clave: "grupos",
      nombre: "Grupos",
      tipo: "grupos",
      reglas: { partido: { sets: 99 } }
    });

    expect(respuesta.status).toBe(400);
    expect(((await respuesta.json()) as { campos: Record<string, string> })["campos"]["reglas.sets"]).toBeTruthy();
  });

  /*
   * El formato cambia según cuántos equipos tenga cada grupo: uno de tres puede
   * jugar a un set y uno de cinco al mejor de tres, dentro de la misma fase.
   */
  it("un grupo puede sobrescribir las reglas de su fase, y otro heredarlas", async () => {
    const admin = await crearAdmin();
    await post(admin, "accion=fase", {
      clave: "grupos",
      nombre: "Grupos",
      tipo: "grupos",
      reglas: { partido: { sets: 2, puntosPorSet: 21 } }
    });
    const faseId = (await leer(admin)).fases[0]!.id;

    await post(admin, `accion=grupo&fase=${faseId}`, { nombre: "Grupo A" });
    await post(admin, `accion=grupo&fase=${faseId}`, {
      nombre: "Grupo B",
      reglas: { partido: { sets: 1, puntosPorSet: 15 } }
    });

    const grupos = (await leer(admin)).fases[0]!.grupos;
    const a = grupos.find((g) => g.nombre === "Grupo A")!;
    const b = grupos.find((g) => g.nombre === "Grupo B")!;

    expect(a.reglasPropias).toBeNull();
    expect(a.reglas.partido.sets).toBe(2);
    expect(b.reglasPropias).not.toBeNull();
    expect(b.reglas.partido.sets).toBe(1);
    // Lo que el grupo no declara lo sigue heredando de la fase.
    expect(b.reglas.partido.puntosPorSet).toBe(15);
  });

  it("borrar una fase se lleva sus grupos y sus partidos", async () => {
    const admin = await crearAdmin();
    const { faseId } = await montarGrupo(admin, ["Delfines", "Gaviotas"]);
    await post(admin, `accion=generar-liga&fase=${faseId}`);

    expect((await del(admin, `accion=fase&id=${faseId}`)).status).toBe(200);
    expect((await leer(admin)).fases).toHaveLength(0);
    const quedan = await env.DB.prepare("SELECT COUNT(*) AS n FROM partidos").first<{ n: number }>();
    expect(quedan!.n).toBe(0);
  });
});

/*
 * Que un equipo esté en dos grupos de la misma fase haría imposible cualquier
 * clasificación coherente. Lo impide el índice UNIQUE(fase_id, equipo_id), y el
 * endpoint lo comprueba antes solo para poder decir en cuál está ya.
 */
describe("un equipo, un grupo por fase", () => {
  it("rechaza meterlo en un segundo grupo de la misma fase", async () => {
    const admin = await crearAdmin();
    const { faseId, grupoId, equipos } = await montarGrupo(admin, ["Delfines"]);
    await post(admin, `accion=grupo&fase=${faseId}`, { nombre: "Grupo B" });
    const grupoB = (await leer(admin)).fases[0]!.grupos.find((g) => g.nombre === "Grupo B")!;

    const respuesta = await post(admin, `accion=asignar&grupo=${grupoB.id}`, { equipoId: equipos[0]!.id });
    expect(respuesta.status).toBe(409);
    expect(await respuesta.json()).toMatchObject({ error: expect.stringContaining("Grupo A") });

    const grupos = (await leer(admin)).fases[0]!.grupos;
    expect(grupos.find((g) => g.id === grupoId)!.equipos).toHaveLength(1);
    expect(grupoB.equipos).toHaveLength(0);
  });

  it("sí puede estar en un grupo de otra fase", async () => {
    const admin = await crearAdmin();
    const { equipos } = await montarGrupo(admin, ["Delfines"]);

    await post(admin, "accion=fase", { clave: "repesca", nombre: "Repesca", tipo: "grupos" });
    const segunda = (await leer(admin)).fases.find((f) => f.clave === "repesca")!;
    await post(admin, `accion=grupo&fase=${segunda.id}`, { nombre: "Grupo único" });
    const grupo = (await leer(admin)).fases.find((f) => f.clave === "repesca")!.grupos[0]!;

    expect((await post(admin, `accion=asignar&grupo=${grupo.id}`, { equipoId: equipos[0]!.id })).status).toBe(201);
  });

  it("sacarlo de un grupo lo deja libre otra vez", async () => {
    const admin = await crearAdmin();
    const { grupoId, equipos } = await montarGrupo(admin, ["Delfines"]);

    expect((await del(admin, `accion=asignar&grupo=${grupoId}&equipo=${equipos[0]!.id}`)).status).toBe(200);
    const torneo = await leer(admin);
    expect(torneo.fases[0]!.grupos[0]!.equipos).toHaveLength(0);
    expect(torneo.equipos.find((e) => e.id === equipos[0]!.id)!.grupoId).toBeNull();
  });
});

describe("generar el calendario de liga", () => {
  it("crea todos contra todos dentro de cada grupo", async () => {
    const admin = await crearAdmin();
    const { faseId } = await montarGrupo(admin, ["Delfines", "Gaviotas", "Cangrejos", "Percebes"]);

    expect((await post(admin, `accion=generar-liga&fase=${faseId}`)).status).toBe(201);

    const partidos = (await leer(admin)).fases[0]!.partidos;
    expect(partidos).toHaveLength(6); // C(4,2)
    const cruces = partidos.map((p) => [p.teams.A.name, p.teams.B.name].sort().join(" vs "));
    expect(new Set(cruces).size).toBe(6);
  });

  it("regenerar rehace el calendario en vez de duplicarlo", async () => {
    const admin = await crearAdmin();
    const { faseId } = await montarGrupo(admin, ["Delfines", "Gaviotas", "Cangrejos"]);

    await post(admin, `accion=generar-liga&fase=${faseId}`);
    await post(admin, `accion=generar-liga&fase=${faseId}`);

    expect((await leer(admin)).fases[0]!.partidos).toHaveLength(3);
  });

  /*
   * La foto de reglas es lo que impide que cambiar el formato a mitad de torneo
   * reescriba cómo se arbitró lo ya jugado.
   */
  it("cada partido guarda las reglas del momento, y cambiarlas después no las toca", async () => {
    const admin = await crearAdmin();
    const { faseId } = await montarGrupo(admin, ["Delfines", "Gaviotas"]);
    await post(admin, `accion=generar-liga&fase=${faseId}`);

    const antes = await env.DB.prepare("SELECT reglas FROM partidos").first<{ reglas: string }>();
    expect(JSON.parse(antes!.reglas).partido.puntosPorSet).toBe(21);

    await patch(admin, `accion=fase&id=${faseId}`, {
      nombre: "Fase de grupos",
      tipo: "grupos",
      clasifican: 2,
      reglas: { partido: { puntosPorSet: 15 } }
    });

    const despues = await env.DB.prepare("SELECT reglas FROM partidos").first<{ reglas: string }>();
    expect(JSON.parse(despues!.reglas).partido.puntosPorSet).toBe(21);
    // Pero la fase sí queda cambiada, para lo que se genere a partir de ahora.
    expect((await leer(admin)).fases[0]!.reglas.partido.puntosPorSet).toBe(15);
  });

  it("un grupo con menos de dos equipos no da ningún cruce", async () => {
    const admin = await crearAdmin();
    const { faseId } = await montarGrupo(admin, ["Delfines"]);
    expect((await post(admin, `accion=generar-liga&fase=${faseId}`)).status).toBe(409);
  });

  it("no se genera liga en una fase eliminatoria", async () => {
    const admin = await crearAdmin();
    await post(admin, "accion=fase", { clave: "final", nombre: "Fase final", tipo: "eliminatoria" });
    const fase = (await leer(admin)).fases[0]!;
    expect((await post(admin, `accion=generar-liga&fase=${fase.id}`)).status).toBe(409);
  });
});

describe("generar el cuadro", () => {
  async function faseFinal(admin: UsuarioSesion) {
    await post(admin, "accion=fase", { clave: "final", nombre: "Fase final", tipo: "eliminatoria", orden: 1 });
    return (await leer(admin)).fases.find((f) => f.clave === "final")!;
  }

  it("un cuadro de 4 son 3 partidos enlazados entre sí", async () => {
    const admin = await crearAdmin();
    const fase = await faseFinal(admin);

    expect((await post(admin, `accion=generar-cuadro&fase=${fase.id}`, { tamano: 4 })).status).toBe(201);

    const partidos = (await leer(admin)).fases.find((f) => f.clave === "final")!.partidos;
    expect(partidos).toHaveLength(3);

    const semis = partidos.filter((p) => p.rondaOrden === 0);
    const final = partidos.find((p) => p.rondaOrden === 1)!;
    expect(semis).toHaveLength(2);
    expect(semis.every((s) => s.siguientePartidoId === final.id)).toBe(true);
    expect(final.siguientePartidoId).toBeNull();
  });

  it("con tercer puesto sale un partido más", async () => {
    const admin = await crearAdmin();
    const fase = await faseFinal(admin);
    await post(admin, `accion=generar-cuadro&fase=${fase.id}`, { tamano: 4, tercerPuesto: true });

    const partidos = (await leer(admin)).fases.find((f) => f.clave === "final")!.partidos;
    expect(partidos).toHaveLength(4);
    expect(partidos.some((p) => p.ronda === "Tercer puesto")).toBe(true);
  });

  it("rechaza un tamaño que no sea potencia de dos", async () => {
    const admin = await crearAdmin();
    const fase = await faseFinal(admin);
    const respuesta = await post(admin, `accion=generar-cuadro&fase=${fase.id}`, { tamano: 6 });

    expect(respuesta.status).toBe(400);
    expect(((await respuesta.json()) as { campos: Record<string, string> }).campos.tamano).toBeTruthy();
  });
});

/*
 * Se siembra por posición y no grupo a grupo: primero todos los primeros, luego
 * todos los segundos, y el emparejamiento es 1.º contra último. Así los cabezas
 * de serie se cruzan lo más tarde posible.
 */
describe("sembrar el cuadro desde la clasificación", () => {
  it("coloca a los clasificados cruzando primeros con últimos", async () => {
    const admin = await crearAdmin();
    const { faseId, grupoId, equipos } = await montarGrupo(admin, ["Delfines", "Gaviotas", "Cangrejos", "Percebes"]);
    await post(admin, `accion=generar-liga&fase=${faseId}`);

    // Delfines gana todo, Gaviotas gana dos, Cangrejos una, Percebes ninguna.
    const partidos = (await leer(admin)).fases[0]!.partidos;
    const ganador = (nombreA: string) => (p: (typeof partidos)[number]) =>
      p.teams.A.name === nombreA ? "A" : p.teams.B.name === nombreA ? "B" : null;
    const jerarquia = ["Delfines", "Gaviotas", "Cangrejos", "Percebes"];

    for (const partido of partidos) {
      const mejor = jerarquia.find((n) => n === partido.teams.A.name || n === partido.teams.B.name)!;
      const lado = ganador(mejor)(partido)!;
      await env.DB
        .prepare("UPDATE partidos SET status = 'finished', winner = ?1, sets_a = ?2, sets_b = ?3 WHERE id = ?4")
        .bind(lado, lado === "A" ? 2 : 0, lado === "A" ? 0 : 2, partido.id)
        .run();
    }

    await post(admin, "accion=fase", { clave: "final", nombre: "Fase final", tipo: "eliminatoria", orden: 1 });
    const final = (await leer(admin)).fases.find((f) => f.clave === "final")!;
    await post(admin, `accion=generar-cuadro&fase=${final.id}`, { tamano: 2 });

    expect((await post(admin, `accion=sembrar&fase=${final.id}`, { desdeFase: faseId })).status).toBe(200);

    const cruce = (await leer(admin)).fases.find((f) => f.clave === "final")!.partidos[0]!;
    // Clasifican 2 y el cuadro es de 2: el primero contra el segundo.
    expect([cruce.teams.A.name, cruce.teams.B.name].sort()).toEqual(["Delfines", "Gaviotas"]);
    expect(grupoId).toBeGreaterThan(0);
    expect(equipos).toHaveLength(4);
  });

  it("no siembra desde una fase que no dice cuántos clasifican", async () => {
    const admin = await crearAdmin();
    await post(admin, "accion=fase", { clave: "grupos", nombre: "Grupos", tipo: "grupos", clasifican: 0 });
    const grupos = (await leer(admin)).fases[0]!;
    await post(admin, "accion=fase", { clave: "final", nombre: "Final", tipo: "eliminatoria", orden: 1 });
    const final = (await leer(admin)).fases.find((f) => f.clave === "final")!;

    expect((await post(admin, `accion=sembrar&fase=${final.id}`, { desdeFase: grupos.id })).status).toBe(409);
  });
});

describe("la clasificación viaja con el torneo", () => {
  it("sale calculada de los partidos terminados, sin guardarse en ninguna tabla", async () => {
    const admin = await crearAdmin();
    const { faseId, equipos } = await montarGrupo(admin, ["Delfines", "Gaviotas", "Cangrejos"]);
    await post(admin, `accion=generar-liga&fase=${faseId}`);

    const partidos = (await leer(admin)).fases[0]!.partidos;
    const conDelfines = partidos.filter((p) => p.teams.A.name === "Delfines" || p.teams.B.name === "Delfines");
    for (const partido of conDelfines) {
      const lado = partido.teams.A.name === "Delfines" ? "A" : "B";
      await env.DB
        .prepare(
          `UPDATE partidos SET status = 'finished', winner = ?1, sets_a = ?2, sets_b = ?3,
                  set_history = '[{"a":21,"b":10},{"a":21,"b":10}]' WHERE id = ?4`
        )
        .bind(lado, lado === "A" ? 2 : 0, lado === "A" ? 0 : 2, partido.id)
        .run();
    }

    const tabla = (await leer(admin)).fases[0]!.grupos[0]!.clasificacion;
    expect(tabla[0]!.nombre).toBe("Delfines");
    expect(tabla).toHaveLength(3);
    expect(tabla.map((f) => f.posicion)).toEqual([1, 2, 3]);
    expect(equipos).toHaveLength(3);
  });
});
