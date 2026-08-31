// Ad-hoc checks for the storage fixes: atomic writes, corrupt-file quarantine and
// the stale debounced write that used to land on top of a newer sync write
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readJsonFile, writeJsonFile, writeJsonFileAsync, flushPendingWrites } from '../src/services/storageService.js';

let failures = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  (' + extra + ')' : ''}`);
  if (!ok) failures++;
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booru-storage-'));
const file = path.join(dir, 'data.json');
const settle = (ms) => new Promise(r => setTimeout(r, ms));

// 1. Round trip, and no temp file left behind
writeJsonFile(file, { a: 1, list: [1, 2, 3] });
const leftovers = fs.readdirSync(dir).filter(n => n.endsWith('.tmp'));
check('sync write persists', readJsonFile(file, null)?.a === 1);
check('no temp file left behind', leftovers.length === 0, leftovers.join(','));

// 2. A debounced write must not overwrite a newer sync write (the stale-timer bug)
writeJsonFileAsync(file, { a: 'STALE' }, 150);
writeJsonFile(file, { a: 'FRESH' });
await settle(400);
check('sync write wins over queued debounced write', readJsonFile(file, null)?.a === 'FRESH', `got ${readJsonFile(file, null)?.a}`);

// 3. Debounced write still lands on its own
writeJsonFileAsync(file, { a: 'DEBOUNCED' }, 100);
await settle(300);
check('debounced write lands', readJsonFile(file, null)?.a === 'DEBOUNCED', `got ${readJsonFile(file, null)?.a}`);

// 4. flushPendingWrites() must persist a write that is still in the timer window
writeJsonFileAsync(file, { a: 'FLUSHED' }, 5000);
flushPendingWrites();
check('flushPendingWrites writes immediately', readJsonFile(file, null)?.a === 'FLUSHED', `got ${readJsonFile(file, null)?.a}`);

// 5. Corrupt JSON is quarantined instead of silently replaced by the default
fs.writeFileSync(file, '{"a": "broken"', 'utf-8');
const recovered = readJsonFile(file, { a: 'DEFAULT' });
check('corrupt file falls back to default', recovered?.a === 'DEFAULT');
const quarantined = fs.readdirSync(dir).filter(n => n.includes('.corrupt-'));
check('corrupt file kept as .corrupt-* copy', quarantined.length === 1, quarantined.join(','));
if (quarantined.length === 1) {
  const kept = fs.readFileSync(path.join(dir, quarantined[0]), 'utf-8');
  check('quarantined copy keeps the original bytes', kept === '{"a": "broken"');
}
// The original path is free again, so the next save starts clean
writeJsonFile(file, { a: 'AFTER_CORRUPT' });
check('file usable after quarantine', readJsonFile(file, null)?.a === 'AFTER_CORRUPT');

fs.rmSync(dir, { recursive: true, force: true });
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
