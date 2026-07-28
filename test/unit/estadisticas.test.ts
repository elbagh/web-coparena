import { describe, expect, it } from "vitest";
import {
  estadisticasVacias,
  hayEstadisticas,
  mapEstadisticas,
  MAX_METRICA,
  METRICAS,
  sumarTotales,
  validarEstadisticas
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

describe("validarEstadisticas", () => {
  it("acepta enteros dentro de rango y rellena el resto a cero", () => {
    const resultado = validarEstadisticas({ puntos: 12, aces: "3" });
    expect(resultado).toEqual({ estadisticas: { ...estadisticasVacias(), puntos: 12, aces: 3 } });
  });

  it("ignora los campos vacíos en vez de tratarlos como error", () => {
    const resultado = validarEstadisticas({ puntos: "", aces: null, bloqueos: undefined });
    expect(resultado).toEqual({ estadisticas: estadisticasVacias() });
  });

  it("rechaza negativos, decimales y pasados de tope", () => {
    // La clave del campo lleva un punto, así que se pasa como ruta en array:
    // "campos.estadisticas.puntos" haría a Vitest buscar tres niveles.
    const ruta = ["campos", "estadisticas.puntos"];
    expect(validarEstadisticas({ puntos: -1 })).toHaveProperty(ruta);
    expect(validarEstadisticas({ puntos: 1.5 })).toHaveProperty(ruta);
    expect(validarEstadisticas({ puntos: MAX_METRICA + 1 })).toHaveProperty(ruta);
  });

  it("no se cuela nada que no sea una métrica conocida", () => {
    const resultado = validarEstadisticas({ puntos: 1, sobornos: 99 });
    expect("estadisticas" in resultado && resultado.estadisticas).not.toHaveProperty("sobornos");
  });
});
