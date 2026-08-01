// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cargarScriptPublico } from "../helpers/dom";

/*
 * El sondeo del directo es lo único del sitio que puede agotar la cuota de
 * peticiones de Cloudflare, y justo el día que más gente mira. Estos tests son
 * el presupuesto de peticiones escrito como código: si alguno se cae, el
 * marcador se muere en mitad de la final.
 *
 * Con ~100 espectadores y una jornada de seis horas, el plan gratuito da para
 * una petición por espectador cada ~22 s de media. De ahí que el cliente nunca
 * elija su propio ritmo y que con la pestaña oculta no pida nada.
 */

interface Directo {
  suscribir(oyente: (estado: unknown, info: unknown) => void): () => void;
  refrescarAhora(): Promise<void>;
  mirandoDeCerca(valor: boolean): void;
  readonly estado: { hayDirecto: boolean } | null;
}

const MARCADO = `
  <details data-directo-apagado data-nav-drop>
    <summary><span class="directo-punto"></span><span data-directo-etiqueta>Offline</span></summary>
    <p class="directo-aviso">Cuando empiece un partido, este botón te lleva al marcador en directo.</p>
  </details>
  <a data-directo-vivo hidden><span data-directo-texto></span></a>
`;

let fetchMock: ReturnType<typeof vi.fn>;
let visibilidad = "visible";

/** Una respuesta de /api/directo con lo que haga falta. */
const respuesta = (cuerpo: Record<string, unknown>, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => 'W/"directo-1"' },
  json: async () => cuerpo
});

const sinDirecto = (siguienteSondeoMs = 60000) =>
  respuesta({ hayDirecto: false, partidos: [], siguiente: null, siguienteSondeoMs, modoAhorro: false });

/** Nada en juego, pero con un partido ya programado: el caso normal del torneo. */
const conSiguiente = () =>
  respuesta({
    hayDirecto: false,
    partidos: [],
    siguiente: { id: "p9", ronda: "Grupo A", hora: "11:30" },
    siguienteSondeoMs: 60000,
    modoAhorro: false
  });

const conDirecto = (puntos: [number, number], siguienteSondeoMs = 3000) =>
  respuesta({
    hayDirecto: true,
    siguienteSondeoMs,
    modoAhorro: false,
    siguiente: null,
    partidos: [
      {
        id: "p1",
        ronda: "Final",
        setNumber: 1,
        points: { A: puntos[0], B: puntos[1] },
        sets: { A: 0, B: 0 },
        history: [],
        teams: { A: { name: "Delfines", siglas: "DEL" }, B: { name: "Gaviotas", siglas: "GAV" } }
      }
    ]
  });

function montar(): Directo {
  document.body.innerHTML = MARCADO;
  return cargarScriptPublico<Directo>("directo.js", "CopaDirecto");
}

