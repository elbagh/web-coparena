import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestGet as jugadoresGet } from "../../functions/api/jugadores";
import { ctx } from "../helpers/ctx";
import {
  crearAtributos,
  crearEdicion,
  crearEquipo,
  crearEstadistica,
  crearPartido,
  crearUsuario,
  fijarNivel,
  ocultarJugador,
  peticion,
  sembrarFoto
} from "../helpers/db";

/*
 * El álbum público. Lo que se prueba aquí no es solo que pinte: es que **no**
 * filtre. El listado y la ficha se construyen a partir de la misma tabla que
 * guarda teléfonos y correos, así que la aserción importante es sobre el JSON
 * crudo.
 */

const cuerpoComoTexto = async (respuesta: Response) => new TextDecoder().decode(await respuesta.arrayBuffer());

describe("GET /api/jugadores (listado)", () => {
  it("devuelve solo los jugadores de la edición en juego", async () => {
    const pasada = await crearEdicion({ anio: 2025 });
    await crearEquipo({ nombre: "Los De Antes", edicionId: pasada.id, jugadores: [{ nombre: "Vieja" }, {}] });
    await crearEquipo({ nombre: "Los De Ahora", jugadores: [{ nombre: "Nueva" }, {}] });

    const respuesta = await jugadoresGet(ctx(await peticion("/api/jugadores"), env));
    expect(respuesta.status).toBe(200);

    const datos = (await respuesta.json()) as { edicion: { anio: number }; jugadores: { nombre: string }[] };
    expect(datos.edicion.anio).toBe(2026);
    expect(datos.jugadores).toHaveLength(2);
    expect(datos.jugadores.map((j) => j.nombre)).toContain("Nueva");
    expect(datos.jugadores.map((j) => j.nombre)).not.toContain("Vieja");
  });

  it("no incluye teléfonos ni correos en ninguna parte de la respuesta", async () => {
    await crearEquipo({
      jugadores: [
        { nombre: "Ana", telefono: "612345678", email: "ana@example.com" },
        { nombre: "Bea", telefono: "687654321", email: "bea@example.com" }
      ]
    });

    const respuesta = await jugadoresGet(ctx(await peticion("/api/jugadores"), env));
    const texto = await cuerpoComoTexto(respuesta);

    expect(texto).toContain("Ana");
    expect(texto).not.toContain("612345678");
    expect(texto).not.toContain("ana@example.com");
    expect(texto).not.toContain("telefono");
    expect(texto).not.toContain("email");
  });

  it("trae el metal y la nota, pero no los seis atributos", async () => {
    /*
     * La rejilla del álbum pinta un mini-cromo por persona: necesita el metal y
     * la nota, y con eso basta. Devolver además los seis atributos de cada uno
     * engordaría el endpoint público más golpeado para algo que solo se ve al
     * abrir la ficha.
     */
    const equipo = await crearEquipo({ jugadores: [{ nombre: "Dorada" }, { nombre: "Rasa" }] });
    await fijarNivel(equipo.jugadores[0]!.id, "oro");
    await crearAtributos(equipo.jugadores[0]!.id, { saque: 80, remate: 90 });

    const respuesta = await jugadoresGet(ctx(await peticion("/api/jugadores"), env));
    const datos = (await respuesta.json()) as {
      jugadores: { nombre: string; nivel: string; media: number | null; atributos?: unknown }[];
    };

    const dorada = datos.jugadores.find((j) => j.nombre === "Dorada")!;
    expect(dorada).toMatchObject({ nivel: "oro", media: 85 });
    expect(dorada.atributos).toBeUndefined();

    // Sin puntuar: bronce y sin nota. El cromo sale entonces sin cifra.
    expect(datos.jugadores.find((j) => j.nombre === "Rasa")).toMatchObject({ nivel: "bronce", media: null });
  });

  it("la ficha del cromo sale del jugador, no de la cuenta de Google", async () => {
    /*
     * Este test sembraba un `perfiles` con OTRO apodo para el mismo correo, para
     * demostrar que el álbum ya no cruzaba por correo. Desde la 0024 esa siembra
     * **no se puede escribir**: `perfiles` no tiene columna `apodo`. La garantía
     * dejó de depender de que ningún endpoint hiciera el join y pasó a ser del
     * esquema, que es donde mejor está — el mismo salto que hizo `estadisticas`
     * con `partido_id NOT NULL`.
     *
     * Lo que queda aquí es que la ficha llega entera desde `jugadores`; que
     * `perfiles` ya no puede contradecirla lo sujeta
     * `test/integration/perfiles-sin-ficha.test.ts`.
     */
    const user = await crearUsuario({ email: "doble@example.com" });
    const equipo = await crearEquipo({
      jugadores: [{ email: user.email, apodo: "El Del Jugador", dorsal: 7, posicion: "Bloqueo", mano: "Zurdo" }, {}]
    });

    const respuesta = await jugadoresGet(ctx(await peticion(`/api/jugadores?id=${equipo.jugadores[0]!.id}`), env));
    const datos = (await respuesta.json()) as { jugador: Record<string, unknown> };

    expect(datos.jugador).toMatchObject({
      apodo: "El Del Jugador",
      dorsal: 7,
      posicion: "Bloqueo",
      mano: "Zurdo"
    });
  });

  it("deja fuera a quien está oculto del álbum", async () => {
    const equipo = await crearEquipo({ jugadores: [{ nombre: "Visible" }, { nombre: "Discreta" }] });
    await ocultarJugador(equipo.jugadores[1]!.id);

    const respuesta = await jugadoresGet(ctx(await peticion("/api/jugadores"), env));
    const datos = (await respuesta.json()) as { jugadores: { nombre: string }[] };

    expect(datos.jugadores.map((j) => j.nombre)).toEqual(["Visible"]);
  });

  it("suma las cargas de varios partidos en los totales", async () => {
    const equipo = await crearEquipo();
    const jugadorId = equipo.jugadores[0]!.id;
    await crearEstadistica(jugadorId, await crearPartido(), { puntos: 10, aces: 2 });
    await crearEstadistica(jugadorId, await crearPartido(), { puntos: 5, aces: 1 });

    const respuesta = await jugadoresGet(ctx(await peticion("/api/jugadores"), env));
    const datos = (await respuesta.json()) as {
      jugadores: { id: number; estadisticas: Record<string, number> }[];
    };
    const jugador = datos.jugadores.find((j) => j.id === jugadorId)!;

    expect(jugador.estadisticas.puntos).toBe(15);
    expect(jugador.estadisticas.aces).toBe(3);
    expect(jugador.estadisticas.bloqueos).toBe(0);
    expect(jugador.estadisticas.partidosJugados).toBe(2);
  });
});

