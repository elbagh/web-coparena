// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ejecutarScriptPublico } from "../helpers/dom";

/*
 * Alta de equipo desde /admin/equipos/.
 *
 * El diálogo «Nuevo equipo» tiene un único campo de texto y ningún botón de
 * submit (Cancelar y Crear equipo viven fuera del <form>, en el pie, con
 * type="button"). Con esa forma exacta el navegador hace *implicit submission*
 * al pulsar Enter: si nadie escucha el `submit`, corre la acción por defecto y
 * el formulario se envía a la propia URL. El panel se recarga, el diálogo
 * desaparece y no se crea nada — sin ningún mensaje que lo explique.
 *
 * Por eso el caso de Enter se prueba aquí y no solo el del clic: el clic
 * funcionaba y el equipo seguía sin crearse.
 *
 * El marcado replica el de src/pages/admin/equipos.astro. Si allí cambian los
 * `data-*`, este test se cae, que es lo que se quiere.
 */

const MARCADO = `
  <div data-admin-equipos></div>
  <p data-admin-contador></p>
  <button type="button" data-equipo-nuevo>+ Nuevo equipo</button>
  <dialog data-equipo-nuevo-dialog>
    <div>
      <form data-equipo-nuevo-form novalidate>
        <div class="admin-field">
          <label for="equipo-nuevo-nombre">Nombre del equipo</label>
          <input id="equipo-nuevo-nombre" type="text" maxlength="60" data-equipo-nuevo-field="nombre" />
          <p data-equipo-nuevo-error="nombre" hidden></p>
        </div>
      </form>
      <p data-equipo-nuevo-banner hidden></p>
      <button type="button" data-equipo-nuevo-cancelar>Cancelar</button>
      <button type="button" data-equipo-nuevo-guardar>Crear equipo</button>
    </div>
  </dialog>
`;

const apiJson = vi.fn();
const recargar = vi.fn();

/** Monta la página con un CopaAdmin de mentira y corre el script de la sección. */
function montar() {
  document.body.innerHTML = MARCADO;

  // jsdom no implementa showModal/close de <dialog>.
  const dialogo = document.querySelector("[data-equipo-nuevo-dialog]") as HTMLElement & {
    showModal: () => void;
    close: () => void;
  };
  dialogo.showModal = vi.fn();
  dialogo.close = vi.fn();

  apiJson.mockReset().mockResolvedValue({ ok: true, equipo: { id: 16 } });
  recargar.mockReset().mockResolvedValue(undefined);

  vi.stubGlobal("CopaAdmin", {
    api: vi.fn(),
    apiJson,
    resumen: vi.fn(async () => ({ equipos: [] })),
    onReady: vi.fn(),
    recargar,
    setError: vi.fn(),
    el: (tag: string) => document.createElement(tag),
    clear: (nodo: Element) => nodo && (nodo.textContent = ""),
    text: (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v)),
    tabla: () => document.createElement("div"),
    celda: () => document.createElement("div"),
    boton: () => document.createElement("button"),
    enlace: () => document.createElement("a"),
    limpiar: (valor: unknown) => String(valor || "").trim().replace(/\s+/g, " "),
    confirmar: vi.fn(async () => false)
  });

  ejecutarScriptPublico("admin/equipos.js");
  return dialogo;
}

const campo = () => document.querySelector("[data-equipo-nuevo-field='nombre']") as HTMLInputElement;
const formulario = () => document.querySelector("[data-equipo-nuevo-form]") as HTMLFormElement;
const errorCampo = () => document.querySelector("[data-equipo-nuevo-error='nombre']") as HTMLElement;

/** Enter en el único campo del formulario, tal y como lo genera el navegador. */
function pulsarEnter() {
  const evento = new Event("submit", { bubbles: true, cancelable: true });
  formulario().dispatchEvent(evento);
  return evento;
}

describe("alta de equipo en el panel", () => {
  beforeEach(() => {
    montar();
  });

  it("crea el equipo al pulsar Enter en el campo del nombre", async () => {
    campo().value = "Los Petardos";
    const evento = pulsarEnter();

    await vi.waitFor(() =>
      expect(apiJson).toHaveBeenCalledWith("/api/admin/equipos", "POST", { nombre: "Los Petardos" })
    );
    await vi.waitFor(() => expect(recargar).toHaveBeenCalled());
  });

  it("nunca deja que Enter envíe el formulario al navegador", () => {
    campo().value = "Los Petardos";
    // Sin preventDefault el navegador navega a la propia URL: el panel se
    // recarga, el diálogo se cierra y el alta se pierde en silencio.
    expect(pulsarEnter().defaultPrevented).toBe(true);
  });

  it("con un nombre demasiado corto avisa por Enter en vez de enviar nada", async () => {
    campo().value = "a";
    const evento = pulsarEnter();

    expect(evento.defaultPrevented).toBe(true);
    expect(apiJson).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(errorCampo().hidden).toBe(false);
      expect(errorCampo().textContent).toMatch(/entre 2 y 60/);
    });
  });

  it("sigue creando el equipo con el botón «Crear equipo»", async () => {
    campo().value = "Los Petardos";
    (document.querySelector("[data-equipo-nuevo-guardar]") as HTMLButtonElement).click();

    await vi.waitFor(() =>
      expect(apiJson).toHaveBeenCalledWith("/api/admin/equipos", "POST", { nombre: "Los Petardos" })
    );
  });
});
