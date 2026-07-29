-- Migration number: 0016 	 los partidos saben de que fase son y a donde llevan
-- Solo ALTER, y por eso va en su propio fichero: ADD COLUMN no es idempotente y
-- D1 reejecuta el fichero entero si una sentencia falla a mitad. Los indices van
-- en la 0017 por lo mismo.
--
-- `reglas` es una FOTO congelada de las que regian cuando se creo el partido, no
-- una referencia a las de la fase. Cambiar el formato a mitad de torneo no puede
-- reescribir la historia de lo ya jugado -- es el mismo instinto que congelar
-- equipo_a_nombre en vez de leerlo siempre de la tabla de equipos.
--
-- `origen_equipo_a/b` distingue quien puso ese equipo en ese hueco: el sorteo, la
-- progresion automatica del ganador de otro partido, o una mano humana. Sin esa
-- marca, propagar un resultado pisaria en silencio un cruce corregido a mano.

ALTER TABLE partidos ADD COLUMN fase_id INTEGER REFERENCES torneo_fases(id);
ALTER TABLE partidos ADD COLUMN grupo_id INTEGER REFERENCES torneo_grupos(id);

-- Profundidad en el cuadro (0 = primera ronda) y hueco dentro de esa ronda.
ALTER TABLE partidos ADD COLUMN ronda_orden INTEGER;
ALTER TABLE partidos ADD COLUMN posicion INTEGER;

-- A donde va el ganador, y a donde el perdedor (el partido por el tercer puesto).
ALTER TABLE partidos ADD COLUMN siguiente_partido_id TEXT REFERENCES partidos(id) ON DELETE SET NULL;
ALTER TABLE partidos ADD COLUMN siguiente_slot TEXT;
ALTER TABLE partidos ADD COLUMN perdedor_partido_id TEXT REFERENCES partidos(id) ON DELETE SET NULL;
ALTER TABLE partidos ADD COLUMN perdedor_slot TEXT;

ALTER TABLE partidos ADD COLUMN pista TEXT;
ALTER TABLE partidos ADD COLUMN reglas TEXT NOT NULL DEFAULT '{}';
ALTER TABLE partidos ADD COLUMN origen_equipo_a TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE partidos ADD COLUMN origen_equipo_b TEXT NOT NULL DEFAULT 'manual';
