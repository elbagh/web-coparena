// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ejecutarScriptPublico } from "../helpers/dom";

/*
 * /admin/roles/ — la matriz de permisos.
 *
 * Lo que se prueba aquí es lo que el servidor no puede probar: que la pantalla
 * pinta el catálogo como matriz `recurso × accion`, que un hueco significa «esa
 * acción no existe para ese recurso» en vez de «existe y está apagada», y que el
 * rol de sistema se abre sin poder tocarse.
 *
 * El marcado replica el de src/pages/admin/roles.astro a mano, igual que hacen
 * estadisticas-solo-lectura.test.ts y album-jugadores.test.ts. Es una copia: si
 * allí cambian los `data-*`, este test sigue en verde y es producción la que se
 * rompe en silencio. Hay que mantener MARCADO sincronizado con el .astro.
 */

const MARCADO = `
  <button type="button" data-rol-nuevo>Nuevo rol</button>
  <div data-admin-roles></div>

  <dialog data-rol-dialog>
    <div class="admin-dialog-shell">
      <div class="admin-dialog-head">
        <div>
          <h2 data-rol-titulo></h2>
          <p data-rol-sub></p>
        </div>
        <button type="button" data-rol-cerrar aria-label="Cerrar">×</button>
      </div>
      <div class="admin-dialog-body">
        <p data-rol-nota hidden></p>
        <form data-rol-form novalidate>
          <div class="admin-field">
            <input data-rol-field="nombre" />
            <p data-rol-error="nombre" hidden></p>
          </div>
          <div class="admin-field">
            <input data-rol-field="clave" />
            <p data-rol-error="clave" hidden></p>
          </div>
          <div class="admin-field">
            <input data-rol-field="descripcion" />
            <p data-rol-error="descripcion" hidden></p>
          </div>
          <p data-rol-error="permisos" hidden></p>
          <div class="roles-matriz-scroll"><table data-rol-matriz></table></div>
        </form>
      </div>
      <div class="admin-dialog-foot">
        <span data-rol-cuenta></span>
        <p role="alert" data-rol-banner hidden></p>
        <button type="button" data-rol-cancelar>Cancelar</button>
        <button type="button" data-rol-guardar>Guardar rol</button>
      </div>
    </div>
  </dialog>
`;

/*
 * Un catálogo recortado con la propiedad que importa: `partidos` no admite
 * `ver` (el listado de partidos es público) y `panel` solo admite `entrar`.
 * Esos dos huecos son lo que la matriz tiene que saber dibujar.
 */
const CATALOGO = [
  { clave: "panel.entrar", recurso: "panel", accion: "entrar", recursoEtiqueta: "Panel", etiqueta: "Entrar" },
  { clave: "equipos.ver", recurso: "equipos", accion: "ver", recursoEtiqueta: "Equipos", etiqueta: "Ver" },
  { clave: "equipos.editar", recurso: "equipos", accion: "editar", recursoEtiqueta: "Equipos", etiqueta: "Crear y editar" },
  { clave: "equipos.borrar", recurso: "equipos", accion: "borrar", recursoEtiqueta: "Equipos", etiqueta: "Borrar" },
  { clave: "partidos.editar", recurso: "partidos", accion: "editar", recursoEtiqueta: "Partidos", etiqueta: "Crear y editar" },
  { clave: "partidos.borrar", recurso: "partidos", accion: "borrar", recursoEtiqueta: "Partidos", etiqueta: "Borrar" }
];

const ROLES = [
  {
    id: 1,
    clave: "admin",
    nombre: "Administración",
    descripcion: "Acceso total.",
    esSistema: true,
    usuarios: 2,
    permisos: CATALOGO.map((p) => p.clave)
  },
  {
    id: 2,
    clave: "organizacion",
    nombre: "Organización",
    descripcion: "Gestiona el torneo.",
    esSistema: false,
    usuarios: 1,
    permisos: ["panel.entrar", "equipos.ver"]
  }
];

