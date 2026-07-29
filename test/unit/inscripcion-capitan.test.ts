// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { ejecutarScriptPublico } from "../helpers/dom";

/*
 * El capitán y el aviso de contacto en /inscripcion/. La garantía de verdad
 * está en el servidor (functions/_lib/validacion.ts), pero el formulario tiene
 * que contarlo bien antes de enviar: quién manda, a quién se le puede ceder y
 * qué pasa con quien no deja ni móvil ni correo.
 *
 * El marcado replica el de src/pages/inscripcion.astro: si allí cambian los
 * data-*, este test se cae, que es justo lo que se quiere.
 */

const MARCADO = `
  <form data-team-form novalidate>
    <div class="form-banner" data-banner hidden></div>
    <div class="field"><input type="text" data-field="equipo" /><p class="field-error" hidden></p></div>
    <div class="players" data-players></div>
    <button type="button" data-add-player>+ Añadir suplente</button>
    <div class="consent-box" data-consent>
      <input type="checkbox" data-field="consentimiento" />
      <p class="field-error" hidden></p>
    </div>
    <button type="submit" data-submit>Inscribir equipo</button>
  </form>
  <section data-success hidden><p data-success-text></p></section>
  <template id="player-template">
    <article class="player-card" data-player>
      <header class="player-head">
        <span data-dorsal>1</span>
        <span data-role>Titular</span>
        <span class="player-capitan" data-capitan-badge hidden>Capitán</span>
        <button type="button" data-make-capitan hidden>Hacer capitán</button>
        <button type="button" data-remove hidden>Quitar</button>
      </header>
      <div class="player-grid">
        <div class="field"><label data-label="nombre">Nombre</label><input type="text" data-field="nombre" /><p class="field-error" hidden></p></div>
        <div class="field"><label data-label="apellidos">Apellidos</label><input type="text" data-field="apellidos" /><p class="field-error" hidden></p></div>
        <div class="field"><label data-label="telefono">Móvil <span class="field-opt" data-opt="telefono" hidden>(opcional)</span></label><input type="tel" data-field="telefono" /><p class="field-error" hidden></p></div>
        <div class="field"><label data-label="email">Correo <span class="field-opt" data-opt="email" hidden>(opcional)</span></label><input type="email" data-field="email" /><p class="field-error" hidden></p></div>
        <div class="field"><label data-label="redSocial">Instagram</label><input type="text" data-field="redSocial" /><p class="field-error" hidden></p></div>
        <div class="field"><label data-label="foto">Foto</label><input type="file" data-field="foto" /><p class="field-error" hidden></p></div>
      </div>
      <p class="player-warning" data-contacto-aviso hidden></p>
    </article>
  </template>
`;

const cartas = () => Array.from(document.querySelectorAll("[data-player]"));
const escribir = (carta: Element, campo: string, valor: string) => {
  const input = carta.querySelector<HTMLInputElement>(`[data-field="${campo}"]`)!;
  input.value = valor;
  input.dispatchEvent(new Event("blur"));
  input.dispatchEvent(new Event("input"));
};

describe("capitán y aviso de contacto en la inscripción", () => {
  beforeEach(() => {
    document.body.innerHTML = MARCADO;
    (window as unknown as Record<string, unknown>).CopaAuth = {
      state: { user: { email: "capi@example.com" } }
    };
    ejecutarScriptPublico("team-form.js");
  });

  it("nombra capitán al primer jugador", () => {
    const [primera, segunda] = cartas();
    expect(primera!.querySelector("[data-capitan-badge]")!.hasAttribute("hidden")).toBe(false);
    expect(segunda!.querySelector("[data-capitan-badge]")!.hasAttribute("hidden")).toBe(true);
    expect(segunda!.querySelector("[data-make-capitan]")!.hasAttribute("hidden")).toBe(false);
  });

  it("marca como opcionales el móvil y el correo de quien no es capitán", () => {
    const [primera, segunda] = cartas();
    expect(primera!.querySelector('[data-opt="email"]')!.hasAttribute("hidden")).toBe(true);
    expect(segunda!.querySelector('[data-opt="email"]')!.hasAttribute("hidden")).toBe(false);
  });

  it("avisa de lo que falta y quita el aviso al completarlo", () => {
    const segunda = cartas()[1]!;
    const aviso = segunda.querySelector<HTMLElement>("[data-contacto-aviso]")!;

    expect(aviso.hidden).toBe(false);
    expect(aviso.textContent).toContain("ni recibirá avisos");

    escribir(segunda, "telefono", "600111222");
    expect(aviso.hidden).toBe(false);
    expect(aviso.textContent).toBe("Sin correo no recibirá los avisos del torneo.");

    escribir(segunda, "email", "otro@example.com");
    expect(aviso.hidden).toBe(true);
  });

  it("no deja hacer capitán a quien no tiene móvil y correo", () => {
    const segunda = cartas()[1]!;
    const boton = segunda.querySelector<HTMLButtonElement>("[data-make-capitan]")!;
    expect(boton.disabled).toBe(true);

    escribir(segunda, "telefono", "600111222");
    escribir(segunda, "email", "otro@example.com");
    expect(boton.disabled).toBe(false);
  });

  it("mueve la capitanía al pulsar el botón", () => {
    const [primera, segunda] = cartas();
    escribir(segunda!, "telefono", "600111222");
    escribir(segunda!, "email", "otro@example.com");
    segunda!.querySelector<HTMLButtonElement>("[data-make-capitan]")!.click();

    expect(segunda!.querySelector("[data-capitan-badge]")!.hasAttribute("hidden")).toBe(false);
    expect(primera!.querySelector("[data-capitan-badge]")!.hasAttribute("hidden")).toBe(true);
    expect(primera!.querySelector("[data-make-capitan]")!.hasAttribute("hidden")).toBe(false);
  });

  it("al capitán no se le puede quitar de la plantilla", () => {
    // Con tres tarjetas, la tercera sí tendría botón de quitar por ser suplente:
    // que desaparezca al nombrarla capitana es la regla, no un efecto del orden.
    document.querySelector<HTMLButtonElement>("[data-add-player]")!.click();
    const tercera = cartas()[2]!;
    expect(tercera.querySelector("[data-remove]")!.hasAttribute("hidden")).toBe(false);

    escribir(tercera, "telefono", "600999888");
    escribir(tercera, "email", "tercero@example.com");
    tercera.querySelector<HTMLButtonElement>("[data-make-capitan]")!.click();

    expect(tercera.querySelector("[data-remove]")!.hasAttribute("hidden")).toBe(true);
  });
});
