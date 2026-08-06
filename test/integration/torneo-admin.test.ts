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
import {
  asignarEquipoAGrupo,
  crearAdmin,
  crearEquipo,
  crearFase,
  crearGrupo,
  crearPartido,
  crearUsuario,
  crearUsuarioConPermisos,
  peticion
} from "../helpers/db";

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

/*
 * El reparto de plazas cuando los grupos no son iguales: cada grupo puede tener
 * su cupo y la fase puede repartir plazas de repesca entre los que quedan justo
 * fuera. Lo que no puede pasar nunca es que la tabla pinte a unos y el cuadro
 * siembre a otros.
 */
describe("plazas por grupo y repesca", () => {
  it("guarda la repesca de la fase y el cupo propio de un grupo", async () => {
    const admin = await crearAdmin();

    const creada = await onRequestPost(
      ctx(
        await peticion("/api/admin/torneo?accion=fase", {
          method: "POST",
          user: admin,
          json: { clave: "grupos", nombre: "Fase de grupos", tipo: "grupos", clasifican: 2, repesca: 1 }
        }),
        env
      ) as never
    );
    expect(creada.status).toBe(201);
    const trasCrear = (await creada.json()) as { fases: { id: number; clasifican: number; repesca: number }[] };
    const fase = trasCrear.fases[0]!;
    expect(fase.repesca).toBe(1);

    const grupo = await onRequestPost(
      ctx(
        await peticion(`/api/admin/torneo?accion=grupo&fase=${fase.id}`, {
          method: "POST",
          user: admin,
          json: { nombre: "C", orden: 2, clasifican: 3, enRepesca: false }
        }),
        env
      ) as never
    );
    expect(grupo.status).toBe(201);

    const datos = (await grupo.json()) as {
      fases: {
        grupos: { nombre: string; clasifican: number; clasificanPropio: number | null; enRepesca: boolean }[];
      }[];
    };
    const c = datos.fases[0]!.grupos.find((g) => g.nombre === "C")!;
    expect(c.clasifican).toBe(3);
    expect(c.clasificanPropio).toBe(3);
    expect(c.enRepesca).toBe(false);
  });

  it("un grupo sin cupo propio hereda el de la fase", async () => {
    const admin = await crearAdmin();
    const fase = await crearFase({ tipo: "grupos", clasifican: 2 });
    await onRequestPost(
      ctx(
        await peticion(`/api/admin/torneo?accion=grupo&fase=${fase.id}`, {
          method: "POST",
          user: admin,
          json: { nombre: "A", orden: 0 }
        }),
        env
      ) as never
    );

    const respuesta = await onRequestGet(ctx(await peticion("/api/admin/torneo", { user: admin }), env) as never);
    const datos = (await respuesta.json()) as {
      fases: { grupos: { nombre: string; clasifican: number; clasificanPropio: number | null }[] }[];
    };
    const a = datos.fases[0]!.grupos.find((g) => g.nombre === "A")!;
    expect(a.clasifican).toBe(2);
    expect(a.clasificanPropio).toBeNull();
  });

  it("siembra exactamente a los que la clasificación pinta como clasificados", async () => {
    const admin = await crearAdmin();

    const grupos = await crearFase({ clave: "grupos", tipo: "grupos", clasifican: 1 });
    await env.DB.prepare("UPDATE torneo_fases SET repesca = 1 WHERE id = ?1").bind(grupos.id).run();
    const gA = await crearGrupo(grupos.id, { nombre: "A", orden: 0 });
    const gB = await crearGrupo(grupos.id, { nombre: "B", orden: 1 });

    const a1 = await crearEquipo({ nombre: "A uno" });
    const a2 = await crearEquipo({ nombre: "A dos" });
    const b1 = await crearEquipo({ nombre: "B uno" });
    const b2 = await crearEquipo({ nombre: "B dos" });
    await asignarEquipoAGrupo(gA, grupos.id, a1.id);
    await asignarEquipoAGrupo(gA, grupos.id, a2.id);
    await asignarEquipoAGrupo(gB, grupos.id, b1.id);
    await asignarEquipoAGrupo(gB, grupos.id, b2.id);

    // «A dos» encaja menos que «B dos»: es el mejor segundo y gana la repesca.
    await crearPartido({
      faseId: grupos.id, grupoId: gA, equipoA: a1, equipoB: a2,
      status: "finished", winner: "A", setsA: 2, setsB: 0, puntosA: 42, puntosB: 30
    });
    await crearPartido({
      faseId: grupos.id, grupoId: gB, equipoA: b1, equipoB: b2,
      status: "finished", winner: "A", setsA: 2, setsB: 0, puntosA: 42, puntosB: 10
    });

    const cuadro = await crearFase({ clave: "cuadro", tipo: "eliminatoria", orden: 1 });
    await onRequestPost(
      ctx(
        await peticion(`/api/admin/torneo?accion=generar-cuadro&fase=${cuadro.id}`, {
          method: "POST", user: admin, json: { tamano: 4 }
        }),
        env
      ) as never
    );

    const sembrada = await onRequestPost(
      ctx(
        await peticion(`/api/admin/torneo?accion=sembrar&fase=${cuadro.id}`, {
          method: "POST", user: admin, json: { desdeFase: grupos.id }
        }),
        env
      ) as never
    );
    expect(sembrada.status).toBe(200);

    const { results } = await env.DB
      .prepare(
        `SELECT equipo_a_nombre, equipo_b_nombre FROM partidos
          WHERE fase_id = ?1 AND ronda_orden = 0 ORDER BY posicion ASC`
      )
      .bind(cuadro.id)
      .all<{ equipo_a_nombre: string; equipo_b_nombre: string }>();

    const colocados = results.flatMap((p) => [p.equipo_a_nombre, p.equipo_b_nombre]).filter(Boolean);
    // Pasan los dos primeros (directos) y el mejor segundo (repesca). «B dos» no.
    expect(colocados.sort()).toEqual(["A dos", "A uno", "B uno"]);
  });
});

