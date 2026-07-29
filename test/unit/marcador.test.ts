import { describe, expect, it } from "vitest";
import {
  METRICA_DE_TIPO,
  PUNTUA,
  TIPOS,
  aplicarPunto,
  estadisticasDeEventos,
  ladoDelPunto,
  marcadorInicial,
  plegarEventos,
  type EventoFila,
  type TipoEvento
} from "../../functions/_lib/marcador";
import { REGLAS_POR_DEFECTO, type ReglasPartido } from "../../functions/_lib/reglas";

/*
 * El pliegue es la pieza central de la anotación: de una lista de eventos salen
 * el marcador y las estadísticas. Que sea puro es lo que permite que deshacer un
 * punto sea «quita el evento y vuelve a plegar» en vez de restar a mano.
 */

const REGLAS = REGLAS_POR_DEFECTO.partido;

let orden = 0;
const evento = (parcial: Partial<EventoFila>): EventoFila => ({
  orden: (orden += 1),
  tipo: "remate",
  lado_jugador: "A",
  jugador_id: 1,
  lado_punto: "A",
  puntos_a: null,
  puntos_b: null,
  sets_a: null,
  sets_b: null,
  ...parcial
});

/** `veces` puntos seguidos para un lado, ya con el lado_punto resuelto. */
const puntos = (lado: "A" | "B", veces: number, tipo: TipoEvento = "remate"): EventoFila[] =>
  Array.from({ length: veces }, () => evento({ tipo, lado_jugador: lado, lado_punto: lado }));

describe("ladoDelPunto", () => {
  /*
   * El único caso en que el lado de quien hace la acción y el lado que se lleva
   * el punto no coinciden. Guardar un solo lado y deducir el otro sería el fallo
   * más caro de todo esto: no se vería hasta el final del torneo, con el
   * marcador y las estadísticas cruzados.
   */
  it("un error da el punto al rival", () => {
    expect(ladoDelPunto("error", "A")).toBe("B");
    expect(ladoDelPunto("error", "B")).toBe("A");
  });

  it("un acierto da el punto a quien lo hace", () => {
    for (const tipo of ["remate", "ace", "bloqueo"] as TipoEvento[]) {
      expect(ladoDelPunto(tipo, "A")).toBe("A");
      expect(ladoDelPunto(tipo, "B")).toBe("B");
    }
  });

  it("una defensa no da punto a nadie: el rally sigue", () => {
    expect(ladoDelPunto("defensa", "A")).toBeNull();
  });

  it("PUNTUA y METRICA_DE_TIPO cubren todos los tipos, sin huecos", () => {
    const tipos: TipoEvento[] = ["remate", "ace", "bloqueo", "defensa", "error", "ajuste"];
    for (const tipo of tipos) {
      expect(PUNTUA).toHaveProperty(tipo);
      expect(METRICA_DE_TIPO).toHaveProperty(tipo);
    }
    // Los que se ofrecen en el panel son los que se pueden anotar de verdad.
    expect(TIPOS.every((t) => t.clave !== "ajuste")).toBe(true);
  });
});

describe("cierre de set", () => {
  it("no cierra a 21-20, sí a 22-20", () => {
    const empatados = plegarEventos([...puntos("A", 20), ...puntos("B", 20)], REGLAS);
    const a21 = aplicarPunto(empatados, "A", REGLAS);
    expect(a21.puntos).toEqual({ A: 21, B: 20 });
    expect(a21.sets).toEqual({ A: 0, B: 0 });

    const a22 = aplicarPunto(a21, "A", REGLAS);
    expect(a22.sets).toEqual({ A: 1, B: 0 });
    expect(a22.puntos).toEqual({ A: 0, B: 0 });
    expect(a22.setNumero).toBe(2);
  });

  it("guarda el parcial de cada set en el historial", () => {
    const estado = plegarEventos([...puntos("A", 21), ...puntos("B", 5)], REGLAS);
    expect(estado.historial).toEqual([{ a: 21, b: 0 }]);
    expect(estado.puntos).toEqual({ A: 0, B: 5 });
  });

  it("el tercer set se juega a 15", () => {
    const dosSets = plegarEventos([...puntos("A", 21), ...puntos("B", 21)], REGLAS);
    expect(dosSets.setNumero).toBe(3);

    const decisivo = plegarEventos(
      [...puntos("A", 21), ...puntos("B", 21), ...puntos("A", 15)],
      REGLAS
    );
    expect(decisivo.sets).toEqual({ A: 2, B: 1 });
    expect(decisivo.terminado).toBe(true);
  });
});

