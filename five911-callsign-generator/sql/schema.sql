CREATE TABLE IF NOT EXISTS callsign_departments (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  required_role_ids TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS callsign_unit_types (
  id SERIAL PRIMARY KEY,
  department_code TEXT NOT NULL REFERENCES callsign_departments(code) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  prefix TEXT NOT NULL DEFAULT '',
  digits INTEGER NOT NULL DEFAULT 3 CHECK (digits BETWEEN 1 AND 8),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (department_code, code)
);

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
CREATE INDEX IF NOT EXISTS idx_callsign_unit_types_department ON callsign_unit_types(department_code);

ALTER TABLE callsign_departments ADD COLUMN IF NOT EXISTS required_role_ids TEXT NOT NULL DEFAULT '';


INSERT INTO callsign_departments (code, label, sort_order) VALUES
  ('CPD', 'Chicago Police Department', 10),
  ('ISP', 'Illinois State Trooper', 20),
  ('CSD', 'Chicago Sheriffs Department', 30),
  ('IGW', 'Illinois Game Wardens', 40)
ON CONFLICT (code) DO NOTHING;

INSERT INTO callsign_unit_types (department_code, code, label, prefix, digits, sort_order) VALUES
  ('CPD', 'patrol', 'Beat / Unit Number', '07', 3, 10),
  ('ISP', 'district17', 'District 17', '17', 3, 10),
  ('ISP', 'district20', 'District 20', '20', 3, 20),
  ('CSD', 'patrol', 'Standard Patrol', 'G', 3, 10),
  ('CSD', 'detectives', 'Detectives', 'H', 3, 20),
  ('CSD', 'tactical', 'Tactical Units', 'TAC', 3, 30),
  ('CSD', 'k9', 'K9 Units', 'K9', 3, 40),
  ('CSD', 'air', 'AIR', '', 3, 50),
  ('CSD', 'sergeant', 'Sergeants', 'D', 3, 60),
  ('CSD', 'lieutenant', 'Lieutenant', 'L', 3, 70),
  ('CSD', 'command', 'Higher Command', 'K', 3, 80),
  ('IGW', 'warden', 'Game Warden', 'WARDEN', 3, 10)
ON CONFLICT (department_code, code) DO NOTHING;
