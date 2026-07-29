-- Migration number: 0017 	 indices del cuadro
-- Van sueltos porque dependen de las columnas que anade la 0016 y D1 no da
-- transaccion por fichero.
--
-- El cuadro se lee siempre igual: todos los partidos de una fase, ordenados por
-- ronda y posicion. Y al cerrar un partido hay que encontrar rapido a quien
-- apunta, para propagar el ganador.

CREATE INDEX IF NOT EXISTS idx_partidos_fase ON partidos (fase_id, ronda_orden, posicion);
CREATE INDEX IF NOT EXISTS idx_partidos_grupo ON partidos (grupo_id);
CREATE INDEX IF NOT EXISTS idx_partidos_siguiente ON partidos (siguiente_partido_id);
CREATE INDEX IF NOT EXISTS idx_partidos_perdedor ON partidos (perdedor_partido_id);
