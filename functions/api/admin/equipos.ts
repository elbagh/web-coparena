// /api/admin/equipos
//   PATCH ?id=N                  editor completo del equipo (multipart)
//   PATCH ?id=N&accion=posicion  puesto final del equipo en su edición
//   DELETE ?id=N                 borra el equipo con sus jugadores y sus fotos

import {
  requireAdmin,
  jsonAdmin,
  accionNoValida,
  idDeQuery,
  cargarEquipoConJugadores,
  type AdminEnv
} from "../../_lib/admin";
import { buscarDuplicadosEdicion, mapearConflictoUnicoEdicion } from "../../_lib/equipos";
import { limpiarFotos, subirFoto } from "../../_lib/fotos";
import { MAX_BODY_BYTES, validarRegistro, validarFoto } from "../../_lib/validacion";

export const onRequestPatch: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const url = new URL(request.url);
  const equipoId = idDeQuery(url);
  if (equipoId === null) return accionNoValida();

  if (url.searchParams.get("accion") === "posicion") {
    try {
      return await fijarPosicionFinal(env.DB, equipoId, await request.json().catch(() => null));
    } catch (err) {
      console.error("Error fijando el puesto de un equipo:", err);
      return jsonAdmin({ error: "No se ha podido guardar el puesto." }, 500);
    }
  }

  return editarEquipo(request, env, equipoId);
};

export const onRequestDelete: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const equipoId = idDeQuery(new URL(request.url));
  if (equipoId === null) return accionNoValida();

  try {
    const equipo = await env.DB.prepare("SELECT id FROM equipos WHERE id = ?1").bind(equipoId).first<{ id: number }>();
    if (!equipo) return jsonAdmin({ error: "Ese equipo ya no existe." }, 404);

    const { results } = await env.DB
      .prepare("SELECT foto_key FROM jugadores WHERE equipo_id = ?1 AND foto_key IS NOT NULL")
      .bind(equipoId)
      .all<{ foto_key: string }>();

    await env.DB.batch([
      env.DB.prepare("DELETE FROM jugadores WHERE equipo_id = ?1").bind(equipoId),
      env.DB.prepare("DELETE FROM equipos WHERE id = ?1").bind(equipoId)
    ]);

    await limpiarFotos(env.FOTOS, results.map((item) => item.foto_key));
    return jsonAdmin({ ok: true });
  } catch (err) {
    console.error("Error borrando un equipo desde el panel:", err);
    return jsonAdmin({ error: "No se ha podido borrar el equipo." }, 500);
  }
};

/**
 * Guardado incremental por id de jugador: los que llegan con id se actualizan
 * en su sitio (conservando foto_key), los que faltan se borran y los nuevos se
 * insertan. Las fotos se validan y se suben a R2 *antes* de tocar D1, y si el
 * batch falla se revierten las subidas, de forma que nunca queda una clave en
 * la base apuntando a un objeto que no existe.
 */
