// Catálogo de permisos y puerta de las rutas del panel.
//
// El catálogo vive **aquí**, en código, no en la base: qué acciones existen es
// una propiedad del programa, y tenerlo tipado permite que un permiso mal
// escrito en un endpoint sea un error de compilación en vez de un 403 en
// producción. Lo que sí vive en la base es la **asignación**: qué permisos tiene
// cada rol (`rol_permisos`) y qué rol tiene cada persona (`usuarios.rol_id`).
//
// El rol `admin` es de sistema y sus permisos son implícitos y totales: no lleva
// filas en `rol_permisos`. Si se materializaran, un administrador podría
// quitarse `roles.editar` y dejar el sistema sin nadie capaz de repartir
// permisos — la misma clase de encierro que ya evitaba el candado del último
// admin.
//
// La lista de abajo está replicada a mano en la semilla de
// db/migrations/0013_roles.sql, porque una migración no puede importar de aquí.
// test/unit/paridad-permisos.test.ts falla si divergen.
//
// Este fichero **no importa nada de auth.ts**, y no es casualidad: `auth.ts`
// necesita consultar permisos para resolver una suplantación, así que si aquí
// se importara `requireUser` los dos módulos quedarían en círculo. La puerta de
// endpoint (`requirePermiso`) vive por eso en `_lib/admin.ts`, que ya depende de
// los dos.

export type Permiso = string;

export const ROL_ADMIN = "admin";

/** Los recursos del panel, con el nombre que se le enseña a la persona. */
export const RECURSOS = {
  panel: "Panel",
  equipos: "Equipos",
  jugadores: "Jugadores",
  estadisticas: "Estadísticas",
  camisetas: "Camisetas",
  partidos: "Partidos",
  torneo: "Torneo",
  ediciones: "Ediciones",
  usuarios: "Usuarios",
  roles: "Roles y permisos"
} as const;

export type Recurso = keyof typeof RECURSOS;

/*
 * Son cabeceras de columna en la matriz de /admin/roles/, así que van cortas.
 * «Ver como» además es el nombre que esa función tiene en todo el producto —el
 * botón de /admin/usuarios/, la banda de aviso, la propia cookie—, y una acción
 * debería llamarse igual en todo el recorrido.
 */
export const ACCIONES = {
  entrar: "Entrar",
  ver: "Ver",
  editar: "Crear y editar",
  borrar: "Borrar",
  ver_como: "Ver como",
  anotar: "Anotar en directo"
} as const;

export type Accion = keyof typeof ACCIONES;

/*
 * Qué acciones tiene sentido pedir sobre cada recurso.
 *
 * `partidos` no tiene `ver`: GET /api/partidos es público (lo lee la portada),
 * así que un permiso de lectura no guardaría nada. La página del panel se abre
 * con `torneo.ver`.
 *
 * `partidos.anotar` es distinto de `partidos.editar` a propósito: quien anota
 * lleva el marcador de un partido punto a punto, pero no crea cruces, no los
 * borra ni toca el cuadro. Es el permiso que sostiene el rol de anotador.
 */
const CATALOGO: Record<Recurso, readonly Accion[]> = {
  panel: ["entrar"],
  equipos: ["ver", "editar", "borrar"],
  jugadores: ["ver", "editar", "borrar"],
  estadisticas: ["ver", "editar"],
  camisetas: ["ver", "editar", "borrar"],
  partidos: ["editar", "borrar", "anotar"],
  torneo: ["ver", "editar"],
  ediciones: ["ver", "editar", "borrar"],
  usuarios: ["ver", "editar", "ver_como"],
  roles: ["ver", "editar"]
};

export interface DefinicionPermiso {
  clave: Permiso;
  recurso: Recurso;
  accion: Accion;
  /** Nombre del recurso, para agrupar en la pantalla de roles. */
  recursoEtiqueta: string;
  /** Nombre de la acción dentro de ese grupo. */
  etiqueta: string;
}

export const PERMISOS: readonly DefinicionPermiso[] = Object.entries(CATALOGO).flatMap(
  ([recurso, acciones]) =>
    acciones.map((accion) => ({
      clave: `${recurso}.${accion}`,
      recurso: recurso as Recurso,
      accion,
      recursoEtiqueta: RECURSOS[recurso as Recurso],
      etiqueta: ACCIONES[accion]
    }))
);

export const CLAVES_PERMISO: ReadonlySet<Permiso> = new Set(PERMISOS.map((p) => p.clave));

export interface RolDeSistema {
  clave: string;
  nombre: string;
  descripcion: string;
  esSistema: boolean;
  /** "todos" solo lo usa `admin`, y significa que no lleva filas en rol_permisos. */
  permisos: readonly Permiso[] | "todos";
}

