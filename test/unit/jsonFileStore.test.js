import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  flushPendingWrites,
  isCompressedJsonFile,
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

describe('Collection files are stored gzipped', () => {
  let dir;

  const collectionPath = (name) => path.join(dir, name);

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'booru-json-store-coll-'));
  });

  afterEach(async () => {
    await flushPendingWrites();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('round-trips a collection through gzip', async () => {
    const likesPath = collectionPath('likes.json');
    const records = [
      { id: 'danbooru_1', site: 'danbooru', tags: ['a', 'b'], likedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'danbooru_2', site: 'danbooru', tags: ['c'], likedAt: '2026-01-02T00:00:00.000Z' }
    ];

    await writeJsonFile(likesPath, records);
    await flushPendingWrites();

    assert.ok(isCompressedJsonFile(likesPath), 'collection must be stored gzipped');
    assert.deepStrictEqual(readJsonFile(likesPath, []), records);
  });

  it('leaves non-collection files as readable JSON', async () => {
    const settingsPath = collectionPath('settings.json');
    await writeJsonFile(settingsPath, { theme: 'kotobox' });
    await flushPendingWrites();

    assert.equal(isCompressedJsonFile(settingsPath), false);
    const raw = await fs.readFile(settingsPath, 'utf8');
    assert.deepStrictEqual(JSON.parse(raw), { theme: 'kotobox' });
  });

  it('reads a collection that is still plain JSON on disk', async () => {
    // Installs upgrading from the pretty-printed schema must keep working.
    const likesPath = collectionPath('likes.json');
    const legacy = [{ id: 'danbooru_legacy', site: 'danbooru', tags: ['old'] }];
    await fs.writeFile(likesPath, JSON.stringify(legacy, null, 2), 'utf8');

    assert.deepStrictEqual(readJsonFile(likesPath, []), legacy);
    assert.equal(isCompressedJsonFile(likesPath), false, 'legacy file is not gzipped yet');

    // Rewriting it migrates the file to the compressed form.
    await writeJsonFile(likesPath, legacy);
    await flushPendingWrites();
    assert.ok(isCompressedJsonFile(likesPath));
    assert.deepStrictEqual(readJsonFile(likesPath, []), legacy);
  });

  it('serializes without indentation', async () => {
    const settingsPath = collectionPath('settings.json');
    await writeJsonFile(settingsPath, { a: 1, b: [2, 3] });
    await flushPendingWrites();

    const raw = await fs.readFile(settingsPath, 'utf8');
    assert.equal(raw, '{"a":1,"b":[2,3]}');
  });

  it('shrinks a large repetitive collection well below its JSON size', async () => {
    const likesPath = collectionPath('likes.json');
    const records = Array.from({ length: 200 }, (_, i) => ({
      id: `danbooru_${i}`,
      site: 'danbooru',
      author: 'some_artist',
      tags: ['1girl', 'long_hair', 'blue_eyes', 'smile', 'outdoors'],
      tagDetails: { artist: ['some_artist'], general: ['1girl', 'long_hair'] },
      likedAt: '2026-01-01T00:00:00.000Z'
    }));

    await writeJsonFile(likesPath, records);
    await flushPendingWrites();

    const onDisk = (await fs.stat(likesPath)).size;
    const asJson = Buffer.byteLength(JSON.stringify(records, null, 2));
    assert.ok(onDisk < asJson / 2, `expected gzipped ${onDisk} to be well under ${asJson}`);
    assert.deepStrictEqual(readJsonFile(likesPath, []), records);
  });

  it('writes a corrupt collection aside instead of throwing', async () => {
    const likesPath = collectionPath('likes.json');
    await fs.writeFile(likesPath, zlib.gzipSync('{not json'), 'utf8');

    assert.deepStrictEqual(readJsonFile(likesPath, []), []);
    const files = await fs.readdir(dir);
    assert.ok(
      files.some((f) => f.startsWith('likes.json.corrupt-')),
      `expected a quarantined copy, got ${files.join(', ')}`
    );
  });
});