async function editarEquipo(request: Request, env: AdminEnv, equipoId: number): Promise<Response> {
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return jsonAdmin({ error: "La petición es demasiado grande. Cada foto puede ocupar como máximo 4 MB." }, 413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonAdmin({ error: "El formulario debe enviarse como multipart/form-data." }, 400);
  }

  const payloadRaw = formData.get("payload");
  let payload: unknown;
  try {
    payload = JSON.parse(typeof payloadRaw === "string" ? payloadRaw : "");
  } catch {
    return jsonAdmin({ error: "Los datos del formulario no son válidos." }, 400);
  }

  const resultado = validarRegistro(payload, { requireConsent: false, requirePlayerEmail: true });
  if ("campos" in resultado) {
    return jsonAdmin({ error: "Revisa los campos marcados.", campos: resultado.campos }, 400);
  }
  const registro = resultado.registro;

  const equipoActual = await env.DB.prepare("SELECT id FROM equipos WHERE id = ?1").bind(equipoId).first<{ id: number }>();
  if (!equipoActual) return jsonAdmin({ error: "Ese equipo ya no existe." }, 404);

  const { results: jugadoresActuales } = await env.DB
    .prepare("SELECT id, foto_key FROM jugadores WHERE equipo_id = ?1")
    .bind(equipoId)
    .all<{ id: number; foto_key: string | null }>();
  const actualesPorId = new Map(jugadoresActuales.map((j) => [j.id, j.foto_key]));

  for (const j of registro.jugadores) {
    if (j.id !== undefined && !actualesPorId.has(j.id)) {
      return jsonAdmin({ error: "Alguno de los jugadores no pertenece a este equipo." }, 400);
    }
  }

  const duplicados = await buscarDuplicadosEdicion(env.DB, registro, equipoId);
  if (Object.keys(duplicados).length > 0) {
    return jsonAdmin({ error: "Hay datos que ya están registrados.", campos: duplicados }, 409);
  }

  // Fotos nuevas: tamaño, tipo y magic bytes antes de tocar R2 o D1.
  const fotosNuevas = new Map<number, { buffer: ArrayBuffer; ext: "jpg" | "png" | "webp" }>();
  const camposFoto: Record<string, string> = {};
  for (let i = 0; i < registro.jugadores.length; i++) {
    const entrada = formData.get(`foto_${i}`);
    if (!(entrada instanceof File) || entrada.size === 0) continue;
    const buffer = await entrada.arrayBuffer();
    const foto = validarFoto(buffer, entrada.type, entrada.size);
    if ("error" in foto) {
      camposFoto[`jugadores.${i}.foto`] = foto.error;
    } else {
      fotosNuevas.set(i, { buffer, ext: foto.ext });
    }
  }
  if (Object.keys(camposFoto).length > 0) {
    return jsonAdmin({ error: "Revisa los campos marcados.", campos: camposFoto }, 400);
  }
  if (fotosNuevas.size > 0 && !env.FOTOS) {
    return jsonAdmin({ error: "No se han podido guardar las fotos." }, 500);
  }

  const clavesNuevas: string[] = [];
  const clavePorIndice = new Map<number, string>();
  if (env.FOTOS) {
    const lote = crypto.randomUUID();
    try {
      for (const [i, foto] of fotosNuevas) {
        const key = `equipos/${lote}/jugador-${i + 1}.${foto.ext}`;
        await subirFoto(env.FOTOS, key, foto.buffer, foto.ext);
        clavesNuevas.push(key);
        clavePorIndice.set(i, key);
      }
    } catch (err) {
      console.error("Error subiendo foto a R2 desde el panel:", err);
      await limpiarFotos(env.FOTOS, clavesNuevas);
      return jsonAdmin({ error: "No se han podido guardar las fotos." }, 500);
    }
  }

  // Los jugadores actuales cuyo id no viene en el payload se borran.
  const idsEnviados = new Set(registro.jugadores.filter((j) => j.id !== undefined).map((j) => j.id as number));
  const idsABorrar = jugadoresActuales.filter((j) => !idsEnviados.has(j.id)).map((j) => j.id);
  const clavesABorrar: string[] = jugadoresActuales
    .filter((j) => idsABorrar.includes(j.id) && j.foto_key)
    .map((j) => j.foto_key as string);

  const statements = [
    env.DB
      .prepare("UPDATE equipos SET nombre = ?1, nombre_normalizado = ?2 WHERE id = ?3")
      .bind(registro.equipo, registro.equipoNormalizado, equipoId)
  ];

  if (idsABorrar.length > 0) {
    statements.push(
      env.DB.prepare(`DELETE FROM jugadores WHERE id IN (${idsABorrar.map(() => "?").join(",")})`).bind(...idsABorrar)
    );
  }

  registro.jugadores.forEach((j, i) => {
    const esSuplente = i >= 2 ? 1 : 0;
    const orden = i + 1;
    const fotoNueva = clavePorIndice.get(i);

    if (j.id !== undefined) {
      const fotoActual = actualesPorId.get(j.id) ?? null;
      let fotoKey: string | null;
      if (fotoNueva) {
        fotoKey = fotoNueva;
        if (fotoActual) clavesABorrar.push(fotoActual);
      } else if (j.eliminarFoto) {
        fotoKey = null;
        if (fotoActual) clavesABorrar.push(fotoActual);
      } else {
        fotoKey = fotoActual;
      }
      statements.push(
        env.DB
          .prepare(
            `UPDATE jugadores SET nombre = ?1, apellidos = ?2, nombre_completo_normalizado = ?3,
               telefono = ?4, telefono_normalizado = ?5, email = ?6, email_normalizado = ?7,
               red_social = ?8, foto_key = ?9, es_suplente = ?10, orden = ?11
             WHERE id = ?12`
          )
          .bind(
            j.nombre,
            j.apellidos,
            j.nombreCompletoNormalizado,
            j.telefono,
            j.telefonoNormalizado,
            j.email,
            j.emailNormalizado,
            j.redSocial,
            fotoKey,
            esSuplente,
            orden,
            j.id
          )
      );
    } else {
      statements.push(
        env.DB
          .prepare(
            `INSERT INTO jugadores (
               equipo_id, nombre, apellidos, nombre_completo_normalizado,
               telefono, telefono_normalizado, email, email_normalizado,
               red_social, foto_key, es_suplente, orden, edicion_id
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
               (SELECT edicion_id FROM equipos WHERE id = ?1))`
          )
          .bind(
            equipoId,
            j.nombre,
            j.apellidos,
            j.nombreCompletoNormalizado,
            j.telefono,
            j.telefonoNormalizado,
            j.email,
            j.emailNormalizado,
            j.redSocial,
            fotoNueva ?? null,
            esSuplente,
            orden
          )
      );
    }
  });

  try {
    await env.DB.batch(statements);
  } catch (err) {
    await limpiarFotos(env.FOTOS, clavesNuevas);
    const conflicto = mapearConflictoUnicoEdicion(err);
    if (conflicto) {
      return jsonAdmin({ error: "Hay datos que ya están registrados.", campos: conflicto }, 409);
    }
    console.error("Error actualizando un equipo desde el panel:", err);
    return jsonAdmin({ error: "No se ha podido guardar el equipo." }, 500);
  }

  await limpiarFotos(env.FOTOS, clavesABorrar);

  const equipo = await cargarEquipoConJugadores(env.DB, equipoId);
  return jsonAdmin({ ok: true, equipo });
}

async function fijarPosicionFinal(db: D1Database, equipoId: number, raw: unknown): Promise<Response> {
  const equipo = await db.prepare("SELECT id FROM equipos WHERE id = ?1").bind(equipoId).first<{ id: number }>();
  if (!equipo) return jsonAdmin({ error: "Ese equipo ya no existe." }, 404);

  const body = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const valor = body.posicionFinal;
  let posicion: number | null = null;
  if (valor !== null && valor !== undefined && valor !== "") {
    const n = Number(valor);
    if (!Number.isInteger(n) || n < 1 || n > 99) {
      return jsonAdmin(
        { error: "El puesto debe estar entre 1 y 99.", campos: { posicionFinal: "Entre 1 y 99, o vacío." } },
        400
      );
    }
    posicion = n;
  }

  await db.prepare("UPDATE equipos SET posicion_final = ?1 WHERE id = ?2").bind(posicion, equipoId).run();
  return jsonAdmin({ ok: true, equipoId, posicionFinal: posicion });
}
