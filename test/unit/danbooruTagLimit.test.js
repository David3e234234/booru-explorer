import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockAgent, restoreDispatcher } from './parsers/harness.js';
import { fetchDanbooru } from '../../src/parsers/danbooru.js';
import {
  getDanbooruQueryTagCap,
  isFreeDanbooruMetatag,
  rememberDanbooruTagLimit,
  clearDanbooruTagLimitCache,
  DANBOORU_ANONYMOUS_TAG_LIMIT,
  DANBOORU_MEMBER_TAG_LIMIT
} from '../../src/services/danbooruTagLimitService.js';

const CREDS = { danbooruLogin: 'tester', danbooruApiKey: 'key123' };

// Captures the `tags=` value of every Danbooru request the parser issues
function captureTagQueries(agent) {
  const seen = [];
  agent.get('https://danbooru.donmai.us')
    .intercept({ path: (p) => p.startsWith('/posts.json'), method: 'GET' })
    .reply(200, (opts) => {
      const query = new URL(`https://danbooru.donmai.us${opts.path}`).searchParams.get('tags') || '';
      seen.push(query);
      return [];
    })
    .persist();
  return seen;
}

function paidTokens(query) {
  return query.split(/\s+/).filter(Boolean).filter(t => !isFreeDanbooruMetatag(t));
}

test('Danbooru tag budget', async (t) => {
  let mockContext = null;

  t.beforeEach(() => {
    clearDanbooruTagLimitCache();
    mockContext = createMockAgent();
  });

  t.afterEach(() => {
    if (mockContext) restoreDispatcher(mockContext.originalDispatcher, mockContext.agent);
  });

  await t.test('metatags are free, real tags are not', () => {
    // Verified against the live API: `solo 1girl rating:g` and
    // `solo 1girl score:>100` answer 200, while `solo 1girl order:score`
    // answers 422. `order:` is deliberately absent from UNLIMITED_METATAGS.
    for (const token of ['rating:e', 'score:>100', '-rating:g', 'id:123', 'date:2026-11-11', 'parent:12345', 'favcount:>100']) {
      assert.equal(isFreeDanbooruMetatag(token), true, `${token} must be free`);
    }
    for (const token of ['hatsune_miku', '-guro', 'artist:foo', 'order:score', '1girl']) {
      assert.equal(isFreeDanbooruMetatag(token), false, `${token} must cost a slot`);
    }
  });

  await t.test('anonymous callers spend exactly two tag slots', async () => {
    const seen = captureTagQueries(mockContext.agent);
    await fetchDanbooru({ tags: 'hatsune_miku 1girl solo', limit: 5 }, [], { deepFetchPages: 1, bypassDiscoveredAliases: true });

    assert.ok(seen.length > 0, 'parser must call the API');
    assert.deepEqual(paidTokens(seen[0]), ['hatsune_miku', '1girl']);
  });

  await t.test('a member budget carries three tags and rating stays free', async () => {
    rememberDanbooruTagLimit(CREDS.danbooruLogin, DANBOORU_MEMBER_TAG_LIMIT);
    const seen = captureTagQueries(mockContext.agent);
    await fetchDanbooru(
      { tags: 'hatsune_miku 1girl solo', limit: 5, ratingFilter: 'sfw' },
      [],
      { ...CREDS, deepFetchPages: 1, bypassDiscoveredAliases: true }
    );

    assert.ok(seen.length > 0);
    assert.deepEqual(paidTokens(seen[0]), ['hatsune_miku', '1girl', 'solo']);
    assert.ok(seen[0].includes('rating:g'), 'rating must still reach the API');
  });

  await t.test('a Gold account is not capped at three tags', async () => {
    rememberDanbooruTagLimit(CREDS.danbooruLogin, null);
    assert.equal(getDanbooruQueryTagCap(CREDS), Number.POSITIVE_INFINITY);

    const seen = captureTagQueries(mockContext.agent);
    await fetchDanbooru(
      { tags: 'hatsune_miku 1girl solo smile outdoors', limit: 5 },
      [],
      { ...CREDS, deepFetchPages: 1, bypassDiscoveredAliases: true }
    );

    assert.ok(seen.length > 0);
    assert.deepEqual(paidTokens(seen[0]), ['hatsune_miku', '1girl', 'solo', 'smile', 'outdoors']);
  });

  await t.test('credentials with an unknown level default to the member budget', () => {
    clearDanbooruTagLimitCache();
    assert.equal(getDanbooruQueryTagCap({}), DANBOORU_ANONYMOUS_TAG_LIMIT);
    assert.equal(getDanbooruQueryTagCap(CREDS), DANBOORU_MEMBER_TAG_LIMIT);
  });

  await t.test('a custom sort string cannot steal slots from user tags', async () => {
    rememberDanbooruTagLimit(CREDS.danbooruLogin, DANBOORU_MEMBER_TAG_LIMIT);
    const seen = captureTagQueries(mockContext.agent);
    await fetchDanbooru(
      { tags: 'hatsune_miku 1girl solo', limit: 5, category: 'top' },
      [],
      {
        ...CREDS,
        deepFetchPages: 1,
        bypassDiscoveredAliases: true,
        siteSortTags: { danbooru: { top: 'order:score hatsune_miku extra_sort_tag' } }
      }
    );

    assert.ok(seen.length > 0);
    const paid = paidTokens(seen[0]);
    assert.equal(paid.length, 3, 'the three user tags must survive');
    assert.deepEqual(paid, ['hatsune_miku', '1girl', 'solo']);
  });
});
