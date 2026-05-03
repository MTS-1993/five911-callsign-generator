require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const { pool } = require('./db');
const { startBot } = require('./bot');
const {
  getConfig,
  listAllCallsigns,
  getCallsignForDepartment,
  getCallsignForJob,
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
  friendlyDepartmentFromConfig,
  friendlyUnitFromConfig,
} = require('./callsigns');

const app = express();
const PORT = process.env.PORT || 10000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('combined'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, '..', 'public')));

app.use(session({
  name: 'five911_callsign_admin',
  secret: process.env.SESSION_SECRET || 'change-this-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 1000 * 60 * 60 * 8 },
}));

function adminUser() { return process.env.ADMIN_USERNAME || 'admin'; }
function adminPass() { return process.env.ADMIN_PASSWORD || ''; }
function requireAdmin(req, res, next) { if (req.session?.isAdmin) return next(); return res.redirect('/login'); }
function isConfigured() { return Boolean(adminPass()); }
function isChecked(value) { return value === 'on' || value === 'true' || value === true; }

let discordClient = null;

function apiKeyOk(req) {
  const expected = process.env.FIVEM_API_KEY;
  if (!expected) return false;
  return req.get('x-api-key') === expected || req.query.api_key === expected;
}

function departmentForJob(jobName) {
  // Uses the departments/subdivisions already configured in /generatecallsign.
  // No manual JOB_DEPARTMENT_MAP is required.
  return String(jobName || '').trim();
}

function stripExistingFive911Prefix(name) {
  return String(name || '').replace(/^\s*\[[A-Za-z0-9-]+\]\s*/g, '').trim();
}

function nicknameFormat() {
  return process.env.NICKNAME_FORMAT || '[{callsign}] {name}';
}

function makeNickname({ callsign, baseName }) {
  const base = stripExistingFive911Prefix(baseName || 'Five911 Member') || 'Five911 Member';
  const nick = nicknameFormat()
    .replaceAll('{callsign}', callsign)
    .replaceAll('{name}', base)
    .trim();
  return nick.length > 32 ? nick.slice(0, 32) : nick;
}

async function ensureNicknameState({ guildId, member }) {
  const existing = await pool.query(
    `SELECT * FROM discord_nickname_states WHERE guild_id = $1 AND discord_user_id = $2`,
    [guildId, member.id]
  );

  const currentDisplayName = member.nickname || member.user.globalName || member.user.username;

  if (existing.rows[0]) {
    const state = existing.rows[0];

    // If the player is not currently on duty, refresh the stored original name before
    // applying a callsign. This prevents an old Discord name being restored later.
    if (!state.active) {
      const updated = await pool.query(
        `UPDATE discord_nickname_states
         SET original_nickname = $3,
             original_display_name = $4,
             active = TRUE,
             updated_at = CURRENT_TIMESTAMP
         WHERE guild_id = $1 AND discord_user_id = $2
         RETURNING *`,
        [guildId, member.id, member.nickname || null, currentDisplayName]
      );
      return updated.rows[0];
    }

    return state;
  }

  const inserted = await pool.query(
    `INSERT INTO discord_nickname_states
      (guild_id, discord_user_id, original_nickname, original_display_name, active)
     VALUES ($1, $2, $3, $4, TRUE)
     RETURNING *`,
    [guildId, member.id, member.nickname || null, currentDisplayName]
  );
  return inserted.rows[0];
}

async function markNicknameStateActive({ guildId, discordUserId, callsign, nickname }) {
  await pool.query(
    `UPDATE discord_nickname_states
     SET active = TRUE, current_callsign = $3, current_nickname = $4, updated_at = CURRENT_TIMESTAMP
     WHERE guild_id = $1 AND discord_user_id = $2`,
    [guildId, discordUserId, callsign, nickname]
  );
}

async function getNicknameState({ guildId, discordUserId }) {
  const result = await pool.query(
    `SELECT * FROM discord_nickname_states WHERE guild_id = $1 AND discord_user_id = $2`,
    [guildId, discordUserId]
  );
  return result.rows[0] || null;
}

async function clearNicknameState({ guildId, discordUserId }) {
  await pool.query(
    `UPDATE discord_nickname_states
     SET active = FALSE, current_callsign = NULL, current_nickname = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE guild_id = $1 AND discord_user_id = $2`,
    [guildId, discordUserId]
  );
}

