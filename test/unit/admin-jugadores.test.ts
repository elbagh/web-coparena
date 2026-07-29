// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ejecutarScriptPublico } from "../helpers/dom";

/*
 * El diálogo de /admin/jugadores/, que edita y da de alta jugadores sueltos.
 *
 * Es el único cliente de la rama que no replicaba la regla del capitán: seguía
 * exigiendo móvil y correo a todo jugador (functions/api/admin/jugadores.ts,
 * validarJugador, ya los hace opcionales salvo para el capitán). Estos tests
 * fijan que el panel deja guardar a un suplente sin contacto y que sigue
 * exigiéndoselo a quien manda en su equipo.
 *
 * El marcado replica el de src/pages/admin/jugadores.astro.
 */

const MARCADO = `
  <div data-admin-jugadores></div>
  <p data-admin-contador></p>
  <input data-admin-buscar />
  <select data-filtro-equipo></select>
  <button data-jugador-nuevo>+ Nuevo jugador</button>
  <dialog data-jugador-dialog>
    <h2 data-jugador-titulo></h2>
    <p data-jugador-sub></p>
    <button type="button" data-jugador-cerrar>x</button>
    <p data-jugador-banner hidden></p>
    <p data-jugador-aviso-equipo hidden></p>
    <form data-jugador-form novalidate>
      <div class="admin-field">
        <select data-jugador-field="equipoId"></select>
        <p data-jugador-error="equipoId" hidden></p>
      </div>
      <div class="admin-field">
        <input type="text" data-jugador-field="nombre" />
        <p data-jugador-error="nombre" hidden></p>
      </div>
      <div class="admin-field">
        <input type="text" data-jugador-field="apellidos" />
        <p data-jugador-error="apellidos" hidden></p>
      </div>
      <div class="admin-field">
        <label>Móvil <span data-jugador-opt="telefono" hidden>(opcional)</span></label>
        <input type="tel" data-jugador-field="telefono" />
        <p data-jugador-error="telefono" hidden></p>
      </div>
      <div class="admin-field">
        <label>Correo <span data-jugador-opt="email" hidden>(opcional)</span></label>
        <input type="email" data-jugador-field="email" />
        <p data-jugador-error="email" hidden></p>
      </div>
      <div class="admin-field">
        <input type="text" data-jugador-field="redSocial" />
        <p data-jugador-error="redSocial" hidden></p>
      </div>
      <img data-jugador-foto hidden />
      <span data-jugador-foto-vacia hidden></span>
      <input type="file" data-jugador-field="foto" hidden />
      <input type="checkbox" data-jugador-field="eliminarFoto" />
      <p data-jugador-error="foto" hidden></p>
    </form>
    <button type="button" data-jugador-cancelar>Cancelar</button>
    <button type="button" data-jugador-guardar>Guardar jugador</button>
  </dialog>
`;

const jugador = (id: number, nombre: string, equipoId: number, extra: Record<string, unknown> = {}) => ({
  id,
  nombre,
  apellidos: "Apellido",
  telefono: "60011122" + id,
  email: `jugador${id}@example.com`,
  redSocial: null,
  tieneFoto: false,
  esSuplente: false,
  orden: id,
  equipoId,
  equipoNombre: "Los Rompeolas",
  edicionAnio: 2026,
  ...extra
});

// Jugador 1 es el capitán del equipo 7; el 2 es un suplente sin mando.
const JUGADORES = [jugador(1, "Ana", 7), jugador(2, "Luis", 7)];
const EQUIPOS = [{ id: 7, nombre: "Los Rompeolas", capitanJugadorId: 1 }];

const api = vi.fn();
const cargadores: (() => unknown)[] = [];

/** Doble de CopaAdmin fiel a core.js en lo que jugadores.js necesita. */
function montar() {
  document.body.innerHTML = MARCADO;
  cargadores.length = 0;

  const dialogo = document.querySelector("[data-jugador-dialog]") as HTMLElement & {
    showModal: () => void;
    close: () => void;
  };
  dialogo.showModal = vi.fn();
  dialogo.close = vi.fn();

  api.mockReset().mockImplementation(async (ruta: string) => {
    if (ruta.startsWith("/api/admin/jugadores")) return { jugadores: JUGADORES };
    return { ok: true };
  });

  vi.stubGlobal("CopaAdmin", {
    api,
    apiJson: vi.fn(),
    resumen: vi.fn(async () => ({ equipos: EQUIPOS })),
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
    etiqueta: (texto: string) => {
      const span = document.createElement("span");
      span.textContent = texto;
      return span;
    },
    limpiar: (valor: unknown) => String(valor || "").trim().replace(/\s+/g, " "),
    confirmar: vi.fn(async () => true)
  });

  ejecutarScriptPublico("admin/jugadores.js");
}

