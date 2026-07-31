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
      <p data-anot-rotulo hidden>Sets</p>
      <p class="anot-tanteo">
        <span data-anot-puntos-a>0</span>
        <span data-anot-puntos-b>0</span>
      </p>
      <p data-anot-detalle></p>
      <p data-anot-parciales hidden></p>
    </section>

    <section class="anot-decision" data-anot-decision hidden>
      <h2 data-anot-decision-titulo></h2>
      <div class="anot-decision-botones">
        <button type="button" data-anot-adoptar></button>
        <button type="button" data-anot-cero>Empezar en 0–0</button>
      </div>
      <p role="alert" data-anot-error-decision hidden></p>
    </section>

    <section class="anot-fuera" data-anot-fuera hidden>
      <button type="button" data-anot-poner-directo>Poner en directo</button>
      <p role="alert" data-anot-error-fuera hidden></p>
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
        <button type="button" data-anot-cancelar>Cancelar</button>
      </div>
      <div data-anot-cambio hidden>
        <p>¿Por quién entra <strong data-anot-entra></strong>?</p>
        <div data-anot-cambio-opciones></div>
        <button type="button" data-anot-cambio-cancelar>Cancelar</button>
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
    <div data-anot-corregir-jugadores></div>
    <button type="button" data-anot-corregir-cancelar>Cancelar</button>
    <button type="button" data-anot-corregir-guardar>Guardar la corrección</button>
  </dialog>

  <dialog data-anot-dialogo-directo>
    <p data-anot-directo-cruce></p>
    <input type="checkbox" data-anot-directo-acepto />
    <button type="button" data-anot-directo-cancelar>Cancelar</button>
    <button type="button" data-anot-directo-confirmar disabled>Sí, en directo</button>
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

    expect($("[data-anot-rotulo]").hidden).toBe(false);
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
          { orden: 0, tipo: "remate", jugadorId: 1, jugador: "Marta Souto Lago", ladoJugador: "A", ladoPunto: "A", setNumero: 1 }
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
    botones("[data-anot-tipos] .anot-btn--remate")[0]!.click();
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
    expect($("[data-anot-rotulo]").hidden).toBe(false);
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
   * el error da el punto al RIVAL, y esa regla estaba escrita a mano aquí.
   */
  it("un error pinta el punto del rival sin esperar al servidor", async () => {
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
    botones("[data-anot-tipos] .anot-btn--error")[0]!.click();
    await respirar();

    // La petición está en el aire y el marcador ya se movió, del lado B.
    expect($("[data-anot-puntos-a]").textContent).toBe("0");
    expect($("[data-anot-puntos-b]").textContent).toBe("1");
    expect(peticiones.at(-1)!.cuerpo).toMatchObject({ accion: "evento", tipo: "error", jugadorId: 1 });

    resolver!(new Response(JSON.stringify(respuesta({ estado: { setNumero: 1, puntos: { A: 0, B: 1 }, sets: { A: 0, B: 0 }, historial: [], terminado: false, winner: null } })), { status: 200 }));
  });

  it("una defensa no mueve el marcador", async () => {
    await montar(respuesta());

    botones("[data-anot-mitad-a] .anot-jugador")[0]!.click();
    botones("[data-anot-tipos] .anot-btn--defensa")[0]!.click();

    expect($("[data-anot-puntos-a]").textContent).toBe("0");
    expect($("[data-anot-puntos-b]").textContent).toBe("0");
  });
});

