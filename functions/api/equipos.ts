// POST /api/equipos — registra un equipo (multipart: payload JSON + fotos).
// GET  /api/equipos — listado público: solo nombres y nº de jugadores.

import { json } from "../_lib/http";
import { verificarTurnstile } from "../_lib/turnstile";
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
  TURNSTILE_SECRET_KEY: string;
  GMAIL_CLIENT_ID: string;
  GMAIL_CLIENT_SECRET: string;
  GMAIL_REFRESH_TOKEN: string;
}

const ERROR_500 =
  "Algo ha fallado al guardar la inscripción. Inténtalo de nuevo en un momento o escríbenos a copa.arena.2000@gmail.com.";

const CONTENT_TYPE_POR_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
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

  const resultado = validarRegistro(payload);
  if ("campos" in resultado) {
    return json({ error: "Revisa los campos marcados.", campos: resultado.campos }, 400);
  }
  const registro = resultado.registro;

  const humano = await verificarTurnstile(
    env.TURNSTILE_SECRET_KEY,
    registro.turnstileToken,
    request.headers.get("CF-Connecting-IP")
  );
  if (!humano) {
    return json({ error: "No hemos podido verificar que eres una persona. Recarga la página e inténtalo de nuevo." }, 403);
  }

  // Fotos: validación por tamaño, content-type y magic bytes.
  const fotos = new Map<number, { buffer: ArrayBuffer; ext: string }>();
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
  const duplicados = await buscarDuplicados(env.DB, registro);
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
      await env.FOTOS.put(key, foto.buffer, {
        httpMetadata: { contentType: CONTENT_TYPE_POR_EXT[foto.ext] }
      });
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
        .prepare("INSERT INTO equipos (nombre, nombre_normalizado, consentimiento_rgpd_at) VALUES (?1, ?2, ?3)")
        .bind(registro.equipo, registro.equipoNormalizado, new Date().toISOString()),
      ...registro.jugadores.map((j, i) =>
        env.DB
          .prepare(
            `INSERT INTO jugadores (
               equipo_id, nombre, apellidos, nombre_completo_normalizado,
               telefono, telefono_normalizado, email, email_normalizado,
               red_social, foto_key, es_suplente, orden
             ) VALUES (
               (SELECT id FROM equipos WHERE nombre_normalizado = ?1),
               ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12
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
            i + 1
          )
      )
    ];
    const resultados = await env.DB.batch(statements);
    equipoId = resultados[0].meta.last_row_id;
  } catch (err) {
    await limpiarFotos(env.FOTOS, claves);
    const conflicto = mapearConflictoUnique(err);
    if (conflicto) {
      return json({ error: "Hay datos que ya están registrados.", campos: conflicto }, 409);
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

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const { results } = await env.DB
      .prepare(
        `SELECT e.nombre AS nombre, COUNT(j.id) AS jugadores
         FROM equipos e
         LEFT JOIN jugadores j ON j.equipo_id = e.id
         GROUP BY e.id
         ORDER BY e.created_at ASC, e.id ASC`
      )
      .all<{ nombre: string; jugadores: number }>();
    return json({ equipos: results }, 200, { "Cache-Control": "public, max-age=60" });
  } catch (err) {
    console.error("Error leyendo equipos de D1:", err);
    return json({ error: "No se ha podido cargar la lista de equipos." }, 500);
  }
};

async function buscarDuplicados(db: D1Database, registro: RegistroValidado): Promise<Record<string, string>> {
  const campos: Record<string, string> = {};

  const equipoExistente = await db
    .prepare("SELECT 1 FROM equipos WHERE nombre_normalizado = ?1")
    .bind(registro.equipoNormalizado)
    .first();
  if (equipoExistente) {
    campos.equipo = "Ya hay un equipo inscrito con ese nombre.";
  }

  const nombres = registro.jugadores.map((j) => j.nombreCompletoNormalizado);
  const telefonos = registro.jugadores.map((j) => j.telefonoNormalizado);
  const emails = registro.jugadores.flatMap((j) => (j.emailNormalizado ? [j.emailNormalizado] : []));

  const clausulas = [
    `nombre_completo_normalizado IN (${nombres.map(() => "?").join(",")})`,
    `telefono_normalizado IN (${telefonos.map(() => "?").join(",")})`
  ];
  const binds: string[] = [...nombres, ...telefonos];
  if (emails.length > 0) {
    clausulas.push(`email_normalizado IN (${emails.map(() => "?").join(",")})`);
    binds.push(...emails);
  }

  const { results } = await db
    .prepare(
      `SELECT nombre_completo_normalizado, telefono_normalizado, email_normalizado
       FROM jugadores
       WHERE ${clausulas.join(" OR ")}`
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
    if (telefonosOcupados.has(j.telefonoNormalizado)) {
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

async function limpiarFotos(bucket: R2Bucket, claves: string[]): Promise<void> {
  for (const key of claves) {
    try {
      await bucket.delete(key);
    } catch {
      // Borrado best-effort: si falla queda un objeto huérfano inofensivo.
    }
  }
}
