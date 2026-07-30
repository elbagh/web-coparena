// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ejecutarScriptPublico } from "../helpers/dom";

/*
 * El álbum público de /jugadores/. Dos cosas que sujeta este test:
 *
 *   1. players-list.js se apoya en window.CopaCromo, el módulo compartido con
 *      «Mi zona». Si el orden de los <script> se rompe, el álbum se queda en
 *      blanco sin decir nada.
 *   2. quien no tiene foto ocupa un hueco del álbum («Sin cromo»), que es la
 *      pieza que da sentido a la rejilla.
 *
 * El marcado replica el de src/pages/jugadores.astro.
 */

const MARCADO = `
  <main data-album>
    <p data-edicion></p>
    <p data-status></p>
    <section data-controles hidden>
      <input data-buscador />
      <p data-cuenta></p>
    </section>
    <p data-vacio hidden></p>
    <div data-rejilla hidden></div>
    <section data-ranking-seccion hidden><div data-ranking></div></section>
    <section data-ficha hidden></section>
    <button type="button" data-retry hidden></button>
  </main>
`;

const estadisticas = (valores: Record<string, number> = {}) => ({
  partidosJugados: 0,
  puntos: 0,
  bloqueos: 0,
  chilenas: 0,
  aces: 0,
  saquesFallados: 0,
  ...valores
});

const jugador = (id: number, nombre: string, extra: Record<string, unknown> = {}) => ({
  id,
  nombre,
  apellidos: "Souto",
  apodo: null,
  dorsal: null,
  posicion: null,
  mano: null,
  lema: null,
  nivel: "bronce",
  media: null,
  instagram: null,
  esSuplente: false,
  tieneFoto: false,
  equipoId: 1,
  equipoNombre: "Os Pulpos",
  estadisticas: estadisticas(),
  ...extra
});

const EDICION = { anio: 2026, nombre: "Copa Arena 2026", estado: "en_juego" };

const respuestaListado = (jugadores: ReturnType<typeof jugador>[]) =>
  new Response(JSON.stringify({ edicion: EDICION, jugadores }), { status: 200 });

