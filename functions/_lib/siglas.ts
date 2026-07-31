/**
 * Las siglas de un equipo, para el chip de la cabecera.
 *
 * Es el RESPALDO, no la fuente: si `equipos.siglas` tiene algo, manda eso. Esto
 * existe para que un equipo recién inscrito —o un hueco del cuadro que todavía
 * dice «Ganador SF1»— salga legible sin que nadie tenga que escribir nada.
 *
 * Dos iniciales identifican mal («Os Pulpos» y «Os Percebes» dan las mismas), así
 * que cuando las iniciales no llegan a tres se cae a las tres primeras letras de
 * la primera palabra con peso. No se intenta desempatar automáticamente: unas
 * siglas que cambian solas el día que se inscribe otro equipo parecido son peores
 * que un choque, porque nadie las ve cambiar. Para eso está la columna.
 */

/** Palabras que no aportan: no se cuentan como inicial. */
const ENLACES = new Set(["de", "do", "da", "del", "la", "el", "los", "las", "os", "as", "y", "e"]);

const MINIMO = 3;
const MAXIMO = 4;

export function derivarSiglas(nombre: string): string {
  const palabras = String(nombre || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (palabras.length === 0) return "";

  // Si todo son enlaces nos quedamos con lo que haya: es mejor «LOS» que nada.
  const conPeso = palabras.filter((palabra) => !ENLACES.has(palabra.toLocaleLowerCase("es")));

  if (conPeso.length === 0) {
    // Todos son enlaces, usamos la primera palabra
    return palabras[0]!.slice(0, MINIMO).toLocaleUpperCase("es");
  }

  const iniciales = conPeso.map((palabra) => palabra[0]!).join("");
  if (iniciales.length >= MINIMO) return iniciales.slice(0, MAXIMO).toLocaleUpperCase("es");

  return conPeso[0]!.slice(0, MINIMO).toLocaleUpperCase("es");
}
