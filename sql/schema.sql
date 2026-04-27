CREATE TABLE IF NOT EXISTS callsign_allocations (
  id SERIAL PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  discord_username TEXT,
  department TEXT NOT NULL,
  unit_type TEXT NOT NULL,
  callsign TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE callsign_allocations
DROP CONSTRAINT IF EXISTS callsign_allocations_discord_user_id_key;

ALTER TABLE callsign_allocations
DROP CONSTRAINT IF EXISTS callsign_allocations_user_dept_unit_unique;

ALTER TABLE callsign_allocations
ADD CONSTRAINT callsign_allocations_user_dept_unit_unique
UNIQUE (discord_user_id, department, unit_type);

CREATE INDEX IF NOT EXISTS idx_callsign_allocations_user ON callsign_allocations(discord_user_id);
CREATE INDEX IF NOT EXISTS idx_callsign_allocations_dept_unit ON callsign_allocations(department, unit_type);
