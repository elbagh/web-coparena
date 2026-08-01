// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ejecutarScriptPublico } from "../helpers/dom";

/*
 * El bocadillo de Mi zona que lleva a /admin/ y a /anotador/.
 *
 * Dos cosas que comprobar, y la segunda es la que pidió el usuario: que quien no
 * tiene permisos no vea nada de esto **ni cerca**. Por eso el bocadillo no está
 * en mi-equipo.astro: lo construye herramientas.js solo cuando /api/me confirma
 * el permiso, así que sin rol no aparece ni en pantalla ni en el código fuente
 * de la página. Lo de «ni en el código fuente» lo sostiene el test que lee el
 * .astro al final de este fichero.
 *
 * El marcado es copia a mano del de la página, como en el resto de tests de
 * scripts públicos.
 */

const PAGINA = `
  <main class="legal-page perfil-page">
    <section class="legal-hero"><h1>Tu ficha de jugador</h1></section>
    <section class="auth-card" data-auth-logged-in hidden></section>
  </main>
`;

const respuesta = (cuerpo: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(cuerpo) } as Response);

const esperar = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

interface Acceso {
  rol?: string | null;
  rolNombre?: string | null;
  esAdmin?: boolean;
  permisos?: string[];
}

/** Deja preparado /api/me y devuelve el mock para poder cambiar la respuesta. */
function prepararSesion(acceso: Acceso | null, conUsuario = true) {
  (window as unknown as Record<string, unknown>).google = {
    accounts: { id: { initialize: vi.fn(), renderButton: vi.fn() } }
  };
  const fetchMock = vi.fn((url: unknown) => {
    if (String(url).startsWith("/api/auth/config")) return respuesta({ googleClientId: "x" });
    return respuesta({
      user: conUsuario ? { id: 1, email: "quien@sea.com" } : null,
      team: null,
      verComo: null,
      acceso,
      inscripcionesAbiertas: true
    });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

/** Carga auth.js y herramientas.js con el DOM ya montado, y espera al /api/me. */
async function montar(acceso: Acceso | null, opciones: { conUsuario?: boolean; tarde?: boolean } = {}) {
  prepararSesion(acceso, opciones.conUsuario ?? true);
  document.body.innerHTML = PAGINA;
  ejecutarScriptPublico("auth.js");

  if (opciones.tarde) {
    // La sesión se resuelve ANTES de que se cargue el script: el evento
    // copa:auth ya no volverá a dispararse y solo queda el arranque a mano.
    await esperar();
    ejecutarScriptPublico("herramientas.js");
    return;
  }

  ejecutarScriptPublico("herramientas.js");
  await esperar();
}

const panel = () => document.querySelector('a[href="/admin/"]');
const anotar = () => document.querySelector('a[href="/anotador/"]');
const burbuja = () => document.querySelector(".zona-herramientas");

// auth.js es un IIFE sin `export`: lo que publica en window no está tipado.
const copaAuth = () => (window as unknown as { CopaAuth: { refresh(): Promise<void> } }).CopaAuth;

function leer(rutaRelativa: string) {
  return readFileSync(path.resolve(import.meta.dirname, "../..", rutaRelativa), "utf8");
}

describe("las herramientas de la organización en Mi zona", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as Record<string, unknown>).CopaAuth;
  });

  describe("quien no tiene permisos no ve nada", () => {
    it("sin sesión no hay ni bocadillo ni enlaces", async () => {
      await montar(null, { conUsuario: false });

      expect(burbuja()).toBeNull();
      expect(panel()).toBeNull();
      expect(anotar()).toBeNull();
    });

    it("con sesión pero sin rol tampoco", async () => {
      await montar(null);

      expect(burbuja()).toBeNull();
      expect(panel()).toBeNull();
      expect(anotar()).toBeNull();
    });

    it("con un rol que no lleva ninguno de los permisos tampoco", async () => {
      await montar({ rol: "invitado", rolNombre: "Invitado", esAdmin: false, permisos: ["equipos.ver"] });

      expect(burbuja()).toBeNull();
      expect(panel()).toBeNull();
      expect(anotar()).toBeNull();
    });
  });

  describe("cada permiso enseña su enlace", () => {
    it("panel.entrar enseña solo el del panel", async () => {
      await montar({ rolNombre: "Recepción", permisos: ["panel.entrar"] });

      expect(panel()).not.toBeNull();
      expect(anotar()).toBeNull();
    });

    it("partidos.anotar enseña solo el del anotador", async () => {
      await montar({ rolNombre: "Anotador", permisos: ["partidos.anotar"] });

      expect(panel()).toBeNull();
      expect(anotar()).not.toBeNull();
    });

    it("partidos.editar también abre el anotador: es lo que exige el endpoint", async () => {
      await montar({ rolNombre: "Organización", permisos: ["partidos.editar"] });

      expect(anotar()).not.toBeNull();
    });

    it("el rol anotador de sistema ve los dos, porque puede usar los dos", async () => {
      await montar({
        rol: "anotador",
        rolNombre: "Anotador",
        permisos: ["panel.entrar", "jugadores.ver", "torneo.ver", "partidos.anotar"]
      });

      expect(panel()).not.toBeNull();
      expect(anotar()).not.toBeNull();
    });

    it("un admin ve los dos sin que le listen los permisos", async () => {
      await montar({ rol: "admin", rolNombre: "Administración", esAdmin: true, permisos: [] });

      expect(panel()).not.toBeNull();
      expect(anotar()).not.toBeNull();
    });
  });

  describe("dónde y cómo se pinta", () => {
    it("va justo detrás de la portadilla, encima de la tarjeta de Cuenta", async () => {
      await montar({ rolNombre: "Administración", esAdmin: true });

      expect(document.querySelector(".legal-hero")!.nextElementSibling).toBe(burbuja());
    });

    it("el sello lleva el nombre del rol", async () => {
      await montar({ rolNombre: "Organización", permisos: ["panel.entrar"] });

      expect(document.querySelector(".zona-herramientas-rol")!.textContent).toBe("Organización");
    });

    it("no lleva la clase reveal", async () => {
      // site-interactions.js consulta `.reveal` una sola vez al cargar y
      // desconecta el observador tras cada aparición: un nodo insertado después
      // nunca recibiría `in-view` y se quedaría invisible para siempre.
      await montar({ rolNombre: "Administración", esAdmin: true });

      expect(burbuja()!.querySelectorAll(".reveal")).toHaveLength(0);
      expect(burbuja()!.classList.contains("reveal")).toBe(false);
    });

    it("no lleva la clase .paso, que reparte el color y el rabito por posición", async () => {
      await montar({ rolNombre: "Administración", esAdmin: true });

      expect(burbuja()!.classList.contains("paso")).toBe(false);
    });

    it("se pinta igual si la sesión ya estaba resuelta al cargar el script", async () => {
      await montar({ rolNombre: "Administración", esAdmin: true }, { tarde: true });

      expect(panel()).not.toBeNull();
      expect(anotar()).not.toBeNull();
    });

    it("no se duplica cuando la sesión se refresca sin cambios", async () => {
      await montar({ rolNombre: "Administración", esAdmin: true });

      await copaAuth().refresh();
      await esperar();

      expect(document.querySelectorAll(".zona-herramientas")).toHaveLength(1);
    });

    it("desaparece al cerrar sesión, sin recargar", async () => {
      await montar({ rolNombre: "Administración", esAdmin: true });
      expect(burbuja()).not.toBeNull();

      prepararSesion(null, false);
      await copaAuth().refresh();
      await esperar();

      expect(burbuja()).toBeNull();
      expect(panel()).toBeNull();
      expect(anotar()).toBeNull();
    });
  });

  describe("lo que sostiene «ni en el código fuente»", () => {
    it("mi-equipo.astro no nombra ni /admin/ ni /anotador/", () => {
      const fuente = leer("src/pages/mi-equipo.astro");

      expect(fuente).not.toMatch(/["'`]\/admin\//);
      expect(fuente).not.toMatch(/["'`]\/anotador\//);
    });

    it("carga herramientas.js, que es quien lo construye", () => {
      expect(leer("src/pages/mi-equipo.astro")).toContain("/assets/herramientas.js");
    });
  });

  it("el par de permisos del anotador sigue siendo el que exige el endpoint", () => {
    /*
     * functions/api/anotacion.ts abre su GET con
     * requireAlgunPermiso(["partidos.anotar", "partidos.editar"]). Si allí se
     * cierra, el enlace de aquí empezaría a prometer una pantalla que responde
     * 403 — y esta copia a mano es justo la que no se enteraría.
     */
    const endpoint = leer("functions/api/anotacion.ts");
    const cliente = leer("public/assets/herramientas.js");

    expect(endpoint).toMatch(/requireAlgunPermiso\([^)]*"partidos\.anotar"[^)]*"partidos\.editar"/s);
    expect(cliente).toContain('PERMISOS_ANOTAR = ["partidos.anotar", "partidos.editar"]');
  });
});
