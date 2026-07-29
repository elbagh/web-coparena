-- Migration number: 0020 	 el log de eventos de un partido
-- Hasta ahora NADA escribia en `estadisticas`: la tabla y toda la capa de
-- lectura existian desde la 0009, pero no habia ni un INSERT en functions/. El
-- album de jugadores ensenaba ceros. Esto es lo que la llena.
--
-- El log es la FUENTE DE VERDAD del partido. El marcador de `partidos` y las
-- filas de `estadisticas` se derivan de el, no al reves: asi deshacer un punto
-- es borrar una fila y volver a plegar, en vez de restar a mano y rezar.
--
-- Las dos columnas de lado no son una duplicacion:
--   lado_jugador = de que equipo es quien hizo la accion.
--   lado_punto   = que equipo se lleva el punto.
-- Con tipo='error' son DISTINTOS: el error de un jugador da el punto al rival.
-- Guardar uno solo y deducir el otro es el fallo mas probable de todo esto, y
-- el mas caro: no se veria hasta el final del torneo, con las estadisticas y el
-- marcador cruzados. `lado_punto` lo calcula el servidor y nunca se acepta del
-- cliente.

CREATE TABLE IF NOT EXISTS partido_eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partido_id TEXT NOT NULL REFERENCES partidos(id) ON DELETE CASCADE,
  -- Secuencia dentro del partido. El UNIQUE de abajo es el control de
  -- concurrencia: dos anotadores a la vez y el segundo choca en vez de pisar.
  orden INTEGER NOT NULL,
  set_numero INTEGER NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('remate', 'ace', 'bloqueo', 'defensa', 'error', 'ajuste')),
  lado_jugador TEXT CHECK (lado_jugador IN ('A', 'B')),
  jugador_id INTEGER REFERENCES jugadores(id) ON DELETE CASCADE,
  lado_punto TEXT CHECK (lado_punto IN ('A', 'B')),
  -- Solo para tipo='ajuste': el saldo de apertura cuando se adopta un partido
  -- que venia llevandose a mano. No lleva jugador y no genera estadisticas.
  puntos_a INTEGER,
  puntos_b INTEGER,
  sets_a INTEGER,
  sets_b INTEGER,
  usuario_id INTEGER REFERENCES usuarios(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_partido_eventos_orden ON partido_eventos (partido_id, orden);
CREATE INDEX IF NOT EXISTS idx_partido_eventos_jugador ON partido_eventos (jugador_id);

-- Quien esta en pista. Un equipo puede tener hasta quince inscritos y quince
-- botones no son un panel: son un formulario.
CREATE TABLE IF NOT EXISTS partido_alineacion (
  partido_id TEXT NOT NULL REFERENCES partidos(id) ON DELETE CASCADE,
  jugador_id INTEGER NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  lado TEXT NOT NULL CHECK (lado IN ('A', 'B')),
  orden INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (partido_id, jugador_id)
);

CREATE INDEX IF NOT EXISTS idx_partido_alineacion ON partido_alineacion (partido_id, lado, orden);
