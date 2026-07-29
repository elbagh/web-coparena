import { describe, expect, it } from "vitest";
import { calendarioLiga, plantillaCuadro, tamanoDeCuadroValido } from "../../functions/_lib/torneo";

/*
 * Las dos piezas con algoritmo del torneo. El resto de _lib/torneo.ts solo
 * materializa esto en la base, y eso se prueba en integración.
 */

describe("calendarioLiga", () => {
  const pares = (cruces: { a: number; b: number }[]) =>
    cruces.map(({ a, b }) => [a, b].sort((x, y) => x - y).join("-")).sort();

  it("con 4 equipos salen los 6 cruces posibles, sin repetir", () => {
    const cruces = calendarioLiga([1, 2, 3, 4]);
    expect(cruces).toHaveLength(6);
    expect(new Set(pares(cruces)).size).toBe(6);
  });

  it("con 5 equipos salen los 10 cruces posibles", () => {
    const cruces = calendarioLiga([1, 2, 3, 4, 5]);
    expect(cruces).toHaveLength(10);
    expect(new Set(pares(cruces)).size).toBe(10);
  });

  // Con impares hay descanso: en cada jornada juega uno menos.
  it("con 3 equipos cada uno descansa una jornada", () => {
    const cruces = calendarioLiga([1, 2, 3]);
    expect(cruces).toHaveLength(3);
    expect(new Set(cruces.map((c) => c.jornada)).size).toBe(3);
    for (const jornada of [1, 2, 3]) {
      expect(cruces.filter((c) => c.jornada === jornada)).toHaveLength(1);
    }
  });

  it("nadie juega dos veces en la misma jornada", () => {
    for (const equipos of [[1, 2, 3, 4], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6]]) {
      const cruces = calendarioLiga(equipos);
      const porJornada = new Map<number, number[]>();
      cruces.forEach((c) => porJornada.set(c.jornada, [...(porJornada.get(c.jornada) ?? []), c.a, c.b]));
      for (const [jornada, ids] of porJornada) {
        expect(new Set(ids).size, `jornada ${jornada} con ${equipos.length} equipos`).toBe(ids.length);
      }
    }
  });

  it("es determinista: la misma entrada da el mismo calendario", () => {
    expect(calendarioLiga([7, 3, 9, 1])).toEqual(calendarioLiga([7, 3, 9, 1]));
  });

  it("con menos de dos equipos no hay nada que jugar", () => {
    expect(calendarioLiga([])).toEqual([]);
    expect(calendarioLiga([1])).toEqual([]);
  });
});

describe("tamanoDeCuadroValido", () => {
  it("solo potencias de dos entre 2 y 64", () => {
    for (const bueno of [2, 4, 8, 16, 32, 64]) expect(tamanoDeCuadroValido(bueno)).toBe(true);
    for (const malo of [0, 1, 3, 6, 12, 128, 2.5, -4]) expect(tamanoDeCuadroValido(malo)).toBe(false);
  });
});

describe("plantillaCuadro", () => {
  it("un cuadro de 8 tiene 7 partidos en tres rondas", () => {
    const nodos = plantillaCuadro(8);
    expect(nodos).toHaveLength(7);
    expect(nodos.filter((n) => n.rondaOrden === 0)).toHaveLength(4);
    expect(nodos.filter((n) => n.rondaOrden === 1)).toHaveLength(2);
    expect(nodos.filter((n) => n.rondaOrden === 2)).toHaveLength(1);
  });

  it("nombra las rondas por cuántos partidos quedan", () => {
    const nombres = (tamano: number) => [...new Set(plantillaCuadro(tamano).map((n) => n.ronda))];
    expect(nombres(8)).toEqual(["Cuartos de final", "Semifinales", "Final"]);
    expect(nombres(4)).toEqual(["Semifinales", "Final"]);
    expect(nombres(2)).toEqual(["Final"]);
  });

  /*
   * Es lo que dibuja el árbol: el ganador del hueco p cae en el hueco p/2 de la
   * ronda siguiente, por el lado A si venía de un hueco par y por el B si de uno
   * impar. Si esto se tuerce, el cuadro deja de cerrar.
   */
  it("los dos partidos de un par apuntan al mismo destino, uno por cada lado", () => {
    const nodos = plantillaCuadro(8);
    const primera = nodos.filter((n) => n.rondaOrden === 0);

    expect(primera[0]).toMatchObject({ siguienteRonda: 1, siguientePosicion: 0, siguienteSlot: "A" });
    expect(primera[1]).toMatchObject({ siguienteRonda: 1, siguientePosicion: 0, siguienteSlot: "B" });
    expect(primera[2]).toMatchObject({ siguienteRonda: 1, siguientePosicion: 1, siguienteSlot: "A" });
    expect(primera[3]).toMatchObject({ siguienteRonda: 1, siguientePosicion: 1, siguienteSlot: "B" });
  });

  it("la final no lleva a ninguna parte", () => {
    const final = plantillaCuadro(8).find((n) => n.ronda === "Final")!;
    expect(final.siguienteRonda).toBeNull();
    expect(final.siguienteSlot).toBeNull();
  });

  it("todo hueco de destino existe de verdad", () => {
    for (const tamano of [2, 4, 8, 16]) {
      const nodos = plantillaCuadro(tamano, true);
      const existentes = new Set(nodos.map((n) => `${n.rondaOrden}:${n.posicion}`));
      for (const nodo of nodos) {
        if (nodo.siguienteRonda !== null) {
          expect(existentes.has(`${nodo.siguienteRonda}:${nodo.siguientePosicion}`)).toBe(true);
        }
        if (nodo.perdedorRonda !== null) {
          expect(existentes.has(`${nodo.perdedorRonda}:${nodo.perdedorPosicion}`)).toBe(true);
        }
      }
    }
  });
});

describe("partido por el tercer puesto", () => {
  it("añade un partido más y lo alimentan las dos semifinales", () => {
    const nodos = plantillaCuadro(8, true);
    expect(nodos).toHaveLength(8);

    const tercero = nodos.find((n) => n.ronda === "Tercer puesto")!;
    expect(tercero.rondaOrden).toBe(2);
    expect(tercero.posicion).toBe(1);

    const semis = nodos.filter((n) => n.ronda === "Semifinales");
    expect(semis.map((s) => s.perdedorSlot)).toEqual(["A", "B"]);
    expect(semis.every((s) => s.perdedorRonda === 2 && s.perdedorPosicion === 1)).toBe(true);
  });

  // Con dos equipos solo hay final: no hay semifinales de las que salga un
  // perdedor, así que no hay tercer puesto que disputar.
  it("con un cuadro de dos no se añade", () => {
    expect(plantillaCuadro(2, true)).toHaveLength(1);
  });

  it("sin pedirlo, ninguna semifinal manda a nadie a ningún lado", () => {
    expect(plantillaCuadro(8).every((n) => n.perdedorRonda === null)).toBe(true);
  });
});
