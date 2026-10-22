import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidRelationKey,
  extractPageNumber,
  extractAllSeriesKeys,
  extractSeriesKey,
  extractBaseCharacterName,
  normalizeCopyrightTag,
  arePostsAlbumCompatible,
  groupPostsIntoAlbums
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

  describe('extractBaseCharacterName', () => {
    it('extracts base name from character tags with parentheses and variants', () => {
      assert.strictEqual(extractBaseCharacterName('hibiki_(blue_archive)'), 'hibiki');
      assert.strictEqual(extractBaseCharacterName('hibiki_(cheerleader)_(blue_archive)'), 'hibiki');
      assert.strictEqual(extractBaseCharacterName('shigure_(blue_archive)'), 'shigure');
      assert.strictEqual(extractBaseCharacterName('rem_(re:zero)'), 'rem');
      assert.strictEqual(extractBaseCharacterName('asuka_langley_(eva_1.0)'), 'asuka_langley');
      assert.strictEqual(extractBaseCharacterName('2b_(nier:automata)'), '2b');
      assert.strictEqual(extractBaseCharacterName('hatsune_miku'), 'hatsune_miku');
      assert.strictEqual(extractBaseCharacterName('character:artoria_pendragon_(fate)'), 'artoria_pendragon');
    });
  });

  describe('normalizeCopyrightTag', () => {
    it('normalizes series and franchise tags', () => {
      assert.strictEqual(normalizeCopyrightTag('blue_archive'), 'blue_archive');
      assert.strictEqual(normalizeCopyrightTag('blue_archive_(series)'), 'blue_archive');
      assert.strictEqual(normalizeCopyrightTag('copyright:genshin_impact_(game)'), 'genshin_impact');
      assert.strictEqual(normalizeCopyrightTag('fate/grand_order'), 'fate/grand_order');
    });
  });

  describe('arePostsAlbumCompatible', () => {
    it('accepts real variants of the same character and franchise', () => {
      const p1 = {
        author: 'artist_x',
        tagDetails: { character: ['hibiki_(blue_archive)'], copyright: ['blue_archive'] },
        tags: ['1girl', 'hibiki_(blue_archive)', 'blue_archive']
      };
      const p2 = {
        author: 'artist_x',
        tagDetails: { character: ['hibiki_(cheerleader)_(blue_archive)'], copyright: ['blue_archive'] },
        tags: ['1girl', 'hibiki_(cheerleader)_(blue_archive)', 'blue_archive', 'nude']
      };
      assert.strictEqual(arePostsAlbumCompatible(p1, p2), true);
    });

    it('rejects unrelated characters from the same art dump (reproduces post 12428689 vs 12428694)', () => {
      const hibikiPost = {
        author: 'nznesk',
        tagDetails: { character: ['hibiki_(blue_archive)'], copyright: ['blue_archive'] },
        tags: ['1girl', 'solo', 'hibiki_(blue_archive)', 'blue_archive', 'nznesk']
      };
      const shigurePost = {
        author: 'nznesk',
        tagDetails: { character: ['shigure_(blue_archive)'], copyright: ['blue_archive'] },
        tags: ['1boy', '1girl', 'shigure_(blue_archive)', 'blue_archive', 'nznesk']
      };
      assert.strictEqual(arePostsAlbumCompatible(hibikiPost, shigurePost), false);
    });

    it('allows different characters if post has comic or manga tags', () => {
      const page1 = {
        author: 'artist_x',
        tagDetails: { character: ['hibiki_(blue_archive)'], copyright: ['blue_archive'] },
        tags: ['1girl', 'hibiki_(blue_archive)', 'blue_archive', 'comic']
      };
      const page2 = {
        author: 'artist_x',
        tagDetails: { character: ['shigure_(blue_archive)'], copyright: ['blue_archive'] },
        tags: ['1girl', 'shigure_(blue_archive)', 'blue_archive', 'manga']
      };
      assert.strictEqual(arePostsAlbumCompatible(page1, page2), true);
    });

    it('rejects posts from different franchises unless crossover', () => {
      const p1 = {
        author: 'artist_x',
        tagDetails: { copyright: ['blue_archive'] },
        tags: ['1girl', 'blue_archive']
      };
      const p2 = {
        author: 'artist_x',
        tagDetails: { copyright: ['genshin_impact'] },
        tags: ['1girl', 'genshin_impact']
      };
      assert.strictEqual(arePostsAlbumCompatible(p1, p2), false);

      const crossover = { ...p2, tags: ['1girl', 'genshin_impact', 'crossover'] };
      assert.strictEqual(arePostsAlbumCompatible(p1, crossover), true);
    });

    it('rejects posts with different visual authors', () => {
      const p1 = { author: 'artist_a', tags: ['1girl'] };
      const p2 = { author: 'artist_b', tags: ['1girl'] };
      assert.strictEqual(arePostsAlbumCompatible(p1, p2), false);
    });

    it('rejects solo 1girl vs solo 1boy original characters', () => {
      const girl = { author: 'artist_x', tags: ['1girl', 'solo'] };
      const boy = { author: 'artist_x', tags: ['1boy', 'solo'] };
      assert.strictEqual(arePostsAlbumCompatible(girl, boy), false);
    });
  });

  describe('groupPostsIntoAlbums', () => {
    it('keeps unrelated art dump images separate while grouping real variants', () => {
      const hibiki1 = {
        id: '12428689', originalId: 12428689, site: 'danbooru', author: 'nznesk',
        source: 'https://i.pximg.net/img-original/img/2026/10/22/23/46/22/151155637_p0.jpg',
        pixiv_id: 151155637,
        tags: ['1girl', 'solo', 'hibiki_(blue_archive)', 'blue_archive', 'nznesk']
      };
      const hibiki2 = {
        id: '12428690', originalId: 12428690, site: 'danbooru', author: 'nznesk',
        source: 'https://i.pximg.net/img-original/img/2026/10/22/23/46/22/151155637_p1.jpg',
        pixiv_id: 151155637,
        tags: ['1girl', 'nude', 'hibiki_(blue_archive)', 'blue_archive', 'nznesk']
      };
      const shigure = {
        id: '12428694', originalId: 12428694, site: 'danbooru', author: 'nznesk',
        source: 'https://i.pximg.net/img-original/img/2026/10/22/23/46/22/151155637_p2.jpg',
        pixiv_id: 151155637,
        tags: ['1boy', '1girl', 'shigure_(blue_archive)', 'blue_archive', 'nznesk']
      };

      const grouped = groupPostsIntoAlbums([hibiki1, hibiki2, shigure]);
      assert.strictEqual(grouped.length, 2);
      const albumPost = grouped.find(p => p.isAlbum);
      const singlePost = grouped.find(p => !p.isAlbum);

      assert.ok(albumPost);
      assert.strictEqual(albumPost.albumCount, 2);
      assert.ok(albumPost.albumItems.some(i => String(i.id) === '12428689'));
      assert.ok(albumPost.albumItems.some(i => String(i.id) === '12428690'));

      assert.ok(singlePost);
      assert.strictEqual(String(singlePost.id), '12428694');
    });
  });
});
