import { describe, expect, it } from "vitest";
import { clasificacionDeGrupo, type PartidoClasificable } from "../../functions/_lib/clasificacion";
import {
  REGLAS_POR_DEFECTO,
  normalizarReglas,
  type CriterioDesempate,
  type ReglasClasificacion
} from "../../functions/_lib/reglas";
import { aClasificable, type PartidoVistaRow } from "../../functions/_lib/torneo-vista";

/*
 * La clasificación es lo único del torneo con reglas de verdad, y el desempate
 * por enfrentamiento directo es donde se rompen las implementaciones ingenuas:
 * comparar de dos en dos parece lo natural y produce ciclos.
 */

const EQUIPOS = [
  { id: 1, nombre: "Delfines" },
  { id: 2, nombre: "Gaviotas" },
  { id: 3, nombre: "Cangrejos" },
  { id: 4, nombre: "Percebes" }
];

const reglas = (desempates: CriterioDesempate[]): ReglasClasificacion => ({
  ...REGLAS_POR_DEFECTO.clasificacion,
  desempates
});

/** `a` gana a `b` 2-0 salvo que se pida el set decisivo. */
function partido(
  a: number,
  b: number,
  opciones: {
    setsA?: number;
    setsB?: number;
    puntosA?: number;
    puntosB?: number;
    setDecisivo?: boolean;
    status?: PartidoClasificable["status"];
  } = {}
): PartidoClasificable {
  return {
    equipoAId: a,
    equipoBId: b,
    setsA: opciones.setsA ?? 2,
    setsB: opciones.setsB ?? 0,
    puntosA: opciones.puntosA ?? 42,
    puntosB: opciones.puntosB ?? 30,
    setDecisivo: opciones.setDecisivo ?? false,
    status: opciones.status ?? "finished"
  };
}

const orden = (filas: { nombre: string }[]) => filas.map((f) => f.nombre);

describe("cifras básicas", () => {
  it("suma partidos, sets y puntos de los dos lados", () => {
    const tabla = clasificacionDeGrupo(
      EQUIPOS.slice(0, 2),
      [partido(1, 2, { setsA: 2, setsB: 1, puntosA: 50, puntosB: 44 })],
      reglas(["puntos"])
    );

    expect(tabla[0]).toMatchObject({
      nombre: "Delfines",
      jugados: 1,
      ganados: 1,
      perdidos: 0,
      setsAFavor: 2,
      setsEnContra: 1,
      puntosAFavor: 50,
      puntosEnContra: 44,
      puntos: 3
    });
    expect(tabla[1]).toMatchObject({ nombre: "Gaviotas", ganados: 0, perdidos: 1, puntos: 0 });
  });

  it("un partido en juego todavía no cuenta", () => {
    const tabla = clasificacionDeGrupo(
      EQUIPOS.slice(0, 2),
      [partido(1, 2, { status: "live" }), partido(1, 2, { status: "scheduled" })],
      reglas(["puntos"])
    );
    expect(tabla.every((f) => f.jugados === 0)).toBe(true);
  });

  it("ganar en el set decisivo puntúa menos, y perderlo puntúa algo", () => {
    const tabla = clasificacionDeGrupo(
      EQUIPOS.slice(0, 2),
      [partido(1, 2, { setsA: 2, setsB: 1, setDecisivo: true })],
      reglas(["puntos"])
    );
    expect(tabla[0]!.puntos).toBe(REGLAS_POR_DEFECTO.clasificacion.puntosVictoriaAjustada);
    expect(tabla[1]!.puntos).toBe(REGLAS_POR_DEFECTO.clasificacion.puntosDerrotaAjustada);
  });

  // Un partido contra alguien de otro grupo, o un bye, no puede alterar la tabla.
  it("ignora los partidos con un equipo que no está en el grupo", () => {
    const tabla = clasificacionDeGrupo(
      EQUIPOS.slice(0, 2),
      [partido(1, 99), partido(1, null as unknown as number)],
      reglas(["puntos"])
    );
    expect(tabla.every((f) => f.jugados === 0)).toBe(true);
  });
});