describe("fin de partido", () => {
  it("gana quien llega a los sets que pide el formato", () => {
    const estado = plegarEventos([...puntos("A", 21), ...puntos("A", 21)], REGLAS);
    expect(estado.terminado).toBe(true);
    expect(estado.winner).toBe("A");
  });

  it("un partido terminado ignora puntos nuevos", () => {
    const terminado = plegarEventos([...puntos("A", 21), ...puntos("A", 21)], REGLAS);
    expect(aplicarPunto(terminado, "B", REGLAS)).toBe(terminado);
  });

  it("con un set cada uno el partido sigue vivo", () => {
    const estado = plegarEventos([...puntos("A", 21), ...puntos("B", 21)], REGLAS);
    expect(estado.terminado).toBe(false);
    expect(estado.winner).toBeNull();
  });
});

/*
 * Las reglas vienen del propio partido, así que el pliegue tiene que valer para
 * cualquier formato que la organización configure, no solo para 21/21/15.
 */
describe("otros formatos", () => {
  const aUnSet: ReglasPartido = { sets: 1, puntosPorSet: 15, puntosSetDecisivo: 15, diferencia: 2 };
  const alMejorDeCinco: ReglasPartido = { sets: 3, puntosPorSet: 25, puntosSetDecisivo: 15, diferencia: 2 };

  it("a un set se acaba con un solo set ganado", () => {
    const estado = plegarEventos(puntos("B", 15), aUnSet);
    expect(estado.sets).toEqual({ A: 0, B: 1 });
    expect(estado.terminado).toBe(true);
    expect(estado.winner).toBe("B");
  });

  it("al mejor de cinco el corto es el quinto, no el tercero", () => {
    const cuatroSets = plegarEventos(
      [...puntos("A", 25), ...puntos("A", 25), ...puntos("B", 25), ...puntos("B", 25)],
      alMejorDeCinco
    );
    expect(cuatroSets.setNumero).toBe(5);
    expect(cuatroSets.terminado).toBe(false);

    // El quinto sí se juega a 15.
    const conQuinto = plegarEventos(
      [
        ...puntos("A", 25),
        ...puntos("A", 25),
        ...puntos("B", 25),
        ...puntos("B", 25),
        ...puntos("A", 15)
      ],
      alMejorDeCinco
    );
    expect(conQuinto.terminado).toBe(true);
    expect(conQuinto.winner).toBe("A");
  });

  it("la ventaja mínima se respeta", () => {
    const sinVentaja: ReglasPartido = { ...REGLAS, diferencia: 1 };
    const estado = plegarEventos([...puntos("A", 20), ...puntos("B", 20), ...puntos("A", 1)], sinVentaja);
    expect(estado.sets).toEqual({ A: 1, B: 0 });
  });
});

/*
 * El ajuste es lo que permite que un partido empezado a mano gane un anotador a
 * mitad sin inventarse quién metió los puntos anteriores. No es un punto: es un
 * saldo de apertura.
 */
