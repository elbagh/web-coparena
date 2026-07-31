// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TIPOS } from "../../functions/_lib/marcador";
import { cargarScriptPublico, ejecutarScriptPublico } from "../helpers/dom";

/*
 * La pantalla del anotador (`public/assets/anotador/partido.js`).
 *
 * Aquí se cierran cuatro cosas que en producción fallaban en silencio:
 *
 *   1. `match-utils.js` no se cargaba en esta página. El script no se rompía: se
 *      quedaba sin predicción optimista y el objetivo del set decisivo salía mal
 *      («a 21» en un set que se juega a 15). Un fallo que no se ve es peor que
 *      uno que se ve, así que además de cargarlo hay un test que lo comprueba
 *      leyendo el .astro.
 *   2. Un partido con marcador llevado a mano se enseñaba como 0–0 y el primer
 *      punto lo borraba. Ahora la decisión ocupa el sitio de la pista.
 *   3. El partido terminado se despedía con «0 – 0», porque los puntos vuelven a
 *      cero al cerrarse el último set.
 *   4. Corregir un punto no tenía forma de pedirse desde aquí.
 *
 * El marcado es una copia a mano del de src/pages/anotador/partido.astro, como
 * en el resto de los tests de scripts públicos: si allí cambian los `data-*`,
 * este test sigue en verde y es producción la que se queda muda. Hay que
 * mantenerlo sincronizado.
 */

const MARCADO = `
  <p class="anot-alerta anot-alerta--offline" data-anot-offline hidden>
    Sin conexión: los puntos no se están guardando.
  </p>
  <div class="anot-panel" data-anot-panel hidden>
    <section class="anot-marcador">
      <p data-anot-punto-set hidden></p>
      <p data-anot-rotulo hidden>Sets</p>
      <p class="anot-tanteo">
        <span data-anot-puntos-a>0</span>
        <span data-anot-puntos-b>0</span>
      </p>
      <p><span data-anot-detalle></span><span data-anot-reloj hidden></span></p>
      <p data-anot-parciales hidden></p>
    </section>

    <section class="anot-decision" data-anot-decision hidden>
      <h2 data-anot-decision-titulo></h2>
      <div class="anot-decision-botones">
        <button type="button" data-anot-adoptar></button>
        <button type="button" data-anot-cero>Empezar en 0–0</button>
      </div>
    </section>

    <section class="anot-pista" data-anot-pista>
      <div class="anot-mitad anot-mitad--a" data-anot-lado="A">
        <p data-anot-banda-a></p>
        <div data-anot-mitad-a></div>
        <div data-anot-banquillo-a></div>
      </div>
      <div class="anot-red"></div>
      <div class="anot-mitad anot-mitad--b" data-anot-lado="B">
        <p data-anot-banda-b></p>
        <div data-anot-mitad-b></div>
        <div data-anot-banquillo-b></div>
      </div>
    </section>

    <section class="anot-pulgar" data-anot-pulgar>
      <div data-anot-reposo>
        <p data-anot-ultimo>Sin puntos todavía.</p>
        <button type="button" data-anot-deshacer disabled>Deshacer</button>
      </div>
      <div data-anot-acciones hidden>
        <p><strong data-anot-elegido></strong></p>
        <div data-anot-tipos></div>
        <div data-anot-tipos-extra></div>
        <button type="button" data-anot-cancelar>Cancelar</button>
      </div>
      <div data-anot-cambio hidden>
        <p>¿Por quién entra <strong data-anot-entra></strong>?</p>
        <div data-anot-cambio-opciones></div>
        <button type="button" data-anot-cambio-cancelar>Cancelar</button>
      </div>
      <div data-anot-punto hidden>
        <p><strong data-anot-punto-accion></strong></p>
        <div data-anot-punto-opciones></div>
        <button type="button" data-anot-punto-cancelar>Cancelar</button>
      </div>

      <div data-anot-cierre hidden>
        <p data-anot-cierre-titulo></p>
        <p data-anot-cierre-marcador></p>
        <button type="button" data-anot-cierre-confirmar>
          <span data-anot-cierre-confirmar-texto></span>
          <span data-anot-cierre-confirmar-ayuda></span>
        </button>
        <button type="button" data-anot-cierre-cancelar>Cancelar</button>
      </div>

      <p class="anot-alerta anot-alerta--pulgar" role="alert" data-anot-error hidden></p>
    </section>

    <details class="anot-mas">
      <summary>Más</summary>
      <button type="button" data-anot-alineacion>Cambiar quién está en pista</button>
      <button type="button" data-anot-soltar hidden>Soltar la anotación</button>
      <div data-anot-historial></div>
    </details>
  </div>

  <p data-anot-estado>Cargando el partido…</p>

  <dialog data-anot-dialogo-alineacion>
    <div data-anot-plantillas></div>
    <button type="button" data-anot-alineacion-cancelar>Cancelar</button>
    <button type="button" data-anot-alineacion-guardar>Guardar</button>
  </dialog>

  <dialog data-anot-dialogo-corregir>
    <h2 data-anot-corregir-titulo></h2>
    <div data-anot-corregir-tipos></div>
    <div data-anot-corregir-punto hidden>
      <button type="button" data-punto="true">Fue punto</button>
      <button type="button" data-punto="false">No fue punto</button>
    </div>
    <div data-anot-corregir-jugadores></div>
    <button type="button" data-anot-corregir-cancelar>Cancelar</button>
    <button type="button" data-anot-corregir-guardar>Guardar la corrección</button>
  </dialog>
`;

const REGLAS = { sets: 2, puntosPorSet: 21, puntosSetDecisivo: 15, diferencia: 2 };

const ALINEACION = [
  { jugador_id: 1, lado: "A", nombre: "Marta", apellidos: "Souto Lago", dorsal: 7 },
  { jugador_id: 2, lado: "A", nombre: "Marta", apellidos: "Ferro Deus", dorsal: null },
  { jugador_id: 3, lado: "B", nombre: "Iago", apellidos: "García Hermida", dorsal: 9 }
];

const enPlantilla = (id: number, nombre: string, apellidos: string, extra: Record<string, unknown> = {}) => ({
  id,
  nombre,
  apellidos,
  dorsal: id,
  nivel: "oro",
  media: 70,
  tieneFoto: false,
  esSuplente: false,
  ...extra
});

const EQUIPOS = {
  A: {
    nombre: "Areeiros",
    jugadores: [
      enPlantilla(1, "Marta", "Souto Lago"),
      enPlantilla(2, "Marta", "Ferro Deus"),
      enPlantilla(4, "Nuria", "Canle Rios", { esSuplente: true })
    ]
  },
  B: { nombre: "Os Pulpos Bravos", jugadores: [enPlantilla(3, "Iago", "García Hermida")] }
};

/** La respuesta de `/api/anotacion`, con lo mínimo para pintar. */
const respuesta = (extra: Record<string, unknown> = {}) => ({
  partido: { id: "p1", status: "live", origenMarcador: "manual", reglas: REGLAS, startedAt: null },
  estado: { setNumero: 1, puntos: { A: 0, B: 0 }, sets: { A: 0, B: 0 }, historial: [], terminado: false, winner: null },
  eventos: [],
  siguienteOrden: 0,
  marcadorPanel: { puntos: { A: 0, B: 0 }, sets: { A: 0, B: 0 } },
  pendienteDeAdoptar: false,
  cambios: [],
  alineacion: ALINEACION,
  equipos: EQUIPOS,
  tipos: TIPOS,
  ...extra
});

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const botones = (sel: string) => [...document.querySelectorAll(sel)] as HTMLButtonElement[];
const respirar = () => new Promise((r) => setTimeout(r, 0));

