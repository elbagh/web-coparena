import { requireUser } from "../_lib/auth";
import { json } from "../_lib/http";

interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
}

interface ReservaRow {
  id: number;
  nombre: string;
  talla: string;
  cantidad: number;
  notas: string | null;
  created_at: string;
}

const TALLAS = new Set(["XS", "S", "M", "L", "XL", "XXL"]);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  try {
    const reservas = await cargarReservas(env.DB, user.id);
    return json({ reservas }, 200, { "Cache-Control": "no-store" });
  } catch (err) {
    console.error("Error leyendo reservas de camisetas:", err);
    return json({ error: "No se han podido cargar tus camisetas." }, 500);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Los datos del formulario no son válidos." }, 400);
  }

  const resultado = validarReserva(body);
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
        user.id,
        resultado.reserva.nombre,
        resultado.reserva.talla,
        resultado.reserva.cantidad,
        resultado.reserva.notas
      )
      .run();

    const reservas = await cargarReservas(env.DB, user.id);
    return json({ ok: true, reservas }, 201, { "Cache-Control": "no-store" });
  } catch (err) {
    console.error("Error guardando reserva de camiseta:", err);
    return json({ error: "No se ha podido guardar la reserva." }, 500);
  }
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return json({ error: "La reserva no es válida." }, 400);
  }

  try {
    await env.DB
      .prepare("DELETE FROM camisetas_reservas WHERE id = ?1 AND owner_user_id = ?2")
      .bind(id, user.id)
      .run();
    const reservas = await cargarReservas(env.DB, user.id);
    return json({ ok: true, reservas }, 200, { "Cache-Control": "no-store" });
  } catch (err) {
    console.error("Error borrando reserva de camiseta:", err);
    return json({ error: "No se ha podido borrar la reserva." }, 500);
  }
};

async function cargarReservas(db: D1Database, userId: number) {
  const { results } = await db
    .prepare(
      `SELECT id, nombre, talla, cantidad, notas, created_at
       FROM camisetas_reservas
       WHERE owner_user_id = ?1
       ORDER BY created_at DESC, id DESC`
    )
    .bind(userId)
    .all<ReservaRow>();

  return results.map((reserva) => ({
    id: reserva.id,
    nombre: reserva.nombre,
    talla: reserva.talla,
    cantidad: reserva.cantidad,
    notas: reserva.notas,
    createdAt: reserva.created_at
  }));
}

function validarReserva(raw: unknown):
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
