// /api/admin/usuarios
//   GET            lista de cuentas con su equipo y sus cifras
//   GET ?id=N      ficha completa: equipos por edición y camisetas
//   PATCH ?id=N    nombre y rol
//
// **Aquí no se toca el cromo de nadie.** Ni la identidad (apodo, dorsal,
// posición, mano, lema) ni la valoración (atributos, nivel): desde la 0022 todo
// eso cuelga del jugador de una edición, no de la cuenta de Google. Una misma
// persona puede tener ficha distinta en 2025 y en 2026, y quien nunca ha
// iniciado sesión también tiene la suya. Se editan en /admin/jugadores/ y en
// /admin/estadisticas/.
//
// No hay alta ni baja: las cuentas las crea Google al iniciar sesión, y
// borrarlas se descartó a propósito (arrastraría avatar y reservas, y dejaría
// equipos huérfanos).
//
// El rol sustituye al viejo booleano `esAdmin`. La respuesta sigue trayendo
// `esAdmin` derivado (rol == 'admin') porque hay sitios en el panel donde lo
// único que importa es si esa cuenta es intocable.

import { requirePermiso, jsonAdmin, accionNoValida, idDeQuery, type AdminEnv } from "../../_lib/admin";
import { CLAVES_PERMISO, ROL_ADMIN, type ContextoPermisos } from "../../_lib/permisos";
import { limpiar, normalizarEmail } from "../../_lib/validacion";

interface UsuarioRow {
  id: number;
  email: string;
  nombre: string | null;
  foto_url: string | null;
  rol_id: number | null;
  rol_clave: string | null;
  rol_nombre: string | null;
  created_at: string;
  equipo_id: number | null;
  equipo_nombre: string | null;
  camisetas: number;
}

/** El objetivo de un cambio de rol, tal y como está guardado ahora mismo. */
interface ObjetivoRol {
  id: number;
  rol_id: number | null;
  rol_clave: string | null;
}

/** De `perfiles` solo queda el avatar: sigue colgando de la cuenta. */
interface PerfilRow {
  avatar_key: string | null;
}

export const onRequestGet: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requirePermiso(request, env, "usuarios.ver");
  if (acceso instanceof Response) return acceso;

  const id = idDeQuery(new URL(request.url));

  try {
    if (id !== null) {
      const ficha = await cargarFicha(env.DB, id);
      if (!ficha) return jsonAdmin({ error: "Esa cuenta ya no existe." }, 404);
      return jsonAdmin({ usuario: ficha });
    }

    const [usuarios, roles] = await Promise.all([
      env.DB
        .prepare(
          `SELECT u.id, u.email, u.nombre, u.foto_url, u.created_at,
                  u.rol_id, r.clave AS rol_clave, r.nombre AS rol_nombre,
                  e.id AS equipo_id, e.nombre AS equipo_nombre,
                  (SELECT COUNT(*) FROM camisetas_reservas c WHERE c.owner_user_id = u.id) AS camisetas
           FROM usuarios u
           LEFT JOIN roles r ON r.id = u.rol_id
           LEFT JOIN equipos e ON e.id = (
             SELECT eq.id FROM equipos eq
             JOIN jugadores cap ON cap.id = eq.capitan_jugador_id
             WHERE cap.email_normalizado = lower(trim(u.email))
             ORDER BY eq.created_at DESC, eq.id DESC LIMIT 1
           )
           ORDER BY (r.clave = ?1) DESC, u.rol_id IS NULL, u.created_at ASC, u.id ASC`
        )
        .bind(ROL_ADMIN)
        .all<UsuarioRow>(),
      // El desplegable de rol se pinta con esto. Va aquí y no en /api/admin/roles
      // para que quien administra cuentas no necesite además `roles.ver`.
      env.DB
        .prepare("SELECT id, clave, nombre FROM roles ORDER BY es_sistema DESC, nombre COLLATE NOCASE ASC")
        .all<{ id: number; clave: string; nombre: string }>()
    ]);

    return jsonAdmin({
      usuarios: usuarios.results.map((fila) => ({
        id: fila.id,
        email: fila.email,
        nombre: fila.nombre,
        rolId: fila.rol_id,
        rolClave: fila.rol_clave,
        rolNombre: fila.rol_nombre,
        esAdmin: fila.rol_clave === ROL_ADMIN,
        createdAt: fila.created_at,
        equipoId: fila.equipo_id,
        equipoNombre: fila.equipo_nombre,
        camisetas: fila.camisetas
      })),
      roles: roles.results
    });
  } catch (err) {
    console.error("Error leyendo usuarios desde el panel:", err);
    return jsonAdmin({ error: "No se han podido cargar las cuentas." }, 500);
  }
};

