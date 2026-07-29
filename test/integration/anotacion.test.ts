import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestGet, onRequestPost } from "../../functions/api/anotacion";
import { onRequestPatch as patchPartido, onRequestPost as postPartido } from "../../functions/api/partidos";
import { plegarEventos, type EventoFila } from "../../functions/_lib/marcador";
import { REGLAS_POR_DEFECTO } from "../../functions/_lib/reglas";
import type { UsuarioSesion } from "../../functions/_lib/auth";
import { ctx } from "../helpers/ctx";
import {
  crearAdmin,
  crearEquipo,
  crearPartido,
  crearUsuario,
  crearUsuarioConPermisos,
  peticion,
  type EquipoSembrado
} from "../helpers/db";

/*
 * La anotación en directo. El log de eventos es la fuente de verdad: el marcador
 * de `partidos` y las filas de `estadisticas` se derivan de él en cada
 * escritura. Aquí se comprueba justamente eso, y los dos invariantes que
 * sostienen el diseño:
 *
 *   - Un error da el punto al RIVAL y suma a los errores de quien lo comete, sin
 *     regalar puntos a nadie.
 *   - Mientras un anotador lleva el partido, el panel no puede tocar el
 *     marcador: si pudieran los dos, uno perdería en silencio.
 */

interface Respuesta {
  partido: { origenMarcador: string; status: string };
  estado: { puntos: { A: number; B: number }; sets: { A: number; B: number }; setNumero: number; winner: string | null };
  eventos: { orden: number; tipo: string; jugadorId: number | null; ladoPunto: string | null }[];
  siguienteOrden: number;
  alineacion: { jugador_id: number; lado: string }[];
}

const anotar = async (user: UsuarioSesion, partidoId: string, json: Record<string, unknown>) =>
  onRequestPost(ctx(await peticion(`/api/anotacion?partido=${partidoId}`, { method: "POST", user, json }), env));

const leer = async (user: UsuarioSesion, partidoId: string): Promise<Respuesta> => {
  const respuesta = await onRequestGet(ctx(await peticion(`/api/anotacion?partido=${partidoId}`, { user }), env));
  return (await respuesta.json()) as Respuesta;
};

const estadisticasDe = async (jugadorId: number) =>
  await env.DB
    .prepare("SELECT puntos, remates, bloqueos, aces, defensas, errores FROM estadisticas WHERE jugador_id = ?1")
    .bind(jugadorId)
    .first<Record<string, number>>();

/** Un partido en juego con los dos equipos ya alineados. */
async function montarPartido(user: UsuarioSesion, reglas?: unknown) {
  const local: EquipoSembrado = await crearEquipo({
    nombre: "Delfines",
    jugadores: [{ nombre: "Ana" }, { nombre: "Berta" }]
  });
  const visitante: EquipoSembrado = await crearEquipo({
    nombre: "Gaviotas",
    jugadores: [{ nombre: "Carla" }, { nombre: "Diana" }]
  });

  const partidoId = await crearPartido({
    equipoA: local,
    equipoB: visitante,
    status: "live",
    ...(reglas === undefined ? {} : { reglas })
  });

  await anotar(user, partidoId, { accion: "alineacion", lado: "A", jugadorIds: local.jugadores.map((j) => j.id) });
  await anotar(user, partidoId, {
    accion: "alineacion",
    lado: "B",
    jugadorIds: visitante.jugadores.map((j) => j.id)
  });

  return { partidoId, local, visitante };
}

/** Manda un punto y devuelve la respuesta, leyendo antes el orden esperado. */
async function punto(
  user: UsuarioSesion,
  partidoId: string,
  jugadorId: number,
  tipo = "remate"
): Promise<Response> {
  const { siguienteOrden } = await leer(user, partidoId);
  return anotar(user, partidoId, { accion: "evento", tipo, jugadorId, ordenEsperado: siguienteOrden });
}

