import { publicUser, requireUser, type UsuarioSesion } from "../_lib/auth";
import { equipoDeUsuario, registroIncluyeEmailUsuario } from "../_lib/equipos";
import { json } from "../_lib/http";
import { validarRegistro, type RegistroValidado } from "../_lib/validacion";

interface Env {
  DB: D1Database;
  FOTOS?: R2Bucket;
  SESSION_SECRET: string;
}

interface JugadorRow {
  id: number;
  nombre: string;
  apellidos: string;
  telefono: string;
  email: string | null;
  red_social: string | null;
  foto_key: string | null;
  es_suplente: number;
  orden: number;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  try {
    const team = await cargarEquipo(env.DB, user);
    return json({ user: publicUser(user), team }, 200, { "Cache-Control": "no-store" });
  } catch (err) {
    console.error("Error leyendo mi equipo:", err);
    return json({ error: "No se ha podido cargar tu equipo." }, 500);
  }
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Los datos del formulario no son válidos." }, 400);
  }

  const resultado = validarRegistro(body, { requireConsent: false, ownerEmail: user.email });
  if ("campos" in resultado) {
    return json({ error: "Revisa los campos marcados.", campos: resultado.campos }, 400);
  }

  try {
    const currentTeam = await equipoDeUsuario(env.DB, user);
    if (!currentTeam) {
      return json({ error: "Todavía no tienes un equipo inscrito." }, 404);
    }

    if (!registroIncluyeEmailUsuario(resultado.registro, user)) {
      return json(
        {
          error: "Tu equipo debe mantener tu correo de Google en uno de los jugadores.",
          campos: { email: "Mantén el mismo correo con el que has iniciado sesión." }
        },
        400
      );
    }

    const duplicados = await buscarDuplicadosEdicion(env.DB, resultado.registro, currentTeam.id);
    if (Object.keys(duplicados).length > 0) {
      return json({ error: "Hay datos que ya están registrados.", campos: duplicados }, 409);
    }

    const fotoKeys = await fotosDeEquipo(env.DB, currentTeam.id);
    await reemplazarEquipo(env.DB, currentTeam.id, resultado.registro);
    await limpiarFotos(env.FOTOS, fotoKeys);

    const team = await cargarEquipo(env.DB, user);
    return json({ ok: true, user: publicUser(user), team }, 200, { "Cache-Control": "no-store" });
  } catch (err) {
    const conflicto = mapearConflictoUnique(err);
    if (conflicto) {
      return json({ error: "Hay datos que ya están registrados.", campos: conflicto }, 409);
    }
    console.error("Error actualizando mi equipo:", err);
    return json({ error: "No se ha podido actualizar tu equipo." }, 500);
  }
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  try {
    const currentTeam = await equipoDeUsuario(env.DB, user);
    if (!currentTeam) {
      return json({ ok: true }, 200, { "Cache-Control": "no-store" });
    }

    const fotoKeys = await fotosDeEquipo(env.DB, currentTeam.id);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM jugadores WHERE equipo_id = ?1").bind(currentTeam.id),
      env.DB.prepare("DELETE FROM equipos WHERE id = ?1").bind(currentTeam.id)
    ]);
    await limpiarFotos(env.FOTOS, fotoKeys);

    return json({ ok: true }, 200, { "Cache-Control": "no-store" });
  } catch (err) {
    console.error("Error borrando mi equipo:", err);
    return json({ error: "No se ha podido borrar tu equipo." }, 500);
  }
};

async function cargarEquipo(db: D1Database, user: UsuarioSesion) {
  const team = await equipoDeUsuario(db, user);
  if (!team) return null;

  const { results } = await db
    .prepare(
      `SELECT id, nombre, apellidos, telefono, email, red_social, foto_key, es_suplente, orden
       FROM jugadores
       WHERE equipo_id = ?1
       ORDER BY orden ASC, id ASC`
    )
    .bind(team.id)
    .all<JugadorRow>();

  return {
    id: team.id,
    nombre: team.nombre,
    createdAt: team.created_at,
    jugadores: results.map((jugador) => ({
      id: jugador.id,
      nombre: jugador.nombre,
      apellidos: jugador.apellidos,
      telefono: jugador.telefono,
      email: jugador.email,
      redSocial: jugador.red_social,
      tieneFoto: Boolean(jugador.foto_key),
      esSuplente: jugador.es_suplente === 1,
      orden: jugador.orden
    }))
  };
}

async function reemplazarEquipo(db: D1Database, equipoId: number, registro: RegistroValidado): Promise<void> {
  await db.batch([
    db
      .prepare("UPDATE equipos SET nombre = ?1, nombre_normalizado = ?2 WHERE id = ?3")
      .bind(registro.equipo, registro.equipoNormalizado, equipoId),
    db.prepare("DELETE FROM jugadores WHERE equipo_id = ?1").bind(equipoId),
    ...registro.jugadores.map((j, i) =>
      db
        .prepare(
          `INSERT INTO jugadores (
             equipo_id, nombre, apellidos, nombre_completo_normalizado,
             telefono, telefono_normalizado, email, email_normalizado,
             red_social, foto_key, es_suplente, orden
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?10, ?11)`
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
          i >= 2 ? 1 : 0,
          i + 1
        )
    )
  ]);
}

async function buscarDuplicadosEdicion(
  db: D1Database,
  registro: RegistroValidado,
  equipoId: number
): Promise<Record<string, string>> {
  const campos: Record<string, string> = {};

  const equipoExistente = await db
    .prepare("SELECT 1 FROM equipos WHERE nombre_normalizado = ?1 AND id <> ?2")
    .bind(registro.equipoNormalizado, equipoId)
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
  const binds: (string | number)[] = [...nombres, ...telefonos];
  if (emails.length > 0) {
    clausulas.push(`email_normalizado IN (${emails.map(() => "?").join(",")})`);
    binds.push(...emails);
  }
  binds.push(equipoId);

  const { results } = await db
    .prepare(
      `SELECT nombre_completo_normalizado, telefono_normalizado, email_normalizado
       FROM jugadores
       WHERE (${clausulas.join(" OR ")}) AND equipo_id <> ?`
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

async function fotosDeEquipo(db: D1Database, equipoId: number): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT foto_key FROM jugadores WHERE equipo_id = ?1 AND foto_key IS NOT NULL")
    .bind(equipoId)
    .all<{ foto_key: string }>();
  return results.map((item) => item.foto_key);
}

async function limpiarFotos(bucket: R2Bucket | undefined, claves: string[]): Promise<void> {
  if (!bucket) return;
  for (const key of claves) {
    try {
      await bucket.delete(key);
    } catch {
      // Borrado best-effort: el registro ya se ha actualizado.
    }
  }
}

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
  if (mensaje.includes("equipos.owner_user_id")) {
    return { equipo: "Ya tienes un equipo inscrito con esta cuenta." };
  }
  return { jugadores: "Hay datos que ya están registrados en otra inscripción." };
}
