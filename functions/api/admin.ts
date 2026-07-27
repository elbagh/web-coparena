import { requireAdmin } from "../_lib/admin";
import { publicUser } from "../_lib/auth";
import { json } from "../_lib/http";
import { capitalizarPropio } from "../_lib/nombres";
import { MAX_BODY_BYTES, validarRegistro, validarFoto } from "../_lib/validacion";
import { buscarDuplicadosEdicion, mapearConflictoUnicoEdicion } from "../_lib/equipos";

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

interface JugadorNombreRow {
  id: number;
  nombre: string;
  apellidos: string;
}

export function calcularNombresNormalizados(jugadores: JugadorNombreRow[]): JugadorNombreRow[] {
  return jugadores.reduce<JugadorNombreRow[]>((cambios, jugador) => {
    const nombre = capitalizarPropio(jugador.nombre);
    const apellidos = capitalizarPropio(jugador.apellidos);
    if (nombre !== jugador.nombre || apellidos !== jugador.apellidos) {
      cambios.push({ id: jugador.id, nombre, apellidos });
    }
    return cambios;
  }, []);
}

async function normalizarNombresJugadores(db: D1Database): Promise<Response> {
  const { results } = await db.prepare("SELECT id, nombre, apellidos FROM jugadores").all<JugadorNombreRow>();
  const cambios = calcularNombresNormalizados(results);
  if (cambios.length > 0) {
    await db.batch(
      cambios.map((c) =>
        db.prepare("UPDATE jugadores SET nombre = ?1, apellidos = ?2 WHERE id = ?3").bind(c.nombre, c.apellidos, c.id)
      )
    );
  }
  return json({ ok: true, actualizados: cambios.length }, 200, { "Cache-Control": "no-store" });
}

const TALLAS = new Set(["XS", "S", "M", "L", "XL", "XXL"]);

