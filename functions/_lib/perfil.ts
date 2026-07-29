// Ficha de jugador: los datos del cromo de /jugadores/ y de "Mi zona".
//
// Vive en _lib porque la usan dos endpoints con reglas idénticas: /api/perfil,
// donde cada uno edita la suya, y /api/admin/jugadores, donde el administrador
// edita la de cualquiera. Si las reglas se duplicaran, acabarían divergiendo.
//
// **La ficha es del jugador de una edición, no de la cuenta de Google.** Apodo,
// dorsal, posición, mano, lema y nivel del cromo son columnas de `jugadores`
// (migración 0023) por el mismo motivo por el que ya lo eran los atributos:
// solo así puede la organización rellenárselos a quien nunca ha entrado en la
// web, y solo así la ficha de 2025 conserva la posición que jugaba en 2025.
//
// **Los atributos van aparte, en `jugador_atributos`**, porque son una
// valoración que solo pone la organización: `validarPerfil` ignora lo que
// llegue en ese campo, y `PATCH /api/perfil` ignora tanto `atributos` como
// `nivel`.
//
// Las etiquetas y abreviaturas están replicadas en public/assets/cromo.js (no
// hay bundler que las comparta): al tocar aquí, tocar allí. Eso lo vigila
// test/unit/paridad-validacion.test.ts.

import { limpiar } from "./validacion";

export const POSICIONES = ["Bloqueo", "Defensa", "Todoterreno"];
export const MANOS = ["Diestro", "Zurdo", "Ambidiestro"];

export interface Atributo {
  clave: string;
  etiqueta: string;
  /** Lo que se pinta en la rejilla 2×3 del cromo. Tres letras, siempre. */
  abrev: string;
}

export const ATRIBUTOS: Atributo[] = [
  { clave: "saque", etiqueta: "Saque", abrev: "SAQ" },
  { clave: "remate", etiqueta: "Remate", abrev: "REM" },
  { clave: "bloqueo", etiqueta: "Bloqueo", abrev: "BLO" },
  { clave: "defensa", etiqueta: "Defensa", abrev: "DEF" },
  { clave: "recepcion", etiqueta: "Recepción", abrev: "REC" },
  { clave: "colocacion", etiqueta: "Colocación", abrev: "COL" }
];

export const CLAVES_ATRIBUTO = ATRIBUTOS.map((a) => a.clave);

export const MIN_ATRIBUTO = 1;
export const MAX_ATRIBUTO = 99;

/** Metal del cromo. Lo elige la organización; nadie nace por encima de bronce. */
export const NIVELES = ["bronce", "plata", "oro"] as const;
export type Nivel = (typeof NIVELES)[number];
export const NIVEL_POR_DEFECTO: Nivel = "bronce";

export interface FichaJugador {
  apodo: string | null;
  dorsal: number | null;
  posicion: string | null;
  mano: string | null;
  lema: string | null;
}

/** Lee la columna `atributos` (JSON) descartando lo que no sea un 1–99 conocido. */
export function parseAtributos(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const limpio: Record<string, number> = {};
    for (const key of CLAVES_ATRIBUTO) {
      const valor = obj[key];
      if (
        typeof valor === "number" &&
        Number.isInteger(valor) &&
        valor >= MIN_ATRIBUTO &&
        valor <= MAX_ATRIBUTO
      ) {
        limpio[key] = valor;
      }
    }
    return limpio;
  } catch {
    return {};
  }
}

/**
 * Nota global del cromo: la media de los atributos **puntuados**, redondeada.
 *
 * Se divide entre los puntuados y no entre seis a propósito: valorar solo dos
 * apartados no debe hundir la nota de alguien a un tercio de lo que vale. Sin
 * ninguno puntuado devuelve `null` y el cromo sale sin cifra — nadie ha dicho
 * que esa persona sea mala, es que no la han valorado todavía.
 *
 * No se guarda en ninguna columna, por el mismo motivo por el que no se guarda
 * la clasificación: habría que mantenerla en sincronía y corregir un atributo
 * viejo dejaría una nota que miente.
 */
export function mediaAtributos(atributos: Record<string, number> | null | undefined): number | null {
  const valores = CLAVES_ATRIBUTO.map((clave) => atributos?.[clave]).filter(
    (v): v is number => typeof v === "number"
  );
  if (valores.length === 0) return null;
  return Math.round(valores.reduce((a, b) => a + b, 0) / valores.length);
}

