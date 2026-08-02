// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cargarScriptPublico, ejecutarScriptPublico } from "../helpers/dom";

/*
 * Lo que pinta /torneo/ en la tabla de un grupo. Importa porque quién pasa de
 * ronda es la lectura principal de una clasificación, y desde que hay repesca
 * son dos condiciones y no una: pasar directo depende solo de tu grupo, pasar
 * por repesca depende de cómo queden los demás.
 *
 * El script es un IIFE que se carga con <script is:inline>, así que se evalúa
 * sobre un DOM montado a mano, igual que el resto de tests de public/assets/.
 */

const MARCADO = `
  <div data-torneo>
    <p data-torneo-status hidden></p>
    <button data-torneo-retry hidden>Reintentar</button>
    <p data-torneo-lede></p>
    <p data-torneo-directo hidden>
      Se está jugando ahora: <a href="/directo/" data-torneo-directo-enlace>ver el directo</a>
    </p>
    <div data-torneo-fases></div>
    <section data-torneo-sueltos hidden><div data-torneo-sueltos-lista></div></section>
  </div>
`;

/** Una fila de clasificación con lo justo para que la tabla la pinte. */
const fila = (posicion: number, nombre: string, clasifica: string | null) => ({
  posicion,
  equipoId: posicion * 10,
  nombre,
  jugados: 3,
  ganados: 3 - posicion,
  perdidos: posicion - 1,
  setsAFavor: 6,
  setsEnContra: 2,
  puntosAFavor: 90,
  puntosEnContra: 70,
  puntos: 9 - posicion * 3,
  desempatadoPor: null,
  clasifica
});

const respuestaTorneo = (fase: Record<string, unknown>) => ({
  fases: [fase],
  sueltos: [],
  edicion: { anio: 2026, nombre: "La Copa Arena 2026" }
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.innerHTML = MARCADO;

  // Las fechas las formatea match-utils.js, que en la página va antes. Se carga
  // el de verdad: la cabecera de cada columna se apoya en él para decidir si
  // una sola fecha vale para todos los partidos del grupo.
  cargarScriptPublico("match-utils.js", "CopaArenaMatches");

  // El script llama a estos tres sin comprobar que existan: BaseLayout garantiza
  // que directo.js va antes, y si eso cambia hay que enterarse.
  (window as unknown as Record<string, unknown>).CopaDirecto = {
    suscribir: vi.fn(),
    refrescarAhora: vi.fn(),
    mirandoDeCerca: vi.fn()
  };
  (window as unknown as Record<string, unknown>).IntersectionObserver = class {
    observe() {}
    disconnect() {}
  };

  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** Deja correr el `cargar()` que el script lanza al evaluarse. */
const pintado = async () => {
  ejecutarScriptPublico("torneo-page.js");
  await vi.waitFor(() => {
    if (document.querySelectorAll(".torneo-tabla tbody tr").length === 0) {
      throw new Error("todavía no ha pintado");
    }
  });
};

const responder = (fase: Record<string, unknown>) => {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => respuestaTorneo(fase)
  });
};

