// Ad-hoc check for fetchSafe: external abort + body timeout + normal read.
// Run with: node scratch/check-fetchsafe.mjs
import http from 'http';
import { fetchSafe } from '../src/utils/network.js';

const server = http.createServer((req, res) => {
  if (req.url === '/slow-body') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    // Headers arrive immediately, then the body dribbles out forever
    let n = 0;
    const t = setInterval(() => {
      res.write(`chunk-${n++}\n`);
      if (n > 100) {
        clearInterval(t);
        res.end();
      }
    }, 300);
    req.on('close', () => clearInterval(t));
    return;
  }
  if (req.url === '/ok') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }
  if (req.url === '/empty204') {
    res.writeHead(204);
    res.end();
    return;
  }
  res.writeHead(404);
  res.end('nope');
});

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// 1. External abort must now actually cancel the request
try {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 150);
  const started = Date.now();
  await fetchSafe(`${base}/slow-body`, { signal: ac.signal });
  check('external signal aborts the request', false, 'запрос не был отменён');
} catch (err) {
  check('external signal aborts the request', err.name === 'AbortError', err.name);
}

// 2. Body timeout fires after the headers have already arrived, while the
// caller is still reading - fetchSafe itself resolves as soon as headers land
let started = Date.now();
try {
  started = Date.now();
  const res = await fetchSafe(`${base}/slow-body`, { bodyTimeout: 700 });
  const headersMs = Date.now() - started;
  await res.text();
  check('body timeout fires while reading the body', false, `тело дочитано, заголовки за ${headersMs} мс`);
} catch (err) {
  const ms = Date.now() - started;
  check('body timeout fires while reading the body', err.name === 'AbortError' && ms < 3000, `${err.name} через ${ms} мс`);
}

// 2b. A body read that finishes in time is not cut short
try {
  const res = await fetchSafe(`${base}/slow-body`, { bodyTimeout: 4000 });
  let received = 0;
  for await (const chunk of res.body) {
    received += chunk.length;
    if (received > 40) break;
  }
  try { await res.body.cancel(); } catch {}
  check('healthy body read is not cut short', received > 0, `${received} байт`);
} catch (err) {
  check('healthy body read is not cut short', false, err.name + ' ' + err.message);
}

// 3. Normal responses still read fine through the wrapper
try {
  const res = await fetchSafe(`${base}/ok`);
  const text = await res.text();
  check('normal body read through wrapper', text === '{"ok":true}' && res.status === 200, text);
} catch (err) {
  check('normal body read through wrapper', false, err.message);
}

// 4. Bodyless status must not be wrapped (Response would reject a 204 with a body)
try {
  const res = await fetchSafe(`${base}/empty204`);
  check('204 passes through untouched', res.status === 204 && !res.body, `status=${res.status}`);
} catch (err) {
  check('204 passes through untouched', false, err.message);
}

// 5. Streaming opt-out: the body read is not cut short by the header timeout
try {
  const started = Date.now();
  const res = await fetchSafe(`${base}/slow-body`, { timeout: 500, streamBody: true });
  let received = 0;
  for await (const chunk of res.body) {
    received += chunk.length;
    if (received > 40) break;
  }
  const ms = Date.now() - started;
  try { await res.body.cancel(); } catch {}
  check('streamBody survives past the header timeout', ms > 500, `${ms} мс, получено ${received} байт`);
} catch (err) {
  check('streamBody survives past the header timeout', false, err.name + ' ' + err.message);
}

// 6. Non-ok responses are returned (caller decides), not thrown
try {
  const res = await fetchSafe(`${base}/missing`);
  check('404 is returned, not thrown', res.status === 404);
  try { await res.body?.cancel(); } catch {}
} catch (err) {
  check('404 is returned, not thrown', false, err.message);
}

server.close();

const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} проверок пройдено`);
process.exit(failed.length ? 1 : 0);