/*
 * Un equipo que se clasificó y no puede jugar la fase siguiente. No es un
 * resultado, así que no se deduce de ningún partido: lo marca la organización.
 * Y no es sacarlo del grupo — sigue en la tabla con lo que hizo en el campo, y
 * sus partidos siguen contando para los demás.
 */
describe("retirar a un equipo de la fase siguiente", () => {
  const montar = async () => {
    const admin = await crearAdmin();
    const fase = await crearFase({ clave: "grupos", tipo: "grupos", clasifican: 2 });
    const grupo = await crearGrupo(fase.id, { nombre: "B", orden: 0 });
    const equipo = await crearEquipo({ nombre: "Limens" });
    await asignarEquipoAGrupo(grupo, fase.id, equipo.id);
    return { admin, fase, grupo, equipo };
  };

  const equipoEnSalida = async (admin: UsuarioSesion, equipoId: number) => {
    const torneo = (await leer(admin)) as unknown as {
      fases: { grupos: { equipos: { id: number; retirado?: boolean }[] }[] }[];
    };
    return torneo.fases[0]!.grupos[0]!.equipos.find((e) => e.id === equipoId)!;
  };

  it("marca y desmarca la baja, y la respuesta lo refleja", async () => {
    const { admin, grupo, equipo } = await montar();

    expect((await equipoEnSalida(admin, equipo.id)).retirado).toBe(false);

    expect((await patch(admin, `accion=retirado&id=${grupo}`, { equipoId: equipo.id, retirado: true })).status).toBe(200);
    expect((await equipoEnSalida(admin, equipo.id)).retirado).toBe(true);

    expect((await patch(admin, `accion=retirado&id=${grupo}`, { equipoId: equipo.id, retirado: false })).status).toBe(200);
    expect((await equipoEnSalida(admin, equipo.id)).retirado).toBe(false);
  });

  it("404 si ese equipo no está en ese grupo", async () => {
    const { admin, grupo } = await montar();
    const ajeno = await crearEquipo({ nombre: "De otro grupo" });

    expect((await patch(admin, `accion=retirado&id=${grupo}`, { equipoId: ajeno.id })).status).toBe(404);
  });

  /*
   * El mismo cerrojo que `camisetas_reservas.entregada` y que las columnas del
   * cromo: el UPDATE del grupo no menciona la columna. Si se añadiera ahí,
   * corregir el nombre de un grupo desharía la baja sin que nadie lo viera.
   */
  it("editar el grupo no deshace la baja", async () => {
    const { admin, grupo, equipo } = await montar();
    await patch(admin, `accion=retirado&id=${grupo}`, { equipoId: equipo.id, retirado: true });

    expect((await patch(admin, `accion=grupo&id=${grupo}`, { nombre: "B renombrado" })).status).toBe(200);

    expect((await equipoEnSalida(admin, equipo.id)).retirado).toBe(true);
  });

  it("un retirado no se siembra en el cuadro, y su plaza baja al siguiente", async () => {
    const admin = await crearAdmin();
    const grupos = await crearFase({ clave: "grupos", tipo: "grupos", clasifican: 2 });
    const grupo = await crearGrupo(grupos.id, { nombre: "B", orden: 0 });

    const primero = await crearEquipo({ nombre: "Segarro" });
    const segundo = await crearEquipo({ nombre: "Limens" });
    const tercero = await crearEquipo({ nombre: "Croquetillas de Arena" });
    const cuarto = await crearEquipo({ nombre: "Deportivo A Silva" });
    await asignarEquipoAGrupo(grupo, grupos.id, primero.id);
    await asignarEquipoAGrupo(grupo, grupos.id, segundo.id, { retirado: true });
    await asignarEquipoAGrupo(grupo, grupos.id, tercero.id);
    await asignarEquipoAGrupo(grupo, grupos.id, cuarto.id);

    await crearPartido({
      faseId: grupos.id, grupoId: grupo, equipoA: primero, equipoB: cuarto,
      status: "finished", winner: "A", setsA: 2, setsB: 0, puntosA: 30, puntosB: 10
    });
    await crearPartido({
      faseId: grupos.id, grupoId: grupo, equipoA: segundo, equipoB: cuarto,
      status: "finished", winner: "A", setsA: 2, setsB: 0, puntosA: 30, puntosB: 12
    });
    await crearPartido({
      faseId: grupos.id, grupoId: grupo, equipoA: tercero, equipoB: cuarto,
      status: "finished", winner: "A", setsA: 2, setsB: 1, puntosA: 40, puntosB: 35
    });

    const cuadro = await crearFase({ clave: "cuadro", tipo: "eliminatoria", orden: 1 });
    await post(admin, `accion=generar-cuadro&fase=${cuadro.id}`, { tamano: 2 });
    expect((await post(admin, `accion=sembrar&fase=${cuadro.id}`, { desdeFase: grupos.id })).status).toBe(200);

    const { results } = await env.DB
      .prepare("SELECT equipo_a_nombre, equipo_b_nombre FROM partidos WHERE fase_id = ?1")
      .bind(cuadro.id)
      .all<{ equipo_a_nombre: string; equipo_b_nombre: string }>();
    const colocados = results.flatMap((p) => [p.equipo_a_nombre, p.equipo_b_nombre]).filter(Boolean);

    expect(colocados).not.toContain("Limens");
    expect(colocados.sort()).toEqual(["Croquetillas de Arena", "Segarro"]);
  });
});
