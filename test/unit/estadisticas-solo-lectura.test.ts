// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ejecutarScriptPublico } from "../helpers/dom";

/*
 * /admin/estadisticas/ tras pasar las cifras de juego a solo lectura.
 *
 * El servidor ya ignora `estadisticas` en el PATCH desde la tarea anterior (la
 * garantía de verdad vive ahí). Esto prueba lo que le toca al cliente: que el
 * diálogo pinta las seis métricas como pares dt/dd de solo lectura -- ningún
 * <input> --, que ya no las manda al guardar, y que los atributos 1-5 se
 * mantienen como campos editables normales.
 *
 * El marcado replica el de src/pages/admin/estadisticas.astro a mano -- es el
 * mismo patrón que mi-equipo-solo-lectura.test.ts y album-jugadores.test.ts.
 * Es una copia, no una lectura del fichero real: si allí cambian los `data-*`
 * o el <dl data-stats-metricas>, este test sigue en verde y es producción la
 * que se rompe (el script se cae en silencio, una caja vacía sin decir nada).
 * Hay que mantener MARCADO sincronizado a mano con el .astro.
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
          <p><strong data-stats-media>—</strong></p>
          <div data-stats-atributos></div>
          <select data-stats-nivel></select>
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
  { clave: "partidosJugados", etiqueta: "Partidos" },
  { clave: "puntos", etiqueta: "Puntos" },
  { clave: "bloqueos", etiqueta: "Bloqueos" },
  { clave: "chilenas", etiqueta: "Chilenas" },
  { clave: "aces", etiqueta: "Aces" },
  { clave: "saquesFallados", etiqueta: "Saques fallados" }
];

// Como los manda el servidor: con etiqueta y abreviatura, no claves sueltas.
const ATRIBUTOS = [
  { clave: "saque", etiqueta: "Saque", abrev: "SAQ" },
  { clave: "remate", etiqueta: "Remate", abrev: "REM" },
  { clave: "bloqueo", etiqueta: "Bloqueo", abrev: "BLO" }
];

const NIVELES = ["bronce", "plata", "oro"];

const jugador = () => ({
  id: 7,
  nombre: "Ana",
  apellidos: "García",
  equipoNombre: "Los Tiburones",
  ocultoPublico: false,
  nivel: "plata",
  media: 70,
  estadisticas: {
    partidosJugados: 3,
    puntos: 12,
    bloqueos: 2,
    chilenas: 5,
    aces: 1,
    saquesFallados: 4
  },
  atributos: { saque: 80, remate: null, bloqueo: 60 }
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
  const esperarCarga = stubCopaAdmin({
    jugadores: [j],
    metricas: METRICAS,
    atributos: ATRIBUTOS,
    niveles: NIVELES
  });

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
  it("pinta las seis métricas como dt/dd de solo lectura, ningún input", async () => {
    const { dialogo } = await montarYAbrir();

    const caja = dialogo.querySelector("[data-stats-metricas]") as HTMLElement;
    const etiquetas = Array.from(caja.querySelectorAll("dt")).map((n) => n.textContent);
    const valores = Array.from(caja.querySelectorAll("dd")).map((n) => n.textContent);

    expect(etiquetas).toEqual(METRICAS.map((m) => m.etiqueta));
    expect(valores).toEqual(["3", "12", "2", "5", "1", "4"]);
    expect(caja.querySelectorAll("input")).toHaveLength(0);
  });

  it("los atributos siguen siendo campos numéricos editables, ahora hasta 99", async () => {
    const { dialogo } = await montarYAbrir();

    const campos = Array.from(dialogo.querySelectorAll("[data-stats-atributos] input")) as HTMLInputElement[];
    expect(campos).toHaveLength(ATRIBUTOS.length);
    expect(campos.every((input) => input.type === "number")).toBe(true);
    expect(campos.map((input) => input.dataset.atributo)).toEqual(ATRIBUTOS.map((a) => a.clave));
    expect(campos.every((input) => input.min === "1" && input.max === "99")).toBe(true);

    // Las etiquetas llegan del servidor: el cliente ya no mantiene su copia.
    const labels = Array.from(dialogo.querySelectorAll("[data-stats-atributos] label")).map((n) => n.textContent);
    expect(labels).toEqual(ATRIBUTOS.map((a) => a.etiqueta));
  });

  it("el nivel del cromo se elige de la lista que manda el servidor", async () => {
    const { dialogo } = await montarYAbrir();

    const select = dialogo.querySelector("[data-stats-nivel]") as unknown as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(NIVELES);
    expect(select.value).toBe("plata");
  });

  it("la nota es la del servidor, no una cuenta hecha en el cliente", async () => {
    // Recalcularla aquí obligaría a copiar la fórmula de `mediaAtributos`, que
    // es justo la duplicación que se quiere evitar.
    const { dialogo } = await montarYAbrir();
    expect((dialogo.querySelector("[data-stats-media]") as HTMLElement).textContent).toBe("70");
  });

  it("al guardar, el PATCH manda atributos, nivel y ocultoPublico pero nunca estadisticas", async () => {
    const { dialogo } = await montarYAbrir();

    (dialogo.querySelector("[data-stats-guardar]") as HTMLButtonElement).click();

    await vi.waitFor(() => expect(apiJson).toHaveBeenCalled());
    const [, metodo, cuerpo] = apiJson.mock.calls[0] as [string, string, Record<string, unknown>];

    expect(metodo).toBe("PATCH");
    expect(cuerpo).not.toHaveProperty("estadisticas");
    expect(cuerpo).toHaveProperty("atributos");
    expect(cuerpo).toHaveProperty("ocultoPublico");
    expect(cuerpo.nivel).toBe("plata");
  });
});
