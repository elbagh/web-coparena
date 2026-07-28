import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Evalúa uno de los scripts de `public/assets/` dentro del entorno jsdom y
 * devuelve el objeto que publica en `window`.
 *
 * Esos ficheros son IIFE sin `export` porque se cargan con `<script is:inline>`
 * y no pasan por el bundler de Astro. Cargarlos así permite testear su lógica
 * sin cambiar cómo se sirven en producción.
 */
export function cargarScriptPublico<T>(nombreFichero: string, nombreGlobal: string): T {
  const ruta = path.resolve(import.meta.dirname, "../../public/assets", nombreFichero);
  const codigo = readFileSync(ruta, "utf8");
  // El cuerpo de `new Function` se evalúa en ámbito global, así que el `window`
  // que ve el script es el de jsdom.
  new Function(codigo)();

  const publicado = (globalThis as unknown as Record<string, unknown>)[nombreGlobal];
  if (!publicado) {
    throw new Error(`${nombreFichero} no ha publicado window.${nombreGlobal}`);
  }
  return publicado as T;
}
