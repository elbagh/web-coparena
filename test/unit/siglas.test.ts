import { describe, expect, it } from "vitest";
import { derivarSiglas } from "../../functions/_lib/siglas";

/*
 * Las siglas son lo único que dice quién juega en el chip de la cabecera, así
 * que dos equipos que colisionan dejan el chip sin información. Por eso la
 * organización puede escribirlas a mano; esto es solo el respaldo.
 */
describe("derivarSiglas", () => {
  it("usa las iniciales cuando llegan a tres", () => {
    expect(derivarSiglas("Rayo Vallecano Beach")).toBe("RVB");
  });

  it("descarta los enlaces y cae a las tres primeras letras si quedan pocas", () => {
    expect(derivarSiglas("Ostreiros do Pozo")).toBe("OST");
  });

  it("con una sola palabra con peso, sus tres primeras letras", () => {
    expect(derivarSiglas("Os Pulpos")).toBe("PUL");
  });

  it("los huecos del cuadro también salen legibles", () => {
    expect(derivarSiglas("Ganador SF1")).toBe("GAN");
  });

  it("corta en cuatro iniciales", () => {
    expect(derivarSiglas("Club Atlético Voleibol Porto Son")).toBe("CAVP");
  });

  it("mantiene las tildes y la eñe: son parte del nombre", () => {
    expect(derivarSiglas("Ñoras")).toBe("ÑOR");
    expect(derivarSiglas("Ría de Muros")).toBe("RÍA");
  });

  it("si todo son enlaces, no se queda sin nada que decir", () => {
    expect(derivarSiglas("Los de la")).toBe("LOS");
  });

  it("con un nombre más corto que tres letras, usa lo que hay", () => {
    expect(derivarSiglas("OK")).toBe("OK");
  });

  it("un nombre vacío no revienta", () => {
    expect(derivarSiglas("")).toBe("");
    expect(derivarSiglas("   ")).toBe("");
  });
});
