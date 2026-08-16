import { spawn } from 'child_process';
import os from 'os';
import qrcode from 'qrcode-terminal';

function getLocalIpAddress() {
  const nets = os.networkInterfaces();
  const candidates = [];

  const isVirtualOrVpn = (name) => {
    const lower = name.toLowerCase();
    return (
      lower.includes('radmin') ||
      lower.includes('hamachi') ||
      lower.includes('tailscale') ||
      lower.includes('zerotier') ||
      lower.includes('virtualbox') ||
      lower.includes('vmware') ||
      lower.includes('vbox') ||
      lower.includes('vethernet') ||
      lower.includes('hyper-v') ||
      lower.includes('wsl') ||
      lower.includes('docker') ||
      lower.includes('teredo') ||
      lower.includes('loopback') ||
      lower.includes('tap') ||
      lower.includes('tun') ||
      lower.includes('nordlynx') ||
      lower.includes('wireguard')
    );
  };

  const isPrivateIp = (ip) => {
    if (ip.startsWith('192.168.')) return 3;
    if (ip.startsWith('10.')) return 2;
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return 1;
    return 0;
  };

  for (const name of Object.keys(nets)) {
    const isVpn = isVirtualOrVpn(name);
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        const priority = isPrivateIp(net.address);
        candidates.push({
          name,
          address: net.address,
          isVpn,
          priority: isVpn ? -1 : priority
        });
      }
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);

  if (candidates.length > 0) {
    return candidates[0].address;
  }
  return 'localhost';
}

const port = process.env.PORT || 3000;
const ip = getLocalIpAddress();
const url = `http://${ip}:${port}`;

console.log('\n======================================================');
console.log(`📱 ССЫЛКА ДЛЯ ТЕЛЕФОНА (ЛОКАЛЬНЫЙ WI-FI)`);
console.log(`URL: ${url}`);
console.log('Подключите телефон к той же Wi-Fi сети и отсканируйте код:');
console.log('======================================================\n');

qrcode.generate(url, { small: true });

console.log('\nЗапуск основного сервера...\n');

const serverProc = spawn(/^win/.test(process.platform) ? 'node.exe' : 'node', ['server.js', '--no-open'], { 
  stdio: 'inherit',
  shell: true
});

serverProc.on('error', (err) => {
  console.error('Ошибка запуска сервера:', err);
});
