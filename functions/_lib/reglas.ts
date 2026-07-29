// Las reglas de juego y de puntuación de una fase del torneo.
//
// Antes vivían como literales repartidos: 21/21/15 y «al mejor de tres» estaban
// escritos a mano en functions/api/partidos.ts y otra vez en
// public/assets/match-utils.js, sin nada que impidiera que divergieran. Ahora
// son datos: cada fase trae las suyas, un grupo puede sobrescribirlas, y cada
// partido guarda una foto de las que le tocaron.
//
// La herencia es grupo > fase > estas de aquí. Un grupo de tres equipos puede
// jugar a un set y uno de cinco al mejor de tres dentro de la misma fase, que es
// justo lo que pasa cuando los grupos no salen del mismo tamaño.

export type CriterioDesempate =
  | "puntos"
  | "enfrentamiento_directo"
  | "victorias"
  | "diferencia_sets"
  | "ratio_sets"
  | "diferencia_puntos"
  | "ratio_puntos";

export const CRITERIOS: readonly { clave: CriterioDesempate; etiqueta: string }[] = [
  { clave: "puntos", etiqueta: "Puntos de clasificación" },
  { clave: "enfrentamiento_directo", etiqueta: "Enfrentamiento directo" },
  { clave: "victorias", etiqueta: "Partidos ganados" },
  { clave: "diferencia_sets", etiqueta: "Diferencia de sets" },
  { clave: "ratio_sets", etiqueta: "Ratio de sets" },
  { clave: "diferencia_puntos", etiqueta: "Diferencia de puntos" },
  { clave: "ratio_puntos", etiqueta: "Ratio de puntos" }
];

const CLAVES_CRITERIO = new Set<string>(CRITERIOS.map((c) => c.clave));

export interface ReglasPartido {
  /** Sets que hay que ganar. 2 = al mejor de tres. 1 = a un set. */
  sets: number;
  puntosPorSet: number;
  /** Objetivo del último set posible, el que decide. Con `sets` = 1 no se usa. */
  puntosSetDecisivo: number;
  /** Ventaja mínima para cerrar un set. */
  diferencia: number;
}

export interface ReglasClasificacion {
  puntosVictoria: number;
  puntosDerrota: number;
  /** Ganar en el set decisivo puntúa menos que ganar limpio, si se quiere. */
  puntosVictoriaAjustada: number;
  /** Y perder en el decisivo puede puntuar algo. */
  puntosDerrotaAjustada: number;
  desempates: CriterioDesempate[];
}

export interface ReglasFase {
  partido: ReglasPartido;
  clasificacion: ReglasClasificacion;
}

/** Volley playa de toda la vida: al mejor de tres, 21/21/15, con dos de ventaja. */
export const REGLAS_POR_DEFECTO: ReglasFase = {
  partido: { sets: 2, puntosPorSet: 21, puntosSetDecisivo: 15, diferencia: 2 },
  clasificacion: {
    puntosVictoria: 3,
    puntosDerrota: 0,
    puntosVictoriaAjustada: 2,
    puntosDerrotaAjustada: 1,
    desempates: ["puntos", "enfrentamiento_directo", "ratio_sets", "ratio_puntos"]
  }
};

const entero = (valor: unknown, porDefecto: number, min: number, max: number): number => {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < min || n > max) return porDefecto;
  return n;
};

/**
 * Deja un objeto de reglas utilizable a partir de cualquier cosa: JSON parcial,
 * un `{}` recién creado o basura. Nunca lanza — lo que no se entiende cae al
 * valor por defecto, porque un partido sin reglas legibles no se puede arbitrar
 * pero tampoco debe tumbar la página del cuadro.
 */
export function normalizarReglas(bruto: unknown, base: ReglasFase = REGLAS_POR_DEFECTO): ReglasFase {
  const raw = leerJson(bruto);
  const partido = (raw.partido ?? {}) as Record<string, unknown>;
  const clasificacion = (raw.clasificacion ?? {}) as Record<string, unknown>;

  const desempatesBrutos = Array.isArray(clasificacion.desempates) ? clasificacion.desempates : null;
  const desempates = desempatesBrutos
    ? [...new Set(desempatesBrutos.map(String))].filter((c): c is CriterioDesempate => CLAVES_CRITERIO.has(c))
    : base.clasificacion.desempates;

  return {
    partido: {
      sets: entero(partido.sets, base.partido.sets, 1, 5),
      puntosPorSet: entero(partido.puntosPorSet, base.partido.puntosPorSet, 5, 99),
      puntosSetDecisivo: entero(partido.puntosSetDecisivo, base.partido.puntosSetDecisivo, 5, 99),
      diferencia: entero(partido.diferencia, base.partido.diferencia, 1, 10)
    },
    clasificacion: {
      puntosVictoria: entero(clasificacion.puntosVictoria, base.clasificacion.puntosVictoria, 0, 10),
      puntosDerrota: entero(clasificacion.puntosDerrota, base.clasificacion.puntosDerrota, 0, 10),
      puntosVictoriaAjustada: entero(
        clasificacion.puntosVictoriaAjustada,
        base.clasificacion.puntosVictoriaAjustada,
        0,
        10
      ),
      puntosDerrotaAjustada: entero(
        clasificacion.puntosDerrotaAjustada,
        base.clasificacion.puntosDerrotaAjustada,
        0,
        10
      ),
      // Sin ningún criterio válido la tabla no tendría orden: se cae a los de serie.
      desempates: desempates.length > 0 ? desempates : base.clasificacion.desempates
    }
  };
}

