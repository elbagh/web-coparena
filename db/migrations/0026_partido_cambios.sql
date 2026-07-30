-- Migration number: 0026 	 los cambios de jugador de un partido
--
-- `partido_alineacion` se sobrescribe entera (fijarAlineacion borra el lado y lo
-- vuelve a insertar): dice QUIEN esta en pista ahora, no como se llego. El
-- historial del directo -- el que enseña «entra Nuria por Marta» como un partido
-- de futbol -- necesita lo segundo, asi que la historia va aparte.
--
-- Y va en tabla propia y no como un `tipo` mas de `partido_eventos` porque
-- anadir un valor a aquel CHECK exige RECONSTRUIR la tabla, y con ella viajan el
-- UNIQUE(partido_id, orden) que es el control de concurrencia entre dos
-- anotadores y los ON DELETE CASCADE de los que cuelga `estadisticas`. Ademas un
-- cambio no es un punto: no pliega, no puntua y no genera estadisticas. Nada de
-- `plegarEventos` ni del agregado de `sentenciasDerivadas` lo menciona.

CREATE TABLE IF NOT EXISTS partido_cambios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partido_id TEXT NOT NULL REFERENCES partidos(id) ON DELETE CASCADE,

  -- Donde cae en el historial: el `orden` del ULTIMO evento anterior al cambio,
  -- o -1 si ocurre antes del primer punto. Un evento va en (orden, 0) y un
  -- cambio en (tras_orden, 1, id), asi que el cambio queda justo detras de ese
  -- punto y delante del siguiente; el id autoincremental desempata dos cambios
  -- seguidos sin punto entre medias (los dos equipos en el mismo tiempo muerto).
  --
  -- NO es clave ajena a partido_eventos: ese punto se puede deshacer y el cambio
  -- siguio ocurriendo. Lo calcula el servidor, nunca el cliente, igual que
  -- `lado_punto`.
  tras_orden INTEGER NOT NULL,

  lado TEXT NOT NULL CHECK (lado IN ('A', 'B')),
  entra_jugador_id INTEGER NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  sale_jugador_id INTEGER NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,

  -- El hueco de `partido_alineacion.orden` que ocupaba quien sale y que hereda
  -- quien entra. Es lo que permite deshacer un cambio sin que los retratos de la
  -- pista salten de sitio.
  posicion INTEGER NOT NULL,

  set_numero INTEGER NOT NULL,
  usuario_id INTEGER REFERENCES usuarios(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_partido_cambios ON partido_cambios (partido_id, tras_orden, id);
CREATE INDEX IF NOT EXISTS idx_partido_cambios_entra ON partido_cambios (entra_jugador_id);
CREATE INDEX IF NOT EXISTS idx_partido_cambios_sale ON partido_cambios (sale_jugador_id);
