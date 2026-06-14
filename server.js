const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const cookieSession = require('cookie-session');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || process.env.DATABASE_URL_POSTGRES_URL || process.env.POSTGRES_URL;

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function query(text, params) {
  return (await pool.query(text, params)).rows;
}
let adminPassword = null;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex')],
  maxAge: 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: 'lax'
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Demasiados intentos. Intenta de nuevo en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false
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

async function initDB() {
  await query('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL)');
  await query('CREATE TABLE IF NOT EXISTS inventory (id TEXT PRIMARY KEY, name TEXT NOT NULL, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, createdAt TEXT)');
  await query('CREATE TABLE IF NOT EXISTS debtors (id TEXT PRIMARY KEY, name TEXT NOT NULL, amount REAL DEFAULT 0, description TEXT DEFAULT \'\', products TEXT DEFAULT \'[]\', dueDate TEXT, payments TEXT DEFAULT \'[]\', createdAt TEXT)');

  const rows = await query('SELECT * FROM users WHERE username = $1', ['admin']);
  if (rows.length === 0) {
    adminPassword = 'MC-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    await query('INSERT INTO users (id, username, password) VALUES ($1, $2, $3)', [Date.now().toString(), 'admin', bcrypt.hashSync(adminPassword, 10)]);
  } else {
    const user = rows[0];
    if (bcrypt.compareSync('admin', user.password)) {
      adminPassword = 'MC-' + crypto.randomBytes(4).toString('hex').toUpperCase();
      await query('UPDATE users SET password = $1 WHERE id = $2', [bcrypt.hashSync(adminPassword, 10), user.id]);
    }
  }
}

function debtorRow(d) {
  return { ...d, products: JSON.parse(d.products || '[]'), payments: JSON.parse(d.payments || '[]') };
}

app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  const rows = await query('SELECT * FROM users WHERE username = $1', [username]);
  const user = rows[0];
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ success: true, username: user.username });
});

app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ authenticated: false });
  res.json({ authenticated: true, username: req.session.username });
});

app.use('/api', requireAuth);

app.get('/api/debtors', async (req, res) => {
  const rows = await query('SELECT * FROM debtors ORDER BY LOWER(name)');
  res.json(rows.map(debtorRow));
});