/** Valida lo que llega del panel y devuelve errores por campo, al estilo del resto. */
export function validarReglas(bruto: unknown): { reglas: ReglasFase } | { campos: Record<string, string> } {
  const raw = leerJson(bruto);
  const campos: Record<string, string> = {};
  const partido = (raw.partido ?? {}) as Record<string, unknown>;
  const clasificacion = (raw.clasificacion ?? {}) as Record<string, unknown>;

  const pedir = (valor: unknown, clave: string, min: number, max: number) => {
    if (valor === undefined) return;
    const n = Number(valor);
    if (!Number.isInteger(n) || n < min || n > max) campos[clave] = `Tiene que estar entre ${min} y ${max}.`;
  };

  pedir(partido.sets, "reglas.sets", 1, 5);
  pedir(partido.puntosPorSet, "reglas.puntosPorSet", 5, 99);
  pedir(partido.puntosSetDecisivo, "reglas.puntosSetDecisivo", 5, 99);
  pedir(partido.diferencia, "reglas.diferencia", 1, 10);
  pedir(clasificacion.puntosVictoria, "reglas.puntosVictoria", 0, 10);
  pedir(clasificacion.puntosDerrota, "reglas.puntosDerrota", 0, 10);
  pedir(clasificacion.puntosVictoriaAjustada, "reglas.puntosVictoriaAjustada", 0, 10);
  pedir(clasificacion.puntosDerrotaAjustada, "reglas.puntosDerrotaAjustada", 0, 10);

  if (clasificacion.desempates !== undefined) {
    if (!Array.isArray(clasificacion.desempates)) {
      campos["reglas.desempates"] = "Tiene que ser una lista de criterios.";
    } else {
      const desconocidos = clasificacion.desempates.map(String).filter((c) => !CLAVES_CRITERIO.has(c));
      if (desconocidos.length > 0) {
        campos["reglas.desempates"] = `Criterios que no existen: ${desconocidos.join(", ")}.`;
      } else if (clasificacion.desempates.length === 0) {
        campos["reglas.desempates"] = "Deja al menos un criterio.";
      }
    }
  }

  if (Object.keys(campos).length > 0) return { campos };
  return { reglas: normalizarReglas(raw) };
}

/**
 * Las reglas que de verdad rigen: las del grupo si las tiene, si no las de la
 * fase, y lo que falte de las de serie.
 */
export function reglasEfectivas(
  fase: { reglas: string | null } | null | undefined,
  grupo?: { reglas: string | null } | null
): ReglasFase {
  const deFase = normalizarReglas(fase?.reglas);
  if (grupo?.reglas == null || grupo.reglas === "") return deFase;
  return normalizarReglas(grupo.reglas, deFase);
}

/** Sets como máximo puede durar un partido: al mejor de (2n − 1). */
export const setsMaximos = (reglas: ReglasPartido): number => reglas.sets * 2 - 1;

/**
 * A cuántos puntos se juega ese set.
 *
 * El último set posible es el corto, salvo cuando solo hay uno: un partido a un
 * set se juega al objetivo normal, no al del desempate.
 */
export function objetivoDelSet(reglas: ReglasPartido, setNumero: number): number {
  if (reglas.sets > 1 && setNumero >= setsMaximos(reglas)) return reglas.puntosSetDecisivo;
  return reglas.puntosPorSet;
}

/** ¿Ese marcador cierra el set? */
export function ganadorDelSet(
  reglas: ReglasPartido,
  puntosA: number,
  puntosB: number,
  setNumero: number
): "A" | "B" | null {
  const objetivo = objetivoDelSet(reglas, setNumero);
  if (puntosA >= objetivo && puntosA - puntosB >= reglas.diferencia) return "A";
  if (puntosB >= objetivo && puntosB - puntosA >= reglas.diferencia) return "B";
  return null;
}

/** ¿Alguien ha ganado ya los sets que hacían falta? */
export function ganadorDelPartido(reglas: ReglasPartido, setsA: number, setsB: number): "A" | "B" | null {
  if (setsA >= reglas.sets) return "A";
  if (setsB >= reglas.sets) return "B";
  return null;
}

function leerJson(bruto: unknown): Record<string, unknown> {
  if (bruto && typeof bruto === "object") return bruto as Record<string, unknown>;
  if (typeof bruto !== "string" || bruto === "") return {};
  try {
    const parsed = JSON.parse(bruto);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
