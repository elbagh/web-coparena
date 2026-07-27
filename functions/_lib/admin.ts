import { requireUser, type AuthEnv, type UsuarioSesion } from "./auth";
import { json } from "./http";

export interface AdminEnv extends AuthEnv {
  DB: D1Database;
  FOTOS?: R2Bucket;
}

/**
 * Puerta de todas las rutas /api/admin/*. El flag no viaja en la sesión: se
 * relee de la base en cada petición, así que revocar `is_admin` tiene efecto
 * inmediato sin esperar a que caduque la cookie.
 */
export async function requireAdmin(request: Request, env: AdminEnv): Promise<UsuarioSesion | Response> {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  const row = await env.DB
    .prepare("SELECT is_admin FROM usuarios WHERE id = ?1")
    .bind(user.id)
    .first<{ is_admin: number | null }>();

  if (row?.is_admin === 1) return user;
  return json({ error: "No tienes permiso para entrar en el panel de administración." }, 403);
}

/** Respuesta JSON del panel: nada de lo que sirve se cachea. */
export const jsonAdmin = (data: unknown, status = 200): Response =>
  json(data, status, { "Cache-Control": "no-store" });

export const accionNoValida = (): Response => jsonAdmin({ error: "La acción no es válida." }, 400);

/** Lee un id entero positivo de la query. null si no es válido. */
export function idDeQuery(url: URL, nombre = "id"): number | null {
  const id = Number(url.searchParams.get(nombre));
  return Number.isInteger(id) && id > 0 ? id : null;
}

// ---------------------------------------------------------------------------
// Filas y mapeos compartidos entre las rutas del panel
// ---------------------------------------------------------------------------

export interface JugadorRow {
  id: number;
  equipo_id: number;
  nombre: string;
  apellidos: string;
  telefono: string;
  email: string | null;
  red_social: string | null;
  foto_key: string | null;
  es_suplente: number;
  orden: number;
}

export const SELECT_JUGADOR =
  "id, equipo_id, nombre, apellidos, telefono, email, red_social, foto_key, es_suplente, orden";

/** La clave de R2 nunca sale al cliente: solo si hay foto o no. */
export function mapJugador(jugador: JugadorRow) {
  return {
    id: jugador.id,
    nombre: jugador.nombre,
    apellidos: jugador.apellidos,
    telefono: jugador.telefono,
    email: jugador.email,
    redSocial: jugador.red_social,
    tieneFoto: Boolean(jugador.foto_key),
    esSuplente: jugador.es_suplente === 1,
    orden: jugador.orden
  };
}

export async function cargarEquipoConJugadores(db: D1Database, equipoId: number) {
  const equipo = await db
    .prepare(
      `SELECT e.id, e.nombre, e.created_at, u.email AS owner_email, u.nombre AS owner_name
       FROM equipos e
       LEFT JOIN usuarios u ON u.id = e.owner_user_id
       WHERE e.id = ?1`
    )
    .bind(equipoId)
    .first<{ id: number; nombre: string; created_at: string; owner_email: string | null; owner_name: string | null }>();
  if (!equipo) return null;

  const { results: jugadores } = await db
    .prepare(`SELECT ${SELECT_JUGADOR} FROM jugadores WHERE equipo_id = ?1 ORDER BY orden ASC, id ASC`)
    .bind(equipoId)
    .all<JugadorRow>();

  return {
    id: equipo.id,
    nombre: equipo.nombre,
    createdAt: equipo.created_at,
    ownerEmail: equipo.owner_email,
    ownerName: equipo.owner_name,
    jugadores: jugadores.map(mapJugador),
    jugadoresTotal: jugadores.length
  };
}
