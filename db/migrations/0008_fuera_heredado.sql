-- Migration number: 0008 	 fuera lo heredado
-- Retirada de las dos tablas de la primera version del sitio, cuando el
-- formulario era un "nombre + email" suelto: `inscripciones` y `reservas`.
--
-- Hace tiempo que nadie las escribe (las altas van a equipos+jugadores y las
-- camisetas a camisetas_reservas) y ya no queda quien las lea: el endpoint
-- GET /api/admin/heredado y la pagina /admin/heredado/ desaparecen en este
-- mismo cambio. Se comprobo antes de borrar que en produccion estaban las dos
-- a cero filas.
--
-- No confundir `reservas` con `camisetas_reservas` (migracion 0004), que es la
-- tabla viva de reservas de camiseta y no se toca.

DROP TABLE IF EXISTS inscripciones;
DROP TABLE IF EXISTS reservas;
