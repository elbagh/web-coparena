import { describe, expect, it } from "vitest";
import {
  TIPOS,
  aplicarPunto,
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
  tipo: "punto",
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
const puntos = (lado: "A" | "B", veces: number, tipo: TipoEvento = "punto"): EventoFila[] =>
  Array.from({ length: veces }, () => evento({ tipo, lado_jugador: lado, lado_punto: lado }));

describe("ladoDelPunto", () => {
  /*
   * El único caso en que el lado de quien hace la acción y el lado que se lleva
   * el punto no coinciden. Es la razón de que la fila guarde los dos lados: con
   * uno solo y el otro deducido, el fallo no se vería hasta el final del torneo.
   */
  it("el saque fallado da el punto al rival", () => {
    expect(ladoDelPunto("saque_fallado", "A")).toBe("B");
    expect(ladoDelPunto("saque_fallado", "B")).toBe("A");
  });

  it("un punto y un ace son de quien los hace", () => {
    for (const tipo of ["punto", "ace"] as TipoEvento[]) {
      expect(ladoDelPunto(tipo, "A")).toBe("A");
      expect(ladoDelPunto(tipo, "B")).toBe("B");
    }
  });

  /*
   * Bloqueo y chilena no las decide el tipo: las decide quien anota, rally a
   * rally. Sin respuesta no hay punto — no se adivina, porque adivinar aquí es
   * inventar marcador.
   */
  it("bloqueo y chilena puntúan sólo si se dice que sí", () => {
    for (const tipo of ["bloqueo", "chilena"] as TipoEvento[]) {
      expect(ladoDelPunto(tipo, "A", true)).toBe("A");
      expect(ladoDelPunto(tipo, "A", false)).toBeNull();
      expect(ladoDelPunto(tipo, "A")).toBeNull();
    }
  });

  it("el ajuste no es un punto", () => {
    expect(ladoDelPunto("ajuste", "A", true)).toBeNull();
  });

  /*
   * El ajuste es un saldo de apertura, no una acción: nadie lo pulsa, así que no
   * puede salir en la botonera. Es el único tipo que existe sin estar en TIPOS.
   */
  it("TIPOS son las cinco acciones que se pueden anotar, y no el ajuste", () => {
    expect(TIPOS.map((t) => t.clave)).toEqual(["punto", "ace", "saque_fallado", "bloqueo", "chilena"]);
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

describe("el pliegue es determinista", () => {
  it("plegar dos veces la misma lista da lo mismo", () => {
    const lista = [...puntos("A", 21), ...puntos("B", 10)];
    expect(plegarEventos(lista, REGLAS)).toEqual(plegarEventos(lista, REGLAS));
  });

  it("sin eventos, el marcador está a cero", () => {
    expect(plegarEventos([], REGLAS)).toEqual(marcadorInicial());
  });
});
