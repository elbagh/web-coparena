import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestGet, onRequestPost } from "../../functions/api/admin/torneo";
import type { UsuarioSesion } from "../../functions/_lib/auth";
import { ctx } from "../helpers/ctx";
import { crearAdmin, crearEquipo, peticion } from "../helpers/db";

/*
 * El torneo 2026, montado por los endpoints de verdad.
 *
 * No es un test de una función: es el procedimiento de programar la edición
 * escrito como código. Trece equipos en grupos de 4-4-5, una sola pista y cinco
 * tardes; los grupos de cuatro al mejor de tres a 15 y el de cinco a un set de
 * 21, porque con una pista 6 partidos a dos sets acaban más tarde que 10 a uno.
 *
 * Lo que fija es lo que se decidió y por qué:
 *   - que el calendario da 6 + 6 + 10 = 22 partidos;
 *   - que cada grupo se juega con SUS reglas y que el partido se las queda
 *     congeladas;
 *   - que el grupo de cinco puntúa 3-0 y no 2-1 pese a jugarse a un set;
 *   - y que de ahí salen exactamente 8 clasificados: 2 + 2 + 3 directos y 1 de
 *     repesca entre los terceros de los grupos de cuatro.
 */

const REGLAS_FASE = {
  partido: { sets: 2, puntosPorSet: 15, puntosSetDecisivo: 15, diferencia: 2 },
  clasificacion: {
    puntosVictoria: 3,
    puntosDerrota: 0,
    puntosVictoriaAjustada: 2,
    puntosDerrotaAjustada: 1,
    desempates: ["puntos", "enfrentamiento_directo", "ratio_sets", "ratio_puntos"]
  }
};

/*
 * El grupo de cinco necesita su bloque `clasificacion` y no es decorativo: con
 * `sets: 1`, `setsMaximos` vale 1 y todos sus partidos cuentan como resueltos
 * en el set decisivo. Sin igualar los valores ajustados a los normales,
 * puntuaría 2-1 en vez de 3-0.
 */
const REGLAS_GRUPO_C = {
  partido: { sets: 1, puntosPorSet: 21, puntosSetDecisivo: 21, diferencia: 2 },
  clasificacion: {
    puntosVictoria: 3,
    puntosDerrota: 0,
    puntosVictoriaAjustada: 3,
    puntosDerrotaAjustada: 0,
    desempates: ["puntos", "enfrentamiento_directo", "ratio_sets", "ratio_puntos"]
  }
};

/** El sorteo real, con las restricciones de disponibilidad ya aplicadas. */
const SORTEO = [
  {
    nombre: "A",
    orden: 0,
    clasifican: null as number | null,
    enRepesca: true,
    reglas: null as unknown,
    // De mejor a peor: el de arriba gana siempre, para que la tabla sea determinista.
    equipos: ["Calvos de Orion", "Bye Bye Bye", "Free Copa Arena", "Croquetillas de Arena"],
    // Márgenes cortos: su tercero gana la repesca por ratio de puntos.
    sets: [
      { a: 15, b: 13 },
      { a: 15, b: 13 }
    ]
  },
  {
    nombre: "B",
    orden: 1,
    clasifican: null as number | null,
    enRepesca: true,
    reglas: null as unknown,
    equipos: ["Limens", "Los Julais", "Segarro", "Deportivo A Silva"],
    sets: [
      { a: 15, b: 6 },
      { a: 15, b: 6 }
    ]
  },
  {
    nombre: "C",
    orden: 2,
    clasifican: 3,
    enRepesca: false,
    reglas: REGLAS_GRUPO_C,
    equipos: ["Showtime", "Dosilva", "Kylian dictador", "ONDA BRAVA", "Alejo Mouris"],
    sets: [{ a: 21, b: 15 }]
  }
];

interface GrupoSalida {
  id: number;
  nombre: string;
  clasifican: number;
  clasificanPropio: number | null;
  enRepesca: boolean;
  reglas: { partido: { sets: number; puntosPorSet: number } };
  clasificacion: { posicion: number; nombre: string; puntos: number; clasifica: string | null }[];
}

interface FaseSalida {
  id: number;
  clave: string;
  clasifican: number;
  repesca: number;
  grupos: GrupoSalida[];
  partidos: { id: string; grupoId: number | null; reglas: { sets: number; puntosPorSet: number } }[];
}

/*
 * Montar la edición entera son ~35 llamadas secuenciales a los endpoints reales
 * (la fase, tres grupos, trece equipos, trece asignaciones y el calendario), y
 * cada test la repite desde cero porque el setup vacía las tablas entre tests.
 * Ese coste es el precio de probar el procedimiento y no una función suelta;
 * los 5 s por defecto de vitest no dan.
 */
