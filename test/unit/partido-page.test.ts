// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cargarScriptPublico, ejecutarScriptPublico } from "../helpers/dom";

/*
 * /torneo/partido/ — cómo fue un partido, punto a punto.
 *
 * Lo que se fija aquí es lo que separa esta pantalla del directo:
 *
 *   - **No sondea.** Dos peticiones, una sola vez cada una. Un partido terminado
 *     no cambia, y esta página existe para lo que ya pasó.
 *   - **La barra no vuelve a plegar nada.** Cada línea llega del servidor con el
 *     marcador que dejó; moverse por el partido es leer una posición de un array.
 *     Contar puntos aquí sería una segunda versión de las reglas del juego.
 *   - **La pista retrocede con la barra**, deshaciendo los cambios por su hueco.
 *
 * Y lo de siempre: quien pidió no salir del álbum sale por su dorsal, tanto en la
 * cronología como en el resumen.
 *
 * El marcado es copia a mano de `src/pages/torneo/partido.astro` y de
 * `src/components/Versus.astro`, como el resto de los tests de scripts públicos:
 * si allí cambian los `data-*`, este test sigue en verde y es producción la que
 * se queda muda. De ahí el test que lee los dos ficheros.
 */

const MARCADO = `
  <main data-partido-pagina>
    <p data-partido-estado></p>
    <section data-partido-cabecera hidden>
      <p data-partido-fase></p>
      <h1 data-partido-titulo></h1>
      <p data-partido-cuando></p>
      <p data-partido-vivo hidden></p>
    </section>
    <section data-versus hidden>
      <p data-versus-ronda></p>
      <div>
        <div data-versus-lado="A">
          <p data-versus-nombre-a></p>
          <div data-versus-pista-a></div>
          <details data-versus-banquillo-a hidden>
            <summary data-versus-banquillo-a-titulo></summary>
            <div data-versus-suplentes-a></div>
          </details>
        </div>
        <div>
          <span data-versus-sets-a>0</span>
          <span data-versus-sets-b>0</span>
          <span data-versus-puntos-a>0</span>
          <span data-versus-puntos-b>0</span>
        </div>
        <div data-versus-lado="B">
          <p data-versus-nombre-b></p>
          <div data-versus-pista-b></div>
          <details data-versus-banquillo-b hidden>
            <summary data-versus-banquillo-b-titulo></summary>
            <div data-versus-suplentes-b></div>
          </details>
        </div>
      </div>
      <p><span data-versus-detalle></span></p>
      <p data-versus-parciales hidden></p>
    </section>
    <div data-repaso hidden>
      <p><span data-repaso-marcador></span><span data-repaso-que></span></p>
      <div>
        <div data-repaso-carril></div>
        <input type="range" data-repaso-barra min="0" max="0" value="0" step="1" />
      </div>
      <p>
        <button type="button" data-repaso-inicio></button>
        <button type="button" data-repaso-final></button>
      </p>
    </div>
    <section data-feed hidden><h2 class="feed-titulo"></h2><div data-feed-sets></div></section>
    <section data-resumen hidden><table data-resumen-tabla></table></section>
  </main>
`;

const jugador = (id: number, nombre: string, extra: Record<string, unknown> = {}) => ({
  id,
  nombre,
  apellidos: "Souto",
  dorsal: id,
  nivel: "oro",
  media: 70,
  tieneFoto: true,
  esSuplente: false,
  oculto: false,
  ...extra
});

const PLANTILLA = {
  partido: { id: "p1", ronda: "Semifinal 1", pista: "Pista 1" },
  equipos: {
    A: { id: 1, nombre: "Delfines", jugadores: [jugador(1, "Ana"), jugador(2, "Berta"), jugador(3, "Celia")] },
    B: { id: 2, nombre: "Gaviotas", jugadores: [jugador(4, "Carla"), jugador(5, "Diana")] }
  },
  tipos: [
    { clave: "punto", etiqueta: "Punto" },
    { clave: "ace", etiqueta: "Ace" },
    { clave: "saque_fallado", etiqueta: "Falló saque" },
    { clave: "bloqueo", etiqueta: "Bloqueo" }
  ]
};

