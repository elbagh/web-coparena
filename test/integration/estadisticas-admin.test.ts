import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  onRequestGet as estadisticasGet,
  onRequestPatch as estadisticasPatch
} from "../../functions/api/admin/estadisticas";
import { onRequestGet as jugadoresGet } from "../../functions/api/jugadores";
import { ctx } from "../helpers/ctx";
import { crearAdmin, crearEquipo, crearUsuario, peticion } from "../helpers/db";

describe("/api/admin/estadisticas", () => {
  it("exige ser administrador", async () => {
    const user = await crearUsuario();

    expect((await estadisticasGet(ctx(await peticion("/api/admin/estadisticas"), env))).status).toBe(401);
    expect((await estadisticasGet(ctx(await peticion("/api/admin/estadisticas", { user }), env))).status).toBe(403);
    expect(
      (
        await estadisticasPatch(
          ctx(await peticion("/api/admin/estadisticas?jugador=1", { method: "PATCH", user, json: {} }), env)
        )
      ).status
    ).toBe(403);
  });

  it("lista la plantilla de la edición con sus métricas y atributos", async () => {
    const admin = await crearAdmin();
    await crearEquipo({ nombre: "Los Cañones", jugadores: [{ nombre: "Ana" }, { nombre: "Bea" }] });

    const respuesta = await estadisticasGet(ctx(await peticion("/api/admin/estadisticas", { user: admin }), env));
    expect(respuesta.status).toBe(200);

    const datos = (await respuesta.json()) as {
      metricas: { clave: string }[];
      atributos: string[];
      jugadores: { nombre: string; equipoNombre: string; estadisticas: Record<string, number> }[];
    };

    expect(datos.metricas.map((m) => m.clave)).toContain("puntos");
    expect(datos.atributos).toContain("saque");
    expect(datos.jugadores).toHaveLength(2);
    expect(datos.jugadores[0]!.equipoNombre).toBe("Los Cañones");
    expect(datos.jugadores[0]!.estadisticas.puntos).toBe(0);
  });

  it("guarda cifras y atributos, y repetir el guardado no duplica la carga manual", async () => {
    const admin = await crearAdmin();
    const equipo = await crearEquipo();
    const jugadorId = equipo.jugadores[0]!.id;
    const url = `/api/admin/estadisticas?jugador=${jugadorId}`;

    const primera = await estadisticasPatch(
      ctx(
        await peticion(url, {
          method: "PATCH",
          user: admin,
          json: { estadisticas: { puntos: 12, aces: 3 }, atributos: { saque: 4 } }
        }),
        env
      )
    );
    expect(primera.status).toBe(200);

    const segunda = await estadisticasPatch(
      ctx(
        await peticion(url, {
          method: "PATCH",
          user: admin,
          json: { estadisticas: { puntos: 20, aces: 3 }, atributos: { saque: 5, bloqueo: 2 } }
        }),
        env
      )
    );
    const datos = (await segunda.json()) as {
      jugador: { estadisticas: Record<string, number>; atributos: Record<string, number> };
    };

    expect(datos.jugador.estadisticas.puntos).toBe(20);
    expect(datos.jugador.atributos).toEqual({ saque: 5, bloqueo: 2 });

    const filas = await env.DB
      .prepare("SELECT COUNT(*) AS n FROM estadisticas WHERE jugador_id = ?1 AND partido_id IS NULL")
      .bind(jugadorId)
      .first<{ n: number }>();
    expect(filas!.n).toBe(1);
  });

  it("rechaza cifras y atributos fuera de rango", async () => {
    const admin = await crearAdmin();
    const equipo = await crearEquipo();
    const url = `/api/admin/estadisticas?jugador=${equipo.jugadores[0]!.id}`;

    const cifras = await estadisticasPatch(
      ctx(await peticion(url, { method: "PATCH", user: admin, json: { estadisticas: { puntos: -3 } } }), env)
    );
    expect(cifras.status).toBe(400);
    expect(((await cifras.json()) as { campos: Record<string, string> }).campos).toHaveProperty([
      "estadisticas.puntos"
    ]);

    const atributos = await estadisticasPatch(
      ctx(await peticion(url, { method: "PATCH", user: admin, json: { atributos: { saque: 9 } } }), env)
    );
    expect(atributos.status).toBe(400);
    expect(((await atributos.json()) as { campos: Record<string, string> }).campos).toHaveProperty([
      "atributos.saque"
    ]);
  });

  it("ocultar del álbum saca a la persona del listado público", async () => {
    const admin = await crearAdmin();
    const equipo = await crearEquipo({ jugadores: [{ nombre: "Ana" }, { nombre: "Bea" }] });

    await estadisticasPatch(
      ctx(
        await peticion(`/api/admin/estadisticas?jugador=${equipo.jugadores[0]!.id}`, {
          method: "PATCH",
          user: admin,
          json: { ocultoPublico: true }
        }),
        env
      )
    );

    const publico = await jugadoresGet(ctx(await peticion("/api/jugadores"), env));
    const datos = (await publico.json()) as { jugadores: { nombre: string }[] };
    expect(datos.jugadores.map((j) => j.nombre)).toEqual(["Bea"]);
  });

  it("404 si el jugador no existe", async () => {
    const admin = await crearAdmin();
    const respuesta = await estadisticasPatch(
      ctx(await peticion("/api/admin/estadisticas?jugador=99999", { method: "PATCH", user: admin, json: {} }), env)
    );
    expect(respuesta.status).toBe(404);
  });
});
