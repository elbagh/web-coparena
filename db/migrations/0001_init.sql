-- Migration number: 0001 	 init
-- Tablas para las dos acciones previstas de la web: apuntar equipo y reservar merch.

CREATE TABLE IF NOT EXISTS inscripciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reservas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  shirt_size TEXT,
  extras TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