describe("desempates", () => {
  it("el orden de los criterios cambia la tabla", () => {
    /*
     * Delfines y Gaviotas empatan a puntos. Delfines ganó sin ceder un set pero
     * por poco margen; Gaviotas cedió uno y arrolló en puntos. Cada criterio los
     * ordena al revés que el otro, así que cuál va primero en la lista decide
     * quién va primero en la tabla.
     */
    const partidos = [
      partido(1, 3, { setsA: 2, setsB: 0, puntosA: 42, puntosB: 40 }),
      partido(2, 4, { setsA: 2, setsB: 1, puntosA: 60, puntosB: 50 })
    ];

    const porSets = clasificacionDeGrupo(EQUIPOS, partidos, reglas(["puntos", "ratio_sets"]));
    const porPuntos = clasificacionDeGrupo(EQUIPOS, partidos, reglas(["puntos", "ratio_puntos"]));

    expect(porSets[0]!.nombre).toBe("Delfines");
    expect(porPuntos[0]!.nombre).toBe("Gaviotas");
  });

  it("deja constancia de qué criterio deshizo el empate", () => {
    const partidos = [
      partido(1, 2, { setsA: 2, setsB: 0, puntosA: 42, puntosB: 20 }),
      partido(3, 4, { setsA: 2, setsB: 0, puntosA: 42, puntosB: 38 })
    ];
    const tabla = clasificacionDeGrupo(EQUIPOS, partidos, reglas(["puntos", "ratio_puntos"]));

    // Delfines y Cangrejos empataron a puntos; los separó el ratio.
    expect(tabla[0]!.desempatadoPor).toBe("ratio_puntos");
    // El primer criterio reparte posiciones, pero eso no es deshacer un empate.
    expect(tabla.every((f) => f.desempatadoPor !== "puntos")).toBe(true);
  });

  it("un empate que ningún criterio deshace queda ordenado por nombre", () => {
    const tabla = clasificacionDeGrupo(EQUIPOS, [], reglas(["puntos", "ratio_sets"]));
    expect(orden(tabla)).toEqual(["Cangrejos", "Delfines", "Gaviotas", "Percebes"]);
  });
});

/*
 * Con tres empatados, el enfrentamiento directo no se puede resolver comparando
 * de dos en dos: puede darse A gana a B, B gana a C y C gana a A, y entonces no
 * hay ningún orden coherente. Hay que rehacer la tabla con solo esos partidos.
 */
