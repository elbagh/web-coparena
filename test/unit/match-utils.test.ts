// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { REGLAS_POR_DEFECTO } from "../../functions/_lib/reglas";
import { cargarScriptPublico } from "../helpers/dom";

interface Marcador {
  A: number;
  B: number;
}

interface Partido {
  id: string;
  status: "scheduled" | "live" | "finished";
  setNumber: number;
  points: Marcador;
  sets: Marcador;
  history: Marcador[];
  startedAt: string | null;
  elapsedMs: number;
  winner: "A" | "B" | null;
  teams: { A: { id: number | null; name: string }; B: { id: number | null; name: string } };
  /* Los trae el servidor desde la fase del partido; sin ellas se usan las de serie. */
  reglas?: ReglasPartido;
  /* Sitio en el cuadro. Un partido de liga no los tiene. */
  rondaOrden?: number | null;
  posicion?: number | null;
  ronda?: string;
}

interface ReglasPartido {
  sets: number;
  puntosPorSet: number;
  puntosSetDecisivo: number;
  diferencia: number;
}

interface Utilidades {
  createDraw(equipos: { id: number | null; name: string }[]): Partido[];
  applyPoint(partido: Partido, equipo: "A" | "B", delta: number): Partido;
  elapsed(partido: Partido): number;
  formatClock(ms: number): string;
  statusLabel(status: string): string;
  reglasDe(partido: Partial<Partido>): ReglasPartido;
  setTarget(partido: Partial<Partido>, setNumber?: number): number;
  renderBracket(destino: HTMLElement, partidos: Partial<Partido>[], onOpen?: (p: Partido) => void): boolean;
  clone<T>(valor: T): T;
}

let utils: Utilidades;

beforeAll(() => {
  utils = cargarScriptPublico<Utilidades>("match-utils.js", "CopaArenaMatches");
});

const partido = (extra: Partial<Partido> = {}): Partido => ({
  id: "p1",
  status: "scheduled",
  setNumber: 1,
  points: { A: 0, B: 0 },
  sets: { A: 0, B: 0 },
  history: [],
  startedAt: null,
  elapsedMs: 0,
  winner: null,
  teams: { A: { id: 1, name: "Delfines" }, B: { id: 2, name: "Gaviotas" } },
  ...extra
});

/** Suma `veces` puntos seguidos al equipo indicado. */
const sumar = (p: Partido, equipo: "A" | "B", veces: number): Partido => {
  let actual = p;
  for (let i = 0; i < veces; i++) actual = utils.applyPoint(actual, equipo, 1);
  return actual;
};

describe("applyPoint: puntuación básica", () => {
  it("suma y resta puntos", () => {
    const uno = utils.applyPoint(partido(), "A", 1);
    expect(uno.points).toEqual({ A: 1, B: 0 });
    expect(utils.applyPoint(uno, "A", -1).points).toEqual({ A: 0, B: 0 });
  });

  it("no deja bajar de cero", () => {
    expect(utils.applyPoint(partido(), "A", -1).points.A).toBe(0);
  });

  it("no muta el partido de entrada", () => {
    const original = partido();
    utils.applyPoint(original, "A", 1);
    expect(original.points).toEqual({ A: 0, B: 0 });
  });

  it("un partido terminado ignora puntos nuevos", () => {
    const terminado = partido({ status: "finished", winner: "A", points: { A: 5, B: 3 } });
    expect(utils.applyPoint(terminado, "B", 1).points).toEqual({ A: 5, B: 3 });
  });
});

