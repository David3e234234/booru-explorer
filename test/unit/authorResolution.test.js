import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockAgent, restoreDispatcher } from '../unit/parsers/harness.js';
import {
  extractAuthor,
  extractAuthorFromSourceUrl,
  extractPixivArtworkId,
  isNoiseHandle
} from '../../src/utils/tagHelpers.js';
import {
  normalizeBooruTagType,
  TAG_TYPE
} from '../../src/services/booruTagTypeService.js';

// Every case below is a defect observed against a live deployment, not a
// hypothetical. The URLs are real sources taken from real posts whose author
// was reported as missing or plainly wrong.
describe('author extraction from source URLs', () => {
  it('never returns site chrome as an author', () => {
    // Regression: the fanbox regex captured "www" from "www.fanbox.cc".
    assert.equal(extractAuthor([], 'https://www.fanbox.cc/@harechippai/posts/12652589', ''), 'harechippai');
    // Regression: patreon matched the literal "user" path segment.
    assert.equal(extractAuthor([], 'https://www.patreon.com/user?u=12345', ''), 'patreon:12345');
    assert.equal(extractAuthor([], 'https://www.patreon.com/posts/creator-123', ''), '');
    assert.equal(extractAuthor([], 'https://newgrounds.com/portal/view/', ''), '');
  });

  it('resolves Pixiv account routes but not artwork routes', () => {
    assert.equal(extractAuthor([], 'https://www.pixiv.net/users/123456', ''), 'pixiv:123456');
    assert.equal(extractAuthor([], 'https://www.pixiv.net/en/users/123456', ''), 'pixiv:123456');
    assert.equal(extractAuthor([], 'https://www.pixiv.net/member.php?id=999', ''), 'pixiv:999');
    assert.equal(extractAuthor([], 'https://pixiv.me/takamura', ''), 'pixiv:takamura');
    // The canonical modern form names the artwork, not the account.
    assert.equal(extractAuthor([], 'https://www.pixiv.net/artworks/149242414', ''), '');
  });

  it('extracts the artwork id from every Pixiv URL shape', () => {
    assert.equal(extractPixivArtworkId('https://www.pixiv.net/artworks/149242414'), '149242414');
    assert.equal(extractPixivArtworkId('https://i.pximg.net/img-original/img/2026/09/19/19/44/07/149850016_p0.png'), '149850016');
    assert.equal(extractPixivArtworkId('https://example.com/nothing.png'), '');
    assert.equal(extractPixivArtworkId(''), '');
    assert.equal(extractPixivArtworkId(null), '');
  });

  it('supports the art hosts that appear in real posts', () => {
    assert.equal(extractAuthor([], 'https://x.com/haru1bc6c4/status/2104158444647514620', ''), '@haru1bc6c4');
    assert.equal(extractAuthor([], 'https://bsky.app/profile/user.bsky.social', ''), '@user.bsky.social');
    assert.equal(extractAuthor([], 'https://www.deviantart.com/otdushina/art/Fat-beer-1384842913', ''), 'otdushina');
    assert.equal(extractAuthor([], 'http://ororororororz.tumblr.com/post/175881316219', ''), 'ororororororz');
    assert.equal(extractAuthor([], 'https://fantia.jp/fanclubs/1234', ''), 'fantia:1234');
    assert.equal(extractAuthor([], 'https://www.reddit.com/user/someguy', ''), 'reddit:someguy');
    // Art hosts expose no account: reporting nothing beats reporting a guess.
    assert.equal(extractAuthor([], 'https://i.pximg.net/img-original/img/2026/01/31/23/51/15/140611604_p0.png', ''), '');
    assert.equal(extractAuthor([], 'https://gelbooru.com/index.php?page=post&s=view&id=14970448', ''), '');
  });

  it('accepts a bare uploader handle that is not a URL', () => {
    assert.equal(extractAuthor([], 'jinroku', ''), 'jinroku');
    assert.equal(extractAuthor([], 'anonymous', ''), '');
    assert.equal(extractAuthor([], 'tagme', ''), '');
  });

  it('keeps site chrome out of the handle key', () => {
    assert.equal(isNoiseHandle('www'), true);
    assert.equal(isNoiseHandle('user'), true);
    assert.equal(isNoiseHandle('POSTS'), true);
    assert.equal(isNoiseHandle(''), true);
    assert.equal(isNoiseHandle('12345'), true);
    assert.equal(isNoiseHandle('otdushina'), false);
    assert.equal(isNoiseHandle('harechippai'), false);
  });

  it('never doubles the separator in a prefixed handle', () => {
    const r = extractAuthorFromSourceUrl('https://www.pixiv.net/users/123456');
    assert.equal(r.handle, 'pixiv:123456');
    assert.equal(r.handleKey, '123456');
    const t = extractAuthorFromSourceUrl('https://x.com/yozo/status/1');
    assert.equal(t.handle, '@yozo');
  });

  it('survives malformed and non-URL input', () => {
    for (const bad of ['', null, undefined, 'not a url', 'http://', ':::', 12345, {}]) {
      assert.doesNotThrow(() => extractAuthorFromSourceUrl(bad));
    }
    assert.equal(extractAuthorFromSourceUrl('not a url'), null);
    assert.equal(extractAuthorFromSourceUrl(null), null);
  });
});