export function validarPerfil(raw: unknown): { perfil: FichaJugador } | { campos: Record<string, string> } {
  const campos: Record<string, string> = {};
  const body = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

  const apodo = limpiar(body.apodo);
  if (apodo && apodo.length > 40) campos.apodo = "El apodo no puede pasar de 40 caracteres.";

  const lema = limpiar(body.lema);
  if (lema && lema.length > 80) campos.lema = "El lema no puede pasar de 80 caracteres.";

  let dorsal: number | null = null;
  if (body.dorsal !== undefined && body.dorsal !== null && body.dorsal !== "") {
    const n = Number(body.dorsal);
    if (!Number.isInteger(n) || n < 0 || n > 99) campos.dorsal = "El dorsal debe estar entre 0 y 99.";
    else dorsal = n;
  }

  let posicion: string | null = null;
  if (body.posicion !== undefined && body.posicion !== null && body.posicion !== "") {
    if (!POSICIONES.includes(String(body.posicion))) campos.posicion = "Elige una posición válida.";
    else posicion = String(body.posicion);
  }

  let mano: string | null = null;
  if (body.mano !== undefined && body.mano !== null && body.mano !== "") {
    if (!MANOS.includes(String(body.mano))) campos.mano = "Elige una opción válida.";
    else mano = String(body.mano);
  }

  if (Object.keys(campos).length > 0) return { campos };
  return { perfil: { apodo: apodo || null, dorsal, posicion, mano, lema: lema || null } };
}

/**
 * La ficha vive en la fila del jugador de esa edición, así que siempre es un
 * UPDATE: nunca hay que crear la fila, y si no existe es que esa persona no
 * está inscrita — decisión que toma quien llama, no esta función.
 *
 * Devuelve la sentencia sin ejecutar, como `sentenciaAtributos`, para que
 * /api/admin/jugadores pueda meterla en su `batch` junto al resto de columnas.
 */
export function sentenciaFichaJugador(
  db: D1Database,
  jugadorId: number,
  ficha: FichaJugador
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE jugadores SET apodo = ?2, dorsal = ?3, posicion = ?4, mano = ?5, lema = ?6
        WHERE id = ?1`
    )
    .bind(jugadorId, ficha.apodo, ficha.dorsal, ficha.posicion, ficha.mano, ficha.lema);
}

// -------------------------------------------------------------------- nivel ---

/**
 * Metal del cromo. `undefined` no es un error: significa «no lo toques», y
 * devuelve el de serie para quien necesite un valor. Quien llama decide si el
 * campo venía — un PATCH que no lo menciona no debe devolver a nadie a bronce.
 */
export function validarNivel(raw: unknown): { nivel: Nivel } | { campos: Record<string, string> } {
  if (raw === undefined || raw === null) return { nivel: NIVEL_POR_DEFECTO };
  const valor = String(raw);
  if (!(NIVELES as readonly string[]).includes(valor)) {
    return { campos: { nivel: "Elige un nivel de cromo válido." } };
  }
  return { nivel: valor as Nivel };
}

// ---------------------------------------------------------------- atributos ---

export function validarAtributos(
  raw: unknown
): { atributos: Record<string, number> } | { campos: Record<string, string> } {
  const campos: Record<string, string> = {};
  const atributos: Record<string, number> = {};

  if (raw !== undefined && raw !== null) {
    if (typeof raw !== "object") {
      campos.atributos = "Los atributos no son válidos.";
    } else {
      const src = raw as Record<string, unknown>;
      for (const key of CLAVES_ATRIBUTO) {
        const valor = src[key];
        if (valor === undefined || valor === null || valor === "") continue;
        const n = Number(valor);
        if (!Number.isInteger(n) || n < MIN_ATRIBUTO || n > MAX_ATRIBUTO) {
          campos[`atributos.${key}`] = `Puntúa del ${MIN_ATRIBUTO} al ${MAX_ATRIBUTO}.`;
        } else atributos[key] = n;
      }
    }
  }

  if (Object.keys(campos).length > 0) return { campos };
  return { atributos };
}

/** Upsert de los atributos de un jugador de una edición. Solo lo llama el panel. */
export function sentenciaAtributos(
  db: D1Database,
  jugadorId: number,
  atributos: Record<string, number>
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO jugador_atributos (jugador_id, atributos, updated_at)
       VALUES (?1, ?2, datetime('now'))
       ON CONFLICT(jugador_id) DO UPDATE SET atributos = ?2, updated_at = datetime('now')`
    )
    .bind(jugadorId, JSON.stringify(atributos));
}

/** Atributos de una lista de jugadores. Devuelve un mapa id → atributos. */
export async function atributosPorJugador(
  db: D1Database,
  jugadorIds: number[]
): Promise<Map<number, Record<string, number>>> {
  const mapa = new Map<number, Record<string, number>>();
  if (jugadorIds.length === 0) return mapa;

  const placeholders = jugadorIds.map(() => "?").join(",");
  const { results } = await db
    .prepare(`SELECT jugador_id, atributos FROM jugador_atributos WHERE jugador_id IN (${placeholders})`)
    .bind(...jugadorIds)
    .all<{ jugador_id: number; atributos: string | null }>();

  for (const fila of results) {
    mapa.set(fila.jugador_id, parseAtributos(fila.atributos));
  }
  return mapa;
}
