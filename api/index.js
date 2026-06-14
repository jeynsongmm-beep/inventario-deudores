const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const cookieSession = require('cookie-session');
const rateLimit = require('express-rate-limit');
const { neon } = require('@neondatabase/serverless');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieSession({ name: 'session', keys: [process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex')], maxAge: 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Demasiados intentos. Intenta de nuevo en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !!process.env.VERCEL
});

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(401).json({ error: 'No autenticado' });
    }
    return res.redirect('/login');
  }
  next();
}

function debtorRow(d) { return { ...d, products: JSON.parse(d.products || '[]'), payments: JSON.parse(d.payments || '[]') }; }

const dbUrl = process.env.DATABASE_URL_POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL_POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sql = dbUrl ? neon(dbUrl) : null;

async function q(text, params) {
  if (!sql) return [];
  return await sql.query(text, params || []);
}

async function initDB() {
  try {
    await q('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL)');
    await q('CREATE TABLE IF NOT EXISTS inventory (id TEXT PRIMARY KEY, name TEXT NOT NULL, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, createdAt TEXT)');
    await q('CREATE TABLE IF NOT EXISTS debtors (id TEXT PRIMARY KEY, name TEXT NOT NULL, amount REAL DEFAULT 0, description TEXT DEFAULT \'\', products TEXT DEFAULT \'[]\', dueDate TEXT, payments TEXT DEFAULT \'[]\', createdAt TEXT)');
    const pwd = process.env.ADMIN_PASSWORD || ('MC-' + crypto.randomBytes(4).toString('hex').toUpperCase());
    const rows = await q('SELECT * FROM users WHERE username = $1', ['admin']);
    if (rows.length === 0) {
      await q('INSERT INTO users (id, username, password) VALUES ($1, $2, $3)', [Date.now().toString(), 'admin', bcrypt.hashSync(pwd, 10)]);
    } else {
      const user = rows[0];
      if (bcrypt.compareSync('admin', user.password) || process.env.ADMIN_PASSWORD) {
        await q('UPDATE users SET password = $1 WHERE id = $2', [bcrypt.hashSync(pwd, 10), user.id]);
      }
    }
  } catch (e) { console.error('initDB error:', e.message); }
}

app.get('/api/keep-alive', async (req, res) => {
  try {
    await sql.query('SELECT 1');
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.get('/api/debug-env', (req, res) => {
  let host = 'NOT SET';
  if (dbUrl) {
    try { const u = new URL(dbUrl); host = u.host; } catch { host = 'INVALID'; }
  }
  res.json({ dbUrl: dbUrl ? 'SET' : 'NOT SET', dbHost: host, vercelEnv: process.env.VERCEL_ENV, vercelRegion: process.env.VERCEL_REGION });
});

app.get('/api/db-check', async (req, res) => {
  try {
    const result = await sql.query('SELECT 1 as ok');
    res.json({ connected: true, result });
  } catch (e) {
    res.json({ connected: false, error: e.message });
  }
});

app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

app.post('/api/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    const rows = await q('SELECT * FROM users WHERE username = $1', [username]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ success: true, username: user.username });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Error interno' });
  }
});

app.post('/api/logout', (req, res) => { req.session = null; res.json({ success: true }); });

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ authenticated: false });
  res.json({ authenticated: true, username: req.session.username });
});

app.use('/api', requireAuth);

app.get('/api/debtors', async (req, res) => {
  res.json((await q('SELECT * FROM debtors ORDER BY LOWER(name)')).map(debtorRow));
});

