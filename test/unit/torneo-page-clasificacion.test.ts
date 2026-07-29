// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ejecutarScriptPublico } from "../helpers/dom";

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
    <div data-directo-panel hidden>
      <p data-directo-panel-vacio></p>
      <div data-directo-panel-partidos></div>
      <button data-directo-refrescar></button>
    </div>
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

  it("la nota explica las plazas directas y la repesca", async () => {
    responder(fase());
    await pintado();

    const nota = [...document.querySelectorAll(".torneo-nota")].map((n) => n.textContent).join(" ");
    expect(nota).toContain("Pasan los 2 primeros de este grupo.");
    expect(nota).toContain("Una plaza más se decide");
  });

  it("un grupo con su propio cupo lo dice, y no el de la fase", async () => {
    responder(fase({}, { clasifican: 3, enRepesca: false }));
    await pintado();

    const nota = [...document.querySelectorAll(".torneo-nota")].map((n) => n.textContent).join(" ");
    expect(nota).toContain("Pasan los 3 primeros de este grupo.");
    // Fuera del bote, la frase de la repesca no aplica a este grupo.
    expect(nota).not.toContain("Una plaza más se decide");
  });

  it("sin repesca en la fase, la nota se queda en las plazas directas", async () => {
    responder(fase({ repesca: 0 }));
    await pintado();

    const nota = [...document.querySelectorAll(".torneo-nota")].map((n) => n.textContent).join(" ");
    expect(nota).toContain("Pasan los 2 primeros de este grupo.");
    expect(nota).not.toContain("se decide");
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
