// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ejecutarScriptPublico } from "../helpers/dom";

/*
 * /admin/estadisticas/ tras pasar las cifras de juego a solo lectura.
 *
 * El servidor ya ignora `estadisticas` en el PATCH desde la tarea anterior (la
 * garantía de verdad vive ahí). Esto prueba lo que le toca al cliente: que el
 * diálogo pinta las siete métricas como pares dt/dd de solo lectura -- ningún
 * <input> --, que ya no las manda al guardar, y que los atributos 1-5 se
 * mantienen como campos editables normales.
 *
 * El marcado replica el de src/pages/admin/estadisticas.astro. Si allí cambian
 * los `data-*` o el <dl data-stats-metricas>, este test se cae -- que es lo
 * que se quiere, porque el script también se caería en silencio (una caja
 * vacía sin decir nada).
 */

const MARCADO = `
  <div class="admin-toolbar">
    <input data-admin-buscar />
    <span data-admin-contador></span>
  </div>
  <div data-admin-estadisticas></div>

  <dialog data-stats-dialog>
    <div class="admin-dialog-shell">
      <div class="admin-dialog-head">
        <div>
          <h2 data-stats-titulo></h2>
          <p data-stats-sub></p>
        </div>
        <button type="button" data-stats-cerrar aria-label="Cerrar">×</button>
      </div>
      <div class="admin-dialog-body">
        <form data-stats-form novalidate>
          <dl data-stats-metricas></dl>
          <div data-stats-atributos></div>
          <label>
            <input type="checkbox" data-stats-oculto />
            No mostrar a esta persona en el álbum público
          </label>
        </form>
      </div>
      <div class="admin-dialog-foot">
        <p role="alert" data-stats-banner hidden></p>
        <button type="button" data-stats-cancelar>Cancelar</button>
        <button type="button" data-stats-guardar>Guardar</button>
      </div>
    </div>
  </dialog>
`;

const METRICAS = [
  { clave: "partidosJugados", etiqueta: "Partidos jugados" },
  { clave: "puntos", etiqueta: "Puntos" },
  { clave: "remates", etiqueta: "Remates" },
  { clave: "bloqueos", etiqueta: "Bloqueos" },
  { clave: "aces", etiqueta: "Aces" },
  { clave: "defensas", etiqueta: "Defensas" },
  { clave: "errores", etiqueta: "Errores" }
];

const ATRIBUTOS = ["saque", "remate", "bloqueo"];

const jugador = () => ({
  id: 7,
  nombre: "Ana",
  apellidos: "García",
  equipoNombre: "Los Tiburones",
  ocultoPublico: false,
  estadisticas: {
    partidosJugados: 3,
    puntos: 12,
    remates: 5,
    bloqueos: 2,
    aces: 1,
    defensas: 4,
    errores: 0
  },
  atributos: { saque: 4, remate: null, bloqueo: 3 }
});

const apiJson = vi.fn();
const recargar = vi.fn();

/**
 * CopaAdmin de mentira, con la misma forma que la real (ver public/assets/admin/core.js):
 * lo bastante fiel en `el`/`tabla`/`boton`/`celda` para que la tabla se pinte de verdad y
 * el botón "Editar" abra el diálogo real, en vez de espiar `abrir()` por otra vía.
 */
