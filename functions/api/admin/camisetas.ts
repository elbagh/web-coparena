// /api/admin/camisetas
//   POST            crea una reserva a nombre del administrador
//   DELETE ?id=N    borra una reserva

import { requireAdmin, jsonAdmin, accionNoValida, idDeQuery, type AdminEnv } from "../../_lib/admin";
import { edicionActual } from "../../_lib/ediciones";
import { limpiar } from "../../_lib/validacion";

const TALLAS = new Set(["XS", "S", "M", "L", "XL", "XXL"]);

export const onRequestPost: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonAdmin({ error: "Los datos del formulario no son válidos." }, 400);
  }

  const resultado = validarReservaCamiseta(body);
  if ("campos" in resultado) {
    return jsonAdmin({ error: "Revisa los campos marcados.", campos: resultado.campos }, 400);
  }

  try {
    // La edición se fija igual que en el alta pública (/api/camisetas): sin
    // ella la reserva sale sin año en el perfil de quien la recoge.
    const edicion = await edicionActual(env.DB).catch(() => null);

    await env.DB
      .prepare(
        `INSERT INTO camisetas_reservas (owner_user_id, nombre, talla, cantidad, notas, edicion_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
      )
      .bind(
        admin.id,
        resultado.reserva.nombre,
        resultado.reserva.talla,
        resultado.reserva.cantidad,
        resultado.reserva.notas,
        edicion?.id ?? null
      )
      .run();

    return jsonAdmin({ ok: true }, 201);
  } catch (err) {
    console.error("Error guardando una reserva desde el panel:", err);
    if (faltaTablaCamisetas(err)) {
      return jsonAdmin(
        {
          error:
            "La base de datos no está actualizada: falta la tabla camisetas_reservas. Aplica la migración 0004_camisetas_reservas.sql."
        },
        500
      );
    }
    return jsonAdmin({ error: "No se ha podido guardar la reserva." }, 500);
  }
};

export const onRequestDelete: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const id = idDeQuery(new URL(request.url));
  if (id === null) return accionNoValida();

  try {
    await env.DB.prepare("DELETE FROM camisetas_reservas WHERE id = ?1").bind(id).run();
    return jsonAdmin({ ok: true });
  } catch (err) {
    console.error("Error borrando una reserva desde el panel:", err);
    return jsonAdmin({ error: "No se ha podido borrar la reserva." }, 500);
  }
};

function validarReservaCamiseta(raw: unknown):
  | { reserva: { nombre: string; talla: string; cantidad: number; notas: string | null } }
  | { campos: Record<string, string> } {
  if (typeof raw !== "object" || raw === null) {
    return { campos: { nombre: "El formulario ha llegado vacío. Recarga la página e inténtalo de nuevo." } };
  }

  const body = raw as Record<string, unknown>;
  const campos: Record<string, string> = {};
  const nombre = limpiar(body.nombre);
  const talla = limpiar(body.talla).toUpperCase();
  const cantidad = Number(body.cantidad);
  const notas = limpiar(body.notas);

  if (nombre.length < 2 || nombre.length > 80) {
    campos.nombre = "Indica el nombre de la persona que recoge la camiseta.";
  }
  if (!TALLAS.has(talla)) {
    campos.talla = "Elige una talla válida.";
  }
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10) {
    campos.cantidad = "Puedes reservar entre 1 y 10 camisetas.";
  }
  if (notas.length > 240) {
    campos.notas = "Las notas no pueden pasar de 240 caracteres.";
  }

  if (Object.keys(campos).length > 0) return { campos };
  return { reserva: { nombre, talla, cantidad, notas: notas || null } };
}

function faltaTablaCamisetas(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || "");
  return message.includes("camisetas_reservas") && message.toLowerCase().includes("no such table");
}
