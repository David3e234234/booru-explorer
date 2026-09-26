process.env.NODE_ENV = 'test';

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

const ownsDataDir = !process.env.BOORU_DATA_DIR;
const testDataDir = ownsDataDir
  ? await fs.mkdtemp(path.join(os.tmpdir(), 'booru-explorer-integration-'))
  : process.env.BOORU_DATA_DIR;
if (ownsDataDir) process.env.BOORU_DATA_DIR = testDataDir;

let app;
let flushPendingWrites;

describe('Express API Integration & Route Tests', () => {
  let server;
  let baseUrl;
  let authToken = null;
  const testUsername = `testuser_${Date.now()}`;
  const testPassword = 'Password123!';

  before(async () => {
    const serverModule = await import('../../server.js');
    const storageModule = await import('../../src/services/storageService.js');
    app = serverModule.default;
    flushPendingWrites = storageModule.flushPendingWrites;
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    try {
      await flushPendingWrites();
    } catch {}
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      server.unref();
    }
    if (ownsDataDir) {
      await fs.rm(testDataDir, { recursive: true, force: true });
    }
  });

  describe('System & Info Routes', () => {
    it('GET /api/cache-info returns valid directory stats and cache size', async () => {
      const res = await fetch(`${baseUrl}/api/cache-info`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.thumbsCount !== undefined);
      assert.ok(data.diskCacheMB !== undefined);
    });

    it('GET /api/version returns version from package.json', async () => {
      const res = await fetch(`${baseUrl}/api/version`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(typeof data.version === 'string' && data.version.length > 0);
    });

    it('POST /api/cache-clear rejects anonymous callers (destructive server-side op)', async () => {
      const res = await fetch(`${baseUrl}/api/cache-clear`, { method: 'POST' });
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.success, false);
    });

    it('GET /non-existent SPA fallback serves index.html or 404 for API', async () => {
      const apiRes = await fetch(`${baseUrl}/api/non-existent-endpoint-12345`);
      assert.strictEqual(apiRes.status, 404);
      const apiData = await apiRes.json();
      assert.strictEqual(apiData.error, 'Endpoint not found');

      const spaRes = await fetch(`${baseUrl}/random-page-route`);
      assert.strictEqual(spaRes.status, 200);
    });
  });

  describe('Board auth test (/api/sites/auth-test)', () => {
    // Regression: runAuthTest() is token-only now, but its success branch still
    // interpolated a `username` local that the credential exchange used to
    // define. The ReferenceError was thrown at runtime only, so nothing caught
    // it until an operator pressed the button and saw
    // "Ошибка: username is not defined". These cases exercise the branches the
    // unit suites cannot reach: they need the assembled Express app.
    const callAuthTest = (payload) => fetch(`${baseUrl}/api/sites/auth-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then((res) => res.json());

    it('demands a session token when neither field is provided', async () => {
      const data = await callAuthTest({ site: 'kemono' });
      assert.strictEqual(data.success, false);
      assert.match(data.message, /Введите Session Token Kemono/);
    });

    it('no longer accepts a login and password', async () => {
      const data = await callAuthTest({ site: 'kemono', login: 'user', password: 'secret' });
      assert.strictEqual(data.success, false);
      assert.match(data.message, /Введите Session Token Kemono/);
      assert.doesNotMatch(data.message, /пароль/i);
    });

    it('reports a rejected token without a ReferenceError', async () => {
      // The upstream is unreachable from CI, so this lands on the network or
      // HTTP failure branch. Either way the route must answer with a message
      // instead of leaking a variable error to the operator.
      const data = await callAuthTest({ site: 'pawchive', session: 'definitely-not-valid' });
      assert.strictEqual(data.success, false);
      assert.ok(data.message, 'expected a human-readable message');
      assert.doesNotMatch(data.message, /is not defined/);
    });

    it('keeps the route free of removed credential fields', async () => {
      const source = await fs.readFile(
        new URL('../../src/routes/posts.routes.js', import.meta.url),
        'utf8'
      );
      // Guards the whole class of bug: a value the route can no longer produce
      // must not be referenced inside the board branch.
      const boardBranch = source.slice(source.indexOf("site === 'pawchive'"), source.indexOf('runAuthTest', source.indexOf("site === 'pawchive'") + 1) + 400);
      assert.doesNotMatch(boardBranch, /\$\{\s*username\s*\}/);
    });
  });

  describe('Auth Routes (/api/auth)', () => {
    it('POST /api/auth/register successfully registers a new user', async () => {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: testUsername, password: testPassword })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.token);
      assert.strictEqual(data.user.username, testUsername);
      authToken = data.token;
    });

    it('POST /api/auth/login logs in with valid credentials', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: testUsername, password: testPassword })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.token);
    });

    it('POST /api/auth/login fails with invalid credentials', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: testUsername, password: 'wrongpassword' })
      });
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.success, false);
    });

    it('GET /api/auth/me returns profile for authenticated user and 401 for anonymous', async () => {
      const unauthRes = await fetch(`${baseUrl}/api/auth/me`);
      assert.strictEqual(unauthRes.status, 401);

      const authRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      assert.strictEqual(authRes.status, 200);
      const authData = await authRes.json();
      assert.strictEqual(authData.success, true);
      assert.strictEqual(authData.user.username, testUsername);
    });

    it('account export never contains a reusable password verifier', async () => {
      const res = await fetch(`${baseUrl}/api/auth/export`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.account.username, testUsername);
      assert.strictEqual(data.account.passwordHash, undefined);
      assert.strictEqual(data.account.salt, undefined);

      const restoreRes = await fetch(`${baseUrl}/api/auth/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: data.account })
      });
      assert.strictEqual(restoreRes.status, 400);
    });

    it('POST /api/auth/logout revokes the issued token', async () => {
      const res = await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);

      const revokedRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      assert.strictEqual(revokedRes.status, 401);

      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: testUsername, password: testPassword })
      });
      const loginData = await loginRes.json();
      assert.strictEqual(loginData.success, true);
      authToken = loginData.token;
    });
  });

  describe('Settings Routes (/api/settings)', () => {
    it('GET /api/settings strips secrets for unauthenticated requests', async () => {
      const res = await fetch(`${baseUrl}/api/settings`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.settings.telegramBotToken, undefined);
    });

    it('POST /api/settings updates settings and returns sanitized payload', async () => {
      const res = await fetch(`${baseUrl}/api/settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ postsPerPage: 35, theme: 'dark' })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.settings.postsPerPage, 35);
    });
  });

  describe('Cache Management (/api/cache-clear)', () => {
    it('POST /api/cache-clear is rejected without owner rights', async () => {
      const res = await fetch(`${baseUrl}/api/cache-clear`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      assert.strictEqual(res.status, 403);
    });

    it('POST /api/cache-clear clears RAM and disk cache for the operator token', async () => {
      const previousToken = process.env.BOORU_ADMIN_TOKEN;
      process.env.BOORU_ADMIN_TOKEN = 'integration-admin-token';
      try {
        const res = await fetch(`${baseUrl}/api/cache-clear`, {
          method: 'POST',
          headers: { 'x-booru-admin-token': 'integration-admin-token' }
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
      } finally {
        if (previousToken === undefined) delete process.env.BOORU_ADMIN_TOKEN;
        else process.env.BOORU_ADMIN_TOKEN = previousToken;
      }
    });
  });

  describe('User Data & Sanitization Routes (/api/favorites, /api/likes, /api/dislikes)', () => {
    const heavyPost = {
      id: 'danbooru_999999',
      originalId: '999999',
      site: 'danbooru',
      fileUrl: 'https://example.com/large.jpg',
      previewUrl: 'https://example.com/thumb.jpg',
      tags: ['1girl', 'test'],
      rating: 'g',
      albumItems: [{ hugeData: 'bloat'.repeat(500) }],
      allSeriesKeys: ['danbooru_1', 'danbooru_2'],
      _archiveUnpacked: true
    };

    it('POST /api/favorites adds post and sanitizes heavy fields', async () => {
      const res = await fetch(`${baseUrl}/api/favorites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(heavyPost)
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.isFavorite, true);

      // Verify sanitized post in GET /api/favorites
      const getRes = await fetch(`${baseUrl}/api/favorites`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const getData = await getRes.json();
      assert.strictEqual(getData.success, true);
      const saved = getData.favorites.find(f => f.id === heavyPost.id);
      assert.ok(saved);
      assert.strictEqual(saved.albumItems, undefined, 'albumItems must be stripped');
      assert.strictEqual(saved.allSeriesKeys, undefined, 'allSeriesKeys must be stripped');
      assert.strictEqual(saved._archiveUnpacked, undefined, '_archiveUnpacked must be stripped');
    });

    it('POST /api/favorites toggles off when sent again', async () => {
      const res = await fetch(`${baseUrl}/api/favorites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(heavyPost)
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.strictEqual(data.isFavorite, false);
    });

    it('POST /api/like adds and toggles likes with post sanitization', async () => {
      const likeRes = await fetch(`${baseUrl}/api/like`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(heavyPost)
      });
      assert.strictEqual(likeRes.status, 200);
      const likeData = await likeRes.json();
      assert.strictEqual(likeData.success, true);
      assert.strictEqual(likeData.isLiked, true);

      const getLikesRes = await fetch(`${baseUrl}/api/likes`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const getLikesData = await getLikesRes.json();
      assert.strictEqual(getLikesData.success, true);
      const savedLike = getLikesData.likes.find(l => l.id === heavyPost.id);
      assert.ok(savedLike);
      assert.strictEqual(savedLike.albumItems, undefined);
    });

    it('POST /api/dislike adds and clears dislikes', async () => {
      const dislikeRes = await fetch(`${baseUrl}/api/dislike`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(heavyPost)
      });
      assert.strictEqual(dislikeRes.status, 200);
      const dislikeData = await dislikeRes.json();
      assert.strictEqual(dislikeData.success, true);
      assert.strictEqual(dislikeData.isDisliked, true);

      const clearRes = await fetch(`${baseUrl}/api/dislikes/clear`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      assert.strictEqual(clearRes.status, 200);
      const clearData = await clearRes.json();
      assert.strictEqual(clearData.success, true);
      assert.strictEqual(clearData.dislikes.length, 0);
    });

    it('POST /api/favorites/sync rejects oversized batches with 400 (F-38)', async () => {
      const oversized = new Array(5001).fill({ id: 'test_1' });
      const syncRes = await fetch(`${baseUrl}/api/favorites/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ favorites: oversized })
      });
      assert.strictEqual(syncRes.status, 400);
      const data = await syncRes.json();
      assert.strictEqual(data.success, false);
    });

    it('Favorite Authors: add, preview update, and delete', async () => {
      const addRes = await fetch(`${baseUrl}/api/favorite-authors`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ name: 'artist_test', displayName: 'Artist Test', site: 'danbooru' })
      });
      assert.strictEqual(addRes.status, 200);
      const addData = await addRes.json();
      assert.strictEqual(addData.success, true);
      assert.strictEqual(addData.isFavorite, true);

      // Preview update
      const previewRes = await fetch(`${baseUrl}/api/favorite-authors/preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ name: 'artist_test', previewUrl: 'https://cdn.example.com/artist.jpg' })
      });
      assert.strictEqual(previewRes.status, 200);
      const previewData = await previewRes.json();
      assert.strictEqual(previewData.success, true);
      assert.strictEqual(previewData.author.previewUrl, 'https://cdn.example.com/artist.jpg');

      // Delete
      const delRes = await fetch(`${baseUrl}/api/favorite-authors/artist_test`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      assert.strictEqual(delRes.status, 200);
      const delData = await delRes.json();
      assert.strictEqual(delData.success, true);
    });
  });

  describe('Media & Resolve Video Routes (/api/media, /api/resolve-video)', () => {
    it('GET /api/proxy without url returns 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/proxy`);
      assert.strictEqual(res.status, 400);
    });

    it('GET /api/resolve-video for non-matching returns success: false', async () => {
      const res = await fetch(`${baseUrl}/api/resolve-video?url=https://example.com/image.jpg`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, false);
    });

    // The client decides between a retry affordance and a silent fallback by this
    // reason, so an unsupported target must not look like a throttled request.
    it('GET /api/resolve-video reports why it could not resolve', async () => {
      const res = await fetch(`${baseUrl}/api/resolve-video?url=https://example.com/image.jpg`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.reason, 'unsupported_target');
    });
  });

  describe('Tag Autocomplete Routes (/api/tags/autocomplete)', () => {
    it('GET /api/tags/autocomplete returns empty array for empty query', async () => {
      const res = await fetch(`${baseUrl}/api/tags/autocomplete?q=`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.deepStrictEqual(data, { tags: [] });
    });

    it('GET /api/tags/autocomplete normalizes repeated query values and malformed auth', async () => {
      const res = await fetch(`${baseUrl}/api/tags/autocomplete?q=test&q=other&site=unknown`, {
        headers: { 'x-booru-auth': 'null' }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.ok(Array.isArray(data.tags));
    });
  });
});