describe("corregir un punto", () => {
  const conEventos = () =>
    respuesta({
      eventos: [
        { orden: 0, tipo: "ajuste", jugadorId: null, jugador: null, ladoJugador: null, ladoPunto: null, setNumero: 1 },
        { orden: 1, tipo: "remate", jugadorId: 1, jugador: "Marta Souto Lago", ladoJugador: "A", ladoPunto: "A", setNumero: 1 }
      ],
      siguienteOrden: 2,
      estado: { setNumero: 1, puntos: { A: 1, B: 0 }, sets: { A: 0, B: 0 }, historial: [], terminado: false, winner: null }
    });

  it("cada punto del historial es un botón, menos el saldo de apertura", async () => {
    await montar(conEventos());

    const lineas = botones("[data-anot-historial] .anot-historial-linea");
    expect(lineas).toHaveLength(2);
    // Se pintan del más reciente al más antiguo.
    expect(lineas[0]!.textContent).toBe("2. Remate de Marta Souto Lago");
    expect(lineas[0]!.disabled).toBe(false);
    expect(lineas[1]!.disabled).toBe(true);
  });

  it("manda la acción y el autor elegidos", async () => {
    await montar(conEventos());

    botones("[data-anot-historial] .anot-historial-linea")[0]!.click();
    expect($("[data-anot-corregir-titulo]").textContent).toBe("Corregir el punto 2");

    // Llega marcado lo que el evento tenía.
    const tipoActual = botones("[data-anot-corregir-tipos] [data-tipo='remate']")[0]!;
    expect(tipoActual.getAttribute("aria-pressed")).toBe("true");

    botones("[data-anot-corregir-tipos] [data-tipo='bloqueo']")[0]!.click();
    botones("[data-anot-corregir-jugadores] [data-jugador='3']")[0]!.click();
    $("[data-anot-corregir-guardar]").click();
    await respirar();

    expect(peticiones.at(-1)!.cuerpo).toEqual({ accion: "corregir", orden: 1, tipo: "bloqueo", jugadorId: 3 });
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
    botones("[data-anot-tipos] .anot-btn--remate")[0]!.click();
    await respirar();

    expect($("[data-anot-puntos-a]").textContent).toBe("4");
    expect($("[data-anot-error]").hidden).toBe(false);
  });

  it("lo dice en cristiano, no con el mensaje del navegador", async () => {
    await montar(respuesta());
    cortar();

    botones("[data-anot-mitad-a] .anot-jugador")[0]!.click();
    botones("[data-anot-tipos] .anot-btn--remate")[0]!.click();
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
    botones("[data-anot-tipos] .anot-btn--remate")[0]!.click();
    await respirar();

    expect($("[data-anot-offline]").hidden).toBe(false);
  });

  it("y se apaga en cuanto una vuelve a llegar", async () => {
    await montar(respuesta());
    cortar();
    botones("[data-anot-mitad-a] .anot-jugador")[0]!.click();
    botones("[data-anot-tipos] .anot-btn--remate")[0]!.click();
    await respirar();
    expect($("[data-anot-offline]").hidden).toBe(false);

    responder = async () => new Response(JSON.stringify(respuesta()), { status: 200 });
    botones("[data-anot-mitad-a] .anot-jugador")[0]!.click();
    botones("[data-anot-tipos] .anot-btn--remate")[0]!.click();
    await respirar();

    expect($("[data-anot-offline]").hidden).toBe(true);
  });
});

/*
 * `[data-anot-error]`, el de siempre, cuelga de `.anot-pulgar` — que `pintar()`
 * oculta durante `fuera` y `decidir`. Un fallo de «Poner en directo» o de
 * «Adoptar» caía ahí y no se veía: el anotador solo veía el botón reaparecer,
 * sin saber que había que repetir el toque. Comprobar solo `.hidden` en el
 * propio párrafo es justo el chequeo que habría pasado con el bug en danza —
 * hay que subir la cadena de antepasados, porque un nodo con `hidden=false`
 * dentro de una sección `hidden=true` tampoco se ve.
 */
