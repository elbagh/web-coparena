import { describe, expect, it } from "vitest";
import { calcularClasificados, type GrupoParaClasificar } from "../../functions/_lib/clasificados";
import type { FilaClasificacion } from "../../functions/_lib/clasificacion";

/** Una fila de clasificación con lo mínimo para ordenar; el resto a cero. */
const fila = (
  posicion: number,
  equipoId: number,
  nombre: string,
  puntos: number,
  extra: Partial<FilaClasificacion> = {}
): FilaClasificacion => ({
  posicion,
  equipoId,
  nombre,
  jugados: 3,
  ganados: 0,
  perdidos: 0,
  setsAFavor: 0,
  setsEnContra: 0,
  puntosAFavor: 0,
  puntosEnContra: 0,
  puntos,
  desempatadoPor: null,
  ...extra
});

const grupo = (
  id: number,
  nombre: string,
  clasifican: number,
  enRepesca: boolean,
  clasificacion: FilaClasificacion[],
  retirados: ReadonlySet<number> = new Set()
): GrupoParaClasificar => ({ id, nombre, clasifican, enRepesca, retirados, clasificacion });

const DESEMPATES = ["puntos", "ratio_sets", "ratio_puntos"] as const;

describe("calcularClasificados", () => {
  it("marca como directos a los primeros de cada grupo según su propio cupo", () => {
    const grupos = [
      grupo(1, "A", 2, true, [fila(1, 10, "A1", 9), fila(2, 11, "A2", 6), fila(3, 12, "A3", 3)]),
      grupo(2, "C", 3, false, [fila(1, 20, "C1", 9), fila(2, 21, "C2", 6), fila(3, 22, "C3", 3), fila(4, 23, "C4", 0)])
    ];

    const { condiciones } = calcularClasificados(grupos, 0, DESEMPATES);

    expect(condiciones.get(10)).toBe("directo");
    expect(condiciones.get(11)).toBe("directo");
    expect(condiciones.get(12)).toBeUndefined();
    expect(condiciones.get(22)).toBe("directo");
    expect(condiciones.get(23)).toBeUndefined();
  });

  it("reparte las plazas de repesca solo entre los grupos que entran al bote", () => {
    const grupos = [
      grupo(1, "A", 2, true, [fila(1, 10, "A1", 9), fila(2, 11, "A2", 6), fila(3, 12, "A3", 4)]),
      grupo(2, "B", 2, true, [fila(1, 30, "B1", 9), fila(2, 31, "B2", 6), fila(3, 32, "B3", 1)]),
      grupo(3, "C", 3, false, [fila(1, 20, "C1", 9), fila(2, 21, "C2", 6), fila(3, 22, "C3", 5), fila(4, 23, "C4", 5)])
    ];

    const { condiciones } = calcularClasificados(grupos, 1, DESEMPATES);

    // A3 (4 puntos) gana la repesca a B3 (1 punto).
    expect(condiciones.get(12)).toBe("repesca");
    // Pero B3 sigue en el bote: le basta con ganar el último partido.
    expect(condiciones.get(32)).toBe("aspirante");
    // C4 tiene 5 puntos, más que A3, pero su grupo no entra al bote.
    expect(condiciones.get(23)).toBeUndefined();
  });

  it("marca a todo el bote, no solo al que ahora mismo ocupa la plaza", () => {
    const grupos = [
      grupo(1, "A", 2, true, [fila(1, 10, "A1", 9), fila(2, 11, "A2", 6), fila(3, 12, "A3", 4), fila(4, 13, "A4", 0)]),
      grupo(2, "B", 2, true, [fila(1, 30, "B1", 9), fila(2, 31, "B2", 6), fila(3, 32, "B3", 1), fila(4, 33, "B4", 0)])
    ];

    const { condiciones } = calcularClasificados(grupos, 1, DESEMPATES);

    expect(condiciones.get(12)).toBe("repesca");
    expect(condiciones.get(32)).toBe("aspirante");
    // El bote es el siguiente de cada grupo y nadie más: los cuartos están fuera.
    expect(condiciones.get(13)).toBeUndefined();
    expect(condiciones.get(33)).toBeUndefined();
  });

  it("sin plazas de repesca no hay aspirantes: el bote no existe", () => {
    const grupos = [
      grupo(1, "A", 2, true, [fila(1, 10, "A1", 9), fila(2, 11, "A2", 6), fila(3, 12, "A3", 4)]),
      grupo(2, "B", 2, true, [fila(1, 30, "B1", 9), fila(2, 31, "B2", 6), fila(3, 32, "B3", 1)])
    ];

    const { condiciones } = calcularClasificados(grupos, 0, DESEMPATES);

    expect(condiciones.get(12)).toBeUndefined();
    expect(condiciones.get(32)).toBeUndefined();
  });

  it("ordena las semillas por posición y deja las repescas al final", () => {
    const grupos = [
      grupo(1, "A", 2, true, [fila(1, 10, "A1", 9), fila(2, 11, "A2", 6), fila(3, 12, "A3", 4)]),
      grupo(2, "B", 2, true, [fila(1, 30, "B1", 9), fila(2, 31, "B2", 6), fila(3, 32, "B3", 1)]),
      grupo(3, "C", 3, false, [fila(1, 20, "C1", 9), fila(2, 21, "C2", 6), fila(3, 22, "C3", 5)])
    ];

    const { semillas } = calcularClasificados(grupos, 1, DESEMPATES);

    expect(semillas.map((s) => s.equipoId)).toEqual([10, 30, 20, 11, 31, 21, 22, 12]);
    expect(semillas.at(-1)).toMatchObject({ equipoId: 12, condicion: "repesca" });
  });

  /*
   * El invariante de verdad: los sembrados son exactamente los que la tabla
   * pinta como clasificados. Un aspirante lleva color pero NO plaza, así que
   * comparar tamaños ya no vale — hay que descontarlo antes de comparar, que es
   * justo donde un día se colaría sembrando a quien no ha pasado.
   */
  it("los sembrados son exactamente los que la tabla da por clasificados", () => {
    const grupos = [
      grupo(1, "A", 2, true, [fila(1, 10, "A1", 9), fila(2, 11, "A2", 6), fila(3, 12, "A3", 4)]),
      grupo(2, "B", 2, true, [fila(1, 30, "B1", 9), fila(2, 31, "B2", 6), fila(3, 32, "B3", 1)]),
      grupo(3, "C", 3, false, [fila(1, 20, "C1", 9), fila(2, 21, "C2", 6), fila(3, 22, "C3", 5)])
    ];

    const { condiciones, semillas } = calcularClasificados(grupos, 1, DESEMPATES);

    const conPlaza = [...condiciones].filter(
      ([, condicion]) => condicion !== "aspirante" && condicion !== "retirado"
    );
    expect(semillas.map((s) => s.equipoId).sort()).toEqual(conPlaza.map(([id]) => id).sort());
    semillas.forEach((s) => expect(condiciones.get(s.equipoId)).toBe(s.condicion));
    // Y el que se lo está jugando no se siembra: todavía no ha pasado.
    expect(condiciones.get(32)).toBe("aspirante");
    expect(semillas.some((s) => s.equipoId === 32)).toBe(false);
  });

  it("con un grupo a medio jugar no inventa clasificados de más", () => {
    const grupos = [grupo(1, "A", 2, true, [fila(1, 10, "A1", 3)])];
    const { semillas } = calcularClasificados(grupos, 1, DESEMPATES);
    // Solo hay una fila: una plaza directa y ninguna repesca posible.
    expect(semillas.map((s) => s.equipoId)).toEqual([10]);
  });

  /*
   * Un equipo puede clasificarse y no poder jugar la fase siguiente. Su fila se
   * queda donde está —se la ganó en el campo, y sus partidos siguen contando
   * para los demás— pero su plaza baja al siguiente. Es lo contrario de sacarlo
   * del grupo, que reescribiría la clasificación de todo el mundo.
   */
  describe("con alguien retirado", () => {
    // La forma exacta del grupo B de 2026: el segundo no puede competir.
    const grupoB = (retirados: number[]) =>
      grupo(
        2,
        "B",
        2,
        true,
        [fila(1, 30, "B1", 7), fila(2, 31, "B2", 5), fila(3, 32, "B3", 4), fila(4, 33, "B4", 2)],
        new Set(retirados)
      );

    it("no ocupa plaza, y el hueco baja al siguiente", () => {
      const { condiciones } = calcularClasificados([grupoB([31])], 0, DESEMPATES);

      expect(condiciones.get(30)).toBe("directo");
      expect(condiciones.get(31)).toBe("retirado");
      expect(condiciones.get(32)).toBe("directo");
      expect(condiciones.get(33)).toBeUndefined();
    });

    it("se marca aunque ya estuviera fuera de plaza, y entonces no mueve nada", () => {
      const { condiciones } = calcularClasificados([grupoB([33])], 0, DESEMPATES);

      expect(condiciones.get(30)).toBe("directo");
      expect(condiciones.get(31)).toBe("directo");
      expect(condiciones.get(32)).toBeUndefined();
      expect(condiciones.get(33)).toBe("retirado");
    });

    it("retirado el primero, las plazas suben una", () => {
      const { condiciones } = calcularClasificados([grupoB([30])], 0, DESEMPATES);

      expect(condiciones.get(30)).toBe("retirado");
      expect(condiciones.get(31)).toBe("directo");
      expect(condiciones.get(32)).toBe("directo");
      expect(condiciones.get(33)).toBeUndefined();
    });

    it("el bote de la repesca también se lo salta", () => {
      // El tercero de B está retirado, así que su candidato pasa a ser el
      // cuarto, con 2 puntos; el tercero de A gana la plaza con 4.
      const grupos = [
        grupo(1, "A", 2, true, [fila(1, 10, "A1", 9), fila(2, 11, "A2", 6), fila(3, 12, "A3", 4)]),
        grupoB([32])
      ];

      const { condiciones } = calcularClasificados(grupos, 1, DESEMPATES);

      expect(condiciones.get(32)).toBe("retirado");
      expect(condiciones.get(12)).toBe("repesca");
      expect(condiciones.get(33)).toBe("aspirante");
    });

    it("nunca se siembra, ni estando en posición de plaza directa", () => {
      const { semillas } = calcularClasificados([grupoB([31])], 0, DESEMPATES);

      expect(semillas.some((s) => s.equipoId === 31)).toBe(false);
      expect(semillas.map((s) => s.equipoId)).toEqual([30, 32]);
    });

    // El reparto pasó de buscar por `posicion` a contar por orden dentro de la
    // lista en juego. Con el conjunto vacío tiene que dar exactamente lo mismo.
    it("con el conjunto vacío el reparto es el de siempre", () => {
      const { condiciones, semillas } = calcularClasificados([grupoB([])], 1, DESEMPATES);

      expect(condiciones.get(30)).toBe("directo");
      expect(condiciones.get(31)).toBe("directo");
      expect(condiciones.get(32)).toBe("repesca");
      expect(condiciones.get(33)).toBeUndefined();
      expect(semillas.map((s) => s.equipoId)).toEqual([30, 31, 32]);
    });
  });
});