describe("la tabla de un grupo en /torneo/", () => {
  const grupo = (extra: Record<string, unknown> = {}) => ({
    id: 1,
    nombre: "Grupo A",
    orden: 0,
    clasifican: 2,
    enRepesca: true,
    equipos: [{ id: 10 }, { id: 20 }, { id: 30 }],
    clasificacion: [
      fila(1, "Calvos de Orion", "directo"),
      fila(2, "Bye Bye Bye", "directo"),
      fila(3, "Free Copa Arena", "repesca")
    ],
    ...extra
  });

  const fase = (extra: Record<string, unknown> = {}, grupoExtra: Record<string, unknown> = {}) => ({
    id: 1,
    clave: "grupos",
    nombre: "Fase de grupos",
    tipo: "grupos",
    orden: 0,
    clasifican: 2,
    repesca: 1,
    partidos: [],
    grupos: [grupo(grupoExtra)],
    ...extra
  });

  it("da clases distintas a quien pasa directo y a quien pasa por repesca", async () => {
    responder(fase());
    await pintado();

    const filas = [...document.querySelectorAll(".torneo-tabla tbody tr")];
    expect(filas[0]!.classList.contains("is-directo")).toBe(true);
    expect(filas[1]!.classList.contains("is-directo")).toBe(true);
    expect(filas[2]!.classList.contains("is-repesca")).toBe(true);
    // Y la clase vieja, que significaba las dos cosas a la vez, ya no se usa.
    expect(document.querySelectorAll(".is-clasificado")).toHaveLength(0);
  });

  it("no pinta nada a quien no pasa", async () => {
    responder(
      fase(
        {},
        {
          clasificacion: [
            fila(1, "Calvos de Orion", "directo"),
            fila(2, "Bye Bye Bye", "directo"),
            fila(3, "Free Copa Arena", null)
          ]
        }
      )
    );
    await pintado();

    const tercera = [...document.querySelectorAll(".torneo-tabla tbody tr")][2]!;
    expect(tercera.classList.contains("is-directo")).toBe(false);
    expect(tercera.classList.contains("is-repesca")).toBe(false);
  });

  it("da su propia clase a los dos que se juegan la repesca", async () => {
    responder(
      fase(
        {},
        {
          clasificacion: [
            fila(1, "Calvos de Orion", "directo"),
            fila(2, "Bye Bye Bye", "directo"),
            fila(3, "Free Copa Arena", "aspirante")
          ]
        }
      )
    );
    await pintado();

    const tercera = [...document.querySelectorAll(".torneo-tabla tbody tr")][2]!;
    expect(tercera.classList.contains("is-aspirante")).toBe(true);
    expect(tercera.classList.contains("is-repesca")).toBe(false);
  });

  /*
   * El color es lo que se ve, pero no puede ser lo único que lo diga: sin este
   * texto, quien no distingue el verde del ámbar tiene una tabla en la que no
   * pasa nada.
   */
  it("cada fila con color lleva escrito lo que ese color significa", async () => {
    responder(
      fase(
        {},
        {
          clasificacion: [
            fila(1, "Calvos de Orion", "directo"),
            fila(2, "Bye Bye Bye", "repesca"),
            fila(3, "Free Copa Arena", "aspirante")
          ]
        }
      )
    );
    await pintado();

    const textos = [...document.querySelectorAll(".torneo-tabla tbody tr")].map(
      (tr) => tr.querySelector(".sr-only")?.textContent?.trim() ?? ""
    );
    expect(textos[0]).toBe("Pasa al cuadro.");
    expect(textos[1]).toBe("Ahora mismo ocupa la plaza de repesca.");
    expect(textos[2]).toBe("Se juega la plaza de repesca.");
  });

  it("la nota del grupo se queda en su cupo, que es lo que cambia de un grupo a otro", async () => {
    responder(fase());
    await pintado();

    const nota = [...document.querySelectorAll(".torneo-nota")].map((n) => n.textContent).join(" ");
    expect(nota).toContain("Pasan los 2 primeros.");
    // Lo de la repesca lo cuenta la leyenda, una vez, y no cada columna.
    expect(nota).not.toContain("se decide");
  });

  it("un grupo con su propio cupo lo dice, y no el de la fase", async () => {
    responder(fase({}, { clasifican: 3, enRepesca: false }));
    await pintado();

    const nota = [...document.querySelectorAll(".torneo-nota")].map((n) => n.textContent).join(" ");
    expect(nota).toContain("Pasan los 3 primeros.");
  });

  it("la leyenda explica los dos colores una sola vez para toda la fase", async () => {
    responder(fase());
    await pintado();

    const leyendas = document.querySelectorAll(".torneo-leyenda");
    expect(leyendas).toHaveLength(1);
    expect(leyendas[0]!.textContent).toContain("Pasa al cuadro");
    expect(leyendas[0]!.textContent).toContain("Se juega la última plaza");
    expect(document.querySelectorAll(".torneo-leyenda-muestra.is-repesca")).toHaveLength(1);
  });

  it("sin repesca en la fase, la leyenda se queda solo con el verde", async () => {
    responder(fase({ repesca: 0 }));
    await pintado();

    const leyenda = document.querySelector(".torneo-leyenda")!;
    expect(leyenda.textContent).toContain("Pasa al cuadro");
    expect(leyenda.textContent).not.toContain("plaza");
    expect(document.querySelectorAll(".torneo-leyenda-muestra.is-repesca")).toHaveLength(0);
  });

  it("si ningún grupo entra al bote, tampoco se anuncia la repesca", async () => {
    responder(fase({}, { enRepesca: false }));
    await pintado();

    expect(document.querySelectorAll(".torneo-leyenda-muestra.is-repesca")).toHaveLength(0);
  });
});

/*
 * Cada grupo es una columna: su clasificación y debajo sus partidos, que son
 * los de una sola tarde. De ahí que la fecha y la pista suban a la cabecera
 * cuando toda la columna las comparte — repetidas en cada tarjeta eran una
 * línea por partido para decir seis veces lo mismo.
 */
