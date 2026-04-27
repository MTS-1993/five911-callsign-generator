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
    await addUnitType({ departmentCode: req.body.department_code, code: req.body.code, label: req.body.label, prefix: req.body.prefix, digits: req.body.digits, enabled: isChecked(req.body.enabled), sortOrder: req.body.sort_order });
    res.redirect('/?success=Unit type added.');
  } catch (err) { console.error(err); res.redirect(`/?error=${encodeURIComponent(err.message)}`); }
});

app.post('/admin/unit-types/:id/edit', requireAdmin, async (req, res) => {
  try {
    const updated = await updateUnitType(req.params.id, { departmentCode: req.body.department_code, code: req.body.code, label: req.body.label, prefix: req.body.prefix, digits: req.body.digits, enabled: isChecked(req.body.enabled), sortOrder: req.body.sort_order });
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
  startBot().catch((err) => console.error('Bot failed to start:', err));
});
