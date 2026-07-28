import { describe, expect, it } from "vitest";
import { capitalizarPropio, primerApellido } from "../../functions/_lib/nombres";

describe("capitalizarPropio", () => {
  it("capitaliza cada palabra", () => {
    expect(capitalizarPropio("ana torres")).toBe("Ana Torres");
    expect(capitalizarPropio("ANA TORRES")).toBe("Ana Torres");
  });

  it("restituye la tilde de las entradas del diccionario", () => {
    expect(capitalizarPropio("jose maria garcia")).toBe("José María García");
    expect(capitalizarPropio("ruben fernandez lopez")).toBe("Rubén Fernández López");
  });

  it("normaliza una entrada del diccionario ya acentuada y en mayúsculas", () => {
    expect(capitalizarPropio("JOSÉ")).toBe("José");
    expect(capitalizarPropio("garcía")).toBe("García");
  });

  // El invariante que da sentido al diccionario: fuera de él no se inventa nada.
  it("no inventa tildes en palabras que no están en el diccionario", () => {
    expect(capitalizarPropio("peres")).toBe("Peres");
    expect(capitalizarPropio("chamorro")).toBe("Chamorro");
    expect(capitalizarPropio("abalo")).toBe("Abalo");
  });

  it("no añade una eñe que el usuario no escribió", () => {
    expect(capitalizarPropio("nunez")).toBe("Nunez");
    expect(capitalizarPropio("muñoz")).toBe("Muñoz");
  });

  it("capitaliza los dos lados de un apellido con guion", () => {
    expect(capitalizarPropio("garcia-lopez")).toBe("García-López");
    expect(capitalizarPropio("ana-maria")).toBe("Ana-María");
  });

  it("capitaliza la letra que sigue a un apóstrofo", () => {
    expect(capitalizarPropio("d'angelo")).toBe("D'Angelo");
  });

  it("recorta y colapsa los espacios", () => {
    expect(capitalizarPropio("  ana   torres  ")).toBe("Ana Torres");
  });

  it("devuelve cadena vacía para entrada vacía", () => {
    expect(capitalizarPropio("")).toBe("");
    expect(capitalizarPropio("   ")).toBe("");
  });
});

describe("primerApellido", () => {
  it("devuelve solo el primero", () => {
    expect(primerApellido("García Rúa")).toBe("García");
    expect(primerApellido("Gómez")).toBe("Gómez");
  });

  it("tolera espacios de más y cadena vacía", () => {
    expect(primerApellido("  Novoa   Bóveda ")).toBe("Novoa");
    expect(primerApellido("")).toBe("");
  });
});
