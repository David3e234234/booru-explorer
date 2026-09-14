process.env.NODE_ENV = 'test';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../../server.js';
import { flushPendingWrites } from '../../src/services/storageService.js';

describe('Express API Integration & Route Tests', () => {
  let server;
  let baseUrl;
  let authToken = null;
  const testUsername = `testuser_${Date.now()}`;
  const testPassword = 'Password123!';

  before(async () => {
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
      flushPendingWrites();
    } catch {}
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      server.unref();
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

    it('POST /api/cache-clear clears RAM and disk cache', async () => {
      const res = await fetch(`${baseUrl}/api/cache-clear`, { method: 'POST' });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
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

    it('POST /api/auth/logout succeeds', async () => {
      const res = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST' });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
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
  });
});