describe("permisos", () => {
  it("sin permiso no se entra", async () => {
    const user = await crearUsuario();
    const partidoId = await crearPartido();
    expect(
      (await onRequestGet(ctx(await peticion(`/api/anotacion?partido=${partidoId}`, { user }), env))).status
    ).toBe(403);
  });

  it("`partidos.anotar` basta para anotar", async () => {
    const anotador = await crearUsuarioConPermisos(["partidos.anotar", "jugadores.ver"]);
    const { partidoId, local } = await montarPartido(anotador);

    expect((await punto(anotador, partidoId, local.jugadores[0]!.id)).status).toBe(201);
  });

  /*
   * Rehacer un partido cerrado ya no es anotar. Quien solo tiene
   * `partidos.anotar` lleva lo que se está jugando.
   */
  it("un partido terminado ya no lo toca quien solo puede anotar", async () => {
    const anotador = await crearUsuarioConPermisos(["partidos.anotar", "jugadores.ver"]);
    const admin = await crearAdmin();
    const { partidoId, local } = await montarPartido(admin);
    await env.DB.prepare("UPDATE partidos SET status = 'finished' WHERE id = ?1").bind(partidoId).run();

    expect((await punto(anotador, partidoId, local.jugadores[0]!.id)).status).toBe(403);
    // El admin sí, porque tiene `partidos.editar`.
    expect((await punto(admin, partidoId, local.jugadores[0]!.id)).status).toBe(201);
  });
});

describe("anotar un punto", () => {
  it("sube el marcador y crea la ficha de ese jugador", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montarPartido(admin);

    expect((await punto(admin, partidoId, local.jugadores[0]!.id, "remate")).status).toBe(201);

    const despues = await leer(admin, partidoId);
    expect(despues.estado.puntos).toEqual({ A: 1, B: 0 });
    expect(await estadisticasDe(local.jugadores[0]!.id)).toMatchObject({ puntos: 1, remates: 1 });
  });

  it("cada tipo suma a su métrica", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montarPartido(admin);
    const ana = local.jugadores[0]!.id;

    for (const tipo of ["remate", "ace", "bloqueo", "defensa"]) await punto(admin, partidoId, ana, tipo);

    expect(await estadisticasDe(ana)).toMatchObject({
      puntos: 3,
      remates: 1,
      aces: 1,
      bloqueos: 1,
      defensas: 1
    });
    // La defensa no puntúa: el rally sigue.
    expect((await leer(admin, partidoId)).estado.puntos).toEqual({ A: 3, B: 0 });
  });

  /*
   * El invariante que justifica guardar dos lados en cada evento. Si esto se
   * tuerce, el marcador y las estadísticas quedan cruzados y no se ve hasta el
   * final del torneo.
   */
  it("un error de A da el punto a B y suma a los errores de quien lo comete", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montarPartido(admin);
    const ana = local.jugadores[0]!.id;

    await punto(admin, partidoId, ana, "error");

    const despues = await leer(admin, partidoId);
    expect(despues.estado.puntos).toEqual({ A: 0, B: 1 });
    expect(await estadisticasDe(ana)).toMatchObject({ errores: 1, puntos: 0 });
  });

  it("cierra el set y el partido cuando toca", async () => {
    const admin = await crearAdmin();
    // A un set de 5, para no mandar 42 peticiones.
    const { partidoId, local } = await montarPartido(admin, {
      partido: { sets: 1, puntosPorSet: 5, puntosSetDecisivo: 5, diferencia: 1 }
    });

    for (let i = 0; i < 5; i += 1) await punto(admin, partidoId, local.jugadores[0]!.id);

    const despues = await leer(admin, partidoId);
    expect(despues.estado.sets).toEqual({ A: 1, B: 0 });
    expect(despues.estado.winner).toBe("A");
    expect(despues.partido.status).toBe("finished");
  });

  it("no anota sin alineación: cada punto lleva un jugador detrás", async () => {
    const admin = await crearAdmin();
    const equipo = await crearEquipo({ nombre: "Delfines" });
    const partidoId = await crearPartido({ equipoA: equipo, status: "live" });

    const respuesta = await anotar(admin, partidoId, {
      accion: "evento",
      tipo: "remate",
      jugadorId: equipo.jugadores[0]!.id,
      ordenEsperado: 0
    });
    expect(respuesta.status).toBe(409);
  });

  it("rechaza a quien no está en la alineación", async () => {
    const admin = await crearAdmin();
    const { partidoId } = await montarPartido(admin);
    const fuera = await crearEquipo({ nombre: "Cangrejos" });

    const { siguienteOrden } = await leer(admin, partidoId);
    const respuesta = await anotar(admin, partidoId, {
      accion: "evento",
      tipo: "remate",
      jugadorId: fuera.jugadores[0]!.id,
      ordenEsperado: siguienteOrden
    });

    expect(respuesta.status).toBe(400);
    expect(((await respuesta.json()) as { campos: Record<string, string> }).campos.jugadorId).toBeTruthy();
  });

  it("no deja alinear a alguien de otro equipo", async () => {
    const admin = await crearAdmin();
    const { partidoId } = await montarPartido(admin);
    const fuera = await crearEquipo({ nombre: "Percebes" });

    const respuesta = await anotar(admin, partidoId, {
      accion: "alineacion",
      lado: "A",
      jugadorIds: [fuera.jugadores[0]!.id]
    });
    expect(respuesta.status).toBe(400);
  });
});

