CREATE TABLE IF NOT EXISTS callsign_allocations (
  id SERIAL PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  discord_username TEXT,
  department TEXT NOT NULL,
  unit_type TEXT NOT NULL,
  callsign TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (discord_user_id, department, unit_type)
);

CREATE INDEX IF NOT EXISTS idx_callsign_allocations_user ON callsign_allocations(discord_user_id);
CREATE INDEX IF NOT EXISTS idx_callsign_allocations_department ON callsign_allocations(department);
