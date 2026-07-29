import { describe, expect, it } from "vitest";
import {
  estadisticasVacias,
  hayEstadisticas,
  mapEstadisticas,
  METRICAS,
  sumarTotales,
  SUMA_METRICAS
} from "../../functions/_lib/estadisticas";

describe("estadisticasVacias / mapEstadisticas", () => {
  it("arranca con todas las métricas a cero", () => {
    const vacias = estadisticasVacias();
    expect(Object.keys(vacias)).toEqual(METRICAS.map((m) => m.clave));
    expect(Object.values(vacias).every((v) => v === 0)).toBe(true);
  });

  it("traduce las columnas de la tabla a las claves de la API", () => {
    expect(mapEstadisticas({ partidos_jugados: 3, puntos: 12 })).toMatchObject({
      partidosJugados: 3,
      puntos: 12,
      aces: 0
    });
  });

  it("una fila ausente es todo ceros", () => {
    expect(mapEstadisticas(null)).toEqual(estadisticasVacias());
  });
});

describe("sumarTotales", () => {
  it("suma métrica a métrica", () => {
    const total = sumarTotales([
      { ...estadisticasVacias(), puntos: 10, aces: 2 },
      { ...estadisticasVacias(), puntos: 5, bloqueos: 4 }
    ]);
    expect(total.puntos).toBe(15);
    expect(total.aces).toBe(2);
    expect(total.bloqueos).toBe(4);
  });

  it("sin filas devuelve ceros", () => {
    expect(sumarTotales([])).toEqual(estadisticasVacias());
  });
});

describe("hayEstadisticas", () => {
  it("distingue una carga vacía de una con datos", () => {
    expect(hayEstadisticas(estadisticasVacias())).toBe(false);
    expect(hayEstadisticas({ ...estadisticasVacias(), aces: 1 })).toBe(true);
  });
});

describe("métricas derivadas", () => {
  it("los partidos jugados se cuentan, no se suman", () => {
    expect(SUMA_METRICAS).toContain("COUNT(DISTINCT e.partido_id) AS partidos_jugados");
    expect(SUMA_METRICAS).not.toContain("SUM(e.partidos_jugados)");
  });

  it("la derivada conserva su columna, que es el alias del COUNT", () => {
    const partidos = METRICAS.find((m) => m.clave === "partidosJugados")!;
    expect(partidos.derivada).toBe(true);
    expect(partidos.columna).toBe("partidos_jugados");
    expect(mapEstadisticas({ partidos_jugados: 3 }).partidosJugados).toBe(3);
  });
});
