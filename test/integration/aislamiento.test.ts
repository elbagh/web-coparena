import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { crearEquipo } from "../helpers/db";

/*
 * La suite entera depende de que lo que escribe un test no llegue al siguiente:
 * los índices UNIQUE de equipos/jugadores son globales, así que sin aislamiento
 * el segundo test que siembre un equipo con el mismo nombre fallaría. Estos dos
 * tests lo comprueban a propósito usando el MISMO nombre.
 */

describe("aislamiento entre tests", () => {
  it("siembra un equipo llamado 'Los Testigos'", async () => {
    await crearEquipo({ nombre: "Los Testigos" });
    const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM equipos").first<{ n: number }>();
    expect(total?.n).toBe(1);
  });

  it("vuelve a sembrar el mismo nombre sin chocar con el test anterior", async () => {
    await crearEquipo({ nombre: "Los Testigos" });
    const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM equipos").first<{ n: number }>();
    expect(total?.n).toBe(1);
  });

  it("conserva el esquema y la edición sembrada por las migraciones", async () => {
    const edicion = await env.DB.prepare("SELECT anio FROM ediciones WHERE es_actual = 1").first<{ anio: number }>();
    expect(edicion?.anio).toBe(2026);
  });
});
