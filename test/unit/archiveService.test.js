import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAllowedArchiveUrl,
  getArchiveKey,
  resolveArchiveFetchOptions,
  buildArchiveAlbumItems
} from '../../src/services/archiveService.js';
import { BOORU_USER_AGENT } from '../../src/config/constants.js';
import { fetchSafe } from '../../src/utils/network.js';

describe('Archive service & network integration', () => {
  it('correctly validates allowed archive URLs', () => {
    assert.strictEqual(isAllowedArchiveUrl('https://file.pawchive.pw/data/43/a3/43a3f1bf.zip'), true);
    assert.strictEqual(isAllowedArchiveUrl('https://n1.kemono.cr/data/ab/cd/abcd.zip'), true);
    assert.strictEqual(isAllowedArchiveUrl('https://coomer.su/data/ab/cd/abcd.zip?f=file.zip'), true);
    assert.strictEqual(isAllowedArchiveUrl('https://evil.com/malicious.zip'), false);
    assert.strictEqual(isAllowedArchiveUrl('https://pawchive.pw/data/file.exe'), false);
  });

  it('resolves site and settings correctly in resolveArchiveFetchOptions', () => {
    const pawchiveOpts = resolveArchiveFetchOptions('https://file.pawchive.pw/data/12/34/file.zip');
    assert.strictEqual(pawchiveOpts.site, 'pawchive');

    const kemonoOpts = resolveArchiveFetchOptions('https://n1.kemono.cr/data/12/34/file.zip');
    assert.strictEqual(kemonoOpts.site, 'kemono');
  });

  it('generates consistent archive cache key', () => {
    const url = 'https://file.pawchive.pw/data/43/a3/test.zip';
    const key1 = getArchiveKey(url);
    const key2 = getArchiveKey(url);
    assert.strictEqual(key1, key2);
    assert.match(key1, /^[a-f0-9]{32}$/);
  });

  it('buildArchiveAlbumItems formats album items properly', () => {
    const manifest = {
      key: 'testkey123',
      items: [
        { n: 1, ext: 'jpg', isVideo: false, name: 'image1.jpg', size: 1024 },
        { n: 2, ext: 'mp4', isVideo: true, name: 'video1.mp4', size: 2048 }
      ]
    };
    const items = buildArchiveAlbumItems(manifest, 'pawchive');
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[0].site, 'pawchive');
    assert.strictEqual(items[0].fileUrl, '/api/archive/file?key=testkey123&n=1');
    assert.strictEqual(items[1].isVideo, true);
  });
});