vi.setConfig({ testTimeout: 40000 });

let admin: UsuarioSesion;
const idDeGrupo = new Map<string, number>();

const leerTorneo = async (): Promise<FaseSalida[]> => {
  const respuesta = await onRequestGet(ctx(await peticion("/api/admin/torneo", { user: admin }), env) as never);
  const datos = (await respuesta.json()) as { fases: FaseSalida[] };
  return datos.fases;
};

const post = async (ruta: string, json: unknown) =>
  onRequestPost(ctx(await peticion(ruta, { method: "POST", user: admin, json }), env) as never);

/** Monta fase, grupos y equipos, y genera el calendario. */
async function programarGrupos(): Promise<FaseSalida> {
  admin = await crearAdmin();

  const creada = await post("/api/admin/torneo?accion=fase", {
    clave: "grupos",
    nombre: "Fase de grupos",
    tipo: "grupos",
    orden: 0,
    clasifican: 2,
    repesca: 1,
    reglas: REGLAS_FASE
  });
  expect(creada.status).toBe(201);
  const fase = ((await creada.json()) as { fases: FaseSalida[] }).fases[0]!;

  for (const grupo of SORTEO) {
    const respuesta = await post(`/api/admin/torneo?accion=grupo&fase=${fase.id}`, {
      nombre: grupo.nombre,
      orden: grupo.orden,
      clasifican: grupo.clasifican,
      enRepesca: grupo.enRepesca,
      reglas: grupo.reglas
    });
    expect(respuesta.status).toBe(201);

    const fases = ((await respuesta.json()) as { fases: FaseSalida[] }).fases;
    const creado = fases[0]!.grupos.find((g) => g.nombre === grupo.nombre)!;
    idDeGrupo.set(grupo.nombre, creado.id);

    for (const nombre of grupo.equipos) {
      const equipo = await crearEquipo({ nombre });
      const asignado = await post(`/api/admin/torneo?accion=asignar&grupo=${creado.id}`, { equipoId: equipo.id });
      expect(asignado.status).toBe(201);
    }
  }

  const liga = await post(`/api/admin/torneo?accion=generar-liga&fase=${fase.id}`, {});
  expect(liga.status).toBe(201);

  return (await leerTorneo()).find((f) => f.clave === "grupos")!;
}

/** Cierra todos los partidos de grupos: gana siempre el mejor del sorteo. */
async function jugarLosGrupos(): Promise<void> {
  const { results } = await env.DB
    .prepare("SELECT id, grupo_id, equipo_a_nombre, equipo_b_nombre FROM partidos WHERE grupo_id IS NOT NULL")
    .all<{ id: string; grupo_id: number; equipo_a_nombre: string; equipo_b_nombre: string }>();

  for (const partido of results) {
    const grupo = SORTEO.find((g) => idDeGrupo.get(g.nombre) === partido.grupo_id)!;
    const ganaA = grupo.equipos.indexOf(partido.equipo_a_nombre) < grupo.equipos.indexOf(partido.equipo_b_nombre);
    const sets = grupo.sets.map((s) => (ganaA ? s : { a: s.b, b: s.a }));
    const setsA = sets.filter((s) => s.a > s.b).length;

    await env.DB
      .prepare(
        `UPDATE partidos SET status = 'finished', winner = ?1, sets_a = ?2, sets_b = ?3,
                points_a = ?4, points_b = ?5, set_history = ?6 WHERE id = ?7`
      )
      .bind(
        ganaA ? "A" : "B",
        setsA,
        sets.length - setsA,
        sets.reduce((t, s) => t + s.a, 0),
        sets.reduce((t, s) => t + s.b, 0),
        JSON.stringify(sets),
        partido.id
      )
      .run();
  }
}

beforeEach(() => {
  idDeGrupo.clear();
});

/*
 * Tres tests y no ocho, a propósito. Cada uno rehace la edición entera porque el
 * setup vacía las tablas entre tests, así que partir esto en un test por
 * aserción multiplicaba el montaje más caro de la suite y desbordaba por timeout
 * a los tests vecinos cuando los tres proyectos corren a la vez.
 */
