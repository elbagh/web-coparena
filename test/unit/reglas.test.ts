import { describe, expect, it } from "vitest";
import {
  REGLAS_POR_DEFECTO,
  ganadorDelPartido,
  ganadorDelSet,
  normalizarReglas,
  objetivoDelSet,
  reglasEfectivas,
  setsMaximos,
  validarReglas
} from "../../functions/_lib/reglas";

/*
 * Las reglas dejan de ser literales repartidos por el código (21/21/15 estaba
 * escrito a mano en el endpoint y otra vez en el cliente) y pasan a ser datos.
 * Lo que hay que garantizar es que un JSON incompleto o corrupto nunca deje un
 * partido sin reglas con las que arbitrarlo.
 */

describe("normalizarReglas", () => {
  it("de la nada salen las de siempre: al mejor de tres, 21/21/15", () => {
    expect(normalizarReglas("{}")).toEqual(REGLAS_POR_DEFECTO);
    expect(normalizarReglas(null)).toEqual(REGLAS_POR_DEFECTO);
    expect(normalizarReglas(undefined)).toEqual(REGLAS_POR_DEFECTO);
  });

  it("un JSON roto no revienta: cae a las de serie", () => {
    expect(normalizarReglas("{esto no es json")).toEqual(REGLAS_POR_DEFECTO);
    expect(normalizarReglas("[1,2,3]")).toEqual(REGLAS_POR_DEFECTO);
    expect(normalizarReglas(42)).toEqual(REGLAS_POR_DEFECTO);
  });

  it("respeta lo que sí viene y completa lo que falta", () => {
    const reglas = normalizarReglas('{"partido":{"puntosPorSet":25}}');
    expect(reglas.partido.puntosPorSet).toBe(25);
    expect(reglas.partido.sets).toBe(REGLAS_POR_DEFECTO.partido.sets);
    expect(reglas.clasificacion).toEqual(REGLAS_POR_DEFECTO.clasificacion);
  });

  it("un valor fuera de rango se descarta en vez de colarse", () => {
    const reglas = normalizarReglas('{"partido":{"sets":99,"puntosPorSet":-3}}');
    expect(reglas.partido.sets).toBe(REGLAS_POR_DEFECTO.partido.sets);
    expect(reglas.partido.puntosPorSet).toBe(REGLAS_POR_DEFECTO.partido.puntosPorSet);
  });

  it("filtra los criterios de desempate que no existen", () => {
    const reglas = normalizarReglas('{"clasificacion":{"desempates":["puntos","inventado","ratio_sets"]}}');
    expect(reglas.clasificacion.desempates).toEqual(["puntos", "ratio_sets"]);
  });

  // Sin ningún criterio la tabla no tendría orden posible.
  it("una lista de desempates vacía cae a la de serie", () => {
    const reglas = normalizarReglas('{"clasificacion":{"desempates":["nada","de","esto"]}}');
    expect(reglas.clasificacion.desempates).toEqual(REGLAS_POR_DEFECTO.clasificacion.desempates);
  });
});

/*
 * El formato cambia según cuántos equipos tenga cada grupo: uno de tres puede
 * jugar a un set y uno de cinco al mejor de tres, dentro de la misma fase.
 */
describe("herencia grupo > fase > por defecto", () => {
  const fase = { reglas: '{"partido":{"puntosPorSet":25},"clasificacion":{"puntosVictoria":2}}' };

  it("sin grupo, mandan las de la fase", () => {
    const reglas = reglasEfectivas(fase);
    expect(reglas.partido.puntosPorSet).toBe(25);
    expect(reglas.clasificacion.puntosVictoria).toBe(2);
  });

  it("un grupo sin reglas propias hereda las de la fase", () => {
    expect(reglasEfectivas(fase, { reglas: null })).toEqual(reglasEfectivas(fase));
    expect(reglasEfectivas(fase, { reglas: "" })).toEqual(reglasEfectivas(fase));
  });

  it("el grupo pisa solo lo que declara, y hereda el resto de la fase", () => {
    const reglas = reglasEfectivas(fase, { reglas: '{"partido":{"sets":1}}' });
    expect(reglas.partido.sets).toBe(1);
    // No lo declara el grupo, así que sigue viniendo de la fase, no de las de serie.
    expect(reglas.partido.puntosPorSet).toBe(25);
    expect(reglas.clasificacion.puntosVictoria).toBe(2);
  });

  it("sin fase ni grupo, las de siempre", () => {
    expect(reglasEfectivas(null)).toEqual(REGLAS_POR_DEFECTO);
  });
});