async function montar(jugadores: ReturnType<typeof jugador>[]) {
  document.body.innerHTML = MARCADO;
  vi.stubGlobal("fetch", vi.fn(async () => respuestaListado(jugadores)));

  ejecutarScriptPublico("cromo.js");
  ejecutarScriptPublico("players-list.js");
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Monta el álbum y abre la ficha de alguien, como hace ?j=N. */
async function montarFicha(ficha: Record<string, unknown>) {
  document.body.innerHTML = MARCADO;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).includes("id=")
        ? new Response(JSON.stringify(ficha), { status: 200 })
        : respuestaListado([jugador(1, "Marta")])
    )
  );
  window.history.replaceState({}, "", "/jugadores/?j=1");

  ejecutarScriptPublico("cromo.js");
  ejecutarScriptPublico("players-list.js");
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  window.history.replaceState({}, "", "/jugadores/");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("álbum de jugadores", () => {
  it("pinta un cromo por jugador, enlazado a su ficha", async () => {
    await montar([jugador(1, "Marta"), jugador(2, "Xoán")]);

    const cromos = Array.from(document.querySelectorAll(".album-cromo")) as HTMLAnchorElement[];
    expect(cromos).toHaveLength(2);
    expect(cromos[0]!.getAttribute("href")).toBe("/jugadores/?j=1");
    expect(cromos[0]!.textContent).toContain("Marta Souto");
    expect(document.querySelector("[data-cuenta]")!.textContent).toBe("2 jugadores · 0 con cromo");
  });

  it("deja el hueco marcado cuando no hay foto, y la pega cuando la hay", async () => {
    await montar([jugador(1, "Marta"), jugador(2, "Xoán", { tieneFoto: true })]);

    const [sinFoto, conFoto] = Array.from(document.querySelectorAll(".album-cromo-foto")) as HTMLElement[];
    expect(sinFoto!.classList.contains("album-cromo-foto--hueco")).toBe(true);
    expect(sinFoto!.textContent).toContain("Sin cromo");
    expect(sinFoto!.querySelector("img")).toBeNull();

    expect(conFoto!.classList.contains("album-cromo-foto--hueco")).toBe(false);
    expect(conFoto!.querySelector("img")!.getAttribute("src")).toBe("/api/jugadores?foto=2");
  });

  it("el buscador filtra por nombre, apodo o equipo, sin tildes", async () => {
    await montar([
      jugador(1, "Marta", { apodo: "La Muralla", equipoId: 2, equipoNombre: "Areeiros" }),
      jugador(2, "Xoán")
    ]);

    const buscador = document.querySelector("[data-buscador]") as HTMLInputElement;
    const buscar = (termino: string) => {
      buscador.value = termino;
      buscador.dispatchEvent(new Event("input"));
      return Array.from(document.querySelectorAll(".album-cromo")).map((n) => n.textContent);
    };

    expect(buscar("xoan")).toHaveLength(1);
    expect(buscar("xoan")[0]).toContain("Xoán");
    expect(buscar("muralla")[0]).toContain("Marta");

    // Buscar por equipo es lo que sustituye a la fila de burbujas por equipo.
    const porEquipo = buscar("areeiros");
    expect(porEquipo).toHaveLength(1);
    expect(porEquipo[0]).toContain("Marta");
  });

  it("el ranking corona a quien más suma y deja fuera las métricas sin datos", async () => {
    await montar([
      jugador(1, "Marta", { estadisticas: estadisticas({ puntos: 10, aces: 4 }) }),
      jugador(2, "Xoán", { estadisticas: estadisticas({ puntos: 30 }) })
    ]);

    const titulos = Array.from(document.querySelectorAll(".ranking-titulo")).map((n) => n.textContent);
    expect(titulos).toEqual(["Puntos", "Aces"]);

    const primeroDePuntos = document.querySelector(".ranking-card .ranking-fila");
    expect(primeroDePuntos!.textContent).toContain("Xoán");
    expect(primeroDePuntos!.textContent).toContain("30");
  });

  it("sin nadie inscrito invita a inscribirse en vez de dejar la rejilla vacía", async () => {
    await montar([]);

    const vacio = document.querySelector("[data-vacio]") as HTMLElement;
    expect(vacio.hidden).toBe(false);
    expect(vacio.textContent).toContain("Inscribe tu equipo");
    expect((document.querySelector("[data-ranking-seccion]") as HTMLElement).hidden).toBe(true);
  });

  it("el mini-cromo lleva el metal y su remate", async () => {
    await montar([
      jugador(1, "Marta", { nivel: "oro", media: 85, posicion: "Bloqueo" }),
      jugador(2, "Xoán", { nivel: "plata", media: 60 })
    ]);

    const cromos = Array.from(document.querySelectorAll(".album-cromo")) as HTMLElement[];
    expect(cromos[0]!.classList.contains("album-cromo--oro")).toBe(true);
    expect(cromos[1]!.classList.contains("album-cromo--plata")).toBe(true);

    // Cada metal tiene su silueta. El contorno de la carta es común a los tres,
    // así que el que no puede repetirse es el relieve de dentro del arco: es lo
    // único que distingue bronce de oro sin mirar el color.
    const skylines = Array.from(document.querySelectorAll(".cromo-skyline")).map((p) => p.getAttribute("d"));
    expect(skylines).toHaveLength(2);
    expect(skylines[0]).not.toBe(skylines[1]);

    // Y el contorno sí es el mismo, que es lo que hace que sea una colección.
    const filos = Array.from(document.querySelectorAll(".cromo-corona .cromo-filo")).map((p) => p.getAttribute("d"));
    expect(filos).toHaveLength(2);
    expect(filos[0]).toBe(filos[1]);

    // La punta cierra la carta abajo: sin ella el mini se queda en un rectángulo.
    expect(cromos[0]!.querySelector(".cromo-punta")).not.toBeNull();

    expect(cromos[0]!.querySelector(".album-cromo-nota-valor")!.textContent).toBe("85");
    expect(cromos[0]!.querySelector(".album-cromo-nota-pos")!.textContent).toBe("Bloqueo");
  });

  it("sin atributos puntuados el mini-cromo sale sin nota, no con un cero", async () => {
    await montar([jugador(1, "Marta", { media: null })]);

    expect(document.querySelector(".album-cromo-nota-valor")).toBeNull();
    expect(document.querySelector(".album-cromo")!.textContent).not.toContain("0");
  });
});

