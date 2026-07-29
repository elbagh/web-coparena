import { readFileSync } from "node:fs";
import path from "node:path";

// jsdom no implementa scrollIntoView (layout real no existe en el DOM
// simulado). Los scripts de public/assets/ lo llaman al pintar un banner o
// un error; sin este stub, cada test que ejercite ese camino deja una
// "Unhandled Rejection" ruidosa en la salida aunque el test en sí pase.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

/**
 * Evalúa uno de los scripts de `public/assets/` dentro del entorno jsdom y
 * devuelve el objeto que publica en `window`.
 *
 * Esos ficheros son IIFE sin `export` porque se cargan con `<script is:inline>`
 * y no pasan por el bundler de Astro. Cargarlos así permite testear su lógica
 * sin cambiar cómo se sirven en producción.
 */
export function cargarScriptPublico<T>(nombreFichero: string, nombreGlobal: string): T {
  ejecutarScriptPublico(nombreFichero);

  const publicado = (globalThis as unknown as Record<string, unknown>)[nombreGlobal];
  if (!publicado) {
    throw new Error(`${nombreFichero} no ha publicado window.${nombreGlobal}`);
  }
  return publicado as T;
}

/**
 * Ejecuta un script de `public/assets/` que no publica nada en `window` sino que
 * se engancha al DOM al cargarse (my-team.js, shirts.js…). El documento tiene
 * que estar montado **antes** de llamar: esos scripts hacen su querySelector en
 * la primera línea y se van si no encuentran su raíz.
 */
export function ejecutarScriptPublico(nombreFichero: string): void {
  const ruta = path.resolve(import.meta.dirname, "../../public/assets", nombreFichero);
  const codigo = readFileSync(ruta, "utf8");
  // El cuerpo de `new Function` se evalúa en ámbito global, así que el `window`
  // que ve el script es el de jsdom.
  new Function(codigo)();
}
