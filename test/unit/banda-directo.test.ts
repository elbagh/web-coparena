// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cargarScriptPublico } from "../helpers/dom";

/*
 * La banda de la portada. Se engancha como SEGUNDO suscriptor de CopaDirecto:
 * directo.js ya sondea en esa página porque el chip vive en la cabecera, así que
 * son cero peticiones nuevas y cero cambio de cadencia. El presupuesto de la
 * cuota de Cloudflare se queda como estaba.
 *
 * El obstáculo es que la cabecera es una píldora `position: fixed` con su fondo
 * también fijo —por eso la banda de «ver como» se fue abajo—. Una banda arriba
 * las deja por delante, así que se mide su alto y las dos se apartan con
 * --banda-directo.
 */

const MARCADO = `
  <a class="banda-directo" data-banda-directo href="/directo/" hidden>
    <span data-banda-equipos></span>
  </a>
  <details data-directo-apagado><summary><span data-directo-etiqueta></span></summary></details>
  <a data-directo-vivo hidden><span data-directo-texto></span></a>
`;

const respuesta = (cuerpo: Record<string, unknown>) => ({
  ok: true,
  status: 200,
  headers: { get: () => 'W/"directo-1"' },
  json: async () => cuerpo
});

const sinDirecto = () =>
  respuesta({ hayDirecto: false, partidos: [], siguiente: null, siguienteSondeoMs: 60000, modoAhorro: false });

const conDirecto = () =>
  respuesta({
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
  });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.innerHTML = MARCADO;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // jsdom no hace layout: la banda mediría 0 y no se vería el desplazamiento.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 64 } as DOMRect);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  delete (globalThis as unknown as Record<string, unknown>).CopaDirecto;
});

describe("la banda de la portada", () => {
  it("sin partido está oculta y no aparta nada", async () => {
    fetchMock.mockResolvedValue(sinDirecto());
    cargarScriptPublico("directo.js", "CopaDirecto");
    await new Promise((r) => setTimeout(r, 0));

    expect((document.querySelector("[data-banda-directo]") as HTMLElement).hidden).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--banda-directo")).toBe("0px");
  });

  it("con partido enseña los nombres COMPLETOS, no las siglas", async () => {
    fetchMock.mockResolvedValue(conDirecto());
    cargarScriptPublico("directo.js", "CopaDirecto");
    await new Promise((r) => setTimeout(r, 0));

    const banda = document.querySelector("[data-banda-directo]") as HTMLElement;
    expect(banda.hidden).toBe(false);
    expect(document.querySelector("[data-banda-equipos]")!.textContent).toContain("Ostreiros do Pozo");
    expect(document.querySelector("[data-banda-equipos]")!.textContent).toContain("Os Pulpos");
  });

  it("aparta la cabecera fija por el alto medido", async () => {
    fetchMock.mockResolvedValue(conDirecto());
    cargarScriptPublico("directo.js", "CopaDirecto");
    await new Promise((r) => setTimeout(r, 0));

    expect(document.documentElement.style.getPropertyValue("--banda-directo")).toBe("64px");
  });

  it("al acabar el partido se retira y devuelve el hueco", async () => {
    fetchMock.mockResolvedValue(conDirecto());
    const directo = cargarScriptPublico<{ refrescarAhora(): Promise<void> }>("directo.js", "CopaDirecto");
    await new Promise((r) => setTimeout(r, 0));

    fetchMock.mockResolvedValue(sinDirecto());
    await directo.refrescarAhora();
    await new Promise((r) => setTimeout(r, 0));

    expect((document.querySelector("[data-banda-directo]") as HTMLElement).hidden).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--banda-directo")).toBe("0px");
  });

  it("una página sin banda no falla: el chip vive en todas, la banda solo en la portada", async () => {
    document.body.innerHTML = `
      <details data-directo-apagado><summary><span data-directo-etiqueta></span></summary></details>
      <a data-directo-vivo hidden><span data-directo-texto></span></a>
    `;
    fetchMock.mockResolvedValue(conDirecto());
    cargarScriptPublico("directo.js", "CopaDirecto");
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector("[data-directo-texto]")!.textContent).toContain("OST");
  });
});