describe("ajuste: adoptar un marcador que venía a mano", () => {
  it("arranca desde el saldo que trae", () => {
    const estado = plegarEventos(
      [evento({ tipo: "ajuste", jugador_id: null, lado_jugador: null, lado_punto: null, puntos_a: 12, puntos_b: 9, sets_a: 1, sets_b: 0 })],
      REGLAS
    );
    expect(estado.puntos).toEqual({ A: 12, B: 9 });
    expect(estado.sets).toEqual({ A: 1, B: 0 });
    expect(estado.setNumero).toBe(2);
  });

  it("los puntos que vienen después se suman encima", () => {
    const estado = plegarEventos(
      [
        evento({ tipo: "ajuste", jugador_id: null, lado_jugador: null, lado_punto: null, puntos_a: 20, puntos_b: 9, sets_a: 0, sets_b: 0 }),
        ...puntos("A", 1)
      ],
      REGLAS
    );
    expect(estado.sets).toEqual({ A: 1, B: 0 });
  });

  it("no inventa parciales de lo que no vio", () => {
    const estado = plegarEventos(
      [evento({ tipo: "ajuste", jugador_id: null, lado_jugador: null, lado_punto: null, puntos_a: 5, puntos_b: 3, sets_a: 1, sets_b: 1 })],
      REGLAS
    );
    expect(estado.historial).toEqual([]);
  });

  it("adoptar un partido ya ganado lo deja terminado", () => {
    const estado = plegarEventos(
      [evento({ tipo: "ajuste", jugador_id: null, lado_jugador: null, lado_punto: null, puntos_a: 0, puntos_b: 0, sets_a: 2, sets_b: 0 })],
      REGLAS
    );
    expect(estado.terminado).toBe(true);
    expect(estado.winner).toBe("A");
  });
});

describe("estadísticas desde el log", () => {
  it("cada tipo suma a su métrica", () => {
    const stats = estadisticasDeEventos([
      evento({ tipo: "remate", jugador_id: 7, lado_jugador: "A", lado_punto: "A" }),
      evento({ tipo: "ace", jugador_id: 7, lado_jugador: "A", lado_punto: "A" }),
      evento({ tipo: "bloqueo", jugador_id: 7, lado_jugador: "A", lado_punto: "A" }),
      evento({ tipo: "defensa", jugador_id: 7, lado_jugador: "A", lado_punto: null })
    ]);

    expect(stats.get(7)).toEqual({ puntos: 3, remates: 1, bloqueos: 1, aces: 1, defensas: 1, errores: 0 });
  });

  /*
   * La invariante es «todo punto tiene una acción con un jugador detrás», no
   * «todo punto suma a la ficha de alguien». Un error da punto al rival y suma
   * a los errores de quien lo comete, sin regalarle puntos a nadie.
   */
  it("un error suma a errores y no da puntos a nadie", () => {
    const stats = estadisticasDeEventos([
      evento({ tipo: "error", jugador_id: 7, lado_jugador: "A", lado_punto: "B" })
    ]);

    expect(stats.get(7)).toMatchObject({ errores: 1, puntos: 0 });
    expect(stats.size).toBe(1);
  });

  it("una defensa no suma puntos, aunque el rally acabe bien", () => {
    const stats = estadisticasDeEventos([
      evento({ tipo: "defensa", jugador_id: 3, lado_jugador: "B", lado_punto: null })
    ]);
    expect(stats.get(3)).toMatchObject({ defensas: 1, puntos: 0 });
  });

  it("el ajuste no genera estadísticas de nadie", () => {
    const stats = estadisticasDeEventos([
      evento({ tipo: "ajuste", jugador_id: null, lado_jugador: null, lado_punto: null, puntos_a: 12, puntos_b: 9 })
    ]);
    expect(stats.size).toBe(0);
  });

  it("reparte por jugador", () => {
    const stats = estadisticasDeEventos([
      evento({ tipo: "remate", jugador_id: 1, lado_jugador: "A", lado_punto: "A" }),
      evento({ tipo: "remate", jugador_id: 2, lado_jugador: "B", lado_punto: "B" }),
      evento({ tipo: "remate", jugador_id: 1, lado_jugador: "A", lado_punto: "A" })
    ]);
    expect(stats.get(1)!.puntos).toBe(2);
    expect(stats.get(2)!.puntos).toBe(1);
  });
});

describe("el pliegue es determinista", () => {
  it("plegar dos veces la misma lista da lo mismo", () => {
    const lista = [...puntos("A", 21), ...puntos("B", 10)];
    expect(plegarEventos(lista, REGLAS)).toEqual(plegarEventos(lista, REGLAS));
  });

  it("sin eventos, el marcador está a cero", () => {
    expect(plegarEventos([], REGLAS)).toEqual(marcadorInicial());
  });
});