/*
 * Dos anotadores sobre el mismo partido. El UNIQUE(partido_id, orden) es lo que
 * convierte «el segundo pisa al primero» en «el segundo se entera».
 */
describe("dos anotadores a la vez", () => {
  it("el mismo orden dos veces da 409 y no cambia nada", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montarPartido(admin);
    const ana = local.jugadores[0]!.id;

    const cuerpo = { accion: "evento", tipo: "remate", jugadorId: ana, ordenEsperado: 0 };
    expect((await anotar(admin, partidoId, cuerpo)).status).toBe(201);

    const segunda = await anotar(admin, partidoId, cuerpo);
    expect(segunda.status).toBe(409);
    expect((await leer(admin, partidoId)).estado.puntos).toEqual({ A: 1, B: 0 });
  });

  it("deshacer con un orden desfasado también da 409", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montarPartido(admin);
    await punto(admin, partidoId, local.jugadores[0]!.id);

    const respuesta = await anotar(admin, partidoId, { accion: "deshacer", ordenEsperado: 99 });
    expect(respuesta.status).toBe(409);
    expect((await leer(admin, partidoId)).estado.puntos).toEqual({ A: 1, B: 0 });
  });
});

describe("deshacer", () => {
  it("devuelve el marcador exacto de antes, incluido un set cerrado", async () => {
    const admin = await crearAdmin();
    const { partidoId, local, visitante } = await montarPartido(admin, {
      partido: { sets: 2, puntosPorSet: 5, puntosSetDecisivo: 5, diferencia: 1 }
    });
    const ana = local.jugadores[0]!.id;

    // Set 1 para A, y un punto suelto en el segundo.
    for (let i = 0; i < 5; i += 1) await punto(admin, partidoId, ana);
    await punto(admin, partidoId, visitante.jugadores[0]!.id);

    const antes = await leer(admin, partidoId);
    expect(antes.estado.sets).toEqual({ A: 1, B: 0 });
    expect(antes.estado.puntos).toEqual({ A: 0, B: 1 });

    // Deshacer el punto suelto y luego el que cerró el set.
    await anotar(admin, partidoId, { accion: "deshacer", ordenEsperado: antes.siguienteOrden - 1 });
    const tras1 = await leer(admin, partidoId);
    expect(tras1.estado.puntos).toEqual({ A: 0, B: 0 });

    await anotar(admin, partidoId, { accion: "deshacer", ordenEsperado: tras1.siguienteOrden - 1 });
    const tras2 = await leer(admin, partidoId);
    expect(tras2.estado.sets).toEqual({ A: 0, B: 0 });
    expect(tras2.estado.puntos).toEqual({ A: 4, B: 0 });
    expect(await estadisticasDe(ana)).toMatchObject({ puntos: 4 });
  });

  it("deshacer el único evento deja la ficha de ese jugador a cero", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montarPartido(admin);
    const ana = local.jugadores[0]!.id;

    await punto(admin, partidoId, ana);
    await anotar(admin, partidoId, { accion: "deshacer", ordenEsperado: 0 });

    // Sin eventos suyos, deja de tener ficha en este partido.
    expect(await estadisticasDe(ana)).toBeNull();
  });
});

describe("corregir un evento antiguo", () => {
  /*
   * Todo lo posterior se vuelve a plegar encima, así que cambiar quién ganó un
   * punto puede cambiar quién ganó el set.
   */
  it("puede cambiar el ganador del set", async () => {
    const admin = await crearAdmin();
    const { partidoId, local, visitante } = await montarPartido(admin, {
      partido: { sets: 1, puntosPorSet: 5, puntosSetDecisivo: 5, diferencia: 1 }
    });
    const ana = local.jugadores[0]!.id;
    const carla = visitante.jugadores[0]!.id;

    for (let i = 0; i < 4; i += 1) await punto(admin, partidoId, ana);
    for (let i = 0; i < 4; i += 1) await punto(admin, partidoId, carla);
    await punto(admin, partidoId, ana); // 5-4: gana A

    expect((await leer(admin, partidoId)).estado.winner).toBe("A");

    // Aquel primer punto no lo hizo Ana: fue un error suyo, y el punto era de B.
    await anotar(admin, partidoId, { accion: "corregir", orden: 0, tipo: "error", jugadorId: ana });

    const despues = await leer(admin, partidoId);
    expect(despues.estado.winner).toBe("B");
    expect(await estadisticasDe(ana)).toMatchObject({ errores: 1, puntos: 4 });
  });

  it("cambiar solo el autor mueve la estadística de sitio", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montarPartido(admin);
    const ana = local.jugadores[0]!.id;
    const berta = local.jugadores[1]!.id;

    await punto(admin, partidoId, ana, "ace");
    await anotar(admin, partidoId, { accion: "corregir", orden: 0, jugadorId: berta });

    expect(await estadisticasDe(ana)).toBeNull();
    expect(await estadisticasDe(berta)).toMatchObject({ aces: 1, puntos: 1 });
  });
});

