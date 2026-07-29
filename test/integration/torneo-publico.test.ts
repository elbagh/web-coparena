import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestGet } from "../../functions/api/torneo";
import { clasificacionDeGrupo } from "../../functions/_lib/clasificacion";
import { REGLAS_POR_DEFECTO } from "../../functions/_lib/reglas";
import { ctx } from "../helpers/ctx";
import {
  asignarEquipoAGrupo,
  crearEdicion,
  crearEquipo,
  crearFase,
  crearGrupo,
  crearPartido,
  peticion
} from "../helpers/db";

/*
 * La vista pública del torneo. Sale de la misma función que la del panel, así
 * que lo que se prueba aquí es que no filtra nada que no deba y que la
 * clasificación es exactamente la misma que calcularía la organización.
 */

interface Salida {
  edicion: { anio: number } | null;
  fases: {
    id: number;
    nombre: string;
    grupos: {
      nombre: string;
      equipos: { id: number; nombre: string }[];
      clasificacion: { equipoId: number; nombre: string; posicion: number; puntos: number }[];
    }[];
    partidos: { id: string; status: string; teams: { A: { name: string } } }[];
  }[];
  sueltos: { id: string; ronda: string }[];
}

const leer = async (): Promise<Salida> => {
  const respuesta = await onRequestGet(ctx(await peticion("/api/torneo"), env));
  expect(respuesta.status).toBe(200);
  return (await respuesta.json()) as Salida;
};

/** Un grupo con cuatro equipos y sus partidos ya resueltos. */
async function sembrarGrupo() {
  const fase = await crearFase({ clave: "grupos", nombre: "Fase de grupos", clasifican: 2 });
  const grupoId = await crearGrupo(fase.id, { nombre: "Grupo A" });

  const equipos = [];
  for (const nombre of ["Delfines", "Gaviotas", "Cangrejos", "Percebes"]) {
    const equipo = await crearEquipo({ nombre });
    await asignarEquipoAGrupo(grupoId, fase.id, equipo.id);
    equipos.push(equipo);
  }
  return { fase, grupoId, equipos };
}

describe("es público", () => {
  it("responde 200 sin ninguna sesión", async () => {
    const respuesta = await onRequestGet(ctx(await peticion("/api/torneo"), env));
    expect(respuesta.status).toBe(200);
  });

  // No se sondea: es la lectura pesada. Quien sondea es /api/directo.
  it("se cachea, al revés que el directo", async () => {
    const respuesta = await onRequestGet(ctx(await peticion("/api/torneo"), env));
    const cache = respuesta.headers.get("Cache-Control")!;
    expect(cache).toContain("max-age=30");
    expect(cache).toContain("stale-while-revalidate");
  });

  it("trae la edición que se está jugando", async () => {
    expect((await leer()).edicion?.anio).toBe(2026);
  });
});

