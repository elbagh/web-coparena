-- Migration number: 0006 	 perfiles y ediciones
-- Introduce el concepto de edicion (ano de la Copa Arena) para poder guardar
-- historial y palmares por jugador, y una tabla de perfil (atributos manuales +
-- avatar) para la ficha tipo videojuego de Mi zona.
--
-- Nota sobre unicidad: los indices UNIQUE globales de equipos/jugadores se
-- mantienen por ahora (solo hay una edicion viva). Cuando se abra una segunda
-- edicion habra que recrearlos como compuestos con edicion_id para permitir que
-- una persona/equipo reaparezca; jugadores.edicion_id ya queda listo para ello.

CREATE TABLE IF NOT EXISTS ediciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anio INTEGER NOT NULL,
  nombre TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'en_juego' CHECK (estado IN ('proxima', 'en_juego', 'finalizada')),
  es_actual INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Solo puede haber una edicion marcada como actual.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ediciones_actual
  ON ediciones (es_actual) WHERE es_actual = 1;

-- Semilla: la edicion viva (2026).
INSERT INTO ediciones (anio, nombre, estado, es_actual)
SELECT 2026, 'Copa Arena 2026', 'en_juego', 1
WHERE NOT EXISTS (SELECT 1 FROM ediciones);

-- Vincular equipos, jugadores y reservas a una edicion; anadir posicion final.
ALTER TABLE equipos ADD COLUMN edicion_id INTEGER REFERENCES ediciones(id);
ALTER TABLE equipos ADD COLUMN posicion_final INTEGER;
ALTER TABLE jugadores ADD COLUMN edicion_id INTEGER REFERENCES ediciones(id);
ALTER TABLE camisetas_reservas ADD COLUMN edicion_id INTEGER REFERENCES ediciones(id);

-- Backfill de lo existente a la edicion actual.
UPDATE equipos SET edicion_id = (SELECT id FROM ediciones WHERE es_actual = 1)
  WHERE edicion_id IS NULL;
UPDATE jugadores SET edicion_id = (SELECT id FROM ediciones WHERE es_actual = 1)
  WHERE edicion_id IS NULL;
UPDATE camisetas_reservas SET edicion_id = (SELECT id FROM ediciones WHERE es_actual = 1)
  WHERE edicion_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_equipos_edicion ON equipos (edicion_id);
CREATE INDEX IF NOT EXISTS idx_jugadores_edicion ON jugadores (edicion_id);

-- Perfil del jugador: atributos manuales (tipo videojuego) + avatar en R2.
-- Se identifica por la cuenta de Google (usuarios.id), no por fila de jugador.
CREATE TABLE IF NOT EXISTS perfiles (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  apodo TEXT,
  dorsal INTEGER,
  posicion TEXT,
  mano TEXT,
  lema TEXT,
  atributos TEXT,
  avatar_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
