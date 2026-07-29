// /api/admin/ediciones
//   GET             ediciones con su recuento de equipos + equipos con su puesto
//   POST            crea una edición (año + nombre), siempre en estado "proxima"
//   PATCH ?id=N     renombra, cambia estado o marca como actual
//   DELETE ?id=N    borra (bloqueado si es la actual o tiene equipos)
//
// El puesto final de cada equipo se fija desde /api/admin/equipos?accion=posicion:
// es una columna de `equipos`, aunque se edite desde esta pantalla.

import { requirePermiso, jsonAdmin, accionNoValida, idDeQuery, type AdminEnv } from "../../_lib/admin";
import { limpiar } from "../../_lib/validacion";

const ESTADOS = new Set(["proxima", "en_juego", "finalizada"]);

interface EdicionPanelRow {
  id: number;
  anio: number;
  nombre: string;
  estado: string;
  es_actual: number;
  equipos: number;
}

interface EquipoPuestoRow {
  id: number;
  nombre: string;
  edicion_id: number | null;
  posicion_final: number | null;
  edicion_anio: number | null;
}

export const onRequestGet: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requirePermiso(request, env, "ediciones.ver");
  if (acceso instanceof Response) return acceso;

  try {
    return await cargarPanel(env.DB);
  } catch (err) {
    console.error("Error leyendo ediciones y resultados:", err);
    return jsonAdmin({ error: "No se han podido cargar las ediciones." }, 500);
  }
};

export const onRequestPost: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requirePermiso(request, env, "ediciones.editar");
  if (acceso instanceof Response) return acceso;

  try {
    return await crearEdicion(env.DB, await request.json().catch(() => null));
  } catch (err) {
    console.error("Error creando una edición desde el panel:", err);
    return jsonAdmin({ error: "No se ha podido crear la edición." }, 500);
  }
};

export const onRequestPatch: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requirePermiso(request, env, "ediciones.editar");
  if (acceso instanceof Response) return acceso;

  const id = idDeQuery(new URL(request.url));
  if (id === null) return accionNoValida();

  try {
    return await actualizarEdicion(env.DB, id, await request.json().catch(() => null));
  } catch (err) {
    console.error("Error actualizando una edición:", err);
    return jsonAdmin({ error: "No se ha podido actualizar la edición." }, 500);
  }
};

export const onRequestDelete: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requirePermiso(request, env, "ediciones.borrar");
  if (acceso instanceof Response) return acceso;

  const id = idDeQuery(new URL(request.url));
  if (id === null) return accionNoValida();

  try {
    return await borrarEdicion(env.DB, id);
  } catch (err) {
    console.error("Error borrando una edición:", err);
    return jsonAdmin({ error: "No se ha podido borrar la edición." }, 500);
  }
};

async function cargarPanel(db: D1Database): Promise<Response> {
  const [ediciones, equipos] = await Promise.all([
    db
      .prepare(
        `SELECT ed.id, ed.anio, ed.nombre, ed.estado, ed.es_actual,
                (SELECT COUNT(*) FROM equipos e WHERE e.edicion_id = ed.id) AS equipos
         FROM ediciones ed
         ORDER BY ed.anio DESC, ed.id DESC`
      )
      .all<EdicionPanelRow>(),
    db
      .prepare(
        `SELECT e.id, e.nombre, e.edicion_id, e.posicion_final, ed.anio AS edicion_anio
         FROM equipos e
         LEFT JOIN ediciones ed ON ed.id = e.edicion_id
         ORDER BY (e.posicion_final IS NULL) ASC, e.posicion_final ASC, e.nombre COLLATE NOCASE ASC`
      )
      .all<EquipoPuestoRow>()
  ]);

  return jsonAdmin({
    ediciones: ediciones.results.map((e) => ({
      id: e.id,
      anio: e.anio,
      nombre: e.nombre,
      estado: e.estado,
      esActual: e.es_actual === 1,
      equipos: e.equipos
    })),
    equipos: equipos.results.map((e) => ({
      id: e.id,
      nombre: e.nombre,
      edicionId: e.edicion_id,
      edicionAnio: e.edicion_anio,
      posicionFinal: e.posicion_final
    }))
  });
}

