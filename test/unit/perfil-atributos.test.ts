import { describe, expect, it } from "vitest";
import {
  ATRIBUTOS,
  CLAVES_ATRIBUTO,
  MAX_ATRIBUTO,
  MIN_ATRIBUTO,
  NIVELES,
  NIVEL_POR_DEFECTO,
  mediaAtributos,
  parseAtributos,
  validarAtributos,
  validarNivel
} from "../../functions/_lib/perfil";

/*
 * Los atributos pasan de 1–5 (cinco pips) a 1–99 (cromo tipo FIFA), y el cromo
 * gana una nota global que es la media de lo puntuado. Nada de esto se guarda:
 * la media se calcula en cada lectura, igual que la clasificación, para que
 * corregir un atributo viejo no deje una nota que miente.
 */

describe("ATRIBUTOS", () => {
  it("son los seis de siempre, con etiqueta y abreviatura", () => {
    expect(CLAVES_ATRIBUTO).toEqual(["saque", "remate", "bloqueo", "defensa", "recepcion", "colocacion"]);
    expect(ATRIBUTOS.map((a) => a.abrev)).toEqual(["SAQ", "REM", "BLO", "DEF", "REC", "COL"]);
  });

  it("las abreviaturas son de tres letras y no se repiten", () => {
    // La rejilla 2×3 del cromo reserva un hueco fijo: una abreviatura más larga
    // desborda la celda en el móvil, que es donde menos sitio hay.
    const abreviaturas = ATRIBUTOS.map((a) => a.abrev);
    abreviaturas.forEach((abrev) => expect(abrev).toHaveLength(3));
    expect(new Set(abreviaturas).size).toBe(abreviaturas.length);
  });
});

describe("mediaAtributos", () => {
  it("con los seis puntuados, la media redondeada", () => {
    expect(
      mediaAtributos({ saque: 80, remate: 70, bloqueo: 60, defensa: 50, recepcion: 40, colocacion: 30 })
    ).toBe(55);
  });

  it("divide entre los puntuados, no entre seis", () => {
    // Puntuar solo dos apartados no debe hundir la nota a un tercio de lo que
    // vale: quien tiene 80 y 90 vale 85, no 28.
    expect(mediaAtributos({ saque: 80, remate: 90 })).toBe(85);
  });

  it("sin ningún atributo puntuado no hay nota", () => {
    // El cromo sale entonces sin cifra, no con un cero ni con un guión: nadie
    // ha dicho que esta persona sea mala, es que no la han valorado.
    expect(mediaAtributos({})).toBeNull();
    expect(mediaAtributos(null)).toBeNull();
    expect(mediaAtributos(undefined)).toBeNull();
  });

  it("redondea al entero más cercano", () => {
    expect(mediaAtributos({ saque: 80, remate: 81 })).toBe(81);
    expect(mediaAtributos({ saque: 80, remate: 79 })).toBe(80);
    expect(mediaAtributos({ saque: 1 })).toBe(1);
    expect(mediaAtributos({ saque: 99 })).toBe(99);
  });

  it("ignora las claves que no son atributos", () => {
    expect(mediaAtributos({ saque: 60, inventado: 99 } as Record<string, number>)).toBe(60);
  });
});

describe("validarAtributos", () => {
  const campos = (raw: unknown) => {
    const r = validarAtributos(raw);
    return "campos" in r ? r.campos : null;
  };
  const valores = (raw: unknown) => {
    const r = validarAtributos(raw);
    return "atributos" in r ? r.atributos : null;
  };

  it("acepta los extremos del rango nuevo", () => {
    expect(valores({ saque: MIN_ATRIBUTO, colocacion: MAX_ATRIBUTO })).toEqual({ saque: 1, colocacion: 99 });
  });

  it("rechaza lo que se sale de 1 a 99", () => {
    expect(campos({ saque: 0 })).toEqual({ "atributos.saque": "Puntúa del 1 al 99." });
    expect(campos({ saque: 100 })).toEqual({ "atributos.saque": "Puntúa del 1 al 99." });
    expect(campos({ saque: -1 })).toEqual({ "atributos.saque": "Puntúa del 1 al 99." });
  });

  it("rechaza lo que no es un entero", () => {
    expect(campos({ remate: 3.5 })).not.toBeNull();
    expect(campos({ remate: "muy bueno" })).not.toBeNull();
  });

  it("el vacío significa «sin puntuar», no un error", () => {
    // Es lo que manda el panel cuando se borra el input.
    expect(valores({ saque: "", remate: null, bloqueo: undefined })).toEqual({});
  });

  it("la clave del error nombra el atributo", () => {
    // El panel remapea `atributos.saque` a su `[data-stats-error]`; si la clave
    // cambia, el mensaje se pinta en ningún sitio.
    expect(Object.keys(campos({ recepcion: 500 }) ?? {})).toEqual(["atributos.recepcion"]);
  });
});

describe("validarNivel", () => {
  const nivel = (raw: unknown) => {
    const r = validarNivel(raw);
    return "nivel" in r ? r.nivel : null;
  };

  it("acepta los tres metales", () => {
    expect(NIVELES).toEqual(["bronce", "plata", "oro"]);
    NIVELES.forEach((n) => expect(nivel(n)).toBe(n));
  });

  it("sin nivel se queda el de serie", () => {
    // Un PATCH que no menciona el nivel no debe devolver a nadie a bronce: eso
    // lo decide quien llama mirando si el campo venía.
    expect(nivel(undefined)).toBe(NIVEL_POR_DEFECTO);
    expect(NIVEL_POR_DEFECTO).toBe("bronce");
  });

  it("rechaza cualquier otro metal", () => {
    const r = validarNivel("platino");
    expect("campos" in r && r.campos.nivel).toBeTruthy();
    expect("campos" in validarNivel("")).toBe(true);
    expect("campos" in validarNivel(7)).toBe(true);
  });
});

describe("parseAtributos", () => {
  it("lee lo que hay dentro del rango", () => {
    expect(parseAtributos('{"saque":99,"remate":1}')).toEqual({ saque: 99, remate: 1 });
  });

  it("descarta lo que se sale, lo no entero y lo desconocido", () => {
    expect(parseAtributos('{"saque":0,"remate":100,"bloqueo":3.5,"inventado":50,"defensa":60}')).toEqual({
      defensa: 60
    });
  });

  it("un JSON roto no revienta la ficha", () => {
    expect(parseAtributos("{esto no es json")).toEqual({});
    expect(parseAtributos(null)).toEqual({});
    expect(parseAtributos("")).toEqual({});
  });
});
