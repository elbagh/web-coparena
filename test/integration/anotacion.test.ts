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
 *   - El saque fallado da el punto al RIVAL y suma a los saques fallados de quien
 *     lo comete, sin regalar puntos a nadie. Es la única acción cuyo punto cruza
 *     la red, y por eso la fila guarda los dos lados.
 *   - Mientras un anotador lleva el partido, el panel no puede tocar el
 *     marcador: si pudieran los dos, uno perdería en silencio.
 */

interface Respuesta {
  partido: { origenMarcador: string; status: string };
  estado: { puntos: { A: number; B: number }; sets: { A: number; B: number }; setNumero: number; winner: string | null };
  eventos: { orden: number; tipo: string; jugadorId: number | null; ladoPunto: string | null }[];
  siguienteOrden: number;
  alineacion: { jugador_id: number; lado: string }[];
  /** El marcador de las columnas planas, el que lleva el panel. */
  marcadorPanel: { puntos: { A: number; B: number }; sets: { A: number; B: number } };
  pendienteDeAdoptar: boolean;
  cambios: { id: number; trasOrden: number; lado: string; entra: number; sale: number; setNumero: number }[];
  error?: string;
}

const anotar = async (user: UsuarioSesion, partidoId: string, json: Record<string, unknown>) =>
  onRequestPost(ctx(await peticion(`/api/anotacion?partido=${partidoId}`, { method: "POST", user, json }), env));

const leer = async (user: UsuarioSesion, partidoId: string): Promise<Respuesta> => {
  const respuesta = await onRequestGet(ctx(await peticion(`/api/anotacion?partido=${partidoId}`, { user }), env));
  return (await respuesta.json()) as Respuesta;
};

const estadisticasDe = async (jugadorId: number) =>
  await env.DB
    .prepare("SELECT puntos, bloqueos, chilenas, aces, saques_fallados FROM estadisticas WHERE jugador_id = ?1")
    .bind(jugadorId)
    .first<Record<string, number>>();

/**
 * Un partido en juego con los dos equipos ya alineados. `extra` sirve para
 * sembrarlo con un marcador ya puesto a mano, que es el caso del cerrojo de
 * `MarcadorSinAdoptar`.
 */
