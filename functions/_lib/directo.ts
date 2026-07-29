// El estado del partido en directo, y la cadencia a la que se puede pedir.
//
// Este es el endpoint que sondea todo el mundo a la vez, así que es el único del
// sitio que puede agotar la cuota de peticiones de Cloudflare — y justo el día
// que más gente mira. De ahí las tres decisiones que lo gobiernan:
//
//   1. Se calcula primero una versión barata (UNA fila agregada). Si coincide
//      con el `If-None-Match` que trae el navegador, se responde 304 sin llegar
//      a construir el cuerpo.
//   2. La cadencia la manda el SERVIDOR, no el cliente. Sale de la tabla
//      `ajustes`, editable desde el panel: subirla de 3 s a 20 s frena a todos
//      los espectadores al siguiente sondeo, sin desplegar nada.
//   3. El payload es minúsculo. Todo lo pesado (cuadro, clasificaciones) vive en
//      /api/torneo, que se cachea y no se sondea.
//
// Ojo con la cuenta: un 304 consume una petición igual que un 200. El ETag
// ahorra ancho de banda y lecturas de D1, no invocaciones. Lo único que ahorra
// invocaciones es sondear menos.

import { json } from "./http";
import { normalizarReglas } from "./reglas";

export interface Ajustes {
  sondeoMs: number;
  sondeoLentoMs: number;
  modoAhorro: boolean;
}

export const AJUSTES_POR_DEFECTO: Ajustes = {
  sondeoMs: 3000,
  sondeoLentoMs: 60000,
  modoAhorro: false
};

interface PartidoDirectoRow {
  id: string;
  ronda: string;
  pista: string | null;
  equipo_a_nombre: string;
  equipo_b_nombre: string;
  equipo_a_id: number | null;
  equipo_b_id: number | null;
  status: string;
  points_a: number;
  points_b: number;
  sets_a: number;
  sets_b: number;
  set_number: number;
  set_history: string;
  started_at: string | null;
  scheduled_at: string | null;
  reglas: string;
}

export interface EstadoDirecto {
  hayDirecto: boolean;
  partidos: ReturnType<typeof mapDirecto>[];
  /** El siguiente en empezar, para que el botón diga algo cuando no hay nadie jugando. */
  siguiente: { ronda: string; scheduledAt: string | null; equipos: [string, string] } | null;
  siguienteSondeoMs: number;
  modoAhorro: boolean;
}

const EDICION_ACTUAL = "(SELECT id FROM ediciones WHERE es_actual = 1)";

const entero = (valor: string | undefined, porDefecto: number, min: number, max: number): number => {
  const n = Number(valor);
  if (!Number.isFinite(n) || n < min || n > max) return porDefecto;
  return Math.round(n);
};

export async function leerAjustes(db: D1Database): Promise<Ajustes> {
  const { results } = await db
    .prepare("SELECT clave, valor FROM ajustes WHERE clave LIKE 'directo_%'")
    .all<{ clave: string; valor: string }>();
  const mapa = new Map(results.map((fila) => [fila.clave, fila.valor]));

  return {
    // Mínimo un segundo: por debajo, el sondeo deja de ser sondeo y es un ataque.
    sondeoMs: entero(mapa.get("directo_sondeo_ms"), AJUSTES_POR_DEFECTO.sondeoMs, 1000, 600000),
    sondeoLentoMs: entero(mapa.get("directo_sondeo_lento_ms"), AJUSTES_POR_DEFECTO.sondeoLentoMs, 1000, 600000),
    modoAhorro: mapa.get("directo_modo_ahorro") === "1"
  };
}

/**
 * Una sola fila que cambia con cualquier cosa que pase en un partido en juego.
 *
 * Lleva el marcador sumado además de `updated_at` porque dos escrituras dentro
 * del mismo milisegundo darían la misma marca de tiempo, y un punto que no
 * cambia la versión es un punto que el espectador no ve.
 */
export async function versionDirecto(db: D1Database): Promise<string> {
  const fila = await db
    .prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(MAX(updated_at), '') AS ultimo,
              COALESCE(SUM(points_a + points_b + sets_a + sets_b), 0) AS marcador
         FROM partidos
        WHERE edicion_id = ${EDICION_ACTUAL} AND status = 'live'`
    )
    .first<{ n: number; ultimo: string; marcador: number }>();

  return `${fila?.n ?? 0}-${fila?.marcador ?? 0}-${fila?.ultimo ?? ""}`;
}

export const etagDe = (version: string): string => `W/"directo-${version}"`;

export async function estadoDirecto(db: D1Database, ajustes: Ajustes): Promise<EstadoDirecto> {
  const [vivos, proximo] = await Promise.all([
    db
      .prepare(
        `SELECT * FROM partidos
          WHERE edicion_id = ${EDICION_ACTUAL} AND status = 'live'
          ORDER BY COALESCE(scheduled_at, '9999'), sort_order ASC`
      )
      .all<PartidoDirectoRow>(),
    db
      .prepare(
        `SELECT ronda, scheduled_at, equipo_a_nombre, equipo_b_nombre FROM partidos
          WHERE edicion_id = ${EDICION_ACTUAL} AND status = 'scheduled' AND scheduled_at IS NOT NULL
          ORDER BY scheduled_at ASC LIMIT 1`
      )
      .first<{ ronda: string; scheduled_at: string; equipo_a_nombre: string; equipo_b_nombre: string }>()
  ]);

  const hayDirecto = vivos.results.length > 0;

  return {
    hayDirecto,
    partidos: vivos.results.map(mapDirecto),
    siguiente: proximo
      ? {
          ronda: proximo.ronda,
          scheduledAt: proximo.scheduled_at,
          equipos: [proximo.equipo_a_nombre, proximo.equipo_b_nombre]
        }
      : null,
    // Sin nadie jugando no hay nada que refrescar deprisa.
    siguienteSondeoMs: hayDirecto ? ajustes.sondeoMs : ajustes.sondeoLentoMs,
    modoAhorro: ajustes.modoAhorro
  };
}

function mapDirecto(partido: PartidoDirectoRow) {
  return {
    id: partido.id,
    ronda: partido.ronda,
    pista: partido.pista,
    status: partido.status,
    setNumber: partido.set_number,
    points: { A: partido.points_a, B: partido.points_b },
    sets: { A: partido.sets_a, B: partido.sets_b },
    history: leerHistorial(partido.set_history),
    startedAt: partido.started_at,
    scheduledAt: partido.scheduled_at,
    reglas: normalizarReglas(partido.reglas).partido,
    teams: {
      A: { id: partido.equipo_a_id, name: partido.equipo_a_nombre },
      B: { id: partido.equipo_b_id, name: partido.equipo_b_nombre }
    }
  };
}

function leerHistorial(valor: string) {
  try {
    const parsed = JSON.parse(valor);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * 304 si el navegador ya tiene esta versión, 200 con el cuerpo si no.
 *
 * `no-cache` y no `no-store`: el navegador tiene que poder guardar la respuesta
 * para poder mandar el `If-None-Match` la próxima vez, pero siempre revalidando.
 */
export function respuestaDirecto(request: Request, version: string, cuerpo: unknown | null): Response {
  const etag = etagDe(version);
  if (cuerpo === null) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "no-cache" } });
  }
  return json(cuerpo, 200, { ETag: etag, "Cache-Control": "no-cache" });
}

export const coincideEtag = (request: Request, version: string): boolean => {
  const recibido = request.headers.get("If-None-Match");
  return recibido !== null && recibido.split(",").some((valor) => valor.trim() === etagDe(version));
};