async function updateDiscordNickname({ discordUserId, jobName, onDuty }) {
  if (!discordClient) throw new Error('Discord bot is not ready yet.');
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) throw new Error('DISCORD_GUILD_ID is not configured.');
  const guild = await discordClient.guilds.fetch(guildId);
  const member = await guild.members.fetch(discordUserId);

  if (!onDuty) {
    const state = await getNicknameState({ guildId, discordUserId });

    if (state && state.active) {
      const restoreTo = state.original_nickname || null;
      if ((member.nickname || null) !== restoreTo) {
        await member.setNickname(restoreTo, 'Five911 QB-Core duty ended - restoring original nickname');
      }
      await clearNicknameState({ guildId, discordUserId });
      return {
        changed: true,
        nickname: restoreTo || member.user.globalName || member.user.username,
        restored: true,
        reason: 'off_duty_restored'
      };
    }

    // Safety fallback for older installs before nickname state existed.
    const clean = stripExistingFive911Prefix(member.nickname || member.user.globalName || member.user.username);
    if (member.nickname && clean && member.nickname !== clean) {
      await member.setNickname(clean, 'Five911 QB-Core duty ended - fallback cleanup');
      return { changed: true, nickname: clean, restored: false, reason: 'off_duty_fallback_cleanup' };
    }
    return { changed: false, restored: false, reason: 'off_duty_no_active_state' };
  }

  const jobLookup = departmentForJob(jobName);
  if (!jobLookup) return { changed: false, reason: 'unknown_job' };

  const allocation = await getCallsignForJob(discordUserId, jobLookup);
  if (!allocation) {
    return {
      changed: false,
      reason: 'no_callsign_for_job_department_or_subdivision',
      jobName: jobLookup
    };
  }
  const department = allocation.department;

  const state = await ensureNicknameState({ guildId, member });
  const baseName = state.original_nickname || state.original_display_name || member.user.globalName || member.user.username;
  const nickname = makeNickname({ callsign: allocation.callsign, baseName });

  if (member.nickname !== nickname) {
    await member.setNickname(nickname, 'Five911 QB-Core duty as ' + jobName);
    await markNicknameStateActive({ guildId, discordUserId, callsign: allocation.callsign, nickname });
    return { changed: true, nickname, department, callsign: allocation.callsign, restored: false };
  }

  await markNicknameStateActive({ guildId, discordUserId, callsign: allocation.callsign, nickname });
  return { changed: false, reason: 'already_set', nickname, department, callsign: allocation.callsign, restored: false };
}

function buildStats(rows, config) {
  return rows.reduce((acc, row) => {
    const dept = friendlyDepartmentFromConfig(config, row.department);
    acc[dept] = (acc[dept] || 0) + 1;
    return acc;
  }, {});
}

app.get('/login', (req, res) => {
  if (req.session?.isAdmin) return res.redirect('/');
  res.render('login', { error: req.query.error || '', configured: isConfigured() });
});

app.post('/login', (req, res) => {
  if (!isConfigured()) return res.redirect('/login?error=ADMIN_PASSWORD is not configured in Render.');
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (username === adminUser() && password === adminPass()) {
    req.session.isAdmin = true;
    req.session.adminUsername = username;
    return res.redirect('/');
  }
  return res.redirect('/login?error=Invalid username or password.');
});

app.post('/logout', requireAdmin, (req, res) => req.session.destroy(() => res.redirect('/login')));

app.get('/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, db: true }); }
  catch (err) { res.status(500).json({ ok: false, db: false, error: err.message }); }
});