describe("triple empate por enfrentamiento directo", () => {
  const equipos = EQUIPOS.slice(0, 3);

  it("un ciclo A>B>C>A no cuelga y cae al criterio siguiente", () => {
    const partidos = [
      partido(1, 2, { setsA: 2, setsB: 1, puntosA: 40, puntosB: 38 }),
      partido(2, 3, { setsA: 2, setsB: 1, puntosA: 40, puntosB: 38 }),
      partido(3, 1, { setsA: 2, setsB: 1, puntosA: 40, puntosB: 38 })
    ];

    const tabla = clasificacionDeGrupo(
      equipos,
      partidos,
      reglas(["puntos", "enfrentamiento_directo", "ratio_puntos"])
    );

    // Los tres están perfectamente empatados en todo, así que el ciclo no separa
    // a nadie y el orden acaba siendo el estable por nombre.
    expect(tabla).toHaveLength(3);
    expect(orden(tabla)).toEqual(["Cangrejos", "Delfines", "Gaviotas"]);
  });

  it("cuando el minigrupo sí separa, manda el minigrupo y no la tabla general", () => {
    /*
     * Delfines, Gaviotas y Cangrejos forman un ciclo entre ellos y además le
     * ganan los tres a Percebes: dos victorias y una derrota cada uno, empatados
     * a puntos.
     *
     * Entre ellos, Delfines tiene el mejor ratio de puntos (le endosó un 42-10 a
     * Gaviotas). En la tabla general manda Cangrejos, por la paliza que le mete
     * a Percebes — y esa paliza es justo lo que el enfrentamiento directo tiene
     * que ignorar, porque Percebes no está en el empate.
     */
    const partidos = [
      partido(1, 2, { setsA: 2, setsB: 0, puntosA: 42, puntosB: 10 }),
      partido(2, 3, { setsA: 2, setsB: 1, puntosA: 40, puntosB: 39 }),
      partido(3, 1, { setsA: 2, setsB: 1, puntosA: 40, puntosB: 39 }),
      partido(1, 4, { setsA: 2, setsB: 0, puntosA: 21, puntosB: 20 }),
      partido(2, 4, { setsA: 2, setsB: 0, puntosA: 21, puntosB: 20 }),
      partido(3, 4, { setsA: 2, setsB: 0, puntosA: 42, puntosB: 2 })
    ];

    const conDirecto = clasificacionDeGrupo(
      EQUIPOS,
      partidos,
      reglas(["puntos", "enfrentamiento_directo", "ratio_puntos"])
    );
    const sinDirecto = clasificacionDeGrupo(EQUIPOS, partidos, reglas(["puntos", "ratio_puntos"]));

    expect(conDirecto.slice(0, 3).map((f) => f.nombre)).toEqual(["Delfines", "Cangrejos", "Gaviotas"]);
    expect(sinDirecto[0]!.nombre).toBe("Cangrejos");
    // Y el que deshizo el empate queda anotado, para poder explicarlo en la tabla.
    expect(conDirecto[0]!.desempatadoPor).toBe("enfrentamiento_directo");
  });

  it("sin partidos entre los empatados, el enfrentamiento directo no decide nada", () => {
    // Dos equipos empatados a puntos que nunca se han cruzado.
    const partidos = [
      partido(1, 3, { setsA: 2, setsB: 0, puntosA: 42, puntosB: 10 }),
      partido(2, 4, { setsA: 2, setsB: 0, puntosA: 42, puntosB: 30 })
    ];

    const tabla = clasificacionDeGrupo(
      EQUIPOS,
      partidos,
      reglas(["puntos", "enfrentamiento_directo", "ratio_puntos"])
    );

    // No cuelga y decide el ratio: Delfines encajó menos.
    expect(tabla[0]!.nombre).toBe("Delfines");
    expect(tabla[1]!.nombre).toBe("Gaviotas");
  });
});

describe("ratios sin dividir por cero", () => {
  it("no encajar ningún set es el mejor ratio posible, no un NaN", () => {
    const partidos = [
      partido(1, 2, { setsA: 2, setsB: 0, puntosA: 42, puntosB: 30 }),
      partido(3, 4, { setsA: 2, setsB: 1, puntosA: 42, puntosB: 40 })
    ];
    const tabla = clasificacionDeGrupo(EQUIPOS, partidos, reglas(["puntos", "ratio_sets"]));

    expect(tabla[0]!.nombre).toBe("Delfines");
    expect(tabla.every((f) => Number.isFinite(f.puntos))).toBe(true);
  });

  it("un equipo sin partidos no rompe el ratio", () => {
    const tabla = clasificacionDeGrupo(EQUIPOS, [], reglas(["puntos", "ratio_sets", "ratio_puntos"]));
    expect(tabla).toHaveLength(4);
    expect(tabla.map((f) => f.posicion)).toEqual([1, 2, 3, 4]);
  });
});

