-- Migration number: 0005   admin usuarios
-- Marca usuarios con acceso al panel privado de administración.

ALTER TABLE usuarios ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_usuarios_is_admin
  ON usuarios (is_admin);
