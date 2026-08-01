// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ejecutarScriptPublico } from "../helpers/dom";

/*
 * El capitán en el editor de plantilla de /admin/equipos/.
 *
 * El panel es el único sitio donde se puede cambiar el capitán de un equipo
 * ajeno, así que aquí se comprueba lo mismo que en el formulario público:
 * quién sale marcado, a quién se puede marcar y qué sale en el resumen previo
 * al guardado, que es la red de seguridad del editor.
 *
 * El marcado replica el de src/pages/admin/equipos.astro.
 */

const MARCADO = `
  <div data-admin-equipos></div>
  <p data-admin-contador></p>
  <dialog data-team-edit-dialog>
    <h2 data-team-edit-title></h2>
    <form data-team-edit-form novalidate>
      <div class="admin-field">
        <input type="text" data-team-edit-field="equipo" />
        <p data-team-edit-error="equipo" hidden></p>
      </div>
      <input type="text" data-team-edit-siglas />
      <input type="file" data-team-edit-field="fotoEquipo" />
      <input type="checkbox" data-team-edit-field="eliminarFotoEquipo" />
      <img data-team-foto-preview hidden />
      <p data-team-foto-vacia hidden></p>
      <p data-team-edit-error="fotoEquipo" hidden></p>
      <div data-team-edit-players></div>
    </form>
    <p data-team-edit-banner hidden></p>
    <div data-team-edit-diff hidden><ul data-team-edit-diff-list></ul></div>
    <button type="button" data-team-edit-add>Añadir</button>
    <button type="button" data-team-edit-review>Revisar</button>
    <button type="button" data-team-edit-back>Volver</button>
    <button type="button" data-team-edit-confirm>Guardar</button>
    <button type="button" data-team-edit-close>Cerrar</button>
  </dialog>
  <template id="team-edit-player-template">
    <article class="player-card" data-team-edit-player>
      <header class="player-head">
        <span data-dorsal>1</span>
        <span data-role>Titular</span>
        <label class="player-capitan-pick"><input type="radio" name="capitan" data-capitan-radio /><span>Capitán</span></label>
        <button type="button" data-move-up>↑</button>
        <button type="button" data-move-down>↓</button>
        <button type="button" data-remove>Quitar</button>
      </header>
      <img data-photo-preview hidden />
      <p data-photo-empty hidden></p>
      <input type="file" data-field="foto" hidden />
      <input type="checkbox" data-field="eliminarFoto" />
      <p data-field-error="foto" hidden></p>
      <input type="text" data-field="nombre" /><p data-field-error="nombre" hidden></p>
      <input type="text" data-field="apellidos" /><p data-field-error="apellidos" hidden></p>
      <input type="tel" data-field="telefono" /><p data-field-error="telefono" hidden></p>
      <input type="email" data-field="email" /><p data-field-error="email" hidden></p>
      <input type="text" data-field="redSocial" /><p data-field-error="redSocial" hidden></p>
    </article>
  </template>
`;

const jugador = (id: number, nombre: string, extra: Record<string, unknown> = {}) => ({
  id,
  nombre,
  apellidos: "Apellido",
  telefono: "60011122" + id,
  email: `jugador${id}@example.com`,
  redSocial: null,
  tieneFoto: false,
  esSuplente: false,
  orden: id,
  ...extra
});

const EQUIPO = {
  id: 7,
  nombre: "Los Rompeolas",
  tieneFoto: false,
  jugadoresTotal: 2,
  capitanJugadorId: 2,
  capitanEmail: "jugador2@example.com",
  jugadores: [jugador(1, "Ana"), jugador(2, "Luis")]
};

const EQUIPO_SIN_CAPITAN = {
  id: 8,
  nombre: "Sin Capitán",
  tieneFoto: false,
  jugadoresTotal: 2,
  capitanJugadorId: null,
  capitanEmail: null,
  jugadores: [jugador(1, "Ana"), jugador(2, "Luis")]
};

