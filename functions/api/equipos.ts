// POST /api/equipos — registra un equipo (multipart: payload JSON + fotos).
// GET  /api/equipos — listado público: nombre de equipo y, por jugador, nombre, apellidos e Instagram.

import { json } from "../_lib/http";
import { requireUser } from "../_lib/auth";
import { edicionActual } from "../_lib/ediciones";
import { equipoDeUsuario, equipoDelCapitan } from "../_lib/equipos";
import { fotoNoEncontrada, limpiarFotos, servirFoto, subirFoto, type ExtensionFoto } from "../_lib/fotos";
import { enviarEmail, construirEmailConfirmacion } from "../_lib/gmail";
import {
  MAX_BODY_BYTES,
  validarRegistro,
  validarFoto,
  type RegistroValidado
} from "../_lib/validacion";

interface Env {
  DB: D1Database;
  FOTOS: R2Bucket;
  GMAIL_CLIENT_ID: string;
  GMAIL_CLIENT_SECRET: string;
  GMAIL_REFRESH_TOKEN: string;
  SESSION_SECRET: string;
}

const ERROR_500 =
  "Algo ha fallado al guardar la inscripción. Inténtalo de nuevo en un momento o escríbenos a copa.arena.2000@gmail.com.";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

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
    return json({ error: "Los datos del formulario no son válidos. Recarga la página e inténtalo de nuevo." }, 400);
  }

  const resultado = validarRegistro(payload, { emailCapitanObligatorio: user.email });
  if ("campos" in resultado) {
    return json({ error: "Revisa los campos marcados.", campos: resultado.campos }, 400);
  }
  const registro = resultado.registro;

  const edicion = await edicionActual(env.DB);
  if (!edicion) {
    console.error("No hay edicion actual: falta la migracion 0006_perfiles_ediciones.sql.");
    return json({ error: ERROR_500 }, 500);
  }

  // Figurar ya en un equipo cierra la inscripción, pero el motivo no es el mismo
  // y la salida tampoco: quien lo inscribió lo edita, y a quien solo aparece
  // listado no se le manda a un editor que le va a responder 403.
  const equipoExistente = await equipoDeUsuario(env.DB, user, edicion.id);
  if (equipoExistente) {
    const esSuyo = await equipoDelCapitan(env.DB, user, edicion.id);
    return json(
      {
        error: esSuyo
          ? "Ya tienes un equipo inscrito con esta cuenta. Puedes editarlo desde Mi zona."
          : `Tu correo ya figura en el equipo "${equipoExistente.nombre}" de esta edición. Si no deberías estar ahí, escríbenos a copa.arena.2000@gmail.com.`
      },
      409
    );
  }

  // Fotos: validación por tamaño, content-type y magic bytes.
  const fotos = new Map<number, { buffer: ArrayBuffer; ext: ExtensionFoto }>();
  const camposFoto: Record<string, string> = {};
  for (let i = 0; i < registro.jugadores.length; i++) {
    const entrada = formData.get(`foto_${i}`);
    if (!(entrada instanceof File) || entrada.size === 0) continue;
    const buffer = await entrada.arrayBuffer();
    const foto = validarFoto(buffer, entrada.type, entrada.size);
    if ("error" in foto) {
      camposFoto[`jugadores.${i}.foto`] = foto.error;
    } else {
      fotos.set(i, { buffer, ext: foto.ext });
    }
  }
  if (Object.keys(camposFoto).length > 0) {
    return json({ error: "Revisa los campos marcados.", campos: camposFoto }, 400);
  }

  // Pre-checks de unicidad para poder señalar el campo exacto.
  const duplicados = await buscarDuplicados(env.DB, registro, edicion.id);
  if (Object.keys(duplicados).length > 0) {
    return json({ error: "Hay datos que ya están registrados.", campos: duplicados }, 409);
  }

  // Subida de fotos a R2 con claves generadas en servidor.
  const lote = crypto.randomUUID();
  const claves: string[] = [];
  const fotoKeys = new Map<number, string>();
  try {
    for (const [i, foto] of fotos) {
      const key = `equipos/${lote}/jugador-${i + 1}.${foto.ext}`;
      await subirFoto(env.FOTOS, key, foto.buffer, foto.ext);
      claves.push(key);
      fotoKeys.set(i, key);
    }
  } catch (err) {
    console.error("Error subiendo foto a R2:", err);
    await limpiarFotos(env.FOTOS, claves);
    return json({ error: ERROR_500 }, 500);
  }

  // Inserción atómica: equipo + jugadores en un batch (transaccional en D1).
  let equipoId: number | undefined;
  try {
    const statements = [
      env.DB
        .prepare(
          "INSERT INTO equipos (nombre, nombre_normalizado, consentimiento_rgpd_at, edicion_id) VALUES (?1, ?2, ?3, ?4)"
        )
        .bind(registro.equipo, registro.equipoNormalizado, new Date().toISOString(), edicion.id),
      ...registro.jugadores.map((j, i) =>
        env.DB
          .prepare(
            `INSERT INTO jugadores (
               equipo_id, nombre, apellidos, nombre_completo_normalizado,
               telefono, telefono_normalizado, email, email_normalizado,
               red_social, foto_key, es_suplente, orden, edicion_id
             ) VALUES (
               (SELECT id FROM equipos WHERE nombre_normalizado = ?1),
               ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13
             )`
          )
          .bind(
            registro.equipoNormalizado,
            j.nombre,
            j.apellidos,
            j.nombreCompletoNormalizado,
            j.telefono,
            j.telefonoNormalizado,
            j.email,
            j.emailNormalizado,
            j.redSocial,
            fotoKeys.get(i) ?? null,
            i >= 2 ? 1 : 0,
            i + 1,
            edicion.id
          )
      ),
      env.DB
        .prepare(
          `UPDATE equipos SET capitan_jugador_id = (
             SELECT j.id FROM jugadores j
             WHERE j.equipo_id = equipos.id AND j.orden = ?2
             ORDER BY j.id ASC LIMIT 1
           ) WHERE nombre_normalizado = ?1`
        )
        .bind(registro.equipoNormalizado, registro.capitan + 1)
    ];
    const resultados = await env.DB.batch(statements);
    equipoId = resultados[0].meta.last_row_id;
  } catch (err) {
    await limpiarFotos(env.FOTOS, claves);
    const conflicto = mapearConflictoUnique(err);
    if (conflicto) {
      return json({ error: "Hay datos que ya están registrados.", campos: conflicto }, 409);
    }
    const esquema = mapearErrorEsquema(err);
    if (esquema) {
      console.error("Base de datos sin migraciones necesarias:", err);
      return json({ error: esquema }, 500);
    }
    console.error("Error insertando equipo en D1:", err);
    return json({ error: ERROR_500 }, 500);
  }

  // Email de confirmación: su fallo no revierte el registro.
  const destinatarios = registro.jugadores.flatMap((j) => (j.email ? [j.email] : []));
  let emailEnviado = false;
  try {
    const mensaje = construirEmailConfirmacion(
      registro.equipo,
      registro.jugadores.map((j, i) => ({ nombre: j.nombre, apellidos: j.apellidos, esSuplente: i >= 2 }))
    );
    await enviarEmail(env, { para: destinatarios, ...mensaje });
    emailEnviado = true;
  } catch (err) {
    console.error("Error enviando email de confirmación:", err);
  }

  return json(
    emailEnviado
      ? { ok: true, equipoId, emailEnviado }
      : {
          ok: true,
          equipoId,
          emailEnviado,
          aviso:
            "El equipo queda inscrito, pero no hemos podido enviar el correo de confirmación. Guardad esta pantalla como comprobante."
        },
    201
  );
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  // La foto de grupo del equipo sí es pública (a diferencia de las de jugador,
  // que solo salen por /api/admin/fotos): se pinta en /equipos/ y /mi-equipo/.
  const fotoDe = new URL(request.url).searchParams.get("foto");
  if (fotoDe !== null) return servirFotoEquipo(env, fotoDe);

  try {
    const { results } = await env.DB
      .prepare(
        `SELECT e.id AS equipo_id, e.nombre AS equipo_nombre, e.foto_key AS equipo_foto,
                j.nombre AS jugador_nombre, j.apellidos AS jugador_apellidos, j.red_social AS red_social
         FROM equipos e
         LEFT JOIN jugadores j ON j.equipo_id = e.id
         ORDER BY e.created_at ASC, e.id ASC, j.orden ASC`
      )
      .all<{
        equipo_id: number;
        equipo_nombre: string;
        equipo_foto: string | null;
        jugador_nombre: string | null;
        jugador_apellidos: string | null;
        red_social: string | null;
      }>();

    const equipos: {
      id: number;
      nombre: string;
      tieneFoto: boolean;
      jugadores: { nombre: string; apellidos: string; instagram: string | null }[];
    }[] = [];
    const porId = new Map<number, (typeof equipos)[number]>();
    for (const fila of results) {
      let equipo = porId.get(fila.equipo_id);
      if (!equipo) {
        equipo = {
          id: fila.equipo_id,
          nombre: fila.equipo_nombre,
          tieneFoto: Boolean(fila.equipo_foto),
          jugadores: []
        };
        porId.set(fila.equipo_id, equipo);
        equipos.push(equipo);
      }
      if (fila.jugador_nombre) {
        equipo.jugadores.push({
          nombre: fila.jugador_nombre,
          apellidos: fila.jugador_apellidos ?? "",
          instagram: fila.red_social
        });
      }
    }

    return json({ equipos }, 200, { "Cache-Control": "no-store" });
  } catch (err) {
    console.error("Error leyendo equipos de D1:", err);
    return json({ error: "No se ha podido cargar la lista de equipos." }, 500);
  }
};

