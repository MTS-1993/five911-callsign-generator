const { pool } = require('./db');

const CONFIG = {
  CPD: {
    label: 'Chicago Police Department',
    unitTypes: {
      patrol: { label: 'Beat / Unit Number', prefix: '07', digits: 3 },
    },
  },
  ISP: {
    label: 'Illinois State Trooper',
    unitTypes: {
      district17: { label: 'District 17', prefix: '17', digits: 3 },
      district20: { label: 'District 20', prefix: '20', digits: 3 },
    },
  },
  CSD: {
    label: 'Chicago Sheriffs Department',
    unitTypes: {
      patrol: { label: 'Standard Patrol', prefix: 'G', digits: 3 },
      detectives: { label: 'Detectives', prefix: 'H', digits: 3 },
      tactical: { label: 'Tactical Units', prefix: 'TAC', digits: 3 },
      k9: { label: 'K9 Units', prefix: 'K9', digits: 3 },
      air: { label: 'AIR', prefix: '', digits: 3 },
      sergeant: { label: 'Sergeants', prefix: 'D', digits: 3 },
      lieutenant: { label: 'Lieutenant', prefix: 'L', digits: 3 },
      command: { label: 'Higher Command', prefix: 'K', digits: 3 },
    },
  },
  IGW: {
    label: 'Illinois Game Wardens',
    unitTypes: {
      warden: { label: 'Game Warden', prefix: 'WARDEN', digits: 3 },
    },
  },
};

function getDepartmentChoices() {
  return Object.entries(CONFIG).map(([value, cfg]) => ({ name: cfg.label, value }));
}

function getUnitChoices(department) {
  const cfg = CONFIG[department];
  if (!cfg) return [];
  return Object.entries(cfg.unitTypes).map(([value, unit]) => ({ name: unit.label, value }));
}

function formatCallsign(prefix, number, digits) {
  return `${prefix}${String(number).padStart(digits, '0')}`;
}

async function generateUniqueCallsign(department, unitType) {
  const dept = CONFIG[department];
  if (!dept) throw new Error('Unknown department.');

  const unit = dept.unitTypes[unitType];
  if (!unit) throw new Error('Unknown unit type for that department.');

  const max = Math.pow(10, unit.digits) - 1;
  const min = 1;

  const existing = await pool.query(
    'SELECT callsign FROM callsign_allocations WHERE department = $1 AND unit_type = $2',
    [department, unitType]
  );
  const used = new Set(existing.rows.map((r) => r.callsign));

  if (used.size >= max) {
    throw new Error('No callsigns available for that department/unit type.');
  }

  for (let attempt = 0; attempt < 5000; attempt++) {
    const num = Math.floor(Math.random() * (max - min + 1)) + min;
    const callsign = formatCallsign(unit.prefix, num, unit.digits);
    if (!used.has(callsign)) return callsign;
  }

  for (let num = min; num <= max; num++) {
    const callsign = formatCallsign(unit.prefix, num, unit.digits);
    if (!used.has(callsign)) return callsign;
  }

  throw new Error('No callsigns available.');
}

async function allocateCallsign({ discordUserId, discordUsername, department, unitType }) {
  const existing = await pool.query(
    `SELECT * FROM callsign_allocations
     WHERE discord_user_id = $1 AND department = $2 AND unit_type = $3`,
    [discordUserId, department, unitType]
  );

  if (existing.rows[0]) {
    return { allocation: existing.rows[0], created: false };
  }

  for (let i = 0; i < 5; i++) {
    const callsign = await generateUniqueCallsign(department, unitType);
    try {
      const inserted = await pool.query(
        `INSERT INTO callsign_allocations
          (discord_user_id, discord_username, department, unit_type, callsign)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [discordUserId, discordUsername, department, unitType, callsign]
      );
      return { allocation: inserted.rows[0], created: true };
    } catch (err) {
      if (err.code !== '23505') throw err;
    }
  }

  throw new Error('Unable to allocate a unique callsign. Please try again.');
}

async function getUserCallsigns(discordUserId) {
  const result = await pool.query(
    'SELECT * FROM callsign_allocations WHERE discord_user_id = $1 ORDER BY created_at DESC',
    [discordUserId]
  );
  return result.rows;
}

async function listAllCallsigns() {
  const result = await pool.query(
    'SELECT * FROM callsign_allocations ORDER BY department, unit_type, callsign'
  );
  return result.rows;
}

async function deleteAllocation(id) {
  const result = await pool.query('DELETE FROM callsign_allocations WHERE id = $1 RETURNING *', [id]);
  return result.rows[0];
}

function friendlyDepartment(code) {
  return CONFIG[code]?.label || code;
}

function friendlyUnit(department, unitType) {
  return CONFIG[department]?.unitTypes?.[unitType]?.label || unitType;
}

module.exports = {
  CONFIG,
  getDepartmentChoices,
  getUnitChoices,
  allocateCallsign,
  getUserCallsigns,
  listAllCallsigns,
  deleteAllocation,
  friendlyDepartment,
  friendlyUnit,
};