describe("objetivo de cada set", () => {
  const alMejorDeTres = REGLAS_POR_DEFECTO.partido;

  it("al mejor de tres: 21, 21 y el tercero a 15", () => {
    expect(setsMaximos(alMejorDeTres)).toBe(3);
    expect(objetivoDelSet(alMejorDeTres, 1)).toBe(21);
    expect(objetivoDelSet(alMejorDeTres, 2)).toBe(21);
    expect(objetivoDelSet(alMejorDeTres, 3)).toBe(15);
  });

  it("al mejor de cinco, el corto es el quinto", () => {
    const reglas = { sets: 3, puntosPorSet: 25, puntosSetDecisivo: 15, diferencia: 2 };
    expect(setsMaximos(reglas)).toBe(5);
    expect(objetivoDelSet(reglas, 4)).toBe(25);
    expect(objetivoDelSet(reglas, 5)).toBe(15);
  });

  /*
   * A un solo set no hay "set decisivo" que valga: se juega al objetivo normal.
   * Tratarlo como decisivo dejaría un partido a 15 cuando se pidió a 21.
   */
  it("a un solo set se juega al objetivo normal, no al del desempate", () => {
    const reglas = { sets: 1, puntosPorSet: 21, puntosSetDecisivo: 15, diferencia: 2 };
    expect(setsMaximos(reglas)).toBe(1);
    expect(objetivoDelSet(reglas, 1)).toBe(21);
  });
});

describe("cierre de set y de partido", () => {
  const reglas = REGLAS_POR_DEFECTO.partido;

  it("no cierra a 21-20, sí a 22-20", () => {
    expect(ganadorDelSet(reglas, 21, 20, 1)).toBeNull();
    expect(ganadorDelSet(reglas, 22, 20, 1)).toBe("A");
  });

  it("el tercero cierra a 15", () => {
    expect(ganadorDelSet(reglas, 15, 10, 3)).toBe("A");
    expect(ganadorDelSet(reglas, 14, 10, 3)).toBeNull();
  });

  it("gana quien llega a los sets que pide la fase", () => {
    expect(ganadorDelPartido(reglas, 2, 0)).toBe("A");
    expect(ganadorDelPartido(reglas, 1, 2)).toBe("B");
    expect(ganadorDelPartido(reglas, 1, 1)).toBeNull();
    expect(ganadorDelPartido({ ...reglas, sets: 1 }, 1, 0)).toBe("A");
  });

  it("la ventaja mínima es configurable", () => {
    const sinVentaja = { ...reglas, diferencia: 1 };
    expect(ganadorDelSet(sinVentaja, 21, 20, 1)).toBe("A");
  });
});

describe("validarReglas", () => {
  it("acepta lo que está en rango", () => {
    const salida = validarReglas({ partido: { sets: 1, puntosPorSet: 15 } });
    expect("reglas" in salida).toBe(true);
  });

  it("devuelve errores por campo, como el resto del panel", () => {
    const salida = validarReglas({ partido: { sets: 99 }, clasificacion: { desempates: ["inventado"] } });
    expect("campos" in salida).toBe(true);
    if ("campos" in salida) {
      expect(salida.campos["reglas.sets"]).toBeTruthy();
      expect(salida.campos["reglas.desempates"]).toContain("inventado");
    }
  });

  it("rechaza quedarse sin ningún criterio de desempate", () => {
    const salida = validarReglas({ clasificacion: { desempates: [] } });
    expect("campos" in salida).toBe(true);
  });
});