/**
 * GET /api/equipos?foto=N — foto de grupo del equipo.
 * Se cachea cinco minutos: la clave de R2 lleva un uuid, así que reemplazar la
 * foto cambia el objeto y ningún intermedio puede servir la anterior más allá
 * de esa ventana.
 */
async function servirFotoEquipo(env: Env, idBruto: string): Promise<Response> {
  const equipoId = Number(idBruto);
  if (!Number.isInteger(equipoId) || equipoId <= 0) return fotoNoEncontrada();

  const equipo = await env.DB
    .prepare("SELECT foto_key FROM equipos WHERE id = ?1")
    .bind(equipoId)
    .first<{ foto_key: string | null }>();
  if (!equipo?.foto_key) return fotoNoEncontrada();

  return servirFoto(env.FOTOS, equipo.foto_key, "public, max-age=300");
}

/**
 * Duplicados en el alta. La unicidad de jugador es por edición (migración
 * 0010), así que se busca dentro de `edicionId`: quien jugó ediciones
 * anteriores puede volver a inscribirse con los mismos datos.
 */
async function buscarDuplicados(
  db: D1Database,
  registro: RegistroValidado,
  edicionId: number
): Promise<Record<string, string>> {
  const campos: Record<string, string> = {};

  const equipoExistente = await db
    .prepare("SELECT 1 FROM equipos WHERE nombre_normalizado = ?1")
    .bind(registro.equipoNormalizado)
    .first();
  if (equipoExistente) {
    campos.equipo = "Ya hay un equipo inscrito con ese nombre.";
  }

  const nombres = registro.jugadores.map((j) => j.nombreCompletoNormalizado);
  const telefonos = registro.jugadores.flatMap((j) => (j.telefonoNormalizado ? [j.telefonoNormalizado] : []));
  const emails = registro.jugadores.flatMap((j) => (j.emailNormalizado ? [j.emailNormalizado] : []));

  const clausulas = [`nombre_completo_normalizado IN (${nombres.map(() => "?").join(",")})`];
  const binds: (string | number | null)[] = [...nombres];
  if (telefonos.length > 0) {
    clausulas.push(`telefono_normalizado IN (${telefonos.map(() => "?").join(",")})`);
    binds.push(...telefonos);
  }
  if (emails.length > 0) {
    clausulas.push(`email_normalizado IN (${emails.map(() => "?").join(",")})`);
    binds.push(...emails);
  }
  binds.push(edicionId);

  const { results } = await db
    .prepare(
      `SELECT nombre_completo_normalizado, telefono_normalizado, email_normalizado
       FROM jugadores
       WHERE (${clausulas.join(" OR ")}) AND edicion_id IS ?`
    )
    .bind(...binds)
    .all<{ nombre_completo_normalizado: string; telefono_normalizado: string; email_normalizado: string | null }>();

  const nombresOcupados = new Set(results.map((r) => r.nombre_completo_normalizado));
  const telefonosOcupados = new Set(results.map((r) => r.telefono_normalizado));
  const emailsOcupados = new Set(results.flatMap((r) => (r.email_normalizado ? [r.email_normalizado] : [])));

  registro.jugadores.forEach((j, i) => {
    if (nombresOcupados.has(j.nombreCompletoNormalizado)) {
      campos[`jugadores.${i}.nombre`] = "Esta persona ya está inscrita en otro equipo.";
    }
    if (j.telefonoNormalizado && telefonosOcupados.has(j.telefonoNormalizado)) {
      campos[`jugadores.${i}.telefono`] = "Este móvil ya está registrado en otra inscripción.";
    }
    if (j.emailNormalizado && emailsOcupados.has(j.emailNormalizado)) {
      campos[`jugadores.${i}.email`] = "Este correo ya está registrado en otra inscripción.";
    }
  });

  return campos;
}

