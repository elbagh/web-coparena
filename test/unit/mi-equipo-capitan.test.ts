// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ejecutarScriptPublico } from "../helpers/dom";

/*
 * El capitán en /mi-equipo/: quién sale marcado, qué se manda al guardar y qué
 * pasa al ceder. La garantía de verdad está en el servidor
 * (test/integration/mi-equipo.test.ts); esto es lo otro que hay que cumplir:
 * que ceder el equipo no ocurra por accidente y que el payload diga quién manda.
 *
 * El marcado replica el de src/pages/mi-equipo.astro.
 */

const MARCADO = `
  <div data-my-team>
    <div data-my-team-loading hidden></div>
    <div data-my-team-empty hidden>
      <p data-my-team-cedido hidden></p>
    </div>
    <div data-my-team-editor hidden>
      <h2 data-my-team-titulo>Editar inscripción</h2>
      <p data-my-team-intro></p>
      <p data-my-team-lectura hidden></p>
      <div data-my-team-banner hidden></div>
      <form data-my-team-form novalidate>
        <div class="field"><input type="text" data-field="equipo" /></div>
        <div data-my-team-players></div>
        <button type="button" data-my-team-add-player>+ Añadir suplente</button>
        <button type="submit" data-my-team-save>Guardar cambios</button>
        <button type="button" data-my-team-delete>Borrar equipo</button>
      </form>
    </div>
  </div>
  <template id="my-team-player-template">
    <article class="player-card" data-player>
      <header class="player-head">
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

const jugador = (id: number, nombre: string, email: string, telefono = "600111222") => ({
  id,
  nombre,
  apellidos: "Apellido",
  telefono,
  email,
  redSocial: null,
  tieneFoto: false,
  esSuplente: false,
  orden: id
});

const equipo = (extra: Record<string, unknown> = {}) => ({
  id: 1,
  nombre: "Los Rompeolas",
  createdAt: "2026-01-01",
  tieneFoto: false,
  puedeEditar: true,
  capitanJugadorId: 1,
  jugadores: [jugador(1, "Ana", "capi@example.com"), jugador(2, "Luis", "luis@example.com")],
  ...extra
});

/** Respuesta JSON simulada. */
const respuesta = (cuerpo: unknown, ok = true) =>
  Promise.resolve({ ok, status: ok ? 200 : 400, json: () => Promise.resolve(cuerpo) } as Response);

const cards = () => Array.from(document.querySelectorAll("[data-player]"));
const guardar = () =>
  document.querySelector<HTMLFormElement>("[data-my-team-form]")!.dispatchEvent(
    new Event("submit", { cancelable: true })
  );
const esperar = () => new Promise((resolve) => setTimeout(resolve, 0));

async function montar(team: Record<string, unknown>) {
  document.body.innerHTML = MARCADO;
  (window as unknown as Record<string, unknown>).CopaAuth = {
    state: { loading: false, user: { email: "capi@example.com" }, team: { id: 1 } },
    refresh: vi.fn()
  };
  globalThis.fetch = vi.fn(() => respuesta({ team })) as unknown as typeof fetch;
  ejecutarScriptPublico("my-team.js");
  await esperar();
}

describe("el capitán en Mi zona", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.confirm = vi.fn(() => true);
  });

  it("marca como capitán al jugador que dice el servidor", async () => {
    await montar(equipo({ capitanJugadorId: 2 }));
    expect(cards()[1]!.querySelector("[data-capitan-badge]")!.hasAttribute("hidden")).toBe(false);
    expect(cards()[0]!.querySelector("[data-capitan-badge]")!.hasAttribute("hidden")).toBe(true);
  });

  it("envía el índice del capitán en el payload", async () => {
    await montar(equipo());
    guardar();
    await esperar();

    const llamadas = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const patch = llamadas.find(([, opciones]) => (opciones as RequestInit | undefined)?.method === "PATCH");
    expect(patch).toBeTruthy();
    expect(JSON.parse(String((patch![1] as RequestInit).body))).toMatchObject({ capitan: 0 });
  });

  it("pide confirmación antes de ceder y no guarda si se cancela", async () => {
    await montar(equipo());
    window.confirm = vi.fn(() => false);

    cards()[1]!.querySelector<HTMLButtonElement>("[data-make-capitan]")!.click();
    guardar();
    await esperar();

    expect(window.confirm).toHaveBeenCalled();
    const llamadas = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(llamadas.some(([, o]) => (o as RequestInit | undefined)?.method === "PATCH")).toBe(false);
  });

  it("cede cuando se confirma", async () => {
    await montar(equipo());
    cards()[1]!.querySelector<HTMLButtonElement>("[data-make-capitan]")!.click();
    guardar();
    await esperar();

    const llamadas = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const patch = llamadas.find(([, o]) => (o as RequestInit | undefined)?.method === "PATCH");
    expect(JSON.parse(String((patch![1] as RequestInit).body))).toMatchObject({ capitan: 1 });
  });

  it("muestra el estado vacío cuando el guardado devuelve team: null", async () => {
    await montar(equipo());
    globalThis.fetch = vi.fn(() => respuesta({ ok: true, team: null })) as unknown as typeof fetch;

    cards()[1]!.querySelector<HTMLButtonElement>("[data-make-capitan]")!.click();
    guardar();
    await esperar();

    expect(document.querySelector("[data-my-team-empty]")!.hasAttribute("hidden")).toBe(false);
    expect(document.querySelector("[data-my-team-cedido]")!.textContent).toContain("cedido");
  });

  it("oculta el aviso de cesión al cargar otro equipo sin recargar la página", async () => {
    await montar(equipo());
    globalThis.fetch = vi.fn(() => respuesta({ ok: true, team: null })) as unknown as typeof fetch;

    cards()[1]!.querySelector<HTMLButtonElement>("[data-make-capitan]")!.click();
    guardar();
    await esperar();

    expect(document.querySelector<HTMLElement>("[data-my-team-cedido]")!.hidden).toBe(false);

    // Sin recargar: el usuario entra en otro equipo (o el mismo se recarga) y
    // copa:auth dispara una carga nueva. El aviso de la cesión anterior ya no
    // pinta nada aquí y no debe seguir en pantalla.
    globalThis.fetch = vi.fn(() =>
      respuesta({ team: equipo({ id: 2, nombre: "Equipo Nuevo" }) })
    ) as unknown as typeof fetch;
    window.dispatchEvent(
      new CustomEvent("copa:auth", {
        detail: { loading: false, user: { email: "capi@example.com" }, team: { id: 2 } }
      })
    );
    await esperar();

    const cedido = document.querySelector<HTMLElement>("[data-my-team-cedido]")!;
    expect(cedido.hidden).toBe(true);
    expect(cedido.textContent).toBe("");
  });

  it("en modo lectura no ofrece ceder", async () => {
    await montar(equipo({ puedeEditar: false }));
    cards().forEach((card) => {
      expect(card.querySelector("[data-make-capitan]")!.hasAttribute("hidden")).toBe(true);
    });
  });

  it("no deja quitar al capitán aunque esté en un hueco de suplente", async () => {
    await montar(
      equipo({
        capitanJugadorId: 3,
        jugadores: [
          jugador(1, "Ana", "ana@example.com"),
          jugador(2, "Luis", "luis@example.com"),
          jugador(3, "Bea", "capi@example.com")
        ]
      })
    );
    // El capitán es la tercera tarjeta (índice 2), un hueco de suplente: sin
    // esta protección su botón «Quitar» quedaría visible, saltándose la regla
    // de que primero hay que ceder el mando.
    expect(cards()[2]!.querySelector("[data-remove]")!.hasAttribute("hidden")).toBe(true);
  });

  it("no avisa de una cesión falsa cuando el equipo aún no tiene capitán", async () => {
    await montar(equipo({ capitanJugadorId: null }));
    // Ni se toca la capitanía (no hay click en «Hacer capitán») ni el usuario
    // cambia de tarjeta: guardar así no debe pedir confirmación de cesión.
    guardar();
    await esperar();

    expect(window.confirm).not.toHaveBeenCalled();
  });
});