/*
 * Lo que hace segura toda la anotación: da igual cómo se llegue a un estado, el
 * log manda. Si añadir y recalcular pudieran discrepar, un día lo harían.
 */
describe("el log es la fuente de verdad", () => {
  /*
   * Este es el test más caro de la suite: 24 puntos secuenciales, y cada uno
   * repliega el log entero y reescribe las estadísticas de los ocho jugadores.
   * Ese coste ES lo que se está probando. El `testTimeout` de
   * test/integration/vitest.config.ts existe sobre todo por él.
   */
  it("recalcular desde el log da lo mismo que ir anotando", async () => {
    const admin = await crearAdmin();
    const { partidoId, local, visitante } = await montarPartido(admin);
    const jugadores = [...local.jugadores, ...visitante.jugadores].map((j) => j.id);
    const tipos = ["remate", "ace", "bloqueo", "error", "defensa"];

    for (let i = 0; i < 24; i += 1) {
      await punto(admin, partidoId, jugadores[i % jugadores.length]!, tipos[i % tipos.length]!);
    }

    const anotando = await leer(admin, partidoId);
    const fichas = await Promise.all(jugadores.map((id) => estadisticasDe(id)));

    // Se fuerza el recálculo completo y no debe cambiar nada.
    await onRequestPatch(partidoId, admin);

    const recalculado = await leer(admin, partidoId);
    expect(recalculado.estado).toEqual(anotando.estado);
    expect(await Promise.all(jugadores.map((id) => estadisticasDe(id)))).toEqual(fichas);
  });

  it("el marcador guardado coincide con plegar el log a mano", async () => {
    const admin = await crearAdmin();
    const { partidoId, local, visitante } = await montarPartido(admin);

    await punto(admin, partidoId, local.jugadores[0]!.id);
    await punto(admin, partidoId, visitante.jugadores[0]!.id, "error");
    await punto(admin, partidoId, local.jugadores[1]!.id, "bloqueo");

    const { results } = await env.DB
      .prepare(
        `SELECT orden, tipo, lado_jugador, jugador_id, lado_punto, puntos_a, puntos_b, sets_a, sets_b
           FROM partido_eventos WHERE partido_id = ?1 ORDER BY orden ASC`
      )
      .bind(partidoId)
      .all<EventoFila>();
    const aMano = plegarEventos(results, REGLAS_POR_DEFECTO.partido);

    const guardado = await env.DB
      .prepare("SELECT points_a, points_b, sets_a FROM partidos WHERE id = ?1")
      .bind(partidoId)
      .first<{ points_a: number; points_b: number; sets_a: number }>();

    expect(guardado).toMatchObject({ points_a: aMano.puntos.A, points_b: aMano.puntos.B });
  });
});

const onRequestPatch = async (partidoId: string, user: UsuarioSesion) => {
  const modulo = await import("../../functions/api/anotacion");
  return modulo.onRequestPatch(
    ctx(await peticion(`/api/anotacion?partido=${partidoId}`, { method: "PATCH", user }), env)
  );
};

/*
 * Sin este discriminador, la secuencia «anotador marca punto → alguien corrige a
 * mano en el panel → anotador marca otro punto» perdía la corrección en
 * silencio, porque el siguiente recálculo desde el log la sobrescribía.
 */
