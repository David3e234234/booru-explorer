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

  await t.test('auth headers prefer a pinned session over stored credentials', async () => {
    // No login interceptor is registered: reaching the login route at all would throw.
    const headers = await getKemonoAuthHeaders({
      kemonoSession: 'pinned-token',
      kemonoLogin: 'user',
      kemonoPassword: 'pass'
    });
    assert.equal(headers.Cookie, 'session=pinned-token');
    assert.equal(headers.Accept, 'text/css');
  });

  await t.test('auth headers exchange credentials for a session', async () => {
    mockContext.agent.get('https://kemono.cr')
      .intercept({ path: '/api/v1/authentication/login', method: 'POST' })
      .reply(200, { username: 'tester' }, { headers: { 'set-cookie': 'session=issued-token; Path=/' } });

    const headers = await getKemonoAuthHeaders({ kemonoLogin: 'tester', kemonoPassword: 'secret' });
    assert.equal(headers.Cookie, 'session=issued-token');
  });

  await t.test('auth headers stay empty without any credentials', async () => {
    const headers = await getKemonoAuthHeaders({});
    assert.equal(headers.Cookie, undefined);
  });
});
