import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockAgent, restoreDispatcher, assertNormalizedPost } from './harness.js';
import { fetchKemono, fetchKemonoPostById, getKemonoAuthHeaders, normalizeKemonoPost } from '../../../src/parsers/kemono.js';
import { clearSiteSessionCache } from '../../../src/services/siteSessionService.js';

test('Kemono Parser Unit Tests', async (t) => {
  let mockContext = null;

  t.beforeEach(() => {
    mockContext = createMockAgent();
    // The session cache is module-level and outlives the mock dispatcher
    clearSiteSessionCache();
  });

  t.afterEach(() => {
    if (mockContext) {
      restoreDispatcher(mockContext.originalDispatcher, mockContext.agent);
    }
  });

  await t.test('fetchKemono returns normalized posts adhering to 14-field contract', async () => {
    const client = mockContext.agent.get('https://kemono.cr');
    client.intercept({
      path: (p) => p.includes('/api/v1/posts'),
      method: 'GET'
    }).reply(200, [
      {
        id: '123456',
        user: '789',
        service: 'patreon',
        title: 'Illustration Set #1',
        content: '<p>Thanks for supporting!</p>',
        tags: ['original', '1girl'],
        published: '2026-02-01T10:00:00Z',
        file: {
          name: 'sample.jpg',
          path: '/data/ab/cd/sample.jpg'
        },
        attachments: []
      }
    ]);

    const posts = await fetchKemono({ tags: 'original', limit: 1 }, [], {});
    assert.equal(posts.length, 1);
    const post = posts[0];
    assertNormalizedPost(post, 'kemono');
    assert.equal(post.rating, 'e');
    assert.ok(post.fileUrl.length > 0);
    assert.ok(post.sampleUrl.length > 0);
    assert.ok(post.previewUrl.length > 0);
    assert.equal(post.thumb180, post.previewUrl);
    assert.equal(post.thumb360, post.previewUrl);
    assert.equal(post.thumb720, post.previewUrl);
    assert.equal(post.thumbSample, post.previewUrl);
    assert.equal(post.thumbOriginal, post.fileUrl);
  });

  await t.test('unknown creator id is not invented as an author', async () => {
    const creatorMap = new Map();
    const post = await normalizeKemonoPost({
      id: '5001',
      user: '918273',
      service: 'patreon',
      title: 'Unlisted creator',
      file: { name: 'art.jpg', path: '/aa/bb/art.jpg' },
      attachments: []
    }, creatorMap, null, [], {});

    assert.ok(post);
    assert.equal(post.author, '');
    assert.deepEqual(post.tagDetails.artist, []);
    assert.ok(!post.tags.some(tag => tag.startsWith('artist:user_')));
  });

  await t.test('video posts share one thumbnail URL across all quality tiers', async () => {
    const creatorMap = new Map([['patreon:789', { id: '789', name: 'TestArtist', service: 'patreon' }]]);
    const post = await normalizeKemonoPost({
      id: '5002',
      user: '789',
      service: 'patreon',
      title: 'Clip',
      file: { name: 'clip.mp4', path: '/aa/bb/clip.mp4' },
      attachments: []
    }, creatorMap, null, [], {});

    assert.ok(post);
    assert.equal(post.isVideo, true);
    assert.ok(post.thumb180.includes('quality=medium'));
    assert.equal(post.thumb180, post.thumb360);
    assert.equal(post.thumb360, post.thumb720);
    assert.equal(post.previewUrl, post.thumb180);
  });

  await t.test('page offset advances by the requested limit', async () => {
    const client = mockContext.agent.get('https://kemono.cr');
    client.intercept({
      path: (p) => p.includes('/api/v1/posts') && p.includes('o=10'),
      method: 'GET'
    }).reply(200, [
      {
        id: '5003',
        user: '789',
        service: 'patreon',
        title: 'Page two',
        file: { name: 'art2.jpg', path: '/aa/bb/art2.jpg' },
        attachments: []
      }
    ]);
    client.intercept({
      path: (p) => p.includes('/api/v1/creators'),
      method: 'GET'
    }).reply(200, [{ id: '789', name: 'TestArtist', service: 'patreon' }]);

    const posts = await fetchKemono({ tags: '', page: 2, limit: 10 }, [], {});
    assert.equal(posts.length, 1);
    assert.equal(posts[0].author, 'TestArtist');
  });

  await t.test('a page larger than the raw API page keeps the offset at the raw page size', async () => {
    const client = mockContext.agent.get('https://kemono.cr');
    client.intercept({
      path: (p) => p.includes('/api/v1/posts') && p.includes('o=50'),
      method: 'GET'
    }).reply(200, [
      {
        id: '5005',
        user: '789',
        service: 'patreon',
        title: 'Raw page two',
        file: { name: 'art4.jpg', path: '/aa/bb/art4.jpg' },
        attachments: []
      }
    ]);
    client.intercept({
      path: (p) => p.includes('/api/v1/creators'),
      method: 'GET'
    }).reply(200, [{ id: '789', name: 'TestArtist', service: 'patreon' }]);

    const posts = await fetchKemono({ tags: '', page: 2, limit: 60 }, [], {});
    assert.equal(posts.length, 1);
    assert.equal(posts[0].originalId, '5005');
  });

  await t.test('a 429 page is retried once instead of returning an empty feed', async () => {
    const client = mockContext.agent.get('https://kemono.cr');
    client.intercept({
      path: (p) => p.includes('/api/v1/posts'),
      method: 'GET'
    }).reply(429, 'Too Many Requests');
    client.intercept({
      path: (p) => p.includes('/api/v1/posts'),
      method: 'GET'
    }).reply(200, [
      {
        id: '5004',
        user: '789',
        service: 'patreon',
        title: 'Recovered',
        file: { name: 'art3.jpg', path: '/aa/bb/art3.jpg' },
        attachments: []
      }
    ]);
    client.intercept({
      path: (p) => p.includes('/api/v1/creators'),
      method: 'GET'
    }).reply(200, [{ id: '789', name: 'TestArtist', service: 'patreon' }]);

    const posts = await fetchKemono({ tags: '', limit: 10, page: 1 }, [], {});
    assert.equal(posts.length, 1);
    assert.equal(posts[0].originalId, '5004');
  });

  await t.test('fetchKemonoPostById resolves single post and attachments', async () => {
    const client = mockContext.agent.get('https://kemono.cr');
    client.intercept({
      path: (p) => p.includes('/api/v1/patreon/user/789/post/123456'),
      method: 'GET'
    }).reply(200, {
      id: '123456',
      user: '789',
      service: 'patreon',
      title: 'Solo Art',
      tags: ['solo'],
      file: {
        name: 'art.png',
        path: '/data/12/34/art.png'
      }
    });
    client.intercept({
      path: (p) => p.includes('/api/v1/patreon/user/789/profile'),
      method: 'GET'
    }).reply(200, {
      id: '789',
      name: 'TestArtist',
      service: 'patreon'
    });

    const post = await fetchKemonoPostById('kemono_patreon_789_123456', [], {});
    assert.ok(post);
    assertNormalizedPost(post, 'kemono');
    assert.equal(post.originalId, '123456');
    assert.equal(post.author, 'TestArtist');
  });

  await t.test('auth headers use the configured session token', async () => {
    // No interceptor is registered: any outbound request would throw, so a
    // resolved header proves the token path performs no network call.
    const headers = await getKemonoAuthHeaders({ kemonoSession: 'pinned-token' });
    assert.equal(headers.Cookie, 'session=pinned-token');
    assert.equal(headers.Accept, 'text/css');
  });

  await t.test('auth headers normalize a pasted session cookie', async () => {
    const headers = await getKemonoAuthHeaders({ kemonoSession: 'theme=dark; session=jar-token; Path=/' });
    assert.equal(headers.Cookie, 'session=jar-token');
  });

  await t.test('auth headers stay empty without any credentials', async () => {
    const headers = await getKemonoAuthHeaders({});
    assert.equal(headers.Cookie, undefined);
  });
});
