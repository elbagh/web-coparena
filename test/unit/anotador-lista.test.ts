// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cargarScriptPublico, ejecutarScriptPublico } from "../helpers/dom";

/*
 * `/anotador/` — la lista de partidos (public/assets/anotador/lista.js).
 *
 * El hallazgo que motiva este fichero: `partidosDeHoy` no distinguía a quien
 * pregunta de quien lleva el partido, así que la nota «Lo lleva…» se pintaba
 * también en la propia tarjeta del dueño — Ana entraba a `/anotador/` y su
 * propio partido en juego le decía «Lo lleva Ana Muros». El arreglo vive en
 * dos sitios (el servidor añade `puedeAnotar` a `anotador`, el cliente deja de
 * pintar la nota cuando es `true`) y este test cierra la mitad del cliente:
 * sin él, una reescritura de `tarjeta()` podría volver a mirar solo
 * `anotador.nombre` y el síntoma reaparecería en silencio.
 */

const MARCADO = `
  <p class="anot-alerta" role="alert" data-anot-error hidden></p>
  <div class="anot-lista" data-anot-lista>
    <p class="anot-vacio" data-anot-lista-vacio>Cargando los partidos…</p>
  </div>
`;

const partido = (extra: Record<string, unknown> = {}) => ({
  id: "p1",
  ronda: "Cuartos",
  pista: "Pista 1",
  status: "live",
  origenMarcador: "eventos",
  scheduledAt: null,
  teams: { A: { name: "Delfines" }, B: { name: "Gaviotas" } },
  points: { A: 3, B: 2 },
  sets: { A: 0, B: 0 },
  anotador: null,
  ...extra
});

/** Monta la pantalla con esa lista de partidos y corre los scripts como en la página. */
async function montar(partidos: Record<string, unknown>[]) {
  document.body.innerHTML = MARCADO;

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ partidos }), { status: 200 }))
  );

  (window as unknown as Record<string, unknown>).CopaAuth = {
    state: { loading: false, user: { id: 1 }, acceso: { permisos: ["partidos.anotar"] } }
  };

  cargarScriptPublico("anotador/core.js", "CopaAnotador");
  ejecutarScriptPublico("anotador/lista.js");

  await new Promise((r) => setTimeout(r, 0));
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("la nota de quién lleva el partido", () => {
  it("no dice nada en la tarjeta de quien pregunta, aunque sea el dueño", async () => {
    await montar([partido({ anotador: { id: 1, nombre: "Ana Muros", puedeAnotar: true } })]);

    expect(document.querySelector(".anot-partido-nota")).toBeNull();
  });

  it("dice quién lo lleva cuando es otra persona", async () => {
    await montar([partido({ anotador: { id: 7, nombre: "Berta Souto", puedeAnotar: false } })]);

    const nota = document.querySelector(".anot-partido-nota");
    expect(nota).not.toBeNull();
    expect(nota!.textContent).toBe("Lo lleva Berta Souto");
  });

  it("sin dueño conocido pero con log ya empezado, avisa sin nombre", async () => {
    await montar([partido({ anotador: null, origenMarcador: "eventos" })]);

    expect(document.querySelector(".anot-partido-nota")!.textContent).toBe("Ya se está anotando");
  });

  it("sin dueño y sin log, no hay nota", async () => {
    await montar([partido({ anotador: null, origenMarcador: "manual" })]);

    expect(document.querySelector(".anot-partido-nota")).toBeNull();
  });
});
