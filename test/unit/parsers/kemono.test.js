import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockAgent, restoreDispatcher, assertNormalizedPost } from './harness.js';
import { fetchKemono, fetchKemonoPostById, getKemonoAuthHeaders } from '../../../src/parsers/kemono.js';
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
    assert.ok(post.thumb180.length > 0);
    assert.ok(post.thumb360.length > 0);
    assert.ok(post.thumb720.length > 0);
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
