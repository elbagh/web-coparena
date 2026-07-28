// /api/admin/usuarios
//   GET            lista de cuentas con su equipo y sus cifras
//   GET ?id=N      ficha completa: perfil, equipos por edición y camisetas
//   PATCH ?id=N    nombre, permiso de administrador y ficha de jugador
//
// Los atributos 1–5 no se tocan aquí: cuelgan del jugador de una edición, no de
// la cuenta, y se editan en /api/admin/estadisticas.
//
// No hay alta ni baja: las cuentas las crea Google al iniciar sesión, y
// borrarlas se descartó a propósito (arrastraría perfil, avatar y reservas, y
// dejaría equipos huérfanos).

import { requireAdmin, jsonAdmin, accionNoValida, idDeQuery, type AdminEnv } from "../../_lib/admin";
import { guardarPerfil, validarPerfil } from "../../_lib/perfil";
import { limpiar, normalizarEmail } from "../../_lib/validacion";

interface UsuarioRow {
  id: number;
  email: string;
  nombre: string | null;
  foto_url: string | null;
  is_admin: number;
  created_at: string;
  equipo_id: number | null;
  equipo_nombre: string | null;
  camisetas: number;
}

interface PerfilRow {
  apodo: string | null;
  dorsal: number | null;
  posicion: string | null;
  mano: string | null;
  lema: string | null;
  avatar_key: string | null;
}

export const onRequestGet: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const id = idDeQuery(new URL(request.url));

  try {
    if (id !== null) {
      const ficha = await cargarFicha(env.DB, id);
      if (!ficha) return jsonAdmin({ error: "Esa cuenta ya no existe." }, 404);
      return jsonAdmin({ usuario: ficha });
    }

    const { results } = await env.DB
      .prepare(
        `SELECT u.id, u.email, u.nombre, u.foto_url, u.is_admin, u.created_at,
                e.id AS equipo_id, e.nombre AS equipo_nombre,
                (SELECT COUNT(*) FROM camisetas_reservas c WHERE c.owner_user_id = u.id) AS camisetas
         FROM usuarios u
         LEFT JOIN equipos e ON e.id = (
           SELECT eq.id FROM equipos eq
           JOIN jugadores cap ON cap.id = eq.capitan_jugador_id
           WHERE cap.email_normalizado = lower(trim(u.email))
           ORDER BY eq.created_at ASC, eq.id ASC LIMIT 1
         )
         ORDER BY u.is_admin DESC, u.created_at ASC, u.id ASC`
      )
      .all<UsuarioRow>();

    return jsonAdmin({
      usuarios: results.map((fila) => ({
        id: fila.id,
        email: fila.email,
        nombre: fila.nombre,
        esAdmin: fila.is_admin === 1,
        createdAt: fila.created_at,
        equipoId: fila.equipo_id,
        equipoNombre: fila.equipo_nombre,
        camisetas: fila.camisetas
      }))
    });
  } catch (err) {
    console.error("Error leyendo usuarios desde el panel:", err);
    return jsonAdmin({ error: "No se han podido cargar las cuentas." }, 500);
  }
};

export const onRequestPatch: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const admin = await requireAdmin(request, env);
  if (admin instanceof Response) return admin;

  const usuarioId = idDeQuery(new URL(request.url));
  if (usuarioId === null) return accionNoValida();

  const usuario = await env.DB
    .prepare("SELECT id, is_admin FROM usuarios WHERE id = ?1")
    .bind(usuarioId)
    .first<{ id: number; is_admin: number }>();
  if (!usuario) return jsonAdmin({ error: "Esa cuenta ya no existe." }, 404);

  const body = ((await request.json().catch(() => null)) || {}) as Record<string, unknown>;

  if (body.esAdmin !== undefined) {
    const error = await validarCambioDeAdmin(env.DB, admin.id, usuario, body.esAdmin === true);
    if (error) return error;
  }

  const sets: string[] = [];
  const binds: (string | number | null)[] = [];

  if (body.nombre !== undefined) {
    const nombre = limpiar(body.nombre);
    if (nombre.length > 80) {
      return jsonAdmin(
        { error: "Revisa los campos marcados.", campos: { nombre: "El nombre no puede pasar de 80 caracteres." } },
        400
      );
    }
    sets.push(`nombre = ?${binds.length + 1}`);
    binds.push(nombre || null);
  }

  if (body.esAdmin !== undefined) {
    sets.push(`is_admin = ?${binds.length + 1}`);
    binds.push(body.esAdmin === true ? 1 : 0);
  }

  // La ficha de jugador se guarda aparte, con las mismas reglas que /api/perfil.
  let perfilValidado = null;
  if (body.perfil !== undefined) {
    const resultado = validarPerfil(body.perfil);
    if ("campos" in resultado) {
      return jsonAdmin({ error: "Revisa los campos marcados.", campos: resultado.campos }, 400);
    }
    perfilValidado = resultado.perfil;
  }

  if (sets.length === 0 && !perfilValidado) return jsonAdmin({ error: "No hay cambios que guardar." }, 400);

  try {
    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      binds.push(usuarioId);
      await env.DB.prepare(`UPDATE usuarios SET ${sets.join(", ")} WHERE id = ?${binds.length}`).bind(...binds).run();
    }
    if (perfilValidado) await guardarPerfil(env.DB, usuarioId, perfilValidado);

    return jsonAdmin({ ok: true, usuario: await cargarFicha(env.DB, usuarioId) });
  } catch (err) {
    console.error("Error actualizando una cuenta desde el panel:", err);
    return jsonAdmin({ error: "No se ha podido guardar la cuenta." }, 500);
  }
};