let peticiones: { url: string; cuerpo: Record<string, unknown> | null }[] = [];

/**
 * Lo que contesta el fetch simulado. Por defecto devuelve los datos con los que
 * se montó; los tests que tiran la red lo reemplazan a mitad.
 */
let responder: (cuerpo: Record<string, unknown> | null) => Promise<Response>;

/** Monta la pantalla con esa respuesta y corre los scripts como en la página. */
async function montar(datos: Record<string, unknown>) {
  document.body.innerHTML = MARCADO;
  peticiones = [];
  window.history.replaceState({}, "", "/anotador/partido/?id=p1");
  responder = async () => new Response(JSON.stringify(datos), { status: 200 });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, opciones?: { body?: string }) => {
      const cuerpo = opciones?.body ? JSON.parse(opciones.body) : null;
      peticiones.push({ url, cuerpo });
      return await responder(cuerpo);
    })
  );

  // Sesión ya resuelta: `alEntrar` arranca solo cuando hay usuario.
  (window as unknown as Record<string, unknown>).CopaAuth = {
    state: { loading: false, user: { id: 1 }, acceso: { permisos: ["partidos.anotar", "partidos.editar"] } }
  };

  // jsdom no implementa matchMedia; la vibración del retrato la consulta.
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    addEventListener() {},
    removeEventListener() {}
  }));

  // El orden es el de la página: match-utils → cromo → core → partido.
  cargarScriptPublico("match-utils.js", "CopaArenaMatches");
  cargarScriptPublico("cromo.js", "CopaCromo");
  cargarScriptPublico("anotador/core.js", "CopaAnotador");
  ejecutarScriptPublico("anotador/partido.js");

  for (const dialogo of document.querySelectorAll("dialog")) {
    // jsdom no implementa showModal/close.
    dialogo.showModal = vi.fn();
    dialogo.close = vi.fn();
  }

  await respirar();
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("los scripts de la página", () => {
  /*
   * El fallo que motivó todo esto: `partido.js` usa `window.CopaArenaMatches` y
   * la página no lo cargaba. Se comprueba leyendo el .astro porque es el único
   * sitio donde se declara el orden, y porque el síntoma en producción no era un
   * error sino un número mal puesto.
   */
  it("carga match-utils.js antes que partido.js", () => {
    const pagina = readFileSync(
      path.resolve(import.meta.dirname, "../../src/pages/anotador/partido.astro"),
      "utf8"
    );
    const utils = pagina.indexOf("/assets/match-utils.js");
    const propio = pagina.indexOf("/assets/anotador/partido.js");

    expect(utils).toBeGreaterThan(-1);
    expect(utils).toBeLessThan(propio);
  });
});

describe("el marcador", () => {
  it("dice a cuántos puntos va el set decisivo, no el normal", async () => {
    await montar(
      respuesta({
        estado: {
          setNumero: 3,
          puntos: { A: 8, B: 6 },
          sets: { A: 1, B: 1 },
          historial: [
            { a: 21, b: 18 },
            { a: 19, b: 21 }
          ],
          terminado: false,
          winner: null
        }
      })
    );

    // 21/21/15: el tercero es el corto. Antes ponía «a 21».
    expect($("[data-anot-detalle]").textContent).toContain("a 15");
    expect($("[data-anot-parciales]").hidden).toBe(false);
    expect($("[data-anot-parciales]").textContent).toBe("21–18 · 19–21");
  });

  it("terminado enseña los SETS y apaga la pista", async () => {
    await montar(
      respuesta({
        partido: { id: "p1", status: "finished", origenMarcador: "eventos", reglas: REGLAS, startedAt: null },
        estado: {
          setNumero: 4,
          puntos: { A: 0, B: 0 },
          sets: { A: 2, B: 1 },
          historial: [
            { a: 21, b: 18 },
            { a: 19, b: 21 },
            { a: 15, b: 9 }
          ],
          terminado: true,
          winner: "A"
        }
      })
    );

    expect($("[data-anot-rotulo]").textContent).toBe("Sets");
    expect($("[data-anot-puntos-a]").textContent).toBe("2");
    expect($("[data-anot-puntos-b]").textContent).toBe("1");
    expect($("[data-anot-detalle]").textContent).toBe("Terminado · ganó Areeiros");
    expect($("[data-anot-parciales]").textContent).toBe("21–18 · 19–21 · 15–9");
    expect(botones(".anot-jugador").every((b) => b.disabled)).toBe(true);
  });

  it("el apellido y el dorsal desempatan dos nombres de pila iguales", async () => {
    await montar(respuesta());

    const enPista = botones("[data-anot-mitad-a] .anot-jugador");
    expect(enPista).toHaveLength(2);
    expect(enPista[0]!.querySelector(".retrato-nombre")!.textContent).toBe("Marta");
    expect(enPista[0]!.querySelector(".retrato-apellidos")!.textContent).toBe("Souto Lago");
    expect(enPista[1]!.querySelector(".retrato-apellidos")!.textContent).toBe("Ferro Deus");
    // Sin foto, el hueco del retrato lo ocupa el dorsal.
    expect(enPista[0]!.querySelector(".retrato-hueco")!.textContent).toBe("1");
  });

  it("la pista es un versus: cada equipo con su banda y su lado", async () => {
    await montar(respuesta());

    expect($("[data-anot-banda-a]").textContent).toBe("Areeiros");
    expect($("[data-anot-banda-b]").textContent).toBe("Os Pulpos Bravos");
    expect(botones("[data-anot-mitad-b] .anot-jugador")).toHaveLength(1);
  });
});

/*
 * El cambio de jugador. El gesto es el mismo que el de un punto —dos toques, y
 * el segundo en la zona del pulgar— porque a pleno sol no se aprende una
 * gramática nueva.
 */
/*
 * El aviso de punto de set y la confirmación de cierre.
 *
 * Las dos existen por lo mismo: quien anota está de pie al sol, con tres
 * segundos entre punto y punto, y puede haber atribuido mal el punto anterior o
 * haber pulsado dos veces. Cerrar un set es lo más caro de deshacer que hay
 * aquí, porque los puntos vuelven a 0–0 y el cuadro puede haber avanzado ya.
 *
 * Lo que NO cambia es el servidor: la pregunta va delante de la petición, así
 * que cancelar no deja rastro en ninguna parte — ese punto no llegó a existir. El
 * pliegue sigue cerrando el set con el punto que lo cierra.
 */