const apiJson = vi.fn();
const recargar = vi.fn();
let permisosDelActor: string[] | "todos" = "todos";

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
    api: vi.fn(async () => ({ roles: ROLES, catalogo: CATALOGO })),
    apiJson,
    onReady: (fn: () => Promise<void>) => cargadores.push(fn),
    recargar,
    setError: vi.fn(),
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
    confirmar: vi.fn(async () => true),
    puede: (permiso: string) => permisosDelActor === "todos" || permisosDelActor.includes(permiso)
  };

  return { cargadores };
}

const matriz = () => document.querySelector("[data-rol-matriz]")!;
const casillas = () => [...matriz().querySelectorAll<HTMLInputElement>("[data-rol-permiso]")];
const abrirRol = (nombre: string) => {
  const boton = [...document.querySelectorAll<HTMLButtonElement>("[data-admin-roles] button")].find(
    (b) => b.parentElement?.parentElement?.textContent?.includes(nombre)
  );
  boton!.click();
};

async function montar() {
  document.body.innerHTML = MARCADO;
  const { cargadores } = stubCopaAdmin();
  ejecutarScriptPublico("admin/roles.js");
  await Promise.all(cargadores.map((fn) => fn()));
}

beforeEach(() => {
  vi.clearAllMocks();
  permisosDelActor = "todos";
  // jsdom no implementa <dialog>.
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

describe("la matriz refleja el catálogo", () => {
  it("una fila por recurso y una columna por acción, sin repetir", async () => {
    await montar();
    abrirRol("Organización");

    const recursos = [...matriz().querySelectorAll('th[scope="row"]')].map((th) => th.textContent);
    expect(recursos).toEqual(["Panel", "Equipos", "Partidos"]);

    const columnas = [...matriz().querySelectorAll('thead th[scope="col"]')].map((th) => th.textContent);
    expect(columnas).toEqual(["Recurso", "Entrar", "Ver", "Crear y editar", "Borrar", ""]);
  });

  /*
   * Es la decisión de diseño de la pantalla: un hueco dice «esto no existe»,
   * que es cierto. Una casilla desmarcada diría «existe y está apagado», que
   * sería mentira — nadie puede conceder `partidos.ver` porque no hay tal cosa.
   */
  it("una acción que no existe para un recurso deja hueco, no casilla", async () => {
    await montar();
    abrirRol("Organización");

    expect(casillas().map((c) => c.dataset.rolPermiso)).toEqual([
      "panel.entrar",
      "equipos.ver",
      "equipos.editar",
      "equipos.borrar",
      "partidos.editar",
      "partidos.borrar"
    ]);
    // Panel solo tiene «Entrar»; partidos no tiene «Ver».
    expect(matriz().querySelectorAll(".roles-celda-vacia").length).toBe(6);
  });

  it("marca las casillas que el rol ya tiene", async () => {
    await montar();
    abrirRol("Organización");

    const marcadas = casillas().filter((c) => c.checked).map((c) => c.dataset.rolPermiso);
    expect(marcadas).toEqual(["panel.entrar", "equipos.ver"]);
    expect(document.querySelector("[data-rol-cuenta]")!.textContent).toBe("2 de 6 permisos");
  });
});

describe("el rol de sistema se ve pero no se toca", () => {
  it("abre todo desactivado, sin botón de guardar y con la explicación", async () => {
    await montar();
    abrirRol("Administración");

    expect(casillas().every((c) => c.disabled)).toBe(true);
    expect(casillas().every((c) => c.checked)).toBe(true);
    expect((document.querySelector("[data-rol-guardar]") as HTMLElement).hidden).toBe(true);

    const nota = document.querySelector("[data-rol-nota]") as HTMLElement;
    expect(nota.hidden).toBe(false);
    expect(nota.textContent).toContain("no se puede editar");
  });

  it("no ofrece el atajo de fila", async () => {
    await montar();
    abrirRol("Administración");
    expect(matriz().querySelectorAll(".roles-fila-toggle").length).toBe(0);
  });
});

describe("nadie reparte permisos que no tiene", () => {
  // Espejo en cliente del candado del servidor. Enseñarlos desactivados explica
  // por qué no se pueden dar; esconderlos parecería que no existen.
  it("los permisos fuera del alcance salen desactivados y marcados", async () => {
    permisosDelActor = ["panel.entrar", "equipos.ver", "roles.ver", "roles.editar"];
    await montar();
    abrirRol("Organización");

    const vetadas = casillas().filter((c) => c.disabled).map((c) => c.dataset.rolPermiso);
    expect(vetadas).toEqual(["equipos.editar", "equipos.borrar", "partidos.editar", "partidos.borrar"]);
    expect(matriz().querySelectorAll(".roles-celda--vetada").length).toBe(4);
  });

  it("el atajo de fila nunca enciende lo que está vetado", async () => {
    permisosDelActor = ["panel.entrar", "equipos.ver", "roles.editar"];
    await montar();
    abrirRol("Organización");

    // Dos pasadas: la primera apaga las filas que ya venían marcadas y la
    // segunda las vuelve a encender, así que se recorren los dos sentidos del
    // atajo. En ninguno de los dos puede encenderse un permiso vetado.
    const toggles = [...matriz().querySelectorAll<HTMLButtonElement>(".roles-fila-toggle")];
    toggles.forEach((t) => t.click());
    expect(casillas().filter((c) => c.disabled && c.checked)).toEqual([]);

    toggles.forEach((t) => t.click());
    expect(casillas().filter((c) => c.disabled && c.checked)).toEqual([]);

    // Lo que sí alcanza queda encendido: el atajo funciona, solo que acotado.
    const encendidas = casillas().filter((c) => c.checked).map((c) => c.dataset.rolPermiso);
    expect(encendidas).toEqual(["panel.entrar", "equipos.ver"]);
  });
});

describe("guardar", () => {
  it("manda exactamente las casillas marcadas", async () => {
    await montar();
    abrirRol("Organización");

    casillas().find((c) => c.dataset.rolPermiso === "partidos.editar")!.click();
    casillas().find((c) => c.dataset.rolPermiso === "equipos.ver")!.click();

    (document.querySelector("[data-rol-guardar]") as HTMLButtonElement).click();
    await Promise.resolve();

    expect(apiJson).toHaveBeenCalledWith("/api/admin/roles?id=2", "PATCH", {
      clave: "organizacion",
      nombre: "Organización",
      descripcion: "Gestiona el torneo.",
      permisos: ["panel.entrar", "partidos.editar"]
    });
  });

  it("el atajo de fila marca y desmarca el recurso entero", async () => {
    await montar();
    abrirRol("Organización");

    const filaEquipos = [...matriz().querySelectorAll("tbody tr")].find((tr) =>
      tr.querySelector('th[scope="row"]')?.textContent === "Equipos"
    )!;
    const toggle = filaEquipos.querySelector<HTMLButtonElement>(".roles-fila-toggle")!;

    toggle.click();
    expect(casillas().filter((c) => c.dataset.rolRecurso === "equipos").every((c) => c.checked)).toBe(true);
    expect(toggle.textContent).toBe("nada");

    toggle.click();
    expect(casillas().filter((c) => c.dataset.rolRecurso === "equipos").some((c) => c.checked)).toBe(false);
    expect(toggle.textContent).toBe("todo");
  });

  it("un rol nuevo se crea con POST y la clave editable", async () => {
    await montar();
    (document.querySelector("[data-rol-nuevo]") as HTMLButtonElement).click();

    expect((document.querySelector('[data-rol-field="clave"]') as HTMLInputElement).disabled).toBe(false);
    expect(casillas().some((c) => c.checked)).toBe(false);

    (document.querySelector('[data-rol-field="clave"]') as HTMLInputElement).value = "arbitros";
    (document.querySelector('[data-rol-field="nombre"]') as HTMLInputElement).value = "Árbitros";
    casillas().find((c) => c.dataset.rolPermiso === "equipos.ver")!.click();

    (document.querySelector("[data-rol-guardar]") as HTMLButtonElement).click();
    await Promise.resolve();

    expect(apiJson).toHaveBeenCalledWith("/api/admin/roles", "POST", {
      clave: "arbitros",
      nombre: "Árbitros",
      descripcion: "",
      permisos: ["equipos.ver"]
    });
  });

  it("editando un rol existente la clave queda bloqueada", async () => {
    await montar();
    abrirRol("Organización");
    expect((document.querySelector('[data-rol-field="clave"]') as HTMLInputElement).disabled).toBe(true);
  });
});
