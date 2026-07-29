-- Migration number: 0022 	 plazas directas por grupo y repesca por fase
-- Solo ALTER, y por eso va en su propio fichero: ADD COLUMN no es idempotente y
-- D1 reejecuta el fichero entero si una sentencia falla a mitad.
--
-- `torneo_fases.clasifican` solo sabe decir "los N primeros de CADA grupo", y eso
-- no siempre es la regla. Con grupos de tamanos distintos, el tercero de un grupo
-- de cinco puede pasar directo mientras los terceros de los grupos de cuatro se
-- juegan una sola plaza entre ellos.
--
-- `clasifican` NULL en el grupo significa "hereda de la fase", igual que `reglas`
-- y por el mismo motivo: distinguir "hereda" de "coincide por casualidad" importa
-- al editar. Y no es lo mismo que 0, que seria "de aqui no pasa nadie".
--
-- `en_repesca` por defecto 1 para que nada existente cambie de comportamiento:
-- sin plazas de repesca en la fase (repesca = 0), da igual quien este en el bote.

ALTER TABLE torneo_grupos ADD COLUMN clasifican INTEGER;
ALTER TABLE torneo_grupos ADD COLUMN en_repesca INTEGER NOT NULL DEFAULT 1;
ALTER TABLE torneo_fases ADD COLUMN repesca INTEGER NOT NULL DEFAULT 0;
