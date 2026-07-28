// Estadisticas de juego por jugador: metricas, validacion y totales.
//
// Una fila de `estadisticas` es una carga: o la manual de la edicion
// (partido_id NULL) o la de un partido concreto. Lo que se muestra siempre es
// la SUMA de las filas del jugador, asi que cuando llegue el registro por
// partido no hay que tocar ninguna consulta de lectura.
//
// La lista de metricas esta replicada en public/assets/players-list.js y en
// public/assets/admin/estadisticas.js: al tocar aqui, tocar alli
// (test/unit/paridad-validacion.test.ts lo comprueba).

export interface Metrica {
  /** Clave en el JSON de la API. */
  clave: string;
  /** Columna de la tabla `estadisticas`. */
  columna: string;
  etiqueta: string;
}

export const METRICAS: Metrica[] = [
  { clave: "partidosJugados", columna: "partidos_jugados", etiqueta: "Partidos" },
  { clave: "puntos", columna: "puntos", etiqueta: "Puntos" },
  { clave: "remates", columna: "remates", etiqueta: "Remates" },
  { clave: "bloqueos", columna: "bloqueos", etiqueta: "Bloqueos" },
  { clave: "aces", columna: "aces", etiqueta: "Aces" },
  { clave: "defensas", columna: "defensas", etiqueta: "Defensas" },
  { clave: "errores", columna: "errores", etiqueta: "Errores" }
];

/** Tope por carga: un numero mas alto es un dedazo, no un partidazo. */
export const MAX_METRICA = 9999;

export type Estadisticas = Record<string, number>;

export function estadisticasVacias(): Estadisticas {
  return Object.fromEntries(METRICAS.map((m) => [m.clave, 0]));
}

/**
 * `COALESCE(SUM(...), 0) AS <clave_columna>` para todas las metricas. Se usa en
 * las consultas que agregan por jugador o por edicion.
 */
export const SUMA_METRICAS = METRICAS.map((m) => `COALESCE(SUM(e.${m.columna}), 0) AS ${m.columna}`).join(", ");

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

export function validarEstadisticas(raw: unknown): { estadisticas: Estadisticas } | { campos: Record<string, string> } {
  const campos: Record<string, string> = {};
  const body = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const estadisticas = estadisticasVacias();

  for (const m of METRICAS) {
    const valor = body[m.clave];
    if (valor === undefined || valor === null || valor === "") continue;
    const n = Number(valor);
    if (!Number.isInteger(n) || n < 0 || n > MAX_METRICA) {
      campos[`estadisticas.${m.clave}`] = `Introduce un número entero entre 0 y ${MAX_METRICA}.`;
    } else {
      estadisticas[m.clave] = n;
    }
  }

  if (Object.keys(campos).length > 0) return { campos };
  return { estadisticas };
}

/** Upsert de la carga manual de la edición (la fila con `partido_id IS NULL`). */
export function sentenciaCargaManual(db: D1Database, jugadorId: number, estadisticas: Estadisticas): D1PreparedStatement {
  const columnas = METRICAS.map((m) => m.columna);
  const placeholders = columnas.map((_, i) => `?${i + 2}`);
  const sets = columnas.map((columna, i) => `${columna} = ?${i + 2}`);
  const valores = METRICAS.map((m) => estadisticas[m.clave] ?? 0);

  return db
    .prepare(
      `INSERT INTO estadisticas (jugador_id, partido_id, ${columnas.join(", ")})
       VALUES (?1, NULL, ${placeholders.join(", ")})
       ON CONFLICT (jugador_id) WHERE partido_id IS NULL DO UPDATE SET
         ${sets.join(", ")}, updated_at = datetime('now')`
    )
    .bind(jugadorId, ...valores);
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
