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

const TALLAS = new Set(["XS", "S", "M", "L", "XL", "XXL"]);

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

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  if (type !== "camiseta") {
    return json({ error: "La acción no es válida." }, 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Los datos del formulario no son válidos." }, 400);
  }

  const resultado = validarReservaCamiseta(body);
  if ("campos" in resultado) {
    return json({ error: "Revisa los campos marcados.", campos: resultado.campos }, 400);
  }

  try {
    await env.DB
      .prepare(
        `INSERT INTO camisetas_reservas (owner_user_id, nombre, talla, cantidad, notas)
         VALUES (?1, ?2, ?3, ?4, ?5)`
      )
      .bind(
        admin.id,
        resultado.reserva.nombre,
        resultado.reserva.talla,
        resultado.reserva.cantidad,
        resultado.reserva.notas
      )
      .run();

    return json({ ok: true }, 201, { "Cache-Control": "no-store" });
  } catch (err) {
    console.error("Error guardando reserva desde panel admin:", err);
    if (isMissingShirtsTableError(err)) {
      return json(
        {
          error:
            "La base de datos no está actualizada: falta la tabla camisetas_reservas. Aplica la migración 0004_camisetas_reservas.sql."
        },
        500,
        { "Cache-Control": "no-store" }
      );
    }
    return json({ error: "No se ha podido guardar la reserva." }, 500, { "Cache-Control": "no-store" });
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
      const deleted = await borrarEquipo(env, id);
      if (!deleted) return json({ error: "Ese equipo ya no existe." }, 404, { "Cache-Control": "no-store" });
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

function validarReservaCamiseta(raw: unknown):
  | { reserva: { nombre: string; talla: string; cantidad: number; notas: string | null } }
  | { campos: Record<string, string> } {
  const campos: Record<string, string> = {};
  if (typeof raw !== "object" || raw === null) {
    return { campos: { nombre: "El formulario ha llegado vacío. Recarga la página e inténtalo de nuevo." } };
  }

  const body = raw as Record<string, unknown>;
  const nombre = limpiar(typeof body.nombre === "string" ? body.nombre : "");
  const talla = limpiar(typeof body.talla === "string" ? body.talla : "").toUpperCase();
  const cantidad = Number(body.cantidad);
  const notasRaw = limpiar(typeof body.notas === "string" ? body.notas : "");

  if (nombre.length < 2 || nombre.length > 80) {
    campos.nombre = "Indica el nombre de la persona que recoge la camiseta.";
  }
  if (!TALLAS.has(talla)) {
    campos.talla = "Elige una talla válida.";
  }
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10) {
    campos.cantidad = "Puedes reservar entre 1 y 10 camisetas.";
  }
  if (notasRaw.length > 240) {
    campos.notas = "Las notas no pueden pasar de 240 caracteres.";
  }

  if (Object.keys(campos).length > 0) return { campos };
  return { reserva: { nombre, talla, cantidad, notas: notasRaw || null } };
}

function limpiar(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isMissingShirtsTableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || "");
  return message.includes("camisetas_reservas") && message.toLowerCase().includes("no such table");
}

async function borrarEquipo(env: Env, equipoId: number): Promise<boolean> {
  const equipo = await env.DB.prepare("SELECT id FROM equipos WHERE id = ?1").bind(equipoId).first<{ id: number }>();
  if (!equipo) {
    return false;
  }

  const { results } = await env.DB
    .prepare("SELECT foto_key FROM jugadores WHERE equipo_id = ?1 AND foto_key IS NOT NULL")
    .bind(equipoId)
    .all<{ foto_key: string }>();

  await env.DB.batch([
    env.DB.prepare("DELETE FROM jugadores WHERE equipo_id = ?1").bind(equipoId),
    env.DB.prepare("DELETE FROM equipos WHERE id = ?1").bind(equipoId)
  ]);

  if (!env.FOTOS) return true;
  for (const item of results) {
    try {
      await env.FOTOS.delete(item.foto_key);
    } catch {
      // Borrado best-effort: el registro ya está fuera de D1.
    }
  }
  return true;
}