describe("programar el torneo 2026", () => {
  it("el calendario da 22 partidos y cada grupo se los queda con SUS reglas", async () => {
    const fase = await programarGrupos();

    const deGrupo = (nombre: string) => fase.partidos.filter((p) => p.grupoId === idDeGrupo.get(nombre));

    // 6 + 6 + 10: dos grupos de cuatro y uno de cinco, todos contra todos.
    expect(deGrupo("A")).toHaveLength(6);
    expect(deGrupo("B")).toHaveLength(6);
    expect(deGrupo("C")).toHaveLength(10);
    expect(fase.partidos).toHaveLength(22);

    // Las reglas del partido son una foto congelada, no un puntero a la fase.
    // Los de cuatro heredan (al mejor de tres a 15); el de cinco sobrescribe.
    expect(deGrupo("A")[0]!.reglas).toMatchObject({ sets: 2, puntosPorSet: 15 });
    expect(deGrupo("B")[0]!.reglas).toMatchObject({ sets: 2, puntosPorSet: 15 });
    expect(deGrupo("C")[0]!.reglas).toMatchObject({ sets: 1, puntosPorSet: 21 });
  });

  it("de los grupos salen 8: 2 + 2 + 3 directos y 1 de repesca entre los terceros de A y B", async () => {
    await programarGrupos();
    await jugarLosGrupos();

    const fase = (await leerTorneo()).find((f) => f.clave === "grupos")!;
    const c = fase.grupos.find((g) => g.nombre === "C")!;

    /*
     * Cuatro partidos, cuatro victorias: 12 puntos y no 8. Con `sets: 1` todo
     * partido cuenta como resuelto en el set decisivo, así que sin el bloque
     * `clasificacion` propio del grupo puntuaría con los valores «ajustados».
     */
    expect(c.clasificacion[0]).toMatchObject({ nombre: "Showtime", puntos: 12 });
    expect(c.clasificacion.at(-1)).toMatchObject({ nombre: "Alejo Mouris", puntos: 0 });

    const filas = fase.grupos.flatMap((g) => g.clasificacion);
    const directos = filas.filter((f) => f.clasifica === "directo").map((f) => f.nombre);
    const repescados = filas.filter((f) => f.clasifica === "repesca").map((f) => f.nombre);

    expect(directos.length + repescados.length).toBe(8);
    expect(directos.sort()).toEqual(
      ["Bye Bye Bye", "Calvos de Orion", "Dosilva", "Kylian dictador", "Limens", "Los Julais", "Showtime"].sort()
    );
    // El tercero de A gana la repesca al de B: mismos puntos, mejor ratio.
    expect(repescados).toEqual(["Free Copa Arena"]);

    // Y el de cinco no aporta candidatos: juega otro formato, sus puntos no son
    // comparables. Su cuarto se queda fuera aunque puntúe más que el tercero de A.
    expect(c.enRepesca).toBe(false);
    expect(c.clasificanPropio).toBe(3);
    expect(c.clasificacion[3]!.clasifica).toBeNull();
  });

  it("el cuadro de 8 con tercer puesto son 8 partidos y se siembra con los 8 clasificados", async () => {
    const grupos = await programarGrupos();
    await jugarLosGrupos();

    const creada = await post("/api/admin/torneo?accion=fase", {
      clave: "cuadro",
      nombre: "Eliminatoria",
      tipo: "eliminatoria",
      orden: 1,
      clasifican: 0,
      repesca: 0,
      reglas: { partido: { sets: 2, puntosPorSet: 21, puntosSetDecisivo: 15, diferencia: 2 } }
    });
    const cuadro = ((await creada.json()) as { fases: FaseSalida[] }).fases.find((f) => f.clave === "cuadro")!;

    await post(`/api/admin/torneo?accion=generar-cuadro&fase=${cuadro.id}`, { tamano: 8, tercerPuesto: true });
    const sembrada = await post(`/api/admin/torneo?accion=sembrar&fase=${cuadro.id}`, { desdeFase: grupos.id });
    expect(sembrada.status).toBe(200);

    const { results } = await env.DB
      .prepare("SELECT ronda, ronda_orden, equipo_a_nombre, equipo_b_nombre FROM partidos WHERE fase_id = ?1")
      .bind(cuadro.id)
      .all<{ ronda: string; ronda_orden: number; equipo_a_nombre: string; equipo_b_nombre: string }>();

    // 4 cuartos + 2 semis + 3.er puesto + final.
    expect(results).toHaveLength(8);
    expect(results.filter((p) => p.ronda === "Cuartos de final")).toHaveLength(4);
    expect(results.filter((p) => p.ronda === "Tercer puesto")).toHaveLength(1);

    const enCuartos = results
      .filter((p) => p.ronda_orden === 0)
      .flatMap((p) => [p.equipo_a_nombre, p.equipo_b_nombre])
      .filter(Boolean);
    expect(enCuartos).toHaveLength(8);
    expect(new Set(enCuartos).size).toBe(8);
    expect(enCuartos).toContain("Free Copa Arena");
  });
});
