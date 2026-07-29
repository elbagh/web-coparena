-- Migration number: 0018 	 ajustes que se giran en caliente
-- El marcador en directo se sirve por sondeo, y el sondeo es lo unico del sitio
-- que puede agotar la cuota de peticiones de Cloudflare justo cuando mas gente
-- esta mirando. Estos tres valores permiten frenar a todos los espectadores
-- desde /admin/torneo/ sin desplegar nada, en mitad de la jornada.
--
-- No se anade ninguna columna `version` a `partidos` para el ETag: `updated_at`
-- ya se toca en cada escritura, y sumandole el marcador vivo se obtiene un valor
-- que cambia con cada punto. Una columna mas seria una cosa mas que mantener en
-- sintonia a cambio de nada.

CREATE TABLE IF NOT EXISTS ajustes (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO ajustes (clave, valor) VALUES
  ('directo_sondeo_ms', '3000'),
  ('directo_sondeo_lento_ms', '60000'),
  ('directo_modo_ahorro', '0');
