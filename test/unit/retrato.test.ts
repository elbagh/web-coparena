// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cargarScriptPublico } from "../helpers/dom";

/*
 * El retrato de `cromo.js`: la cara de un jugador con el metal de su cromo, que
 * pintan el versus del directo y la pista del anotador.
 *
 * Lo que se fija aquí es el presupuesto, que es la razón de que exista en vez de
 * reutilizar la carta: **una imagen y cero SVG**. Una carta son dos SVG con su
 * degradado cada uno, y en un versus hay dieciséis caras a la vez que además se
 * animan al puntuar.
 *
 * Y lo otro que se fija es el trato a quien ha pedido no salir en el álbum: sale
 * —está en pista y el marcador tiene que cuadrar— pero por su dorsal, nunca por
 * sus iniciales, que dentro de un equipo de cuatro identifican igual que el
 * nombre.
 */

interface Cromo {
  retrato: (datos: Record<string, unknown>) => HTMLElement;
  fallar: (nodo: HTMLElement | null | undefined) => void;
  NIVELES: string[];
}

const cromo = () => cargarScriptPublico<Cromo>("cromo.js", "CopaCromo");

afterEach(() => {
  document.body.innerHTML = "";
});

describe("el retrato", () => {
  it("es una imagen y ningún SVG", () => {
    const nodo = cromo().retrato({
      nivel: "oro",
      dorsal: 7,
      media: 63,
      nombre: "Marta",
      fotoUrl: "/api/jugadores?foto=12"
    });

    expect(nodo.querySelectorAll("img")).toHaveLength(1);
    expect(nodo.querySelectorAll("svg")).toHaveLength(0);
    expect(nodo.querySelector("img")!.getAttribute("src")).toBe("/api/jugadores?foto=12");
  });

  it("la imagen trae medidas, para que la rejilla no salte mientras carga", () => {
    const img = cromo()
      .retrato({ nombre: "Marta", fotoUrl: "/api/jugadores?foto=12" })
      .querySelector("img")!;

    expect(img.getAttribute("width")).toBe("96");
    expect(img.getAttribute("height")).toBe("96");
    expect(img.getAttribute("decoding")).toBe("async");
  });

  /*
   * Los titulares se ven de entrada; los suplentes viven en un desplegable que
   * en móvil arranca cerrado. Pedir sus fotos antes de abrirlo son megas de 4G
   * gastados en algo que nadie está mirando.
   */
  it("solo carga en primer plano lo que se pide con prioridad alta", () => {
    const { retrato } = cromo();
    const titular = retrato({ fotoUrl: "/f/1", prioridad: "alta" }).querySelector("img")!;
    const suplente = retrato({ fotoUrl: "/f/2", tamano: "pequeno" }).querySelector("img")!;

    expect(titular.getAttribute("loading")).toBe("eager");
    expect(titular.getAttribute("fetchpriority")).toBe("high");
    expect(suplente.getAttribute("loading")).toBe("lazy");
    expect(suplente.getAttribute("fetchpriority")).toBe(null);
  });

  it("sin foto manda el dorsal, no las iniciales", () => {
    const nodo = cromo().retrato({ nombre: "Marta", apellidos: "Souto", dorsal: 7, fotoUrl: null });

    expect(nodo.querySelector("img")).toBe(null);
    // El hueco es el dorsal a secas: ni «MS» ni «M».
    expect(nodo.querySelector(".retrato-hueco")!.textContent).toBe("7");
  });

  it("quien está oculto del álbum sale por su dorsal y sin nombre", () => {
    const nodo = cromo().retrato({
      nivel: "plata",
      dorsal: 9,
      nombre: null,
      media: null,
      fotoUrl: null,
      etiqueta: "Dorsal 9"
    });

    expect(nodo.querySelector(".retrato-nombre")).toBe(null);
    expect(nodo.querySelector(".retrato-hueco")!.textContent).toBe("9");
    // Conserva su metal: solo el nombre identifica.
    expect(nodo.className).toContain("retrato--plata");
    expect(nodo.querySelector(".sr-only")!.textContent).toBe("Dorsal 9");
  });

  it("sin nota no pinta un cero", () => {
    const nodo = cromo().retrato({ nombre: "Marta", media: null, fotoUrl: "/f/1" });

    expect(nodo.querySelector(".retrato-nota")).toBe(null);
    expect(nodo.textContent).not.toContain("0");
  });

  it("cada nivel tiene su clase, y lo desconocido cae a bronce", () => {
    const { retrato, NIVELES } = cromo();
    const clases = NIVELES.map((nivel) => retrato({ nivel }).className);

    expect(new Set(clases).size).toBe(3);
    expect(retrato({ nivel: "platino" }).className).toContain("retrato--bronce");
  });

  it("el tamaño pequeño es el del banquillo", () => {
    const { retrato } = cromo();

    expect(retrato({ tamano: "pequeno", fotoUrl: "/f/1" }).className).toContain("retrato--pequeno");
    expect(retrato({ fotoUrl: "/f/1" }).className).toContain("retrato--grande");
    expect(retrato({ tamano: "pequeno", fotoUrl: "/f/1" }).querySelector("img")!.getAttribute("width")).toBe("56");
  });

  /*
   * El anotador lo mete dentro de un <button>: si el retrato trajera algo
   * interactivo, sería un control dentro de otro.
   */
  it("no lleva nada interactivo dentro", () => {
    const nodo = cromo().retrato({ nombre: "Marta", dorsal: 7, fotoUrl: "/f/1" });

    expect(nodo.querySelectorAll("button, a, input, select, textarea")).toHaveLength(0);
    expect(nodo.tagName).toBe("SPAN");
  });
});

