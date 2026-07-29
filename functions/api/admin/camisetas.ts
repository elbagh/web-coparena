// /api/admin/camisetas
//   POST            crea una reserva a nombre del administrador
//   PATCH ?id=N     edita nombre, talla, cantidad, notas, edición y propietario
//   DELETE ?id=N    borra una reserva

import { requirePermiso, jsonAdmin, accionNoValida, idDeQuery, type AdminEnv } from "../../_lib/admin";
import { edicionActual } from "../../_lib/ediciones";
import { limpiar } from "../../_lib/validacion";

const TALLAS = new Set(["XS", "S", "M", "L", "XL", "XXL"]);

export const onRequestPost: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requirePermiso(request, env, "camisetas.editar");
  if (acceso instanceof Response) return acceso;

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
        acceso.user.id,
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

export const onRequestPatch: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requirePermiso(request, env, "camisetas.editar");
  if (acceso instanceof Response) return acceso;

  const id = idDeQuery(new URL(request.url));
  if (id === null) return accionNoValida();

  const existe = await env.DB.prepare("SELECT id FROM camisetas_reservas WHERE id = ?1").bind(id).first();
  if (!existe) return jsonAdmin({ error: "Esa reserva ya no existe." }, 404);

  const body = await request.json().catch(() => null);
  const resultado = validarReservaCamiseta(body);
  if ("campos" in resultado) {
    return jsonAdmin({ error: "Revisa los campos marcados.", campos: resultado.campos }, 400);
  }

  // Edición y propietario son opcionales: se dejan como estaban si no llegan.
  const datos = (body ?? {}) as Record<string, unknown>;
  const sets = ["nombre = ?1", "talla = ?2", "cantidad = ?3", "notas = ?4", "updated_at = datetime('now')"];
  const binds: (string | number | null)[] = [
    resultado.reserva.nombre,
    resultado.reserva.talla,
    resultado.reserva.cantidad,
    resultado.reserva.notas
  ];

  if (datos.edicionId !== undefined) {
    const edicionId = datos.edicionId === null || datos.edicionId === "" ? null : Number(datos.edicionId);
    if (edicionId !== null && !Number.isInteger(edicionId)) return accionNoValida();
    if (edicionId !== null) {
      const edicion = await env.DB.prepare("SELECT 1 FROM ediciones WHERE id = ?1").bind(edicionId).first();
      if (!edicion) {
        return jsonAdmin({ error: "Esa edición no existe.", campos: { edicionId: "Elige una edición válida." } }, 400);
      }
    }
    sets.push(`edicion_id = ?${binds.length + 1}`);
    binds.push(edicionId);
  }

  if (datos.ownerUserId !== undefined) {
    const ownerId = Number(datos.ownerUserId);
    if (!Number.isInteger(ownerId) || ownerId <= 0) return accionNoValida();
    const usuario = await env.DB.prepare("SELECT 1 FROM usuarios WHERE id = ?1").bind(ownerId).first();
    if (!usuario) {
      return jsonAdmin({ error: "Esa cuenta no existe.", campos: { ownerUserId: "Elige una cuenta válida." } }, 400);
    }
    sets.push(`owner_user_id = ?${binds.length + 1}`);
    binds.push(ownerId);
  }

  binds.push(id);

  try {
    await env.DB
      .prepare(`UPDATE camisetas_reservas SET ${sets.join(", ")} WHERE id = ?${binds.length}`)
      .bind(...binds)
      .run();
    return jsonAdmin({ ok: true });
  } catch (err) {
    console.error("Error editando una reserva desde el panel:", err);
    return jsonAdmin({ error: "No se ha podido guardar la reserva." }, 500);
  }
};

export const onRequestDelete: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requirePermiso(request, env, "camisetas.borrar");
  if (acceso instanceof Response) return acceso;

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