describe("los grupos en columnas", () => {
  const utils = () => (window as unknown as { CopaArenaMatches: Record<string, (v: string) => string> }).CopaArenaMatches;

  const partido = (id: string, ronda: string, scheduledAt: string, extra: Record<string, unknown> = {}) => ({
    id,
    ronda,
    grupoId: 1,
    rondaOrden: null,
    posicion: null,
    scheduledAt,
    pista: "Pista central",
    status: "scheduled",
    sets: { A: 0, B: 0 },
    points: { A: 0, B: 0 },
    history: [],
    winner: null,
    teams: { A: { id: 10, name: "Calvos de Orion" }, B: { id: 20, name: "Bye Bye Bye" } },
    ...extra
  });

  const grupoConPartidos = (nombre: string, id: number) => ({
    id,
    nombre,
    orden: 0,
    clasifican: 2,
    enRepesca: true,
    equipos: [{ id: 10 }, { id: 20 }],
    clasificacion: [fila(1, "Calvos de Orion", "directo"), fila(2, "Bye Bye Bye", null)]
  });

  const faseCon = (grupos: Record<string, unknown>[], partidos: Record<string, unknown>[]) => ({
    id: 1,
    clave: "grupos",
    nombre: "Fase de grupos",
    tipo: "grupos",
    orden: 0,
    clasifican: 2,
    repesca: 1,
    grupos,
    partidos
  });

  it("mete un bloque por grupo en la rejilla", async () => {
    responder(
      faseCon([grupoConPartidos("A", 1), grupoConPartidos("B", 2), grupoConPartidos("C", 3)], [])
    );
    await pintado();

    const rejilla = document.querySelectorAll(".torneo-grupos");
    expect(rejilla).toHaveLength(1);
    expect(rejilla[0]!.querySelectorAll(".torneo-grupo-publico")).toHaveLength(3);
    expect(document.querySelector(".torneo-grupo-letra")!.textContent).toBe("A");
  });

  it("sube la fecha y la pista a la cabecera y deja en la tarjeta solo la hora", async () => {
    const primero = "2026-08-01T16:30";
    responder(
      faseCon(
        [grupoConPartidos("A", 1)],
        [partido("p1", "A · jornada 1", primero), partido("p2", "A · jornada 2", "2026-08-01T17:20")]
      )
    );
    await pintado();

    const cabecera = document.querySelector(".torneo-grupo-cuando")!;
    expect(cabecera.textContent).toContain(utils().formatDate(primero));
    expect(cabecera.textContent).toContain("Pista central");

    const horas = [...document.querySelectorAll(".torneo-partido-hora")].map((n) => n.textContent);
    expect(horas).toEqual([utils().formatTime(primero), utils().formatTime("2026-08-01T17:20")]);
    // Y no la fecha larga, que es de lo que se trataba.
    expect(horas[0]).not.toBe(utils().formatDateTime(primero));
    // La pista se dice una vez, arriba, y no una por partido.
    expect(document.body.textContent!.match(/Pista central/g)).toHaveLength(1);
  });

  it("si el grupo se parte en dos tardes, cada partido recupera su fecha", async () => {
    const primero = "2026-08-01T16:30";
    responder(
      faseCon(
        [grupoConPartidos("A", 1)],
        [partido("p1", "A · jornada 1", primero), partido("p2", "A · jornada 2", "2026-08-02T17:20")]
      )
    );
    await pintado();

    expect(document.querySelector(".torneo-grupo-cuando")).toBeNull();
    const horas = [...document.querySelectorAll(".torneo-partido-hora")].map((n) => n.textContent);
    expect(horas[0]).toBe(utils().formatDateTime(primero));
  });

  it("la tarjeta no repite el nombre del grupo, que ya está en la cabecera", async () => {
    responder(faseCon([grupoConPartidos("A", 1)], [partido("p1", "A · jornada 1", "2026-08-01T16:30")]));
    await pintado();

    const meta = document.querySelector(".torneo-partido.is-compacto .torneo-partido-meta")!;
    expect(meta.textContent).toContain("jornada 1");
    expect(meta.textContent).not.toContain("A · jornada 1");
  });

  it("una ronda que no empieza por el nombre del grupo se deja tal cual", async () => {
    responder(faseCon([grupoConPartidos("A", 1)], [partido("p1", "Repesca", "2026-08-01T16:30")]));
    await pintado();

    const meta = document.querySelector(".torneo-partido.is-compacto .torneo-partido-meta")!;
    expect(meta.textContent).toContain("Repesca");
  });
});

