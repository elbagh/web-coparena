import { requireAdmin } from "../_lib/admin";
import { publicUser } from "../_lib/auth";
import { json } from "../_lib/http";

interface Env {
  DB: D1Database;
  FOTOS?: R2Bucket;
  SESSION_SECRET: string;
}

interface EquipoRow {
  id: number;
  nombre: string;
  created_at: string;
  owner_email: string | null;
  owner_name: string | null;
  jugadores: number;
}

interface JugadorRow {
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

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  try {
    const [equipos, jugadores, camisetas] = await Promise.all([
      cargarEquipos(env.DB),
      cargarJugadores(env.DB),
      cargarCamisetas(env.DB)
    ]);

    const jugadoresPorEquipo = new Map<number, ReturnType<typeof mapJugador>[]>();
    jugadores.forEach((jugador) => {
      const lista = jugadoresPorEquipo.get(jugador.equipo_id) || [];
      lista.push(mapJugador(jugador));
      jugadoresPorEquipo.set(jugador.equipo_id, lista);
    });

    const equiposConJugadores = equipos.map((equipo) => ({
      id: equipo.id,
      nombre: equipo.nombre,
      createdAt: equipo.created_at,
      ownerEmail: equipo.owner_email,
      ownerName: equipo.owner_name,
      jugadores: jugadoresPorEquipo.get(equipo.id) || [],
      jugadoresTotal: equipo.jugadores
    }));

    return json(
      {
        admin: publicUser(admin),
        stats: {
          equipos: equipos.length,
          jugadores: jugadores.length,
          camisetas: camisetas.reduce((total, item) => total + item.cantidad, 0),
          reservasCamisetas: camisetas.length
        },
        equipos: equiposConJugadores,
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
      },
      200,
      { "Cache-Control": "no-store" }
    );
  } catch (err) {
    console.error("Error leyendo panel admin:", err);
    return json({ error: "No se ha podido cargar el panel de administración." }, 500);
  }
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const id = Number(url.searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0 || !["equipo", "camiseta"].includes(type || "")) {
    return json({ error: "La acción no es válida." }, 400);
  }

  try {
    if (type === "equipo") {
      await borrarEquipo(env, id);
    } else {
      await env.DB.prepare("DELETE FROM camisetas_reservas WHERE id = ?1").bind(id).run();
    }

    return json({ ok: true }, 200, { "Cache-Control": "no-store" });
  } catch (err) {
    console.error("Error borrando desde panel admin:", err);
    return json({ error: "No se ha podido completar la acción." }, 500);
  }
};

async function cargarEquipos(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT e.id, e.nombre, e.created_at, u.email AS owner_email, u.nombre AS owner_name, COUNT(j.id) AS jugadores
       FROM equipos e
       LEFT JOIN usuarios u ON u.id = e.owner_user_id
       LEFT JOIN jugadores j ON j.equipo_id = e.id
       GROUP BY e.id
       ORDER BY e.created_at DESC, e.id DESC`
    )
    .all<EquipoRow>();
  return results;
}

async function cargarJugadores(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT id, equipo_id, nombre, apellidos, telefono, email, red_social, foto_key, es_suplente, orden
       FROM jugadores
       ORDER BY equipo_id DESC, orden ASC, id ASC`
    )
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

function mapJugador(jugador: JugadorRow) {
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

async function borrarEquipo(env: Env, equipoId: number): Promise<void> {
  const { results } = await env.DB
    .prepare("SELECT foto_key FROM jugadores WHERE equipo_id = ?1 AND foto_key IS NOT NULL")
    .bind(equipoId)
    .all<{ foto_key: string }>();

  await env.DB.batch([
    env.DB.prepare("DELETE FROM jugadores WHERE equipo_id = ?1").bind(equipoId),
    env.DB.prepare("DELETE FROM equipos WHERE id = ?1").bind(equipoId)
  ]);

  if (!env.FOTOS) return;
  for (const item of results) {
    try {
      await env.FOTOS.delete(item.foto_key);
    } catch {
      // Borrado best-effort: el registro ya está fuera de D1.
    }
  }
}