/*
 * Un partido de dos sets con un cambio por medio. El set 1 se cierra con el
 * segundo punto (a 2, con el `reglas` que lleva), y el cambio cuelga del último
 * punto del set 2.
 */
const HISTORIAL = {
  partido: {
    id: "p1",
    ronda: "Semifinal 1",
    pista: "Pista 1",
    status: "finished",
    scheduledAt: "2026-08-01T18:30:00.000Z",
    startedAt: null,
    elapsedMs: 0,
    setNumber: 3,
    points: { A: 0, B: 0 },
    sets: { A: 2, B: 0 },
    history: [
      { a: 5, b: 3 },
      { a: 5, b: 1 }
    ],
    winner: "A",
    reglas: { sets: 2, puntosPorSet: 5, puntosSetDecisivo: 5, diferencia: 1 },
    teams: { A: { id: 1, name: "Delfines" }, B: { id: 2, name: "Gaviotas" } }
  },
  lineas: [
    { o: 0, t: "punto", j: 1, l: "A", p: "A", s: 1, a: 1, b: 0, sa: 0, sb: 0 },
    { o: 1, t: "ace", j: 2, l: "A", p: "A", s: 1, a: 5, b: 3, sa: 1, sb: 0 },
    { o: 2, t: "punto", j: 4, l: "B", p: "B", s: 2, a: 0, b: 1, sa: 1, sb: 0 },
    { o: 2, c: 9, t: "cambio", j: 3, x: 2, l: "A", s: 2, a: 0, b: 1, sa: 1, sb: 0, pos: 1 },
    { o: 3, t: "punto", j: 3, l: "A", p: "A", s: 2, a: 5, b: 1, sa: 2, sb: 0 }
  ],
  // Berta (2) salió y entró Celia (3) por el hueco 1.
  enPistaFinal: { A: [1, 3], B: [4, 5] },
  huecos: { A: [0, 1], B: [0, 1] },
  totales: [
    { jugadorId: 1, puntos: 1, bloqueos: 0, chilenas: 0, aces: 0, saquesFallados: 0, errores: 0 },
    { jugadorId: 2, puntos: 1, bloqueos: 0, chilenas: 0, aces: 1, saquesFallados: 0, errores: 0 },
    { jugadorId: 3, puntos: 1, bloqueos: 0, chilenas: 0, aces: 0, saquesFallados: 0, errores: 0 },
    { jugadorId: 4, puntos: 1, bloqueos: 0, chilenas: 0, aces: 0, saquesFallados: 0, errores: 0 }
  ],
  metricas: [
    { clave: "puntos", etiqueta: "Puntos" },
    { clave: "bloqueos", etiqueta: "Bloqueos" },
    { clave: "chilenas", etiqueta: "Chilenas" },
    { clave: "aces", etiqueta: "Aces" },
    { clave: "saquesFallados", etiqueta: "Saques fallados" },
    { clave: "errores", etiqueta: "Errores no forzados" }
  ]
};

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const todos = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const respirar = () => new Promise((r) => setTimeout(r, 0));
const clonar = <T,>(valor: T): T => JSON.parse(JSON.stringify(valor));

let peticiones: string[] = [];

async function montar(historial: unknown = HISTORIAL, plantilla: unknown = PLANTILLA) {
  document.body.innerHTML = MARCADO;
  peticiones = [];
  location.hash = "";
  history.replaceState(null, "", "/torneo/partido/?p=p1");

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      peticiones.push(url);
      const cuerpo = url.startsWith("/api/historial") ? historial : plantilla;
      if (cuerpo === null) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify(cuerpo), { status: 200 });
    })
  );
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    addEventListener() {},
    removeEventListener() {}
  }));

  cargarScriptPublico("match-utils.js", "CopaArenaMatches");
  cargarScriptPublico("cromo.js", "CopaCromo");
  cargarScriptPublico("partido-vista.js", "CopaPartidoVista");
  ejecutarScriptPublico("partido-page.js");
  await respirar();
  await respirar();
}

/** Mueve la barra como lo haría un dedo. */
function mover(valor: number) {
  const barra = $("[data-repaso-barra]") as HTMLInputElement;
  barra.value = String(valor);
  barra.dispatchEvent(new Event("input"));
}

