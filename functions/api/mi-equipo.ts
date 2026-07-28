import { publicUser, requireUser, type UsuarioSesion } from "../_lib/auth";
import { edicionActual } from "../_lib/ediciones";
import { guardarEquipo } from "../_lib/equipo-editor";
import { equipoDeUsuario, registroIncluyeEmailUsuario } from "../_lib/equipos";
import { limpiarFotos } from "../_lib/fotos";
import { json } from "../_lib/http";
import { validarRegistro } from "../_lib/validacion";

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
    const edicion = await edicionActual(env.DB);
    const team = await cargarEquipo(env.DB, user, edicion?.id);
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
    const edicion = await edicionActual(env.DB);
    const currentTeam = await equipoDeUsuario(env.DB, user, edicion?.id);
    if (!currentTeam) {
      return json({ error: "Todavía no tienes un equipo inscrito en la edición actual." }, 404);
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

    // Guardado incremental por id de jugador: conserva la foto de quien sigue
    // en el equipo. Antes esto borraba y reinsertaba, y al capitán le
    // desaparecían todas las fotos cada vez que guardaba.
    const error = await guardarEquipo(env, currentTeam.id, resultado.registro);
    if (error) return error;

    const team = await cargarEquipo(env.DB, user, edicion?.id);
    return json({ ok: true, user: publicUser(user), team }, 200, { "Cache-Control": "no-store" });
  } catch (err) {
    console.error("Error actualizando mi equipo:", err);
    return json({ error: "No se ha podido actualizar tu equipo." }, 500);
  }
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const user = await requireUser(request, env);
  if (user instanceof Response) return user;

  try {
    const edicion = await edicionActual(env.DB);
    const currentTeam = await equipoDeUsuario(env.DB, user, edicion?.id);
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

async function cargarEquipo(db: D1Database, user: UsuarioSesion, edicionId?: number) {
  const team = await equipoDeUsuario(db, user, edicionId);
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

  // La foto de grupo la gestiona solo el administrador; aquí el capitán la ve.
  const foto = await db
    .prepare("SELECT foto_key FROM equipos WHERE id = ?1")
    .bind(team.id)
    .first<{ foto_key: string | null }>();

  return {
    id: team.id,
    nombre: team.nombre,
    createdAt: team.created_at,
    tieneFoto: Boolean(foto?.foto_key),
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

async function fotosDeEquipo(db: D1Database, equipoId: number): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT foto_key FROM jugadores WHERE equipo_id = ?1 AND foto_key IS NOT NULL")
    .bind(equipoId)
    .all<{ foto_key: string }>();
  return results.map((item) => item.foto_key);
}
