const express = require('express');
const { Pool } = require('pg');
const cookieSession = require('cookie-session');
const serverless = require('serverless-http');

const app = express();

app.use(express.json());
app.use(cookieSession({
  name: 'session',
  keys: ['test123'],
  maxAge: 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: 'lax'
}));

const url = process.env.DATABASE_URL || process.env.DATABASE_URL_POSTGRES_URL || process.env.POSTGRES_URL;
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });

async function q(text, params) { return (await pool.query(text, params)).rows; }

app.get('/api/ping', (req, res) => res.json({ ok: true }));
app.get('/api/db', async (req, res) => {
  try {
    const r = await q('SELECT 1 as t');
    res.json({ ok: true, result: r });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});
app.post('/api/login', async (req, res) => {
  const rows = await q('SELECT * FROM users WHERE username = $1', [req.body.username]);
  const user = rows[0];
  if (!user || !require('bcryptjs').compareSync(req.body.password, user.password)) {
    return res.status(401).json({ error: 'bad login' });
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ success: true });
});
app.get('/api/me', (req, res) => {
  res.json({ authenticated: !!req.session.userId, user: req.session.username });
});

module.exports = serverless(app);
