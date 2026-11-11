// Manual diagnostic for the reported bug: the sources panel must always
// highlight the source the visible feed came from.
//
//   1. start the app:  node server.js --no-open --port=3199
//   2. run:            node scratch/sourcePanelBrowser.mjs 3199
//
// Journey from the bug report: browse Gelbooru, open Favorites -> Authors,
// click "Смотреть работы" on an author whose preferred source is Danbooru
// (the panel used to stay on Gelbooru), then click Gelbooru once. Before the
// fix that click was swallowed by a "same site" early return and nothing
// happened; the user had to pick another source first.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = process.argv[2] || '3000';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DEBUG_PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), 'booru-chrome-'));

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${DEBUG_PORT}`,
  'about:blank'
], { stdio: 'ignore' });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let ws;
let msgId = 0;
const pending = new Map();

function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }
    }, 40000);
  });
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || 'evaluate failed');
  return res.result?.value;
}

const JOURNEY = `
  (async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const panelActive = () => [...document.querySelectorAll('#sourcesList .source-item')]
      .filter((el) => el.classList.contains('active'))
      .map((el) => el.textContent.trim());
    const siteLabel = () => document.getElementById('currentSiteLabel')?.textContent?.trim() || '';
    const itemNamed = (name) => [...document.querySelectorAll('#sourcesList .source-item')]
      .find((el) => el.textContent.trim() === name);

    itemNamed('Gelbooru')?.click();
    await sleep(3000);
    const afterGelbooru = { active: panelActive(), label: siteLabel() };

    document.querySelector('.nav-tab[data-category="favorites"]')?.click();
    await sleep(1200);
    document.getElementById('btnFavSubAuthors')?.click();
    await sleep(1200);

    const exploreBtn = document.querySelector('.author-card .btn-author-explore');
    if (!exploreBtn) return { error: 'no author card rendered', afterGelbooru };

    exploreBtn.click();
    await sleep(3500);
    const afterAuthorJump = { active: panelActive(), label: siteLabel() };

    // One click on Gelbooru. This is the click that used to do nothing.
    itemNamed('Gelbooru')?.click();
    await sleep(3500);
    const afterReturn = {
      active: panelActive(),
      label: siteLabel(),
      tagChips: [...document.querySelectorAll('.tag-chip .tag-text, .search-tag, .chip-text')]
        .map((el) => el.textContent.trim())
        .filter(Boolean)
    };

    return { afterGelbooru, afterAuthorJump, afterReturn };
  })()
`;

try {
  let page = null;
  for (let i = 0; i < 40 && !page; i++) {
    await wait(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      page = list.find((t) => t.type === 'page');
    } catch {}
  }
  if (!page) throw new Error('Chrome DevTools endpoint did not come up');

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg.result);
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');

  // Seed one followed author whose preferred source is Danbooru, then reload so
  // it is loaded as local (logged-out) account data.
  await send('Page.navigate', { url: `http://localhost:${port}/` });
  await wait(1500);
  await evaluate(`
    localStorage.setItem('booru_favorite_authors_v1', JSON.stringify([
      { name: 'test_artist_probe', displayName: 'Probe', site: 'danbooru', createdAt: new Date().toISOString() }
    ]));
    true
  `);
  await send('Page.navigate', { url: `http://localhost:${port}/` });
  await wait(7000);

  if (!(await evaluate(`Boolean(document.querySelector('#sourcesList .source-item'))`))) {
    throw new Error('source panel never rendered');
  }

  const result = await evaluate(JOURNEY);
  console.log(JSON.stringify(result, null, 2));

  if (result.error) throw new Error(result.error);
  if (!result.afterAuthorJump?.active?.includes('Danbooru')) {
    throw new Error(`source panel did not follow the author jump: ${JSON.stringify(result.afterAuthorJump)}`);
  }
  if (!result.afterReturn?.active?.includes('Gelbooru')) {
    throw new Error(`returning to Gelbooru did not move the highlight: ${JSON.stringify(result.afterReturn)}`);
  }
  console.log('OK: the panel follows the author jump and one click returns to Gelbooru');
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
  await wait(400);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
