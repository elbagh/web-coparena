import { publicUser, requireUser, type UsuarioSesion } from "../_lib/auth";
import { edicionActual } from "../_lib/ediciones";
import { guardarEquipo } from "../_lib/equipo-editor";
import { equipoDeUsuario, equipoDelCapitan } from "../_lib/equipos";
import { limpiarFotos } from "../_lib/fotos";
import { json } from "../_lib/http";
import { normalizarEmail, validarRegistro } from "../_lib/validacion";

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

  // La autorización va antes de leer y validar el cuerpo: a quien no puede
  // guardar no se le devuelven pistas campo a campo de un equipo que no es suyo.
  const edicion = await edicionActual(env.DB);
  const currentTeam = await equipoDelCapitan(env.DB, user, edicion?.id);
  if (!currentTeam) return await sinPermisoParaEscribir(env.DB, user, edicion?.id);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Los datos del formulario no son válidos." }, 400);
  }

  const resultado = validarRegistro(body, { requireConsent: false });
  if ("campos" in resultado) {
    return json({ error: "Revisa los campos marcados.", campos: resultado.campos }, 400);
  }

  const registro = resultado.registro;
  const nuevoCapitan = registro.jugadores[registro.capitan]!;
  const sigueMandando =
    nuevoCapitan.id !== undefined && nuevoCapitan.id === currentTeam.capitan_jugador_id;

  // Cambiar el correo de la fila del capitán sería ceder el equipo por la
  // puerta de atrás: quien entrase con ese correo pasaría a mandar. Ceder es un
  // acto explícito, así que se pide hacerlo nombrando a otro capitán.
  if (sigueMandando && nuevoCapitan.emailNormalizado !== normalizarEmail(user.email)) {
    return json(
      {
        error: "Para ceder el equipo, designa a otro capitán.",
        campos: {
          [`jugadores.${registro.capitan}.email`]: "Mantén el correo con el que has iniciado sesión."
        }
      },
      400
    );
  }

  try {
    // Guardado incremental por id de jugador: conserva la foto de quien sigue
    // en el equipo. Antes esto borraba y reinsertaba, y al capitán le
    // desaparecían todas las fotos cada vez que guardaba.
    const error = await guardarEquipo(env, currentTeam.id, registro);
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

  const edicion = await edicionActual(env.DB);
  const currentTeam = await equipoDelCapitan(env.DB, user, edicion?.id);
  if (!currentTeam) {
    // Sin equipo propio no hay nada que borrar; si lo que hay es un equipo
    // ajeno en el que figura, se le dice que no es suyo en vez de borrarlo.
    const ajeno = await equipoDeUsuario(env.DB, user, edicion?.id);
    return ajeno ? noEsTuEquipo() : json({ ok: true }, 200, { "Cache-Control": "no-store" });
  }

  try {
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
  const fila = await db
    .prepare(
      `SELECT e.foto_key, e.capitan_jugador_id, c.email_normalizado AS capitan_email
       FROM equipos e
       LEFT JOIN jugadores c ON c.id = e.capitan_jugador_id
       WHERE e.id = ?1`
    )
    .bind(team.id)
    .first<{ foto_key: string | null; capitan_jugador_id: number | null; capitan_email: string | null }>();

  return {
    id: team.id,
    nombre: team.nombre,
    createdAt: team.created_at,
    tieneFoto: Boolean(fila?.foto_key),
    capitanJugadorId: fila?.capitan_jugador_id ?? null,
    // Quien no es el capitán ve la ficha, pero el editor se pinta en modo
    // lectura: el PATCH le respondería 403 igualmente.
    puedeEditar: fila?.capitan_email === normalizarEmail(user.email),
    jugadores: results.map((jugador) => ({
      id: jugador.id,
      nombre: jugador.nombre,
      apellidos: jugador.apellidos,
      telefono: jugador.telefono || null,
      email: jugador.email,
      redSocial: jugador.red_social,
      tieneFoto: Boolean(jugador.foto_key),
      esSuplente: jugador.es_suplente === 1,
      orden: jugador.orden
    }))
  };
}

const noEsTuEquipo = (): Response =>
  json(
    {
      error:
        "Solo el capitán puede cambiar el equipo. Pídeselo a esa persona o escríbenos a copa.arena.2000@gmail.com."
    },
    403,
    { "Cache-Control": "no-store" }
  );

/**
 * Distingue los dos motivos por los que alguien no puede escribir: figurar en un
 * equipo que no inscribió (403) o no tener ninguno (404). Son mensajes distintos
 * porque llevan a acciones distintas: hablar con tu capitán o inscribirte.
 */
async function sinPermisoParaEscribir(
  db: D1Database,
  user: UsuarioSesion,
  edicionId?: number
): Promise<Response> {
  const ajeno = await equipoDeUsuario(db, user, edicionId);
  return ajeno
    ? noEsTuEquipo()
    : json({ error: "Todavía no tienes un equipo inscrito en la edición actual." }, 404);
}

async function fotosDeEquipo(db: D1Database, equipoId: number): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT foto_key FROM jugadores WHERE equipo_id = ?1 AND foto_key IS NOT NULL")
    .bind(equipoId)
    .all<{ foto_key: string }>();
  return results.map((item) => item.foto_key);
}
