-- Migration number: 0015 	 fases y grupos del torneo
-- El cuadro deja de ser una lista plana de partidos con una `ronda` de texto
-- libre. Una edicion tiene fases (grupos o eliminatoria), una fase de grupos
-- tiene grupos, y un grupo tiene equipos.
--
-- Las reglas (sets, puntos por set, puntos por victoria, criterios de
-- desempate) viven como JSON en la fase, y un grupo puede sobrescribirlas: el
-- formato cambia segun cuantos equipos tenga cada grupo, asi que un grupo de
-- tres puede jugar a un set y uno de cinco al mejor de tres. `reglas` NULL en el
-- grupo significa "hereda de la fase".
--
-- Solo CREATE: los ALTER sobre `partidos` van en la 0016, porque D1 manda cada
-- fichero como una consulta multi-sentencia sin transaccion y no garantiza que
-- una sentencia vea la columna que anade otra escrita mas arriba.

CREATE TABLE IF NOT EXISTS torneo_fases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  edicion_id INTEGER NOT NULL REFERENCES ediciones(id) ON DELETE CASCADE,
  clave TEXT NOT NULL,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('grupos', 'eliminatoria')),
  orden INTEGER NOT NULL DEFAULT 0,
  reglas TEXT NOT NULL DEFAULT '{}',
  -- Cuantos equipos pasan de cada grupo a la fase siguiente. 0 en una
  -- eliminatoria, donde no clasifica nadie: se gana o se va a casa.
  clasifican INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_torneo_fases_clave ON torneo_fases (edicion_id, clave);
CREATE INDEX IF NOT EXISTS idx_torneo_fases_edicion ON torneo_fases (edicion_id, orden);

CREATE TABLE IF NOT EXISTS torneo_grupos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fase_id INTEGER NOT NULL REFERENCES torneo_fases(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0,
  reglas TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_torneo_grupos_nombre ON torneo_grupos (fase_id, nombre);

-- fase_id se repite aqui a proposito, aunque se pueda deducir del grupo: es la
-- unica forma de impedir POR ESQUEMA que un equipo caiga en dos grupos de la
-- misma fase. Comprobarlo solo en el endpoint dejaria la puerta abierta a que
-- cualquier via futura de escritura se la saltase.
CREATE TABLE IF NOT EXISTS torneo_grupo_equipos (
  grupo_id INTEGER NOT NULL REFERENCES torneo_grupos(id) ON DELETE CASCADE,
  fase_id INTEGER NOT NULL REFERENCES torneo_fases(id) ON DELETE CASCADE,
  equipo_id INTEGER NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
  orden INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (grupo_id, equipo_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_torneo_grupo_equipos_fase
  ON torneo_grupo_equipos (fase_id, equipo_id);
