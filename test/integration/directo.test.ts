import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestGet } from "../../functions/api/directo";
import { ctx } from "../helpers/ctx";
import { crearEdicion, crearEquipo, crearPartido, peticion } from "../helpers/db";

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