describe("el aviso de punto de set", () => {
  const enPuntos = (puntos: { A: number; B: number }, extra: Record<string, unknown> = {}) =>
    respuesta({
      estado: {
        setNumero: 1,
        puntos,
        sets: { A: 0, B: 0 },
        historial: [],
        terminado: false,
        winner: null,
        ...extra
      }
    });

  it("avisa a un punto del cierre, con el color del equipo que puede cerrarlo", async () => {
    // 21/21/15 con dos de ventaja: a A le basta uno (21–18), a B no (20–19).
    await montar(enPuntos({ A: 20, B: 18 }));

    const pestana = $("[data-anot-punto-set]");
    expect(pestana.hidden).toBe(false);
    expect(pestana.dataset.lado).toBe("A");
    expect(pestana.textContent).toBe("Punto de set · Areeiros");
  });

  it("no avisa mientras falte más de un punto", async () => {
    await montar(enPuntos({ A: 19, B: 18 }));

    expect($("[data-anot-punto-set]").hidden).toBe(true);
  });

  /*
   * La ventaja mínima también decide, y por eso el aviso se calcula simulando el
   * punto en vez de comparar el tanteo con el objetivo: a 20–20 nadie cierra con
   * uno, aunque los dos hayan llegado a 20.
   */
  it("a 20–20 no hay punto de set, porque hacen falta dos de ventaja", async () => {
    await montar(enPuntos({ A: 20, B: 20 }));

    expect($("[data-anot-punto-set]").hidden).toBe(true);
  });

  it("si el punto además gana el partido, lo dice", async () => {
    await montar(
      respuesta({
        estado: {
          setNumero: 3,
          puntos: { A: 14, B: 9 },
          sets: { A: 1, B: 1 },
          historial: [
            { a: 21, b: 18 },
            { a: 19, b: 21 }
          ],
          terminado: false,
          winner: null
        }
      })
    );

    // El tercero se juega a 15: 15–9 cierra el set y con él el partido.
    expect($("[data-anot-punto-set]").textContent).toBe("Punto de partido · Areeiros");
  });

  /*
   * La pestaña va montada sobre el borde del marcador, fuera del flujo: aparecer
   * no puede empujar la pista ni la botonera. En el flujo costaba 24px medidos, y
   * se los llevaba justo el estado en el que se toca más deprisa.
   */
  it("no ocupa sitio en el flujo: va dentro del marcador, en absolute", () => {
    const hoja = readFileSync(
      path.resolve(import.meta.dirname, "../../src/styles/anotador/index.css"),
      "utf8"
    );
    const regla = hoja.slice(hoja.indexOf(".anot-punto-set {"), hoja.indexOf(".anot-punto-set[hidden]"));

    expect(regla).toContain("position: absolute");
    expect(hoja.slice(hoja.indexOf(".anot-marcador {"))).toContain("position: relative");
  });

  it("el rótulo del final y el del panel ganan al aviso", async () => {
    await montar(
      respuesta({
        partido: { id: "p1", status: "finished", origenMarcador: "eventos", reglas: REGLAS, startedAt: null },
        estado: {
          setNumero: 3,
          puntos: { A: 0, B: 0 },
          sets: { A: 2, B: 0 },
          historial: [
            { a: 21, b: 18 },
            { a: 21, b: 9 }
          ],
          terminado: true,
          winner: "A"
        }
      })
    );

    expect($("[data-anot-rotulo]").textContent).toBe("Sets");
    expect($("[data-anot-punto-set]").hidden).toBe(true);
  });
});

describe("cerrar un set se confirma", () => {
  const aUnPunto = () =>
    respuesta({
      estado: {
        setNumero: 1,
        puntos: { A: 20, B: 18 },
        sets: { A: 0, B: 0 },
        historial: [],
        terminado: false,
        winner: null
      }
    });

  const anotarPuntoDeA = () => {
    botones("[data-anot-mitad-a] .anot-jugador")[0]!.click();
    botones("[data-anot-tipos] .anot-btn--punto")[0]!.click();
  };

  it("el punto que cierra el set pregunta antes de mandarse", async () => {
    await montar(aUnPunto());

    anotarPuntoDeA();
    await respirar();

    expect($("[data-anot-cierre]").hidden).toBe(false);
    expect($("[data-anot-cierre-titulo]").textContent).toBe("¿Cierras el set 1?");
    expect($("[data-anot-cierre-marcador]").textContent).toBe("Punto de Marta. El set quedaría 21–18.");
    expect($("[data-anot-cierre-confirmar-texto]").textContent).toBe("Cerrar el set");
    // Nada ha salido hacia el servidor, y el marcador no se ha movido.
    expect(peticiones.filter((p) => p.cuerpo)).toHaveLength(0);
    expect($("[data-anot-puntos-a]").textContent).toBe("20");
  });

  it("cancelar no guarda el punto ni mueve el marcador", async () => {
    await montar(aUnPunto());
    anotarPuntoDeA();
    await respirar();

    $("[data-anot-cierre-cancelar]").click();
    await respirar();

    expect($("[data-anot-cierre]").hidden).toBe(true);
    expect($("[data-anot-reposo]").hidden).toBe(false);
    expect(peticiones.filter((p) => p.cuerpo)).toHaveLength(0);
    expect($("[data-anot-puntos-a]").textContent).toBe("20");
  });

  it("confirmar manda el punto una sola vez", async () => {
    await montar(aUnPunto());
    anotarPuntoDeA();
    await respirar();

    $("[data-anot-cierre-confirmar]").click();
    await respirar();

    const escrituras = peticiones.filter((p) => p.cuerpo);
    expect(escrituras).toHaveLength(1);
    expect(escrituras[0]!.cuerpo).toMatchObject({ accion: "evento", tipo: "punto", jugadorId: 1 });
    expect($("[data-anot-cierre]").hidden).toBe(true);
  });

  it("un punto que no cierra nada se manda sin preguntar", async () => {
    await montar(respuesta());

    anotarPuntoDeA();
    await respirar();

    expect($("[data-anot-cierre]").hidden).toBe(true);
    expect(peticiones.filter((p) => p.cuerpo)).toHaveLength(1);
  });

  /*
   * El tercer toque también pasa por aquí: un bloqueo al que se responde «fue
   * punto» puede cerrar el set igual que un punto normal.
   */
  it("un bloqueo que cierra el set también pregunta", async () => {
    await montar(aUnPunto());

    botones("[data-anot-mitad-a] .anot-jugador")[0]!.click();
    botones("[data-anot-tipos-extra] .anot-btn--bloqueo")[0]!.click();
    botones("[data-anot-punto-opciones] .anot-btn--tipo")[0]!.click();
    await respirar();

    expect($("[data-anot-cierre]").hidden).toBe(false);
    expect(peticiones.filter((p) => p.cuerpo)).toHaveLength(0);

    $("[data-anot-cierre-confirmar]").click();
    await respirar();

    expect(peticiones.filter((p) => p.cuerpo)[0]!.cuerpo).toMatchObject({ tipo: "bloqueo", punto: true });
  });

  it("el punto que gana el partido pregunta por el partido", async () => {
    await montar(
      respuesta({
        estado: {
          setNumero: 3,
          puntos: { A: 14, B: 9 },
          sets: { A: 1, B: 1 },
          historial: [
            { a: 21, b: 18 },
            { a: 19, b: 21 }
          ],
          terminado: false,
          winner: null
        }
      })
    );

    anotarPuntoDeA();
    await respirar();

    expect($("[data-anot-cierre-titulo]").textContent).toBe("¿Cierras el partido?");
    expect($("[data-anot-cierre-confirmar-texto]").textContent).toBe("Cerrar el partido");
    expect($("[data-anot-cierre-confirmar-ayuda]").textContent).toBe("Gana Areeiros");
  });

  it("tocar a otro jugador con la confirmación abierta la cierra", async () => {
    await montar(aUnPunto());
    anotarPuntoDeA();
    await respirar();

    botones("[data-anot-mitad-b] .anot-jugador")[0]!.click();

    expect($("[data-anot-cierre]").hidden).toBe(true);
    expect($("[data-anot-acciones]").hidden).toBe(false);
  });

  /* La franja del pulgar es un solo hueco: el .astro tiene que declararlo dentro. */
  it("en el .astro real, la confirmación cae dentro de la franja del pulgar", () => {
    const pagina = readFileSync(
      path.resolve(import.meta.dirname, "../../src/pages/anotador/partido.astro"),
      "utf8"
    );
    const pulgar = pagina.indexOf('class="anot-pulgar"');
    const cierre = pagina.indexOf("data-anot-cierre");
    const mas = pagina.indexOf('class="anot-mas"');

    expect(pulgar).toBeLessThan(cierre);
    expect(cierre).toBeLessThan(mas);
  });
});

