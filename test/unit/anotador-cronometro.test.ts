// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * El cerrojo del reloj es de CLIENTE, a diferencia del de `live`.
 *
 * Los dos protegen cosas de distinto tamaño: publicar un partido sin querer se ve
 * desde fuera y no tiene vuelta atrás desde el anotador, así que su guardia va en
 * el servidor, donde no se puede esquivar entrando por URL. Anotar con el reloj
 * sin estrenar solo deja mal la duración de un partido, y un 409 más sería otra
 * forma de que la franja del pulgar se quede muerta a pie de pista.
 */

const MARCADO = `
  <div class="anot-panel" data-anot-panel hidden>
    <p data-anot-rotulo hidden></p>
    <span data-anot-puntos-a>0</span><span data-anot-puntos-b>0</span>
    <p data-anot-detalle></p><p data-anot-parciales hidden></p>
    <span data-anot-reloj hidden></span>
    <button data-anot-reloj-pausa hidden></button>
    <button data-anot-reloj-iniciar hidden>Iniciar cronómetro</button>
    <section data-anot-decision hidden>
      <h2 data-anot-decision-titulo></h2>
      <button data-anot-adoptar></button><button data-anot-cero></button>
      <p data-anot-error-decision hidden></p>
    </section>
    <section data-anot-fuera hidden>
      <button data-anot-poner-directo></button>
      <p data-anot-error-fuera hidden></p>
    </section>
    <section data-anot-pista>
      <p data-anot-banda-a></p><div data-anot-mitad-a></div><div data-anot-banquillo-a></div>
      <p data-anot-banda-b></p><div data-anot-mitad-b></div><div data-anot-banquillo-b></div>
    </section>
    <section data-anot-pulgar>
      <div data-anot-reposo><p data-anot-ultimo></p><button data-anot-deshacer></button></div>
      <div data-anot-acciones hidden><strong data-anot-elegido></strong><div data-anot-tipos></div>
        <button data-anot-cancelar></button></div>
      <div data-anot-cambio hidden><strong data-anot-entra></strong><div data-anot-cambio-opciones></div>
        <button data-anot-cambio-cancelar></button></div>
      <p data-anot-error hidden></p>
    </section>
    <details><button data-anot-alineacion></button><button data-anot-soltar hidden></button>
      <div data-anot-historial></div></details>
  </div>
  <p data-anot-estado></p>
  <dialog data-anot-dialogo-alineacion><div data-anot-plantillas></div>
    <button data-anot-alineacion-cancelar></button><button data-anot-alineacion-guardar></button></dialog>
  <dialog data-anot-dialogo-corregir><h2 data-anot-corregir-titulo></h2>
    <div data-anot-corregir-tipos></div><div data-anot-corregir-jugadores></div>
    <button data-anot-corregir-cancelar></button><button data-anot-corregir-guardar></button></dialog>
  <dialog data-anot-dialogo-directo><p data-anot-directo-cruce></p>
    <input type="checkbox" data-anot-directo-acepto />
    <button data-anot-directo-cancelar></button><button data-anot-directo-confirmar disabled></button></dialog>
  <dialog data-anot-dialogo-reloj>
    <button data-anot-reloj-cancelar></button><button data-anot-reloj-confirmar></button>
  </dialog>
`;

/** El estado que devuelve /api/anotacion, con el reloj donde lo pida el test. */
const estado = (reloj: { startedAt: string | null; elapsedMs: number }) => ({
  partido: {
    id: "p1",
    status: "live",
    origenMarcador: "eventos",
    // La forma que devuelve la API es la INTERIOR: `normalizarReglas(...).partido`.
    // Claves reales: sets, puntosPorSet, puntosSetDecisivo, diferencia.
    reglas: { sets: 3, puntosPorSet: 21, puntosSetDecisivo: 15, diferencia: 2 },
    ...reloj
  },
  estado: {
    puntos: { A: 0, B: 0 },
    sets: { A: 0, B: 0 },
    setNumero: 1,
    historial: [],
    terminado: false,
    winner: null
  },
  eventos: [],
  siguienteOrden: 0,
  marcadorPanel: { puntos: { A: 0, B: 0 }, sets: { A: 0, B: 0 } },
  pendienteDeAdoptar: false,
  alineacion: [{ jugador_id: 1, lado: "A", orden: 0, nombre: "Ana", apellidos: "Ruiz", dorsal: 4 }],
  cambios: [],
  equipos: {
    A: { nombre: "Ostreiros do Pozo", jugadores: [{ id: 1, nombre: "Ana", apellidos: "Ruiz", dorsal: 4, nivel: "oro", media: 80, tieneFoto: false, esSuplente: false }] },
    B: { nombre: "Os Pulpos", jugadores: [] }
  },
  tipos: [{ clave: "remate", etiqueta: "Remate", ayuda: "Punto directo", puntua: true, alRival: false }]
});

