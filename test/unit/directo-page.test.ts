// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cargarScriptPublico, ejecutarScriptPublico } from "../helpers/dom";

/*
 * La página del directo: el versus y el historial.
 *
 * Lo que se fija aquí es el presupuesto, que es lo que puede tumbar el sitio el
 * día del torneo:
 *
 *   - `/api/plantilla` se pide **una vez por partido**, no en cada sondeo. Ahí
 *     están los nombres y las fotos; repetirlos cien veces por minuto es
 *     exactamente lo que el diseño de dos endpoints evita.
 *   - El historial **no se reconstruye**: las líneas se reconcilian por clave, y
 *     los retratos se crean una vez y se mueven. Si se recrearan, cada sondeo
 *     revalidaría dieciséis imágenes.
 *
 * Y lo otro que se fija es el trato a quien pidió no salir en el álbum: sale por
 * su dorsal y sin nombre.
 *
 * El marcado es copia a mano de src/pages/directo.astro, como el resto de los
 * tests de scripts públicos: si allí cambian los `data-*`, este test sigue en
 * verde y es producción la que se queda muda.
 */

const MARCADO = `
  <main data-directo-pagina>
    <p data-directo-estado></p>
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
          <p><span data-versus-detalle></span><span data-versus-reloj hidden></span></p>
          <p data-versus-parciales hidden></p>
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
    </section>
    <section data-feed hidden>
      <details data-feed-plegable>
        <summary data-feed-titulo></summary>
        <ol data-feed-lista></ol>
        <p data-feed-mas hidden></p>
      </details>
    </section>
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
    { clave: "error_no_forzado", etiqueta: "Error" },
    { clave: "bloqueo", etiqueta: "Bloqueo" },
    { clave: "chilena", etiqueta: "Chilena" }
  ]
};

const estadoBase = (extra: Record<string, unknown> = {}) => ({
  hayDirecto: true,
  partidos: [
    {
      id: "p1",
      ronda: "Semifinal 1",
      status: "live",
      setNumber: 1,
      points: { A: 2, B: 1 },
      sets: { A: 0, B: 0 },
      history: [] as { a: number; b: number }[],
      reglas: { sets: 2, puntosPorSet: 21, puntosSetDecisivo: 15, diferencia: 2 },
      teams: { A: { id: 1, name: "Delfines" }, B: { id: 2, name: "Gaviotas" } }
    }
  ],
  enPista: { A: [1, 2], B: [4, 5] },
  feed: [
    { o: 0, t: "punto", j: 1, l: "A", p: "A", s: 1 },
    { o: 1, t: "punto", j: 4, l: "B", p: "B", s: 1 },
    { o: 2, t: "ace", j: 2, l: "A", p: "A", s: 1 }
  ],
  feedTotal: 3,
  siguiente: null,
  siguienteSondeoMs: 3000,
  modoAhorro: false,
  ...extra
});

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const todos = (sel: string) => [...document.querySelectorAll(sel)] as HTMLElement[];
const respirar = () => new Promise((r) => setTimeout(r, 0));

let pintar: ((estado: unknown, info?: unknown) => Promise<void>) | null = null;
let peticiones: string[] = [];

/** Lo que contesta el fetch simulado. Los tests que tiran la red lo cambian. */
let responder: (url: string) => Promise<Response>;

async function montar(plantilla: unknown = PLANTILLA) {
  document.body.innerHTML = MARCADO;
  peticiones = [];
  pintar = null;
  responder = async () => new Response(JSON.stringify(plantilla), { status: 200 });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      peticiones.push(url);
      return await responder(url);
    })
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  // jsdom no implementa matchMedia. Aquí se responde como un móvil: sin
  // `prefers-reduced-motion` y por debajo del corte de escritorio.
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    addEventListener() {},
    removeEventListener() {}
  }));

  (window as unknown as Record<string, unknown>).CopaDirecto = {
    suscribir: (fn: (estado: unknown, info?: unknown) => Promise<void>) => {
      pintar = fn;
    },
    mirandoDeCerca: vi.fn(),
    refrescarAhora: vi.fn()
  };

  // El orden de la página: match-utils y cromo antes que el script propio.
  cargarScriptPublico("match-utils.js", "CopaArenaMatches");
  cargarScriptPublico("cromo.js", "CopaCromo");
  ejecutarScriptPublico("directo-page.js");
}

/** Un sondeo: llama al pintado y espera a que resuelva la plantilla. */
const sondeo = async (estado: unknown, info: unknown = { cerroAlguno: false, primeraVez: false }) => {
  await pintar!(estado, info);
  await respirar();
};

/** Qué nodos se han animado, y con qué fotogramas. jsdom no trae `animate`. */
let animados: { nodo: Element; fotogramas: Record<string, string>[] }[] = [];

beforeEach(() => {
  animados = [];
  (Element.prototype as unknown as { animate: unknown }).animate = function (
    this: Element,
    fotogramas: Record<string, string>[]
  ) {
    animados.push({ nodo: this, fotogramas });
    return { cancel: () => {} };
  };
  (Element.prototype as unknown as { getAnimations: unknown }).getAnimations = () => [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("la plantilla se pide una vez", () => {
  it("no la repite aunque lleguen cinco sondeos", async () => {
    await montar();
    for (let i = 0; i < 5; i++) await sondeo(estadoBase());

    expect(peticiones.filter((url) => url.includes("/api/plantilla"))).toHaveLength(1);
    expect(peticiones[0]).toBe("/api/plantilla?partido=p1");
  });

  /*
   * Y sobre todo: no la repite cuando FALLA. El guardia («ya la tengo de este
   * partido») solo se ponía al recibirla bien, así que un 500 —o la propia
   * ausencia de red— hacía que cada sondeo pidiera dos cosas en vez de una:
   * justo el día que algo va mal, el gasto de cada espectador se dobla. Con
   * ~100 espectadores sondeando seis horas, ese factor dos es la diferencia
   * entre caber en el plan gratuito y no caber.
   */
  it("no la reintenta en cada sondeo cuando el servidor falla", async () => {
    await montar();
    responder = async () => new Response("vaya", { status: 500 });

    for (let i = 0; i < 6; i++) await sondeo(estadoBase());

    expect(peticiones.filter((url) => url.includes("/api/plantilla")).length).toBeLessThanOrEqual(2);
  });

  it("ni cuando no hay red", async () => {
    await montar();
    responder = async () => {
      throw new TypeError("Failed to fetch");
    };

    for (let i = 0; i < 6; i++) await sondeo(estadoBase());

    expect(peticiones.filter((url) => url.includes("/api/plantilla")).length).toBeLessThanOrEqual(2);
  });

  it("la vuelve a pedir si cambia el partido", async () => {
    await montar();
    await sondeo(estadoBase());

    const otro = estadoBase();
    otro.partidos[0]!.id = "p2";
    await sondeo(otro);

    expect(peticiones.filter((url) => url.includes("/api/plantilla"))).toHaveLength(2);
  });
});

describe("el versus", () => {
  it("pinta a quien juega en grande y al banquillo en pequeño", async () => {
    await montar();
    await sondeo(estadoBase());

    const enPista = todos("[data-versus-pista-a] .retrato");
    expect(enPista).toHaveLength(2);
    expect(enPista.every((nodo) => nodo.className.includes("retrato--grande"))).toBe(true);

    const banquillo = todos("[data-versus-suplentes-a] .retrato");
    expect(banquillo).toHaveLength(1);
    expect(banquillo[0]!.className).toContain("retrato--pequeno");
    expect($("[data-versus-banquillo-a-titulo]").textContent).toBe("Banquillo (1)");
  });

  /*
   * Quién es titular lo dice la alineación del partido, no `esSuplente` de la
   * inscripción: en cuanto entra un suplente, ese suplente está jugando.
   */
  it("manda la alineación, no quién se inscribió como suplente", async () => {
    await montar();
    const estado = estadoBase();
    estado.enPista = { A: [1, 3], B: [4, 5] };
    await sondeo(estado);

    const nombres = todos("[data-versus-pista-a] .retrato-nombre").map((n) => n.textContent);
    expect(nombres).toEqual(["Ana", "Celia"]);
  });

  it("el marcador y el objetivo del set salen del partido", async () => {
    await montar();
    const estado = estadoBase();
    estado.partidos[0]!.setNumber = 3;
    estado.partidos[0]!.sets = { A: 1, B: 1 };
    estado.partidos[0]!.history = [{ a: 21, b: 18 }, { a: 19, b: 21 }];
    await sondeo(estado);

    expect($("[data-versus-puntos-a]").textContent).toBe("2");
    // El tercer set es el corto: 15, no 21.
    expect($("[data-versus-detalle]").textContent).toContain("a 15");
    expect($("[data-versus-parciales]").textContent).toBe("21–18 · 19–21");
  });

  it("quien no sale en el álbum aparece por su dorsal y sin nombre", async () => {
    const plantilla = structuredClone(PLANTILLA);
    plantilla.equipos.A.jugadores[1] = jugador(2, "Berta", {
      nombre: null,
      apellidos: null,
      media: null,
      tieneFoto: false,
      oculto: true
    }) as never;
    await montar(plantilla);
    await sondeo(estadoBase());

    const pista = $("[data-versus-pista-a]");
    expect(pista.textContent).not.toContain("Berta");
    expect(pista.querySelectorAll("img")).toHaveLength(1);
    expect(pista.textContent).toContain("2");
  });
});

describe("el historial", () => {
  it("va del más reciente al más antiguo, con el marcador de cada punto", async () => {
    await montar();
    await sondeo(estadoBase());

    const lineas = todos(".feed-linea .feed-que").map((n) => n.textContent);
    expect(lineas).toEqual(["Ace de Berta", "Punto de Carla", "Punto de Ana"]);

    // El marcador se anda hacia atrás desde el actual (2–1).
    const cuando = todos(".feed-linea .feed-cuando").map((n) => n.textContent);
    expect(cuando).toEqual(["2–1", "1–1", "1–0"]);
  });

  it("no reconstruye las líneas que ya estaban", async () => {
    await montar();
    await sondeo(estadoBase());
    const antes = todos(".feed-linea");

    const siguiente = estadoBase();
    siguiente.partidos[0]!.points = { A: 3, B: 1 };
    siguiente.feed = [...estadoBase().feed, { o: 3, t: "bloqueo", j: 1, l: "A", p: "A", s: 1 }];
    siguiente.feedTotal = 4;
    await sondeo(siguiente);

    const despues = todos(".feed-linea");
    expect(despues).toHaveLength(4);
    // Las tres viejas son los MISMOS nodos, y la nueva va arriba.
    expect(despues.slice(1)).toEqual(antes);
    expect(despues[0]!.querySelector(".feed-que")!.textContent).toBe("Bloqueo de Ana");
  });

  it("deshacer un punto quita su línea", async () => {
    await montar();
    await sondeo(estadoBase());
    expect(todos(".feed-linea")).toHaveLength(3);

    const deshecho = estadoBase();
    deshecho.feed = estadoBase().feed.slice(0, 2);
    deshecho.feedTotal = 2;
    deshecho.partidos[0]!.points = { A: 1, B: 1 };
    await sondeo(deshecho);

    expect(todos(".feed-linea")).toHaveLength(2);
    expect(document.body.textContent).not.toContain("Ace de Berta");
  });

  it("un cambio de jugador se lee como un cambio, no como un punto", async () => {
    await montar();
    const estado = estadoBase();
    estado.feed = [
      { o: 0, t: "punto", j: 1, l: "A", p: "A", s: 1 },
      { o: 0, c: 4, t: "cambio", j: 3, x: 2, l: "A", s: 1 } as never
    ];
    await sondeo(estado);

    const linea = todos(".feed-linea")[0]!;
    expect(linea.className).toContain("feed-linea--cambio");
    expect(linea.querySelector(".feed-que")!.textContent).toBe("Entra Celia por Berta");
  });

  it("dice cuántos puntos quedan fuera de la ventana", async () => {
    await montar();
    const estado = estadoBase();
    estado.feedTotal = 48;
    await sondeo(estado);

    expect($("[data-feed-mas]").hidden).toBe(false);
    expect($("[data-feed-mas]").textContent).toBe("Y 45 puntos más antes de esto.");
  });
});

/*
 * Los sets mandan y los puntos del set van debajo. Antes los sets solo salían
 * dentro de la línea pequeña de detalle, que es donde menos se ven — y son el
 * dato que dice quién va ganando el partido.
 */
describe("el marcador", () => {
  it("pinta los sets y los puntos en huecos distintos", async () => {
    await montar();
    const estado = estadoBase();
    estado.partidos[0]!.sets = { A: 1, B: 0 };
    estado.partidos[0]!.points = { A: 18, B: 14 };
    await sondeo(estado);

    expect($("[data-versus-sets-a]").textContent).toBe("1");
    expect($("[data-versus-sets-b]").textContent).toBe("0");
    expect($("[data-versus-puntos-a]").textContent).toBe("18");
    expect($("[data-versus-puntos-b]").textContent).toBe("14");
  });

  /*
   * Y la línea de detalle ya no los repite. Es la línea que tiene que caber a
   * 360px, así que lo que sobra sale.
   */
  it("la línea de detalle deja de repetir los sets", async () => {
    await montar();
    const estado = estadoBase();
    estado.partidos[0]!.sets = { A: 1, B: 0 };
    estado.partidos[0]!.setNumber = 2;
    await sondeo(estado);

    expect($("[data-versus-detalle]").textContent).toBe("Set 2 · a 21");
  });

  /*
   * `MARCADO` es copia a mano del `.astro`, así que sin esto la página podría
   * quedarse sin los huecos de los sets con todo lo de arriba en verde: el
   * marcador se pintaría a medias y nada lo diría.
   */
  it("la página trae los cuatro huecos del marcador", () => {
    const astro = readFileSync(path.resolve(import.meta.dirname, "../../src/pages/directo.astro"), "utf8");

    for (const marca of ["data-versus-sets-a", "data-versus-sets-b", "data-versus-puntos-a", "data-versus-puntos-b"]) {
      expect(astro).toContain(marca);
    }
  });

  /*
   * Y la jerarquía es lo que se pidió: el par de sets, más grande que el de
   * puntos. Invertirla es un retoque de una cifra en la hoja, sin nada que
   * avise.
   */
  it("los sets se pintan más grandes que los puntos del set", () => {
    const css = readFileSync(path.resolve(import.meta.dirname, "../../src/styles/global.css"), "utf8");
    const cuerpo = (selector: string) => {
      const regla = new RegExp(`${selector}\\s*\\{[^}]*font-size:\\s*clamp\\(([^,]+),`).exec(css);
      return parseFloat(regla![1]!);
    };

    expect(cuerpo("\\.versus-sets \\.versus-puntos")).toBeGreaterThan(
      cuerpo("\\.versus-marcador \\.versus-tanteo \\.versus-puntos")
    );
  });
});

describe("la vibración", () => {
  it("sacude el retrato de quien acaba de puntuar, y solo el suyo", async () => {
    await montar();
    await sondeo(estadoBase());

    const nuevo = estadoBase();
    nuevo.feed = [...estadoBase().feed, { o: 3, t: "bloqueo", j: 1, l: "A", p: "A", s: 1 }];
    nuevo.partidos[0]!.points = { A: 3, B: 1 };
    await sondeo(nuevo);

    const retratoAna = todos("[data-versus-pista-a] .retrato").find((n) => n.dataset.jugador === "1")!;
    const retratoBerta = todos("[data-versus-pista-a] .retrato").find((n) => n.dataset.jugador === "2")!;
    expect(animados.map((a) => a.nodo)).toContain(retratoAna);
    expect(animados.map((a) => a.nodo)).not.toContain(retratoBerta);
  });

  it("solo se mueve con transform: nada que obligue a recalcular la página", async () => {
    await montar();
    await sondeo(estadoBase());
    const nuevo = estadoBase();
    nuevo.feed = [...estadoBase().feed, { o: 3, t: "bloqueo", j: 1, l: "A", p: "A", s: 1 }];
    await sondeo(nuevo);

    const { fotogramas } = animados[0]!;
    expect(fotogramas.every((paso) => Object.keys(paso).every((k) => k === "transform" || k === "offset"))).toBe(true);
  });
});

/*
 * Cuál de las dos reacciones toca lo dice el lado del punto, no el tipo: si el
 * punto se lo lleva el lado contrario al de quien hizo la acción, esa persona
 * acaba de regalarlo y la sacudida —que es la de celebrar— decía lo contrario de
 * lo que pasó.
 *
 * Se compara `p` con `l` y NUNCA con `null`. Un `lado_punto` que existe no
 * significa «lo ganó mi lado»: ese atajo ya costó un hallazgo de severidad
 * crítica en el anotador, y aquí volvería a marcar mal a quien no falló.
 */
describe("la marca de fallo", () => {
  const conFeed = (linea: Record<string, unknown>) => {
    const nuevo = estadoBase();
    nuevo.feed = [...estadoBase().feed, linea as (typeof nuevo.feed)[number]];
    return nuevo;
  };

  const retratoDe = (id: string) => todos(".retrato").find((n) => n.dataset.jugador === id)!;

  it("marca a quien comete un error no forzado en vez de sacudirlo", async () => {
    await montar();
    await sondeo(estadoBase());
    await sondeo(conFeed({ o: 3, t: "error_no_forzado", j: 1, l: "A", p: "B", s: 1 }));

    const ana = retratoDe("1");
    expect(ana.querySelector(".retrato-fallo")).not.toBe(null);
    expect(animados.map((a) => a.nodo)).not.toContain(ana);
  });

  it("el saque fallado lleva la misma marca", async () => {
    await montar();
    await sondeo(estadoBase());
    await sondeo(conFeed({ o: 3, t: "saque_fallado", j: 2, l: "A", p: "B", s: 1 }));

    expect(retratoDe("2").querySelector(".retrato-fallo")).not.toBe(null);
  });

  /*
   * Un bloqueo que solo levantó la pelota no lleva `p`. No es un fallo: la
   * acción ocurrió y el rally siguió, así que se sacude como siempre.
   */
  it("una acción sin punto se sacude, no se marca", async () => {
    await montar();
    await sondeo(estadoBase());
    await sondeo(conFeed({ o: 3, t: "bloqueo", j: 1, l: "A", p: null, s: 1 }));

    const ana = retratoDe("1");
    expect(ana.querySelector(".retrato-fallo")).toBe(null);
    expect(animados.map((a) => a.nodo)).toContain(ana);
  });

  it("un punto propio se sacude aunque `p` no sea nulo", async () => {
    await montar();
    await sondeo(estadoBase());
    await sondeo(conFeed({ o: 3, t: "punto", j: 1, l: "A", p: "A", s: 1 }));

    const ana = retratoDe("1");
    expect(ana.querySelector(".retrato-fallo")).toBe(null);
    expect(animados.map((a) => a.nodo)).toContain(ana);
  });

  it("el historial escribe la etiqueta del error", async () => {
    await montar();
    await sondeo(conFeed({ o: 3, t: "error_no_forzado", j: 1, l: "A", p: "B", s: 1 }));

    const lineas = todos("[data-feed-lista] li").map((li) => li.querySelector(".feed-que")!.textContent);
    expect(lineas).toContain("Error de Ana");
  });
});

describe("sin partido", () => {
  it("lo dice, y nombra al siguiente si lo hay", async () => {
    await montar();
    await sondeo({
      hayDirecto: false,
      partidos: [],
      enPista: null,
      feed: [],
      feedTotal: 0,
      siguiente: { ronda: "Final", equipos: ["Delfines", "Gaviotas"] }
    });

    expect($("[data-versus]").hidden).toBe(true);
    expect($("[data-directo-estado]").textContent).toContain("Delfines contra Gaviotas");
  });

  /*
   * Un partido que acaba de terminar no se borra de la pantalla en el momento
   * más visto del día: se queda con su resultado y un rótulo.
   */
  it("al terminar deja el resultado en pantalla", async () => {
    await montar();
    await sondeo(estadoBase());
    await sondeo({ hayDirecto: false, partidos: [], enPista: null, feed: [], feedTotal: 0 }, { cerroAlguno: true });

    expect($("[data-versus]").hidden).toBe(false);
    expect($("[data-versus-puntos-a]").textContent).toBe("2");
    expect($("[data-directo-estado]").textContent).toBe("Final");
  });
});

describe("el chip de la cabecera", () => {
  it("lleva a /directo/", () => {
    const header = readFileSync(
      path.resolve(import.meta.dirname, "../../src/components/SiteHeader.astro"),
      "utf8"
    );
    expect(header).toContain('href="/directo/" data-directo-vivo');
  });
});

/*
 * El reloj corre en el cliente desde `startedAt`, sin pedirle nada más al
 * servidor. Va con su propio intervalo y no con el sondeo: entre dos sondeos
 * pasan tres segundos como poco —sesenta si no hay nadie jugando—, y un reloj
 * que salta de tres en tres se lee como estropeado.
 */
describe("el reloj del partido", () => {
  it("no se pinta si el partido no tiene hora de inicio", async () => {
    await montar();
    await sondeo(estadoBase());
    expect($("[data-versus-reloj]").hidden).toBe(true);
  });

  it("cuenta desde la hora de inicio", async () => {
    await montar();
    const base = estadoBase();
    (base.partidos[0] as Record<string, unknown>).startedAt = new Date(Date.now() - 125_000).toISOString();

    await sondeo(base);

    const reloj = $("[data-versus-reloj]");
    expect(reloj.hidden).toBe(false);
    expect(reloj.textContent).toMatch(/02:0\d$/);
  });

  /*
   * El cronómetro del anotador pone `startedAt` a `null` al PAUSAR, no solo
   * antes de empezar — con `Boolean(startedAt)` a secas el reloj público
   * desaparecía en cada pausa en vez de quedarse quieto en lo acumulado.
   * `elapsedMs` es lo que distingue «en pausa con algo acumulado» de «nunca
   * estrenado», y por eso viaja en `/api/directo` además de `startedAt`.
   */
  it("en pausa se queda quieto en lo acumulado, no desaparece", async () => {
    await montar();
    const base = estadoBase();
    (base.partidos[0] as Record<string, unknown>).startedAt = null;
    (base.partidos[0] as Record<string, unknown>).elapsedMs = 90_000;

    await sondeo(base);

    const reloj = $("[data-versus-reloj]");
    expect(reloj.hidden).toBe(false);
    expect(reloj.textContent).toBe(" · 01:30");
  });

  it("el reloj lleva cifras de ancho fijo", () => {
    const css = readFileSync(path.resolve(import.meta.dirname, "../../src/styles/global.css"), "utf8");
    expect(css).toMatch(/\.versus-reloj\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  });
});