describe("meter a un suplente", () => {
  it("el banquillo son los que no están en pista, y son más pequeños", async () => {
    await montar(respuesta());

    const banca = botones("[data-anot-banquillo-a] .anot-suplente");
    expect(banca).toHaveLength(1);
    expect(banca[0]!.querySelector(".retrato-nombre")!.textContent).toBe("Nuria");
    expect(banca[0]!.querySelector(".retrato")!.className).toContain("retrato--pequeno");
  });

  it("tocar a un suplente pregunta por quién entra, y no anota", async () => {
    await montar(respuesta());

    botones("[data-anot-banquillo-a] .anot-suplente")[0]!.click();

    expect($("[data-anot-cambio]").hidden).toBe(false);
    expect($("[data-anot-acciones]").hidden).toBe(true);
    expect($("[data-anot-entra]").textContent).toBe("Nuria");
    // Las opciones son quienes están en pista de ESE lado.
    expect(botones("[data-anot-cambio-opciones] .anot-btn").map((b) => b.dataset.sale)).toEqual(["1", "2"]);
    expect(peticiones.filter((p) => p.cuerpo)).toHaveLength(0);
  });

  it("el segundo toque manda el cambio", async () => {
    await montar(respuesta());

    botones("[data-anot-banquillo-a] .anot-suplente")[0]!.click();
    botones("[data-anot-cambio-opciones] .anot-btn")[1]!.click();
    await respirar();

    expect(peticiones.at(-1)!.cuerpo).toEqual({ accion: "cambio", entra: 4, sale: 2 });
    expect($("[data-anot-cambio]").hidden).toBe(true);
  });

  it("cancelar vuelve al reposo sin mandar nada", async () => {
    await montar(respuesta());

    botones("[data-anot-banquillo-a] .anot-suplente")[0]!.click();
    $("[data-anot-cambio-cancelar]").click();

    expect($("[data-anot-cambio]").hidden).toBe(true);
    expect($("[data-anot-reposo]").hidden).toBe(false);
    expect(peticiones.filter((p) => p.cuerpo)).toHaveLength(0);
  });

  /*
   * Deshacer es una sola tecla y la decide el estado. Dos botones que hay que
   * elegir a ciegas entre punto y punto es justo lo que esta pantalla no puede
   * permitirse.
   */
  it("si lo último fue un cambio, «Deshacer» deshace el cambio", async () => {
    await montar(
      respuesta({
        eventos: [
          { orden: 0, tipo: "punto", jugadorId: 1, jugador: "Marta Souto Lago", ladoJugador: "A", ladoPunto: "A", setNumero: 1 }
        ],
        siguienteOrden: 1,
        cambios: [{ id: 3, trasOrden: 0, lado: "A", entra: 4, sale: 2, setNumero: 1 }],
        estado: { setNumero: 1, puntos: { A: 1, B: 0 }, sets: { A: 0, B: 0 }, historial: [], terminado: false, winner: null }
      })
    );

    expect($("[data-anot-ultimo]").textContent).toBe("Entra Nuria por Marta");

    $("[data-anot-deshacer]").click();
    await respirar();
    expect(peticiones.at(-1)!.cuerpo).toEqual({ accion: "cambio-deshacer" });
  });
});

describe("la vibración", () => {
  it("sacude el retrato de quien acaba de anotar", async () => {
    const animados: Element[] = [];
    (Element.prototype as unknown as { animate: unknown }).animate = function (this: Element) {
      animados.push(this);
      return { cancel: () => {} };
    };
    (Element.prototype as unknown as { getAnimations: unknown }).getAnimations = () => [];

    await montar(respuesta());
    botones("[data-anot-mitad-a] .anot-jugador")[0]!.click();
    botones("[data-anot-tipos] .anot-btn--punto")[0]!.click();
    await respirar();

    const retrato = botones("[data-anot-mitad-a] .anot-jugador")[0]!.querySelector(".retrato")!;
    expect(animados).toContain(retrato);
  });
});

/*
 * El caso que borraba datos: el partido viene con puntos apuntados a mano y el
 * log vacío. La pantalla enseñaba 0–0 (plegar un log vacío da 0–0), escondía el
 * botón de adoptar y el primer punto reescribía las columnas planas.
 */
describe("un partido que viene con marcador a mano", () => {
  const aMano = () =>
    respuesta({
      pendienteDeAdoptar: true,
      marcadorPanel: { puntos: { A: 8, B: 6 }, sets: { A: 1, B: 1 } }
    });

  it("tapa la pista y dice cuánto va", async () => {
    await montar(aMano());

    expect($("[data-anot-decision]").hidden).toBe(false);
    expect($("[data-anot-decision-titulo]").textContent).toBe("Este partido va 8–6, sets 1–1 a mano");
    expect($("[data-anot-adoptar]").textContent).toBe("Seguir desde 8–6");
    // No se pinta una pista cuyos botones van a responder 409.
    expect($("[data-anot-pista]").hidden).toBe(true);
    expect($("[data-anot-pulgar]").hidden).toBe(true);
  });

  /*
   * El marcador grande enseña el del panel, no el 0–0 de plegar un log vacío:
   * dos cifras distintas del mismo partido en la misma pantalla es peor que una
   * sola, aunque la otra sea técnicamente correcta.
   */
  it("los números grandes son los del panel, con su rótulo", async () => {
    await montar(aMano());

    expect($("[data-anot-puntos-a]").textContent).toBe("8");
    expect($("[data-anot-puntos-b]").textContent).toBe("6");
    expect($("[data-anot-rotulo]").textContent).toBe("Lo lleva el panel");
    expect($("[data-anot-detalle]").textContent).toBe("Sets 1–1 · sin anotar");
  });

  it("ofrece las dos salidas, y cada una manda lo suyo", async () => {
    await montar(aMano());

    $("[data-anot-adoptar]").click();
    await respirar();
    expect(peticiones.at(-1)!.cuerpo).toEqual({ accion: "adoptar" });

    $("[data-anot-cero]").click();
    await respirar();
    expect(peticiones.at(-1)!.cuerpo).toEqual({ accion: "adoptar", desdeCero: true });
  });

  it("resuelto, vuelve la pista", async () => {
    await montar(respuesta({ marcadorPanel: { puntos: { A: 8, B: 6 }, sets: { A: 1, B: 1 } } }));

    expect($("[data-anot-decision]").hidden).toBe(true);
    expect($("[data-anot-pista]").hidden).toBe(false);
  });
});

