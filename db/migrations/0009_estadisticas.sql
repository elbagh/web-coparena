-- Migration number: 0009 	 estadisticas y perfiles publicos
-- Da soporte al directorio publico /jugadores/: estadisticas de juego por
-- persona, atributos puestos por la organizacion y un interruptor para sacar a
-- alguien del listado.

-- Una fila = una carga de estadisticas de un jugador.
--   partido_id NULL      -> carga manual de la edicion (lo unico que existe hoy)
--   partido_id NOT NULL  -> lo que registrara el sistema de resultados por partido
-- Los totales que se muestran son SUM(...) de todas las filas del jugador, de
-- modo que ambas fuentes conviven sin cambiar ninguna consulta: cuando llegue el
-- registro por partido bastara con dejar la fila manual a cero (o borrarla).
--
-- La edicion NO se repite aqui a proposito. `jugadores` ya es una fila por
-- persona y edicion (jugadores.edicion_id), asi que la edicion de una
-- estadistica sale del JOIN con su jugador y no puede desincronizarse cuando el
-- panel mueve a alguien de equipo.
CREATE TABLE IF NOT EXISTS estadisticas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jugador_id INTEGER NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  partido_id TEXT REFERENCES partidos(id) ON DELETE CASCADE,
  partidos_jugados INTEGER NOT NULL DEFAULT 0,
  puntos INTEGER NOT NULL DEFAULT 0,
  remates INTEGER NOT NULL DEFAULT 0,
  bloqueos INTEGER NOT NULL DEFAULT 0,
  aces INTEGER NOT NULL DEFAULT 0,
  defensas INTEGER NOT NULL DEFAULT 0,
  errores INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Una sola carga manual por jugador y una sola fila por jugador y partido. Los
-- indices van partidos porque en SQLite dos NULL no chocan en un UNIQUE, asi
-- que un UNIQUE(jugador_id, partido_id) a secas dejaria colar varias manuales.
CREATE UNIQUE INDEX IF NOT EXISTS idx_estadisticas_manual
  ON estadisticas (jugador_id) WHERE partido_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_estadisticas_partido
  ON estadisticas (jugador_id, partido_id) WHERE partido_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_estadisticas_jugador ON estadisticas (jugador_id);

-- Los partidos tambien pasan a saber de que edicion son, para que el sistema de
-- resultados que viene pueda cerrar una edicion sin arrastrar los cruces del ano
-- anterior.
ALTER TABLE partidos ADD COLUMN edicion_id INTEGER REFERENCES ediciones(id);
UPDATE partidos SET edicion_id = (SELECT id FROM ediciones WHERE es_actual = 1)
  WHERE edicion_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_partidos_edicion ON partidos (edicion_id);

-- Los atributos (saque, remate, bloqueo...) dejan de colgar de la cuenta de
-- Google y pasan a colgar del jugador de esa edicion. Son dos cambios en uno:
--   1. ahora los pone la organizacion, no cada cual sobre si mismo, y el panel
--      tiene que poder valorar tambien a quien nunca ha iniciado sesion;
--   2. al ir por jugador, la valoracion puede cambiar de una edicion a otra.
CREATE TABLE IF NOT EXISTS jugador_atributos (
  jugador_id INTEGER PRIMARY KEY REFERENCES jugadores(id) ON DELETE CASCADE,
  atributos TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Rescate de lo que cada cual se habia puesto en Mi zona, cruzando por correo.
INSERT OR IGNORE INTO jugador_atributos (jugador_id, atributos)
SELECT j.id, p.atributos
FROM jugadores j
JOIN usuarios u ON LOWER(TRIM(u.email)) = j.email_normalizado
JOIN perfiles p ON p.usuario_id = u.id
WHERE p.atributos IS NOT NULL AND p.atributos <> '' AND p.atributos <> '{}';

-- Una sola fuente de verdad: la columna vieja se va.
ALTER TABLE perfiles DROP COLUMN atributos;

-- Derecho de oposicion: sacar a una persona del directorio publico sin borrarla
-- de la inscripcion.
ALTER TABLE jugadores ADD COLUMN oculto_publico INTEGER NOT NULL DEFAULT 0;