app.post('/api/debtors', async (req, res) => {
  try {
    const { name, amount, description, products, dueDate } = req.body;
    if (!name || amount == null) return res.status(400).json({ error: 'Nombre y monto requeridos' });
    if (products && products.length > 0) {
      for (const p of products) {
        const inv = await q('SELECT quantity FROM inventory WHERE id = $1', [p.id]);
        if (!inv[0] || inv[0].quantity < p.quantity) return res.status(400).json({ error: `Stock insuficiente para: ${p.name}` });
      }
      for (const p of products) await q('UPDATE inventory SET quantity = quantity - $1 WHERE id = $2', [p.quantity, p.id]);
    }
    const debtor = { id: Date.now().toString(), name, amount: parseFloat(amount), description: description || '', products: JSON.stringify(products || []), dueDate: dueDate || null, payments: '[]', createdAt: new Date().toISOString() };
    await q('INSERT INTO debtors (id,name,amount,description,products,dueDate,payments,createdAt) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [debtor.id, debtor.name, debtor.amount, debtor.description, debtor.products, debtor.dueDate, debtor.payments, debtor.createdAt]);
    res.status(201).json(debtorRow(debtor));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/debtors/:id', async (req, res) => {
  try {
    const { name, amount, description, products, dueDate } = req.body;
    const rows = await q('SELECT * FROM debtors WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Deudor no encontrado' });
    const old = rows[0];
    if (products != null) {
      for (const p of JSON.parse(old.products || '[]')) await q('UPDATE inventory SET quantity = quantity + $1 WHERE id = $2', [p.quantity, p.id]);
      for (const p of products) {
        const inv = await q('SELECT quantity FROM inventory WHERE id = $1', [p.id]);
        if (!inv[0] || inv[0].quantity < p.quantity) return res.status(400).json({ error: `Stock insuficiente para: ${p.name}` });
      }
      for (const p of products) await q('UPDATE inventory SET quantity = quantity - $1 WHERE id = $2', [p.quantity, p.id]);
    }
    if (name != null) await q('UPDATE debtors SET name = $1 WHERE id = $2', [name, req.params.id]);
    if (amount != null) await q('UPDATE debtors SET amount = $1 WHERE id = $2', [parseFloat(amount), req.params.id]);
    if (description != null) await q('UPDATE debtors SET description = $1 WHERE id = $2', [description, req.params.id]);
    if (products != null) await q('UPDATE debtors SET products = $1 WHERE id = $2', [JSON.stringify(products), req.params.id]);
    if (dueDate != null) await q('UPDATE debtors SET dueDate = $1 WHERE id = $2', [dueDate, req.params.id]);
    res.json(debtorRow((await q('SELECT * FROM debtors WHERE id = $1', [req.params.id]))[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/debtors/:id/pay', async (req, res) => {
  try {
    const { amount, note } = req.body;
    if (!amount) return res.status(400).json({ error: 'Monto requerido' });
    const rows = await q('SELECT * FROM debtors WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Deudor no encontrado' });
    const d = rows[0];
    const payments = JSON.parse(d.payments || '[]');
    payments.push({ amount: parseFloat(amount), date: new Date().toISOString(), note: note || '', registeredBy: req.session.username || 'unknown' });
    await q('UPDATE debtors SET payments = $1, amount = amount - $2 WHERE id = $3', [JSON.stringify(payments), parseFloat(amount), req.params.id]);
    const updated = await q('SELECT * FROM debtors WHERE id = $1', [req.params.id]);
    res.json(debtorRow(updated[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/debtors/:id/payments/:idx', async (req, res) => {
  try {
    const rows = await q('SELECT * FROM debtors WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Deudor no encontrado' });
    const d = rows[0];
    const payments = JSON.parse(d.payments || '[]');
    const idx = parseInt(req.params.idx);
    if (idx < 0 || idx >= payments.length) return res.status(400).json({ error: 'Abono no encontrado' });
    const removed = payments.splice(idx, 1)[0];
    await q('UPDATE debtors SET payments = $1, amount = amount + $2 WHERE id = $3', [JSON.stringify(payments), removed.amount, req.params.id]);
    const updated = await q('SELECT * FROM debtors WHERE id = $1', [req.params.id]);
    res.json(debtorRow(updated[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/debtors/:id/payments/:idx', async (req, res) => {
  try {
    const { amount, note } = req.body;
    const rows = await q('SELECT * FROM debtors WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Deudor no encontrado' });
    const d = rows[0];
    const payments = JSON.parse(d.payments || '[]');
    const idx = parseInt(req.params.idx);
    if (idx < 0 || idx >= payments.length) return res.status(400).json({ error: 'Abono no encontrado' });
    const diff = parseFloat(amount) - payments[idx].amount;
    payments[idx].amount = parseFloat(amount);
    if (note !== undefined) payments[idx].note = note;
    await q('UPDATE debtors SET payments = $1, amount = amount - $2 WHERE id = $3', [JSON.stringify(payments), diff, req.params.id]);
    const updated = await q('SELECT * FROM debtors WHERE id = $1', [req.params.id]);
    res.json(debtorRow(updated[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/debtors/:id', async (req, res) => {
  try {
    const rows = await q('SELECT * FROM debtors WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Deudor no encontrado' });
    for (const p of JSON.parse(rows[0].products || '[]')) await q('UPDATE inventory SET quantity = quantity + $1 WHERE id = $2', [p.quantity, p.id]);
    await q('DELETE FROM debtors WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/inventory', async (req, res) => {
  try {
    const rows = await q('SELECT * FROM inventory ORDER BY LOWER(name)');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/inventory', async (req, res) => {
  try {
    const { name, quantity, price } = req.body;
    if (!name) return res.status(400).json({ error: 'Nombre requerido' });
    const qty = parseInt(quantity) || 0;
    if (qty < 0) return res.status(400).json({ error: 'La cantidad no puede ser negativa' });
    const item = { id: Date.now().toString(), name, quantity: qty, price: parseFloat(price) || 0, createdAt: new Date().toISOString() };
    await q('INSERT INTO inventory (id, name, quantity, price, createdAt) VALUES ($1,$2,$3,$4,$5)', [item.id, item.name, item.quantity, item.price, item.createdAt]);
    res.status(201).json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/inventory/:id', async (req, res) => {
  try {
    const { name, quantity, price } = req.body;
    const inv = await q('SELECT * FROM inventory WHERE id = $1', [req.params.id]);
    if (!inv[0]) return res.status(404).json({ error: 'Item no encontrado' });
    if (quantity != null) { const qty = parseInt(quantity); if (qty < 0) return res.status(400).json({ error: 'La cantidad no puede ser negativa' }); await q('UPDATE inventory SET quantity = $1 WHERE id = $2', [qty, req.params.id]); }
    if (name != null) await q('UPDATE inventory SET name = $1 WHERE id = $2', [name, req.params.id]);
    if (price != null) await q('UPDATE inventory SET price = $1 WHERE id = $2', [parseFloat(price), req.params.id]);
    res.json((await q('SELECT * FROM inventory WHERE id = $1', [req.params.id]))[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/inventory/:id', async (req, res) => { await q('DELETE FROM inventory WHERE id = $1', [req.params.id]); res.json({ success: true }); });

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

const initPromise = initDB();

module.exports = (req, res) => {
  app(req, res);
};