describe("los dos toques", () => {
  /*
   * La predicción existe para que el número se mueva antes de que conteste el
   * servidor. Quién se lleva el punto sale de `tipos`, que lo trae el servidor:
   * el saque fallado es el único cuyo punto cruza la red, y esa regla estaba
   * escrita a mano aquí.
   */
  it("un saque fallado pinta el punto del rival sin esperar al servidor", async () => {
    await montar(respuesta());

    let resolver: ((valor: Response) => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (url: string, opciones?: { body?: string }) =>
          new Promise<Response>((res) => {
            peticiones.push({ url, cuerpo: opciones?.body ? JSON.parse(opciones.body) : null });
            resolver = res;
          })
      )
    );

    botones("[data-anot-mitad-a] .anot-jugador")[0]!.click();
    botones("[data-anot-tipos] .anot-btn--saque_fallado")[0]!.click();
    await respirar();

    // La petición está en el aire y el marcador ya se movió, del lado B.
    expect($("[data-anot-puntos-a]").textContent).toBe("0");
    expect($("[data-anot-puntos-b]").textContent).toBe("1");
    expect(peticiones.at(-1)!.cuerpo).toMatchObject({ accion: "evento", tipo: "saque_fallado", jugadorId: 1 });

    resolver!(new Response(JSON.stringify(respuesta({ estado: { setNumero: 1, puntos: { A: 0, B: 1 }, sets: { A: 0, B: 0 }, historial: [], terminado: false, winner: null } })), { status: 200 }));
  });

  /*
   * Bloqueo y chilena no las decide el tipo, sino quien anota rally a rally.
   * Mientras no haya respuesta no hay nada que predecir: adivinar aquí sería
   * pintar un punto que el servidor puede no llegar a guardar.
   */
  it("un bloqueo no mueve el marcador mientras no se diga que fue punto", async () => {
    await montar(respuesta());

    botones("[data-anot-mitad-a] .anot-jugador")[0]!.click();
    botones("[data-anot-tipos-extra] .anot-btn--bloqueo")[0]!.click();

    expect($("[data-anot-puntos-a]").textContent).toBe("0");
    expect($("[data-anot-puntos-b]").textContent).toBe("0");
  });

  /*
   * Quién va en cada grupo lo dice `tipos[].punto`, que manda el servidor: los
   * que suman siempre (punto, ace, saque_fallado) en un lado, los que sólo
   * cuentan estadística mientras no se confirme el punto (bloqueo, chilena) en
   * el otro. No hay una lista de claves escrita aquí a propósito — sería una
   * copia de la regla del servidor esperando a desincronizarse.
   */
  it("separa las acciones que suman punto de las que sólo cuentan", async () => {
    await montar(respuesta());
    botones("[data-anot-mitad-a] .anot-jugador")[0]!.click();

    const suman = [...document.querySelectorAll("[data-anot-tipos] button")].map(
      (b) => b.querySelector(".anot-tipo-nombre")!.textContent
    );
    const cuentan = [...document.querySelectorAll("[data-anot-tipos-extra] button")].map(
      (b) => b.querySelector(".anot-tipo-nombre")!.textContent
    );

    expect(suman).toEqual(["Punto", "Ace", "Falló saque"]);
    expect(cuentan).toEqual(["Bloqueo", "Chilena"]);
  });

  /*
   * `bloqueo` y `chilena` no traen `ayuda` (decisión de diseño: era la única de
   * las dos que sólo repetía la etiqueta) — si el servidor no la manda, el
   * cliente no debe fabricar un `<span>` vacío, que ocuparía el mismo alto sin
   * decir nada.
   */
  it("no pinta el subtítulo de ayuda cuando el tipo no lo trae", async () => {
    await montar(respuesta());
    botones("[data-anot-mitad-a] .anot-jugador")[0]!.click();

    const conAyuda = botones("[data-anot-tipos] .anot-btn--tipo").map(
      (b) => b.querySelector(".anot-tipo-ayuda") !== null
    );
    const sinAyuda = botones("[data-anot-tipos-extra] .anot-btn--tipo").map(
      (b) => b.querySelector(".anot-tipo-ayuda") !== null
    );

    expect(conAyuda).toEqual([true, true, true]);
    expect(sinAyuda).toEqual([false, false]);
  });
});

/*
 * El tercer toque. Bloqueo y chilena no dicen por sí solos si el rally acabó en
 * punto, así que antes de anotar se pregunta — en la misma zona del pulgar,
 * con la misma gramática que «¿por quién entra?».
 */
describe("el tercer toque: bloqueo y chilena preguntan", () => {
  it("un bloqueo pregunta si fue punto antes de anotar", async () => {
    await montar(respuesta());
    botones("[data-anot-mitad-a] .anot-jugador")[0]!.click();

    // El bloqueo vive en el grupo de los que sólo cuentan.
    const bloqueo = botones("[data-anot-tipos-extra] .anot-btn--bloqueo")[0]!;
    bloqueo.click();

    expect($("[data-anot-punto]").hidden).toBe(false);
    expect($("[data-anot-acciones]").hidden).toBe(true);
    expect(peticiones.filter((p) => p.cuerpo)).toHaveLength(0);

    const opciones = botones("[data-anot-punto-opciones] button");
    expect(opciones).toHaveLength(2);
    expect(opciones.map((b) => b.querySelector(".anot-tipo-nombre")!.textContent)).toEqual([
      "Fue punto",
      "No fue punto"
    ]);

    opciones[1]!.click(); // «No fue punto»

    /*
     * Justo aquí, síncrono y antes de `respirar()`: la pintada optimista es
     * síncrona, así que si `predecir` predijera un punto para un «no fue
     * punto» el número subiría **ahora**, y el `finally` de `anotarPunto` no lo
     * corregiría hasta que la promesa (mock) se resuelva. Con 4G de verdad esa
     * ventana son 300–600 ms en los que el marcador mentiría solo, sin que
     * nada en pantalla dijera que es provisional.
     */
    expect($("[data-anot-puntos-a]").textContent).toBe("0");

    await respirar();

    expect(peticiones.at(-1)!.cuerpo).toMatchObject({ accion: "evento", tipo: "bloqueo", punto: false });
  });

  it("«Fue punto» manda punto: true y predice el marcador sin esperar al servidor", async () => {
    await montar(respuesta());

    let resolver: ((valor: Response) => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (url: string, opciones?: { body?: string }) =>
          new Promise<Response>((res) => {
            peticiones.push({ url, cuerpo: opciones?.body ? JSON.parse(opciones.body) : null });
            resolver = res;
          })
      )
    );

    botones("[data-anot-mitad-a] .anot-jugador")[0]!.click();
    botones("[data-anot-tipos-extra] .anot-btn--bloqueo")[0]!.click();
    botones("[data-anot-punto-opciones] button")[0]!.click(); // «Fue punto»
    await respirar();

    expect($("[data-anot-puntos-a]").textContent).toBe("1");
    expect(peticiones.at(-1)!.cuerpo).toMatchObject({ accion: "evento", tipo: "bloqueo", punto: true });

    resolver!(
      new Response(
        JSON.stringify(
          respuesta({
            estado: { setNumero: 1, puntos: { A: 1, B: 0 }, sets: { A: 0, B: 0 }, historial: [], terminado: false, winner: null }
          })
        ),
        { status: 200 }
      )
    );
  });

  it("un punto no pregunta nada: se anota directo, sin `punto` en el cuerpo", async () => {
    await montar(respuesta());
    botones("[data-anot-mitad-a] .anot-jugador")[0]!.click();
    botones("[data-anot-tipos] .anot-btn--punto")[0]!.click();
    await respirar();

    expect($("[data-anot-punto]").hidden).toBe(true);
    expect(peticiones.at(-1)!.cuerpo).toMatchObject({ accion: "evento", tipo: "punto" });
    expect(peticiones.at(-1)!.cuerpo).not.toHaveProperty("punto");
  });

  it("cancelar la pregunta vuelve al reposo sin mandar nada", async () => {
    await montar(respuesta());
    botones("[data-anot-mitad-a] .anot-jugador")[0]!.click();
    botones("[data-anot-tipos-extra] .anot-btn--bloqueo")[0]!.click();

    $("[data-anot-punto-cancelar]").click();

    expect($("[data-anot-punto]").hidden).toBe(true);
    expect($("[data-anot-reposo]").hidden).toBe(false);
    expect(peticiones.filter((p) => p.cuerpo)).toHaveLength(0);
  });

  /*
   * `[data-anot-cambio]` vive en el mismo hueco del pulgar que `[data-anot-punto]`.
   * Sin cerrar la pregunta al abrir un cambio, los dos bloques quedaban
   * apilados a la vez — dos preguntas contradictorias reclamando el mismo
   * hueco, y el presupuesto de alto de esta pantalla roto de propina.
   */
  it("tocar a un suplente con la pregunta abierta cierra la pregunta", async () => {
    await montar(respuesta());
    botones("[data-anot-mitad-a] .anot-jugador")[0]!.click();
    botones("[data-anot-tipos-extra] .anot-btn--bloqueo")[0]!.click();

    botones("[data-anot-banquillo-a] .anot-suplente")[0]!.click();

    expect($("[data-anot-punto]").hidden).toBe(true);
    expect($("[data-anot-cambio]").hidden).toBe(false);
  });

  /*
   * Todo lo de arriba prueba `MARCADO`, la copia a mano del `.astro` — el
   * mismo punto ciego que ya advierte el comentario de cabecera de este
   * fichero: si el `.astro` real mueve `[data-anot-punto]` fuera de la franja
   * del pulgar, esta suite seguiría en verde y sería producción la que se
   * quedara con la pregunta fuera de sitio. La spec pedía «el tercer toque
   * existe y cae en la franja del pulgar»; esto cierra la segunda mitad,
   * leyendo el `.astro` como texto, igual que ya hace el test del aviso más
   * abajo.
   */
  it("en el .astro real, la pregunta cae dentro de la franja del pulgar", () => {
    const pagina = readFileSync(path.resolve(import.meta.dirname, "../../src/pages/anotador/partido.astro"), "utf8");
    const pulgar = pagina.indexOf('class="anot-pulgar"');
    const cierre = pagina.indexOf("</section>", pulgar);
    const punto = pagina.indexOf('class="anot-punto"');

    expect(punto).toBeGreaterThan(pulgar);
    expect(punto).toBeLessThan(cierre);
  });
});