app.post('/api/debtors', async (req, res) => {
  const { name, amount, description, products, dueDate } = req.body;
  if (!name || amount == null) return res.status(400).json({ error: 'Nombre y monto requeridos' });
  if (products && products.length > 0) {
    for (const p of products) {
      const inv = await query('SELECT * FROM inventory WHERE id = $1', [p.id]);
      const item = inv[0];
      if (!item) return res.status(400).json({ error: `Producto "${p.name || p.id}" no encontrado en inventario` });
      if (item.quantity < p.quantity) return res.status(400).json({ error: `Stock insuficiente para "${item.name}": disponible ${item.quantity}, requerido ${p.quantity}` });
    }
    for (const p of products) {
      await query('UPDATE inventory SET quantity = quantity - $1 WHERE id = $2', [p.quantity, p.id]);
    }
  }
  const debtor = {
    id: Date.now().toString(),
    name,
    amount: parseFloat(amount),
    description: description || '',
    products: JSON.stringify(products || []),
    dueDate: dueDate || null,
    payments: '[]',
    createdAt: new Date().toISOString()
  };
  await query('INSERT INTO debtors (id, name, amount, description, products, dueDate, payments, createdAt) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [debtor.id, debtor.name, debtor.amount, debtor.description, debtor.products, debtor.dueDate, debtor.payments, debtor.createdAt]);
  const row = await query('SELECT * FROM debtors WHERE id = $1', [debtor.id]);
  res.status(201).json(debtorRow(row[0]));
});

app.put('/api/debtors/:id', async (req, res) => {
  const { name, description, products, dueDate, amount } = req.body;
  const rows = await query('SELECT * FROM debtors WHERE id = $1', [req.params.id]);
  const debtor = rows[0];
  if (!debtor) return res.status(404).json({ error: 'Deudor no encontrado' });
  if (name) await query('UPDATE debtors SET name = $1 WHERE id = $2', [name, req.params.id]);
  if (description !== undefined) await query('UPDATE debtors SET description = $1 WHERE id = $2', [description, req.params.id]);
  if (dueDate !== undefined) await query('UPDATE debtors SET dueDate = $1 WHERE id = $2', [dueDate, req.params.id]);
  if (products) {
    const oldProducts = JSON.parse(debtor.products || '[]');
    for (const old of oldProducts) {
      await query('UPDATE inventory SET quantity = quantity + $1 WHERE id = $2', [old.quantity, old.id]);
    }
    for (const p of products) {
      const inv = await query('SELECT * FROM inventory WHERE id = $1', [p.id]);
      const item = inv[0];
      if (!item) return res.status(400).json({ error: `Producto "${p.name || p.id}" no encontrado en inventario` });
      if (item.quantity < p.quantity) return res.status(400).json({ error: `Stock insuficiente para "${item.name}"` });
      await query('UPDATE inventory SET quantity = quantity - $1 WHERE id = $2', [p.quantity, p.id]);
    }
    const totalAmount = amount != null ? amount : products.reduce((s, p) => s + (p.price || 0) * (p.quantity || 0), 0);
    await query('UPDATE debtors SET products = $1, amount = $2 WHERE id = $3', [JSON.stringify(products), totalAmount, req.params.id]);
  }
  const updated = await query('SELECT * FROM debtors WHERE id = $1', [req.params.id]);
  res.json(debtorRow(updated[0]));
});

app.post('/api/debtors/:id/pay', async (req, res) => {
  const { amount, note } = req.body;
  if (!amount) return res.status(400).json({ error: 'Monto requerido' });
  const rows = await query('SELECT * FROM debtors WHERE id = $1', [req.params.id]);
  const debtor = rows[0];
  if (!debtor) return res.status(404).json({ error: 'Deudor no encontrado' });
  const payments = JSON.parse(debtor.payments || '[]');
  payments.push({ amount: parseFloat(amount), date: new Date().toISOString(), note: note || '', registeredBy: req.session.username || 'unknown' });
  await query('UPDATE debtors SET payments = $1, amount = amount - $2 WHERE id = $3', [JSON.stringify(payments), parseFloat(amount), req.params.id]);
  const updated = await query('SELECT * FROM debtors WHERE id = $1', [req.params.id]);
  res.json(debtorRow(updated[0]));
});

app.delete('/api/debtors/:id/payments/:idx', async (req, res) => {
  const rows = await query('SELECT * FROM debtors WHERE id = $1', [req.params.id]);
  const debtor = rows[0];
  if (!debtor) return res.status(404).json({ error: 'Deudor no encontrado' });
  const payments = JSON.parse(debtor.payments || '[]');
  const idx = parseInt(req.params.idx);
  if (idx < 0 || idx >= payments.length) return res.status(400).json({ error: 'Abono no encontrado' });
  const removed = payments.splice(idx, 1)[0];
  await query('UPDATE debtors SET payments = $1, amount = amount + $2 WHERE id = $3', [JSON.stringify(payments), removed.amount, req.params.id]);
  const updated = await query('SELECT * FROM debtors WHERE id = $1', [req.params.id]);
  res.json(debtorRow(updated[0]));
});

app.put('/api/debtors/:id/payments/:idx', async (req, res) => {
  const { amount, note } = req.body;
  if (!amount) return res.status(400).json({ error: 'Monto requerido' });
  const rows = await query('SELECT * FROM debtors WHERE id = $1', [req.params.id]);
  const debtor = rows[0];
  if (!debtor) return res.status(404).json({ error: 'Deudor no encontrado' });
  const payments = JSON.parse(debtor.payments || '[]');
  const idx = parseInt(req.params.idx);
  if (idx < 0 || idx >= payments.length) return res.status(400).json({ error: 'Abono no encontrado' });
  const diff = parseFloat(amount) - payments[idx].amount;
  payments[idx].amount = parseFloat(amount);
  if (note !== undefined) payments[idx].note = note;
  await query('UPDATE debtors SET payments = $1, amount = amount - $2 WHERE id = $3', [JSON.stringify(payments), diff, req.params.id]);
  const updated = await query('SELECT * FROM debtors WHERE id = $1', [req.params.id]);
  res.json(debtorRow(updated[0]));
});

app.delete('/api/debtors/:id', async (req, res) => {
  const rows = await query('SELECT * FROM debtors WHERE id = $1', [req.params.id]);
  const debtor = rows[0];
  if (!debtor) return res.status(404).json({ error: 'Deudor no encontrado' });
  const products = JSON.parse(debtor.products || '[]');
  for (const p of products) {
    await query('UPDATE inventory SET quantity = quantity + $1 WHERE id = $2', [p.quantity, p.id]);
  }
  await query('DELETE FROM debtors WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

app.get('/api/inventory', async (req, res) => {
  const rows = await query('SELECT * FROM inventory ORDER BY LOWER(name)');
  res.json(rows);
});

app.post('/api/inventory', async (req, res) => {
  const { name, quantity, price } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  const qty = parseInt(quantity) || 0;
  if (qty < 0) return res.status(400).json({ error: 'La cantidad no puede ser negativa' });
  const item = { id: Date.now().toString(), name, quantity: qty, price: parseFloat(price) || 0, createdAt: new Date().toISOString() };
  await query('INSERT INTO inventory (id, name, quantity, price, createdAt) VALUES ($1, $2, $3, $4, $5)', [item.id, item.name, item.quantity, item.price, item.createdAt]);
  res.status(201).json(item);
});

app.put('/api/inventory/:id', async (req, res) => {
  const { name, quantity, price } = req.body;
  const inv = await query('SELECT * FROM inventory WHERE id = $1', [req.params.id]);
  const item = inv[0];
  if (!item) return res.status(404).json({ error: 'Item no encontrado' });
  if (quantity != null) {
    const qty = parseInt(quantity);
    if (qty < 0) return res.status(400).json({ error: 'La cantidad no puede ser negativa' });
    await query('UPDATE inventory SET quantity = $1 WHERE id = $2', [qty, req.params.id]);
  }
  if (name != null) await query('UPDATE inventory SET name = $1 WHERE id = $2', [name, req.params.id]);
  if (price != null) await query('UPDATE inventory SET price = $1 WHERE id = $2', [parseFloat(price), req.params.id]);
  const updated = await query('SELECT * FROM inventory WHERE id = $1', [req.params.id]);
  res.json(updated[0]);
});

app.delete('/api/inventory/:id', async (req, res) => {
  await query('DELETE FROM inventory WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const dbInit = initDB();

module.exports = app;

if (!process.env.VERCEL) {
  dbInit.then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      const { networkInterfaces } = require('os');
      const nets = networkInterfaces();
      let ip = 'localhost';
      for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
          if (net.family === 'IPv4' && !net.internal) { ip = net.address; break; }
        }
      }
      console.log(`Servidor corriendo en:`);
      console.log(`  Local:    http://localhost:${PORT}`);
      console.log(`  Red:      http://${ip}:${PORT}`);
      if (adminPassword) {
        console.log(`╔══════════════════════════════════════╗`);
        console.log(`║  NUEVA CONTRASEÑA GENERADA           ║`);
        console.log(`║                                      ║`);
        console.log(`║  Usuario: admin                      ║`);
        console.log(`║  Password: ${adminPassword.padEnd(30)}║`);
        console.log(`║                                      ║`);
        console.log(`║  GUARDA ESTA CONTRASEÑA              ║`);
        console.log(`╚══════════════════════════════════════╝`);
        fs.writeFileSync(path.join(__dirname, 'credenciales.txt'), `Usuario: admin\nPassword: ${adminPassword}\n`);
      } else {
        console.log(`Usuario: admin (contraseña ya personalizada)`);
      }
    });
  }).catch(err => {
    console.error('FATAL: Error al inicializar la base de datos:', err);
    process.exit(1);
  });
}
