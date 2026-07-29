import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestPatch, onRequestPost } from "../../functions/api/partidos";
import { bloqueosAguasAbajo, propagarResultado } from "../../functions/_lib/torneo";
import type { UsuarioSesion } from "../../functions/_lib/auth";
import { ctx } from "../helpers/ctx";
import { crearAdmin, crearEquipo, crearPartido, enlazarPartidos, peticion } from "../helpers/db";

/*
 * El ganador de un cruce tiene que aparecer en el siguiente sin que nadie lo
 * teclee. Es lo que convierte una lista de partidos en un cuadro.
 *
 * La propagación se dispara desde los tres caminos que dejan un partido
 * cerrado: la acción `finish`, un PATCH a mano y el punto que cierra el último
 * set. Los tres pasan por la misma función, y aquí se comprueba que ninguno se
 * la salta.
 */

interface Slot {
  equipo_a_id: number | null;
  equipo_b_id: number | null;
  equipo_a_nombre: string;
  equipo_b_nombre: string;
  origen_equipo_a: string;
  origen_equipo_b: string;
}

const slots = async (id: string): Promise<Slot> =>
  (await env.DB
    .prepare(
      `SELECT equipo_a_id, equipo_b_id, equipo_a_nombre, equipo_b_nombre,
              origen_equipo_a, origen_equipo_b
         FROM partidos WHERE id = ?1`
    )
    .bind(id)
    .first<Slot>())!;

const accion = async (admin: UsuarioSesion, json: Record<string, unknown>) =>
  onRequestPost(ctx(await peticion("/api/partidos", { method: "POST", user: admin, json }), env));

const editar = async (admin: UsuarioSesion, id: string, json: Record<string, unknown>) =>
  onRequestPatch(ctx(await peticion(`/api/partidos?id=${id}`, { method: "PATCH", user: admin, json }), env));

/** Dos semifinales, una final y un partido por el tercer puesto, ya enlazados. */
async function montarCuadro() {
  const delfines = await crearEquipo({ nombre: "Delfines" });
  const gaviotas = await crearEquipo({ nombre: "Gaviotas" });
  const cangrejos = await crearEquipo({ nombre: "Cangrejos" });
  const percebes = await crearEquipo({ nombre: "Percebes" });

  const final = await crearPartido({ ronda: "Final", rondaOrden: 1, posicion: 0, vacio: true });
  const tercero = await crearPartido({ ronda: "Tercer puesto", rondaOrden: 1, posicion: 1, vacio: true });
  const semi1 = await crearPartido({
    ronda: "Semifinales",
    rondaOrden: 0,
    posicion: 0,
    equipoA: delfines,
    equipoB: gaviotas
  });
  const semi2 = await crearPartido({
    ronda: "Semifinales",
    rondaOrden: 0,
    posicion: 1,
    equipoA: cangrejos,
    equipoB: percebes
  });

  await enlazarPartidos(semi1, { ganador: { id: final, slot: "A" }, perdedor: { id: tercero, slot: "A" } });
  await enlazarPartidos(semi2, { ganador: { id: final, slot: "B" }, perdedor: { id: tercero, slot: "B" } });

  return { final, tercero, semi1, semi2, delfines, gaviotas, cangrejos, percebes };
}

describe("el ganador sube y el perdedor cae al tercer puesto", () => {
  it("coloca a cada uno en su hueco", async () => {
    const cuadro = await montarCuadro();
    await env.DB
      .prepare("UPDATE partidos SET status = 'finished', winner = 'A' WHERE id = ?1")
      .bind(cuadro.semi1)
      .run();

    const { propagados } = await propagarResultado(env.DB, cuadro.semi1);
    expect(propagados).toEqual([cuadro.final, cuadro.tercero]);

    const final = await slots(cuadro.final);
    expect(final.equipo_a_nombre).toBe("Delfines");
    expect(final.equipo_a_id).toBe(cuadro.delfines.id);
    expect(final.origen_equipo_a).toBe("progresion");
    // El otro hueco de la final sigue esperando a la otra semifinal.
    expect(final.equipo_b_nombre).toBe("");

    const tercero = await slots(cuadro.tercero);
    expect(tercero.equipo_a_nombre).toBe("Gaviotas");
  });

  it("un partido que no ha terminado no propaga nada", async () => {
    const cuadro = await montarCuadro();
    expect((await propagarResultado(env.DB, cuadro.semi1)).propagados).toEqual([]);
    expect((await slots(cuadro.final)).equipo_a_nombre).toBe("");
  });

  it("repetirlo no cambia nada", async () => {
    const cuadro = await montarCuadro();
    await env.DB
      .prepare("UPDATE partidos SET status = 'finished', winner = 'B' WHERE id = ?1")
      .bind(cuadro.semi2)
      .run();

    await propagarResultado(env.DB, cuadro.semi2);
    const primera = await slots(cuadro.final);
    await propagarResultado(env.DB, cuadro.semi2);
    expect(await slots(cuadro.final)).toEqual(primera);
  });
});

/*
 * Si alguien corrigió un cruce a mano, la propagación no puede deshacerlo en
 * silencio: eso es exactamente lo que `origen_equipo_*` está ahí para evitar.
 */
