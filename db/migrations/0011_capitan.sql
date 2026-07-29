-- Migration number: 0011 	 capitan del equipo
-- El capitan sustituye a equipos.owner_user_id: es la fila de jugadores que
-- manda en el equipo. Autoriza a escribir quien inicie sesion con el correo de
-- esa fila, no una cuenta apuntada aparte. Un solo concepto, imposible de
-- contradecir.
--
-- El movil pasa a ser opcional para quien no es capitan. La columna sigue
-- siendo NOT NULL y se guarda cadena vacia: reconstruir la tabla para admitir
-- NULL se llevaria por delante estadisticas y jugador_atributos, que cuelgan de
-- jugadores con ON DELETE CASCADE.

ALTER TABLE equipos ADD COLUMN capitan_jugador_id INTEGER
  REFERENCES jugadores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_equipos_capitan ON equipos (capitan_jugador_id);

-- Backfill 1: el jugador cuyo correo es el de la cuenta propietaria.
--
-- lower(trim()) aqui es ASCII-only (SQLite no baja de caso letras acentuadas),
-- mientras que email_normalizado se escribio con el toLowerCase() de JS
-- (functions/_lib/validacion.ts, normalizarEmail), que si es Unicode-aware.
-- SQL no puede llamar a toLowerCase(): un correo con mayusculas acentuadas no
-- casaria aqui aunque coincida en JS. Se conoce y se acepta -- ningun correo de
-- Google lleva acentos en la practica, y es el mismo desajuste que ya vive en
-- el resto del proyecto entre columnas *_normalizado y SQL suelto.
UPDATE equipos SET capitan_jugador_id = (
  SELECT j.id FROM jugadores j
  JOIN usuarios u ON u.id = equipos.owner_user_id
  WHERE j.equipo_id = equipos.id
    AND j.email_normalizado = lower(trim(u.email))
  ORDER BY j.orden ASC, j.id ASC
  LIMIT 1
);

-- Backfill 2: los que se quedan sin capitan (equipos creados desde el panel,
-- o cuyo propietario no figura en la plantilla) van al jugador de menor orden.
UPDATE equipos SET capitan_jugador_id = (
  SELECT j.id FROM jugadores j
  WHERE j.equipo_id = equipos.id
  ORDER BY j.orden ASC, j.id ASC
  LIMIT 1
) WHERE capitan_jugador_id IS NULL;

-- El indice de movil pasa a parcial: si no, dos jugadores sin movil en la
-- misma edicion (ambos con telefono_normalizado = '') chocarian entre si. La
-- migracion 0010 lo dejo con alcance por edicion (edicion_id,
-- telefono_normalizado); aqui se conserva ese alcance y se anade la condicion
-- parcial.
DROP INDEX IF EXISTS idx_jugadores_telefono;
CREATE UNIQUE INDEX IF NOT EXISTS idx_jugadores_telefono
  ON jugadores (edicion_id, telefono_normalizado) WHERE telefono_normalizado <> '';

-- Fuera la columna anterior: dos columnas que dicen quien manda acaban
-- contradiciendose. El indice va primero, no se puede soltar una columna
-- indexada.
DROP INDEX IF EXISTS idx_equipos_owner_user_id;
ALTER TABLE equipos DROP COLUMN owner_user_id;
