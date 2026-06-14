const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const cfPath = path.join(__dirname, 'cloudflared.exe');
const logFile = path.join(__dirname, 'tunnel-url.txt');

if (!fs.existsSync(cfPath)) {
  console.log('ERROR: cloudflared.exe no encontrado');
  process.exit(1);
}

const proc = spawn(cfPath, ['tunnel', '--url', 'http://localhost:3000', '--no-autoupdate'], {
  stdio: ['ignore', 'pipe', 'pipe']
});

let urlFound = false;

proc.stdout.on('data', (data) => {
  const text = data.toString();
  fs.appendFileSync(logFile, text);
  const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (match && !urlFound) {
    urlFound = true;
    const url = match[0];
    fs.writeFileSync(path.join(__dirname, 'tunnel-actual-url.txt'), url);
    console.log('TUNEL_URL:' + url);
  }
});

proc.stderr.on('data', (data) => {
  fs.appendFileSync(logFile, data.toString());
});

proc.on('close', (code) => {
  console.log('CLOSED:' + code);
});

process.on('SIGTERM', () => { proc.kill(); process.exit(0); });
process.on('SIGINT', () => { proc.kill(); process.exit(0); });
