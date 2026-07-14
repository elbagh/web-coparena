-- Migration number: 0004   camisetas reservas
-- Reservas de camisetas ligadas a la cuenta de Google.

CREATE TABLE IF NOT EXISTS camisetas_reservas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  talla TEXT NOT NULL,
  cantidad INTEGER NOT NULL DEFAULT 1,
  notas TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (cantidad >= 1 AND cantidad <= 10)
);

CREATE INDEX IF NOT EXISTS idx_camisetas_owner_user_id
  ON camisetas_reservas (owner_user_id, created_at DESC);
