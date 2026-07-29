import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { crearEquipo } from "../helpers/db";

/*
 * La regla de este proyecto: una estadística de juego sólo existe si cuelga de
 * un partido. Estos tests van contra la base directamente, sin pasar por ningún
 * endpoint, porque de eso se trata: la garantía no puede depender de que nadie
 * añada un INSERT nuevo.
 */
describe("el cerrojo de estadisticas", () => {
  it("la base rechaza una estadística sin partido", async () => {
    const equipo = await crearEquipo();

    await expect(
      env.DB
        .prepare("INSERT INTO estadisticas (jugador_id, partido_id, puntos) VALUES (?1, NULL, 5)")
        .bind(equipo.jugadores[0]!.id)
        .run()
    ).rejects.toThrow();
  });

  it("la tabla ya no tiene columna de partidos jugados", async () => {
    const columnas = await env.DB.prepare("SELECT name FROM pragma_table_info('estadisticas')").all<{
      name: string;
    }>();

    expect(columnas.results.map((c) => c.name)).not.toContain("partidos_jugados");
  });
});
