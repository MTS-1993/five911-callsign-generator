const { pool } = require('./db');

const DEFAULT_CONFIG = {
  CPD: { label: 'Chicago Police Department', unitTypes: { patrol: { label: 'Beat / Unit Number', prefix: '07', digits: 3 } } },
  ISP: { label: 'Illinois State Trooper', unitTypes: { district17: { label: 'District 17', prefix: '17', digits: 3 }, district20: { label: 'District 20', prefix: '20', digits: 3 } } },
  CSD: { label: 'Chicago Sheriffs Department', unitTypes: { patrol: { label: 'Standard Patrol', prefix: 'G', digits: 3 }, detectives: { label: 'Detectives', prefix: 'H', digits: 3 }, tactical: { label: 'Tactical Units', prefix: 'TAC', digits: 3 }, k9: { label: 'K9 Units', prefix: 'K9', digits: 3 }, air: { label: 'AIR', prefix: '', digits: 3 }, sergeant: { label: 'Sergeants', prefix: 'D', digits: 3 }, lieutenant: { label: 'Lieutenant', prefix: 'L', digits: 3 }, command: { label: 'Higher Command', prefix: 'K', digits: 3 } } },
  IGW: { label: 'Illinois Game Wardens', unitTypes: { warden: { label: 'Game Warden', prefix: 'WARDEN', digits: 3 } } },
};

let configCache = null;
let configCacheAt = 0;

function normaliseCode(value) {
  return String(value || '').trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '').toUpperCase();
}

function normaliseUnitCode(value) {
  return String(value || '').trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '').toLowerCase();
}

async function getConfig({ includeDisabled = false, force = false } = {}) {
  if (!force && configCache && Date.now() - configCacheAt < 5000 && !includeDisabled) return configCache;

  const deptResult = await pool.query(
    `SELECT * FROM callsign_departments ${includeDisabled ? '' : 'WHERE enabled = TRUE'} ORDER BY sort_order, label`
  );
  const unitResult = await pool.query(
    `SELECT * FROM callsign_unit_types ${includeDisabled ? '' : 'WHERE enabled = TRUE'} ORDER BY sort_order, label`
  );

  const config = {};
  for (const dept of deptResult.rows) {
    config[dept.code] = { label: dept.label, enabled: dept.enabled, sort_order: dept.sort_order, unitTypes: {} };
  }
  for (const unit of unitResult.rows) {
    if (!config[unit.department_code]) continue;
    config[unit.department_code].unitTypes[unit.code] = {
      id: unit.id,
      label: unit.label,
      prefix: unit.prefix || '',
      digits: Number(unit.digits || 3),
      enabled: unit.enabled,
      sort_order: unit.sort_order,
    };
  }

  if (!includeDisabled) {
    configCache = config;
    configCacheAt = Date.now();
  }
  return config;
}

function invalidateConfig() {
  configCache = null;
  configCacheAt = 0;
}

async function getDepartmentChoices() {
  const config = await getConfig();
  return Object.entries(config).map(([value, cfg]) => ({ name: cfg.label, value }));
}

async function getUnitChoices(department) {
  const config = await getConfig();
  const cfg = config[department];
  if (!cfg) return [];
  return Object.entries(cfg.unitTypes).map(([value, unit]) => ({ name: unit.label, value }));
}

function formatCallsign(prefix, number, digits) {
  return `${prefix}${String(number).padStart(digits, '0')}`;
}

async function validateDepartmentUnit(department, unitType) {
  const config = await getConfig();
  if (!config[department]) throw new Error('Unknown or disabled department.');
  if (!config[department].unitTypes[unitType]) throw new Error('Unknown or disabled unit type for that department.');
  return config[department].unitTypes[unitType];
}