describe("qué se enseña", () => {
  it("las fases con sus grupos, equipos y clasificación", async () => {
    await sembrarGrupo();
    const salida = await leer();

    expect(salida.fases).toHaveLength(1);
    const grupo = salida.fases[0]!.grupos[0]!;
    expect(grupo.nombre).toBe("Grupo A");
    expect(grupo.equipos.map((e) => e.nombre).sort()).toEqual([
      "Cangrejos",
      "Delfines",
      "Gaviotas",
      "Percebes"
    ]);
    expect(grupo.clasificacion).toHaveLength(4);
  });

  /*
   * La clasificación pública y la del panel salen de la misma función pura. Si
   * cada una montara la suya, un día dejarían de coincidir y no habría forma de
   * saber cuál miente.
   */
  it("la clasificación coincide con la que calcula la función pura", async () => {
    const { fase, grupoId, equipos } = await sembrarGrupo();
    const partidoId = await crearPartido({
      faseId: fase.id,
      grupoId,
      equipoA: equipos[0],
      equipoB: equipos[1],
      status: "finished",
      winner: "A",
      setsA: 2,
      setsB: 0
    });
    await env.DB
      .prepare(`UPDATE partidos SET set_history = '[{"a":21,"b":10},{"a":21,"b":12}]' WHERE id = ?1`)
      .bind(partidoId)
      .run();

    const grupo = (await leer()).fases[0]!.grupos[0]!;
    const esperada = clasificacionDeGrupo(
      equipos.map((e) => ({ id: e.id, nombre: e.nombre })),
      [
        {
          equipoAId: equipos[0]!.id,
          equipoBId: equipos[1]!.id,
          setsA: 2,
          setsB: 0,
          puntosA: 42,
          puntosB: 22,
          status: "finished",
          setDecisivo: false
        }
      ],
      REGLAS_POR_DEFECTO.clasificacion
    );

    expect(grupo.clasificacion.map((f) => [f.nombre, f.posicion, f.puntos])).toEqual(
      esperada.map((f) => [f.nombre, f.posicion, f.puntos])
    );
  });

  // Un amistoso o una repesca no cuelgan de ninguna fase, pero existen.
  it("los partidos sueltos salen aparte en vez de desaparecer", async () => {
    await sembrarGrupo();
    await crearPartido({ ronda: "Amistoso" });

    const salida = await leer();
    expect(salida.sueltos.map((p) => p.ronda)).toEqual(["Amistoso"]);
  });

  it("no mezcla el torneo de otra edición", async () => {
    const vieja = await crearEdicion({ anio: 2025 });
    await crearFase({ clave: "vieja", nombre: "Grupos 2025", edicionId: vieja.id });
    await crearPartido({ ronda: "Final 2025", edicionId: vieja.id });

    const salida = await leer();
    expect(salida.fases).toHaveLength(0);
    expect(salida.sueltos).toHaveLength(0);
  });
});

/*
 * El álbum público lleva años cuidando de no soltar teléfonos ni correos. Este
 * endpoint enseña equipos y resultados, y no tiene por qué saber nada de las
 * personas.
 */
describe("no filtra datos personales", () => {
  it("no aparece ningún teléfono ni correo en toda la respuesta", async () => {
    const { fase, grupoId, equipos } = await sembrarGrupo();
    await crearPartido({ faseId: fase.id, grupoId, equipoA: equipos[0], equipoB: equipos[1] });

    const respuesta = await onRequestGet(ctx(await peticion("/api/torneo"), env));
    const crudo = await respuesta.text();

    expect(crudo).not.toContain("@example.com");
    expect(crudo).not.toMatch(/\b6\d{8}\b/);
    expect(crudo.toLowerCase()).not.toContain("telefono");
  });
});

/*
 * Quién pasa ya no es «los N primeros de cada grupo»: cada grupo puede tener su
 * cupo y la fase puede repartir plazas de repesca entre los que quedan justo
 * fuera. La página tiene que poder pintar las dos condiciones por separado.
 */
