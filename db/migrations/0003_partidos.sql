-- Sorteo, horarios y marcador de partidos.

CREATE TABLE IF NOT EXISTS partidos (
  id TEXT PRIMARY KEY,
  ronda TEXT NOT NULL DEFAULT 'Sorteo',
  equipo_a_id INTEGER REFERENCES equipos(id) ON DELETE SET NULL,
  equipo_b_id INTEGER REFERENCES equipos(id) ON DELETE SET NULL,
  equipo_a_nombre TEXT NOT NULL,
  equipo_b_nombre TEXT NOT NULL,
  scheduled_at TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'finished')),
  points_a INTEGER NOT NULL DEFAULT 0,
  points_b INTEGER NOT NULL DEFAULT 0,
  sets_a INTEGER NOT NULL DEFAULT 0,
  sets_b INTEGER NOT NULL DEFAULT 0,
  set_number INTEGER NOT NULL DEFAULT 1,
  set_history TEXT NOT NULL DEFAULT '[]',
  started_at TEXT,
  elapsed_ms INTEGER NOT NULL DEFAULT 0,
  winner TEXT CHECK (winner IN ('A', 'B')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_partidos_schedule ON partidos (scheduled_at, sort_order);
