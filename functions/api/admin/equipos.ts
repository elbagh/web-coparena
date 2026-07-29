// /api/admin/equipos
//   POST                         crea un equipo vacío (nombre + edición)
//   PATCH ?id=N                  editor completo del equipo (multipart)
//   PATCH ?id=N&accion=posicion   puesto final del equipo en su edición
//   PATCH ?id=N&accion=ficha      edición y capitán del equipo
//   DELETE ?id=N                 borra el equipo con sus jugadores y sus fotos

import {
  requireAdmin,
  jsonAdmin,
  accionNoValida,
  idDeQuery,
  cargarEquipoConJugadores,
  type AdminEnv
} from "../../_lib/admin";
import { edicionActual } from "../../_lib/ediciones";
import { guardarEquipo, type FotoNueva } from "../../_lib/equipo-editor";
import { limpiarFotos, subirFoto } from "../../_lib/fotos";
import { MAX_BODY_BYTES, limpiar, normalizarTexto, validarRegistro, validarFoto } from "../../_lib/validacion";

/**
 * Alta de un equipo vacío. Los jugadores se añaden después con el editor o
 * desde /api/admin/jugadores: exigir dos jugadores de golpe aquí obligaría al
 * administrador a tener todos los datos a mano para poder empezar.
 */
export const onRequestPost: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const nombre = limpiar(body?.nombre);
  if (nombre.length < 2 || nombre.length > 60) {
    return jsonAdmin(
      { error: "Revisa los campos marcados.", campos: { nombre: "El nombre debe tener entre 2 y 60 caracteres." } },
      400
    );
  }

  const nombreNormalizado = normalizarTexto(nombre);
  const existe = await env.DB
    .prepare("SELECT 1 FROM equipos WHERE nombre_normalizado = ?1")
    .bind(nombreNormalizado)
    .first();
  if (existe) {
    return jsonAdmin(
      { error: "Ya hay un equipo con ese nombre.", campos: { nombre: "Ya hay un equipo inscrito con ese nombre." } },
      409
    );
  }

  const edicionId = Number(body?.edicionId) || (await edicionActual(env.DB).catch(() => null))?.id || null;

  try {
    const fila = await env.DB
      .prepare(
        `INSERT INTO equipos (nombre, nombre_normalizado, consentimiento_rgpd_at, edicion_id)
         VALUES (?1, ?2, datetime('now'), ?3)
         RETURNING id`
      )
      .bind(nombre, nombreNormalizado, edicionId)
      .first<{ id: number }>();

    return jsonAdmin({ ok: true, equipo: await cargarEquipoConJugadores(env.DB, fila!.id) }, 201);
  } catch (err) {
    console.error("Error creando un equipo desde el panel:", err);
    return jsonAdmin({ error: "No se ha podido crear el equipo." }, 500);
  }
};

