import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestGet } from "../../functions/api/directo";
import { ctx } from "../helpers/ctx";
import { crearAdmin, crearEdicion, crearEquipo, crearPartido, peticion } from "../helpers/db";

/*
 * /api/directo es el único endpoint que sondea todo el mundo a la vez, así que
 * es el único que puede agotar la cuota de peticiones de Cloudflare justo el día
 * que más gente mira. Lo que se prueba aquí es lo que sostiene ese presupuesto:
 * que el ETag corta de verdad, que la versión cambia con cada punto, y que la
 * cadencia la manda el servidor.
 */

interface Estado {
  hayDirecto: boolean;
  partidos: { id: string; ronda: string; points: { A: number; B: number }; teams: { A: { name: string } } }[];
  enPista: { A: number[]; B: number[] } | null;
  feed: { o: number; c?: number; t: string; j?: number | null; x?: number; l?: string | null; s: number }[];
  feedTotal: number;
  siguiente: { ronda: string; equipos: [string, string] } | null;
  siguienteSondeoMs: number;
  modoAhorro: boolean;
}

const pedir = async (etag?: string) => {
  const request = await peticion("/api/directo", { headers: etag ? { "If-None-Match": etag } : {} });
  return onRequestGet(ctx(request, env));
};

const leer = async (): Promise<{ estado: Estado; etag: string }> => {
  const respuesta = await pedir();
  return { estado: (await respuesta.json()) as Estado, etag: respuesta.headers.get("ETag")! };
};

const ponerEnJuego = async (id: string, puntosA = 0) => {
  await env.DB
    .prepare("UPDATE partidos SET status = 'live', points_a = ?1, updated_at = ?2 WHERE id = ?3")
    .bind(puntosA, new Date().toISOString(), id)
    .run();
};

describe("es público y minúsculo", () => {
  it("responde 200 sin ninguna sesión", async () => {
    const respuesta = await pedir();
    expect(respuesta.status).toBe(200);
  });

  it("sin nadie jugando dice que no hay directo", async () => {
    const { estado } = await leer();
    expect(estado.hayDirecto).toBe(false);
    expect(estado.partidos).toEqual([]);
  });

  it("enseña el partido en juego con su marcador", async () => {
    const a = await crearEquipo({ nombre: "Delfines" });
    const b = await crearEquipo({ nombre: "Gaviotas" });
    const id = await crearPartido({ ronda: "Final", equipoA: a, equipoB: b });
    await ponerEnJuego(id, 12);

    const { estado } = await leer();
    expect(estado.hayDirecto).toBe(true);
    expect(estado.partidos).toHaveLength(1);
    expect(estado.partidos[0]).toMatchObject({ ronda: "Final", points: { A: 12, B: 0 } });
    expect(estado.partidos[0]!.teams.A.name).toBe("Delfines");
  });

  // Sirve para que el botón del nav diga algo cuando no hay nadie en pista.
  it("dice cuál es el siguiente en empezar", async () => {
    const id = await crearPartido({ ronda: "Semifinal" });
    await env.DB
      .prepare("UPDATE partidos SET scheduled_at = '2026-08-01T10:00' WHERE id = ?1")
      .bind(id)
      .run();

    const { estado } = await leer();
    expect(estado.siguiente).toMatchObject({ ronda: "Semifinal" });
  });

  // El cuadro es de la edición que se juega, y el directo también.
  it("no mira los partidos de otra edición", async () => {
    const vieja = await crearEdicion({ anio: 2025 });
    const id = await crearPartido({ edicionId: vieja.id });
    await ponerEnJuego(id);

    expect((await leer()).estado.hayDirecto).toBe(false);
  });
});

/*
 * El ETag no ahorra peticiones —un 304 cuenta igual que un 200— pero sí ahorra
 * ancho de banda y lecturas de D1: sin cuerpo que construir, la petición se
 * resuelve con una sola fila agregada.
 */
