import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { CACHE_DIR } from '../../src/config/constants.js';
import {
  clearBooruTagTypeCache,
  getBooruTagCacheSize,
  getCachedTagType,
  setCachedTagType,
  TAG_TYPE
} from '../../src/services/booruTagTypeService.js';

function cacheFile(site) {
  return path.join(CACHE_DIR, `booru_tag_types_${site}.json`);
}

test('booru tag type cache', async (t) => {
  t.beforeEach(() => {
    clearBooruTagTypeCache();
  });

  t.afterEach(() => {
    clearBooruTagTypeCache();
  });

  await t.test('reads persisted answers on a fresh boot', () => {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheFile('gelbooru'), JSON.stringify({
      version: 1,
      entries: [
        ['persisted_artist', [TAG_TYPE.ARTIST, Date.now()]],
        ['persisted_character', [TAG_TYPE.CHARACTER, Date.now()]]
      ]
    }));

    // Memory is empty here: the answer must come from disk, which the previous
    // getCachedTagType() ignored until a single-post lookup warmed memory.
    assert.equal(getCachedTagType('gelbooru', 'persisted_artist'), TAG_TYPE.ARTIST);
    assert.equal(getCachedTagType('gelbooru', 'persisted_character'), TAG_TYPE.CHARACTER);
    assert.equal(getBooruTagCacheSize('gelbooru'), 2);
  });

  await t.test('drops expired entries instead of trusting them', () => {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    fs.writeFileSync(cacheFile('rule34'), JSON.stringify({
      version: 1,
      entries: [['stale_tag', [TAG_TYPE.ARTIST, eightDaysAgo]]]
    }));

    assert.equal(getCachedTagType('rule34', 'stale_tag'), null);
    assert.equal(getBooruTagCacheSize('rule34'), 0);
  });

  await t.test('round-trips a value written through the public setter', () => {
    setCachedTagType('gelbooru', 'Fresh_Artist', TAG_TYPE.ARTIST);
    assert.equal(getCachedTagType('gelbooru', 'fresh_artist'), TAG_TYPE.ARTIST);
  });

  await t.test('ignores unsupported sites and unknown raw codes', () => {
    assert.equal(getCachedTagType('danbooru', 'anything'), null);
    assert.equal(getCachedTagType('', 'anything'), null);
    setCachedTagType('gelbooru', 'never', 99);
    assert.equal(getCachedTagType('gelbooru', 'never'), null);
  });
});