/**
 * Dos candados sobre el permiso de administración: nadie se lo quita a sí mismo
 * (sería quedarse fuera del panel de un clic) y nunca puede quedar el sistema
 * sin ningún administrador, porque volver a entrar exigiría tocar la base a
 * mano con wrangler.
 */
async function validarCambioDeAdmin(
  db: D1Database,
  adminActualId: number,
  objetivo: { id: number; is_admin: number },
  nuevoValor: boolean
): Promise<Response | null> {
  const quitando = objetivo.is_admin === 1 && !nuevoValor;
  if (!quitando) return null;

  if (objetivo.id === adminActualId) {
    return jsonAdmin(
      {
        error: "No puedes quitarte a ti mismo el permiso de administración.",
        campos: { esAdmin: "Pídeselo a otro administrador." }
      },
      400
    );
  }

  const otros = await db
    .prepare("SELECT COUNT(*) AS total FROM usuarios WHERE is_admin = 1 AND id <> ?1")
    .bind(objetivo.id)
    .first<{ total: number }>();
  if ((otros?.total ?? 0) < 1) {
    return jsonAdmin(
      {
        error: "Tiene que quedar al menos un administrador.",
        campos: { esAdmin: "Nombra antes a otro administrador." }
      },
      409
    );
  }

  return null;
}

/** Ficha completa: lo mismo que ve el usuario en Mi zona, más sus permisos. */
async function cargarFicha(db: D1Database, usuarioId: number) {
  const usuario = await db
    .prepare(
      `SELECT id, email, nombre, foto_url, is_admin, created_at
       FROM usuarios WHERE id = ?1`
    )
    .bind(usuarioId)
    .first<{
      id: number;
      email: string;
      nombre: string | null;
      foto_url: string | null;
      is_admin: number;
      created_at: string;
    }>();
  if (!usuario) return null;

  const emailNormalizado = normalizarEmail(usuario.email);

  const [perfil, equipos, camisetas] = await Promise.all([
    db
      .prepare("SELECT apodo, dorsal, posicion, mano, lema, avatar_key FROM perfiles WHERE usuario_id = ?1")
      .bind(usuarioId)
      .first<PerfilRow>(),
    // Aparecer como jugador con ese correo es la única forma de estar en un
    // equipo (ver _lib/equipos.ts): ser capitán no es más que ser el jugador
    // que manda, así que ya lo cubre este mismo filtro.
    db
      .prepare(
        `SELECT DISTINCT e.id, e.nombre, ed.anio AS edicion_anio, e.posicion_final
         FROM equipos e
         LEFT JOIN ediciones ed ON ed.id = e.edicion_id
         JOIN jugadores j ON j.equipo_id = e.id
         WHERE j.email_normalizado = ?1
         ORDER BY ed.anio DESC, e.nombre COLLATE NOCASE ASC`
      )
      .bind(emailNormalizado)
      .all<{ id: number; nombre: string; edicion_anio: number | null; posicion_final: number | null }>(),
    db
      .prepare(
        `SELECT c.id, c.nombre, c.talla, c.cantidad, ed.anio AS edicion_anio
         FROM camisetas_reservas c
         LEFT JOIN ediciones ed ON ed.id = c.edicion_id
         WHERE c.owner_user_id = ?1
         ORDER BY c.created_at DESC`
      )
      .bind(usuarioId)
      .all<{ id: number; nombre: string; talla: string; cantidad: number; edicion_anio: number | null }>()
  ]);

  return {
    id: usuario.id,
    email: usuario.email,
    nombre: usuario.nombre,
    fotoUrl: usuario.foto_url,
    esAdmin: usuario.is_admin === 1,
    createdAt: usuario.created_at,
    tieneAvatar: Boolean(perfil?.avatar_key),
    perfil: {
      apodo: perfil?.apodo ?? null,
      dorsal: perfil?.dorsal ?? null,
      posicion: perfil?.posicion ?? null,
      mano: perfil?.mano ?? null,
      lema: perfil?.lema ?? null
    },
    equipos: equipos.results.map((e) => ({
      id: e.id,
      nombre: e.nombre,
      edicionAnio: e.edicion_anio,
      posicionFinal: e.posicion_final
    })),
    camisetas: camisetas.results.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      talla: c.talla,
      cantidad: c.cantidad,
      edicionAnio: c.edicion_anio
    }))
  };
}
