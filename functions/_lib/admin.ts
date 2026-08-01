import { requireUser, type AuthEnv, type UsuarioSesion } from "./auth";
import { json } from "./http";
import { permisosDeUsuario, tieneAlguno, type ContextoPermisos, type Permiso } from "./permisos";

export interface AdminEnv extends AuthEnv {
  DB: D1Database;
  FOTOS?: R2Bucket;
}

export interface Acceso {
  user: UsuarioSesion;
  permisos: ContextoPermisos;
}

/**
 * Puerta de las rutas del panel. Sustituye al viejo `requireAdmin`: cada
 * endpoint dice qué permiso concreto exige, en vez de pedir «ser admin».
 *
 * El rol no viaja en la sesión: se relee de la base en cada petición, así que
 * quitarle el rol a alguien lo deja fuera al momento, sin esperar a que caduque
 * la cookie.
 */
export async function requirePermiso(
  request: Request,
  env: AdminEnv,
  permiso: Permiso
): Promise<Acceso | Response> {
  return requireAlgunPermiso(request, env, [permiso]);
}

/** Igual, pero basta con tener uno de los de la lista. */
export async function requireAlgunPermiso(
  request: Request,
  env: AdminEnv,
  permisos: readonly Permiso[]
): Promise<Acceso | Response> {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  const contexto = await permisosDeUsuario(env.DB, user.id);
  if (tieneAlguno(contexto, permisos)) return { user, permisos: contexto };

  return json({ error: "No tienes permiso para hacer eso en el panel de administración." }, 403);
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
    telefono: jugador.telefono || null,
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
      `SELECT e.id, e.nombre, e.created_at, e.foto_key, e.edicion_id, e.capitan_jugador_id, e.siglas,
              c.email AS capitan_email, c.nombre AS capitan_nombre, c.apellidos AS capitan_apellidos
       FROM equipos e
       LEFT JOIN jugadores c ON c.id = e.capitan_jugador_id
       WHERE e.id = ?1`
    )
    .bind(equipoId)
    .first<{
      id: number;
      nombre: string;
      created_at: string;
      foto_key: string | null;
      edicion_id: number | null;
      capitan_jugador_id: number | null;
      siglas: string | null;
      capitan_email: string | null;
      capitan_nombre: string | null;
      capitan_apellidos: string | null;
    }>();
  if (!equipo) return null;

  const { results: jugadores } = await db
    .prepare(`SELECT ${SELECT_JUGADOR} FROM jugadores WHERE equipo_id = ?1 ORDER BY orden ASC, id ASC`)
    .bind(equipoId)
    .all<JugadorRow>();

  return {
    id: equipo.id,
    nombre: equipo.nombre,
    createdAt: equipo.created_at,
    tieneFoto: Boolean(equipo.foto_key),
    edicionId: equipo.edicion_id,
    capitanJugadorId: equipo.capitan_jugador_id,
    capitanEmail: equipo.capitan_email,
    capitanNombre: [equipo.capitan_nombre, equipo.capitan_apellidos].filter(Boolean).join(" ") || null,
    siglas: equipo.siglas,
    jugadores: jugadores.map(mapJugador),
    jugadoresTotal: jugadores.length
  };
}
