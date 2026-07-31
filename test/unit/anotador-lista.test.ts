// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cargarScriptPublico, ejecutarScriptPublico } from "../helpers/dom";

/*
 * /anotador/ — la lista de partidos que se pueden llevar.
 *
 * Lo que se comprueba aquí es qué distingue una tarjeta de la siguiente. La meta
 * enseñaba `pista || hora`, y como el torneo entero se juega en una sola pista,
 * los treinta partidos ponían «Pista central»: una columna idéntica en todas las
 * tarjetas, ocupando el sitio del único dato que sí cambia de un partido al
 * siguiente. Quien llega con el móvil buscando «el de las 18:10» no tenía por
 * dónde mirar.
 *
 * El marcado es copia a mano del de src/pages/anotador/index.astro, como en el
 * resto de los tests de scripts públicos.
 */

const MARCADO = `
  <div class="anot-lista" data-anot-lista>
    <p data-anot-lista-vacio>Cargando los partidos…</p>
  </div>
  <p data-anot-error hidden></p>
`;

const partido = (extra: Record<string, unknown> = {}) => ({
  id: "p1",
  ronda: "A · jornada 1",
  pista: "Pista central",
  status: "scheduled",
  origenMarcador: "manual",
  scheduledAt: "2026-08-01T16:30",
  teams: { A: { name: "Calvos de Orion" }, B: { name: "Bye Bye Bye" } },
  points: { A: 0, B: 0 },
  sets: { A: 0, B: 0 },
  ...extra
});

const respirar = () => new Promise((r) => setTimeout(r, 0));

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
  await respirar();
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const metaDe = (i = 0) =>
  [...document.querySelectorAll(".anot-partido-meta")[i]!.querySelectorAll("span")].map((s) => s.textContent);

describe("la tarjeta de un partido", () => {
  it("enseña la hora, no la pista", async () => {
    await montar([partido()]);

    const meta = metaDe();
    expect(meta[0]).toBe("A · jornada 1");
    expect(meta[1]).toMatch(/16:30/);
    expect(meta.join(" ")).not.toContain("Pista central");
  });

  it("sin hora lo dice, en vez de caer a la pista", async () => {
    await montar([partido({ scheduledAt: null })]);

    expect(metaDe()[1]).toBe("Sin hora");
  });

  it("dos partidos del mismo día se distinguen por su hora", async () => {
    await montar([
      partido({ id: "p1", scheduledAt: "2026-08-01T16:30" }),
      partido({ id: "p2", ronda: "A · jornada 2", scheduledAt: "2026-08-01T17:20" })
    ]);

    expect(metaDe(0)[1]).toMatch(/16:30/);
    expect(metaDe(1)[1]).toMatch(/17:20/);
  });

  it("el que se está jugando lo dice, y enlaza a su marcador", async () => {
    await montar([partido({ status: "live", origenMarcador: "eventos" })]);

    const enlace = document.querySelector("a.anot-partido") as HTMLAnchorElement;
    expect(enlace.getAttribute("href")).toBe("/anotador/partido/?id=p1");
    expect(metaDe()).toContain("En juego");
    expect(document.querySelector(".anot-partido-nota")!.textContent).toBe("Ya se está anotando");
  });
});