describe("posiciones", () => {
  it("van de 1 a N sin huecos ni repeticiones", () => {
    const partidos = [
      partido(1, 2),
      partido(3, 4),
      partido(1, 3, { setsA: 2, setsB: 1, setDecisivo: true }),
      partido(2, 4)
    ];
    const tabla = clasificacionDeGrupo(EQUIPOS, partidos, REGLAS_POR_DEFECTO.clasificacion);

    expect(tabla.map((f) => f.posicion)).toEqual([1, 2, 3, 4]);
    expect(new Set(tabla.map((f) => f.equipoId)).size).toBe(4);
  });
});

/*
 * Una trampa que hay que dejar clavada. `aClasificable` marca `setDecisivo`
 * comparando los sets jugados con `setsMaximos`, y con `sets: 1` ese máximo vale
 * 1: TODO partido a un set queda marcado como resuelto en el decisivo. No es un
 * fallo —un partido a un set se resuelve, literalmente, en el único set que
 * hay—, pero significa que un grupo que juegue a un set puntúa con los valores
 * «ajustados» y no con los normales.
 *
 * El grupo C de 2026 se montó así —cinco equipos a un set— y llevaba un bloque
 * `clasificacion` propio para compensarlo; dejó de jugarse a un set al retirarse
 * un equipo. Los tests se quedan: el mecanismo sigue en `_lib/reglas.ts` y
 * cualquier grupo puede volver a usarlo. Sin ellos, alguien «arregla»
 * setDecisivo algún día y ese grupo empieza a puntuar mal en silencio.
 */
describe("un partido a un solo set", () => {
  const partidoAUnSet = (reglas: unknown): PartidoVistaRow => ({
    id: "p1",
    ronda: "Grupo · partido 1",
    fase_id: 1,
    grupo_id: 1,
    ronda_orden: null,
    posicion: null,
    equipo_a_id: 10,
    equipo_b_id: 20,
    equipo_a_nombre: "Uno",
    equipo_b_nombre: "Dos",
    scheduled_at: null,
    pista: null,
    status: "finished",
    sets_a: 1,
    sets_b: 0,
    points_a: 21,
    points_b: 15,
    set_history: JSON.stringify([{ a: 21, b: 15 }]),
    winner: "A",
    reglas: JSON.stringify(reglas),
    siguiente_partido_id: null,
    perdedor_partido_id: null,
    tiene_log: 0
  });

  const equipos = [
    { id: 10, nombre: "Uno" },
    { id: 20, nombre: "Dos" }
  ];

  const SIN_OVERRIDE = { partido: { sets: 1, puntosPorSet: 21, puntosSetDecisivo: 15, diferencia: 2 } };
  const CON_BLOQUE_PROPIO = {
    ...SIN_OVERRIDE,
    clasificacion: {
      puntosVictoria: 3,
      puntosDerrota: 0,
      puntosVictoriaAjustada: 3,
      puntosDerrotaAjustada: 0,
      desempates: ["puntos", "ratio_puntos"]
    }
  };

  const puntosDe = (reglas: unknown) => {
    const tabla = clasificacionDeGrupo(
      equipos,
      [aClasificable(partidoAUnSet(reglas))],
      normalizarReglas(reglas).clasificacion
    );
    return {
      ganador: tabla.find((f) => f.equipoId === 10)!.puntos,
      perdedor: tabla.find((f) => f.equipoId === 20)!.puntos
    };
  };

  it("siempre cuenta como resuelto en el set decisivo", () => {
    expect(aClasificable(partidoAUnSet(SIN_OVERRIDE)).setDecisivo).toBe(true);
  });

  it("por eso, sin bloque de clasificación propio, puntúa 2-1 en vez de 3-0", () => {
    expect(puntosDe(SIN_OVERRIDE)).toEqual({ ganador: 2, perdedor: 1 });
  });

  it("con un bloque de clasificación propio, vuelve a puntuar 3-0", () => {
    expect(puntosDe(CON_BLOQUE_PROPIO)).toEqual({ ganador: 3, perdedor: 0 });
  });
});
