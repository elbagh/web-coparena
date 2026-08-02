// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ejecutarScriptPublico } from "../helpers/dom";

/*
 * /admin/camisetas/ — el interruptor de entrega.
 *
 * Lo que el servidor no puede probar: que la fila enseña el estado que tiene,
 * que pulsarla manda la acción correcta, y que si la petición falla la casilla
 * vuelve a donde estaba. Sin esa vuelta atrás la pantalla diría «entregada»
 * sobre una base de datos que no lo tiene, y en el puesto nadie lo comprobaría.
 *
 * El marcado replica el de src/pages/admin/camisetas.astro a mano, igual que
 * admin-roles.test.ts. Si allí cambian los `data-*`, este test sigue en verde.
 */

const MARCADO = `
  <span data-admin-contador></span>
  <form data-admin-shirt-form novalidate>
    <p data-admin-shirt-banner hidden></p>
    <input data-admin-shirt-field="nombre" />
    <select data-admin-shirt-field="talla"><option value="L">L</option></select>
    <input data-admin-shirt-field="cantidad" value="1" />
    <textarea data-admin-shirt-field="notas"></textarea>
    <button type="submit" data-admin-shirt-submit>Añadir reserva</button>
  </form>
  <div data-admin-camisetas></div>
  <dialog data-camiseta-dialog>
    <p data-camiseta-sub></p>
    <p data-camiseta-banner hidden></p>
    <form data-camiseta-form novalidate>
      <input data-camiseta-field="nombre" />
      <select data-camiseta-field="talla"><option value="L">L</option><option value="M">M</option></select>
      <input data-camiseta-field="cantidad" />
      <textarea data-camiseta-field="notas"></textarea>
    </form>
    <button type="button" data-camiseta-cerrar>×</button>
    <button type="button" data-camiseta-cancelar>Cancelar</button>
    <button type="button" data-camiseta-guardar>Guardar reserva</button>
  </dialog>
`;

const CAMISETAS = [
  { id: 7, nombre: "Iago", talla: "L", cantidad: 1, notas: null, ownerEmail: "iago@example.com", entregada: false },
  { id: 8, nombre: "María", talla: "M", cantidad: 2, notas: null, ownerEmail: "maria@example.com", entregada: true }
];

const apiJson = vi.fn();
const recargar = vi.fn();
const setError = vi.fn();

function stubCopaAdmin() {
  const text = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

  function el(tag: string, className?: string, valor?: unknown) {
    const nodo = document.createElement(tag);
    if (className) nodo.className = className;
    if (valor !== undefined) nodo.textContent = text(valor);
    return nodo;
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
    hijos.filter(Boolean).forEach((hijo) => div.appendChild(hijo as Node));
    return div;
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

  const cargadores: Array<() => Promise<void>> = [];

  (globalThis as unknown as Record<string, unknown>).CopaAdmin = {
    api: vi.fn(),
    apiJson,
    resumen: vi.fn(async () => ({ camisetas: CAMISETAS })),
    onReady: (fn: () => Promise<void>) => cargadores.push(fn),
    recargar,
    setError,
    el,
    clear: (nodo: Element | null) => {
      if (nodo) nodo.textContent = "";
    },
    text,
    tabla,
    celda,
    boton,
    etiqueta: (t: string) => el("span", "admin-tag", t),
    limpiar: (v: string) => String(v ?? "").trim(),
    confirmar: vi.fn(async () => true)
  };

  return { cargadores };
}

const casillas = () => [...document.querySelectorAll<HTMLInputElement>("[data-admin-camisetas] input[type=checkbox]")];

async function montar() {
  document.body.innerHTML = MARCADO;
  const { cargadores } = stubCopaAdmin();
  ejecutarScriptPublico("admin/camisetas.js");
  await Promise.all(cargadores.map((fn) => fn()));
}

beforeEach(() => {
  vi.clearAllMocks();
  apiJson.mockResolvedValue({ ok: true });
});

describe("el interruptor de entrega", () => {
  it("cada fila nace con el estado que trae la reserva", async () => {
    await montar();

    expect(casillas().map((c) => c.checked)).toEqual([false, true]);
  });

  it("marcar una pendiente manda la acción de entrega", async () => {
    await montar();

    casillas()[0]!.click();
    await Promise.resolve();

    expect(apiJson).toHaveBeenCalledWith("/api/admin/camisetas?id=7&accion=entrega", "PATCH", { entregada: true });
  });

  it("desmarcar una entregada la devuelve a pendiente", async () => {
    await montar();

    casillas()[1]!.click();
    await Promise.resolve();

    expect(apiJson).toHaveBeenCalledWith("/api/admin/camisetas?id=8&accion=entrega", "PATCH", { entregada: false });
  });

  it("si la petición falla, la casilla vuelve a su estado y sale el aviso", async () => {
    await montar();
    apiJson.mockRejectedValueOnce(new Error("Sin conexión."));

    const casilla = casillas()[0]!;
    casilla.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(casilla.checked).toBe(false);
    expect(casilla.disabled).toBe(false);
    expect(setError).toHaveBeenCalledWith("Sin conexión.");
    expect(recargar).not.toHaveBeenCalled();
  });

  it("el contador dice cuántas se han entregado, en singular cuando toca", async () => {
    await montar();

    expect(document.querySelector("[data-admin-contador]")!.textContent).toBe("2 reservas · 3 camisetas · 1 entregada");
  });
});
