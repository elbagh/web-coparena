import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { puntuacion } from "../../src/data/event";
import { REGLAS_POR_DEFECTO } from "../../functions/_lib/reglas";

/*
 * /torneo/premios/ explica cómo se puntúa la fase de grupos, y esa explicación
 * es copia: los valores que rigen de verdad viven en `torneo_fases.reglas` de
 * D1 y se editan desde /admin/torneo/. Nada de eso se puede comprobar desde
 * aquí, así que lo que este fichero ata es lo único que sí está en el repo:
 * que la copia coincida con `REGLAS_POR_DEFECTO`, que es la declaración en
 * código de cómo puntúa este torneo y de la que salieron las reglas de la fase.
 *
 * No prueba que producción tenga esos valores. Prueba que si alguien cambia el
 * baremo en código, la página no se queda contando el viejo — que es la deriva
 * que ya documenta `event.phases` y la que el correo de confirmación llegó a
 * tener durante meses.
 */

const raiz = path.resolve(import.meta.dirname, "../..");
const premiosAstro = readFileSync(path.join(raiz, "src/pages/torneo/premios.astro"), "utf8");

/** Los cuatro desenlaces de un partido, con lo que paga cada uno. */
const baremo = REGLAS_POR_DEFECTO.clasificacion;
const ESPERADO: Record<string, number> = {
  "2–0": baremo.puntosVictoria,
  "2–1": baremo.puntosVictoriaAjustada,
  "1–2": baremo.puntosDerrotaAjustada,
  "0–2": baremo.puntosDerrota
};

const casillas = puntuacion.filas.flatMap((fila) => fila.casillas);

describe("la puntuación que publica /torneo/premios/", () => {
  it("cubre los cuatro desenlaces, sin repetir ninguno", () => {
    expect(casillas.map((c) => c.marcador).sort()).toEqual(Object.keys(ESPERADO).sort());
  });

  it("paga lo que dice REGLAS_POR_DEFECTO", () => {
    for (const casilla of casillas) {
      expect(
        casilla.puntos,
        `La página dice que un ${casilla.marcador} vale ${casilla.puntos} puntos, y ` +
          `REGLAS_POR_DEFECTO dice ${ESPERADO[casilla.marcador]}. ` +
          "Cambia también `puntuacion` en src/data/event.ts."
      ).toBe(ESPERADO[casilla.marcador]);
    }
  });

  /*
   * El guion de «2–0» es un guion corto tipográfico (U+2013), el mismo que usa
   * el marcador en el resto del sitio. Con un guion normal la tabla seguiría
   * pasando los tests de arriba —compara consigo misma— pero se vería distinta
   * al lado del cuadro.
   */
  it("escribe los marcadores con el guion del resto del sitio", () => {
    for (const casilla of casillas) {
      expect(casilla.marcador).toMatch(/^\d–\d$/);
    }
  });

  /*
   * El primer criterio de `desempates` es «puntos», que no es un desempate:
   * es el orden normal de la tabla. La página empieza a numerar en el segundo.
   */
  it("enumera los desempates en el orden en que se aplican", () => {
    const enCodigo = baremo.desempates.filter((c) => c !== "puntos");

    expect(
      puntuacion.desempates.criterios,
      "La lista de desempates de la página no tiene tantos criterios como " +
        "REGLAS_POR_DEFECTO. Si se ha añadido o quitado uno, hay que contarlo aquí."
    ).toHaveLength(enCodigo.length);

    // El orden importa: se aplican en cascada, y el segundo solo entra cuando
    // el primero no ha separado a nadie.
    expect(enCodigo).toEqual(["enfrentamiento_directo", "ratio_sets", "ratio_puntos"]);
    expect(puntuacion.desempates.criterios[0]).toMatch(/partido entre ellos/i);
    expect(puntuacion.desempates.criterios[1]).toMatch(/sets/i);
    expect(puntuacion.desempates.criterios[2]).toMatch(/puntos/i);
  });

  /*
   * El ejemplo es la razón de ser del apartado: la pregunta que lo motivó fue
   * «por qué un invicto tiene 8 puntos de 3 partidos». Si el baremo cambia, la
   * cuenta deja de salir y hay que reescribirla.
   */
  it("la cuenta del ejemplo suma lo que suman sus sumandos", () => {
    const [izquierda, derecha] = puntuacion.ejemplo.cuenta.split("=");
    const sumandos = izquierda!.split("+").map((n) => Number(n.trim()));
    const total = Number(derecha!.trim());

    expect(sumandos.every(Number.isFinite)).toBe(true);
    expect(sumandos.reduce((a, b) => a + b, 0)).toBe(total);

    // Y cada sumando tiene que ser un resultado que el baremo sepa pagar.
    const pagos = new Set(Object.values(ESPERADO));
    for (const sumando of sumandos) expect(pagos).toContain(sumando);
  });
});

describe("la página monta el apartado", () => {
  it("pinta la tabla desde `puntuacion`, sin números escritos a mano", () => {
    expect(premiosAstro).toContain("puntuacion.filas.map");
    expect(premiosAstro).toContain("puntuacion.desempates.criterios.map");
  });

  /*
   * El tinte de cada casilla sale de `data-puntos`. Sin ese atributo la tabla
   * se pinta entera en crema y se pierde lo que hace legible la diagonal.
   */
  it("marca cada casilla con sus puntos para que el CSS la tiña", () => {
    expect(premiosAstro).toContain("data-puntos={casilla.puntos}");
  });
});
