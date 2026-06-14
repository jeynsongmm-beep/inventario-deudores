const { Pool } = require('pg');

module.exports = async (req, res) => {
  const result = {};
  const keys = Object.keys(process.env).filter(k => k.includes('DATABASE') || k.includes('POSTGRES') || k.includes('NEON') || k.includes('PG'));
  keys.forEach(k => {
    const v = process.env[k];
    result[k] = v ? v.substring(0, 30) + '...' : 'EMPTY';
  });
  result.NODE_VER = process.version;
  
  const dbUrl = process.env.DATABASE_URL || process.env.DATABASE_URL_POSTGRES_URL || process.env.POSTGRES_URL;
  if (dbUrl) {
    const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
    try {
      const r = await pool.query('SELECT 1 as test');
      result.DB_WORKS = true;
      result.DB_MSG = r.rows[0].test;
      await pool.end();
    } catch (e) {
      result.DB_ERROR = e.message;
    }
  } else {
    result.DB_URL = 'NOT FOUND';
  }
  
  res.json(result);
};
