import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestGet as perfilGet, onRequestPatch as perfilPatch } from "../../functions/api/perfil";
import { ctx } from "../helpers/ctx";
import {
  crearAtributos,
  crearEdicion,
  crearEquipo,
  crearEstadistica,
  crearPartido,
  crearUsuario,
  peticion
} from "../helpers/db";

/*
 * Los atributos 1–99 dejaron de ser autovaloración: ahora los pone la
 * organización sobre el jugador de una edición. Mi zona los enseña, pero no
 * puede tocarlos, y este es el test que lo sujeta.
 *
 * Desde la 0022 lo mismo vale para la **ficha** (apodo, dorsal, posición, mano,
 * lema): es del jugador de una edición, no de la cuenta. Eso trae un caso que
 * antes no existía — quien no está en ninguna plantilla no tiene dónde
 * escribir — y por eso el PATCH tiene dos caminos.
 */

describe("GET /api/perfil", () => {
  it("devuelve los atributos que puso la organización y las estadísticas de la edición", async () => {
    const user = await crearUsuario({ email: "capi@example.com" });
    const equipo = await crearEquipo({ jugadores: [{ email: user.email }, {}] });
    await crearAtributos(equipo.jugadores[0]!.id, { saque: 88, defensa: 40 });
    await crearEstadistica(equipo.jugadores[0]!.id, await crearPartido(), { puntos: 9, aces: 2 });

    const respuesta = await perfilGet(ctx(await peticion("/api/perfil", { user }), env));
    expect(respuesta.status).toBe(200);

    const datos = (await respuesta.json()) as {
      perfil: { atributos: Record<string, number>; media: number | null };
      historial: { estadisticas: Record<string, number> }[];
      carrera: Record<string, number>;
    };

    expect(datos.perfil.atributos).toEqual({ saque: 88, defensa: 40 });
    expect(datos.perfil.media).toBe(64);
    expect(datos.historial[0]!.estadisticas.puntos).toBe(9);
    expect(datos.carrera.aces).toBe(2);
  });

  it("la ficha que enseña es la del jugador de la edición, no la de la cuenta", async () => {
    // Es lo que permite que la organización rellene el cromo de quien nunca ha
    // entrado, y que la ficha de un año no reescriba la de otro.
    const user = await crearUsuario({ email: "muro@example.com" });
    await crearEquipo({
      jugadores: [{ email: user.email, apodo: "El Muro", dorsal: 7, posicion: "Bloqueo", mano: "Zurdo" }, {}]
    });

    const respuesta = await perfilGet(ctx(await peticion("/api/perfil", { user }), env));
    const datos = (await respuesta.json()) as { perfil: Record<string, unknown> };

    expect(datos.perfil).toMatchObject({
      apodo: "El Muro",
      dorsal: 7,
      posicion: "Bloqueo",
      mano: "Zurdo",
      nivel: "bronce"
    });
  });
});

describe("PATCH /api/perfil", () => {
  it("guarda la ficha sobre el jugador de la edición en juego", async () => {
    const user = await crearUsuario({ email: "ficha@example.com" });
    const equipo = await crearEquipo({ jugadores: [{ email: user.email }, {}] });

    const respuesta = await perfilPatch(
      ctx(
        await peticion("/api/perfil", {
          method: "PATCH",
          user,
          json: { apodo: "El Muro", dorsal: 7, posicion: "Bloqueo", mano: "Zurdo", lema: "La red es mía" }
        }),
        env
      )
    );
    expect(respuesta.status).toBe(200);

    const guardado = await env.DB
      .prepare("SELECT apodo, dorsal, posicion, mano, lema FROM jugadores WHERE id = ?1")
      .bind(equipo.jugadores[0]!.id)
      .first<{ apodo: string; dorsal: number }>();
    expect(guardado).toMatchObject({
      apodo: "El Muro",
      dorsal: 7,
      posicion: "Bloqueo",
      mano: "Zurdo",
      lema: "La red es mía"
    });
  });

  it("no reescribe la ficha de ediciones pasadas", async () => {
    // Cambiar de apodo hoy no puede falsear el cromo del año pasado.
    const user = await crearUsuario({ email: "veterana@example.com" });
    const pasada = await crearEdicion({ anio: 2025 });
    const antiguo = await crearEquipo({
      edicionId: pasada.id,
      jugadores: [{ email: user.email, apodo: "La Novata" }, {}]
    });
    await crearEquipo({ jugadores: [{ email: user.email }, {}] });

    await perfilPatch(
      ctx(await peticion("/api/perfil", { method: "PATCH", user, json: { apodo: "La Veterana" } }), env)
    );

    const viejo = await env.DB
      .prepare("SELECT apodo FROM jugadores WHERE id = ?1")
      .bind(antiguo.jugadores[0]!.id)
      .first<{ apodo: string }>();
    expect(viejo!.apodo).toBe("La Novata");
  });

  it("sin inscripción no hay dónde escribir: 409", async () => {
    // Antes la ficha colgaba de la cuenta y siempre se podía guardar. Ahora es
    // del jugador de una edición, y una cuenta puede no tener ninguna.
    const user = await crearUsuario({ email: "sinequipo@example.com" });

    const respuesta = await perfilPatch(
      ctx(await peticion("/api/perfil", { method: "PATCH", user, json: { apodo: "Nadie" } }), env)
    );

    expect(respuesta.status).toBe(409);
    expect(((await respuesta.json()) as { error: string }).error).toMatch(/plantilla/i);
  });

  it("ignora los atributos que se le manden", async () => {
    const user = await crearUsuario({ email: "listillo@example.com" });
    const equipo = await crearEquipo({ jugadores: [{ email: "listillo@example.com" }, {}] });
    await crearAtributos(equipo.jugadores[0]!.id, { saque: 40 });

    const respuesta = await perfilPatch(
      ctx(
        await peticion("/api/perfil", {
          method: "PATCH",
          user,
          json: { apodo: "El Crack", atributos: { saque: 99, remate: 99, bloqueo: 99 } }
        }),
        env
      )
    );
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).not.toHaveProperty("perfil.atributos");

    const fila = await env.DB
      .prepare("SELECT atributos FROM jugador_atributos WHERE jugador_id = ?1")
      .bind(equipo.jugadores[0]!.id)
      .first<{ atributos: string }>();
    expect(JSON.parse(fila!.atributos)).toEqual({ saque: 40 });
  });

  it("tampoco se asciende a sí mismo el nivel del cromo", async () => {
    /*
     * Antes esto era gratis: el nivel no existía y los atributos estaban en
     * otra tabla. Ahora `nivel` es una columna de la MISMA fila que este PATCH
     * actualiza, que es justo cuando un `SET nivel = ?` se cuela por descuido.
     */
    const user = await crearUsuario({ email: "ambicioso@example.com" });
    const equipo = await crearEquipo({ jugadores: [{ email: user.email }, {}] });

    const respuesta = await perfilPatch(
      ctx(await peticion("/api/perfil", { method: "PATCH", user, json: { apodo: "Dorado", nivel: "oro" } }), env)
    );
    expect(respuesta.status).toBe(200);

    const fila = await env.DB
      .prepare("SELECT nivel, apodo FROM jugadores WHERE id = ?1")
      .bind(equipo.jugadores[0]!.id)
      .first<{ nivel: string; apodo: string }>();
    expect(fila).toMatchObject({ nivel: "bronce", apodo: "Dorado" });
  });
});