describe("ETag", () => {
  it("devuelve 304 sin cuerpo cuando nada ha cambiado", async () => {
    const id = await crearPartido();
    await ponerEnJuego(id, 5);

    const { etag } = await leer();
    const repetida = await pedir(etag);

    expect(repetida.status).toBe(304);
    expect(await repetida.text()).toBe("");
    expect(repetida.headers.get("ETag")).toBe(etag);
  });

  it("un punto nuevo cambia la versión", async () => {
    const id = await crearPartido();
    await ponerEnJuego(id, 5);
    const primero = (await leer()).etag;

    await ponerEnJuego(id, 6);
    const segundo = (await leer()).etag;

    expect(segundo).not.toBe(primero);
    expect((await pedir(primero)).status).toBe(200);
  });

  /*
   * Dos escrituras dentro del mismo milisegundo darían el mismo `updated_at`.
   * Por eso la versión lleva también el marcador sumado: un punto que no cambia
   * la versión es un punto que el espectador nunca ve.
   */
  it("cambia aunque updated_at no se mueva", async () => {
    const id = await crearPartido();
    const congelado = "2026-07-29T10:00:00.000Z";
    await env.DB
      .prepare("UPDATE partidos SET status = 'live', points_a = 5, updated_at = ?1 WHERE id = ?2")
      .bind(congelado, id)
      .run();
    const primero = (await leer()).etag;

    await env.DB
      .prepare("UPDATE partidos SET points_a = 6, updated_at = ?1 WHERE id = ?2")
      .bind(congelado, id)
      .run();

    expect((await leer()).etag).not.toBe(primero);
  });

  it("empezar un partido cambia la versión aunque no haya puntos", async () => {
    const id = await crearPartido();
    const primero = (await leer()).etag;
    await ponerEnJuego(id, 0);

    expect((await leer()).etag).not.toBe(primero);
  });

  it("un If-None-Match con varios valores acierta si alguno coincide", async () => {
    const { etag } = await leer();
    expect((await pedir(`W/"otro", ${etag}`)).status).toBe(304);
  });
});

/*
 * La válvula de emergencia: subir la cadencia desde el panel frena a todos los
 * espectadores al siguiente sondeo, sin desplegar nada. Si el cliente pudiera
 * elegir su propio intervalo, no habría forma de frenar nada en mitad de la
 * jornada.
 */
describe("la cadencia la manda el servidor", () => {
  const ajustar = async (clave: string, valor: string) => {
    await env.DB
      .prepare("INSERT INTO ajustes (clave, valor) VALUES (?1, ?2) ON CONFLICT(clave) DO UPDATE SET valor = ?2")
      .bind(clave, valor)
      .run();
  };

  it("con partido en vivo manda la cadencia rápida", async () => {
    const id = await crearPartido();
    await ponerEnJuego(id);
    expect((await leer()).estado.siguienteSondeoMs).toBe(3000);
  });

  it("sin nadie jugando manda la lenta: no hay nada que refrescar", async () => {
    expect((await leer()).estado.siguienteSondeoMs).toBe(60000);
  });

  it("cambiar el ajuste cambia lo que se le dice al cliente", async () => {
    const id = await crearPartido();
    await ponerEnJuego(id);
    await ajustar("directo_sondeo_ms", "20000");

    expect((await leer()).estado.siguienteSondeoMs).toBe(20000);
  });

  it("el modo ahorro viaja al cliente", async () => {
    await ajustar("directo_modo_ahorro", "1");
    expect((await leer()).estado.modoAhorro).toBe(true);
  });

  // Por debajo de un segundo el sondeo deja de ser sondeo.
  it("un valor absurdo se descarta en vez de colarse", async () => {
    const id = await crearPartido();
    await ponerEnJuego(id);
    await ajustar("directo_sondeo_ms", "10");

    expect((await leer()).estado.siguienteSondeoMs).toBe(3000);
  });
});