describe("un hueco puesto a mano no se pisa", () => {
  it("respeta el hueco manual y sí escribe el otro", async () => {
    const cuadro = await montarCuadro();
    await env.DB
      .prepare(
        `UPDATE partidos SET equipo_a_nombre = 'Elegido a dedo', origen_equipo_a = 'manual' WHERE id = ?1`
      )
      .bind(cuadro.final)
      .run();
    await env.DB
      .prepare("UPDATE partidos SET status = 'finished', winner = 'A' WHERE id = ?1")
      .bind(cuadro.semi1)
      .run();

    const { propagados } = await propagarResultado(env.DB, cuadro.semi1);

    const final = await slots(cuadro.final);
    expect(final.equipo_a_nombre).toBe("Elegido a dedo");
    expect(final.origen_equipo_a).toBe("manual");
    // El perdedor sí llega al tercer puesto, que nadie tocó.
    expect(propagados).toEqual([cuadro.tercero]);
  });
});

describe("los tres caminos que cierran un partido propagan igual", () => {
  it("la acción finish", async () => {
    const admin = await crearAdmin();
    const cuadro = await montarCuadro();

    await accion(admin, { action: "start", id: cuadro.semi1 });
    await accion(admin, { action: "point", id: cuadro.semi1, team: "A", delta: 1 });
    expect((await accion(admin, { action: "finish", id: cuadro.semi1 })).status).toBe(200);

    expect((await slots(cuadro.final)).equipo_a_nombre).toBe("Delfines");
  });

  it("una corrección a mano con PATCH", async () => {
    const admin = await crearAdmin();
    const cuadro = await montarCuadro();

    expect((await editar(admin, cuadro.semi2, { status: "finished", winner: "B" })).status).toBe(200);
    expect((await slots(cuadro.final)).equipo_b_nombre).toBe("Percebes");
    expect((await slots(cuadro.tercero)).equipo_b_nombre).toBe("Cangrejos");
  });

  /*
   * El camino menos evidente: nadie pulsa "terminar", el partido se cierra solo
   * cuando el último punto completa los sets que pide el formato.
   */
  it("el punto que cierra el último set", async () => {
    const admin = await crearAdmin();
    const cuadro = await montarCuadro();
    // A un set y a 5 puntos, para no meter 42 puntos en un test. Cinco es el
    // mínimo que admite `normalizarReglas`: por debajo lo descartaría y volvería
    // a los 21 de siempre.
    await env.DB
      .prepare(
        `UPDATE partidos SET reglas = '{"partido":{"sets":1,"puntosPorSet":5,"puntosSetDecisivo":5,"diferencia":1}}'
         WHERE id = ?1`
      )
      .bind(cuadro.semi1)
      .run();

    await accion(admin, { action: "start", id: cuadro.semi1 });
    for (let i = 0; i < 5; i += 1) {
      await accion(admin, { action: "point", id: cuadro.semi1, team: "A", delta: 1 });
    }

    const cerrado = await env.DB
      .prepare("SELECT status, winner FROM partidos WHERE id = ?1")
      .bind(cuadro.semi1)
      .first<{ status: string; winner: string }>();
    expect(cerrado).toMatchObject({ status: "finished", winner: "A" });
    expect((await slots(cuadro.final)).equipo_a_nombre).toBe("Delfines");
  });
});

describe("bloqueosAguasAbajo", () => {
  it("no señala nada mientras el cruce siguiente no haya empezado", async () => {
    const cuadro = await montarCuadro();
    expect(await bloqueosAguasAbajo(env.DB, cuadro.semi1)).toEqual([]);
  });

  it("señala el cruce siguiente en cuanto está en juego o terminado", async () => {
    const cuadro = await montarCuadro();
    await env.DB.prepare("UPDATE partidos SET status = 'live' WHERE id = ?1").bind(cuadro.final).run();

    expect(await bloqueosAguasAbajo(env.DB, cuadro.semi1)).toEqual(["Final"]);
  });
});

describe("las reglas salen de la foto del partido, no de literales", () => {
  it("un partido a un set se cierra con un solo set ganado", async () => {
    const admin = await crearAdmin();
    const partidoId = await crearPartido({
      reglas: { partido: { sets: 1, puntosPorSet: 5, puntosSetDecisivo: 5, diferencia: 1 } }
    });

    await accion(admin, { action: "start", id: partidoId });
    for (let i = 0; i < 5; i += 1) {
      await accion(admin, { action: "point", id: partidoId, team: "B", delta: 1 });
    }

    const fila = await env.DB
      .prepare("SELECT status, winner, sets_b FROM partidos WHERE id = ?1")
      .bind(partidoId)
      .first<{ status: string; winner: string; sets_b: number }>();
    expect(fila).toMatchObject({ status: "finished", winner: "B", sets_b: 1 });
  });

  it("sin reglas propias se arbitra con las de siempre: 21 y dos de ventaja", async () => {
    const admin = await crearAdmin();
    const partidoId = await crearPartido();

    await accion(admin, { action: "start", id: partidoId });
    for (let i = 0; i < 21; i += 1) {
      await accion(admin, { action: "point", id: partidoId, team: "A", delta: 1 });
    }

    const fila = await env.DB
      .prepare("SELECT sets_a, points_a, status FROM partidos WHERE id = ?1")
      .bind(partidoId)
      .first<{ sets_a: number; points_a: number; status: string }>();
    // 21-0 cierra el set (hay dos de ventaja de sobra) pero no el partido.
    expect(fila).toMatchObject({ sets_a: 1, points_a: 0, status: "live" });
  });
});
