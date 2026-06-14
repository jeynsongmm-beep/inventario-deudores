const express = require('express');
const { Pool } = require('pg');
const serverless = require('serverless-http');

const app = express();
const url = process.env.DATABASE_URL || process.env.DATABASE_URL_POSTGRES_URL || process.env.POSTGRES_URL;
const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
async function query(text, params) { return (await pool.query(text, params)).rows; }

async function initDB() {
  await query('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL)');
  await query('CREATE TABLE IF NOT EXISTS inventory (id TEXT PRIMARY KEY, name TEXT NOT NULL, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, createdAt TEXT)');
  await query('CREATE TABLE IF NOT EXISTS debtors (id TEXT PRIMARY KEY, name TEXT NOT NULL, amount REAL DEFAULT 0, description TEXT DEFAULT \'\', products TEXT DEFAULT \'[]\', dueDate TEXT, payments TEXT DEFAULT \'[]\', createdAt TEXT)');
  const rows = await query('SELECT * FROM users WHERE username = $1', ['admin']);
  if (rows.length === 0) {
    const bcrypt = require('bcryptjs');
    await query('INSERT INTO users (id, username, password) VALUES ($1, $2, $3)', ['1', 'admin', bcrypt.hashSync('admin', 10)]);
  }
  console.log('DB initialized');
}

const dbInit = initDB().catch(e => console.error('DB init error:', e));

app.use(express.json());
app.use(require('cookie-session')({
  name: 'session',
  keys: ['test123'],
  maxAge: 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: 'lax'
}));

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ authenticated: false });
  res.json({ authenticated: true, username: req.session.username });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const rows = await query('SELECT * FROM users WHERE username = $1', [username]);
  const user = rows[0];
  if (!user || !require('bcryptjs').compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ success: true, username: user.username });
});

app.get('/api/inventory', async (req, res) => {
  const rows = await query('SELECT * FROM inventory ORDER BY LOWER(name)');
  res.json(rows);
});

app.get('/api/test', async (req, res) => {
  await dbInit;
  res.json({ ok: true, url: url ? url.substring(0, 20) + '...' : 'NONE' });
});

module.exports = serverless(app);