/** Los roles que siembra la migración 0013. La paridad la comprueba un test. */
export const ROLES_SISTEMA: readonly RolDeSistema[] = [
  {
    clave: ROL_ADMIN,
    nombre: "Administración",
    descripcion: "Acceso total. No se puede editar ni borrar.",
    esSistema: true,
    permisos: "todos"
  },
  {
    clave: "organizacion",
    nombre: "Organización",
    descripcion: "Gestiona equipos, jugadores, camisetas y el torneo. No toca cuentas ni roles.",
    esSistema: false,
    permisos: [
      "panel.entrar",
      "equipos.ver",
      "equipos.editar",
      "equipos.borrar",
      "jugadores.ver",
      "jugadores.editar",
      "jugadores.borrar",
      "estadisticas.ver",
      "estadisticas.editar",
      "camisetas.ver",
      "camisetas.editar",
      "camisetas.borrar",
      "partidos.editar",
      "partidos.borrar",
      "torneo.ver",
      "torneo.editar",
      "ediciones.ver",
      "ediciones.editar"
    ]
  },
  {
    clave: "anotador",
    nombre: "Anotador",
    descripcion: "Lleva el marcador de los partidos en directo. No toca el cuadro ni las cuentas.",
    esSistema: false,
    /*
     * Deliberadamente corto. Un anotador necesita entrar al panel, ver quién
     * juega para poder atribuir cada punto, y anotar. Nada más: ni crear
     * cruces, ni borrarlos, ni tocar el formato.
     */
    permisos: ["panel.entrar", "jugadores.ver", "torneo.ver", "partidos.anotar"]
  }
];

export interface ContextoPermisos {
  usuarioId: number;
  rolId: number | null;
  rolClave: string | null;
  rolNombre: string | null;
  /** Solo el rol de sistema `admin`. Lleva el catálogo entero en `permisos`. */
  esAdmin: boolean;
  permisos: ReadonlySet<Permiso>;
}

interface FilaPermiso {
  rol_id: number | null;
  rol_clave: string | null;
  rol_nombre: string | null;
  permiso: string | null;
}

export function sinRol(usuarioId: number): ContextoPermisos {
  return {
    usuarioId,
    rolId: null,
    rolClave: null,
    rolNombre: null,
    esAdmin: false,
    permisos: new Set()
  };
}

/*
 * Recibe el id, no la Request: `getAuthContext` la llama con el usuario **real**
 * y `requirePermiso` con el **efectivo**, que durante una suplantación no son el
 * mismo. Si esta función resolviera la sesión por su cuenta se llamarían la una
 * a la otra en círculo.
 *
 * No hay memo por petición: en el camino normal solo se consulta una vez, y
 * cuando hay suplantación las dos llamadas son de usuarios distintos, así que
 * cachear no ahorraría nada y sí añadiría una vía para servir permisos de quien
 * no toca.
 */
export async function permisosDeUsuario(db: D1Database, usuarioId: number): Promise<ContextoPermisos> {
  const { results } = await db
    .prepare(
      `SELECT u.rol_id, r.clave AS rol_clave, r.nombre AS rol_nombre, rp.permiso
         FROM usuarios u
         LEFT JOIN roles r ON r.id = u.rol_id
         LEFT JOIN rol_permisos rp ON rp.rol_id = r.id
        WHERE u.id = ?1`
    )
    .bind(usuarioId)
    .all<FilaPermiso>();

  const primera = results[0];
  if (!primera || primera.rol_id === null) return sinRol(usuarioId);

  const esAdmin = primera.rol_clave === ROL_ADMIN;
  // Las claves que ya no están en el catálogo (un permiso retirado en una
  // versión posterior) se ignoran en vez de romper: la fila sobra, no miente.
  const permisos = esAdmin
    ? CLAVES_PERMISO
    : new Set(results.map((fila) => fila.permiso).filter((p): p is string => p !== null && CLAVES_PERMISO.has(p)));

  return {
    usuarioId,
    rolId: primera.rol_id,
    rolClave: primera.rol_clave,
    rolNombre: primera.rol_nombre,
    esAdmin,
    permisos
  };
}

export const tienePermiso = (ctx: ContextoPermisos, permiso: Permiso): boolean => ctx.permisos.has(permiso);

export const tieneAlguno = (ctx: ContextoPermisos, permisos: readonly Permiso[]): boolean =>
  permisos.some((permiso) => ctx.permisos.has(permiso));

/** Lo que /api/me deja ver: claves y nombre del rol, nunca ids internos. */
export function permisosPublicos(ctx: ContextoPermisos) {
  return {
    rol: ctx.rolClave,
    rolNombre: ctx.rolNombre,
    esAdmin: ctx.esAdmin,
    permisos: [...ctx.permisos].sort()
  };
}