async function crearEdicion(db: D1Database, raw: unknown): Promise<Response> {
  const body = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const campos: Record<string, string> = {};

  const anio = Number(body.anio);
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) {
    campos.anio = "Indica un año entre 2000 y 2100.";
  }
  const nombre = limpiar(body.nombre);
  if (nombre.length < 2 || nombre.length > 60) {
    campos.nombre = "El nombre debe tener entre 2 y 60 caracteres.";
  }
  if (Object.keys(campos).length > 0) {
    return jsonAdmin({ error: "Revisa los campos marcados.", campos }, 400);
  }

  const existe = await db.prepare("SELECT 1 FROM ediciones WHERE anio = ?1").bind(anio).first();
  if (existe) {
    return jsonAdmin(
      { error: "Ya hay una edición con ese año.", campos: { anio: "Ya existe una edición de ese año." } },
      409
    );
  }

  await db
    .prepare("INSERT INTO ediciones (anio, nombre, estado, es_actual) VALUES (?1, ?2, 'proxima', 0)")
    .bind(anio, nombre)
    .run();
  return cargarPanel(db);
}

async function actualizarEdicion(db: D1Database, id: number, raw: unknown): Promise<Response> {
  const edicion = await db
    .prepare("SELECT id, es_actual FROM ediciones WHERE id = ?1")
    .bind(id)
    .first<{ id: number; es_actual: number }>();
  if (!edicion) return jsonAdmin({ error: "Esa edición ya no existe." }, 404);

  const body = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const campos: Record<string, string> = {};
  const sets: string[] = [];
  const binds: (string | number)[] = [];

  if (body.nombre !== undefined) {
    const nombre = limpiar(body.nombre);
    if (nombre.length < 2 || nombre.length > 60) {
      campos.nombre = "El nombre debe tener entre 2 y 60 caracteres.";
    } else {
      sets.push(`nombre = ?${binds.length + 1}`);
      binds.push(nombre);
    }
  }
  if (body.estado !== undefined) {
    const estado = String(body.estado);
    if (!ESTADOS.has(estado)) {
      campos.estado = "Estado no válido.";
    } else {
      sets.push(`estado = ?${binds.length + 1}`);
      binds.push(estado);
    }
  }
  if (Object.keys(campos).length > 0) {
    return jsonAdmin({ error: "Revisa los campos marcados.", campos }, 400);
  }

  const statements: D1PreparedStatement[] = [];
  if (sets.length > 0) {
    binds.push(id);
    statements.push(db.prepare(`UPDATE ediciones SET ${sets.join(", ")} WHERE id = ?${binds.length}`).bind(...binds));
  }
  // Solo puede haber una edición actual (índice UNIQUE parcial): primero se
  // limpian las demás y luego se marca esta, en ese orden dentro del batch.
  if (body.esActual === true && edicion.es_actual !== 1) {
    statements.push(db.prepare("UPDATE ediciones SET es_actual = 0 WHERE es_actual = 1"));
    statements.push(db.prepare("UPDATE ediciones SET es_actual = 1 WHERE id = ?1").bind(id));
  }

  if (statements.length === 0) {
    return jsonAdmin({ error: "No hay cambios que guardar." }, 400);
  }

  await db.batch(statements);
  return cargarPanel(db);
}

async function borrarEdicion(db: D1Database, id: number): Promise<Response> {
  const edicion = await db
    .prepare("SELECT id, es_actual FROM ediciones WHERE id = ?1")
    .bind(id)
    .first<{ id: number; es_actual: number }>();
  if (!edicion) return jsonAdmin({ error: "Esa edición ya no existe." }, 404);

  if (edicion.es_actual === 1) {
    return jsonAdmin({ error: "No puedes borrar la edición actual. Marca otra como actual primero." }, 409);
  }
  const enUso = await db.prepare("SELECT 1 FROM equipos WHERE edicion_id = ?1 LIMIT 1").bind(id).first();
  if (enUso) {
    return jsonAdmin({ error: "No puedes borrar una edición con equipos vinculados." }, 409);
  }

  await db.prepare("DELETE FROM ediciones WHERE id = ?1").bind(id).run();
  return jsonAdmin({ ok: true });
}