describe("corregir un punto", () => {
  const conEventos = () =>
    respuesta({
      eventos: [
        { orden: 0, tipo: "ajuste", jugadorId: null, jugador: null, ladoJugador: null, ladoPunto: null, setNumero: 1 },
        { orden: 1, tipo: "punto", jugadorId: 1, jugador: "Marta Souto Lago", ladoJugador: "A", ladoPunto: "A", setNumero: 1 }
      ],
      siguienteOrden: 2,
      estado: { setNumero: 1, puntos: { A: 1, B: 0 }, sets: { A: 0, B: 0 }, historial: [], terminado: false, winner: null }
    });

  it("cada punto del historial es un botón, menos el saldo de apertura", async () => {
    await montar(conEventos());

    const lineas = botones("[data-anot-historial] .anot-historial-linea");
    expect(lineas).toHaveLength(2);
    // Se pintan del más reciente al más antiguo.
    expect(lineas[0]!.textContent).toBe("2. Punto de Marta Souto Lago");
    expect(lineas[0]!.disabled).toBe(false);
    expect(lineas[1]!.disabled).toBe(true);
  });

  it("manda la acción y el autor elegidos", async () => {
    await montar(conEventos());

    botones("[data-anot-historial] .anot-historial-linea")[0]!.click();
    expect($("[data-anot-corregir-titulo]").textContent).toBe("Corregir el punto 2");

    // Llega marcado lo que el evento tenía.
    const tipoActual = botones("[data-anot-corregir-tipos] [data-tipo='punto']")[0]!;
    expect(tipoActual.getAttribute("aria-pressed")).toBe("true");

    botones("[data-anot-corregir-tipos] [data-tipo='bloqueo']")[0]!.click();
    botones("[data-anot-corregir-jugadores] [data-jugador='3']")[0]!.click();
    $("[data-anot-corregir-guardar]").click();
    await respirar();

    /*
     * El evento original era un `punto` (puntuó), así que al pasar a `bloqueo`
     * —que pregunta— la corrección conserva ese sí sin que se toque el sí/no:
     * el evento decía «esta fila puntuó» y cambiar sólo la acción y el autor no
     * debe perder esa afirmación.
     */
    expect(peticiones.at(-1)!.cuerpo).toEqual({
      accion: "corregir",
      orden: 1,
      tipo: "bloqueo",
      jugadorId: 3,
      punto: true
    });
  });

  /*
   * El sí/no del diálogo sólo tiene sentido con los tipos que preguntan
   * (bloqueo, chilena): con los demás el tipo ya decide y el servidor ignora
   * `punto` — pedirlo siempre sería sugerir una elección que no existe.
   */
  it("corregir enseña el sí/no sólo con los tipos que preguntan", async () => {
    await montar(conEventos());
    botones("[data-anot-historial] .anot-historial-linea")[0]!.click();

    const bloque = $("[data-anot-corregir-punto]");
    // El evento tocado es un «punto», que no pregunta.
    expect(bloque.hidden).toBe(true);

    botones("[data-anot-corregir-tipos] [data-tipo='bloqueo']")[0]!.click();
    expect(bloque.hidden).toBe(false);

    botones("[data-anot-corregir-tipos] [data-tipo='punto']")[0]!.click();
    expect(bloque.hidden).toBe(true);
  });

  /*
   * Con un tipo que pregunta, tocar «No fue punto» tiene que llegar al
   * servidor como `punto: false` — es el caso que motiva la tarea entera: un
   * bloqueo anotado como punto que en realidad no lo fue.
   */
  it("«No fue punto» en el diálogo manda punto: false", async () => {
    await montar(conEventos());
    botones("[data-anot-historial] .anot-historial-linea")[0]!.click();

    botones("[data-anot-corregir-tipos] [data-tipo='bloqueo']")[0]!.click();
    botones("[data-anot-corregir-punto] [data-punto='false']")[0]!.click();
    $("[data-anot-corregir-guardar]").click();
    await respirar();

    expect(peticiones.at(-1)!.cuerpo).toEqual({
      accion: "corregir",
      orden: 1,
      tipo: "bloqueo",
      jugadorId: 1,
      punto: false
    });
  });

  /*
   * El caso que se colaba: `saque_fallado` es `aRival: true`, así que su
   * `ladoPunto` no es nulo pero apunta al lado CONTRARIO al de quien sacó.
   * «`ladoPunto` no nulo» no es lo mismo que «mi lado se lo llevó» — sólo
   * coinciden cuando el tipo no cruza la red. Corregir un saque fallado hacia
   * un bloqueo sin tocar el sí/no tiene que preguntar de nuevo (`punto:
   * false`), no arrastrar un «sí» que en realidad era del rival: si no, el
   * punto se lo queda quien sacó en vez de a quien se lo llevó de verdad, sin
   * un solo error en pantalla.
   */
  it("corregir un saque fallado hacia bloqueo no arrastra el punto del rival como propio", async () => {
    await montar(
      respuesta({
        eventos: [
          { orden: 0, tipo: "ajuste", jugadorId: null, jugador: null, ladoJugador: null, ladoPunto: null, setNumero: 1 },
          {
            orden: 1,
            tipo: "saque_fallado",
            jugadorId: 1,
            jugador: "Marta Souto Lago",
            ladoJugador: "A",
            ladoPunto: "B",
            setNumero: 1
          }
        ],
        siguienteOrden: 2,
        estado: { setNumero: 1, puntos: { A: 0, B: 1 }, sets: { A: 0, B: 0 }, historial: [], terminado: false, winner: null }
      })
    );

    botones("[data-anot-historial] .anot-historial-linea")[0]!.click();
    // `saque_fallado` no pregunta: el bloque no se enseña hasta cambiar el tipo.
    expect($("[data-anot-corregir-punto]").hidden).toBe(true);

    botones("[data-anot-corregir-tipos] [data-tipo='bloqueo']")[0]!.click();
    // Sin tocar el sí/no.
    $("[data-anot-corregir-guardar]").click();
    await respirar();

    expect(peticiones.at(-1)!.cuerpo).toEqual({
      accion: "corregir",
      orden: 1,
      tipo: "bloqueo",
      jugadorId: 1,
      punto: false
    });
  });

  /*
   * Con un tipo que no pregunta (`punto`, `ace`, `saque_fallado`) el cuerpo no
   * debe llevar `punto` en absoluto: mandarlo sería decidir por el servidor
   * cuando el propio tipo ya lo decide.
   */
  it("con un tipo que no pregunta, guardarCorreccion no manda punto", async () => {
    await montar(conEventos());
    botones("[data-anot-historial] .anot-historial-linea")[0]!.click();

    // Se queda en «punto», que ya llega marcado desde el evento original.
    $("[data-anot-corregir-guardar]").click();
    await respirar();

    expect(peticiones.at(-1)!.cuerpo).toEqual({ accion: "corregir", orden: 1, tipo: "punto", jugadorId: 1 });
    expect(peticiones.at(-1)!.cuerpo).not.toHaveProperty("punto");
  });
});

