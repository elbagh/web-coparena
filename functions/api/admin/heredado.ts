// GET /api/admin/heredado — tablas de la primera versión del sitio.
//
// `inscripciones` y `reservas` son del formulario antiguo de "nombre + email".
// Hoy nadie escribe en ellas: /inscripcion/ guarda en equipos+jugadores y las
// camisetas en camisetas_reservas. Se exponen solo para poder consultar lo que
// quedara dentro; no hay alta, edición ni borrado, y las tablas no se tocan.
//
// Si la base es anterior a esas tablas, se devuelve una lista vacía en vez de
// un error: no tenerlas es un estado válido, no un fallo.

import { requireAdmin, jsonAdmin, type AdminEnv } from "../../_lib/admin";

interface InscripcionRow {
  id: number;
  team_name: string;
  contact_email: string;
  created_at: string;
}

interface ReservaRow {
  id: number;
  name: string;
  contact: string;
  shirt_size: string | null;
  extras: string | null;
  created_at: string;
}

export const onRequestGet: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const [inscripciones, reservas] = await Promise.all([
    leer<InscripcionRow>(env.DB, "SELECT id, team_name, contact_email, created_at FROM inscripciones ORDER BY id DESC"),
    leer<ReservaRow>(env.DB, "SELECT id, name, contact, shirt_size, extras, created_at FROM reservas ORDER BY id DESC")
  ]);

  return jsonAdmin({
    inscripciones: inscripciones.map((fila) => ({
      id: fila.id,
      equipo: fila.team_name,
      email: fila.contact_email,
      createdAt: fila.created_at
    })),
    reservas: reservas.map((fila) => ({
      id: fila.id,
      nombre: fila.name,
      contacto: fila.contact,
      talla: fila.shirt_size,
      extras: fila.extras,
      createdAt: fila.created_at
    }))
  });
};

async function leer<T>(db: D1Database, sql: string): Promise<T[]> {
  try {
    const { results } = await db.prepare(sql).all<T>();
    return results;
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    if (mensaje.toLowerCase().includes("no such table")) return [];
    throw err;
  }
}
