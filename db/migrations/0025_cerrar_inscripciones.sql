-- Migration number: 0025 	 cerrar inscripciones por edicion
-- Cerrar inscripciones es una propiedad de la edicion, igual que `estado`: se
-- gira en caliente desde /admin/ediciones/ sin desplegar. Default abierta (1)
-- para no romper ninguna edicion existente ni el estado de partida de los
-- tests. Cerrar la 2026 en concreto es un paso aparte, hecho a mano desde el
-- panel una vez desplegado (no en la migracion): una migracion cambia
-- esquema, no el estado de un torneo en curso.

ALTER TABLE ediciones ADD COLUMN inscripciones_abiertas INTEGER NOT NULL DEFAULT 1;
