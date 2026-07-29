// GET /api/admin — resumen del panel: contadores, equipos con sus jugadores y
// reservas de camiseta. Es lo primero que carga cualquier sección, y de aquí
// salen también los contadores de la barra lateral y la edición activa.

import {
  requireAdmin,
  jsonAdmin,
  mapJugador,
  SELECT_JUGADOR,
  type AdminEnv,
  type JugadorRow
} from "../../_lib/admin";
import { publicUser } from "../../_lib/auth";
import { edicionActual } from "../../_lib/ediciones";

interface EquipoRow {
  id: number;
  nombre: string;
  created_at: string;
  foto_key: string | null;
  edicion_id: number | null;
  capitan_jugador_id: number | null;
  capitan_email: string | null;
  capitan_nombre: string | null;
  capitan_apellidos: string | null;
  jugadores: number;
}

interface CamisetaRow {
  id: number;
  nombre: string;
  talla: string;
  cantidad: number;
  notas: string | null;
  created_at: string;
  owner_email: string | null;
  owner_name: string | null;
}

export const onRequestGet: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  try {
    const [equipos, jugadores, camisetas, edicion] = await Promise.all([
      cargarEquipos(env.DB),
      cargarJugadores(env.DB),
      cargarCamisetas(env.DB),
      edicionActual(env.DB).catch(() => null)
    ]);

    const jugadoresPorEquipo = new Map<number, ReturnType<typeof mapJugador>[]>();
    jugadores.forEach((jugador) => {
      const lista = jugadoresPorEquipo.get(jugador.equipo_id) || [];
      lista.push(mapJugador(jugador));
      jugadoresPorEquipo.set(jugador.equipo_id, lista);
    });

    return jsonAdmin({
      admin: publicUser(admin),
      edicion,
      stats: {
        equipos: equipos.length,
        jugadores: jugadores.length,
        camisetas: camisetas.reduce((total, item) => total + item.cantidad, 0),
        reservasCamisetas: camisetas.length
      },
      equipos: equipos.map((equipo) => ({
        id: equipo.id,
        nombre: equipo.nombre,
        createdAt: equipo.created_at,
        tieneFoto: Boolean(equipo.foto_key),
        edicionId: equipo.edicion_id,
        capitanJugadorId: equipo.capitan_jugador_id,
        capitanEmail: equipo.capitan_email,
        capitanNombre: [equipo.capitan_nombre, equipo.capitan_apellidos].filter(Boolean).join(" ") || null,
        jugadores: jugadoresPorEquipo.get(equipo.id) || [],
        jugadoresTotal: equipo.jugadores
      })),
      camisetas: camisetas.map((item) => ({
        id: item.id,
        nombre: item.nombre,
        talla: item.talla,
        cantidad: item.cantidad,
        notas: item.notas,
        createdAt: item.created_at,
        ownerEmail: item.owner_email,
        ownerName: item.owner_name
      }))
    });
  } catch (err) {
    console.error("Error leyendo el resumen del panel:", err);
    return jsonAdmin({ error: "No se ha podido cargar el panel de administración." }, 500);
  }
};

async function cargarEquipos(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT e.id, e.nombre, e.created_at, e.foto_key, e.edicion_id, e.capitan_jugador_id,
              c.email AS capitan_email, c.nombre AS capitan_nombre, c.apellidos AS capitan_apellidos,
              COUNT(j.id) AS jugadores
       FROM equipos e
       LEFT JOIN jugadores c ON c.id = e.capitan_jugador_id
       LEFT JOIN jugadores j ON j.equipo_id = e.id
       GROUP BY e.id
       ORDER BY e.created_at DESC, e.id DESC`
    )
    .all<EquipoRow>();
  return results;
}

async function cargarJugadores(db: D1Database) {
  const { results } = await db
    .prepare(`SELECT ${SELECT_JUGADOR} FROM jugadores ORDER BY equipo_id DESC, orden ASC, id ASC`)
    .all<JugadorRow>();
  return results;
}

async function cargarCamisetas(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT r.id, r.nombre, r.talla, r.cantidad, r.notas, r.created_at,
              u.email AS owner_email, u.nombre AS owner_name
       FROM camisetas_reservas r
       LEFT JOIN usuarios u ON u.id = r.owner_user_id
       ORDER BY r.created_at DESC, r.id DESC`
    )
    .all<CamisetaRow>();
  return results;
}