describe("applyPoint: cierre de set", () => {
  it("los sets 1 y 2 se juegan a 21", () => {
    const enSet1 = sumar(partido({ points: { A: 20, B: 0 } }), "A", 1);
    expect(enSet1.sets).toEqual({ A: 1, B: 0 });
    expect(enSet1.setNumber).toBe(2);
    expect(enSet1.points).toEqual({ A: 0, B: 0 });

    const enSet2 = sumar(partido({ setNumber: 2, points: { A: 20, B: 0 }, sets: { A: 0, B: 1 } }), "A", 1);
    expect(enSet2.sets).toEqual({ A: 1, B: 1 });
  });

  it("el tercer set se juega a 15", () => {
    const tercero = sumar(partido({ setNumber: 3, points: { A: 14, B: 0 }, sets: { A: 1, B: 1 } }), "A", 1);
    expect(tercero.sets.A).toBe(2);
    expect(tercero.status).toBe("finished");
  });

  it("exige dos puntos de diferencia: 21-20 no cierra, 22-20 sí", () => {
    const empatadoArriba = sumar(partido({ points: { A: 20, B: 20 } }), "A", 1);
    expect(empatadoArriba.points).toEqual({ A: 21, B: 20 });
    expect(empatadoArriba.sets).toEqual({ A: 0, B: 0 });

    const cerrado = sumar(empatadoArriba, "A", 1);
    expect(cerrado.points).toEqual({ A: 0, B: 0 });
    expect(cerrado.sets).toEqual({ A: 1, B: 0 });
  });

  it("cierra con 21-19 y guarda el resultado en el historial", () => {
    const cerrado = sumar(partido({ points: { A: 20, B: 19 } }), "A", 1);
    expect(cerrado.history).toEqual([{ a: 21, b: 19 }]);
  });

  it("restar un punto nunca cierra un set", () => {
    const alBorde = partido({ points: { A: 25, B: 10 } });
    expect(utils.applyPoint(alBorde, "B", -1).sets).toEqual({ A: 0, B: 0 });
  });
});

describe("applyPoint: fin de partido", () => {
  it("gana quien llega a dos sets y queda marcado como finished", () => {
    const primerSet = sumar(partido({ points: { A: 20, B: 0 } }), "A", 1);
    const segundoSet = sumar({ ...primerSet, points: { A: 20, B: 0 } }, "A", 1);

    expect(segundoSet.sets).toEqual({ A: 2, B: 0 });
    expect(segundoSet.status).toBe("finished");
    expect(segundoSet.winner).toBe("A");
  });

  it("con un set cada uno el partido sigue vivo", () => {
    const uno = sumar(partido({ points: { A: 20, B: 0 } }), "A", 1);
    const dos = sumar({ ...uno, points: { A: 0, B: 20 } }, "B", 1);
    expect(dos.sets).toEqual({ A: 1, B: 1 });
    expect(dos.status).not.toBe("finished");
    expect(dos.setNumber).toBe(3);
  });
});

describe("elapsed y formatClock", () => {
  it("un partido que no está en juego devuelve el tiempo acumulado", () => {
    expect(utils.elapsed(partido({ elapsedMs: 5000 }))).toBe(5000);
    expect(utils.elapsed(partido({ status: "finished", elapsedMs: 5000, startedAt: new Date().toISOString() }))).toBe(5000);
  });

  it("un partido en juego suma el tiempo desde startedAt", () => {
    const hace10s = new Date(Date.now() - 10_000).toISOString();
    const transcurrido = utils.elapsed(partido({ status: "live", startedAt: hace10s, elapsedMs: 1000 }));
    expect(transcurrido).toBeGreaterThanOrEqual(11_000);
    expect(transcurrido).toBeLessThan(13_000);
  });

  it("un partido en juego sin startedAt no suma nada", () => {
    expect(utils.elapsed(partido({ status: "live", elapsedMs: 2000 }))).toBe(2000);
  });

  it("formatClock pinta mm:ss con relleno", () => {
    expect(utils.formatClock(0)).toBe("00:00");
    expect(utils.formatClock(65_000)).toBe("01:05");
    expect(utils.formatClock(3_600_000)).toBe("60:00");
  });
});

describe("createDraw", () => {
  it("empareja de dos en dos y descarta el sobrante impar", () => {
    const equipos = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `Equipo ${i + 1}` }));
    const partidos = utils.createDraw(equipos);
    expect(partidos).toHaveLength(2);
    partidos.forEach((p) => {
      expect(p.teams.A).toBeTruthy();
      expect(p.teams.B).toBeTruthy();
      expect(p.status).toBe("scheduled");
    });
  });

  it("no repite ningún equipo dentro del sorteo", () => {
    const equipos = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `Equipo ${i + 1}` }));
    const nombres = utils.createDraw(equipos).flatMap((p) => [p.teams.A.name, p.teams.B.name]);
    expect(new Set(nombres).size).toBe(8);
  });

  it("no altera el array de equipos que recibe", () => {
    const equipos = [
      { id: 1, name: "Uno" },
      { id: 2, name: "Dos" }
    ];
    const copia = [...equipos];
    utils.createDraw(equipos);
    expect(equipos).toEqual(copia);
  });
});