describe("los partidos de un grupo en /torneo/", () => {
  const grupo = {
    id: 1,
    nombre: "Grupo A",
    orden: 0,
    clasifican: 2,
    enRepesca: false,
    equipos: [{ id: 10 }, { id: 20 }, { id: 30 }, { id: 40 }],
    clasificacion: [
      fila(1, "Calvos de Orion", "directo"),
      fila(2, "Bye Bye Bye", "directo"),
      fila(3, "Free Copa Arena", null),
      fila(4, "Croquetillas de Arena", null)
    ]
  };

  const partido = (equipoA: string, equipoB: string, scheduledAt: string | null) => ({
    id: `${equipoA}-${equipoB}`,
    ronda: "A · jornada",
    grupoId: 1,
    scheduledAt,
    status: "scheduled",
    winner: null,
    history: [],
    teams: { A: { name: equipoA }, B: { name: equipoB } }
  });

  // El orden llega tal y como quedó el sorteo (por jornada), que no tiene por
  // qué coincidir con el orden cronológico tras cambiar una hora a mano.
  it("pinta los partidos por hora, no por el orden en que llegan", async () => {
    responder({
      id: 1,
      clave: "grupos",
      nombre: "Fase de grupos",
      tipo: "grupos",
      orden: 0,
      clasifican: 2,
      repesca: 0,
      grupos: [grupo],
      partidos: [
        partido("Calvos de Orion", "Bye Bye Bye", "2026-08-01T20:40"),
        partido("Free Copa Arena", "Croquetillas de Arena", "2026-08-01T19:50")
      ]
    });
    await pintado();

    const cruces = [...document.querySelectorAll(".torneo-partido")].map((tarjeta) =>
      [...tarjeta.querySelectorAll(".torneo-partido-equipo")].map((e) => e.textContent).join(" vs ")
    );
    expect(cruces).toEqual(["Free Copa Arena vs Croquetillas de Arena", "Calvos de Orion vs Bye Bye Bye"]);
  });

  it("deja los partidos sin hora al final, no al principio", async () => {
    responder({
      id: 1,
      clave: "grupos",
      nombre: "Fase de grupos",
      tipo: "grupos",
      orden: 0,
      clasifican: 2,
      repesca: 0,
      grupos: [grupo],
      partidos: [
        partido("Calvos de Orion", "Bye Bye Bye", null),
        partido("Free Copa Arena", "Croquetillas de Arena", "2026-08-01T19:50")
      ]
    });
    await pintado();

    const cruces = [...document.querySelectorAll(".torneo-partido")].map((tarjeta) =>
      [...tarjeta.querySelectorAll(".torneo-partido-equipo")].map((e) => e.textContent).join(" vs ")
    );
    expect(cruces).toEqual(["Free Copa Arena vs Croquetillas de Arena", "Calvos de Orion vs Bye Bye Bye"]);
  });
});

/*
 * La puerta al historial de un partido. El enlace sólo existe cuando hay algo que
 * abrir: `conHistorial` sale de que el partido tenga log de anotación, no de que
 * esté terminado. Un partido llevado a mano desde el panel no tiene nada que
 * recorrer, y un enlace a una página que va a decir «no se anotó punto a punto»
 * es peor que ningún enlace.
 */
describe("el enlace a cómo fue un partido", () => {
  const suelto = (extra: Record<string, unknown> = {}) => ({
    id: "p-1",
    ronda: "Final",
    grupoId: null,
    scheduledAt: null,
    status: "finished",
    winner: "A",
    sets: { A: 2, B: 0 },
    history: [{ a: 21, b: 18 }],
    teams: { A: { name: "Calvos de Orion" }, B: { name: "Bye Bye Bye" } },
    conHistorial: true,
    ...extra
  });

  const responderSueltos = (partidos: Record<string, unknown>[]) => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ fases: [], sueltos: partidos, edicion: { anio: 2026, nombre: "La Copa Arena 2026" } })
    });
  };

  const pintadoSuelto = async () => {
    ejecutarScriptPublico("torneo-page.js");
    await vi.waitFor(() => {
      if (document.querySelectorAll(".torneo-partido").length === 0) throw new Error("todavía no ha pintado");
    });
  };

  it("aparece en un partido terminado que se anotó, y apunta a su historial", async () => {
    responderSueltos([suelto()]);
    await pintadoSuelto();

    const enlace = document.querySelector(".torneo-partido-historial") as HTMLAnchorElement;
    expect(enlace).not.toBeNull();
    expect(enlace.textContent).toBe("Cómo fue");
    expect(enlace.getAttribute("href")).toBe("/torneo/partido/?p=p-1");
  });

  it("no aparece si el partido no se anotó punto a punto", async () => {
    responderSueltos([suelto({ conHistorial: false })]);
    await pintadoSuelto();

    expect(document.querySelector(".torneo-partido-historial")).toBeNull();
  });

  it("no aparece mientras el partido se está jugando: ahí manda el directo", async () => {
    responderSueltos([suelto({ status: "live", winner: null })]);
    await pintadoSuelto();

    expect(document.querySelector(".torneo-partido-historial")).toBeNull();
  });
});