const CONTENT_TYPE_POR_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const url = new URL(request.url);
  if (url.searchParams.get("type") === "foto") {
    return servirFotoJugador(env, url.searchParams.get("jugadorId"));
  }

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

  if (type === "normalizar-nombres") {
    try {
      return await normalizarNombresJugadores(env.DB);
    } catch (err) {
      console.error("Error normalizando nombres desde panel admin:", err);
      return json({ error: "No se ha podido normalizar los nombres." }, 500, { "Cache-Control": "no-store" });
    }
  }

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

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const url = new URL(request.url);
  const equipoId = Number(url.searchParams.get("id"));
  if (url.searchParams.get("type") !== "equipo" || !Number.isInteger(equipoId) || equipoId <= 0) {
    return json({ error: "La acción no es válida." }, 400);
  }

  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return json({ error: "La petición es demasiado grande. Cada foto puede ocupar como máximo 4 MB." }, 413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: "El formulario debe enviarse como multipart/form-data." }, 400);
  }

  const payloadRaw = formData.get("payload");
  let payload: unknown;
  try {
    payload = JSON.parse(typeof payloadRaw === "string" ? payloadRaw : "");
  } catch {
    return json({ error: "Los datos del formulario no son válidos." }, 400);
  }

  const resultado = validarRegistro(payload, { requireConsent: false, requirePlayerEmail: true });
  if ("campos" in resultado) {
    return json({ error: "Revisa los campos marcados.", campos: resultado.campos }, 400);
  }
  const registro = resultado.registro;

  const equipoActual = await env.DB.prepare("SELECT id FROM equipos WHERE id = ?1").bind(equipoId).first<{ id: number }>();
  if (!equipoActual) {
    return json({ error: "Ese equipo ya no existe." }, 404, { "Cache-Control": "no-store" });
  }

  const { results: jugadoresActuales } = await env.DB
    .prepare("SELECT id, foto_key FROM jugadores WHERE equipo_id = ?1")
    .bind(equipoId)
    .all<{ id: number; foto_key: string | null }>();
  const actualesPorId = new Map(jugadoresActuales.map((j) => [j.id, j.foto_key]));

  for (const j of registro.jugadores) {
    if (j.id !== undefined && !actualesPorId.has(j.id)) {
      return json({ error: "Alguno de los jugadores no pertenece a este equipo." }, 400);
    }
  }

  const duplicados = await buscarDuplicadosEdicion(env.DB, registro, equipoId);
  if (Object.keys(duplicados).length > 0) {
    return json({ error: "Hay datos que ya están registrados.", campos: duplicados }, 409, { "Cache-Control": "no-store" });
  }

  // Fotos nuevas: validar por tamaño/tipo/magic bytes antes de tocar R2 o D1.
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
    return json({ error: "Revisa los campos marcados.", campos: camposFoto }, 400);
  }
  if (fotosNuevas.size > 0 && !env.FOTOS) {
    return json({ error: "No se han podido guardar las fotos." }, 500);
  }

  // Subida de fotos nuevas a R2 (antes del batch de D1, igual que en equipos.ts).
  const clavesNuevas: string[] = [];
  const clavePorIndice = new Map<number, string>();
  if (env.FOTOS) {
    const lote = crypto.randomUUID();
    try {
      for (const [i, foto] of fotosNuevas) {
        const key = `equipos/${lote}/jugador-${i + 1}.${foto.ext}`;
        await env.FOTOS.put(key, foto.buffer, { httpMetadata: { contentType: CONTENT_TYPE_POR_EXT[foto.ext] } });
        clavesNuevas.push(key);
        clavePorIndice.set(i, key);
      }
    } catch (err) {
      console.error("Error subiendo foto a R2 desde admin:", err);
      await limpiarFotos(env.FOTOS, clavesNuevas);
      return json({ error: "No se han podido guardar las fotos." }, 500);
    }
  }

  // Diff: jugadores actuales cuyo id no viene en el payload se borran.
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
               red_social, foto_key, es_suplente, orden
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`
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
      return json({ error: "Hay datos que ya están registrados.", campos: conflicto }, 409, { "Cache-Control": "no-store" });
    }
    console.error("Error actualizando equipo desde panel admin:", err);
    return json({ error: "No se ha podido guardar el equipo." }, 500, { "Cache-Control": "no-store" });
  }

  await limpiarFotos(env.FOTOS, clavesABorrar);

  const equipo = await cargarEquipoConJugadores(env.DB, equipoId);
  return json({ ok: true, equipo }, 200, { "Cache-Control": "no-store" });
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

async function cargarEquipoConJugadores(db: D1Database, equipoId: number) {
  const equipo = await db
    .prepare(
      `SELECT e.id, e.nombre, e.created_at, u.email AS owner_email, u.nombre AS owner_name
       FROM equipos e
       LEFT JOIN usuarios u ON u.id = e.owner_user_id
       WHERE e.id = ?1`
    )
    .bind(equipoId)
    .first<{ id: number; nombre: string; created_at: string; owner_email: string | null; owner_name: string | null }>();
  if (!equipo) return null;

  const { results: jugadores } = await db
    .prepare(
      `SELECT id, equipo_id, nombre, apellidos, telefono, email, red_social, foto_key, es_suplente, orden
       FROM jugadores WHERE equipo_id = ?1 ORDER BY orden ASC, id ASC`
    )
    .bind(equipoId)
    .all<JugadorRow>();

  return {
    id: equipo.id,
    nombre: equipo.nombre,
    createdAt: equipo.created_at,
    ownerEmail: equipo.owner_email,
    ownerName: equipo.owner_name,
    jugadores: jugadores.map(mapJugador),
    jugadoresTotal: jugadores.length
  };
}

async function limpiarFotos(bucket: R2Bucket | undefined, claves: string[]): Promise<void> {
  if (!bucket) return;
  for (const key of claves) {
    try {
      await bucket.delete(key);
    } catch {
      // Borrado best-effort: si falla queda un objeto huérfano inofensivo.
    }
  }
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
  await limpiarFotos(env.FOTOS, results.map((item) => item.foto_key));
  return true;
}

async function servirFotoJugador(env: Env, jugadorIdRaw: string | null): Promise<Response> {
  const jugadorId = Number(jugadorIdRaw);
  const noEncontrada = json({ error: "Foto no encontrada." }, 404, { "Cache-Control": "no-store" });
  if (!Number.isInteger(jugadorId) || jugadorId <= 0 || !env.FOTOS) {
    return noEncontrada;
  }

  const jugador = await env.DB
    .prepare("SELECT foto_key FROM jugadores WHERE id = ?1")
    .bind(jugadorId)
    .first<{ foto_key: string | null }>();
  if (!jugador?.foto_key) {
    return noEncontrada;
  }

  const objeto = await env.FOTOS.get(jugador.foto_key);
  if (!objeto) {
    return noEncontrada;
  }

  return new Response(objeto.body, {
    status: 200,
    headers: {
      "Content-Type": objeto.httpMetadata?.contentType || "application/octet-stream",
      "Cache-Control": "no-store"
    }
  });
}
