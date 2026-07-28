// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ejecutarScriptPublico } from "../helpers/dom";

/*
 * El álbum público de /jugadores/. Dos cosas que sujeta este test:
 *
 *   1. players-list.js se apoya en window.CopaCromo, el módulo compartido con
 *      «Mi zona». Si el orden de los <script> se rompe, el álbum se queda en
 *      blanco sin decir nada.
 *   2. quien no tiene foto ocupa un hueco del álbum («Sin cromo»), que es la
 *      pieza que da sentido a la rejilla.
 *
 * El marcado replica el de src/pages/jugadores.astro.
 */

const MARCADO = `
  <main data-album>
    <p data-edicion></p>
    <p data-status></p>
    <section data-controles hidden>
      <input data-buscador />
      <p data-cuenta></p>
      <div data-filtros></div>
    </section>
    <p data-vacio hidden></p>
    <div data-rejilla hidden></div>
    <section data-ranking-seccion hidden><div data-ranking></div></section>
    <section data-ficha hidden></section>
    <button type="button" data-retry hidden></button>
  </main>
`;

const estadisticas = (valores: Record<string, number> = {}) => ({
  partidosJugados: 0,
  puntos: 0,
  remates: 0,
  bloqueos: 0,
  aces: 0,
  defensas: 0,
  errores: 0,
  ...valores
});

const jugador = (id: number, nombre: string, extra: Record<string, unknown> = {}) => ({
  id,
  nombre,
  apellidos: "Souto",
  apodo: null,
  dorsal: null,
  posicion: null,
  mano: null,
  lema: null,
  instagram: null,
  esSuplente: false,
  tieneFoto: false,
  equipoId: 1,
  equipoNombre: "Os Pulpos",
  estadisticas: estadisticas(),
  ...extra
});

const respuestaListado = (jugadores: ReturnType<typeof jugador>[]) =>
  new Response(
    JSON.stringify({ edicion: { anio: 2026, nombre: "Copa Arena 2026", estado: "en_juego" }, jugadores }),
    { status: 200 }
  );

async function montar(jugadores: ReturnType<typeof jugador>[]) {
  document.body.innerHTML = MARCADO;
  vi.stubGlobal("fetch", vi.fn(async () => respuestaListado(jugadores)));

  ejecutarScriptPublico("cromo.js");
  ejecutarScriptPublico("players-list.js");
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  window.history.replaceState({}, "", "/jugadores/");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("álbum de jugadores", () => {
  it("pinta un cromo por jugador, enlazado a su ficha", async () => {
    await montar([jugador(1, "Marta"), jugador(2, "Xoán")]);

    const cromos = Array.from(document.querySelectorAll(".album-cromo")) as HTMLAnchorElement[];
    expect(cromos).toHaveLength(2);
    expect(cromos[0]!.getAttribute("href")).toBe("/jugadores/?j=1");
    expect(cromos[0]!.textContent).toContain("Marta Souto");
    expect(document.querySelector("[data-cuenta]")!.textContent).toBe("2 jugadores · 0 con cromo");
  });

  it("deja el hueco marcado cuando no hay foto, y la pega cuando la hay", async () => {
    await montar([jugador(1, "Marta"), jugador(2, "Xoán", { tieneFoto: true })]);

    const [sinFoto, conFoto] = Array.from(document.querySelectorAll(".album-cromo-foto")) as HTMLElement[];
    expect(sinFoto!.classList.contains("album-cromo-foto--hueco")).toBe(true);
    expect(sinFoto!.textContent).toContain("Sin cromo");
    expect(sinFoto!.querySelector("img")).toBeNull();

    expect(conFoto!.classList.contains("album-cromo-foto--hueco")).toBe(false);
    expect(conFoto!.querySelector("img")!.getAttribute("src")).toBe("/api/jugadores?foto=2");
  });

  it("el buscador filtra por nombre, apodo o equipo, sin tildes", async () => {
    await montar([jugador(1, "Marta", { apodo: "La Muralla" }), jugador(2, "Xoán")]);

    const buscador = document.querySelector("[data-buscador]") as HTMLInputElement;
    buscador.value = "xoan";
    buscador.dispatchEvent(new Event("input"));

    const cromos = Array.from(document.querySelectorAll(".album-cromo"));
    expect(cromos).toHaveLength(1);
    expect(cromos[0]!.textContent).toContain("Xoán");
  });

  it("el ranking corona a quien más suma y deja fuera las métricas sin datos", async () => {
    await montar([
      jugador(1, "Marta", { estadisticas: estadisticas({ puntos: 10, aces: 4 }) }),
      jugador(2, "Xoán", { estadisticas: estadisticas({ puntos: 30 }) })
    ]);

    const titulos = Array.from(document.querySelectorAll(".ranking-titulo")).map((n) => n.textContent);
    expect(titulos).toEqual(["Puntos", "Aces"]);

    const primeroDePuntos = document.querySelector(".ranking-card .ranking-fila");
    expect(primeroDePuntos!.textContent).toContain("Xoán");
    expect(primeroDePuntos!.textContent).toContain("30");
  });

  it("sin nadie inscrito invita a inscribirse en vez de dejar la rejilla vacía", async () => {
    await montar([]);

    const vacio = document.querySelector("[data-vacio]") as HTMLElement;
    expect(vacio.hidden).toBe(false);
    expect(vacio.textContent).toContain("Inscribe tu equipo");
    expect((document.querySelector("[data-ranking-seccion]") as HTMLElement).hidden).toBe(true);
  });
});