async function generateUniqueCallsign(department, unitType) {
  const unit = await validateDepartmentUnit(department, unitType);
  const max = Math.pow(10, unit.digits) - 1;
  const min = 1;

  const existing = await pool.query('SELECT callsign FROM callsign_allocations WHERE department = $1 AND unit_type = $2', [department, unitType]);
  const used = new Set(existing.rows.map((r) => r.callsign));
  if (used.size >= max) throw new Error('No callsigns available for that department/unit type.');

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
  await validateDepartmentUnit(department, unitType);
  const existing = await pool.query(
    `SELECT * FROM callsign_allocations WHERE discord_user_id = $1 AND department = $2 AND unit_type = $3`,
    [discordUserId, department, unitType]
  );
  if (existing.rows[0]) return { allocation: existing.rows[0], created: false };

  for (let i = 0; i < 5; i++) {
    const callsign = await generateUniqueCallsign(department, unitType);
    try {
      const inserted = await pool.query(
        `INSERT INTO callsign_allocations (discord_user_id, discord_username, department, unit_type, callsign) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
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
  const result = await pool.query('SELECT * FROM callsign_allocations WHERE discord_user_id = $1 ORDER BY created_at DESC', [discordUserId]);
  return result.rows;
}

async function listAllCallsigns() {
  const result = await pool.query('SELECT * FROM callsign_allocations ORDER BY department, unit_type, callsign');
  return result.rows;
}

async function addAllocation({ discordUserId, discordUsername, department, unitType, callsign }) {
  await validateDepartmentUnit(department, unitType);
  const cleanCallsign = String(callsign || '').trim().toUpperCase();
  if (!discordUserId || !cleanCallsign) throw new Error('Discord User ID and callsign are required.');
  const result = await pool.query(
    `INSERT INTO callsign_allocations (discord_user_id, discord_username, department, unit_type, callsign) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [String(discordUserId).trim(), String(discordUsername || '').trim(), department, unitType, cleanCallsign]
  );
  return result.rows[0];
}

async function updateAllocation(id, { discordUserId, discordUsername, department, unitType, callsign }) {
  await validateDepartmentUnit(department, unitType);
  const cleanCallsign = String(callsign || '').trim().toUpperCase();
  if (!id || !discordUserId || !cleanCallsign) throw new Error('ID, Discord User ID and callsign are required.');
  const result = await pool.query(
    `UPDATE callsign_allocations SET discord_user_id = $1, discord_username = $2, department = $3, unit_type = $4, callsign = $5 WHERE id = $6 RETURNING *`,
    [String(discordUserId).trim(), String(discordUsername || '').trim(), department, unitType, cleanCallsign, id]
  );
  return result.rows[0];
}

async function deleteAllocation(id) {
  const result = await pool.query('DELETE FROM callsign_allocations WHERE id = $1 RETURNING *', [id]);
  return result.rows[0];
}

async function listDepartments({ includeDisabled = true } = {}) {
  const result = await pool.query(`SELECT * FROM callsign_departments ${includeDisabled ? '' : 'WHERE enabled = TRUE'} ORDER BY sort_order, label`);
  return result.rows;
}

async function addDepartment({ code, label, enabled = true, sortOrder = 0 }) {
  const cleanCode = normaliseCode(code);
  if (!cleanCode || !label) throw new Error('Department code and label are required.');
  const result = await pool.query(
    `INSERT INTO callsign_departments (code, label, enabled, sort_order) VALUES ($1, $2, $3, $4) RETURNING *`,
    [cleanCode, String(label).trim(), Boolean(enabled), Number(sortOrder || 0)]
  );
  invalidateConfig();
  return result.rows[0];
}

async function updateDepartment(code, { label, enabled = false, sortOrder = 0 }) {
  const cleanCode = normaliseCode(code);
  const result = await pool.query(
    `UPDATE callsign_departments SET label = $1, enabled = $2, sort_order = $3 WHERE code = $4 RETURNING *`,
    [String(label || '').trim(), Boolean(enabled), Number(sortOrder || 0), cleanCode]
  );
  invalidateConfig();
  return result.rows[0];
}

async function deleteDepartment(code) {
  const result = await pool.query('DELETE FROM callsign_departments WHERE code = $1 RETURNING *', [normaliseCode(code)]);
  invalidateConfig();
  return result.rows[0];
}

async function listUnitTypes({ includeDisabled = true } = {}) {
  const result = await pool.query(
    `SELECT u.*, d.label AS department_label FROM callsign_unit_types u LEFT JOIN callsign_departments d ON d.code = u.department_code ${includeDisabled ? '' : 'WHERE u.enabled = TRUE'} ORDER BY d.sort_order, d.label, u.sort_order, u.label`
  );
  return result.rows;
}

async function addUnitType({ departmentCode, code, label, prefix = '', digits = 3, enabled = true, sortOrder = 0 }) {
  const dept = normaliseCode(departmentCode);
  const cleanCode = normaliseUnitCode(code);
  if (!dept || !cleanCode || !label) throw new Error('Department, unit type code and label are required.');
  const result = await pool.query(
    `INSERT INTO callsign_unit_types (department_code, code, label, prefix, digits, enabled, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [dept, cleanCode, String(label).trim(), String(prefix || '').trim().toUpperCase(), Number(digits || 3), Boolean(enabled), Number(sortOrder || 0)]
  );
  invalidateConfig();
  return result.rows[0];
}

async function updateUnitType(id, { departmentCode, code, label, prefix = '', digits = 3, enabled = false, sortOrder = 0 }) {
  const result = await pool.query(
    `UPDATE callsign_unit_types SET department_code = $1, code = $2, label = $3, prefix = $4, digits = $5, enabled = $6, sort_order = $7 WHERE id = $8 RETURNING *`,
    [normaliseCode(departmentCode), normaliseUnitCode(code), String(label || '').trim(), String(prefix || '').trim().toUpperCase(), Number(digits || 3), Boolean(enabled), Number(sortOrder || 0), id]
  );
  invalidateConfig();
  return result.rows[0];
}

async function deleteUnitType(id) {
  const result = await pool.query('DELETE FROM callsign_unit_types WHERE id = $1 RETURNING *', [id]);
  invalidateConfig();
  return result.rows[0];
}

async function friendlyDepartment(code) {
  const config = await getConfig({ includeDisabled: true });
  return config[code]?.label || code;
}

async function friendlyUnit(department, unitType) {
  const config = await getConfig({ includeDisabled: true });
  return config[department]?.unitTypes?.[unitType]?.label || unitType;
}

function friendlyDepartmentFromConfig(config, code) {
  return config[code]?.label || code;
}

function friendlyUnitFromConfig(config, department, unitType) {
  return config[department]?.unitTypes?.[unitType]?.label || unitType;
}

module.exports = {
  DEFAULT_CONFIG,
  getConfig,
  getDepartmentChoices,
  getUnitChoices,
  allocateCallsign,
  getUserCallsigns,
  listAllCallsigns,
  addAllocation,
  updateAllocation,
  deleteAllocation,
  listDepartments,
  addDepartment,
  updateDepartment,
  deleteDepartment,
  listUnitTypes,
  addUnitType,
  updateUnitType,
  deleteUnitType,
  friendlyDepartment,
  friendlyUnit,
  friendlyDepartmentFromConfig,
  friendlyUnitFromConfig,
};
