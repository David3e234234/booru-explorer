import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  flushPendingWrites,
  readJsonFile,
  writeJsonFile,
  writeJsonFileAsync
} from '../../src/services/jsonFileStore.js';

describe('Serialized JSON file store', () => {
  let dir;
  let filePath;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'booru-json-store-'));
    filePath = path.join(dir, 'state.json');
  });

  afterEach(async () => {
    await flushPendingWrites();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('keeps the newest value when sync and debounced writes overlap', async () => {
    writeJsonFileAsync(filePath, { version: 1 }, 5);
    await writeJsonFile(filePath, { version: 2 });
    writeJsonFileAsync(filePath, { version: 3 }, 5);
    await flushPendingWrites();
    assert.deepStrictEqual(JSON.parse(await fs.readFile(filePath, 'utf8')), { version: 3 });
  });

  it('reads the pending value before it reaches disk', () => {
    writeJsonFileAsync(filePath, { pending: true }, 1000);
    assert.deepStrictEqual(readJsonFile(filePath, {}), { pending: true });
  });

  it('does not leave temporary files behind', async () => {
    await writeJsonFile(filePath, { ok: true });
    await flushPendingWrites();
    const files = await fs.readdir(dir);
    assert.deepStrictEqual(files, ['state.json']);
  });
});