// Tres jugadores: los dos primeros son titulares, el tercero es suplente
// (MIN_JUGADORES = 2 en equipos.js). El capitán es el suplente.
const EQUIPO_CAPITAN_SUPLENTE = {
  id: 9,
  nombre: "Suplente al mando",
  tieneFoto: false,
  jugadoresTotal: 3,
  capitanJugadorId: 3,
  capitanEmail: "jugador3@example.com",
  jugadores: [jugador(1, "Ana"), jugador(2, "Luis"), jugador(3, "Eva")]
};

const api = vi.fn();
const cargadores: (() => unknown)[] = [];

/** Doble de CopaAdmin fiel a core.js en lo que este test necesita. */
function montar(equipo: Record<string, unknown> = EQUIPO) {
  document.body.innerHTML = MARCADO;
  cargadores.length = 0;

  const dialogo = document.querySelector("[data-team-edit-dialog]") as HTMLElement & {
    showModal: () => void;
    close: () => void;
  };
  dialogo.showModal = vi.fn();
  dialogo.close = vi.fn();

  api.mockReset().mockResolvedValue({ ok: true });

  vi.stubGlobal("CopaAdmin", {
    api,
    apiJson: vi.fn(),
    resumen: vi.fn(async () => ({ equipos: [equipo] })),
    onReady: (fn: () => unknown) => cargadores.push(fn),
    recargar: vi.fn(async () => {}),
    setError: vi.fn(),
    el: (tag: string, clase = "", texto = "") => {
      const nodo = document.createElement(tag);
      if (clase) nodo.className = clase;
      if (texto) nodo.textContent = texto;
      return nodo;
    },
    clear: (nodo: Element) => nodo && (nodo.textContent = ""),
    text: (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v)),
    tabla: ({ filas, columnas }: { filas: unknown[]; columnas: { render: (f: unknown) => unknown }[] }) => {
      const cont = document.createElement("div");
      filas.forEach((fila) => {
        const linea = document.createElement("div");
        columnas.forEach((col) => {
          const salida = col.render(fila);
          linea.appendChild(salida instanceof Node ? salida : document.createTextNode(String(salida)));
        });
        cont.appendChild(linea);
      });
      return cont;
    },
    celda: (clase: string, ...hijos: (Node | null)[]) => {
      const div = document.createElement("div");
      div.className = clase;
      hijos.filter(Boolean).forEach((hijo) => div.appendChild(hijo!));
      return div;
    },
    boton: (etiqueta: string, onClick: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = etiqueta;
      b.addEventListener("click", onClick);
      return b;
    },
    enlace: (etiqueta: string, href: string) => {
      const a = document.createElement("a");
      a.href = href;
      a.textContent = etiqueta;
      return a;
    },
    limpiar: (valor: unknown) => String(valor || "").trim().replace(/\s+/g, " "),
    confirmar: vi.fn(async () => true)
  });

  ejecutarScriptPublico("admin/equipos.js");
}

/** Corre los cargadores registrados y abre el editor del primer equipo. */
async function abrirEditor() {
  await Promise.all(cargadores.map((fn) => fn()));
  const editar = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Editar");
  editar!.click();
}

const filas = () => Array.from(document.querySelectorAll("[data-team-edit-player]"));
const radio = (i: number) => filas()[i]!.querySelector<HTMLInputElement>("[data-capitan-radio]")!;
const campo = (i: number, nombre: string) =>
  filas()[i]!.querySelector<HTMLInputElement>(`[data-field="${nombre}"]`)!;
const escribir = (i: number, nombre: string, valor: string) => {
  const input = campo(i, nombre);
  input.value = valor;
  input.dispatchEvent(new Event("input"));
  input.dispatchEvent(new Event("blur"));
};