describe("la alineación", () => {
  it("dice quién es suplente", async () => {
    await montar(respuesta());

    $("[data-anot-alineacion]").click();
    const etiquetas = [...document.querySelectorAll("[data-anot-plantillas] .anot-check")];
    const suplente = etiquetas.find((l) => l.textContent?.includes("Nuria"));

    expect(suplente!.textContent).toContain("suplente");
    expect(etiquetas.find((l) => l.textContent?.includes("Iago"))!.textContent).not.toContain("suplente");
  });
});

/*
 * Lo que pasa cuando la playa se queda sin cobertura a media final.
 *
 * La regla de esta pantalla es la del comentario de `core.js`: un anotador que
 * cree que está guardando y no lo está es peor que uno que sabe que no puede
 * anotar. La pintada optimista la contradecía sin querer — subía el número y,
 * si la petición se caía, ahí se quedaba: el marcador enseñaba un punto que no
 * existía en ninguna base de datos, con un aviso pequeño debajo que además
 * estaba en inglés («Failed to fetch»).
 */
describe("sin red", () => {
  /** Rompe la red a partir de la siguiente petición. */
  const cortar = () => {
    responder = async () => {
      throw new TypeError("Failed to fetch");
    };
  };

  it("el punto que no se guardó no se queda pintado", async () => {
    await montar(respuesta({ estado: { setNumero: 1, puntos: { A: 4, B: 2 }, sets: { A: 0, B: 0 }, historial: [], terminado: false, winner: null } }));
    expect($("[data-anot-puntos-a]").textContent).toBe("4");

    cortar();
    botones("[data-anot-mitad-a] .anot-jugador")[0]!.click();
    botones("[data-anot-tipos] .anot-btn--punto")[0]!.click();
    await respirar();

    expect($("[data-anot-puntos-a]").textContent).toBe("4");
    expect($("[data-anot-error]").hidden).toBe(false);
  });

  it("lo dice en cristiano, no con el mensaje del navegador", async () => {
    await montar(respuesta());
    cortar();

    botones("[data-anot-mitad-a] .anot-jugador")[0]!.click();
    botones("[data-anot-tipos] .anot-btn--punto")[0]!.click();
    await respirar();

    const aviso = $("[data-anot-error]").textContent || "";
    expect(aviso).not.toContain("Failed to fetch");
    expect(aviso.toLowerCase()).toContain("conexión");
  });

  /*
   * `navigator.onLine` dice «sí» conectado a un wifi sin salida, que es
   * exactamente el chiringuito de la playa. La única señal fiable de que no hay
   * red es una petición que se cae.
   */
  it("una petición caída enciende la banda de sin conexión", async () => {
    await montar(respuesta());
    expect($("[data-anot-offline]").hidden).toBe(true);

    cortar();
    botones("[data-anot-mitad-a] .anot-jugador")[0]!.click();
    botones("[data-anot-tipos] .anot-btn--punto")[0]!.click();
    await respirar();

    expect($("[data-anot-offline]").hidden).toBe(false);
  });

  it("y se apaga en cuanto una vuelve a llegar", async () => {
    await montar(respuesta());
    cortar();
    botones("[data-anot-mitad-a] .anot-jugador")[0]!.click();
    botones("[data-anot-tipos] .anot-btn--punto")[0]!.click();
    await respirar();
    expect($("[data-anot-offline]").hidden).toBe(false);

    responder = async () => new Response(JSON.stringify(respuesta()), { status: 200 });
    botones("[data-anot-mitad-a] .anot-jugador")[0]!.click();
    botones("[data-anot-tipos] .anot-btn--punto")[0]!.click();
    await respirar();

    expect($("[data-anot-offline]").hidden).toBe(true);
  });
});

/*
 * Ofrecer un botón que va a contestar con un error es ofrecer un fallo. Ya
 * estaba decidido para «Deshacer» de un partido terminado; faltaban los otros
 * dos casos que también responden 409 seguro.
 */
