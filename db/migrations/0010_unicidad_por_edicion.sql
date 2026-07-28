-- Migration number: 0010 	 unicidad de jugador por edicion
-- El aviso que dejaba 0006 escrito: los indices UNIQUE de `jugadores` eran
-- globales, asi que una persona solo podia estar inscrita **una vez en toda la
-- historia** del torneo. Con una sola edicion viva no molestaba; con el perfil
-- publico si, porque la ficha promete «en que equipos jugo en cada edicion» y
-- con estos indices ese historial nunca podia tener mas de una linea.
--
-- Ahora la unicidad es por edicion: dentro de un mismo ano no puede repetirse ni
-- el nombre completo, ni el movil, ni el correo; entre anos, la misma persona
-- vuelve a inscribirse sin tocar nada.
--
-- El nombre de equipo (equipos.nombre_normalizado) sigue siendo unico global: es
-- una restriccion de columna, no un indice, y cambiarla obliga a reconstruir la
-- tabla. Se deja para cuando de verdad haya que reutilizar un nombre.

DROP INDEX IF EXISTS idx_jugadores_nombre;
DROP INDEX IF EXISTS idx_jugadores_telefono;
DROP INDEX IF EXISTS idx_jugadores_email;

CREATE UNIQUE INDEX IF NOT EXISTS idx_jugadores_nombre
  ON jugadores (edicion_id, nombre_completo_normalizado);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jugadores_telefono
  ON jugadores (edicion_id, telefono_normalizado);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jugadores_email
  ON jugadores (edicion_id, email_normalizado) WHERE email_normalizado IS NOT NULL;
