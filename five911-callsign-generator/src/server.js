require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const { pool } = require('./db');
const { startBot } = require('./bot');
const { listAllCallsigns, friendlyDepartment, friendlyUnit } = require('./callsigns');

const app = express();
const PORT = process.env.PORT || 10000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('combined'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, '..', 'public')));

function dashboardAuth(req, res, next) {
  const key = process.env.DASHBOARD_KEY;
  if (!key || key === 'change-me') return next();
  if (req.query.key === key || req.headers['x-dashboard-key'] === key) return next();
  return res.status(401).send('Dashboard key required. Add ?key=YOUR_KEY to the URL.');
}

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: true });
  } catch (err) {
    res.status(500).json({ ok: false, db: false, error: err.message });
  }
});

app.get('/', dashboardAuth, async (req, res) => {
  const rows = await listAllCallsigns();
  const stats = rows.reduce((acc, row) => {
    const dept = friendlyDepartment(row.department);
    acc[dept] = (acc[dept] || 0) + 1;
    return acc;
  }, {});
  res.render('dashboard', { rows, stats, friendlyDepartment, friendlyUnit, dashboardKey: req.query.key || '' });
});

app.get('/api/callsigns', dashboardAuth, async (req, res) => {
  const rows = await listAllCallsigns();
  res.json(rows);
});

app.listen(PORT, async () => {
  console.log(`Five911 Callsign Generator running on port ${PORT}`);
  startBot().catch((err) => console.error('Bot failed to start:', err));
});