export const onRequestPatch: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const url = new URL(request.url);
  const equipoId = idDeQuery(url);
  if (equipoId === null) return accionNoValida();
  const accion = url.searchParams.get("accion");

  if (accion === "posicion") {
    try {
      return await fijarPosicionFinal(env.DB, equipoId, await request.json().catch(() => null));
    } catch (err) {
      console.error("Error fijando el puesto de un equipo:", err);
      return jsonAdmin({ error: "No se ha podido guardar el puesto." }, 500);
    }
  }

  if (accion === "ficha") {
    try {
      return await actualizarFicha(env.DB, equipoId, await request.json().catch(() => null));
    } catch (err) {
      console.error("Error actualizando la ficha de un equipo:", err);
      return jsonAdmin({ error: "No se ha podido guardar el equipo." }, 500);
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

  const resultado = validarRegistro(payload, { requireConsent: false });
  if ("campos" in resultado) {
    return jsonAdmin({ error: "Revisa los campos marcados.", campos: resultado.campos }, 400);
  }

  const equipoActual = await env.DB
    .prepare("SELECT id, foto_key FROM equipos WHERE id = ?1")
    .bind(equipoId)
    .first<{ id: number; foto_key: string | null }>();
  if (!equipoActual) return jsonAdmin({ error: "Ese equipo ya no existe." }, 404);

  // Fotos de jugador: tamaño, tipo y magic bytes antes de tocar R2 o D1.
  const fotosJugadores = new Map<number, FotoNueva>();
  const camposFoto: Record<string, string> = {};
  for (let i = 0; i < resultado.registro.jugadores.length; i++) {
    const entrada = formData.get(`foto_${i}`);
    if (!(entrada instanceof File) || entrada.size === 0) continue;
    const buffer = await entrada.arrayBuffer();
    const foto = validarFoto(buffer, entrada.type, entrada.size);
    if ("error" in foto) camposFoto[`jugadores.${i}.foto`] = foto.error;
    else fotosJugadores.set(i, { buffer, ext: foto.ext });
  }

  // Foto de equipo: la parte `fotoEquipo`, más la casilla `eliminarFotoEquipo`.
  const entradaEquipo = formData.get("fotoEquipo");
  let fotoEquipo: FotoNueva | null = null;
  if (entradaEquipo instanceof File && entradaEquipo.size > 0) {
    const buffer = await entradaEquipo.arrayBuffer();
    const foto = validarFoto(buffer, entradaEquipo.type, entradaEquipo.size);
    if ("error" in foto) camposFoto.fotoEquipo = foto.error;
    else fotoEquipo = { buffer, ext: foto.ext };
  }
  const eliminarFotoEquipo = formData.get("eliminarFotoEquipo") === "1";

  if (Object.keys(camposFoto).length > 0) {
    return jsonAdmin({ error: "Revisa los campos marcados.", campos: camposFoto }, 400);
  }

  const error = await guardarEquipo(env, equipoId, resultado.registro, fotosJugadores);
  if (error) return error;

  const fallo = await aplicarFotoEquipo(env, equipoId, equipoActual.foto_key, fotoEquipo, eliminarFotoEquipo);
  if (fallo) return fallo;

  const equipo = await cargarEquipoConJugadores(env.DB, equipoId);
  return jsonAdmin({ ok: true, equipo });
}

/**
 * Sube, reemplaza o borra la foto de grupo. Va después del guardado de
 * jugadores y por separado: es un cambio independiente, y si fallara no tiene
 * por qué tirar abajo una edición de plantilla que ya ha entrado bien.
 */
async function aplicarFotoEquipo(
  env: AdminEnv,
  equipoId: number,
  claveActual: string | null,
  fotoNueva: FotoNueva | null,
  eliminar: boolean
): Promise<Response | null> {
  if (!fotoNueva && !eliminar) return null;
  if (fotoNueva && !env.FOTOS) {
    return jsonAdmin({ error: "No se ha podido guardar la foto del equipo." }, 500);
  }

  let claveNueva: string | null = null;
  if (fotoNueva && env.FOTOS) {
    // El uuid en la clave evita que un cache intermedio siga sirviendo la
    // foto anterior: la URL pública lleva el id, pero el objeto cambia.
    claveNueva = `equipos/${equipoId}/equipo-${crypto.randomUUID()}.${fotoNueva.ext}`;
    try {
      await subirFoto(env.FOTOS, claveNueva, fotoNueva.buffer, fotoNueva.ext);
    } catch (err) {
      console.error("Error subiendo la foto de equipo a R2:", err);
      return jsonAdmin({ error: "No se ha podido guardar la foto del equipo." }, 500);
    }
  }

  try {
    await env.DB.prepare("UPDATE equipos SET foto_key = ?1 WHERE id = ?2").bind(claveNueva, equipoId).run();
  } catch (err) {
    if (claveNueva) await limpiarFotos(env.FOTOS, [claveNueva]);
    console.error("Error guardando la clave de la foto de equipo:", err);
    return jsonAdmin({ error: "No se ha podido guardar la foto del equipo." }, 500);
  }

  if (claveActual && claveActual !== claveNueva) await limpiarFotos(env.FOTOS, [claveActual]);
  return null;
}

/**
 * Edición y capitán del equipo. Mover un equipo de edición arrastra a sus
 * jugadores: si no, el historial del cromo los dejaría en el año equivocado.
 */
async function actualizarFicha(db: D1Database, equipoId: number, raw: unknown): Promise<Response> {
  const equipo = await db.prepare("SELECT id FROM equipos WHERE id = ?1").bind(equipoId).first<{ id: number }>();
  if (!equipo) return jsonAdmin({ error: "Ese equipo ya no existe." }, 404);

  const body = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const statements: D1PreparedStatement[] = [];

  if (body.edicionId !== undefined) {
    const edicionId = body.edicionId === null || body.edicionId === "" ? null : Number(body.edicionId);
    if (edicionId !== null) {
      if (!Number.isInteger(edicionId)) return accionNoValida();
      const existe = await db.prepare("SELECT 1 FROM ediciones WHERE id = ?1").bind(edicionId).first();
      if (!existe) {
        return jsonAdmin({ error: "Esa edición no existe.", campos: { edicionId: "Elige una edición válida." } }, 400);
      }
    }
    statements.push(db.prepare("UPDATE equipos SET edicion_id = ?1 WHERE id = ?2").bind(edicionId, equipoId));
    statements.push(db.prepare("UPDATE jugadores SET edicion_id = ?1 WHERE equipo_id = ?2").bind(edicionId, equipoId));
  }

  if (body.capitanJugadorId !== undefined) {
    const capitanId =
      body.capitanJugadorId === null || body.capitanJugadorId === "" ? null : Number(body.capitanJugadorId);
    if (capitanId !== null) {
      if (!Number.isInteger(capitanId)) return accionNoValida();
      const jugador = await db
        .prepare("SELECT id, telefono, email FROM jugadores WHERE id = ?1 AND equipo_id = ?2")
        .bind(capitanId, equipoId)
        .first<{ id: number; telefono: string; email: string | null }>();
      if (!jugador) {
        return jsonAdmin(
          { error: "Ese jugador no está en el equipo.", campos: { capitanJugadorId: "Elige un jugador de la plantilla." } },
          400
        );
      }
      // El capitán es el contacto del equipo y quien puede editarlo: sin móvil
      // ni correo el equipo se quedaría sin nadie con quien hablar y sin editor.
      if (!jugador.telefono || !jugador.email) {
        return jsonAdmin(
          {
            error: "El capitán necesita móvil y correo.",
            campos: { capitanJugadorId: "Rellena su móvil y su correo antes de nombrarle capitán." }
          },
          400
        );
      }
    }
    statements.push(db.prepare("UPDATE equipos SET capitan_jugador_id = ?1 WHERE id = ?2").bind(capitanId, equipoId));
  }

  if (statements.length === 0) return jsonAdmin({ error: "No hay cambios que guardar." }, 400);

  await db.batch(statements);
  return jsonAdmin({ ok: true, equipo: await cargarEquipoConJugadores(db, equipoId) });
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