let fetchMock: ReturnType<typeof vi.fn>;

async function montar(reloj: { startedAt: string | null; elapsedMs: number }) {
  document.body.innerHTML = MARCADO;
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => estado(reloj) });

  // Los scripts de los que depende la página, en el mismo orden que el .astro.
  const { ejecutarScriptPublico } = await import("../helpers/dom");
  ejecutarScriptPublico("match-utils.js");
  ejecutarScriptPublico("cromo.js");
  ejecutarScriptPublico("anotador/core.js");
  ejecutarScriptPublico("anotador/partido.js");

  window.dispatchEvent(new Event("copa:auth"));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { search: "?id=p1" } as Location);
  (window as unknown as { CopaAuth: unknown }).CopaAuth = {
    state: { loading: false, user: { id: 1 }, acceso: { permisos: ["partidos.anotar"] } }
  };
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
  // jsdom no implementa matchMedia; la vibración del retrato de cromo.js lo consulta.
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    addEventListener() {},
    removeEventListener() {}
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("el reloj sin estrenar bloquea el primer punto", () => {
  it("tocar una acción abre el diálogo y no llama a la API", async () => {
    await montar({ startedAt: null, elapsedMs: 0 });
    fetchMock.mockClear();

    document.querySelector<HTMLButtonElement>("[data-anot-mitad-a] button")!.click();
    document.querySelector<HTMLButtonElement>("[data-anot-tipos] button")!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
  });

  it("confirmar arranca el reloj y anota el punto, en ese orden", async () => {
    await montar({ startedAt: null, elapsedMs: 0 });
    document.querySelector<HTMLButtonElement>("[data-anot-mitad-a] button")!.click();
    document.querySelector<HTMLButtonElement>("[data-anot-tipos] button")!.click();
    fetchMock.mockClear();

    document.querySelector<HTMLButtonElement>("[data-anot-reloj-confirmar]")!.click();
    await new Promise((r) => setTimeout(r, 0));

    const cuerpos = fetchMock.mock.calls.map((llamada) => JSON.parse(llamada[1].body));
    expect(cuerpos[0]).toMatchObject({ accion: "cronometro", marcha: true });
    expect(cuerpos[1]).toMatchObject({ accion: "evento", tipo: "remate" });
  });

  it("cancelar no manda nada: el punto se pierde a propósito", async () => {
    await montar({ startedAt: null, elapsedMs: 0 });
    document.querySelector<HTMLButtonElement>("[data-anot-mitad-a] button")!.click();
    document.querySelector<HTMLButtonElement>("[data-anot-tipos] button")!.click();
    fetchMock.mockClear();

    document.querySelector<HTMLButtonElement>("[data-anot-reloj-cancelar]")!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  /*
   * Si arrancar el reloj falla, anotar encima dejaría un punto guardado con el
   * reloj todavía sin estrenar. El único aviso de que hay que repetirlo es el
   * de siempre (`[data-anot-error]`): esta pantalla no vuelve a abrir el
   * diálogo sola, así que el fallo tiene que verse la primera vez.
   */
  it("si arrancar el reloj falla, el punto no se manda y el fallo se ve", async () => {
    await montar({ startedAt: null, elapsedMs: 0 });
    document.querySelector<HTMLButtonElement>("[data-anot-mitad-a] button")!.click();
    document.querySelector<HTMLButtonElement>("[data-anot-tipos] button")!.click();
    fetchMock.mockClear();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    document.querySelector<HTMLButtonElement>("[data-anot-reloj-confirmar]")!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const aviso = document.querySelector<HTMLElement>("[data-anot-error]")!;
    expect(aviso.hidden).toBe(false);
  });
});

describe("la pausa no bloquea", () => {
  /*
   * Solo el estreno bloquea. La pausa es para el descanso entre sets, y un toque
   * que no hace nada porque el reloj está parado es justo la trampa que esta
   * pantalla no puede permitirse.
   */
  it("con el reloj pausado, el punto se anota directamente", async () => {
    await montar({ startedAt: null, elapsedMs: 120000 });
    fetchMock.mockClear();

    document.querySelector<HTMLButtonElement>("[data-anot-mitad-a] button")!.click();
    document.querySelector<HTMLButtonElement>("[data-anot-tipos] button")!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ accion: "evento" });
  });

  it("con el reloj corriendo tampoco pregunta", async () => {
    await montar({ startedAt: new Date().toISOString(), elapsedMs: 0 });
    fetchMock.mockClear();

    document.querySelector<HTMLButtonElement>("[data-anot-mitad-a] button")!.click();
    document.querySelector<HTMLButtonElement>("[data-anot-tipos] button")!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ accion: "evento" });
  });
});
