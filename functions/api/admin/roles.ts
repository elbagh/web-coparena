// /api/admin/roles
//   GET            los roles con sus permisos, cuántas cuentas los llevan y el
//                  catálogo entero para pintar la pantalla
//   POST           crea un rol
//   PATCH ?id=N    renombra un rol y reescribe su lista de permisos
//   DELETE ?id=N   borra un rol
//
// El rol de sistema (`admin`) no se toca por ninguna de las tres vías de
// escritura: sus permisos son implícitos y totales, y no existen como filas.
// Si se pudiera editar, un administrador podría quitarse `roles.editar` y dejar
// el sistema sin nadie capaz de repartir permisos.

import {
  requirePermiso,
  jsonAdmin,
  accionNoValida,
  idDeQuery,
  type Acceso,
  type AdminEnv
} from "../../_lib/admin";
import { CLAVES_PERMISO, PERMISOS, ROL_ADMIN, type ContextoPermisos } from "../../_lib/permisos";
import { limpiar } from "../../_lib/validacion";

interface RolRow {
  id: number;
  clave: string;
  nombre: string;
  descripcion: string | null;
  es_sistema: number;
  usuarios: number;
}

export const onRequestGet: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requirePermiso(request, env, "roles.ver");
  if (acceso instanceof Response) return acceso;

  try {
    return jsonAdmin({
      roles: await listarRoles(env.DB),
      // El catálogo va aquí y no duplicado en el cliente: es la misma lista que
      // valida el servidor, así que la pantalla no puede ofrecer un permiso que
      // luego se rechace.
      catalogo: PERMISOS
    });
  } catch (err) {
    console.error("Error leyendo roles:", err);
    return jsonAdmin({ error: "No se han podido cargar los roles." }, 500);
  }
};

export const onRequestPost: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requirePermiso(request, env, "roles.editar");
  if (acceso instanceof Response) return acceso;

  const body = ((await request.json().catch(() => null)) || {}) as Record<string, unknown>;
  const datos = validarRol(body);
  if ("campos" in datos) return jsonAdmin({ error: "Revisa los campos marcados.", campos: datos.campos }, 400);

  const excedidos = permisosFueraDeAlcance(acceso.permisos, datos.permisos);
  if (excedidos) return excedidos;

  try {
    const existe = await env.DB.prepare("SELECT id FROM roles WHERE clave = ?1").bind(datos.clave).first();
    if (existe) {
      return jsonAdmin({ error: "Revisa los campos marcados.", campos: { clave: "Ya hay un rol con esa clave." } }, 409);
    }

    const rol = await env.DB
      .prepare("INSERT INTO roles (clave, nombre, descripcion, es_sistema) VALUES (?1, ?2, ?3, 0) RETURNING id")
      .bind(datos.clave, datos.nombre, datos.descripcion)
      .first<{ id: number }>();

    await guardarPermisos(env.DB, rol!.id, datos.permisos);
    return jsonAdmin({ ok: true, roles: await listarRoles(env.DB) }, 201);
  } catch (err) {
    console.error("Error creando un rol:", err);
    return jsonAdmin({ error: "No se ha podido crear el rol." }, 500);
  }
};

export const onRequestPatch: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requirePermiso(request, env, "roles.editar");
  if (acceso instanceof Response) return acceso;

  const id = idDeQuery(new URL(request.url));
  if (id === null) return accionNoValida();

  const rol = await cargarRolEditable(env.DB, id, acceso);
  if (rol instanceof Response) return rol;

  const body = ((await request.json().catch(() => null)) || {}) as Record<string, unknown>;
  // La clave no se renombra: es lo que referencian el código y las semillas.
  const datos = validarRol({ ...body, clave: rol.clave });
  if ("campos" in datos) return jsonAdmin({ error: "Revisa los campos marcados.", campos: datos.campos }, 400);

  const excedidos = permisosFueraDeAlcance(acceso.permisos, datos.permisos);
  if (excedidos) return excedidos;

  try {
    await env.DB
      .prepare("UPDATE roles SET nombre = ?1, descripcion = ?2, updated_at = datetime('now') WHERE id = ?3")
      .bind(datos.nombre, datos.descripcion, id)
      .run();
    await guardarPermisos(env.DB, id, datos.permisos);
    return jsonAdmin({ ok: true, roles: await listarRoles(env.DB) });
  } catch (err) {
    console.error("Error editando un rol:", err);
    return jsonAdmin({ error: "No se ha podido guardar el rol." }, 500);
  }
};

export const onRequestDelete: PagesFunction<AdminEnv> = async ({ request, env }) => {
  const acceso = await requirePermiso(request, env, "roles.editar");
  if (acceso instanceof Response) return acceso;

  const id = idDeQuery(new URL(request.url));
  if (id === null) return accionNoValida();

  const rol = await cargarRolEditable(env.DB, id, acceso);
  if (rol instanceof Response) return rol;

  try {
    /*
     * La clave ajena de usuarios.rol_id no lleva ON DELETE, así que borrar un
     * rol en uso fallaría con un error de base ilegible. Se comprueba aquí para
     * poder decir cuántas cuentas lo llevan.
     */
    const enUso = await env.DB
      .prepare("SELECT COUNT(*) AS total FROM usuarios WHERE rol_id = ?1")
      .bind(id)
      .first<{ total: number }>();
    if ((enUso?.total ?? 0) > 0) {
      return jsonAdmin(
        {
          error: `Ese rol lo tienen ${enUso!.total} cuenta(s). Cámbiaselo antes de borrarlo.`
        },
        409
      );
    }

    await env.DB.prepare("DELETE FROM roles WHERE id = ?1").bind(id).run();
    return jsonAdmin({ ok: true, roles: await listarRoles(env.DB) });
  } catch (err) {
    console.error("Error borrando un rol:", err);
    return jsonAdmin({ error: "No se ha podido borrar el rol." }, 500);
  }
};

