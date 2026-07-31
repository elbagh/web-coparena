// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ejecutarScriptPublico } from "../helpers/dom";

/*
 * Cerrar las inscripciones no puede dejar a nadie sin entrar.
 *
 * `[data-auth-logged-out]` es la tarjeta de «Entra con Google» de todo el sitio:
 * la usan /mi-equipo/, /camisetas/, el panel y el anotador igual que
 * /inscripcion/. Al cerrar las inscripciones de la edición se ocultaba por ese
 * selector compartido, así que /mi-equipo/ se quedó con un hueco vacío entre la
 * portadilla y el pie: sin botón de Google y sin nada que lo explicara. El panel
 * y el anotador perdían su puerta de la misma forma, y el anotador se usa el día
 * del torneo, que es justo cuando las inscripciones ya están cerradas.
 *
 * Lo que sí depende de que estén abiertas es la invitación a entrar *de
 * /inscripcion/*, y eso lo pide esa página con `data-auth-solo-abiertas`.
 *
 * El marcado es copia a mano del de las páginas, como en el resto de tests de
 * scripts públicos; por eso al final se leen los .astro.
 */

const PAGINA = `
  <section data-auth-loading><h2>Comprobando sesión...</h2></section>
  <section data-auth-logged-out hidden>
    <p data-auth-error hidden></p>
    <div data-google-login></div>
  </section>
  <section data-auth-logged-in hidden></section>
`;

const INSCRIPCION = `
  <section data-auth-loading><h2>Comprobando sesión...</h2></section>
  <section data-auth-cerradas hidden><h2>Inscripciones cerradas</h2></section>
  <section data-auth-logged-out data-auth-solo-abiertas hidden>
    <p data-auth-error hidden></p>
    <div data-google-login></div>
  </section>
  <section data-auth-no-team hidden></section>
`;

const respuesta = (cuerpo: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(cuerpo) } as Response);

const esperar = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const visible = (selector: string) => !document.querySelector(selector)!.hasAttribute("hidden");

let renderButton: ReturnType<typeof vi.fn>;

async function montar(marcado: string, inscripcionesAbiertas: boolean) {
  renderButton = vi.fn();
  (window as unknown as Record<string, unknown>).google = {
    accounts: { id: { initialize: vi.fn(), renderButton } }
  };
  globalThis.fetch = vi.fn((url: unknown) => {
    if (String(url).startsWith("/api/auth/config")) {
      return respuesta({ googleClientId: "prueba.apps.googleusercontent.com" });
    }
    return respuesta({ user: null, team: null, verComo: null, acceso: null, inscripcionesAbiertas });
  }) as unknown as typeof fetch;

  document.body.innerHTML = marcado;
  ejecutarScriptPublico("auth.js");
  await esperar();
}

/** El fragmento `<section …>` que abre la tarjeta de entrar de un fichero. */
function etiquetaDeEntrada(rutaRelativa: string) {
  const ruta = path.resolve(import.meta.dirname, "../..", rutaRelativa);
  const fuente = readFileSync(ruta, "utf8");
  const etiqueta = fuente.match(/<[a-zA-Z]+[^>]*\bdata-auth-logged-out\b[^>]*>/);
  if (!etiqueta) throw new Error(`${rutaRelativa} no tiene tarjeta [data-auth-logged-out]`);
  return etiqueta[0];
}

describe("el login de Google con las inscripciones cerradas", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sigue enseñando la tarjeta de entrar en una página que no es la inscripción", async () => {
    await montar(PAGINA, false);

    expect(visible("[data-auth-logged-out]")).toBe(true);
    expect(visible("[data-auth-loading]")).toBe(false);
    expect(renderButton).toHaveBeenCalledWith(
      document.querySelector("[data-google-login]"),
      expect.anything()
    );
  });

  it("la enseña igual con las inscripciones abiertas", async () => {
    await montar(PAGINA, true);

    expect(visible("[data-auth-logged-out]")).toBe(true);
  });

  it("en /inscripcion/ deja el sitio al aviso de cerradas", async () => {
    await montar(INSCRIPCION, false);

    expect(visible("[data-auth-logged-out]")).toBe(false);
    expect(visible("[data-auth-cerradas]")).toBe(true);
  });

  it("en /inscripcion/ vuelve a pedir entrar cuando se reabren", async () => {
    await montar(INSCRIPCION, true);

    expect(visible("[data-auth-logged-out]")).toBe(true);
    expect(visible("[data-auth-cerradas]")).toBe(false);
  });

  it("solo /inscripcion/ marca su tarjeta con data-auth-solo-abiertas", () => {
    expect(etiquetaDeEntrada("src/pages/inscripcion.astro")).toContain("data-auth-solo-abiertas");

    for (const ruta of [
      "src/pages/mi-equipo.astro",
      "src/pages/camisetas.astro",
      "src/layouts/AdminLayout.astro",
      "src/layouts/AnotadorLayout.astro"
    ]) {
      expect(etiquetaDeEntrada(ruta)).not.toContain("data-auth-solo-abiertas");
    }
  });
});
