// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ejecutarScriptPublico } from "../helpers/dom";

/*
 * La lista de /camisetas/ es también el historial de quien entra: una reserva
 * ya entregada se queda ahí para siempre, y por eso pierde el botón de quitar y
 * gana el año de su edición. Sin el año, la camiseta de 2024 y la de este
 * verano son la misma línea.
 */

const MARCADO = `
  <section data-shirts>
    <form data-shirts-form>
      <input data-shirt-field="nombre" />
      <select data-shirt-field="talla"><option value="L">L</option></select>
      <input data-shirt-field="cantidad" value="1" />
      <textarea data-shirt-field="notas"></textarea>
      <button type="submit" data-shirts-submit>Reservar</button>
    </form>
    <p data-shirts-status></p>
    <div data-shirts-list hidden></div>
  </section>
`;

const reservas = [
  { id: 1, nombre: "Iago", talla: "L", cantidad: 1, notas: null, anio: 2024, entregada: true },
  { id: 2, nombre: "Iago", talla: "M", cantidad: 2, notas: "Sin prisa", anio: 2026, entregada: false }
];

const montar = async () => {
  document.body.innerHTML = MARCADO;
  (globalThis as unknown as Record<string, unknown>).CopaAuth = {
    state: { loading: false, user: { nombre: "Iago", email: "iago@example.com" } }
  };
  ejecutarScriptPublico("shirts.js");
  await new Promise((r) => setTimeout(r, 0));
};

const tarjetas = () => Array.from(document.querySelectorAll(".shirt-card"));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ reservas }) })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  delete (globalThis as unknown as Record<string, unknown>).CopaAuth;
});

describe("una camiseta ya entregada", () => {
  it("enseña el sello y no el botón de quitar", async () => {
    await montar();

    const entregada = tarjetas()[0]!;
    expect(entregada.querySelector(".shirt-entregada")?.textContent).toBe("Entregada");
    expect(entregada.querySelector("[data-shirt-delete]")).toBeNull();
  });

  it("la pendiente conserva su botón de quitar y no lleva sello", async () => {
    await montar();

    const pendiente = tarjetas()[1]!;
    expect(pendiente.querySelector("[data-shirt-delete]")).not.toBeNull();
    expect(pendiente.querySelector(".shirt-entregada")).toBeNull();
  });

  it("cada tarjeta dice de qué edición es", async () => {
    await montar();

    expect(tarjetas()[0]!.querySelector("p")!.textContent).toContain("Copa Arena 2024");
    expect(tarjetas()[1]!.querySelector("p")!.textContent).toContain("Copa Arena 2026");
  });

  /* Una reserva vieja puede no tener edición: entonces no se inventa ninguna. */
  it("sin año, la línea se queda con lo demás", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          reservas: [{ id: 3, nombre: "Iago", talla: "S", cantidad: 1, notas: null, anio: null, entregada: false }]
        })
      })
    );
    await montar();

    const linea = tarjetas()[0]!.querySelector("p")!.textContent!;
    expect(linea).toBe("Iago");
    expect(linea).not.toContain("Copa Arena");
  });
});