// ---------------------------------------------------------------------------

async function listarRoles(db: D1Database) {
  const [roles, permisos] = await Promise.all([
    db
      .prepare(
        `SELECT r.id, r.clave, r.nombre, r.descripcion, r.es_sistema,
                (SELECT COUNT(*) FROM usuarios u WHERE u.rol_id = r.id) AS usuarios
           FROM roles r
          ORDER BY r.es_sistema DESC, r.nombre COLLATE NOCASE ASC`
      )
      .all<RolRow>(),
    db.prepare("SELECT rol_id, permiso FROM rol_permisos").all<{ rol_id: number; permiso: string }>()
  ]);

  const porRol = new Map<number, string[]>();
  for (const fila of permisos.results) {
    if (!CLAVES_PERMISO.has(fila.permiso)) continue;
    const lista = porRol.get(fila.rol_id) ?? [];
    lista.push(fila.permiso);
    porRol.set(fila.rol_id, lista);
  }

  return roles.results.map((rol) => ({
    id: rol.id,
    clave: rol.clave,
    nombre: rol.nombre,
    descripcion: rol.descripcion,
    esSistema: rol.es_sistema === 1,
    usuarios: rol.usuarios,
    // El rol de sistema no guarda filas: lleva el catálogo entero por definición.
    permisos: rol.clave === ROL_ADMIN ? [...CLAVES_PERMISO].sort() : (porRol.get(rol.id) ?? []).sort()
  }));
}

/** Existe, no es de sistema y quien lo edita alcanza a todos sus permisos. */
async function cargarRolEditable(
  db: D1Database,
  id: number,
  acceso: Acceso
): Promise<{ id: number; clave: string } | Response> {
  const rol = await db
    .prepare("SELECT id, clave, es_sistema FROM roles WHERE id = ?1")
    .bind(id)
    .first<{ id: number; clave: string; es_sistema: number }>();
  if (!rol) return jsonAdmin({ error: "Ese rol ya no existe." }, 404);

  if (rol.es_sistema === 1) {
    return jsonAdmin(
      { error: "El rol de administración es del sistema: no se puede editar ni borrar." },
      409
    );
  }

  if (!acceso.permisos.esAdmin) {
    const { results } = await db
      .prepare("SELECT permiso FROM rol_permisos WHERE rol_id = ?1")
      .bind(id)
      .all<{ permiso: string }>();
    const fuera = results.map((f) => f.permiso).filter((p) => CLAVES_PERMISO.has(p) && !acceso.permisos.permisos.has(p));
    if (fuera.length > 0) {
      return jsonAdmin({ error: "Ese rol tiene permisos que tú no tienes, así que no puedes tocarlo." }, 403);
    }
  }

  return { id: rol.id, clave: rol.clave };
}

interface RolValidado {
  clave: string;
  nombre: string;
  descripcion: string | null;
  permisos: string[];
}

function validarRol(body: Record<string, unknown>): RolValidado | { campos: Record<string, string> } {
  const campos: Record<string, string> = {};

  const clave = limpiar(body.clave).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(clave)) {
    campos.clave = "Entre 2 y 40 caracteres: minúsculas, números y guiones.";
  } else if (clave === ROL_ADMIN) {
    campos.clave = "Esa clave está reservada al rol del sistema.";
  }

  const nombre = limpiar(body.nombre);
  if (nombre.length < 2 || nombre.length > 60) campos.nombre = "Escribe entre 2 y 60 caracteres.";

  const descripcion = limpiar(body.descripcion);
  if (descripcion.length > 160) campos.descripcion = "La descripción no puede pasar de 160 caracteres.";

  const brutos = Array.isArray(body.permisos) ? body.permisos : [];
  const permisos = [...new Set(brutos.map((p) => String(p)))];
  const desconocidos = permisos.filter((p) => !CLAVES_PERMISO.has(p));
  if (desconocidos.length > 0) campos.permisos = `Permisos que no existen: ${desconocidos.join(", ")}.`;

  if (Object.keys(campos).length > 0) return { campos };
  return { clave, nombre, descripcion: descripcion || null, permisos };
}

/**
 * Nadie reparte lo que no tiene. Sin esto, delegar `roles.editar` equivaldría a
 * delegar el acceso total: bastaría con crear un rol con todo y asignárselo.
 */
function permisosFueraDeAlcance(actor: ContextoPermisos, permisos: readonly string[]): Response | null {
  if (actor.esAdmin) return null;
  const excedidos = permisos.filter((permiso) => !actor.permisos.has(permiso));
  if (excedidos.length === 0) return null;

  return jsonAdmin(
    {
      error: "No puedes conceder permisos que tú no tienes.",
      campos: { permisos: `Fuera de tu alcance: ${excedidos.join(", ")}.` }
    },
    403
  );
}

/** Reescribe la lista entera: es más simple que diferenciar y no hay volumen. */
async function guardarPermisos(db: D1Database, rolId: number, permisos: readonly string[]): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM rol_permisos WHERE rol_id = ?1").bind(rolId),
    ...permisos.map((permiso) =>
      db.prepare("INSERT INTO rol_permisos (rol_id, permiso) VALUES (?1, ?2)").bind(rolId, permiso)
    )
  ]);
}
