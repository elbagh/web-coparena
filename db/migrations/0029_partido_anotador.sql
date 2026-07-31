-- Migration number: 0029 	 quien lleva la anotacion de un partido
-- Un solo ALTER, y por eso va suelto, igual que la 0021 y la 0027: ADD COLUMN no
-- es idempotente y D1 reejecuta el fichero entero si algo falla a mitad, asi que
-- dos ALTER juntos dejan el segundo intento muerto en el primero.
--
-- El UNIQUE(partido_id, orden) de partido_eventos impide que un punto pise a
-- otro, pero solo salta cuando dos anotadores coinciden en el mismo hueco. Si se
-- turnan sin chocar, los dos llevan el mismo partido y ninguno se entera. Con
-- una sola pista ese es el caso normal, no el raro.
--
-- NULL significa que no lo lleva nadie, que es como nace todo partido existente.
-- Migracion aditiva: el codigo viejo, que sigue sirviendo trafico mientras
-- despliega el nuevo, no la lee.
--
-- No hay columna «desde cuando»: partidos.updated_at ya sube en toda escritura
-- del anotador y solo el dueno puede escribir, asi que esa marca ya es «la
-- ultima vez que anoto quien lo lleva».

ALTER TABLE partidos ADD COLUMN anotador_usuario_id INTEGER REFERENCES usuarios(id);