describe("GET /api/jugadores?id=N (ficha)", () => {
  it("reúne el historial de todas las ediciones de la misma persona", async () => {
    const pasada = await crearEdicion({ anio: 2025 });
    await crearEquipo({
      nombre: "Equipo Viejo",
      edicionId: pasada.id,
      posicionFinal: 1,
      jugadores: [{ nombre: "Iago", apellidos: "Garcia", email: "iago@example.com" }, {}]
    });
    const actual = await crearEquipo({
      nombre: "Equipo Nuevo",
      jugadores: [{ nombre: "Iago", apellidos: "Garcia", email: "iago@example.com" }, { nombre: "Compi" }]
    });

    const respuesta = await jugadoresGet(
      ctx(await peticion(`/api/jugadores?id=${actual.jugadores[0]!.id}`), env)
    );
    expect(respuesta.status).toBe(200);

    const datos = (await respuesta.json()) as {
      jugador: { nombre: string; equipoNombre: string };
      historial: { anio: number | null; equipoNombre: string; companeros: { nombre: string }[] }[];
      palmares: { edicionesJugadas: number; podios: { oro: number }; mejorPuesto: number | null };
    };

    expect(datos.jugador.equipoNombre).toBe("Equipo Nuevo");
    expect(datos.historial.map((h) => h.equipoNombre)).toEqual(["Equipo Nuevo", "Equipo Viejo"]);
    expect(datos.palmares.edicionesJugadas).toBe(2);
    expect(datos.palmares.podios.oro).toBe(1);
    expect(datos.palmares.mejorPuesto).toBe(1);
    expect(datos.historial[0]!.companeros.map((c) => c.nombre)).toEqual(["Compi"]);
  });

  it("devuelve los atributos que puso la organización, con su nota", async () => {
    const equipo = await crearEquipo();
    await crearAtributos(equipo.jugadores[0]!.id, { saque: 88, bloqueo: 40 });

    const respuesta = await jugadoresGet(ctx(await peticion(`/api/jugadores?id=${equipo.jugadores[0]!.id}`), env));
    const datos = (await respuesta.json()) as {
      jugador: { atributos: Record<string, number>; media: number | null };
    };

    expect(datos.jugador.atributos).toEqual({ saque: 88, bloqueo: 40 });
    // Media de lo puntuado, no de los seis: 64, no 21.
    expect(datos.jugador.media).toBe(64);
  });

  it("suma la carrera a partir de todas las ediciones", async () => {
    const pasada = await crearEdicion({ anio: 2025 });
    const vieja = await crearEquipo({
      edicionId: pasada.id,
      jugadores: [{ nombre: "Iago", apellidos: "Garcia", email: "iago@example.com" }, {}]
    });
    const nueva = await crearEquipo({
      jugadores: [{ nombre: "Iago", apellidos: "Garcia", email: "iago@example.com" }, {}]
    });
    await crearEstadistica(vieja.jugadores[0]!.id, await crearPartido(), { puntos: 7 });
    await crearEstadistica(nueva.jugadores[0]!.id, await crearPartido(), { puntos: 3 });

    const respuesta = await jugadoresGet(ctx(await peticion(`/api/jugadores?id=${nueva.jugadores[0]!.id}`), env));
    const datos = (await respuesta.json()) as { carrera: Record<string, number> };

    expect(datos.carrera.puntos).toBe(10);
  });

  it("responde 404 para quien está oculto y para un id inexistente", async () => {
    const equipo = await crearEquipo();
    await ocultarJugador(equipo.jugadores[0]!.id);

    const oculto = await jugadoresGet(ctx(await peticion(`/api/jugadores?id=${equipo.jugadores[0]!.id}`), env));
    expect(oculto.status).toBe(404);

    const inexistente = await jugadoresGet(ctx(await peticion("/api/jugadores?id=99999"), env));
    expect(inexistente.status).toBe(404);
  });
});

