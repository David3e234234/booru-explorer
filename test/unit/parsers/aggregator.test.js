import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockAgent, restoreDispatcher, assertNormalizedPost } from './harness.js';
import { fetchPosts, fetchSingleSiteBatch, fetchTbib } from '../../../src/parsers/index.js';

test('Aggregator Unit Tests', async (t) => {
  let mockContext = null;

  t.beforeEach(() => {
    mockContext = createMockAgent();
  });

  t.afterEach(() => {
    if (mockContext) {
      restoreDispatcher(mockContext.originalDispatcher, mockContext.agent);
    }
  });

  await t.test('fetchSingleSiteBatch handles danbooru and returns normalized posts', async () => {
    const client = mockContext.agent.get('https://danbooru.donmai.us');
    client.intercept({
      path: (p) => p.includes('/posts.json'),
      method: 'GET'
    }).reply(200, [
      {
        id: 111,
        created_at: '2024-01-01T00:00:00.000Z',
        tag_string: 'cat ears solo',
        tag_string_artist: 'artist1',
        rating: 'g',
        score: 15,
        file_url: 'https://danbooru.donmai.us/data/original1.jpg',
        file_ext: 'jpg',
        media_asset: {
          variants: [
            { type: '180x180', url: 'https://danbooru.donmai.us/data/180_1.jpg' },
            { type: '360x360', url: 'https://danbooru.donmai.us/data/360_1.jpg' },
            { type: '720x720', url: 'https://danbooru.donmai.us/data/720_1.jpg' }
          ]
        }
      }
    ]);

    const posts = await fetchSingleSiteBatch('danbooru', { tags: 'solo', limit: 10 }, [], {});
    assert.equal(posts.length, 1);
    const post = posts[0];
    assertNormalizedPost(post, 'danbooru');
    assert.equal(post.id, 'danbooru_111');
    assert.equal(post.rating, 'g');
  });

  await t.test('fetchSingleSiteBatch returns empty array for unknown site', async () => {
    const posts = await fetchSingleSiteBatch('nonexistent_booru', { tags: 'test' }, [], {});
    assert.deepEqual(posts, []);
  });

  await t.test('fetchSingleSiteBatch dispatches to tbib parser', async () => {
    const client = mockContext.agent.get('https://tbib.org');
    client.intercept({
      path: (p) => p.includes('index.php'),
      method: 'GET'
    }).reply(200, [
      {
        id: 555,
        image: 'cat.jpg',
        directory: '123',
        tags: 'cat solo',
        rating: 'safe',
        score: 2
      }
    ]);

    const posts = await fetchSingleSiteBatch('tbib', { tags: 'solo', limit: 10 }, [], {});
    assert.equal(posts.length, 1);
    const post = posts[0];
    assertNormalizedPost(post, 'tbib');
    assert.equal(post.id, 'tbib_555');
  });

  await t.test('fetchPosts aggregates multiple sites in all-sites mode with round-robin', async () => {
    // Danbooru mock
    const danbooruClient = mockContext.agent.get('https://danbooru.donmai.us');
    danbooruClient.intercept({
      path: (p) => p.includes('/posts.json'),
      method: 'GET'
    }).reply(200, [
      {
        id: 10,
        tag_string: 'cute solo',
        rating: 'g',
        file_url: 'https://danbooru.donmai.us/data/10.jpg',
        file_ext: 'jpg',
        media_asset: { variants: [{ type: '180x180', url: 'https://danbooru.donmai.us/10_180.jpg' }] }
      }
    ]);

    // Safebooru mock
    const safebooruClient = mockContext.agent.get('https://safebooru.org');
    safebooruClient.intercept({
      path: (p) => p.includes('index.php'),
      method: 'GET'
    }).reply(200, [
      {
        id: 20,
        image: '20.jpg',
        directory: '20',
        tags: 'cute solo',
        rating: 'safe'
      }
    ]);

    const combined = await fetchPosts('custom', {
      customSites: 'danbooru,safebooru',
      tags: 'cute',
      limit: 10
    }, [], {});

    assert.ok(Array.isArray(combined));
    assert.equal(combined.length, 2);
    const sites = combined.map(p => p.site);
    assert.ok(sites.includes('danbooru'));
    assert.ok(sites.includes('safebooru'));
    combined.forEach(p => assertNormalizedPost(p));
  });

  await t.test('fetchPosts single-site deep fetch applies filter criteria', async () => {
    const safebooruClient = mockContext.agent.get('https://safebooru.org');
    safebooruClient.intercept({
      path: (p) => p.includes('index.php'),
      method: 'GET'
    }).reply(200, [
      {
        id: 101,
        image: 'cat.jpg',
        directory: '101',
        tags: 'cat solo cute',
        rating: 'safe'
      },
      {
        id: 102,
        image: 'dog.jpg',
        directory: '102',
        tags: 'dog solo ugly',
        rating: 'safe'
      }
    ]);

    // Negative tag "-dog" should exclude post 102
    const filtered = await fetchPosts('safebooru', {
      tags: 'solo -dog',
      limit: 10
    }, [], {});

    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, 'safebooru_101');
    assert.ok(!filtered.some(p => p.id === 'safebooru_102'));
  });

  await t.test('fetchPosts falls back to the default depth for a non-numeric deepFetchPages', async () => {
    const safebooruClient = mockContext.agent.get('https://safebooru.org');
    safebooruClient.intercept({
      path: (p) => p.includes('index.php'),
      method: 'GET'
    }).reply(200, [
      {
        id: 201,
        image: 'cat.jpg',
        directory: '201',
        tags: 'cat solo cute',
        rating: 'safe'
      }
    ]).persist();

    // "abc" parsed to NaN, which turned the deep-fetch loop bound into NaN and
    // discarded every fetched post (strict filter forces the deep-fetch path)
    for (const depth of ['abc', 'auto', 0, -3]) {
      const posts = await fetchPosts('safebooru', {
        tags: 'solo',
        limit: 10,
        aiFilter: 'no-ai'
      }, [], { deepFetchPages: depth });

      assert.equal(posts.length, 1, `deepFetchPages=${JSON.stringify(depth)} must fall back to the default`);
      assert.equal(posts[0].id, 'safebooru_201');
    }

    // Valid numeric values keep working, as numbers and as strings
    for (const depth of [3, '3']) {
      const posts = await fetchPosts('safebooru', {
        tags: 'solo',
        limit: 10,
        aiFilter: 'no-ai'
      }, [], { deepFetchPages: depth });

      assert.equal(posts.length, 1, `deepFetchPages=${JSON.stringify(depth)} must stay valid`);
    }
  });
});