describe("ficha de un jugador", () => {
  const FICHA = {
    jugador: {
      id: 1,
      nombre: "Marta",
      apellidos: "Souto",
      apodo: "La Muralla",
      dorsal: 7,
      posicion: "Bloqueo",
      mano: "Zurdo",
      lema: "La red es mía",
      nivel: "plata",
      media: 70,
      instagram: null,
      esSuplente: false,
      tieneFoto: true,
      equipoId: 1,
      equipoNombre: "Os Pulpos",
      atributos: { saque: 80, remate: 60 }
    },
    edicion: EDICION,
    historial: [],
    palmares: { edicionesJugadas: 1, podios: { oro: 0, plata: 0, bronce: 0 }, mejorPuesto: null },
    carrera: estadisticas()
  };

  it("monta el cromo con su metal, su nota y su identidad", async () => {
    await montarFicha(FICHA);

    const cromo = document.querySelector(".cromo") as HTMLElement;
    expect(cromo.classList.contains("cromo--plata")).toBe(true);
    expect(cromo.querySelector(".cromo-nota-valor")!.textContent).toBe("70");
    expect(cromo.querySelector(".cromo-nota-pos")!.textContent).toBe("Bloqueo");
    expect(cromo.querySelector(".cromo-nombre")!.textContent).toBe("Marta Souto");
    expect(cromo.querySelector(".cromo-apodo")!.textContent).toBe("«La Muralla»");
    expect(cromo.querySelector(".cromo-dorsal")!.textContent).toBe("7");

    // Equipo actual y mano tienen hueco propio: son parte de la identidad.
    const chips = Array.from(cromo.querySelectorAll(".cromo-chip")).map((n) => n.textContent);
    expect(chips).toEqual(["Os Pulpos", "Zurdo"]);
  });

  it("pinta los seis atributos, con guión en los que no están puntuados", async () => {
    await montarFicha(FICHA);

    // Una carta tiene seis casillas: las que faltan se dejan vacías, no se
    // quitan, porque una rejilla desigual se lee peor que una con huecos.
    const celdas = Array.from(document.querySelectorAll(".cromo-stat"));
    expect(celdas).toHaveLength(6);

    expect(Array.from(document.querySelectorAll(".cromo-stat-clave")).map((n) => n.textContent)).toEqual([
      "SAQ",
      "REM",
      "BLO",
      "DEF",
      "REC",
      "COL"
    ]);
    expect(Array.from(document.querySelectorAll(".cromo-stat-valor")).map((n) => n.textContent)).toEqual([
      "80",
      "60",
      "—",
      "—",
      "—",
      "—"
    ]);
    expect(celdas[2]!.classList.contains("cromo-stat--vacio")).toBe(true);
  });

  it("sin ningún atributo puntuado, la carta sale sin nota", async () => {
    await montarFicha({ ...FICHA, jugador: { ...FICHA.jugador, media: null, atributos: {} } });

    const cromo = document.querySelector(".cromo") as HTMLElement;
    expect(cromo.classList.contains("cromo--sin-nota")).toBe(true);
    expect(cromo.querySelector(".cromo-nota-valor")).toBeNull();
    // La posición sigue estando: lo que falta es la valoración, no el puesto.
    expect(cromo.querySelector(".cromo-nota-pos")!.textContent).toBe("Bloqueo");
    expect(Array.from(document.querySelectorAll(".cromo-stat-valor")).every((n) => n.textContent === "—")).toBe(true);
  });

  it("un nivel desconocido no rompe la carta: cae a bronce", async () => {
    // El nivel llega de la API; si algún día trae basura, la ficha no puede
    // quedarse sin remate ni sin fondo.
    await montarFicha({ ...FICHA, jugador: { ...FICHA.jugador, nivel: "platino" } });

    const cromo = document.querySelector(".cromo") as HTMLElement;
    expect(cromo.classList.contains("cromo--bronce")).toBe(true);
    expect(cromo.querySelector(".cromo-corona path")).not.toBeNull();
    // Cae a bronce entero, relieve incluido: un nivel raro no puede dejar el
    // arco liso, que es como se ve un cromo al que le falta algo.
    expect(cromo.querySelector(".cromo-skyline")).not.toBeNull();
  });

  /*
   * El palmarés y la carrera salieron del cromo y viven en el bocadillo de al
   * lado. Es fácil devolverlos a `bloques` de un descuido — la llamada a
   * `crear()` los acepta y /mi-equipo/ los sigue usando —, y entonces la carta
   * vuelve a estirarse y las cifras salen dos veces en la misma pantalla.
   */
  it("el palmarés y la carrera están fuera de la carta, en el bocadillo", async () => {
    await montarFicha({ ...FICHA, carrera: estadisticas({ partidosJugados: 3, puntos: 12 }) });

    const cromo = document.querySelector(".cromo") as HTMLElement;
    expect(cromo.textContent).not.toContain("Palmarés");
    expect(cromo.textContent).not.toContain("En pista");
    expect(cromo.querySelector(".stat-tiles")).toBeNull();

    const datos = document.querySelector(".ficha-datos") as HTMLElement;
    const titulos = Array.from(datos.querySelectorAll(".ficha-datos-titulo")).map((n) => n.textContent);
    expect(titulos).toEqual(["Palmarés", "En pista"]);

    // Las medallas del palmarés y las cifras de carrera, cada una en su bloque.
    const bloques = Array.from(datos.querySelectorAll(".ficha-datos-bloque"));
    expect(Array.from(bloques[0]!.querySelectorAll(".stat-label")).map((n) => n.textContent)).toEqual([
      "Ediciones",
      "Oro",
      "Plata",
      "Bronce",
      "Mejor puesto"
    ]);
    expect(Array.from(bloques[1]!.querySelectorAll(".stat-label")).map((n) => n.textContent)).toEqual([
      "Partidos",
      "Puntos"
    ]);

    // El lema sí se queda en la carta: es su voz, no una cifra.
    expect(cromo.querySelector(".cromo-lema")!.textContent).toBe("“La red es mía”");
  });

  it("dos columnas: la carta a un lado, el bocadillo y el historial al otro", async () => {
    await montarFicha(FICHA);

    // El cromo primero: apilado en móvil, antes de cuánto suma se ve de quién es
    // la ficha.
    const columnas = document.querySelector(".ficha-columnas") as HTMLElement;
    expect(Array.from(columnas.children).map((n) => n.className)).toEqual(["cromo cromo--plata", "ficha-lado"]);

    // El historial comparte columna con el bocadillo, y va debajo. Suelto a todo
    // el ancho dejaba media página vacía al lado de la carta, que mide el doble
    // que el bocadillo.
    const lado = columnas.querySelector(".ficha-lado") as HTMLElement;
    expect(Array.from(lado.children).map((n) => n.className)).toEqual([
      "ficha-datos",
      "teams-panel album-historial"
    ]);
  });

  it("sin podios y sin partidos, el bocadillo lo dice en vez de alinear ceros", async () => {
    await montarFicha(FICHA);

    const notas = Array.from(document.querySelectorAll(".ficha-datos-nota")).map((n) => n.textContent);
    expect(notas).toEqual(["Todavía sin podios.", "Sin estadísticas todavía."]);
  });

  it("con podios y con partidos, las notas se cambian por las cifras", async () => {
    await montarFicha({
      ...FICHA,
      palmares: { edicionesJugadas: 3, podios: { oro: 1, plata: 0, bronce: 2 }, mejorPuesto: 1 },
      carrera: estadisticas({ partidosJugados: 9, puntos: 40 })
    });

    const notas = Array.from(document.querySelectorAll(".ficha-datos-nota")).map((n) => n.textContent);
    expect(notas).toEqual(["Suma de todas sus ediciones."]);

    const valores = Array.from(document.querySelectorAll(".ficha-datos .stat-value")).map((n) => n.textContent);
    expect(valores).toEqual(["3", "1", "0", "2", "1º", "9", "40"]);
  });

  it("las redes van dentro del bocadillo, no suelto bajo la carta", async () => {
    await montarFicha({ ...FICHA, jugador: { ...FICHA.jugador, instagram: "@lamuralla" } });

    const social = document.querySelector(".album-social") as HTMLElement;
    expect(social.textContent).toBe("En redes: @lamuralla");
    expect(social.closest(".ficha-datos")).not.toBeNull();
  });

  it("la carta se arma en tres tramos, y el cuerpo es el único que crece", async () => {
    await montarFicha(FICHA);

    // Remate, cuerpo y punta, en ese orden. Si la punta se cuela dentro del
    // cuerpo se lleva los bordes laterales por delante.
    const cromo = document.querySelector(".cromo") as HTMLElement;
    const tramos = Array.from(cromo.children).map((n) => n.getAttribute("class"));
    expect(tramos.filter((c) => c && !c.includes("sr-only"))).toEqual([
      "cromo-corona",
      "cromo-cuerpo",
      "cromo-punta"
    ]);

    // Lo que tiene alto variable va dentro del cuerpo, no suelto en la carta.
    const cuerpo = cromo.querySelector(".cromo-cuerpo")!;
    expect(cuerpo.querySelector(".cromo-retrato")).not.toBeNull();
    expect(cuerpo.querySelector(".cromo-stats")).not.toBeNull();
  });
});

describe("metal del cromo", () => {
  /*
   * Un <linearGradient> se referencia por id. Con el id repetido, todas las
   * cartas de la rejilla se pintarían con el metal de la primera — y el fallo
   * no se ve en un test que monte una sola.
   */
  it("cada carta trae su propio degradado, no el de la primera", async () => {
    await montar([
      jugador(1, "Marta", { nivel: "oro" }),
      jugador(2, "Xoán", { nivel: "plata" }),
      jugador(3, "Uxía", { nivel: "bronce" })
    ]);

    const ids = Array.from(document.querySelectorAll(".album-cromo linearGradient")).map((g) => g.id);
    expect(ids.length).toBeGreaterThanOrEqual(6); // remate + punta por cromo
    expect(new Set(ids).size).toBe(ids.length);

    // Y cada relleno apunta al degradado que va con él.
    const placas = Array.from(document.querySelectorAll(".album-cromo .cromo-placa"));
    const referencias = placas.map((p) => p.getAttribute("fill"));
    expect(new Set(referencias).size).toBe(placas.length);
    referencias.forEach((ref) => {
      const id = ref!.slice(5, -1); // url(#...)
      expect(document.getElementById(id)).not.toBeNull();
    });
  });
});
