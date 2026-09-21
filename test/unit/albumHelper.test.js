import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidRelationKey,
  extractPageNumber,
  extractAllSeriesKeys,
  extractSeriesKey
} from '../../src/utils/albumHelper.js';

describe('Album Helper Unit Tests', () => {
  describe('isValidRelationKey', () => {
    it('rejects invalid, null, undefined, or empty keys', () => {
      assert.strictEqual(isValidRelationKey(null), false);
      assert.strictEqual(isValidRelationKey(undefined), false);
      assert.strictEqual(isValidRelationKey(''), false);
      assert.strictEqual(isValidRelationKey('   '), false);
      assert.strictEqual(isValidRelationKey(123), false);
      assert.strictEqual(isValidRelationKey('pixiv:undefined'), false);
      assert.strictEqual(isValidRelationKey('pixiv:null'), false);
      assert.strictEqual(isValidRelationKey('pixiv:NaN'), false);
      assert.strictEqual(isValidRelationKey(':pixiv:123'), false);
      assert.strictEqual(isValidRelationKey('pixiv:123:'), false);
      assert.strictEqual(isValidRelationKey('singlepart'), false);
    });

    it('rejects parent ID 0', () => {
      assert.strictEqual(isValidRelationKey('parent:danbooru:0'), false);
    });

    it('accepts single-digit and multi-digit parent IDs (F-27 regression test)', () => {
      assert.strictEqual(isValidRelationKey('parent:danbooru:1'), true);
      assert.strictEqual(isValidRelationKey('parent:danbooru:5'), true);
      assert.strictEqual(isValidRelationKey('parent:danbooru:9'), true);
      assert.strictEqual(isValidRelationKey('parent:danbooru:42'), true);
      assert.strictEqual(isValidRelationKey('parent:danbooru:123456'), true);
    });

    it('rejects generic blacklisted paths', () => {
      assert.strictEqual(isValidRelationKey('source:user'), false);
      assert.strictEqual(isValidRelationKey('source:store'), false);
      assert.strictEqual(isValidRelationKey('source:profile'), false);
      assert.strictEqual(isValidRelationKey('source:artwork'), false);
    });

    it('accepts valid relation keys', () => {
      assert.strictEqual(isValidRelationKey('pixiv:12345678'), true);
      assert.strictEqual(isValidRelationKey('twitter:1829384756102938'), true);
      assert.strictEqual(isValidRelationKey('lofter:author_name:post_123'), true);
    });
  });

  describe('extractAllSeriesKeys and extractSeriesKey', () => {
    it('correctly extracts single-digit parent relationship', () => {
      const post = {
        site: 'danbooru',
        originalId: '100',
        parentId: 7
      };
      const keys = extractAllSeriesKeys(post, 'danbooru');
      assert.ok(keys.includes('parent:danbooru:7'));
    });

    it('extracts Pixiv and Twitter series keys', () => {
      const post = {
        site: 'danbooru',
        source: 'https://www.pixiv.net/en/artworks/98765432'
      };
      const keys = extractAllSeriesKeys(post, 'danbooru');
      assert.ok(keys.includes('pixiv:98765432'));
      assert.strictEqual(extractSeriesKey(post, 'danbooru'), 'pixiv:98765432');
    });
  });

  describe('extractPageNumber', () => {
    it('extracts page from explicit fields or source patterns', () => {
      assert.strictEqual(extractPageNumber({ pageIndex: 2 }), 2);
      assert.strictEqual(extractPageNumber({ source: 'https://i.pximg.net/img-original/img/2023/01/01/00/00/00/12345678_p3.jpg' }), 3);
      assert.strictEqual(extractPageNumber({ source: 'https://twitter.com/user/status/123456789/photo/2' }), 1);
      assert.strictEqual(extractPageNumber({ tags: ['page_4'] }), 4);
    });
  });
});