/*
 * El versus y el historial.
 *
 * Lo que se blinda aquí es el fallo silencioso: si el payload crece y la versión
 * no lo cubre, el espectador recibe un 304 con el cuerpo viejo — el marcador
 * congelado, sin error y sin nada que lo diga. De ahí que haya un test por cada
 * escritura que NO mueve el marcador.
 */
describe("el versus y el historial", () => {
  /** Un partido en juego con dos jugadores por lado ya alineados. */
  async function enJuegoConGente() {
    const a = await crearEquipo({ nombre: "Delfines", jugadores: [{ nombre: "Ana" }, { nombre: "Berta" }] });
    const b = await crearEquipo({ nombre: "Gaviotas", jugadores: [{ nombre: "Carla" }, { nombre: "Diana" }] });
    const id = await crearPartido({ ronda: "Final", equipoA: a, equipoB: b });
    await ponerEnJuego(id);

    const alinear = (jugadores: { id: number }[], lado: string) =>
      env.DB.batch(
        jugadores.map((jugador, indice) =>
          env.DB
            .prepare("INSERT INTO partido_alineacion (partido_id, jugador_id, lado, orden) VALUES (?1, ?2, ?3, ?4)")
            .bind(id, jugador.id, lado, indice)
        )
      );
    await alinear(a.jugadores, "A");
    await alinear(b.jugadores, "B");

    return { id, a, b };
  }

  const anotarEvento = async (
    partidoId: string,
    orden: number,
    jugadorId: number,
    lado: string,
    tipo = "punto",
    setNumero = 1
  ) => {
    await env.DB
      .prepare(
        `INSERT INTO partido_eventos (partido_id, orden, set_numero, tipo, lado_jugador, jugador_id, lado_punto)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
      )
      .bind(
        partidoId,
        orden,
        setNumero,
        tipo,
        lado,
        jugadorId,
        // El saque fallado es el único cuyo punto cruza la red.
        tipo === "saque_fallado" ? (lado === "A" ? "B" : "A") : lado
      )
      .run();
    await env.DB.prepare("UPDATE partidos SET log_version = log_version + 1 WHERE id = ?1").bind(partidoId).run();
  };

  it("dice quién está en pista, por lado y en orden", async () => {
    const { a, b } = await enJuegoConGente();

    const { estado } = await leer();
    expect(estado.enPista).toEqual({
      A: a.jugadores.map((j) => j.id),
      B: b.jugadores.map((j) => j.id)
    });
  });

  it("sin nadie jugando no hay ni versus ni historial", async () => {
    const { estado } = await leer();
    expect(estado.enPista).toBe(null);
    expect(estado.feed).toEqual([]);
    expect(estado.feedTotal).toBe(0);
  });

  it("el historial trae los puntos, sin un solo nombre", async () => {
    const { id, a } = await enJuegoConGente();
    await anotarEvento(id, 0, a.jugadores[0]!.id, "A");
    await anotarEvento(id, 1, a.jugadores[1]!.id, "A", "saque_fallado");

    const { estado } = await leer();
    expect(estado.feed).toHaveLength(2);
    expect(estado.feed[0]).toMatchObject({ o: 0, t: "punto", j: a.jugadores[0]!.id, l: "A", s: 1 });
    // El saque fallado cruza la red: quien lo hace es de A y el punto es de B.
    expect(estado.feed[1]).toMatchObject({ o: 1, t: "saque_fallado", l: "A" });
    expect(JSON.stringify(estado.feed)).not.toContain("Ana");
  });

  it("la ventana acota el historial pero dice cuántos hay en total", async () => {
    const { id, a } = await enJuegoConGente();
    for (let orden = 0; orden < 45; orden++) {
      await anotarEvento(id, orden, a.jugadores[0]!.id, "A");
    }

    const { estado } = await leer();
    expect(estado.feed).toHaveLength(30);
    expect(estado.feed[0]!.o).toBe(15);
    expect(estado.feedTotal).toBe(45);
  });

  it("un cambio de jugador sale anclado detrás de su punto", async () => {
    const { id, a } = await enJuegoConGente();
    await anotarEvento(id, 0, a.jugadores[0]!.id, "A");
    await env.DB
      .prepare(
        `INSERT INTO partido_cambios
           (partido_id, tras_orden, lado, entra_jugador_id, sale_jugador_id, posicion, set_numero)
         VALUES (?1, 0, 'A', ?2, ?3, 0, 1)`
      )
      .bind(id, a.jugadores[1]!.id, a.jugadores[0]!.id)
      .run();
    await anotarEvento(id, 1, a.jugadores[1]!.id, "A");

    const { estado } = await leer();
    expect(estado.feed.map((linea) => linea.t)).toEqual(["punto", "cambio", "punto"]);
    expect(estado.feed[1]).toMatchObject({ o: 0, t: "cambio", j: a.jugadores[1]!.id, x: a.jugadores[0]!.id });
  });
});

/*
 * Los tres agujeros del ETag. Cada uno es una escritura que no toca el marcador
 * y que, antes de `partidos.log_version`, dejaba al espectador con el cuerpo
 * viejo y un 304 encima.
 */
describe("el ETag cubre lo que no es el marcador", () => {
  it("cambia al fijar la alineación", async () => {
    const a = await crearEquipo({ nombre: "Delfines", jugadores: [{ nombre: "Ana" }] });
    const id = await crearPartido({ equipoA: a });
    await ponerEnJuego(id);
    const { etag } = await leer();

    const { fijarAlineacion } = await import("../../functions/_lib/eventos");
    await fijarAlineacion(env.DB, id, "A", [a.jugadores[0]!.id]);

    expect((await pedir(etag)).status).toBe(200);
  });

  it("cambia al registrar un cambio de jugador", async () => {
    const a = await crearEquipo({ nombre: "Delfines", jugadores: [{ nombre: "Ana" }, { nombre: "Berta" }] });
    const id = await crearPartido({ equipoA: a });
    await ponerEnJuego(id);

    const { fijarAlineacion, registrarCambio } = await import("../../functions/_lib/eventos");
    await fijarAlineacion(env.DB, id, "A", [a.jugadores[0]!.id]);
    const { etag } = await leer();

    const partido = await env.DB
      .prepare(
        `SELECT id, status, origen_marcador, equipo_a_id, equipo_b_id, points_a, points_b,
                sets_a, sets_b, reglas, started_at, elapsed_ms
           FROM partidos WHERE id = ?1`
      )
      .bind(id)
      .first<Parameters<typeof registrarCambio>[1]>();
    // El cambio guarda quién lo hizo, así que hace falta un usuario de verdad.
    const anotador = await crearAdmin();
    await registrarCambio(env.DB, partido!, a.jugadores[1]!.id, a.jugadores[0]!.id, anotador.id);

    expect((await pedir(etag)).status).toBe(200);
  });

  /*
   * Un bloqueo que no ganó el rally no mueve el marcador sumado; antes solo la
   * salvaba `updated_at`, y dos escrituras en el mismo milisegundo dan la misma
   * marca.
   */
  it("cambia con un evento que no puntúa", async () => {
    const a = await crearEquipo({ nombre: "Delfines", jugadores: [{ nombre: "Ana" }] });
    const id = await crearPartido({ equipoA: a });
    await ponerEnJuego(id);
    const { etag } = await leer();

    await env.DB
      .prepare(
        `INSERT INTO partido_eventos (partido_id, orden, set_numero, tipo, lado_jugador, jugador_id, lado_punto)
         VALUES (?1, 0, 1, 'bloqueo', 'A', ?2, NULL)`
      )
      .bind(id, a.jugadores[0]!.id)
      .run();
    await env.DB
      .prepare("UPDATE partidos SET log_version = log_version + 1, updated_at = updated_at WHERE id = ?1")
      .bind(id)
      .run();

    expect((await pedir(etag)).status).toBe(200);
  });
});
