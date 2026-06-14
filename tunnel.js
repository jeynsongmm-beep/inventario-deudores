const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const cfPath = path.join(__dirname, 'cloudflared.exe');
const urlFile = path.join(__dirname, 'tunnel-url.txt');

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
  const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (match && !urlFound) {
    urlFound = true;
    const url = match[0];
    fs.writeFileSync(urlFile, url);
    console.log('TUNNEL_URL:' + url);
  }
});

proc.stderr.on('data', (data) => {
  const text = data.toString();
  const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (match && !urlFound) {
    urlFound = true;
    const url = match[0];
    fs.writeFileSync(urlFile, url);
    console.log('TUNNEL_URL:' + url);
  }
});

proc.on('close', (code) => {
  console.log('CLOSED:' + code);
  process.exit(0);
});

process.on('SIGTERM', () => { proc.kill(); process.exit(0); });
process.on('SIGINT', () => { proc.kill(); process.exit(0); });
