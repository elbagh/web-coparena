-- Migration number: 0013 	 roles y permisos
-- El acceso al panel deja de ser un booleano (usuarios.is_admin) y pasa a ser un
-- rol con un conjunto de permisos. El catalogo de permisos vive en codigo
-- (functions/_lib/permisos.ts); aqui solo viven las asignaciones.
--
-- is_admin NO se borra en esta migracion, y no es un descuido. El despliegue
-- aplica las migraciones ANTES de subir el codigo (predeploy:worker en
-- package.json), asi que durante unos segundos el codigo viejo sigue sirviendo
-- trafico. Si la columna desapareciera, ese codigo ejecutaria SELECT is_admin en
-- requireAdmin y, peor, en getAuthContext, que sostiene /api/me para todo el
-- mundo. La columna se retira en una migracion posterior, cuando produccion ya
-- lleve una version que no la lee.
--
-- El rol 'admin' NO lleva filas en rol_permisos: sus permisos son implicitos y
-- totales. Materializarlos permitiria que un administrador se quitase
-- 'roles.editar' y dejase el sistema sin nadie capaz de repartir permisos.
--
-- D1 manda el fichero como una sola consulta multi-sentencia, sin transaccion:
-- todo tiene que poder repetirse, y por eso el unico ALTER va al final (ADD
-- COLUMN no es idempotente y no hay IF NOT EXISTS que valga).

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clave TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  es_sistema INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rol_permisos (
  rol_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permiso TEXT NOT NULL,
  PRIMARY KEY (rol_id, permiso)
);

INSERT OR IGNORE INTO roles (clave, nombre, descripcion, es_sistema) VALUES
  ('admin', 'Administracion', 'Acceso total. No se puede editar ni borrar.', 1),
  ('organizacion', 'Organizacion', 'Gestiona equipos, jugadores, camisetas y el torneo. No toca cuentas ni roles.', 0);

-- Replicado a mano desde ROLES_SISTEMA en functions/_lib/permisos.ts. Una
-- migracion no puede importar del codigo, asi que la paridad la vigila
-- test/unit/paridad-permisos.test.ts.
--
-- Va como un unico INSERT ... VALUES y no como una cadena de SELECT ... UNION
-- ALL: el SQLite de workerd corta los compound SELECT en muchos menos terminos
-- de los que admite el de escritorio, y con 18 permisos ya responde
-- "too many terms in compound SELECT".
INSERT OR IGNORE INTO rol_permisos (rol_id, permiso) VALUES
  ((SELECT id FROM roles WHERE clave = 'organizacion'), 'panel.entrar'),
  ((SELECT id FROM roles WHERE clave = 'organizacion'), 'equipos.ver'),
  ((SELECT id FROM roles WHERE clave = 'organizacion'), 'equipos.editar'),
  ((SELECT id FROM roles WHERE clave = 'organizacion'), 'equipos.borrar'),
  ((SELECT id FROM roles WHERE clave = 'organizacion'), 'jugadores.ver'),
  ((SELECT id FROM roles WHERE clave = 'organizacion'), 'jugadores.editar'),
  ((SELECT id FROM roles WHERE clave = 'organizacion'), 'jugadores.borrar'),
  ((SELECT id FROM roles WHERE clave = 'organizacion'), 'estadisticas.ver'),
  ((SELECT id FROM roles WHERE clave = 'organizacion'), 'estadisticas.editar'),
  ((SELECT id FROM roles WHERE clave = 'organizacion'), 'camisetas.ver'),
  ((SELECT id FROM roles WHERE clave = 'organizacion'), 'camisetas.editar'),
  ((SELECT id FROM roles WHERE clave = 'organizacion'), 'camisetas.borrar'),
  ((SELECT id FROM roles WHERE clave = 'organizacion'), 'partidos.editar'),
  ((SELECT id FROM roles WHERE clave = 'organizacion'), 'partidos.borrar'),
  ((SELECT id FROM roles WHERE clave = 'organizacion'), 'torneo.ver'),
  ((SELECT id FROM roles WHERE clave = 'organizacion'), 'torneo.editar'),
  ((SELECT id FROM roles WHERE clave = 'organizacion'), 'ediciones.ver'),
  ((SELECT id FROM roles WHERE clave = 'organizacion'), 'ediciones.editar');

-- rol_id NULL = sin permisos, que es lo que corresponde a casi todas las
-- cuentas: la inmensa mayoria son jugadores que entran a ver su equipo.
ALTER TABLE usuarios ADD COLUMN rol_id INTEGER REFERENCES roles(id);