// Condición de carrera pese al pre-check: los índices UNIQUE son la garantía final.
function mapearConflictoUnique(err: unknown): Record<string, string> | null {
  const mensaje = err instanceof Error ? err.message : String(err);
  if (!mensaje.includes("UNIQUE constraint failed")) return null;
  if (mensaje.includes("equipos.nombre_normalizado")) {
    return { equipo: "Ya hay un equipo inscrito con ese nombre." };
  }
  if (mensaje.includes("jugadores.nombre_completo_normalizado")) {
    return { jugadores: "Alguna de las personas ya está inscrita en otro equipo." };
  }
  if (mensaje.includes("jugadores.telefono_normalizado")) {
    return { jugadores: "Alguno de los móviles ya está registrado en otra inscripción." };
  }
  if (mensaje.includes("jugadores.email_normalizado")) {
    return { jugadores: "Alguno de los correos ya está registrado en otra inscripción." };
  }
  return { jugadores: "Hay datos que ya están registrados en otra inscripción." };
}

function mapearErrorEsquema(err: unknown): string | null {
  const mensaje = err instanceof Error ? err.message : String(err);
  if (mensaje.includes("no such table: usuarios")) {
    return "La base de datos no esta actualizada: falta la tabla usuarios. Aplica la migracion 0003_auth_usuarios.sql.";
  }
  return null;
}