describe("statusLabel", () => {
  it("traduce los tres estados", () => {
    expect(utils.statusLabel("live")).toBe("Jugando");
    expect(utils.statusLabel("finished")).toBe("Terminado");
    expect(utils.statusLabel("scheduled")).toBe("Programado");
  });
});

/*
 * Las reglas dejan de estar escritas a mano en el cliente y viajan con cada
 * partido. Los 21/21/15 que quedan aquí son solo la red por si un partido viejo
 * llega sin ellas, y este bloque comprueba que esa red vale lo mismo que la del
 * servidor: si una cambia y la otra no, el marcador del panel y el de la base
 * dejarían de cerrar los sets a la vez.
 */
describe("las reglas vienen con el partido", () => {
  it("la red del cliente vale lo mismo que la del servidor", () => {
    expect(utils.reglasDe({})).toEqual(REGLAS_POR_DEFECTO.partido);
  });

  it("un partido con reglas propias se arbitra con las suyas", () => {
    const corto = partido({ reglas: { sets: 1, puntosPorSet: 15, puntosSetDecisivo: 15, diferencia: 1 } });
    expect(utils.setTarget(corto, 1)).toBe(15);

    const enPunto = utils.applyPoint({ ...corto, status: "live", points: { A: 14, B: 14 } }, "A", 1);
    // Con diferencia 1, 15-14 ya cierra el set... y con sets 1, el partido.
    expect(enPunto.sets.A).toBe(1);
    expect(enPunto.status).toBe("finished");
  });

  it("sin reglas propias sigue siendo 21, 21 y el tercero a 15", () => {
    expect(utils.setTarget(partido(), 1)).toBe(21);
    expect(utils.setTarget(partido(), 3)).toBe(15);
  });
});

/*
 * El cuadro se dibuja con lo que hay. La versión anterior cogía los ocho
 * primeros partidos de la lista y fabricaba semifinales y final que no existían
 * en la base: con doce equipos, o con fase de grupos, enseñaba un cuadro que no
 * era el del torneo.
 */
describe("renderBracket dibuja desde los datos", () => {
  const delCuadro = (rondaOrden: number, posicion: number, ronda: string, nombreA: string, nombreB: string) =>
    partido({
      id: `${rondaOrden}-${posicion}`,
      rondaOrden,
      posicion,
      ronda,
      teams: { A: { id: null, name: nombreA }, B: { id: null, name: nombreB } }
    } as Partial<Partido>);

  it("pinta una columna por ronda, en orden", () => {
    const destino = document.createElement("div");
    const pintado = utils.renderBracket(destino, [
      delCuadro(1, 0, "Final", "", ""),
      delCuadro(0, 0, "Semifinales", "Delfines", "Gaviotas"),
      delCuadro(0, 1, "Semifinales", "Cangrejos", "Percebes")
    ]);

    expect(pintado).toBe(true);
    const titulos = [...destino.querySelectorAll("h3")].map((h) => h.textContent);
    expect(titulos).toEqual(["Semifinales", "Final"]);
    expect(destino.querySelectorAll(".bracket-round")).toHaveLength(2);
  });

  it("un cuadro de 4 no inventa rondas ni rivales", () => {
    const destino = document.createElement("div");
    utils.renderBracket(destino, [
      delCuadro(0, 0, "Semifinales", "Delfines", "Gaviotas"),
      delCuadro(0, 1, "Semifinales", "Cangrejos", "Percebes"),
      delCuadro(1, 0, "Final", "", "")
    ]);

    // Tres partidos y dos rondas: exactamente los que hay en la base.
    expect(destino.querySelectorAll(".bracket-match")).toHaveLength(3);
    expect(destino.querySelectorAll(".bracket-round")).toHaveLength(2);
    /*
     * La versión anterior rellenaba los huecos vacíos con etiquetas fabricadas
     * («Semifinal 1», «Semifinal 2»), que parecían equipos. Un hueco sin
     * resolver dice «Por decidir», que es la verdad.
     */
    expect(destino.textContent).not.toMatch(/Semifinal \d/);
  });

  it("sin partidos de cuadro no pinta nada y lo dice", () => {
    const destino = document.createElement("div");
    // Los de una liga no tienen ronda ni posición: no forman árbol.
    expect(utils.renderBracket(destino, [partido(), partido()])).toBe(false);
    expect(destino.children).toHaveLength(0);
  });
});
