import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { crearEquipo, crearUsuario } from "../helpers/db";

/*
 * La migración 0011 mueve el mando de equipos.owner_user_id a
 * equipos.capitan_jugador_id y hace opcional el móvil. Estos dos hechos son la
 * base de todo lo demás, así que se comprueban contra la base real.
 */
describe("esquema del capitán", () => {
  it("el equipo sembrado guarda a su capitán", async () => {
    const equipo = await crearEquipo({ jugadores: [{ email: "capi@example.com" }, {}] });

    const fila = await env.DB
      .prepare("SELECT capitan_jugador_id FROM equipos WHERE id = ?1")
      .bind(equipo.id)
      .first<{ capitan_jugador_id: number | null }>();

    expect(fila?.capitan_jugador_id).toBe(equipo.jugadores[0]!.id);
  });

  it("admite dos jugadores sin móvil en equipos distintos", async () => {
    await crearEquipo({ jugadores: [{ telefono: "" }, {}] });
    await expect(crearEquipo({ jugadores: [{ telefono: "" }, {}] })).resolves.toBeTruthy();
  });

  it("ya no existe la columna owner_user_id", async () => {
    const { results } = await env.DB.prepare("PRAGMA table_info(equipos)").all<{ name: string }>();
    expect(results.map((c) => c.name)).not.toContain("owner_user_id");
    expect(results.map((c) => c.name)).toContain("capitan_jugador_id");
  });

  it("borrar al capitán deja el equipo sin capitán en vez de fallar", async () => {
    const equipo = await crearEquipo();
    await env.DB.prepare("DELETE FROM jugadores WHERE id = ?1").bind(equipo.capitanId).run();

    const fila = await env.DB
      .prepare("SELECT capitan_jugador_id FROM equipos WHERE id = ?1")
      .bind(equipo.id)
      .first<{ capitan_jugador_id: number | null }>();

    expect(fila?.capitan_jugador_id).toBeNull();
  });

  it("una cuenta puede ser capitana de un equipo aunque otro la tuviera antes", async () => {
    const user = await crearUsuario({ email: "doble@example.com" });
    await crearEquipo({ jugadores: [{ email: "otro@example.com" }, {}] });
    await expect(
      crearEquipo({ jugadores: [{ email: user.email }, {}] })
    ).resolves.toBeTruthy();
  });
});