describe("GET /api/jugadores?foto=N", () => {
  it("sirve la foto de la inscripción, en público y cacheada", async () => {
    const equipo = await crearEquipo({
      jugadores: [{ fotoKey: await sembrarFoto("equipos/lote/jugador-1.jpg", "inscripcion") }, {}]
    });

    const respuesta = await jugadoresGet(ctx(await peticion(`/api/jugadores?foto=${equipo.jugadores[0]!.id}`), env));

    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("Content-Type")).toContain("image/");
    expect(respuesta.headers.get("Cache-Control")).toContain("public");
    expect(await cuerpoComoTexto(respuesta)).toBe("inscripcion");
  });

  it("cae al avatar de Mi zona cuando no hay foto de inscripción", async () => {
    /*
     * El avatar es lo ÚNICO de `perfiles` que sigue colgando de la cuenta, y por
     * eso el álbum conserva su enlace por correo aunque la ficha ya no lo use.
     * Si alguien quita ese join entero, este test y el de abajo son los que lo
     * cazan: quien solo tenga avatar pasaría a salir como «Sin cromo».
     */
    const user = await crearUsuario({ email: "conavatar@example.com" });
    await env.DB.prepare("INSERT INTO perfiles (usuario_id, avatar_key) VALUES (?1, ?2)")
      .bind(user.id, await sembrarFoto(`avatares/${user.id}.jpg`, "avatar"))
      .run();
    const equipo = await crearEquipo({ jugadores: [{ email: "conavatar@example.com" }, {}] });

    const respuesta = await jugadoresGet(ctx(await peticion(`/api/jugadores?foto=${equipo.jugadores[0]!.id}`), env));

    expect(respuesta.status).toBe(200);
    expect(await cuerpoComoTexto(respuesta)).toBe("avatar");
  });

  it("con solo avatar, el álbum sigue diciendo que tiene cromo", async () => {
    const user = await crearUsuario({ email: "soloavatar@example.com" });
    await env.DB.prepare("INSERT INTO perfiles (usuario_id, avatar_key) VALUES (?1, ?2)")
      .bind(user.id, await sembrarFoto(`avatares/${user.id}.jpg`, "avatar"))
      .run();
    await crearEquipo({ jugadores: [{ nombre: "Retratada", email: user.email }, { nombre: "Anonima" }] });

    const respuesta = await jugadoresGet(ctx(await peticion("/api/jugadores"), env));
    const datos = (await respuesta.json()) as { jugadores: { nombre: string; tieneFoto: boolean }[] };

    expect(datos.jugadores.find((j) => j.nombre === "Retratada")!.tieneFoto).toBe(true);
    expect(datos.jugadores.find((j) => j.nombre === "Anonima")!.tieneFoto).toBe(false);
  });

  it("responde 404 si no hay ninguna de las dos", async () => {
    const equipo = await crearEquipo();

    const respuesta = await jugadoresGet(ctx(await peticion(`/api/jugadores?foto=${equipo.jugadores[0]!.id}`), env));
    expect(respuesta.status).toBe(404);
  });

  it("no sirve la foto de quien está oculto", async () => {
    const equipo = await crearEquipo({
      jugadores: [{ fotoKey: await sembrarFoto("equipos/lote/jugador-1.jpg") }, {}]
    });
    await ocultarJugador(equipo.jugadores[0]!.id);

    const respuesta = await jugadoresGet(ctx(await peticion(`/api/jugadores?foto=${equipo.jugadores[0]!.id}`), env));
    expect(respuesta.status).toBe(404);
  });
});