async function abrirEditor(nombre: string) {
  await Promise.all(cargadores.map((fn) => fn()));
  const editar = Array.from(document.querySelectorAll("button")).filter((b) => b.textContent === "Editar");
  const fila = Array.from(document.querySelectorAll("[data-admin-jugadores] > div > div")).find((linea) =>
    linea.textContent?.includes(nombre)
  );
  const boton = fila?.querySelector("button");
  (boton || editar[0])!.click();
}

const campo = (nombre: string) =>
  document.querySelector<HTMLInputElement>(`[data-jugador-field="${nombre}"]`)!;
const errorDe = (nombre: string) => document.querySelector<HTMLElement>(`[data-jugador-error="${nombre}"]`)!;
const escribir = (nombre: string, valor: string) => {
  const input = campo(nombre);
  input.value = valor;
};
const guardar = () => document.querySelector<HTMLButtonElement>("[data-jugador-guardar]")!.click();

describe("contacto opcional en /admin/jugadores/", () => {
  beforeEach(() => {
    montar();
  });

  it("guarda a un suplente sin móvil ni correo", async () => {
    await abrirEditor("Luis");
    escribir("telefono", "");
    escribir("email", "");

    guardar();
    await vi.waitFor(() => expect(api).toHaveBeenCalledWith(expect.stringContaining("?id=2"), expect.any(Object)));

    expect(errorDe("telefono").hidden).toBe(true);
    expect(errorDe("email").hidden).toBe(true);
  });

  it("sigue exigiendo móvil y correo al capitán de su equipo", async () => {
    await abrirEditor("Ana");
    escribir("telefono", "");
    escribir("email", "");

    guardar();

    expect(errorDe("telefono").hidden).toBe(false);
    expect(errorDe("telefono").textContent).toBe(
      "El capitán necesita móvil y correo para que podamos avisaros."
    );
    expect(errorDe("email").hidden).toBe(false);
    expect(errorDe("email").textContent).toBe(
      "El capitán necesita móvil y correo para que podamos avisaros."
    );
    // La petición no debe llegar a salir: el guardado se detiene en el cliente.
    expect(api).not.toHaveBeenCalledWith(expect.stringContaining("?id=1"), expect.any(Object));
  });

  it("valida el formato del móvil cuando sí se rellena, sea o no capitán", async () => {
    await abrirEditor("Luis");
    escribir("telefono", "123");
    escribir("email", "");

    guardar();

    expect(errorDe("telefono").hidden).toBe(false);
    expect(errorDe("telefono").textContent).toContain("Introduce un móvil válido");
  });

  it("marca (opcional) en los rótulos de quien no es capitán, y los oculta en la ficha del capitán", async () => {
    await abrirEditor("Luis");
    expect(document.querySelector('[data-jugador-opt="telefono"]')!.hasAttribute("hidden")).toBe(false);
    expect(document.querySelector('[data-jugador-opt="email"]')!.hasAttribute("hidden")).toBe(false);

    await abrirEditor("Ana");
    expect(document.querySelector('[data-jugador-opt="telefono"]')!.hasAttribute("hidden")).toBe(true);
    expect(document.querySelector('[data-jugador-opt="email"]')!.hasAttribute("hidden")).toBe(true);
  });

  it("un alta nueva nunca es capitana: el contacto es opcional", async () => {
    await Promise.all(cargadores.map((fn) => fn()));
    document.querySelector<HTMLButtonElement>("[data-jugador-nuevo]")!.click();

    expect(document.querySelector('[data-jugador-opt="telefono"]')!.hasAttribute("hidden")).toBe(false);

    escribir("nombre", "Nueva");
    escribir("apellidos", "Persona");
    campo("equipoId").value = "7";
    escribir("telefono", "");
    escribir("email", "");

    guardar();
    await vi.waitFor(() => expect(api).toHaveBeenCalledWith("/api/admin/jugadores", expect.any(Object)));

    expect(errorDe("telefono").hidden).toBe(true);
    expect(errorDe("email").hidden).toBe(true);
  });
});
