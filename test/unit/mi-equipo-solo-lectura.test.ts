// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ejecutarScriptPublico } from "../helpers/dom";

/*
 * El modo lectura de /mi-equipo/. La garantía de verdad está en el servidor
 * (PATCH y DELETE responden 403 a quien no inscribió el equipo, ver
 * test/integration/mi-equipo.test.ts); esto es lo otro que hay que cumplir:
 * que a esa persona no se le ofrezca un formulario que no va a poder guardar.
 *
 * El marcado replica el de src/pages/mi-equipo.astro. Si allí cambian los
 * `data-*`, este test se cae — que es justo lo que se quiere, porque el script
 * también se caería en silencio.
 */

const MARCADO = `
  <div data-my-team>
    <div data-my-team-loading hidden></div>
    <div data-my-team-empty hidden>
      <p data-my-team-cedido hidden></p>
    </div>
    <div data-my-team-editor hidden>
      <h2 data-my-team-titulo>Editar inscripción</h2>
      <p data-my-team-intro>Cada jugador necesita correo.</p>
      <p data-my-team-lectura hidden>Te inscribió otra persona.</p>
      <div data-my-team-banner hidden></div>
      <form data-my-team-form novalidate>
        <div class="field">
          <input type="text" data-field="equipo" />
        </div>
        <div data-my-team-players></div>
        <button type="button" data-my-team-add-player>+ Añadir suplente</button>
        <button type="submit" data-my-team-save>Guardar cambios</button>
        <button type="button" data-my-team-delete>Borrar equipo</button>
      </form>
    </div>
  </div>
  <template id="my-team-player-template">
    <article class="player-card" data-player>
      <header>
        <span data-dorsal>1</span>
        <span data-role>Titular</span>
        <span data-capitan-badge hidden>Capitán</span>
        <button type="button" data-make-capitan hidden>Hacer capitán</button>
        <button type="button" data-remove hidden>Quitar</button>
      </header>
      <div class="player-grid">
        <div class="field"><input type="text" data-field="nombre" /></div>
        <div class="field"><input type="text" data-field="apellidos" /></div>
        <div class="field"><label>Móvil <span data-opt="telefono" hidden>(opcional)</span></label><input type="tel" data-field="telefono" /></div>
        <div class="field"><label>Correo <span data-opt="email" hidden>(opcional)</span></label><input type="email" data-field="email" /></div>
        <div class="field"><input type="text" data-field="redSocial" /></div>
      </div>
      <p data-contacto-aviso hidden></p>
    </article>
  </template>
`;

const jugador = (nombre: string, email: string) => ({
  id: nombre.length,
  nombre,
  apellidos: "Apellido",
  telefono: "600111222",
  email,
  redSocial: null,
  tieneFoto: false,
  esSuplente: false,
  orden: 1
});

/** Monta la página, responde /api/mi-equipo con ese equipo y corre el script. */
async function montar(team: Record<string, unknown>) {
  document.body.innerHTML = MARCADO;

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ team }), { status: 200 }))
  );
  // El script arranca solo si CopaAuth ya dice que hay sesión y equipo.
  vi.stubGlobal("CopaAuth", {
    state: { loading: false, user: { email: "quien@example.com" }, team: { id: 1 } },
    refresh: async () => {}
  });

  ejecutarScriptPublico("my-team.js");
  // El script carga el equipo con un fetch: se le deja resolver.
  await new Promise((resolve) => setTimeout(resolve, 0));

  const $ = (selector: string) => document.querySelector(selector) as HTMLElement;
  return {
    titulo: $("[data-my-team-titulo]"),
    intro: $("[data-my-team-intro]"),
    aviso: $("[data-my-team-lectura]"),
    guardar: $("[data-my-team-save]"),
    borrar: $("[data-my-team-delete]"),
    añadir: $("[data-my-team-add-player]"),
    fichas: Array.from(document.querySelectorAll("[data-player]")),
    campos: Array.from(document.querySelectorAll("form input")) as HTMLInputElement[]
  };
}

const equipo = (puedeEditar: boolean, jugadores = [jugador("Ana", "quien@example.com"), jugador("Bea", "otra@example.com")]) => ({
  id: 1,
  nombre: "Los Delfines",
  tieneFoto: false,
  puedeEditar,
  capitanJugadorId: jugadores[0]?.id ?? null,
  jugadores
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("editor de /mi-equipo/ en modo lectura", () => {
  it("al propietario le deja los controles de escritura", async () => {
    const ui = await montar(equipo(true));

    expect(ui.guardar.hidden).toBe(false);
    expect(ui.borrar.hidden).toBe(false);
    expect(ui.añadir.hidden).toBe(false);
    expect(ui.campos.every((input) => input.readOnly)).toBe(false);
    expect(ui.aviso.hidden).toBe(true);
    expect(ui.titulo.textContent).toBe("Editar inscripción");
  });

  it("a quien no lo inscribió le esconde guardar, borrar y añadir", async () => {
    const ui = await montar(equipo(false));

    expect(ui.guardar.hidden).toBe(true);
    expect(ui.borrar.hidden).toBe(true);
    expect(ui.añadir.hidden).toBe(true);
    expect(ui.titulo.textContent).toBe("Tu equipo");
  });

  it("deja los campos en readonly, no deshabilitados: los datos se pueden copiar", async () => {
    const ui = await montar(equipo(false));

    expect(ui.campos.length).toBeGreaterThan(0);
    expect(ui.campos.every((input) => input.readOnly)).toBe(true);
    expect(ui.campos.some((input) => input.disabled)).toBe(false);
  });

  it("explica por qué no puede editar, en vez de dejarlo mudo", async () => {
    const ui = await montar(equipo(false));

    expect(ui.aviso.hidden).toBe(false);
    expect(ui.intro.hidden).toBe(true);
  });

  it("no puede quitar jugadores de la plantilla", async () => {
    const ui = await montar(equipo(false));

    const quitar = ui.fichas.map((ficha) => ficha.querySelector("[data-remove]") as HTMLElement);
    expect(quitar).toHaveLength(2);
    expect(quitar.every((boton) => boton.hidden)).toBe(true);
  });

  // Rellenar hasta el mínimo de dos solo tiene sentido si se pueden rellenar.
  it("no añade fichas vacías de relleno a un equipo que no puede tocar", async () => {
    const ui = await montar(equipo(false, [jugador("Ana", "quien@example.com")]));

    expect(ui.fichas).toHaveLength(1);
  });
});
