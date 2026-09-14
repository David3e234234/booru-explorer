import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockAgent, restoreDispatcher, assertNormalizedPost } from './harness.js';
import { fetchDanbooru, fetchDanbooruPostById } from '../../../src/parsers/danbooru.js';

test('Danbooru Parser Unit Tests', async (t) => {
  let mockContext = null;

  t.beforeEach(() => {
    mockContext = createMockAgent();
  });

  t.afterEach(() => {
    if (mockContext) {
      restoreDispatcher(mockContext.originalDispatcher, mockContext.agent);
    }
  });

  await t.test('fetchDanbooru returns normalized posts satisfying 14-field contract', async () => {
    const client = mockContext.agent.get('https://danbooru.donmai.us');
    client.intercept({
      path: (path) => path.startsWith('/posts.json'),
      method: 'GET'
    }).reply(200, [
      {
        id: 1001,
        tag_string: 'hatsune_miku 1girl vocaloid',
        rating: 'g',
        score: 42,
        file_url: 'https://cdn.donmai.us/original/1001.jpg',
        large_file_url: 'https://cdn.donmai.us/sample/1001.jpg',
        preview_file_url: 'https://cdn.donmai.us/preview/1001.jpg',
        media_asset: {
          variants: [
            { type: '180x180', url: 'https://cdn.donmai.us/180/1001.jpg' },
            { type: '360x360', url: 'https://cdn.donmai.us/360/1001.jpg' },
            { type: '720x720', url: 'https://cdn.donmai.us/720/1001.jpg' },
            { type: 'sample', url: 'https://cdn.donmai.us/sample/1001.jpg' },
            { type: 'original', url: 'https://cdn.donmai.us/original/1001.jpg' }
          ]
        },
        image_width: 1920,
        image_height: 1080,
        created_at: '2026-01-01T00:00:00Z'
      }
    ]);

    const posts = await fetchDanbooru({ tags: 'hatsune_miku', limit: 1 }, [], {});
    assert.equal(posts.length, 1);
    const post = posts[0];
    assertNormalizedPost(post, 'danbooru');
    assert.equal(post.rating, 'g');
    assert.equal(post.thumb180, 'https://cdn.donmai.us/180/1001.jpg');
    assert.equal(post.thumb360, 'https://cdn.donmai.us/360/1001.jpg');
    assert.equal(post.thumb720, 'https://cdn.donmai.us/720/1001.jpg');
    assert.equal(post.isVideo, false);
    assert.equal(post.hasSound, false);
  });

  await t.test('fetchDanbooru applies thumb cascade fallback when variants are missing', async () => {
    const client = mockContext.agent.get('https://danbooru.donmai.us');
    client.intercept({
      path: (path) => path.startsWith('/posts.json'),
      method: 'GET'
    }).reply(200, [
      {
        id: 1002,
        tag_string: 'scenery solo',
        rating: 's',
        score: 10,
        file_url: 'https://cdn.donmai.us/original/1002.png',
        large_file_url: 'https://cdn.donmai.us/sample/1002.jpg',
        preview_file_url: 'https://cdn.donmai.us/preview/1002.jpg',
        media_asset: null
      }
    ]);

    const posts = await fetchDanbooru({ tags: 'scenery', limit: 1 }, [], {});
    assert.equal(posts.length, 1);
    const post = posts[0];
    assertNormalizedPost(post, 'danbooru');
    assert.equal(post.rating, 's');
    assert.equal(post.thumb180, 'https://cdn.donmai.us/preview/1002.jpg');
    assert.equal(post.thumb360, 'https://cdn.donmai.us/sample/1002.jpg');
    assert.equal(post.thumb720, 'https://cdn.donmai.us/sample/1002.jpg');
  });

  await t.test('fetchDanbooru cursor continues past filtered posts without premature termination', async () => {
    const client = mockContext.agent.get('https://danbooru.donmai.us');
    
    // Page 1 returns a full page of 25 items all containing blocked_tag
    const page1 = Array.from({ length: 25 }, (_, i) => ({
      id: 2000 - i,
      tag_string: 'blocked_tag bad_content',
      rating: 'q',
      file_url: `https://cdn.donmai.us/original/${2000 - i}.jpg`,
      media_asset: null
    }));

    client.intercept({
      path: (path) => path.startsWith('/posts.json') && !path.includes('page=b1976'),
      method: 'GET'
    }).reply(200, page1);

    // Page 2 cursor returns clean post
    client.intercept({
      path: (path) => path.startsWith('/posts.json') && path.includes('page=b1976'),
      method: 'GET'
    }).reply(200, [
      {
        id: 1950,
        tag_string: 'test good_tag clean_content',
        rating: 'g',
        file_url: 'https://cdn.donmai.us/original/1950.jpg',
        media_asset: null
      }
    ]);

    const posts = await fetchDanbooru({ tags: 'test', limit: 1 }, [], { blacklist: ['blocked_tag'] });
    assert.equal(posts.length, 1);
    assert.equal(posts[0].originalId, '1950');
    assertNormalizedPost(posts[0], 'danbooru');
  });

  await t.test('fetchDanbooruPostById resolves post and populates 14 mandatory fields', async () => {
    const client = mockContext.agent.get('https://danbooru.donmai.us');
    client.intercept({
      path: '/posts/5555.json',
      method: 'GET'
    }).reply(200, {
      id: 5555,
      tag_string: 'artist:bkub comic 1girl',
      tag_string_artist: 'bkub',
      rating: 'e',
      score: 123,
      file_url: 'https://cdn.donmai.us/original/5555.webm',
      preview_file_url: 'https://cdn.donmai.us/preview/5555.jpg',
      media_asset: {
        variants: [
          { type: '180x180', url: 'https://cdn.donmai.us/180/5555.jpg' },
          { type: '360x360', url: 'https://cdn.donmai.us/360/5555.jpg' },
          { type: '720x720', url: 'https://cdn.donmai.us/720/5555.jpg' }
        ]
      }
    });

    const post = await fetchDanbooruPostById('5555', [], {});
    assert.ok(post);
    assertNormalizedPost(post, 'danbooru');
    assert.equal(post.rating, 'e');
    assert.equal(post.isVideo, true);
  });

  await t.test('fetchDanbooru safely ignores null, undefined, and non-object elements in API payload', async () => {
    const client = mockContext.agent.get('https://danbooru.donmai.us');
    client.intercept({
      path: (path) => path.startsWith('/posts.json'),
      method: 'GET'
    }).reply(200, [
      null,
      undefined,
      'primitive_string',
      42,
      {
        id: 1003,
        tag_string: 'safe_tag solo',
        rating: 'g',
        score: 25,
        file_url: 'https://cdn.donmai.us/original/1003.jpg',
        media_asset: {
          variants: [{ type: '180x180', url: 'https://cdn.donmai.us/180/1003.jpg' }]
        }
      },
      null
    ]);

    const posts = await fetchDanbooru({ tags: 'safe_tag', limit: 10 }, [], {});
    assert.equal(posts.length, 1);
    assert.equal(posts[0].originalId, '1003');
    assertNormalizedPost(posts[0], 'danbooru');
  });

  await t.test('fetchDanbooru cursor continues safely when cursor page contains null items', async () => {
    const client = mockContext.agent.get('https://danbooru.donmai.us');
    
    client.intercept({
      path: (path) => path.startsWith('/posts.json') && !path.includes('page=b'),
      method: 'GET'
    }).reply(200, [
      null,
      {
        id: 2005,
        tag_string: 'blocked_tag',
        rating: 'q',
        file_url: 'https://cdn.donmai.us/original/2005.jpg'
      },
      null
    ]);

    client.intercept({
      path: (path) => path.startsWith('/posts.json') && path.includes('page=b2005'),
      method: 'GET'
    }).reply(200, [
      {
        id: 2004,
        tag_string: 'clean_tag',
        rating: 'g',
        file_url: 'https://cdn.donmai.us/original/2004.jpg',
        media_asset: null
      }
    ]);

    const posts = await fetchDanbooru({ tags: 'clean_tag', limit: 1 }, [], { blacklist: ['blocked_tag'] });
    assert.equal(posts.length, 1);
    assert.equal(posts[0].originalId, '2004');
  });

  await t.test('fetchDanbooruPostById safely returns null for null or non-object response', async () => {
    const client = mockContext.agent.get('https://danbooru.donmai.us');
    client.intercept({
      path: '/posts/9999.json',
      method: 'GET'
    }).reply(200, null);

    const post = await fetchDanbooruPostById('9999', [], {});
    assert.equal(post, null);
  });
});
