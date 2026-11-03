import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after } from 'node:test';

const testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'booru-explorer-test-'));

process.env.NODE_ENV = 'test';
process.env.BOORU_DATA_DIR = testDataDir;

after(async () => {
  // The integration server keeps the SQLite handle open until it is closed
  // explicitly; on Windows an open handle makes the unlink fail with EBUSY.
  // Dynamic import: a static one would hoist constants.js above the
  // BOORU_DATA_DIR assignment and freeze the real data dir into the tests.
  const { closeDatabase } = await import('../src/services/sqliteStore.js');
  closeDatabase();
  await fs.rm(testDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// Discovery instead of a hardcoded list: a hand-maintained registry silently skips
// newly added suites, which is how regressions reach main unnoticed. Unit suites
// run first, integration last, both sorted so the order stays deterministic.
async function discoverSuites(dir) {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.test.js'))
    .map(entry => path.join(entry.parentPath || entry.path, entry.name).replace(/\\/g, '/'))
    .sort();
}

const unitSuites = await discoverSuites(fileURLToPath(new URL('./unit/', import.meta.url)));
const integrationSuites = await discoverSuites(fileURLToPath(new URL('./integration/', import.meta.url)));

for (const suite of [...unitSuites, ...integrationSuites]) {
  await import(pathToFileURL(suite).href);
}
