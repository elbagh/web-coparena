import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { onRequestGet as perfilGet, onRequestPatch as perfilPatch } from "../../functions/api/perfil";
import { ctx } from "../helpers/ctx";
import { crearAtributos, crearEquipo, crearEstadistica, crearUsuario, peticion } from "../helpers/db";

/*
 * Los atributos 1–5 dejaron de ser autovaloración: ahora los pone la
 * organización sobre el jugador de una edición. Mi zona los enseña, pero no
 * puede tocarlos, y este es el test que lo sujeta.
 */

describe("GET /api/perfil", () => {
  it("devuelve los atributos que puso la organización y las estadísticas de la edición", async () => {
    const user = await crearUsuario({ email: "capi@example.com" });
    const equipo = await crearEquipo({ jugadores: [{ email: user.email }, {}] });
    await crearAtributos(equipo.jugadores[0]!.id, { saque: 5, defensa: 3 });
    await crearEstadistica(equipo.jugadores[0]!.id, { puntos: 9, aces: 2 });

    const respuesta = await perfilGet(ctx(await peticion("/api/perfil", { user }), env));
    expect(respuesta.status).toBe(200);

    const datos = (await respuesta.json()) as {
      perfil: { atributos: Record<string, number> };
      historial: { estadisticas: Record<string, number> }[];
      carrera: Record<string, number>;
    };

    expect(datos.perfil.atributos).toEqual({ saque: 5, defensa: 3 });
    expect(datos.historial[0]!.estadisticas.puntos).toBe(9);
    expect(datos.carrera.aces).toBe(2);
  });
});

describe("PATCH /api/perfil", () => {
  it("guarda los campos propios de la ficha", async () => {
    const user = await crearUsuario();

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
      .prepare("SELECT apodo, dorsal FROM perfiles WHERE usuario_id = ?1")
      .bind(user.id)
      .first<{ apodo: string; dorsal: number }>();
    expect(guardado).toMatchObject({ apodo: "El Muro", dorsal: 7 });
  });

  it("ignora los atributos que se le manden", async () => {
    const user = await crearUsuario({ email: "listillo@example.com" });
    const equipo = await crearEquipo({ jugadores: [{ email: "listillo@example.com" }, {}] });
    await crearAtributos(equipo.jugadores[0]!.id, { saque: 2 });

    const respuesta = await perfilPatch(
      ctx(
        await peticion("/api/perfil", {
          method: "PATCH",
          user,
          json: { apodo: "El Crack", atributos: { saque: 5, remate: 5, bloqueo: 5 } }
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
    expect(JSON.parse(fila!.atributos)).toEqual({ saque: 2 });
  });
});