beforeEach(() => {
  (Element.prototype as unknown as { animate: unknown }).animate = () => ({ cancel: () => {} });
  (Element.prototype as unknown as { getAnimations: unknown }).getAnimations = () => [];
});

describe("el presupuesto de la página", () => {
  /*
   * Ésta es la diferencia con `/directo/`, y por eso es el primer test: aquí no
   * hay sondeo. Un partido terminado no cambia, así que cada petición de más
   * sería gasto puro contra la cuota del plan gratuito.
   */
  it("pide el historial y la plantilla una vez cada uno, y nada más", async () => {
    await montar();

    expect(peticiones.filter((url) => url.startsWith("/api/historial"))).toHaveLength(1);
    expect(peticiones.filter((url) => url.startsWith("/api/plantilla"))).toHaveLength(1);
    expect(peticiones).toHaveLength(2);

    // Y moverse por el partido tampoco pide nada: todo llegó en esas dos.
    mover(0);
    mover(3);
    await respirar();
    expect(peticiones).toHaveLength(2);
  });

  it("sin partido en la URL no pide nada y dice qué hacer", async () => {
    document.body.innerHTML = MARCADO;
    peticiones = [];
    history.replaceState(null, "", "/torneo/partido/");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        peticiones.push(url);
        return new Response("{}", { status: 200 });
      })
    );
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));

    cargarScriptPublico("match-utils.js", "CopaArenaMatches");
    cargarScriptPublico("cromo.js", "CopaCromo");
    cargarScriptPublico("partido-vista.js", "CopaPartidoVista");
    ejecutarScriptPublico("partido-page.js");
    await respirar();

    expect(peticiones).toHaveLength(0);
    expect($("[data-partido-estado]").textContent).toBe("Elige un partido en el cuadro.");
  });

  it("un partido que no existe lo dice y no pinta la pista", async () => {
    await montar(null);

    expect($("[data-partido-estado]").textContent).toBe("Ese partido no existe.");
    expect($("[data-versus]").hidden).toBe(true);
  });
});

describe("la cronología", () => {
  it("va de arriba abajo en orden y parte por sets, con su parcial", async () => {
    await montar();

    const cabeceras = todos("[data-feed-sets] .feed-set");
    expect(cabeceras.map((nodo) => nodo.textContent)).toEqual(["Set 15–3", "Set 25–1"]);

    const lineas = todos("[data-feed-sets] .feed-linea .feed-que");
    expect(lineas.map((nodo) => nodo.textContent)).toEqual([
      "Punto de Ana",
      "Ace de Berta",
      "Punto de Carla",
      "Entra Celia por Berta",
      "Punto de Celia"
    ]);
  });

  /*
   * El marcador de cada línea es el que dejó, en su set. En el directo esa cifra
   * sólo existe para el set en curso, porque allí se anda hacia atrás desde el
   * marcador actual; aquí la calcula el servidor con el log entero.
   */
  it("cada línea lleva el marcador que dejó, también en los sets ya cerrados", async () => {
    await montar();

    const cuandos = todos("[data-feed-sets] .feed-linea .feed-cuando");
    expect(cuandos.map((nodo) => nodo.textContent)).toEqual(["1–0", "5–3", "0–1", "0–1", "5–1"]);
  });
});