describe("botones que no se ofrecen si van a fallar", () => {
  const conAjuste = () =>
    respuesta({
      partido: { id: "p1", status: "live", origenMarcador: "eventos", reglas: REGLAS, startedAt: null },
      estado: { setNumero: 3, puntos: { A: 8, B: 6 }, sets: { A: 1, B: 1 }, historial: [], terminado: false, winner: null },
      eventos: [{ orden: 0, tipo: "ajuste", jugadorId: null, jugador: null, ladoJugador: null, ladoPunto: null, setNumero: 3 }],
      siguienteOrden: 1
    });

  /*
   * El saldo de apertura no se deshace: el servidor lo rechaza, porque borrarlo
   * dejaba el marcador adoptado en 0–0 y sin forma de recuperarlo.
   */
  it("deshacer se apaga cuando lo último es el saldo de apertura", async () => {
    await montar(conAjuste());
    expect(($("[data-anot-deshacer]") as HTMLButtonElement).disabled).toBe(true);
  });

  it("pero sigue encendido con un punto normal detrás", async () => {
    await montar(
      respuesta({
        eventos: [{ orden: 0, tipo: "punto", jugadorId: 1, jugador: "Marta Souto Lago", ladoJugador: "A", ladoPunto: "A", setNumero: 1 }],
        siguienteOrden: 1
      })
    );
    expect(($("[data-anot-deshacer]") as HTMLButtonElement).disabled).toBe(false);
  });

  /*
   * Pulsar dos veces «Seguir desde 8–6» con la red lenta mandaba dos adopciones:
   * la segunda contesta «Este partido ya tiene anotación» y el anotador ve un
   * error por haber hecho las cosas bien.
   */
  it("adoptar no se manda dos veces por un doble toque", async () => {
    await montar(
      respuesta({ marcadorPanel: { puntos: { A: 8, B: 6 }, sets: { A: 1, B: 1 } }, pendienteDeAdoptar: true })
    );

    let resolver: ((valor: Response) => void) | null = null;
    responder = () => new Promise<Response>((res) => { resolver = res; });

    $("[data-anot-adoptar]").click();
    $("[data-anot-adoptar]").click();
    $("[data-anot-cero]").click();
    await respirar();

    expect(peticiones.filter((p) => p.cuerpo?.accion === "adoptar")).toHaveLength(1);
    resolver!(new Response(JSON.stringify(respuesta()), { status: 200 }));
  });
});

/*
 * El aviso vive pegado a la franja del pulgar y no en la cabecera.
 *
 * Se comprueba leyendo el .astro y el CSS porque es donde se declara: el test
 * de DOM copia el marcado a mano, así que por sí solo seguiría en verde con la
 * página diciendo lo contrario. Que sea `absolute` no es un detalle de estilo —
 * es lo que garantiza que aparecer no mueva un botón, que es la regla de la que
 * sale toda esta pantalla.
 */
describe("dónde se avisa de que algo no se ha guardado", () => {
  const leer = (ruta: string) => readFileSync(path.resolve(import.meta.dirname, ruta), "utf8");

  it("el aviso está dentro de la franja del pulgar, no arriba", () => {
    const pagina = leer("../../src/pages/anotador/partido.astro");
    const pulgar = pagina.indexOf("data-anot-pulgar");
    const cierre = pagina.indexOf("</section>", pulgar);
    const aviso = pagina.indexOf("data-anot-error");

    expect(aviso).toBeGreaterThan(pulgar);
    expect(aviso).toBeLessThan(cierre);
  });

  it("y la página se lo pide al armazón, que si no lo pintaría dos veces", () => {
    expect(leer("../../src/pages/anotador/partido.astro")).toContain("avisoJuntoAlPulgar");
    expect(leer("../../src/layouts/AnotadorLayout.astro")).toContain("!avisoJuntoAlPulgar &&");
  });

  it("se pinta fuera del flujo: aparecer no puede mover la botonera", () => {
    const css = leer("../../src/styles/anotador/index.css");
    const regla = css.slice(css.indexOf(".anot-alerta--pulgar"), css.indexOf(".anot-alerta--pulgar") + 400);

    expect(regla).toContain("position: absolute");
    expect(regla).toContain("pointer-events: none");
    expect(css).toMatch(/\.anot-pulgar \{[^}]*position: relative/s);
  });

  /* La lista de partidos no tiene franja de pulgar: allí el aviso sigue arriba. */
  it("la lista de partidos conserva el suyo", () => {
    expect(leer("../../src/pages/anotador/index.astro")).not.toContain("avisoJuntoAlPulgar");
  });
});

/*
 * El anotador no sondea, y no debe hacerlo: un partido solo cambia cuando lo
 * toca quien lo anota. Lo que sí hace falta es una lectura al volver a la
 * pantalla, porque el móvil se bloquea entre sets y porque dos personas pueden
 * estar anotando el mismo partido.
 */
describe("volver a la pantalla", () => {
  it("relee una vez al reaparecer la pestaña", async () => {
    await montar(respuesta());
    const antes = peticiones.length;

    document.dispatchEvent(new Event("visibilitychange"));
    await respirar();

    expect(peticiones.length).toBe(antes + 1);
    expect(peticiones.at(-1)!.cuerpo).toBe(null);
  });

  it("pero no en mitad de un guardado, que pisaría lo que llega", async () => {
    await montar(respuesta());

    let resolver: ((valor: Response) => void) | null = null;
    responder = () => new Promise<Response>((res) => { resolver = res; });
    botones("[data-anot-mitad-a] .anot-jugador")[0]!.click();
    botones("[data-anot-tipos] .anot-btn--punto")[0]!.click();
    await respirar();
    const enVuelo = peticiones.length;

    document.dispatchEvent(new Event("visibilitychange"));
    await respirar();

    expect(peticiones.length).toBe(enVuelo);
    resolver!(new Response(JSON.stringify(respuesta()), { status: 200 }));
  });

  it("y no sondea: sin tocar nada, no pide nada", async () => {
    await montar(respuesta());
    const antes = peticiones.length;

    await new Promise((r) => setTimeout(r, 60));

    expect(peticiones.length).toBe(antes);
  });
});

/*
 * El reloj sale de `partidos.started_at`, que hasta hace poco sólo escribía el
 * botón «empezar» del panel: un partido llevado entero desde el anotador no
 * tenía hora de inicio y el reloj marcaba 00:00 para siempre. Ahora lo pone el
 * pliegue con el primer punto, y esta pantalla lo enseña.
 */
describe("el reloj del partido", () => {
  it("no se pinta mientras el partido no ha empezado", async () => {
    await montar(respuesta());
    expect($("[data-anot-reloj]").hidden).toBe(true);
  });

  it("cuenta desde la hora de inicio", async () => {
    const hace90s = new Date(Date.now() - 90_000).toISOString();
    await montar(
      respuesta({ partido: { id: "p1", status: "live", origenMarcador: "eventos", reglas: REGLAS, startedAt: hace90s, elapsedMs: 0 } })
    );

    const reloj = $("[data-anot-reloj]");
    expect(reloj.hidden).toBe(false);
    expect(reloj.textContent).toMatch(/01:3\d$/);
  });

  /*
   * Al terminar, el servidor congela la duración en `elapsed_ms` y el reloj deja
   * de correr solo. Sin `elapsedMs` en la respuesta, `elapsed()` devolvía 0 y la
   * pantalla se despedía marcando 00:00 tras cuarenta minutos de juego.
   */
  it("un partido terminado enseña la duración congelada", async () => {
    await montar(
      respuesta({
        partido: { id: "p1", status: "finished", origenMarcador: "eventos", reglas: REGLAS, startedAt: new Date().toISOString(), elapsedMs: 2_400_000 },
        estado: { setNumero: 2, puntos: { A: 0, B: 0 }, sets: { A: 1, B: 0 }, historial: [{ a: 5, b: 3 }], terminado: true, winner: "A" }
      })
    );

    expect($("[data-anot-reloj]").textContent).toBe(" · 40:00");
  });

  /*
   * La línea va centrada, así que un reloj de ancho variable la movería una vez
   * por segundo. `tabular-nums` es lo que lo impide, y sin él el fallo sólo se
   * ve mirando fijamente la pantalla.
   */
  it("el reloj lleva cifras de ancho fijo", () => {
    const css = readFileSync(path.resolve(import.meta.dirname, "../../src/styles/anotador/index.css"), "utf8");
    expect(css).toMatch(/\.anot-reloj\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  });
});