/** Deja que se resuelvan las promesas pendientes del fetch simulado. */
const asentar = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  visibilidad = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibilidad });
  fetchMock = vi.fn().mockResolvedValue(sinDirecto());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("arranque", () => {
  it("pide el estado en cuanto hay un botón que pintar", async () => {
    montar();
    await asentar();
    expect(fetchMock).toHaveBeenCalledWith("/api/directo", expect.anything());
  });

  /*
   * Este fichero se carga en todas las páginas porque el botón vive en la
   * cabecera. En el panel de administración no hay cabecera pública: allí no
   * debe pedir nada.
   */
  it("no pide nada si no hay botón ni nadie suscrito", async () => {
    document.body.innerHTML = "";
    cargarScriptPublico<Directo>("directo.js", "CopaDirecto");
    await asentar();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("la cadencia la manda el servidor", () => {
  it("espera lo que diga siguienteSondeoMs, no un valor propio", async () => {
    fetchMock.mockResolvedValue(conDirecto([5, 3], 3000));
    const directo = montar();
    directo.mirandoDeCerca(true);
    await asentar();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2900);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("si el servidor sube la cadencia, el cliente la sube: es la válvula del día del torneo", async () => {
    fetchMock.mockResolvedValue(conDirecto([5, 3], 20000));
    const directo = montar();
    directo.mirandoDeCerca(true);
    await asentar();

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sin partido en juego va despacio aunque el servidor pida ir deprisa", async () => {
    fetchMock.mockResolvedValue(sinDirecto(3000));
    const directo = montar();
    directo.mirandoDeCerca(true);
    await asentar();

    await vi.advanceTimersByTimeAsync(30000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(31000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  /*
   * Quien lee la clasificación al final de la página no necesita el marcador al
   * segundo, y cada sondeo suyo es uno menos para quien sí está mirando.
   */
  it("con el panel fuera de pantalla espacia los sondeos", async () => {
    fetchMock.mockResolvedValue(conDirecto([5, 3], 3000));
    const directo = montar();
    directo.mirandoDeCerca(false);
    await asentar();

    await vi.advanceTimersByTimeAsync(3500);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(12000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

/*
 * Lo que más peticiones ahorra: la mitad de las pestañas de un móvil están en
 * segundo plano.
 */
describe("con la pestaña oculta no se pide nada", () => {
  it("deja de sondear al ocultarse y vuelve al reaparecer", async () => {
    fetchMock.mockResolvedValue(conDirecto([5, 3], 3000));
    const directo = montar();
    directo.mirandoDeCerca(true);
    await asentar();
    const alArrancar = fetchMock.mock.calls.length;

    visibilidad = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));

    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).toHaveBeenCalledTimes(alArrancar);

    visibilidad = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await asentar();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(alArrancar);
  });
});

describe("cuando algo va mal", () => {
  it("espacia los reintentos en vez de rematar al servidor", async () => {
    fetchMock.mockResolvedValue(conDirecto([5, 3], 3000));
    const directo = montar();
    directo.mirandoDeCerca(true);
    await asentar();

    fetchMock.mockRejectedValue(new Error("sin red"));
    await vi.advanceTimersByTimeAsync(3000);
    await asentar();
    const trasElFallo = fetchMock.mock.calls.length;

    // El primer escalón del backoff son 5 s, más que los 3 s normales.
    await vi.advanceTimersByTimeAsync(3200);
    expect(fetchMock).toHaveBeenCalledTimes(trasElFallo);

    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(trasElFallo);
  });

  it("un 304 no es un fallo: significa que nada ha cambiado", async () => {
    fetchMock.mockResolvedValue(conDirecto([5, 3], 3000));
    const directo = montar();
    directo.mirandoDeCerca(true);
    await asentar();

    fetchMock.mockResolvedValue({ ok: false, status: 304, headers: { get: () => null }, json: async () => ({}) });
    await vi.advanceTimersByTimeAsync(3000);
    await asentar();
    const tras304 = fetchMock.mock.calls.length;

    // Sigue a la cadencia normal, sin backoff.
    await vi.advanceTimersByTimeAsync(3000);
    await asentar();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(tras304);
  });

  it("manda el If-None-Match para que el servidor pueda responder 304", async () => {
    fetchMock.mockResolvedValue(conDirecto([5, 3], 3000));
    const directo = montar();
    directo.mirandoDeCerca(true);
    await asentar();

    await vi.advanceTimersByTimeAsync(3000);
    await asentar();

    const ultima = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]!;
    expect(ultima[1].headers["If-None-Match"]).toBe('W/"directo-1"');
  });
});

/*
 * El botón encendido enseña quién juega (siglas), no el marcador ni la
 * palabra «directo»: sin saber de quién, un «12–9» no informa de nada, y el
 * marcador está a un toque en /directo/. Y apagado es un elemento distinto,
 * no un enlace deshabilitado —que en HTML no existe y seguiría siendo
 * enfocable con teclado—.
 */
describe("el botón de la cabecera", () => {
  const apagado = () => document.querySelector("[data-directo-apagado]") as HTMLDetailsElement;
  const vivo = () => document.querySelector("[data-directo-vivo]") as HTMLElement;
  const etiqueta = () => document.querySelector("[data-directo-etiqueta]")!.textContent;

  it("sin partido enseña el apagado y esconde el enlace", async () => {
    montar();
    await asentar();
    expect(apagado().hidden).toBe(false);
    expect(vivo().hidden).toBe(true);
  });

  it("con un partido ya programado dice «Offline»", async () => {
    fetchMock.mockResolvedValue(conSiguiente());
    montar();
    await asentar();
    expect(etiqueta()).toBe("Offline");
  });

  // Sin nada programado no hay «Offline» que valga: no es que aún no haya
  // empezado, es que no hay partido al que este botón pueda llevar.
  it("sin nada programado dice «Sin partido»", async () => {
    fetchMock.mockResolvedValue(sinDirecto());
    montar();
    await asentar();
    expect(etiqueta()).toBe("Sin partido");
  });

  /*
   * El aviso explica un hueco. Si se queda abierto cuando el hueco se llena,
   * queda un recado flotando bajo un botón que ya no está —y reaparecería abierto
   * al terminar el partido—.
   */
  it("al empezar el partido cierra el aviso del apagado", async () => {
    fetchMock.mockResolvedValue(conSiguiente());
    const directo = montar();
    directo.mirandoDeCerca(true);
    await asentar();

    apagado().open = true;

    fetchMock.mockResolvedValue(conDirecto([1, 0]));
    await vi.advanceTimersByTimeAsync(61000);
    await asentar();

    expect(apagado().open).toBe(false);
  });

  it("con partido enseña las siglas en el enlace, no el marcador", async () => {
    fetchMock.mockResolvedValue(conDirecto([18, 14]));
    montar();
    await asentar();

    expect(apagado().hidden).toBe(true);
    expect(vivo().hidden).toBe(false);
    const texto = document.querySelector("[data-directo-texto]")!.textContent!;
    expect(texto).toContain("DEL");
    expect(texto).toContain("GAV");
    expect(texto).not.toContain("18");
    expect(texto).not.toContain("14");

    const etiqueta = vivo().getAttribute("aria-label")!;
    expect(etiqueta).toContain("Delfines");
    expect(etiqueta).toContain("Gaviotas");
    expect(etiqueta).not.toMatch(/\b18\b/);
  });

  // Siglas hay siempre, incluso a 0–0: ya no hay un «En directo» de repuesto
  // para el saque inicial.
  it("a cero también enseña las siglas, no «En directo»", async () => {
    fetchMock.mockResolvedValue(conDirecto([0, 0]));
    montar();
    await asentar();
    const texto = document.querySelector("[data-directo-texto]")!.textContent;
    expect(texto).toBe("DEL–GAV");
    expect(texto).not.toBe("En directo");
  });
});

/*
 * Un partido que termina es lo único que puede cambiar una clasificación, y por
 * eso es lo único que justifica volver a pedir el endpoint pesado.
 */
describe("aviso de partido cerrado", () => {
  it("marca cerroAlguno cuando un partido desaparece del directo", async () => {
    fetchMock.mockResolvedValue(conDirecto([20, 18], 3000));
    const directo = montar();
    directo.mirandoDeCerca(true);
    const avisos: { cerroAlguno: boolean }[] = [];
    directo.suscribir((_estado, info) => avisos.push(info as { cerroAlguno: boolean }));
    await asentar();

    fetchMock.mockResolvedValue(sinDirecto());
    await vi.advanceTimersByTimeAsync(3000);
    await asentar();

    expect(avisos.some((a) => a.cerroAlguno)).toBe(true);
  });

  it("no lo marca mientras el partido sigue en juego", async () => {
    fetchMock.mockResolvedValue(conDirecto([5, 3], 3000));
    const directo = montar();
    directo.mirandoDeCerca(true);
    const avisos: { cerroAlguno: boolean }[] = [];
    directo.suscribir((_estado, info) => avisos.push(info as { cerroAlguno: boolean }));
    await asentar();

    fetchMock.mockResolvedValue(conDirecto([6, 3], 3000));
    await vi.advanceTimersByTimeAsync(3000);
    await asentar();

    expect(avisos.every((a) => !a.cerroAlguno)).toBe(true);
  });
});
