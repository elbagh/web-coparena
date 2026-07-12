-- Migration number: 0002 	 equipos
-- Registro real de equipos con jugadores. La unicidad (nombre de equipo,
-- nombre completo / teléfono / correo de jugador) se garantiza con columnas
-- normalizadas en el endpoint (trim, minúsculas, sin acentos), porque el
-- COLLATE NOCASE de SQLite solo cubre ASCII.

CREATE TABLE IF NOT EXISTS equipos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  nombre_normalizado TEXT NOT NULL UNIQUE,
  consentimiento_rgpd_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jugadores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipo_id INTEGER NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  apellidos TEXT NOT NULL,
  nombre_completo_normalizado TEXT NOT NULL,
  telefono TEXT NOT NULL,
  telefono_normalizado TEXT NOT NULL,
  email TEXT,
  email_normalizado TEXT,
  red_social TEXT,
  foto_key TEXT,
  es_suplente INTEGER NOT NULL DEFAULT 0,
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_jugadores_nombre
  ON jugadores (nombre_completo_normalizado);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jugadores_telefono
  ON jugadores (telefono_normalizado);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jugadores_email
  ON jugadores (email_normalizado) WHERE email_normalizado IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jugadores_equipo ON jugadores (equipo_id);
