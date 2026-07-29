// Estadisticas de juego por jugador: metricas y totales.
//
// Una fila de `estadisticas` es lo que un jugador hizo en un partido. Desde la
// migracion 0012 no hay otra forma de que exista: `partido_id` es NOT NULL, asi
// que una cifra tecleada a mano, sin partido detras, no es representable. Lo
// que se muestra es siempre la SUMA de las filas del jugador.
//
// La lista de metricas esta replicada en public/assets/players-list.js y en
// public/assets/cromo.js: al tocar aqui, tocar alli
// (test/unit/paridad-validacion.test.ts lo comprueba).

export interface Metrica {
  /** Clave en el JSON de la API. */
  clave: string;
  /** Nombre de la columna en la fila agregada. */
  columna: string;
  etiqueta: string;
  /** No se almacena: se cuenta al agregar. */
  derivada?: boolean;
}

export const METRICAS: Metrica[] = [
  { clave: "partidosJugados", columna: "partidos_jugados", etiqueta: "Partidos", derivada: true },
  { clave: "puntos", columna: "puntos", etiqueta: "Puntos" },
  { clave: "remates", columna: "remates", etiqueta: "Remates" },
  { clave: "bloqueos", columna: "bloqueos", etiqueta: "Bloqueos" },
  { clave: "aces", columna: "aces", etiqueta: "Aces" },
  { clave: "defensas", columna: "defensas", etiqueta: "Defensas" },
  { clave: "errores", columna: "errores", etiqueta: "Errores" }
];

/**
 * Las que se registran en un partido: las unicas con columna propia.
 *
 * `columna` sigue rellena tambien en la derivada, y no es un descuido:
 * `mapEstadisticas` la usa para leer la fila agregada, y ahi `partidos_jugados`
 * existe como alias del COUNT. Dejarla a null pondria `partidosJugados` a cero
 * en silencio.
 */
export const METRICAS_PARTIDO = METRICAS.filter((m) => !m.derivada);

export type Estadisticas = Record<string, number>;

export function estadisticasVacias(): Estadisticas {
  return Object.fromEntries(METRICAS.map((m) => [m.clave, 0]));
}

/**
 * Las columnas agregadas de las consultas que suman por jugador. Los partidos
 * jugados se cuentan en vez de sumarse: son las propias filas.
 */
export const SUMA_METRICAS = METRICAS.map((m) =>
  m.derivada
    ? `COUNT(DISTINCT e.partido_id) AS ${m.columna}`
    : `COALESCE(SUM(e.${m.columna}), 0) AS ${m.columna}`
).join(", ");

/** Pasa una fila con columnas de la tabla al objeto que viaja en la API. */
export function mapEstadisticas(fila: Record<string, unknown> | null | undefined): Estadisticas {
  const totales = estadisticasVacias();
  if (!fila) return totales;
  for (const m of METRICAS) {
    const valor = fila[m.columna];
    if (typeof valor === "number" && Number.isFinite(valor)) totales[m.clave] = valor;
  }
  return totales;
}

export function sumarTotales(filas: Estadisticas[]): Estadisticas {
  const totales = estadisticasVacias();
  for (const fila of filas) {
    for (const m of METRICAS) {
      const valor = fila[m.clave];
      if (typeof valor === "number" && Number.isFinite(valor)) totales[m.clave] += valor;
    }
  }
  return totales;
}

/** ¿Tiene algo que enseñar? Sirve para no pintar bloques a cero. */
export function hayEstadisticas(totales: Estadisticas): boolean {
  return METRICAS.some((m) => (totales[m.clave] ?? 0) > 0);
}

/** Totales por jugador para una lista de jugadores. Devuelve un mapa id → totales. */
export async function totalesPorJugador(db: D1Database, jugadorIds: number[]): Promise<Map<number, Estadisticas>> {
  const mapa = new Map<number, Estadisticas>();
  if (jugadorIds.length === 0) return mapa;

  const placeholders = jugadorIds.map(() => "?").join(",");
  const { results } = await db
    .prepare(
      `SELECT e.jugador_id, ${SUMA_METRICAS}
       FROM estadisticas e
       WHERE e.jugador_id IN (${placeholders})
       GROUP BY e.jugador_id`
    )
    .bind(...jugadorIds)
    .all<Record<string, number>>();

  for (const fila of results) {
    mapa.set(fila.jugador_id, mapEstadisticas(fila));
  }
  return mapa;
}