describe("la barra de avance", () => {
  it("arranca al final del partido", async () => {
    await montar();

    expect(($("[data-repaso-barra]") as HTMLInputElement).value).toBe("5");
    expect($("[data-versus-sets-a]").textContent).toBe("2");
    expect($("[data-versus-sets-b]").textContent).toBe("0");
    expect($("[data-versus-puntos-a]").textContent).toBe("5");
    expect($("[data-versus-puntos-b]").textContent).toBe("1");
  });

  it("lleva el marcador al momento que se le pida, sin recalcular nada", async () => {
    await montar();

    mover(1);
    expect($("[data-versus-puntos-a]").textContent).toBe("1");
    expect($("[data-versus-puntos-b]").textContent).toBe("0");
    expect($("[data-versus-sets-a]").textContent).toBe("0");
    expect($("[data-versus-detalle]").textContent).toBe("Set 1 · a 5");

    mover(0);
    expect($("[data-versus-puntos-a]").textContent).toBe("0");
    expect($("[data-repaso-que]").textContent).toBe("Antes del primer punto");
  });

  /*
   * Los parciales son los de los sets cerrados HASTA ese momento, no los del
   * partido entero: enseñar el 5–1 del segundo set mientras la barra está en el
   * primero sería contar el final antes de tiempo.
   */
  it("los parciales crecen con la barra", async () => {
    await montar();

    mover(1);
    expect($("[data-versus-parciales]").hidden).toBe(true);

    mover(2);
    expect($("[data-versus-parciales]").textContent).toBe("5–3");

    mover(5);
    expect($("[data-versus-parciales]").textContent).toBe("5–3 · 5–1");
  });

  it("marca la línea del momento y atenúa lo que aún no había pasado", async () => {
    await montar();

    mover(2);
    const lineas = todos("[data-feed-sets] .feed-linea");
    expect(lineas[1]!.classList.contains("is-ahora")).toBe(true);
    expect(lineas[0]!.classList.contains("is-futuro")).toBe(false);
    expect(lineas[2]!.classList.contains("is-futuro")).toBe(true);
  });

  it("el carril lleva un tramo por set", async () => {
    await montar();

    const tramos = todos("[data-repaso-carril] .repaso-tramo");
    expect(tramos).toHaveLength(2);
    // Dos líneas del set 1 y tres del 2, sobre cinco.
    expect(tramos[0]!.style.width).toBe("40%");
    expect(tramos[1]!.style.width).toBe("60%");
  });

  it("dice dónde está para quien no ve la pantalla", async () => {
    await montar();

    mover(2);
    expect($("[data-repaso-barra]").getAttribute("aria-valuetext")).toBe("Ace de Berta, 5–3");
  });
});

describe("la pista", () => {
  /*
   * La alineación se reconstruye desde la FINAL hacia atrás, deshaciendo cada
   * cambio posterior al momento. Sin esto, la pista enseñaría durante todo el
   * partido a quien entró en el último set.
   */
  it("retrocede con la barra: antes del cambio juega quien jugaba", async () => {
    await montar();

    const enPista = () =>
      todos("[data-versus-pista-a] [data-jugador]").map((nodo) => nodo.dataset.jugador);

    expect(enPista()).toEqual(["1", "3"]);

    mover(0);
    expect(enPista()).toEqual(["1", "2"]);

    mover(5);
    expect(enPista()).toEqual(["1", "3"]);
  });

  /*
   * `fijarAlineacion` sobrescribe la alineación entera y no borra los cambios,
   * así que un cambio puede referirse a alguien que ya no ocupa ese hueco.
   * Degradar es mejor que inventarse una pista.
   */
  it("si un cambio no cuadra con el hueco, se queda con la alineación que hay", async () => {
    const raro = clonar(HISTORIAL);
    raro.lineas[3]!.pos = 7;
    await montar(raro);

    mover(0);
    expect(todos("[data-versus-pista-a] [data-jugador]").map((nodo) => nodo.dataset.jugador)).toEqual([
      "1",
      "3"
    ]);
  });
});

describe("el resumen por jugador", () => {
  it("lleva una fila por jugador con algo que contar, ordenada por puntos", async () => {
    await montar();

    const filas = todos("[data-resumen-tabla] tbody tr");
    expect(filas).toHaveLength(4);
    expect(todos("[data-resumen-tabla] thead th").map((nodo) => nodo.textContent)).toEqual([
      "Jugador",
      "Puntos",
      "Bloqueos",
      "Chilenas",
      "Aces",
      "Saques fallados",
      "Errores no forzados"
    ]);
  });

  it("el filo de cada fila dice de qué equipo es", async () => {
    await montar();

    const filas = todos("[data-resumen-tabla] tbody tr");
    const carla = filas.find((fila) => fila.textContent?.startsWith("Carla"))!;
    expect(carla.classList.contains("is-lado-b")).toBe(true);
  });

  it("quien no hizo nada en este partido no sale", async () => {
    const sinCarla = clonar(HISTORIAL);
    sinCarla.totales[3]!.puntos = 0;
    await montar(sinCarla);

    const filas = todos("[data-resumen-tabla] tbody tr");
    expect(filas.map((fila) => fila.textContent?.startsWith("Carla"))).not.toContain(true);
  });
});