export const onRequestPatch: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requirePermiso(request, env, "usuarios.editar");
  if (acceso instanceof Response) return acceso;

  const usuarioId = idDeQuery(new URL(request.url));
  if (usuarioId === null) return accionNoValida();

  const usuario = await env.DB
    .prepare(
      `SELECT u.id, u.rol_id, r.clave AS rol_clave
         FROM usuarios u LEFT JOIN roles r ON r.id = u.rol_id
        WHERE u.id = ?1`
    )
    .bind(usuarioId)
    .first<ObjetivoRol>();
  if (!usuario) return jsonAdmin({ error: "Esa cuenta ya no existe." }, 404);

  const body = ((await request.json().catch(() => null)) || {}) as Record<string, unknown>;

  let rolNuevo: { id: number | null; clave: string | null } | null = null;
  if (body.rolId !== undefined) {
    const resuelto = await resolverRol(env.DB, body.rolId);
    if (resuelto instanceof Response) return resuelto;
    const error = await validarCambioDeRol(env.DB, acceso.permisos, usuario, resuelto);
    if (error) return error;
    rolNuevo = resuelto;
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

  if (rolNuevo) {
    sets.push(`rol_id = ?${binds.length + 1}`);
    binds.push(rolNuevo.id);
    /*
     * Espejo de un solo sentido sobre la columna vieja. Nada la lee ya, pero
     * mientras siga existiendo tiene que decir la verdad: es la red por si hay
     * que volver a una versión anterior del código. Se va con la columna, en la
     * migración que la retira.
     */
    sets.push(`is_admin = ?${binds.length + 1}`);
    binds.push(rolNuevo.clave === ROL_ADMIN ? 1 : 0);
  }

  if (sets.length === 0) return jsonAdmin({ error: "No hay cambios que guardar." }, 400);

  try {
    sets.push("updated_at = datetime('now')");
    binds.push(usuarioId);
    await env.DB.prepare(`UPDATE usuarios SET ${sets.join(", ")} WHERE id = ?${binds.length}`).bind(...binds).run();

    return jsonAdmin({ ok: true, usuario: await cargarFicha(env.DB, usuarioId) });
  } catch (err) {
    console.error("Error actualizando una cuenta desde el panel:", err);
    return jsonAdmin({ error: "No se ha podido guardar la cuenta." }, 500);
  }
};

/** `rolId` puede venir como número (un rol) o como null (sin permisos). */
async function resolverRol(
  db: D1Database,
  valor: unknown
): Promise<{ id: number | null; clave: string | null } | Response> {
  if (valor === null || valor === "") return { id: null, clave: null };

  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) {
    return jsonAdmin({ error: "Revisa los campos marcados.", campos: { rolId: "Elige un rol de la lista." } }, 400);
  }

  const rol = await db.prepare("SELECT id, clave FROM roles WHERE id = ?1").bind(id).first<{ id: number; clave: string }>();
  if (!rol) {
    return jsonAdmin({ error: "Revisa los campos marcados.", campos: { rolId: "Ese rol ya no existe." } }, 400);
  }
  return rol;
}