describe("condición de clasificación", () => {
  it("marca cada fila con si pasa directo, por repesca o no pasa", async () => {
    const fase = await crearFase({ tipo: "grupos", clasifican: 1 });
    await env.DB.prepare("UPDATE torneo_fases SET repesca = 1 WHERE id = ?1").bind(fase.id).run();

    const grupoA = await crearGrupo(fase.id, { nombre: "A", orden: 0 });
    const grupoB = await crearGrupo(fase.id, { nombre: "B", orden: 1 });

    const a1 = await crearEquipo({ nombre: "A uno" });
    const a2 = await crearEquipo({ nombre: "A dos" });
    const b1 = await crearEquipo({ nombre: "B uno" });
    const b2 = await crearEquipo({ nombre: "B dos" });

    await asignarEquipoAGrupo(grupoA, fase.id, a1.id);
    await asignarEquipoAGrupo(grupoA, fase.id, a2.id);
    await asignarEquipoAGrupo(grupoB, fase.id, b1.id);
    await asignarEquipoAGrupo(grupoB, fase.id, b2.id);

    // Los dos segundos pierden 0-2, pero «A dos» encajó menos: es el mejor segundo.
    await crearPartido({
      faseId: fase.id, grupoId: grupoA, equipoA: a1, equipoB: a2,
      status: "finished", winner: "A", setsA: 2, setsB: 0, puntosA: 42, puntosB: 30
    });
    await crearPartido({
      faseId: fase.id, grupoId: grupoB, equipoA: b1, equipoB: b2,
      status: "finished", winner: "A", setsA: 2, setsB: 0, puntosA: 42, puntosB: 10
    });

    const respuesta = await onRequestGet(ctx(await peticion("/api/torneo"), env) as never);
    const datos = (await respuesta.json()) as {
      fases: {
        repesca: number;
        grupos: {
          nombre: string;
          clasifican: number;
          enRepesca: boolean;
          clasificacion: { nombre: string; clasifica: string | null }[];
        }[];
      }[];
    };

    const salida = datos.fases[0]!;
    expect(salida.repesca).toBe(1);
    expect(salida.grupos[0]!.clasifican).toBe(1);
    expect(salida.grupos[0]!.enRepesca).toBe(true);

    const condicion = (nombre: string) =>
      salida.grupos.flatMap((g) => g.clasificacion).find((f) => f.nombre === nombre)?.clasifica;

    expect(condicion("A uno")).toBe("directo");
    expect(condicion("B uno")).toBe("directo");
    expect(condicion("A dos")).toBe("repesca");
    expect(condicion("B dos")).toBeNull();
  });

  it("un grupo fuera del bote no aporta candidatos a la repesca", async () => {
    const fase = await crearFase({ tipo: "grupos", clasifican: 1 });
    await env.DB.prepare("UPDATE torneo_fases SET repesca = 1 WHERE id = ?1").bind(fase.id).run();

    const grupoA = await crearGrupo(fase.id, { nombre: "A", orden: 0 });
    const grupoC = await crearGrupo(fase.id, { nombre: "C", orden: 1 });
    await env.DB.prepare("UPDATE torneo_grupos SET en_repesca = 0 WHERE id = ?1").bind(grupoC).run();

    const a1 = await crearEquipo({ nombre: "A uno" });
    const a2 = await crearEquipo({ nombre: "A dos" });
    const c1 = await crearEquipo({ nombre: "C uno" });
    const c2 = await crearEquipo({ nombre: "C dos" });
    await asignarEquipoAGrupo(grupoA, fase.id, a1.id);
    await asignarEquipoAGrupo(grupoA, fase.id, a2.id);
    await asignarEquipoAGrupo(grupoC, fase.id, c1.id);
    await asignarEquipoAGrupo(grupoC, fase.id, c2.id);

    // «C dos» encaja mucho menos que «A dos», pero su grupo no entra al bote.
    await crearPartido({
      faseId: fase.id, grupoId: grupoA, equipoA: a1, equipoB: a2,
      status: "finished", winner: "A", setsA: 2, setsB: 0, puntosA: 42, puntosB: 10
    });
    await crearPartido({
      faseId: fase.id, grupoId: grupoC, equipoA: c1, equipoB: c2,
      status: "finished", winner: "A", setsA: 2, setsB: 0, puntosA: 42, puntosB: 40
    });

    const respuesta = await onRequestGet(ctx(await peticion("/api/torneo"), env) as never);
    const datos = (await respuesta.json()) as {
      fases: { grupos: { nombre: string; enRepesca: boolean; clasificacion: { nombre: string; clasifica: string | null }[] }[] }[];
    };
    const salida = datos.fases[0]!;
    const condicion = (nombre: string) =>
      salida.grupos.flatMap((g) => g.clasificacion).find((f) => f.nombre === nombre)?.clasifica;

    expect(salida.grupos.find((g) => g.nombre === "C")!.enRepesca).toBe(false);
    expect(condicion("A dos")).toBe("repesca");
    expect(condicion("C dos")).toBeNull();
  });
});