describe("quien pidió no salir del álbum", () => {
  it("sale por su dorsal en la cronología y en el resumen", async () => {
    const plantilla = clonar(PLANTILLA);
    plantilla.equipos.A.jugadores[1] = jugador(2, "Berta", { nombre: null, apellidos: null, oculto: true });
    await montar(HISTORIAL, plantilla);

    const lineas = todos("[data-feed-sets] .feed-linea .feed-que").map((nodo) => nodo.textContent);
    expect(lineas).toContain("Ace de el 2");
    expect(lineas).toContain("Entra Celia por el 2");

    const filas = todos("[data-resumen-tabla] tbody tr").map((fila) => fila.textContent);
    expect(filas.some((texto) => texto?.startsWith("el 2"))).toBe(true);
    expect(document.body.innerHTML).not.toContain("Berta");
  });
});

describe("un partido sin log", () => {
  /*
   * Un partido llevado a mano desde el panel no tiene nada que recorrer. Lo
   * honesto es decirlo y enseñar el resultado que sí hay, no una barra vacía.
   */
  it("dice que no se anotó y enseña el resultado plano", async () => {
    const aMano = clonar(HISTORIAL);
    aMano.lineas = [];
    aMano.totales = [];
    aMano.partido.points = { A: 0, B: 0 };
    await montar(aMano);

    expect($("[data-partido-estado]").textContent).toBe("Este partido no se anotó punto a punto.");
    expect($("[data-repaso]").hidden).toBe(true);
    expect($("[data-versus-sets-a]").textContent).toBe("2");
    expect($("[data-versus-parciales]").textContent).toBe("5–3 · 5–1");
    expect($("[data-resumen]").hidden).toBe(true);
  });
});

describe("un partido que sigue en juego", () => {
  it("ofrece el directo, que es lo que sí se actualiza solo", async () => {
    const jugando = clonar(HISTORIAL);
    jugando.partido.status = "live";
    await montar(jugando);

    expect($("[data-partido-vivo]").hidden).toBe(false);
  });
});

/*
 * Los `defer` se ejecutan en orden de documento. `partido-vista.js` monta la
 * pista con `CopaCromo`, y `partido-page.js` lee los dos: puestos al revés, la
 * página se queda sin retratos en silencio. Es el mismo cerrojo que
 * `anotador-partido.test.ts` puso sobre `match-utils.js`.
 */
describe("el marcado y el orden de los scripts", () => {
  const astro = readFileSync(
    path.resolve(import.meta.dirname, "../../src/pages/torneo/partido.astro"),
    "utf8"
  );

  it("carga cromo y partido-vista antes que el script de la página", () => {
    const posicion = (fichero: string) => astro.indexOf(`/assets/${fichero}`);

    expect(posicion("cromo.js")).toBeGreaterThan(-1);
    expect(posicion("partido-vista.js")).toBeGreaterThan(posicion("cromo.js"));
    expect(posicion("partido-page.js")).toBeGreaterThan(posicion("partido-vista.js"));
    expect(posicion("match-utils.js")).toBeGreaterThan(-1);
  });

  it("trae los huecos que el script busca", () => {
    const versus = readFileSync(
      path.resolve(import.meta.dirname, "../../src/components/Versus.astro"),
      "utf8"
    );

    for (const marca of ["data-repaso-barra", "data-repaso-carril", "data-feed-sets", "data-resumen-tabla"]) {
      expect(astro).toContain(marca);
    }
    for (const marca of ["data-versus-sets-a", "data-versus-puntos-a", "data-versus-parciales"]) {
      expect(versus).toContain(marca);
    }
    expect(astro).toContain("<Versus />");
  });

  /*
   * La página es `noindex` y no entra en el sitemap: sin `?p` no tiene contenido,
   * así que indexarla sería indexar una página vacía.
   */
  it("no se indexa ni entra en el sitemap", () => {
    const seo = readFileSync(path.resolve(import.meta.dirname, "../../src/data/seo.ts"), "utf8");

    expect(astro).toContain("noindex={true}");
    expect(seo).not.toContain("/torneo/partido/");
  });
});
