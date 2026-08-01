// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cargarScriptPublico } from "../helpers/dom";

/*
 * El chip encendido pasa a decir QUIÉN juega, no cómo van. El marcador se ve
 * entrando: sin saber de quién, un «12–9» no informa de nada.
 *
 * Y el aria-label pierde el marcador por una razón aparte: el enlace tiene
 * aria-live="polite", así que hoy un lector de pantalla canta cada punto desde
 * cualquier página del sitio. Con siglas se anuncia una vez por partido.
 */

const MARCADO = `
  <details data-directo-apagado data-nav-drop>
    <summary><span data-directo-etiqueta>Offline</span></summary>
  </details>
  <a data-directo-vivo hidden aria-live="polite"><span data-directo-texto></span></a>
`;

const conPartido = () => ({
  ok: true,
  status: 200,
  headers: { get: () => 'W/"directo-1"' },
  json: async () => ({
    hayDirecto: true,
    partidos: [
      {
        id: "p1",
        points: { A: 12, B: 9 },
        sets: { A: 1, B: 0 },
        teams: {
          A: { id: 1, name: "Ostreiros do Pozo", siglas: "OST" },
          B: { id: 2, name: "Os Pulpos", siglas: "PUL" }
        }
      }
    ],
    siguiente: null,
    siguienteSondeoMs: 3000,
    modoAhorro: false
  })
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.innerHTML = MARCADO;
  fetchMock = vi.fn().mockResolvedValue(conPartido());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  delete (globalThis as unknown as Record<string, unknown>).CopaDirecto;
});

describe("el chip encendido", () => {
  it("enseña las siglas de los dos equipos, no el marcador", async () => {
    cargarScriptPublico("directo.js", "CopaDirecto");
    await new Promise((r) => setTimeout(r, 0));

    const texto = document.querySelector("[data-directo-texto]")!.textContent!;
    expect(texto).toContain("OST");
    expect(texto).toContain("PUL");
    expect(texto).not.toContain("12");
    expect(texto).not.toContain("9");
  });

  it("no se queda en «En directo»: siempre hay siglas que enseñar", async () => {
    cargarScriptPublico("directo.js", "CopaDirecto");
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector("[data-directo-texto]")!.textContent).not.toBe("En directo");
  });

  it("el aria-label lleva los nombres completos y ningún punto", async () => {
    cargarScriptPublico("directo.js", "CopaDirecto");
    await new Promise((r) => setTimeout(r, 0));

    const etiqueta = document.querySelector("[data-directo-vivo]")!.getAttribute("aria-label")!;
    expect(etiqueta).toContain("Ostreiros do Pozo");
    expect(etiqueta).toContain("Os Pulpos");
    expect(etiqueta).not.toMatch(/\b12\b/);
  });

  it("enciende el enlace y apaga el desplegable", async () => {
    cargarScriptPublico("directo.js", "CopaDirecto");
    await new Promise((r) => setTimeout(r, 0));

    expect((document.querySelector("[data-directo-vivo]") as HTMLElement).hidden).toBe(false);
    expect((document.querySelector("[data-directo-apagado]") as HTMLElement).hidden).toBe(true);
  });
});