/**
 * Tres candados sobre el rol.
 *
 * Los dos primeros evitan el encierro: nadie se quita a sí mismo el rol de
 * administración (sería quedarse fuera del panel de un clic) y nunca puede
 * quedar el sistema sin ningún administrador, porque volver a entrar exigiría
 * tocar la base a mano con wrangler.
 *
 * El tercero evita la escalada: quien no es administrador solo puede repartir
 * permisos que ya tiene. Sin él, delegar `usuarios.editar` sería delegar el
 * acceso total, porque bastaría con asignarse a uno mismo un rol mejor.
 */
async function validarCambioDeRol(
  db: D1Database,
  actor: ContextoPermisos,
  objetivo: ObjetivoRol,
  nuevo: { id: number | null; clave: string | null }
): Promise<Response | null> {
  const eraAdmin = objetivo.rol_clave === ROL_ADMIN;
  const seraAdmin = nuevo.clave === ROL_ADMIN;

  if (eraAdmin && !seraAdmin) {
    if (objetivo.id === actor.usuarioId) {
      return jsonAdmin(
        {
          error: "No puedes quitarte a ti mismo el rol de administración.",
          campos: { rolId: "Pídeselo a otro administrador." }
        },
        400
      );
    }

    const otros = await db
      .prepare(
        `SELECT COUNT(*) AS total FROM usuarios u
           JOIN roles r ON r.id = u.rol_id
          WHERE r.clave = ?1 AND u.id <> ?2`
      )
      .bind(ROL_ADMIN, objetivo.id)
      .first<{ total: number }>();
    if ((otros?.total ?? 0) < 1) {
      return jsonAdmin(
        {
          error: "Tiene que quedar al menos un administrador.",
          campos: { rolId: "Nombra antes a otro administrador." }
        },
        409
      );
    }
  }

  if (actor.esAdmin) return null;

  if (seraAdmin) {
    return jsonAdmin(
      {
        error: "Solo un administrador puede nombrar a otro.",
        campos: { rolId: "No puedes conceder el rol de administración." }
      },
      403
    );
  }

  const otorgados = await permisosDelRol(db, nuevo.id);
  const excedidos = otorgados.filter((permiso) => !actor.permisos.has(permiso));
  if (excedidos.length > 0) {
    return jsonAdmin(
      {
        error: "No puedes conceder permisos que tú no tienes.",
        campos: { rolId: `Ese rol incluye ${excedidos.length} permiso(s) fuera de tu alcance.` }
      },
      403
    );
  }

  return null;
}

/** Los permisos de un rol, filtrados al catálogo vigente. */
async function permisosDelRol(db: D1Database, rolId: number | null): Promise<string[]> {
  if (rolId === null) return [];
  const { results } = await db
    .prepare("SELECT permiso FROM rol_permisos WHERE rol_id = ?1")
    .bind(rolId)
    .all<{ permiso: string }>();
  return results.map((fila) => fila.permiso).filter((permiso) => CLAVES_PERMISO.has(permiso));
}

/** Ficha completa: lo mismo que ve el usuario en Mi zona, más sus permisos. */
async function cargarFicha(db: D1Database, usuarioId: number) {
  const usuario = await db
    .prepare(
      `SELECT u.id, u.email, u.nombre, u.foto_url, u.created_at,
              u.rol_id, r.clave AS rol_clave, r.nombre AS rol_nombre
         FROM usuarios u LEFT JOIN roles r ON r.id = u.rol_id
        WHERE u.id = ?1`
    )
    .bind(usuarioId)
    .first<{
      id: number;
      email: string;
      nombre: string | null;
      foto_url: string | null;
      created_at: string;
      rol_id: number | null;
      rol_clave: string | null;
      rol_nombre: string | null;
    }>();
  if (!usuario) return null;

  const emailNormalizado = normalizarEmail(usuario.email);

  const [perfil, equipos, camisetas] = await Promise.all([
    db
      .prepare("SELECT avatar_key FROM perfiles WHERE usuario_id = ?1")
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
    rolId: usuario.rol_id,
    rolClave: usuario.rol_clave,
    rolNombre: usuario.rol_nombre,
    esAdmin: usuario.rol_clave === ROL_ADMIN,
    createdAt: usuario.created_at,
    tieneAvatar: Boolean(perfil?.avatar_key),
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
