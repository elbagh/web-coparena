// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ejecutarScriptPublico } from "../helpers/dom";

/*
 * El listado público de /equipos/. La rejilla es de dos columnas y, sin ayuda,
 * una tarjeta cerrada se estiraba hasta la altura de la que se hubiera abierto
 * a su lado: se veía un equipo "vacío". La marca `is-open` en el <li> es lo que
 * el CSS mira para estirar solo las abiertas (.teams-list en global.css), así
 * que se comprueba aquí que la pone y la quita.
 *
 * El marcado replica el de src/pages/equipos.astro.
 */

const MARCADO = `
  <section data-teams>
    <p data-status></p>
    <ol class="teams-list" data-list hidden></ol>
    <button type="button" data-retry hidden>Reintentar</button>
  </section>
`;

const equipo = (nombre: string, jugadores: number) => ({
  id: nombre.length,
  nombre,
  tieneFoto: false,
  jugadores: Array.from({ length: jugadores }, (_, i) => ({
    nombre: `Jugador${i}`,
    apellidos: "Apellido",
    instagram: null
  }))
});

/** Monta la página, responde /api/equipos con esos equipos y corre el script. */
async function montar(equipos: ReturnType<typeof equipo>[]) {
  document.body.innerHTML = MARCADO;

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ equipos }), { status: 200 }))
  );

  ejecutarScriptPublico("teams-list.js");
  await new Promise((resolve) => setTimeout(resolve, 0));

  const tarjetas = Array.from(document.querySelectorAll(".teams-list > li")) as HTMLElement[];
  return tarjetas.map((tarjeta) => ({
    tarjeta,
    toggle: tarjeta.querySelector(".team-toggle") as HTMLButtonElement,
    panel: tarjeta.querySelector(".team-panel") as HTMLElement
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listado público de equipos", () => {
  it("pinta una tarjeta cerrada por equipo", async () => {
    const fichas = await montar([equipo("Kylian dictador", 2), equipo("ONDA BRAVA", 4)]);

    expect(fichas).toHaveLength(2);
    expect(fichas.every((f) => f.panel.hidden)).toBe(true);
    expect(fichas.every((f) => f.toggle.getAttribute("aria-expanded") === "false")).toBe(true);
    expect(fichas.some((f) => f.tarjeta.classList.contains("is-open"))).toBe(false);
  });

  it("marca is-open solo en el equipo que se abre, no en su vecino de fila", async () => {
    const [primera, segunda] = await montar([
      equipo("Kylian dictador", 2),
      equipo("ONDA BRAVA", 4)
    ]);

    primera.toggle.click();

    expect(primera.tarjeta.classList.contains("is-open")).toBe(true);
    expect(primera.panel.hidden).toBe(false);
    expect(segunda.tarjeta.classList.contains("is-open")).toBe(false);
    expect(segunda.panel.hidden).toBe(true);
  });

  it("al volver a cerrar deja la tarjeta como estaba", async () => {
    const [primera] = await montar([equipo("Kylian dictador", 2)]);

    primera.toggle.click();
    primera.toggle.click();

    expect(primera.tarjeta.classList.contains("is-open")).toBe(false);
    expect(primera.panel.hidden).toBe(true);
    expect(primera.toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("lista los jugadores del equipo desplegado", async () => {
    const [primera] = await montar([equipo("Kylian dictador", 2)]);

    primera.toggle.click();

    expect(primera.panel.querySelectorAll(".player-row")).toHaveLength(2);
  });
});
