-- Migration number: 0003   auth usuarios
-- Login con Google y propiedad de equipos.

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  nombre TEXT,
  foto_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE equipos ADD COLUMN owner_user_id INTEGER REFERENCES usuarios(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_equipos_owner_user_id
  ON equipos (owner_user_id)
  WHERE owner_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios (email);