describe("el aviso de un fallo se ve en el bloque que está en pantalla", () => {
  /** Rompe la red a partir de la siguiente petición: mismo camino de catch que un 409. */
  const cortar = () => {
    responder = async () => {
      throw new TypeError("Failed to fetch");
    };
  };

  const visible = (nodo: HTMLElement | null): boolean => {
    for (let actual: HTMLElement | null = nodo; actual; actual = actual.parentElement) {
      if (actual.hidden) return false;
    }
    return Boolean(nodo);
  };

  it("«Poner en directo» que falla se ve, no solo el botón que vuelve", async () => {
    await montar(
      respuesta({ partido: { id: "p1", status: "scheduled", origenMarcador: "manual", reglas: REGLAS, startedAt: null } })
    );

    $("[data-anot-poner-directo]").click();
    const acepto = $("[data-anot-directo-acepto]") as HTMLInputElement;
    acepto.checked = true;
    acepto.dispatchEvent(new Event("change"));
    cortar();
    $("[data-anot-directo-confirmar]").click();
    await respirar();

    const aviso = $("[data-anot-error-fuera]");
    expect(aviso.hidden).toBe(false);
    expect(visible(aviso)).toBe(true);
    // El de siempre —oculto en este estado— no debe quedarse con el mensaje.
    expect($("[data-anot-error]").hidden).toBe(true);
  });

  it("«Adoptar» que falla se ve mientras la decisión sigue en pantalla", async () => {
    await montar(
      respuesta({ pendienteDeAdoptar: true, marcadorPanel: { puntos: { A: 8, B: 6 }, sets: { A: 1, B: 1 } } })
    );

    cortar();
    $("[data-anot-adoptar]").click();
    await respirar();

    const aviso = $("[data-anot-error-decision]");
    expect(aviso.hidden).toBe(false);
    expect(visible(aviso)).toBe(true);
    expect($("[data-anot-error]").hidden).toBe(true);
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
        eventos: [{ orden: 0, tipo: "remate", jugadorId: 1, jugador: "Marta Souto Lago", ladoJugador: "A", ladoPunto: "A", setNumero: 1 }],
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
    // No `indexOf("data-anot-error")`: eso encuentra antes a
    // `data-anot-error-decision` / `data-anot-error-fuera` (los avisos propios
    // de los otros dos bloques) o incluso su mención en un comentario. Este
    // busca el atributo suelto: sin guion ni corchete detrás, un espacio.
    const aviso = pagina.search(/data-anot-error(?=\s)/);

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
    botones("[data-anot-tipos] .anot-btn--remate")[0]!.click();
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

describe("el marcado de poner en directo", () => {
  const leer = (ruta: string) => readFileSync(path.resolve(import.meta.dirname, ruta), "utf8");
  const pagina = () => leer("../../src/pages/anotador/partido.astro");

  it("tiene el bloque de fuera de directo y su diálogo", () => {
    const fuente = pagina();
    expect(fuente).toContain("data-anot-fuera");
    expect(fuente).toContain("data-anot-poner-directo");
    expect(fuente).toContain("data-anot-dialogo-directo");
  });

  /*
   * La segunda confirmación es una casilla que hay que marcar, no un segundo
   * diálogo: dos diálogos seguidos en un móvil al sol se despachan a ciegas.
   */
  it("la confirmación es doble: casilla más botón", () => {
    const fuente = pagina();
    expect(fuente).toContain("data-anot-directo-acepto");
    expect(fuente).toContain("data-anot-directo-confirmar");
  });

  /*
   * El aviso tiene que decir QUÉ pasa, no solo que es importante: quien anota no
   * tiene por qué saber dónde sale publicado el partido.
   */
  it("dice dónde va a aparecer el partido", () => {
    expect(pagina()).toContain("portada");
  });
});

/*
 * El estado «fuera de directo»: mientras el partido sigue `scheduled`, publicar
 * es un acto deliberado (`PartidoNoEnDirecto` en el servidor) y esta pantalla no
 * pinta una pista cuyos botones responderían 409.
 */
describe("fuera de directo", () => {
  const programado = (extra: Record<string, unknown> = {}) =>
    respuesta({ partido: { id: "p1", status: "scheduled", origenMarcador: "manual", reglas: REGLAS, startedAt: null }, ...extra });

  it("oculta la pista y la franja del pulgar, y enseña el aviso", async () => {
    await montar(programado());

    expect($("[data-anot-fuera]").hidden).toBe(false);
    expect($("[data-anot-pista]").hidden).toBe(true);
    expect($("[data-anot-pulgar]").hidden).toBe(true);
  });

  it("en directo, el aviso se oculta y vuelve la pista", async () => {
    await montar(respuesta());

    expect($("[data-anot-fuera]").hidden).toBe(true);
    expect($("[data-anot-pista]").hidden).toBe(false);
    expect($("[data-anot-pulgar]").hidden).toBe(false);
  });

  /*
   * Un `scheduled` con marcador a mano: el servidor comprueba el status ANTES
   * que el marcador (`registrarEvento` en `_lib/eventos.ts`), así que el primer
   * aviso en llegar sería «no está en directo», no «hay un marcador por
   * decidir». Pintar los dos a la vez ofrecería dos salidas cuando solo una
   * lleva a algún sitio: publicarlo primero.
   */
  it("gana sobre la decisión del marcador a mano", async () => {
    await montar(
      programado({ pendienteDeAdoptar: true, marcadorPanel: { puntos: { A: 8, B: 6 }, sets: { A: 1, B: 1 } } })
    );

    expect($("[data-anot-fuera]").hidden).toBe(false);
    expect($("[data-anot-decision]").hidden).toBe(true);
  });

  it("terminado sigue enseñando la pista, no el aviso de publicar", async () => {
    await montar(
      respuesta({
        partido: { id: "p1", status: "finished", origenMarcador: "eventos", reglas: REGLAS, startedAt: null },
        estado: { setNumero: 3, puntos: { A: 0, B: 0 }, sets: { A: 2, B: 0 }, historial: [], terminado: true, winner: "A" }
      })
    );

    // Un partido terminado ya se publicó: ofrecerle «Poner en directo» otra
    // vez repetiría el error que esto existe para evitar, y el servidor lo
    // rechazaría con un aviso distinto («ya ha terminado»).
    expect($("[data-anot-fuera]").hidden).toBe(true);
    expect($("[data-anot-pista]").hidden).toBe(false);
  });

  describe("el diálogo de confirmación", () => {
    it("el botón de confirmar arranca apagado y muestra el cruce", async () => {
      await montar(programado());

      $("[data-anot-poner-directo]").click();

      expect(($("[data-anot-dialogo-directo]") as HTMLDialogElement).showModal).toHaveBeenCalled();
      expect(($("[data-anot-directo-confirmar]") as HTMLButtonElement).disabled).toBe(true);
      expect($("[data-anot-directo-cruce]").textContent).toBe("Areeiros — Os Pulpos Bravos");
    });

    it("marcar la casilla enciende el botón, y se resetea cada vez que se abre", async () => {
      await montar(programado());

      $("[data-anot-poner-directo]").click();
      const acepto = $("[data-anot-directo-acepto]") as HTMLInputElement;
      acepto.checked = true;
      acepto.dispatchEvent(new Event("change"));

      expect(($("[data-anot-directo-confirmar]") as HTMLButtonElement).disabled).toBe(false);

      // Reabrir sin haber confirmado: la casilla no debe seguir marcada.
      $("[data-anot-directo-cancelar]").click();
      $("[data-anot-poner-directo]").click();

      expect(acepto.checked).toBe(false);
      expect(($("[data-anot-directo-confirmar]") as HTMLButtonElement).disabled).toBe(true);
    });

    it("confirmar publica el partido y cierra el diálogo", async () => {
      await montar(programado());

      $("[data-anot-poner-directo]").click();
      const acepto = $("[data-anot-directo-acepto]") as HTMLInputElement;
      acepto.checked = true;
      acepto.dispatchEvent(new Event("change"));
      $("[data-anot-directo-confirmar]").click();
      await respirar();

      expect(peticiones.at(-1)!.cuerpo).toEqual({ accion: "directo" });
      expect(($("[data-anot-dialogo-directo]") as HTMLDialogElement).close).toHaveBeenCalled();
    });

    it("cancelar no manda nada", async () => {
      await montar(programado());

      $("[data-anot-poner-directo]").click();
      $("[data-anot-directo-cancelar]").click();

      expect(peticiones.filter((p) => p.cuerpo)).toHaveLength(0);
      expect(($("[data-anot-dialogo-directo]") as HTMLDialogElement).close).toHaveBeenCalled();
    });
  });
});