/*
 * La marca de fallo: la contraria de la sacudida. La llevan las dos acciones
 * cuyo punto se lleva el rival —el saque fallado y el error no forzado—, que
 * hasta ahora sacudían el retrato de quien las cometió, o sea la animación de
 * celebrar.
 *
 * Dura cinco segundos y se va sola. Que se vaya no es cosmético: el retrato se
 * reutiliza durante todo el partido (se mueve entre la pista y el banquillo en
 * vez de recrearse), así que una marca que no se limpiara se quedaría puesta
 * hasta el final.
 */
describe("la marca de fallo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Sin estar en el documento no se marca: `fallar` exige `isConnected`. */
  const montado = (api: Cromo) => {
    const nodo = api.retrato({ nombre: "Marta", dorsal: 7, fotoUrl: "/f/1" });
    document.body.appendChild(nodo);
    return nodo;
  };

  it("pone la equis, la cara triste y la clase", () => {
    const api = cromo();
    const nodo = montado(api);

    api.fallar(nodo);

    expect(nodo.classList.contains("is-fallo")).toBe(true);
    expect(nodo.querySelector(".retrato-fallo")).not.toBe(null);
    expect(nodo.querySelector(".retrato-cara")).not.toBe(null);
  });

  /*
   * La cara va DENTRO de la caja de la equis, que es la que el CSS cuadra sobre
   * el marco. Suelta en el retrato heredaría su caja —que mide también el nombre
   * y el apellido— y caería por debajo de la cara.
   */
  it("la cara cuelga de la caja que se cuadra sobre el marco", () => {
    const api = cromo();
    const nodo = montado(api);

    api.fallar(nodo);

    expect(nodo.querySelector(".retrato-fallo > .retrato-cara")).not.toBe(null);
    expect(nodo.querySelectorAll(":scope > .retrato-cara")).toHaveLength(0);
  });

  it("se va sola a los cinco segundos", () => {
    const api = cromo();
    const nodo = montado(api);

    api.fallar(nodo);
    vi.advanceTimersByTime(4999);
    expect(nodo.querySelector(".retrato-fallo")).not.toBe(null);

    vi.advanceTimersByTime(1);
    expect(nodo.classList.contains("is-fallo")).toBe(false);
    expect(nodo.querySelector(".retrato-fallo")).toBe(null);
  });

  /*
   * Dos fallos seguidos de la misma persona. Sin reiniciar la cuenta, el
   * temporizador del primero apagaría la marca del segundo antes de tiempo; y
   * sin limpiar antes de volver a pintar, quedarían dos equis superpuestas.
   */
  it("un segundo fallo reinicia la cuenta y no deja dos marcas", () => {
    const api = cromo();
    const nodo = montado(api);

    api.fallar(nodo);
    vi.advanceTimersByTime(4000);
    api.fallar(nodo);

    expect(nodo.querySelectorAll(".retrato-fallo")).toHaveLength(1);

    // Con la cuenta del primero, aquí ya estaría apagada.
    vi.advanceTimersByTime(1500);
    expect(nodo.querySelector(".retrato-fallo")).not.toBe(null);

    vi.advanceTimersByTime(3500);
    expect(nodo.querySelector(".retrato-fallo")).toBe(null);
  });

  it("un retrato que no está en pantalla no se marca", () => {
    const api = cromo();
    const suelto = api.retrato({ nombre: "Marta", fotoUrl: "/f/1" });

    expect(() => api.fallar(suelto)).not.toThrow();
    expect(() => api.fallar(null)).not.toThrow();
    expect(suelto.querySelector(".retrato-fallo")).toBe(null);
  });
});
