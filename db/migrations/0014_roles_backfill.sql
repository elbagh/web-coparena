-- Migration number: 0014 	 quien era admin pasa a tener el rol admin
-- Va en un fichero aparte de la 0013 porque depende de la columna que aquella
-- anade: D1 manda cada fichero como una consulta multi-sentencia y no garantiza
-- que un UPDATE escrito debajo de su ALTER TABLE vea ya la columna nueva.
--
-- is_admin sigue en pie y sigue siendo la verdad de la que se parte. A partir de
-- aqui el codigo solo lee rol_id, y la columna vieja queda como red por si hay
-- que volver atras.

UPDATE usuarios
   SET rol_id = (SELECT id FROM roles WHERE clave = 'admin')
 WHERE is_admin = 1 AND rol_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_usuarios_rol ON usuarios (rol_id);