async function montarPartido(
  user: UsuarioSesion,
  reglas?: unknown,
  extra: { puntosA?: number; puntosB?: number; setsA?: number; setsB?: number } = {}
) {
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
    ...extra,
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

/**
 * Manda una acción y devuelve la respuesta, leyendo antes el orden esperado.
 *
 * `gano` sólo viaja con los tipos que preguntan (bloqueo y chilena): mandarlo
 * siempre sería decidir por el servidor, y omitirlo con ellos es un 400.
 */
async function punto(
  user: UsuarioSesion,
  partidoId: string,
  jugadorId: number,
  tipo = "punto",
  gano?: boolean
): Promise<Response> {
  const { siguienteOrden } = await leer(user, partidoId);
  return anotar(user, partidoId, {
    accion: "evento",
    tipo,
    jugadorId,
    ordenEsperado: siguienteOrden,
    ...(gano === undefined ? {} : { punto: gano })
  });
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

    expect((await punto(admin, partidoId, local.jugadores[0]!.id, "punto")).status).toBe(201);

    const despues = await leer(admin, partidoId);
    expect(despues.estado.puntos).toEqual({ A: 1, B: 0 });
    expect(await estadisticasDe(local.jugadores[0]!.id)).toMatchObject({
      puntos: 1,
      aces: 0,
      bloqueos: 0,
      chilenas: 0,
      saques_fallados: 0
    });
  });

  it("cada tipo suma a su métrica", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montarPartido(admin);
    const ana = local.jugadores[0]!.id;

    await punto(admin, partidoId, ana, "punto");
    await punto(admin, partidoId, ana, "ace");
    await punto(admin, partidoId, ana, "bloqueo", true);
    await punto(admin, partidoId, ana, "chilena", false);

    expect(await estadisticasDe(ana)).toMatchObject({
      puntos: 3,
      aces: 1,
      bloqueos: 1,
      chilenas: 1
    });
    /*
     * Cuatro acciones y tres puntos: la chilena que no ganó el rally cuenta en
     * la ficha y no en el marcador. Es lo que ya no sabía decir un mapa fijo por
     * tipo, y lo que dice `lado_punto` fila a fila.
     */
    expect((await leer(admin, partidoId)).estado.puntos).toEqual({ A: 3, B: 0 });
  });

  /*
   * El invariante que justifica guardar dos lados en cada evento. Si esto se
   * tuerce, el marcador y las estadísticas quedan cruzados y no se ve hasta el
   * final del torneo.
   */
  it("un saque fallado de A da el punto a B y no suma puntos a quien lo falla", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montarPartido(admin);
    const ana = local.jugadores[0]!.id;

    await punto(admin, partidoId, ana, "saque_fallado");

    const despues = await leer(admin, partidoId);
    expect(despues.estado.puntos).toEqual({ A: 0, B: 1 });
    expect(await estadisticasDe(ana)).toMatchObject({ saques_fallados: 1, puntos: 0 });
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
      tipo: "punto",
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
      tipo: "punto",
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

    const cuerpo = { accion: "evento", tipo: "punto", jugadorId: ana, ordenEsperado: 0 };
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

    // Aquel primer punto no lo ganó Ana: falló el saque, y el punto era de B.
    await anotar(admin, partidoId, { accion: "corregir", orden: 0, tipo: "saque_fallado", jugadorId: ana });

    const despues = await leer(admin, partidoId);
    expect(despues.estado.winner).toBe("B");
    expect(await estadisticasDe(ana)).toMatchObject({ saques_fallados: 1, puntos: 4 });
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
    /*
     * Las cinco acciones, incluidas las dos que preguntan y una que dice que no:
     * si el recálculo se saltara `lado_punto` y volviera a decidir por el tipo,
     * la chilena de aquí abajo aparecería puntuando después del PATCH.
     */
    const acciones: { tipo: string; gano?: boolean }[] = [
      { tipo: "punto" },
      { tipo: "ace" },
      { tipo: "bloqueo", gano: true },
      { tipo: "saque_fallado" },
      { tipo: "chilena", gano: false }
    ];

    for (let i = 0; i < 24; i += 1) {
      const accion = acciones[i % acciones.length]!;
      await punto(admin, partidoId, jugadores[i % jugadores.length]!, accion.tipo, accion.gano);
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
    await punto(admin, partidoId, visitante.jugadores[0]!.id, "saque_fallado");
    await punto(admin, partidoId, local.jugadores[1]!.id, "bloqueo", true);

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

/*
 * El cerrojo del marcador de a mano.
 *
 * Sin él, el primer punto de un anotador que se incorpora a mitad BORRABA el
 * marcador que llevaba el panel: el pliegue reescribe las columnas planas, así
 * que un 8–6 con sets 1–1 pasaba a 1–0 en el primer set y de los puntos
 * anteriores no quedaba rastro. Y la pantalla no podía avisar porque el GET no
 * mandaba ese marcador: plegar un log vacío da 0–0, así que enseñaba 0–0 y
 * escondía el botón de adoptar justo en el único caso para el que existe.
 *
 * La decisión vive en el SERVIDOR a propósito. Si dependiera de la pantalla,
 * quien entra por la URL con el partido a medias seguiría vaciándolo.
 */
describe("un partido que viene con marcador a mano", () => {
  const aMano = { puntosA: 8, puntosB: 6, setsA: 1, setsB: 1 };

  it("el GET dice cuánto va por el panel y que hay que decidir", async () => {
    const admin = await crearAdmin();
    const { partidoId } = await montarPartido(admin, undefined, aMano);

    const respuesta = await leer(admin, partidoId);
    expect(respuesta.marcadorPanel).toEqual({ puntos: { A: 8, B: 6 }, sets: { A: 1, B: 1 } });
    expect(respuesta.pendienteDeAdoptar).toBe(true);
    // El plegado sigue siendo 0–0: eso es correcto, y es justo por lo que hace
    // falta el otro marcador al lado.
    expect(respuesta.estado.puntos).toEqual({ A: 0, B: 0 });
  });

  it("el primer punto se rechaza y no toca la fila", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montarPartido(admin, undefined, aMano);

    const respuesta = await punto(admin, partidoId, local.jugadores[0]!.id);
    expect(respuesta.status).toBe(409);
    const cuerpo = (await respuesta.json()) as Respuesta;
    expect(cuerpo.error).toContain("8–6");
    expect(cuerpo.marcadorPanel).toEqual({ puntos: { A: 8, B: 6 }, sets: { A: 1, B: 1 } });

    const fila = await env.DB
      .prepare("SELECT points_a, points_b, sets_a, sets_b, origen_marcador FROM partidos WHERE id = ?1")
      .bind(partidoId)
      .first<Record<string, unknown>>();
    expect(fila).toMatchObject({ points_a: 8, points_b: 6, sets_a: 1, sets_b: 1, origen_marcador: "manual" });
    const eventos = await env.DB.prepare("SELECT COUNT(*) AS n FROM partido_eventos").first<{ n: number }>();
    expect(eventos!.n).toBe(0);
  });

  it("adoptándolo se sigue desde el 8–6", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montarPartido(admin, undefined, aMano);

    expect((await anotar(admin, partidoId, { accion: "adoptar" })).status).toBe(201);
    expect((await punto(admin, partidoId, local.jugadores[0]!.id)).status).toBe(201);

    const despues = await leer(admin, partidoId);
    expect(despues.estado.puntos).toEqual({ A: 9, B: 6 });
    expect(despues.estado.sets).toEqual({ A: 1, B: 1 });
    expect(despues.pendienteDeAdoptar).toBe(false);
  });

  /*
   * La otra salida: el marcador de a mano no sirve y se empieza de cero. Sigue
   * siendo un `ajuste` y no un borrado, para que en el log quede dicho que ahí
   * se puso a cero, quién y cuándo.
   */
  it("o se pone a cero, y queda dicho en el log", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montarPartido(admin, undefined, aMano);

    expect((await anotar(admin, partidoId, { accion: "adoptar", desdeCero: true })).status).toBe(201);

    const tras = await leer(admin, partidoId);
    expect(tras.estado.puntos).toEqual({ A: 0, B: 0 });
    expect(tras.estado.sets).toEqual({ A: 0, B: 0 });
    expect(tras.eventos.map((e) => e.tipo)).toEqual(["ajuste"]);
    expect(tras.marcadorPanel).toEqual({ puntos: { A: 0, B: 0 }, sets: { A: 0, B: 0 } });

    // El ajuste no es de nadie, así que no genera estadísticas.
    const cuantas = await env.DB.prepare("SELECT COUNT(*) AS n FROM estadisticas").first<{ n: number }>();
    expect(cuantas!.n).toBe(0);

    expect((await punto(admin, partidoId, local.jugadores[0]!.id)).status).toBe(201);
    expect((await leer(admin, partidoId)).estado.puntos).toEqual({ A: 1, B: 0 });
  });

  /*
   * Soltar la anotación deja `origen_marcador = 'manual'` con el log intacto. Al
   * volver a anotar no hay nada que decidir: esos puntos ya están atribuidos, y
   * un cerrojo aquí dejaría el partido inanotable para siempre.
   */
  it("volver a coger un partido ya anotado no pide decidir nada", async () => {
    const admin = await crearAdmin();
    const { partidoId, local } = await montarPartido(admin);
    await punto(admin, partidoId, local.jugadores[0]!.id);
    await anotar(admin, partidoId, { accion: "soltar" });

    expect((await leer(admin, partidoId)).pendienteDeAdoptar).toBe(false);
    expect((await punto(admin, partidoId, local.jugadores[1]!.id)).status).toBe(201);
    expect((await leer(admin, partidoId)).estado.puntos).toEqual({ A: 2, B: 0 });
  });
});

