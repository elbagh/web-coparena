-- Migration number: 0007 	 foto de equipo
-- Foto de grupo del equipo, gestionada solo por el administrador desde el
-- panel. A diferencia de las fotos por jugador (privadas, servidas unicamente
-- tras requireAdmin), esta es publica: se pinta en /equipos/ y en /mi-equipo/.
--
-- Guarda solo la clave del objeto en R2 (bucket FOTOS), nunca la imagen:
--   equipos/<equipo_id>/equipo-<uuid>.<jpg|png|webp>
-- El uuid en la clave hace que reemplazar la foto genere una clave nueva, asi
-- que ningun cache intermedio puede servir la anterior.
--
-- Aditiva: los equipos existentes se quedan con foto_key = NULL.

ALTER TABLE equipos ADD COLUMN foto_key TEXT;