describe("el panel y el anotador no se pisan", () => {
  const accionPanel = async (user: UsuarioSesion, json: Record<string, unknown>) =>
    postPartido(ctx(await peticion("/api/partidos", { method: "POST", user, json }), env));

  it("un partido nuevo lo lleva el panel, como siempre", async () => {
    const admin = await crearAdmin();
    const partidoId = await crearPartido({ status: "live" });

    expect((await accionPanel(admin, { action: "point", id: partidoId, team: "A", delta: 1 })).status).toBe(200);
  });

  it("en cuanto hay un evento, el panel deja de poder tocar el marcador", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montarPartido(admin);
    await punto(admin, partidoId, local.jugadores[0]!.id);

    const respuesta = await accionPanel(admin, { action: "point", id: partidoId, team: "B", delta: 1 });
    expect(respuesta.status).toBe(409);
    expect(await respuesta.json()).toMatchObject({ error: expect.stringContaining("anotador") });
    // Y el marcador no se ha movido.
    expect((await leer(admin, partidoId)).estado.puntos).toEqual({ A: 1, B: 0 });
  });

  it("el PATCH del panel tampoco puede tocar el marcador, pero sí la hora", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montarPartido(admin);
    await punto(admin, partidoId, local.jugadores[0]!.id);

    const marcador = await patchPartido(
      ctx(await peticion(`/api/partidos?id=${partidoId}`, { method: "PATCH", user: admin, json: { pointsA: 9 } }), env)
    );
    expect(marcador.status).toBe(409);

    const hora = await patchPartido(
      ctx(
        await peticion(`/api/partidos?id=${partidoId}`, {
          method: "PATCH",
          user: admin,
          json: { scheduledAt: "2026-08-01T10:00" }
        }),
        env
      )
    );
    expect(hora.status).toBe(200);
  });

  it("soltar la anotación devuelve el mando y conserva lo anotado", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montarPartido(admin);
    await punto(admin, partidoId, local.jugadores[0]!.id);

    await anotar(admin, partidoId, { accion: "soltar" });

    expect((await accionPanel(admin, { action: "point", id: partidoId, team: "B", delta: 1 })).status).toBe(200);
    // El log sigue ahí, y las estadísticas también.
    expect((await leer(admin, partidoId)).eventos).toHaveLength(1);
    expect(await estadisticasDe(local.jugadores[0]!.id)).toMatchObject({ puntos: 1 });
  });
});

/*
 * Un partido empezado sin anotador no se puede reconstruir: de esos puntos no se
 * sabe quién los metió, y no se van a inventar. El ajuste es el saldo de
 * apertura, no un punto.
 */
describe("adoptar un partido que venía a mano", () => {
  it("arranca desde el marcador que había y no crea estadísticas", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montarPartido(admin);
    await env.DB
      .prepare("UPDATE partidos SET points_a = 12, points_b = 9 WHERE id = ?1")
      .bind(partidoId)
      .run();

    expect((await anotar(admin, partidoId, { accion: "adoptar" })).status).toBe(201);

    const despues = await leer(admin, partidoId);
    expect(despues.estado.puntos).toEqual({ A: 12, B: 9 });
    expect(despues.partido.origenMarcador).toBe("eventos");

    // Nadie carga con esos doce puntos.
    const cuantas = await env.DB.prepare("SELECT COUNT(*) AS n FROM estadisticas").first<{ n: number }>();
    expect(cuantas!.n).toBe(0);

    // Y a partir de ahí sí se atribuye.
    await punto(admin, partidoId, local.jugadores[0]!.id);
    expect((await leer(admin, partidoId)).estado.puntos).toEqual({ A: 13, B: 9 });
    expect(await estadisticasDe(local.jugadores[0]!.id)).toMatchObject({ puntos: 1 });
  });

  it("no se adopta dos veces", async () => {
    const admin = await crearAdmin();
    const { partidoId } = await montarPartido(admin);
    await anotar(admin, partidoId, { accion: "adoptar" });

    expect((await anotar(admin, partidoId, { accion: "adoptar" })).status).toBe(409);
  });
});

describe("el cuadro se entera", () => {
  it("cerrar un partido anotando propaga el ganador al siguiente cruce", async () => {
    const admin = await crearAdmin();
    const final = await crearPartido({ ronda: "Final", vacio: true });
    const { partidoId, local } = await montarPartido(admin, {
      partido: { sets: 1, puntosPorSet: 5, puntosSetDecisivo: 5, diferencia: 1 }
    });
    await env.DB
      .prepare("UPDATE partidos SET siguiente_partido_id = ?1, siguiente_slot = 'A' WHERE id = ?2")
      .bind(final, partidoId)
      .run();

    for (let i = 0; i < 5; i += 1) await punto(admin, partidoId, local.jugadores[0]!.id);

    const arriba = await env.DB
      .prepare("SELECT equipo_a_nombre FROM partidos WHERE id = ?1")
      .bind(final)
      .first<{ equipo_a_nombre: string }>();
    expect(arriba!.equipo_a_nombre).toBe("Delfines");
  });
});
