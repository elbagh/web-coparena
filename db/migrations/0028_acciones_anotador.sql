-- Migration number: 0028 	 catalogo de acciones del anotador
-- El «error» generico desaparece: todo punto se atribuye a alguien del equipo
-- que lo gana. La unica excepcion es el saque fallado, que se atribuye a quien
-- lo fallo y da el punto al rival — por eso la fila sigue guardando los DOS
-- lados y no uno.
--
-- Bloqueo y chilena pasan a decidir por evento si puntuaron o no, y eso ya lo
-- expresa `lado_punto`: NULL significa «no puntuo». No hace falta columna nueva,
-- y anadirla seria un segundo sitio afirmando el mismo hecho.
--
-- Hay que reconstruir la tabla porque SQLite no sabe alterar un CHECK. El riesgo
-- esta acotado: NINGUNA tabla apunta a `partido_eventos` con clave ajena.
-- `partido_cambios.tras_orden` no lo es a proposito (el punto al que se anclo un
-- cambio se puede deshacer, y el cambio siguio ocurriendo) y
-- `estadisticas.partido_id` cuelga de `partidos`. Lo unico que hay que rehacer
-- son sus dos indices, incluido el UNIQUE que serializa a dos anotadores.
--
-- D1 manda el fichero como una sola consulta multi-sentencia y sin transaccion:
-- si algo falla a mitad, lo anterior queda aplicado y la migracion sin registrar,
-- y el siguiente intento vuelve a correrlo entero. Por eso `estadisticas` se
-- reconstruye en vez de usar ALTER TABLE ADD COLUMN, que no es re-ejecutable:
-- un segundo intento moriria con «duplicate column name».

DROP TABLE IF EXISTS partido_eventos_nueva;
CREATE TABLE partido_eventos_nueva (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partido_id TEXT NOT NULL REFERENCES partidos(id) ON DELETE CASCADE,
  orden INTEGER NOT NULL,
  set_numero INTEGER NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('punto', 'ace', 'saque_fallado', 'bloqueo', 'chilena', 'ajuste')),
  lado_jugador TEXT CHECK (lado_jugador IN ('A', 'B')),
  jugador_id INTEGER REFERENCES jugadores(id) ON DELETE CASCADE,
  lado_punto TEXT CHECK (lado_punto IN ('A', 'B')),
  puntos_a INTEGER,
  puntos_b INTEGER,
  sets_a INTEGER,
  sets_b INTEGER,
  usuario_id INTEGER REFERENCES usuarios(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- El mapeo conserva `lado_punto` tal cual en todos los casos, asi que NINGUN
-- marcador se mueve. Ese es el criterio: para 'defensa' no hay equivalente
-- honesto, asi que se elige el que no altera nada (no puntuaba, y como bloqueo
-- sin punto sigue sin puntuar). El CASE es idempotente: 'punto' cae en el ELSE.
INSERT INTO partido_eventos_nueva (
  id, partido_id, orden, set_numero, tipo, lado_jugador, jugador_id, lado_punto,
  puntos_a, puntos_b, sets_a, sets_b, usuario_id, created_at
)
SELECT id, partido_id, orden, set_numero,
       CASE tipo
         WHEN 'remate'  THEN 'punto'
         WHEN 'error'   THEN 'saque_fallado'
         WHEN 'defensa' THEN 'bloqueo'
         ELSE tipo
       END,
       lado_jugador, jugador_id, lado_punto,
       puntos_a, puntos_b, sets_a, sets_b, usuario_id, created_at
FROM partido_eventos;

DROP TABLE IF EXISTS partido_eventos;
ALTER TABLE partido_eventos_nueva RENAME TO partido_eventos;

CREATE UNIQUE INDEX IF NOT EXISTS idx_partido_eventos_orden ON partido_eventos (partido_id, orden);
CREATE INDEX IF NOT EXISTS idx_partido_eventos_jugador ON partido_eventos (jugador_id);

-- `estadisticas` gana `chilenas` y `saques_fallados`.
--
-- `remates`, `defensas` y `errores` NO se van aqui: una migracion se aplica
-- ANTES de que despliegue el codigo nuevo, asi que durante esos segundos el
-- codigo viejo sigue insertando esas columnas. Se quedan a 0, dejan de leerse, y
-- caen una release despues — misma pauta que `is_admin` (0022).
DROP TABLE IF EXISTS estadisticas_nueva;
CREATE TABLE estadisticas_nueva (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jugador_id INTEGER NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  partido_id TEXT NOT NULL REFERENCES partidos(id) ON DELETE CASCADE,
  puntos INTEGER NOT NULL DEFAULT 0,
  remates INTEGER NOT NULL DEFAULT 0,
  bloqueos INTEGER NOT NULL DEFAULT 0,
  chilenas INTEGER NOT NULL DEFAULT 0,
  aces INTEGER NOT NULL DEFAULT 0,
  defensas INTEGER NOT NULL DEFAULT 0,
  errores INTEGER NOT NULL DEFAULT 0,
  saques_fallados INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO estadisticas_nueva (
  id, jugador_id, partido_id, puntos, remates, bloqueos, aces, defensas, errores, created_at, updated_at
)
SELECT id, jugador_id, partido_id, puntos, remates, bloqueos, aces, defensas, errores, created_at, updated_at
FROM estadisticas;

DROP TABLE IF EXISTS estadisticas;
ALTER TABLE estadisticas_nueva RENAME TO estadisticas;

CREATE UNIQUE INDEX IF NOT EXISTS idx_estadisticas_partido ON estadisticas (jugador_id, partido_id);
CREATE INDEX IF NOT EXISTS idx_estadisticas_por_partido ON estadisticas (partido_id);
