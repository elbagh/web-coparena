// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
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
