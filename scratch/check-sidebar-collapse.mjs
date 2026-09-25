/**
 * Manual UI check for the desktop sidebar collapse and preset name wrapping.
 * Not part of `npm test`: it drives a real browser and needs a running server.
 *
 *   node server.js --no-open --port=3199
 *   node scratch/check-sidebar-collapse.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LOG = 'tmp/sidebar-progress.log';
try { rmSync(LOG); } catch {}

// stdout is block-buffered when redirected to a file, so a hang would leave no
// trace at all; progress goes to its own file instead.
const step = (msg) => appendFileSync(LOG, `${new Date().toISOString()} ${msg}\n`);
process.on('exit', () => step('process exit'));
process.on('uncaughtException', (e) => { step(`uncaught: ${e.message}`); process.exit(1); });

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\EdgeCore\\153.0.4234.48\\msedge.exe';
const BASE = process.env.BASE_URL || 'http://localhost:3199';
const OUT = 'tmp';
const CDP_PORT = 9300 + Math.floor(Math.random() * 400);

const PRESETS = [
  { id: 'p1', name: 'art cute girl and her best friend having tea in a cozy room', tags: ['1girl', 'tea'] },
  { id: 'p2', name: 'test', tags: ['1girl'] },
  { id: 'p3', name: 'gatchappen', tags: ['1girl', 'long_hair', 'smile', 'solo'], site: 'gelbooru' },
  { id: 'p4', name: 'asdasd', tags: ['1girl', 'blue_hair'], filters: { ratingFilter: 'sfw', typeFilter: 'image' } },
  { id: 'p5', name: 'Danbooru landscape scenery mountains sunrise', tags: ['scenery', 'mountain'], site: 'danbooru' }
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    let settled = false;
    const pending = new Map();

    // A dropped socket must reject the in-flight commands, otherwise their
    // promises stay pending forever and the process exits silently mid-check.
    const failAll = (reason) => {
      if (settled) return;
      settled = true;
      for (const { reject: rej } of pending.values()) rej(new Error(reason));
      pending.clear();
      reject(new Error(reason));
    };
    ws.addEventListener('close', () => failAll('websocket closed'));
    ws.addEventListener('error', () => failAll('websocket error'));

    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej, timer } = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(timer);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      }
    });

    // Without a timeout a stale browser holding the port leaves this pending forever
    const guard = setTimeout(() => failAll('CDP connect timeout'), 10000);

    ws.addEventListener('open', () => {
      clearTimeout(guard);
      settled = true;
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const msgId = ++id;
            const timer = setTimeout(() => {
              pending.delete(msgId);
              rej(new Error(`CDP timeout: ${method}`));
            }, 15000);
            pending.set(msgId, { resolve: res, reject: rej, timer });
            ws.send(JSON.stringify({ id: msgId, method, params }));
          });
        },
        close: () => ws.close()
      });
    });
  });
}

const profileDir = mkdtempSync(join(tmpdir(), 'sidebar-check-'));
const edge = spawn(EDGE, [
  '--headless=new',
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${profileDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--hide-scrollbars',
  'about:blank'
], { stdio: 'ignore' });

async function main() {
  let targets = [];
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      targets = await res.json();
      if (targets.length) break;
    } catch {}
    await sleep(250);
  }
  if (!targets.length) throw new Error('CDP did not come up');
  step('CDP targets up');

  const client = await connect(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  step('websocket connected');
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  step('domains enabled');

  const evaluate = async (expression) => {
    const r = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };

  const setViewport = async (width, height) => {
    // Must be issued twice around a navigation: right after Page.reload the
    // session is still reattaching and the first call never gets an answer.
    await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  };

  // Seed presets, then reload so the app renders them on boot
  step('navigating');
  await setViewport(1440, 900);
  await client.send('Page.navigate', { url: BASE });
  await sleep(1500);
  await evaluate(`localStorage.setItem('booru_presets_v1', ${JSON.stringify(JSON.stringify(PRESETS))}); true`);
  step('presets seeded');
  // Page.reload invalidates the execution context and Runtime.evaluate then never
  // answers; a fresh Page.navigate keeps the session usable.
  await client.send('Page.navigate', { url: BASE });
  await sleep(2500);
  step('reloaded');
  await client.send('Runtime.enable');
  await setViewport(1440, 900);
  step('viewport set');

  const shot = async (name, width, height) => {
    await setViewport(width, height);
    await sleep(900);
    step(`shot ${name}`);
    const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, name), Buffer.from(data, 'base64'));
    console.log('saved', name);
  };

  await shot('sidebar-expanded.png', 1440, 900);

  await evaluate(`document.getElementById('btnToggleSidebar').click(); true`);
  await sleep(800);
  console.log('collapsed state:', await evaluate(`(() => {
    const layout = document.querySelector('.app-layout');
    const side = document.getElementById('sidebarSearch');
    return {
      hasClass: layout.classList.contains('sidebar-collapsed'),
      visibility: getComputedStyle(side).visibility,
      sideRight: Math.round(side.getBoundingClientRect().right),
      mainLeft: Math.round(document.querySelector('.main-content').getBoundingClientRect().left),
      stored: localStorage.getItem('booru_sidebar_collapsed_v1'),
      ariaExpanded: document.getElementById('btnToggleSidebar').getAttribute('aria-expanded')
    };
  })()`));
  await shot('sidebar-collapsed.png', 1440, 900);

  // Ctrl+B restores the panel
  await evaluate(`document.getElementById('btnToggleSidebar').focus(); true`);
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66, modifiers: 2 });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66, modifiers: 2 });
  await sleep(800);
  console.log('after Ctrl+B collapsed:', await evaluate(`document.querySelector('.app-layout').classList.contains('sidebar-collapsed')`));
  await shot('sidebar-ctrlb-restored.png', 1440, 900);

  console.log('preset rows:', await evaluate(`(() => [...document.querySelectorAll('.preset-item')].map(item => {
    const name = item.querySelector('.preset-name');
    const cs = getComputedStyle(name);
    return {
      text: name.textContent.slice(0, 40),
      clamp: cs.webkitLineClamp,
      nameH: Math.round(name.getBoundingClientRect().height),
      itemH: Math.round(item.getBoundingClientRect().height)
    };
  }))()`));

  await shot('sidebar-narrow-820.png', 820, 800);
  console.log('narrow header:', await evaluate(`(() => {
    const h = document.querySelector('.app-header');
    return { scrollW: h.scrollWidth, clientW: h.clientWidth };
  })()`));

  // Collapse while a sidebar control has focus: focus must not stay on a hidden element
  await evaluate(`document.getElementById('searchInput').focus(); true`);
  await evaluate(`document.getElementById('btnToggleSidebar').click(); true`);
  await sleep(700);
  console.log('focus after collapse:', await evaluate(`(() => ({
    activeId: document.activeElement.id,
    sidebarVisibility: getComputedStyle(document.getElementById('sidebarSearch')).visibility
  }))()`));
  await evaluate(`document.getElementById('btnToggleSidebar').click(); true`);
  await sleep(700);

  // Type "b" with Ctrl inside a field: the shortcut must not fire
  const before = await evaluate(`document.querySelector('.app-layout').classList.contains('sidebar-collapsed')`);
  await evaluate(`document.getElementById('searchInput').focus(); true`);
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66, modifiers: 2 });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'b', code: 'KeyB', windowsVirtualKeyCode: 66, modifiers: 2 });
  await sleep(600);
  console.log('typing Ctrl+B in a field changed state:', before !== await evaluate(`document.querySelector('.app-layout').classList.contains('sidebar-collapsed')`));

  await shot('sidebar-mobile-390.png', 390, 780);
  console.log('mobile:', await evaluate(`(() => {
    const btn = document.getElementById('btnToggleSidebar');
    return {
      toggleDisplay: getComputedStyle(btn).display,
      collapsedClass: document.querySelector('.app-layout').classList.contains('sidebar-collapsed'),
      drawerTransform: getComputedStyle(document.getElementById('sidebarSearch')).transform
    };
  })()`));

  // Both remaining themes, expanded, to confirm the preset rows hold up
  for (const theme of ['warm-paper', 'tokyo-night']) {
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)};
      localStorage.setItem('booru_settings_v1', JSON.stringify({ theme: ${JSON.stringify(theme)} })); true`);
    await sleep(700);
    const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `sidebar-theme-${theme}.png`), Buffer.from(data, 'base64'));
    console.log('saved', `sidebar-theme-${theme}.png`);
  }

  client.close();
}

try {
  await main();
} finally {
  edge.kill();
  try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
}