describe("capitán en el editor del panel", () => {
  beforeEach(() => {
    montar();
  });

  it("preselecciona al capitán que viene del servidor", async () => {
    await abrirEditor();
    expect(radio(0).checked).toBe(false);
    expect(radio(1).checked).toBe(true);
  });

  it("no deja marcar capitán a quien no tiene móvil y correo", async () => {
    await abrirEditor();
    escribir(0, "telefono", "");
    expect(radio(0).disabled).toBe(true);

    escribir(0, "telefono", "600111222");
    expect(radio(0).disabled).toBe(false);
  });

  it("anuncia el cambio de capitán en el resumen previo", async () => {
    await abrirEditor();
    radio(0).checked = true;
    radio(0).dispatchEvent(new Event("change"));

    document.querySelector<HTMLButtonElement>("[data-team-edit-review]")!.click();

    const lineas = Array.from(document.querySelectorAll("[data-team-edit-diff-list] li")).map(
      (li) => li.textContent
    );
    expect(lineas.some((linea) => linea?.startsWith("Capitán:"))).toBe(true);
  });

  it("manda el índice del capitán en el payload", async () => {
    await abrirEditor();
    radio(0).checked = true;
    radio(0).dispatchEvent(new Event("change"));

    document.querySelector<HTMLButtonElement>("[data-team-edit-review]")!.click();
    document.querySelector<HTMLButtonElement>("[data-team-edit-confirm]")!.click();

    await vi.waitFor(() => expect(api).toHaveBeenCalled());
    const [, opciones] = api.mock.calls.at(-1)!;
    const payload = JSON.parse(String((opciones.body as FormData).get("payload")));
    expect(payload.capitan).toBe(0);
  });

  it("no deja guardar sin capitán marcado", async () => {
    await abrirEditor();
    radio(1).checked = false;

    document.querySelector<HTMLButtonElement>("[data-team-edit-review]")!.click();

    const banner = document.querySelector<HTMLElement>("[data-team-edit-banner]")!;
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain("capitán");
  });

  it("desmarca al capitán si se queda sin su propio contacto", async () => {
    await abrirEditor();
    expect(radio(1).checked).toBe(true);

    escribir(1, "telefono", "");

    expect(radio(1).checked).toBe(false);
  });

  it("un equipo sin capitán no preselecciona ningún radio y bloquea la revisión", async () => {
    montar(EQUIPO_SIN_CAPITAN);
    await abrirEditor();
    expect(radio(0).checked).toBe(false);
    expect(radio(1).checked).toBe(false);

    document.querySelector<HTMLButtonElement>("[data-team-edit-review]")!.click();

    const banner = document.querySelector<HTMLElement>("[data-team-edit-banner]")!;
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain("capitán");
  });

  it("preselecciona al capitán aunque esté en un hueco de suplente", async () => {
    montar(EQUIPO_CAPITAN_SUPLENTE);
    await abrirEditor();
    expect(radio(0).checked).toBe(false);
    expect(radio(1).checked).toBe(false);
    expect(radio(2).checked).toBe(true);
  });

  it("bloquea la revisión si se quita la tarjeta del capitán", async () => {
    montar(EQUIPO_CAPITAN_SUPLENTE);
    await abrirEditor();
    expect(radio(2).checked).toBe(true);

    filas()[2]!.querySelector<HTMLButtonElement>("[data-remove]")!.click();

    document.querySelector<HTMLButtonElement>("[data-team-edit-review]")!.click();

    const banner = document.querySelector<HTMLElement>("[data-team-edit-banner]")!;
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain("capitán");
  });

  it("mantiene el capitán en el mismo jugador tras reordenar", async () => {
    await abrirEditor();
    radio(0).checked = true;
    radio(0).dispatchEvent(new Event("change"));

    filas()[0]!.querySelector<HTMLButtonElement>("[data-move-down]")!.click();
    // Tras bajar a Ana (id 1), el orden es [Luis, Ana]: el radio marcado
    // viaja con el nodo, así que ahora debe ser el de la segunda fila.
    expect(radio(0).checked).toBe(false);
    expect(radio(1).checked).toBe(true);

    document.querySelector<HTMLButtonElement>("[data-team-edit-review]")!.click();
    document.querySelector<HTMLButtonElement>("[data-team-edit-confirm]")!.click();

    await vi.waitFor(() => expect(api).toHaveBeenCalled());
    const [, opciones] = api.mock.calls.at(-1)!;
    const payload = JSON.parse(String((opciones.body as FormData).get("payload")));
    expect(payload.capitan).toBe(1);
    expect(payload.jugadores[payload.capitan].id).toBe(1);
  });
});
