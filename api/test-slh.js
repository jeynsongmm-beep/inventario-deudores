const express = require('express');
const serverless = require('serverless-http');
const app = express();
app.get('/', (req, res) => res.json({ ok: true, msg: 'serverless-http works' }));
module.exports = serverless(app);
