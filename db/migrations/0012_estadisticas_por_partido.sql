-- Migration number: 0012 	 estadisticas solo por partido
-- Una estadistica solo puede existir colgando de un partido. La carga manual de
-- la edicion (partido_id IS NULL) desaparece: era la unica via de escritura y
-- permitia teclear cifras que no respondian a ningun partido jugado.
--
-- `partidos_jugados` deja de ser columna. Se deriva contando partidos con ficha,
-- de modo que no puede desincronizarse de las filas que la sostienen.

DELETE FROM estadisticas WHERE partido_id IS NULL;

-- SQLite no sabe volver NOT NULL una columna existente: hay que recrear.
CREATE TABLE estadisticas_nueva (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jugador_id INTEGER NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  partido_id TEXT NOT NULL REFERENCES partidos(id) ON DELETE CASCADE,
  puntos INTEGER NOT NULL DEFAULT 0,
  remates INTEGER NOT NULL DEFAULT 0,
  bloqueos INTEGER NOT NULL DEFAULT 0,
  aces INTEGER NOT NULL DEFAULT 0,
  defensas INTEGER NOT NULL DEFAULT 0,
  errores INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO estadisticas_nueva (
  id, jugador_id, partido_id, puntos, remates, bloqueos, aces, defensas, errores, created_at, updated_at
)
SELECT id, jugador_id, partido_id, puntos, remates, bloqueos, aces, defensas, errores, created_at, updated_at
FROM estadisticas;

DROP TABLE estadisticas;
ALTER TABLE estadisticas_nueva RENAME TO estadisticas;

-- Sin NULL posible, el UNIQUE deja de necesitar ser parcial; el indice de la
-- carga manual (idx_estadisticas_manual) se fue con la tabla que lo tenia.
CREATE UNIQUE INDEX idx_estadisticas_partido ON estadisticas (jugador_id, partido_id);
CREATE INDEX idx_estadisticas_jugador ON estadisticas (jugador_id);
CREATE INDEX idx_estadisticas_por_partido ON estadisticas (partido_id);