app.post('/api/fivem/duty', async (req, res) => {
  try {
    if (!apiKeyOk(req)) return res.status(401).json({ ok: false, error: 'Invalid or missing API key.' });
    const discordUserId = String(req.body.discordUserId || req.body.discord_user_id || '').replace(/\D/g, '');
    const jobName = String(req.body.jobName || req.body.job_name || '').trim();
    const onDuty = req.body.onDuty === true || req.body.on_duty === true || req.body.onDuty === 'true' || req.body.on_duty === 'true' || req.body.onDuty === 1 || req.body.on_duty === 1;
    if (!discordUserId) return res.status(400).json({ ok: false, error: 'discordUserId is required.' });
    const result = await updateDiscordNickname({ discordUserId, jobName, onDuty });
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('FiveM duty nickname sync failed:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/', requireAdmin, async (req, res) => {
  const [rows, config, departments, unitTypes] = await Promise.all([
    listAllCallsigns(),
    getConfig({ includeDisabled: true, force: true }),
    listDepartments({ includeDisabled: true }),
    listUnitTypes({ includeDisabled: true }),
  ]);
  res.render('dashboard', {
    rows,
    stats: buildStats(rows, config),
    config,
    departments,
    unitTypes,
    friendlyDepartment: (code) => friendlyDepartmentFromConfig(config, code),
    friendlyUnit: (department, unitType) => friendlyUnitFromConfig(config, department, unitType),
    adminUsername: req.session.adminUsername,
    success: req.query.success || '',
    error: req.query.error || '',
  });
});

app.post('/admin/callsigns', requireAdmin, async (req, res) => {
  try {
    await addAllocation({ discordUserId: req.body.discord_user_id, discordUsername: req.body.discord_username, department: req.body.department, unitType: req.body.unit_type, callsign: req.body.callsign });
    res.redirect('/?success=Callsign added.');
  } catch (err) { console.error(err); res.redirect(`/?error=${encodeURIComponent(err.message)}`); }
});

app.post('/admin/callsigns/:id/edit', requireAdmin, async (req, res) => {
  try {
    const updated = await updateAllocation(req.params.id, { discordUserId: req.body.discord_user_id, discordUsername: req.body.discord_username, department: req.body.department, unitType: req.body.unit_type, callsign: req.body.callsign });
    if (!updated) throw new Error('Callsign allocation not found.');
    res.redirect('/?success=Callsign updated.');
  } catch (err) { console.error(err); res.redirect(`/?error=${encodeURIComponent(err.message)}`); }
});

app.post('/admin/callsigns/:id/delete', requireAdmin, async (req, res) => {
  try {
    const deleted = await deleteAllocation(req.params.id);
    if (!deleted) throw new Error('Callsign allocation not found.');
    res.redirect('/?success=Callsign deleted.');
  } catch (err) { console.error(err); res.redirect(`/?error=${encodeURIComponent(err.message)}`); }
});

app.post('/admin/departments', requireAdmin, async (req, res) => {
  try {
    await addDepartment({ code: req.body.code, label: req.body.label, enabled: isChecked(req.body.enabled), sortOrder: req.body.sort_order, requiredRoleIds: req.body.required_role_ids });
    res.redirect('/?success=Department added.');
  } catch (err) { console.error(err); res.redirect(`/?error=${encodeURIComponent(err.message)}`); }
});

app.post('/admin/departments/:code/edit', requireAdmin, async (req, res) => {
  try {
    const updated = await updateDepartment(req.params.code, { label: req.body.label, enabled: isChecked(req.body.enabled), sortOrder: req.body.sort_order, requiredRoleIds: req.body.required_role_ids });
    if (!updated) throw new Error('Department not found.');
    res.redirect('/?success=Department updated.');
  } catch (err) { console.error(err); res.redirect(`/?error=${encodeURIComponent(err.message)}`); }
});

app.post('/admin/departments/:code/delete', requireAdmin, async (req, res) => {
  try {
    const deleted = await deleteDepartment(req.params.code);
    if (!deleted) throw new Error('Department not found.');
    res.redirect('/?success=Department deleted. Unit types under it were also removed.');
  } catch (err) { console.error(err); res.redirect(`/?error=${encodeURIComponent(err.message)}`); }
});

app.post('/admin/unit-types', requireAdmin, async (req, res) => {
  try {
    await addUnitType({ departmentCode: req.body.department_code, code: req.body.code, label: req.body.label, prefix: req.body.prefix, digits: req.body.digits, enabled: isChecked(req.body.enabled), sortOrder: req.body.sort_order, requiredRoleIds: req.body.required_role_ids });
    res.redirect('/?success=Unit type added.');
  } catch (err) { console.error(err); res.redirect(`/?error=${encodeURIComponent(err.message)}`); }
});

app.post('/admin/unit-types/:id/edit', requireAdmin, async (req, res) => {
  try {
    const updated = await updateUnitType(req.params.id, { departmentCode: req.body.department_code, code: req.body.code, label: req.body.label, prefix: req.body.prefix, digits: req.body.digits, enabled: isChecked(req.body.enabled), sortOrder: req.body.sort_order, requiredRoleIds: req.body.required_role_ids });
    if (!updated) throw new Error('Unit type not found.');
    res.redirect('/?success=Unit type updated.');
  } catch (err) { console.error(err); res.redirect(`/?error=${encodeURIComponent(err.message)}`); }
});

app.post('/admin/unit-types/:id/delete', requireAdmin, async (req, res) => {
  try {
    const deleted = await deleteUnitType(req.params.id);
    if (!deleted) throw new Error('Unit type not found.');
    res.redirect('/?success=Unit type deleted.');
  } catch (err) { console.error(err); res.redirect(`/?error=${encodeURIComponent(err.message)}`); }
});

app.get('/api/callsigns', requireAdmin, async (req, res) => res.json(await listAllCallsigns()));
app.get('/api/departments', requireAdmin, async (req, res) => res.json(await listDepartments({ includeDisabled: true })));
app.get('/api/unit-types', requireAdmin, async (req, res) => res.json(await listUnitTypes({ includeDisabled: true })));

app.listen(PORT, async () => {
  console.log(`Five911 Callsign Generator running on port ${PORT}`);
  startBot().then((client) => { discordClient = client; }).catch((err) => console.error('Bot failed to start:', err));
});
