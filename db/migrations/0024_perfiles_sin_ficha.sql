-- Migration number: 0024 	 perfiles se queda solo con el avatar
--
-- La 0023 movio la ficha del cromo (apodo, dorsal, posicion, mano, lema) de
-- `perfiles` -que cuelga de la cuenta de Google- a `jugadores`, y dejo las
-- columnas viejas en su sitio a proposito: el despliegue aplica las migraciones
-- ANTES de subir el codigo, asi que borrarlas en el mismo salto habria dejado al
-- codigo viejo -que todavia servia trafico- haciendo SELECT de columnas que ya
-- no existian. Es la misma cautela que con `usuarios.is_admin`.
--
-- Esta migracion es ese despliegue posterior. NO puede aplicarse hasta que
-- produccion sirva codigo que ya no lee esas columnas (0023 desplegada).
--
-- Lo que sobrevive en `perfiles` es `avatar_key`, que sigue siendo de la cuenta
-- y no se mueve: de el dependen `tieneFoto` y el respaldo de `?foto=N`.

-- ---------------------------------------------------------------- 1. repesca --
--
-- La 0023 ya hizo el traslado, pero entre que se aplico y que subio el codigo
-- nuevo, el viejo pudo seguir escribiendo fichas en `perfiles` desde Mi zona.
-- Eso se quedaria varado, asi que se repesca antes de borrar nada.
--
-- COALESCE y no asignacion directa: manda lo que ya hay en `jugadores`. Si la
-- organizacion ha puesto un apodo desde el panel, no lo pisa una ficha vieja de
-- la cuenta; solo se rellena lo que siga vacio.
UPDATE jugadores AS j
   SET apodo    = COALESCE(j.apodo, p.apodo),
       dorsal   = COALESCE(j.dorsal, p.dorsal),
       posicion = COALESCE(j.posicion, p.posicion),
       mano     = COALESCE(j.mano, p.mano),
       lema     = COALESCE(j.lema, p.lema)
  FROM perfiles p
 WHERE p.usuario_id = (
         SELECT u.id FROM usuarios u
          WHERE LOWER(TRIM(u.email)) = j.email_normalizado
          ORDER BY u.id ASC LIMIT 1
       );

-- ---------------------------------------------------------------- 2. cerrojo --
--
-- Una ficha solo se puede trasladar si esa persona esta inscrita: la ficha vive
-- ahora en la fila del jugador de una edicion, y quien nunca se inscribio no
-- tiene ninguna. Su apodo se perderia al borrar la columna.
--
-- Asi que esta migracion se niega a borrar en ese caso. El truco es una tabla
-- temporal con un CHECK: si el recuento de fichas huerfanas no es cero, el
-- INSERT viola la restriccion y D1 aborta el fichero entero sin haber tocado
-- ninguna columna. Un fallo ruidoso en el despliegue es infinitamente mejor que
-- una perdida de datos silenciosa.
--
-- Si alguna vez salta: mirar quien es (la consulta es la misma de abajo) y o
-- bien darle de alta como jugador, o bien anotar su ficha antes de seguir.
CREATE TABLE _cerrojo_ficha (huerfanas INTEGER NOT NULL CHECK (huerfanas = 0));

INSERT INTO _cerrojo_ficha (huerfanas)
SELECT COUNT(*)
  FROM perfiles p
  JOIN usuarios u ON u.id = p.usuario_id
 WHERE (
         COALESCE(p.apodo, '') <> ''
      OR p.dorsal IS NOT NULL
      OR COALESCE(p.posicion, '') <> ''
      OR COALESCE(p.mano, '') <> ''
      OR COALESCE(p.lema, '') <> ''
       )
   AND NOT EXISTS (
         SELECT 1 FROM jugadores j WHERE j.email_normalizado = LOWER(TRIM(u.email))
       );

DROP TABLE _cerrojo_ficha;

-- ----------------------------------------------------------------- 3. borrar --
--
-- Ninguna de las cinco esta indexada (SQLite se niega a soltar una columna que
-- lo este; fue lo que obligo a la 0022 a tirar antes `idx_usuarios_is_admin`),
-- asi que se van directas.
ALTER TABLE perfiles DROP COLUMN apodo;
ALTER TABLE perfiles DROP COLUMN dorsal;
ALTER TABLE perfiles DROP COLUMN posicion;
ALTER TABLE perfiles DROP COLUMN mano;
ALTER TABLE perfiles DROP COLUMN lema;
