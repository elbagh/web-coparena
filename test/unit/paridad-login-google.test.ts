import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Quien pinta la tarjeta de login tiene que cargar el script de Google.
 *
 * `auth.js` busca los `[data-google-login]` y espera a `window.google.accounts.id`
 * durante cuatro segundos; si no llega, escribe «No se ha podido cargar el botón
 * de Google. Recarga la página.» y se acabó. No hay reintento, y el mensaje no
 * dice cuál es el problema real, porque desde el cliente no se distingue un
 * script ausente de uno bloqueado por la red.
 *
 * El emparejamiento se lleva a mano, y ya se rompió una vez: `AnotadorLayout`
 * nació copiando la tarjeta de `AdminLayout` y dejándose el `<script>`, así que
 * /anotador/ enseñaba el recuadro de login y nunca el botón. Estuvo así dos días
 * y no lo vio nadie, porque quien ya tenía sesión abierta entraba sin tocar esa
 * tarjeta — y el torneo empezaba al día siguiente.
 *
 * Este test no ejecuta nada: empareja los dos literales en los ficheros de
 * `src/`. Es un detector de deriva, como paridad-validacion.
 */

const raiz = path.resolve(import.meta.dirname, "../..");
const TARJETA = "data-google-login";
const SCRIPT = "accounts.google.com/gsi/client";

/** Todos los .astro de src/, recorriendo subdirectorios. */
function astros(dir: string): string[] {
  return readdirSync(dir).flatMap((entrada) => {
    const completa = path.join(dir, entrada);
    if (statSync(completa).isDirectory()) return astros(completa);
    return completa.endsWith(".astro") ? [completa] : [];
  });
}

const ficheros = astros(path.join(raiz, "src")).map((completa) => ({
  ruta: path.relative(raiz, completa).replace(/\\/g, "/"),
  texto: readFileSync(completa, "utf8")
}));

describe("la tarjeta de login y el script de Google van juntos", () => {
  it("hay ficheros que declaran la tarjeta (si no, el test no prueba nada)", () => {
    const conTarjeta = ficheros.filter((f) => f.texto.includes(TARJETA));
    expect(conTarjeta.length).toBeGreaterThan(0);
  });

  it("todo el que pinta la tarjeta carga el script", () => {
    const huerfanos = ficheros
      .filter((f) => f.texto.includes(TARJETA) && !f.texto.includes(SCRIPT))
      .map((f) => f.ruta);

    expect(
      huerfanos,
      `Estos ficheros pintan [${TARJETA}] y no cargan ${SCRIPT}.\n` +
        "Quien entre sin sesión verá el recuadro de login y nunca el botón:\n" +
        huerfanos.map((r) => `  - ${r}`).join("\n")
    ).toEqual([]);
  });

  /*
   * Al revés no es un fallo: una página puede cargar el script y pintar la
   * tarjeta desde su layout. Lo que sí conviene saber es que nadie lo cargue
   * sin que exista una tarjeta en alguna parte, porque sería un tercero
   * pidiéndose a sí mismo sin motivo.
   */
  it("nadie carga el script sin que haya tarjetas en el sitio", () => {
    const conScript = ficheros.filter((f) => f.texto.includes(SCRIPT));
    const hayTarjetas = ficheros.some((f) => f.texto.includes(TARJETA));
    if (conScript.length > 0) expect(hayTarjetas).toBe(true);
  });
});