/*
 * Los cambios de jugador.
 *
 * Viven en `partido_cambios`, fuera del log de puntos, porque un cambio no es un
 * punto: no pliega, no puntúa y no genera estadísticas. Lo único que comparte
 * con los puntos es el sitio en el historial del directo, y eso es lo que ancla
 * `tras_orden`.
 */
describe("cambios de jugador", () => {
  /** Como montarPartido, pero el equipo local trae un suplente en el banquillo. */
  async function conBanquillo(user: UsuarioSesion) {
    const local = await crearEquipo({
      nombre: "Delfines",
      jugadores: [{ nombre: "Ana" }, { nombre: "Berta" }, { nombre: "Celia" }]
    });
    const visitante = await crearEquipo({
      nombre: "Gaviotas",
      jugadores: [{ nombre: "Carla" }, { nombre: "Diana" }]
    });
    const partidoId = await crearPartido({ equipoA: local, equipoB: visitante, status: "live" });

    const titulares = [local.jugadores[0]!.id, local.jugadores[1]!.id];
    await anotar(user, partidoId, { accion: "alineacion", lado: "A", jugadorIds: titulares });
    await anotar(user, partidoId, {
      accion: "alineacion",
      lado: "B",
      jugadorIds: visitante.jugadores.map((j) => j.id)
    });

    return { partidoId, local, visitante, suplente: local.jugadores[2]!, titular: local.jugadores[1]! };
  }

  const enPista = async (partidoId: string) =>
    (
      await env.DB
        .prepare("SELECT jugador_id, lado, orden FROM partido_alineacion WHERE partido_id = ?1 ORDER BY lado, orden")
        .bind(partidoId)
        .all<{ jugador_id: number; lado: string; orden: number }>()
    ).results;

  it("el suplente entra y hereda el hueco del que sale", async () => {
    const admin = await crearAdmin();
    const { partidoId, suplente, titular } = await conBanquillo(admin);
    const huecoAntes = (await enPista(partidoId)).find((f) => f.jugador_id === titular.id)!.orden;

    const respuesta = await anotar(admin, partidoId, {
      accion: "cambio",
      entra: suplente.id,
      sale: titular.id
    });
    expect(respuesta.status).toBe(201);

    const pista = await enPista(partidoId);
    expect(pista.map((f) => f.jugador_id)).toContain(suplente.id);
    expect(pista.map((f) => f.jugador_id)).not.toContain(titular.id);
    // El hueco es el mismo: en la pantalla, el retrato no salta de sitio.
    expect(pista.find((f) => f.jugador_id === suplente.id)!.orden).toBe(huecoAntes);

    const cambios = (await leer(admin, partidoId)).cambios;
    expect(cambios).toHaveLength(1);
    expect(cambios[0]).toMatchObject({ entra: suplente.id, sale: titular.id, lado: "A", setNumero: 1 });
  });

  /*
   * El ancla del historial. Un cambio cae detrás del último punto anotado, así
   * que el directo puede intercalarlo entre los puntos sin guardar una hora.
   */
  it("queda anclado detrás del punto que se acababa de anotar", async () => {
    const admin = await crearAdmin();
    const { partidoId, local, suplente, titular } = await conBanquillo(admin);

    await punto(admin, partidoId, local.jugadores[0]!.id);
    await punto(admin, partidoId, local.jugadores[0]!.id);
    await anotar(admin, partidoId, { accion: "cambio", entra: suplente.id, sale: titular.id });

    expect((await leer(admin, partidoId)).cambios[0]!.trasOrden).toBe(1);
  });

  it("no mueve el marcador ni escribe una sola estadística", async () => {
    const admin = await crearAdmin();
    const { partidoId, local, suplente, titular } = await conBanquillo(admin);
    await punto(admin, partidoId, local.jugadores[0]!.id);

    const antes = await leer(admin, partidoId);
    await anotar(admin, partidoId, { accion: "cambio", entra: suplente.id, sale: titular.id });
    const despues = await leer(admin, partidoId);

    expect(despues.estado.puntos).toEqual(antes.estado.puntos);
    expect(despues.estado.sets).toEqual(antes.estado.sets);
    expect(despues.eventos).toHaveLength(antes.eventos.length);
    expect(await estadisticasDe(suplente.id)).toBe(null);
  });

  it("el que sale deja de poder recibir puntos, y el que entra puede", async () => {
    const admin = await crearAdmin();
    const { partidoId, suplente, titular } = await conBanquillo(admin);
    await anotar(admin, partidoId, { accion: "cambio", entra: suplente.id, sale: titular.id });

    expect((await punto(admin, partidoId, titular.id)).status).toBe(400);
    expect((await punto(admin, partidoId, suplente.id)).status).toBe(201);
  });

  it("no entra alguien de otro equipo", async () => {
    const admin = await crearAdmin();
    const { partidoId, visitante, titular } = await conBanquillo(admin);

    const respuesta = await anotar(admin, partidoId, {
      accion: "cambio",
      entra: visitante.jugadores[0]!.id,
      sale: titular.id
    });
    expect(respuesta.status).toBe(400);
  });

  it("no sale quien no está en pista", async () => {
    const admin = await crearAdmin();
    const { partidoId, suplente } = await conBanquillo(admin);

    // El suplente no está en pista: no puede ser el que sale.
    expect((await anotar(admin, partidoId, { accion: "cambio", entra: suplente.id, sale: suplente.id })).status).toBe(
      409
    );
  });

  it("no entra quien ya está en pista", async () => {
    const admin = await crearAdmin();
    const { partidoId, local, titular } = await conBanquillo(admin);

    expect(
      (await anotar(admin, partidoId, { accion: "cambio", entra: local.jugadores[0]!.id, sale: titular.id })).status
    ).toBe(409);
  });

  it("deshacer devuelve la pista exactamente como estaba", async () => {
    const admin = await crearAdmin();
    const { partidoId, suplente, titular } = await conBanquillo(admin);
    const antes = await enPista(partidoId);

    await anotar(admin, partidoId, { accion: "cambio", entra: suplente.id, sale: titular.id });
    expect((await anotar(admin, partidoId, { accion: "cambio-deshacer" })).status).toBe(200);

    expect(await enPista(partidoId)).toEqual(antes);
    expect((await leer(admin, partidoId)).cambios).toHaveLength(0);
  });

  /*
   * Solo se deshace el último, igual que con los puntos: deshacer el penúltimo
   * dejaría la pista en una alineación que no existió nunca.
   */
  it("no deshace un cambio que otro posterior ya pisó", async () => {
    const admin = await crearAdmin();
    const { partidoId, local, suplente, titular } = await conBanquillo(admin);

    await anotar(admin, partidoId, { accion: "cambio", entra: suplente.id, sale: titular.id });
    // Ahora sale el suplente que acababa de entrar y vuelve el titular.
    await anotar(admin, partidoId, { accion: "cambio", entra: titular.id, sale: suplente.id });
    // Deshacer el último es legítimo; el de antes ya no.
    expect((await anotar(admin, partidoId, { accion: "cambio-deshacer" })).status).toBe(200);
    await anotar(admin, partidoId, { accion: "cambio", entra: local.jugadores[0]!.id, sale: suplente.id });

    expect((await anotar(admin, partidoId, { accion: "cambio-deshacer" })).status).toBe(200);
  });

  /*
   * Rehacer la alineación a mano no borra los cambios que sí ocurrieron: sería
   * borrar historia para dejar una pantalla ordenada.
   */
  it("fijar la alineación entera no borra el historial de cambios", async () => {
    const admin = await crearAdmin();
    const { partidoId, local, suplente, titular } = await conBanquillo(admin);
    await anotar(admin, partidoId, { accion: "cambio", entra: suplente.id, sale: titular.id });

    await anotar(admin, partidoId, {
      accion: "alineacion",
      lado: "A",
      jugadorIds: [local.jugadores[0]!.id, titular.id]
    });

    expect((await leer(admin, partidoId)).cambios).toHaveLength(1);
  });

  /*
   * Sin esto, en cuanto hay un cambio deja de poderse corregir un punto hacia
   * quien salió de pista — que es justo cuando hace falta («ese remate fue de
   * Berta, no de Celia»).
   */
  it("se puede corregir un punto hacia quien ya salió de pista", async () => {
    const admin = await crearAdmin();
    const { partidoId, local, suplente, titular } = await conBanquillo(admin);
    await punto(admin, partidoId, titular.id);
    await anotar(admin, partidoId, { accion: "cambio", entra: suplente.id, sale: titular.id });
    await punto(admin, partidoId, suplente.id);

    const respuesta = await anotar(admin, partidoId, { accion: "corregir", orden: 1, jugadorId: titular.id });
    expect(respuesta.status).toBe(200);

    expect(await estadisticasDe(titular.id)).toMatchObject({ puntos: 2 });
    expect(await estadisticasDe(suplente.id)).toBe(null);
    expect((await leer(admin, partidoId)).estado.puntos).toEqual({ A: 2, B: 0 });
    // Y quien no ha pisado el partido sigue sin poder recibir puntos.
    expect(
      (await anotar(admin, partidoId, { accion: "corregir", orden: 1, jugadorId: local.jugadores[0]!.id + 999 }))
        .status
    ).toBe(409);
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