function stubCopaAdmin(datos: Record<string, unknown>) {
  const text = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

  function el(tag: string, className?: string, valor?: unknown) {
    const nodo = document.createElement(tag);
    if (className) nodo.className = className;
    if (valor !== undefined) nodo.textContent = text(valor);
    return nodo;
  }

  function clear(nodo: Element | null) {
    if (nodo) nodo.textContent = "";
  }

  function boton(etiqueta: string, onClick: () => void) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = etiqueta;
    b.addEventListener("click", onClick);
    return b;
  }

  function celda(clase: string, ...hijos: (Node | false | undefined)[]) {
    const div = el("div", clase);
    // appendChild, no append: @cloudflare/workers-types declara su propio
    // Element.append() (el de HTMLRewriter) y se fusiona con el DOM de jsdom,
    // así que aquí .append(nodo) no tipa contra un Node de verdad.
    hijos.filter(Boolean).forEach((hijo) => div.appendChild(hijo as Node));
    return div;
  }

  function etiquetaTag(texto: string) {
    return el("span", "admin-tag", texto);
  }

  function tabla({ columnas, filas }: { columnas: Array<{ render: (f: unknown) => unknown }>; filas: unknown[] }) {
    const wrap = el("div");
    filas.forEach((fila) => {
      const fil = el("div", "fila");
      columnas.forEach((col) => {
        const valor = col.render(fila);
        fil.appendChild(valor instanceof Node ? valor : el("span", "", valor as string));
      });
      wrap.appendChild(fil);
    });
    return wrap;
  }

  apiJson.mockReset().mockResolvedValue({});
  recargar.mockReset().mockResolvedValue(undefined);

  let cargaLista: Promise<unknown> | undefined;
  vi.stubGlobal("CopaAdmin", {
    api: vi.fn(async () => datos),
    apiJson,
    onReady: (fn: () => Promise<unknown>) => {
      cargaLista = fn();
    },
    recargar,
    el,
    clear,
    tabla,
    celda,
    boton,
    etiqueta: etiquetaTag
  });

  return () => cargaLista;
}

/** Monta la página, corre el script y abre el diálogo del único jugador de la lista. */
async function montarYAbrir() {
  document.body.innerHTML = MARCADO;
  const dialogo = document.querySelector("[data-stats-dialog]") as HTMLElement & {
    showModal: () => void;
    close: () => void;
  };
  dialogo.showModal = vi.fn();
  dialogo.close = vi.fn();

  const j = jugador();
  const esperarCarga = stubCopaAdmin({ jugadores: [j], metricas: METRICAS, atributos: ATRIBUTOS });

  ejecutarScriptPublico("admin/estadisticas.js");
  await esperarCarga();

  const editar = document.querySelector("[data-admin-estadisticas] button") as HTMLButtonElement;
  editar.click();

  return { dialogo };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cifras de juego en /admin/estadisticas/", () => {
  it("pinta las siete métricas como dt/dd de solo lectura, ningún input", async () => {
    const { dialogo } = await montarYAbrir();

    const caja = dialogo.querySelector("[data-stats-metricas]") as HTMLElement;
    const etiquetas = Array.from(caja.querySelectorAll("dt")).map((n) => n.textContent);
    const valores = Array.from(caja.querySelectorAll("dd")).map((n) => n.textContent);

    expect(etiquetas).toEqual(METRICAS.map((m) => m.etiqueta));
    expect(valores).toEqual(["3", "12", "5", "2", "1", "4", "0"]);
    expect(caja.querySelectorAll("input")).toHaveLength(0);
  });

  it("los atributos siguen siendo campos numéricos editables", async () => {
    const { dialogo } = await montarYAbrir();

    const campos = Array.from(dialogo.querySelectorAll("[data-stats-atributos] input")) as HTMLInputElement[];
    expect(campos).toHaveLength(ATRIBUTOS.length);
    expect(campos.every((input) => input.type === "number")).toBe(true);
    expect(campos.map((input) => input.dataset.atributo)).toEqual(ATRIBUTOS);
  });

  it("al guardar, el PATCH manda atributos y ocultoPublico pero nunca estadisticas", async () => {
    const { dialogo } = await montarYAbrir();

    (dialogo.querySelector("[data-stats-guardar]") as HTMLButtonElement).click();

    await vi.waitFor(() => expect(apiJson).toHaveBeenCalled());
    const [, metodo, cuerpo] = apiJson.mock.calls[0] as [string, string, Record<string, unknown>];

    expect(metodo).toBe("PATCH");
    expect(cuerpo).not.toHaveProperty("estadisticas");
    expect(cuerpo).toHaveProperty("atributos");
    expect(cuerpo).toHaveProperty("ocultoPublico");
  });
});