describe('per-booru tag type normalization', () => {
  it('maps the raw codes each board actually uses', () => {
    // Gelbooru uses 5 for metatags.
    assert.equal(normalizeBooruTagType('gelbooru', 1), TAG_TYPE.ARTIST);
    assert.equal(normalizeBooruTagType('gelbooru', 4), TAG_TYPE.CHARACTER);
    assert.equal(normalizeBooruTagType('gelbooru', 5), TAG_TYPE.META);
    // Rule34 (e621 lineage) uses 5 for "invalid" and 6 for metatags.
    assert.equal(normalizeBooruTagType('rule34', 5), null);
    assert.equal(normalizeBooruTagType('rule34', 6), TAG_TYPE.META);
    assert.equal(normalizeBooruTagType('rule34', 1), TAG_TYPE.ARTIST);
    assert.equal(normalizeBooruTagType('paheal', 6), TAG_TYPE.META);
  });

  it('reports unknown codes as unknown rather than guessing', () => {
    assert.equal(normalizeBooruTagType('rule34', 99), null);
    assert.equal(normalizeBooruTagType('gelbooru', 'abc'), null);
    // A board without its own tag API must not silently borrow another's codes.
    assert.equal(normalizeBooruTagType('danbooru', 1), null);
    assert.equal(normalizeBooruTagType('', 1), null);
  });
});

describe('author classification precision', () => {
  it('does not promote a character tag to author via a source URL', async () => {
    // The global dispatcher must be restored: leaking a MockAgent with
    // disableNetConnect() breaks every later suite that boots the app.
    const { agent, originalDispatcher } = createMockAgent();
    try {
      const { classifyPostTags } = await import('../../src/utils/tagClassifier.js');
      // The DeviantArt slug contains the word "Eula", which the old substring
      // match turned into a Genshin artist.
      const r = await classifyPostTags(
        ['1girl', 'eula_(genshin_impact)', 'large_breasts', 'long_hair', 'nude', 'cowgirl_position'],
        'https://www.deviantart.com/otdushina/art/Fat-beer-Eula-1384842913',
        '', {}
      );
      assert.equal(r.author, 'otdushina');
      assert.ok(r.tagDetails.character.includes('eula_(genshin_impact)'));
      assert.ok(!r.tagDetails.artist.includes('eula_(genshin_impact)'));
    } finally {
      await restoreDispatcher(originalDispatcher, agent);
    }
  });

  it('never treats a meta request tag as an author', async () => {
    const { classifyPostTags } = await import('../../src/utils/tagClassifier.js');
    const r = await classifyPostTags(
      ['1girl', 'tagme', 'solo', 'nude', 'hetero', 'spread_legs'],
      '', '', {}
    );
    assert.notEqual(r.author, 'tagme');
  });

  it('honours an explicit artist marker over the shared dictionary', async () => {
    const { classifyPostTags } = await import('../../src/utils/tagClassifier.js');
    const r = await classifyPostTags(['1girl', 'akimiya_yamiku', 'nude'], '', 'akimiya_yamiku_(artist)', {});
    assert.equal(r.author, 'akimiya_yamiku');
  });

  it('reads the artist category from the board itself', async () => {
    const { agent, originalDispatcher } = createMockAgent();
    try {
      // These are the real tag sets of two Rule34 posts that reported an empty
      // author: the artists are plain tags the shared Konachan dictionary has
      // never heard of, and Rule34 writes them as `character_(creator)`.
      const boardTypes = {
        'sen_(senkuden)': 1,
        'tomatoman_(tomatoman_kk)': 1,
        '1girl': 0,
        'cowgirl_position': 0,
        'highres': 6,
        'tagme': 6
      };
      agent.get('https://api.rule34.xxx')
        .intercept({ path: /page=dapi/, method: 'GET' })
        .reply(200, (opts) => {
          const m = /[?&]name=([^&]*)/.exec(String(opts.path || ''));
          const name = m ? decodeURIComponent(m[1]) : '';
          const type = Object.prototype.hasOwnProperty.call(boardTypes, name) ? boardTypes[name] : 0;
          return `<?xml version="1.0"?><tag type="${type}" count="1" name="${name}" />`;
        })
        .times(200);

      const { classifyPostTags } = await import('../../src/utils/tagClassifier.js');
      const r = await classifyPostTags(
        ['1girl', 'highres', 'sen_(senkuden)', 'tomatoman_(tomatoman_kk)', 'tagme', 'cowgirl_position'],
        '', '', {}, false, 'rule34'
      );
      assert.equal(r.author, 'sen_(senkuden)');
      assert.equal(r.authorSource, 'ground-truth');
      assert.ok(r.tagDetails.artist.includes('tomatoman_(tomatoman_kk)'));
      // Meta tags must stay meta even when the board also calls them tags.
      assert.ok(r.tagDetails.meta.includes('tagme'));
      assert.ok(!r.tagDetails.artist.includes('tagme'));
    } finally {
      await restoreDispatcher(originalDispatcher, agent);
    }
  });
});

