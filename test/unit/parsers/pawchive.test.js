import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockAgent, restoreDispatcher, assertNormalizedPost } from './harness.js';
import { fetchPawchive, fetchPawchivePostById, getPawchiveAuthHeaders } from '../../../src/parsers/pawchive.js';
import { clearSiteSessionCache } from '../../../src/services/siteSessionService.js';

test('Pawchive Parser Unit Tests', async (t) => {
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

  await t.test('fetchPawchive returns normalized posts adhering to 14-field contract', async () => {
    const client = mockContext.agent.get('https://pawchive.pw');
    client.intercept({
      path: (p) => p.includes('/api/v1/posts'),
      method: 'GET'
    }).reply(200, [
      {
        id: '2001',
        user: 'artguy',
        service: 'patreon',
        title: 'Illustration #1',
        content: 'Enjoy the art',
        tags: ['illustration', 'canine'],
        file: {
          name: 'hero.png',
          path: '/ab/cd/hero.png'
        },
        attachments: []
      }
    ]);

    client.intercept({
      path: (p) => p.includes('/api/v1/creators'),
      method: 'GET'
    }).reply(200, [
      {
        id: 'artguy',
        name: 'Art Guy',
        service: 'patreon'
      }
    ]);

    const posts = await fetchPawchive({ tags: '', limit: 10, page: 1 }, [], {});
    assert.equal(posts.length, 1);
    const post = posts[0];
    assertNormalizedPost(post, 'pawchive');
    assert.equal(post.rating, 'e');
    assert.equal(post.id, 'pawchive_2001');
    assert.ok(post.fileUrl.includes('file.pawchive.pw/data/ab/cd/hero.png'));
    assert.ok(post.sampleUrl.includes('img.pawchive.pw/thumbnail/data/ab/cd/hero.png'));
    assert.ok(post.previewUrl.includes('img.pawchive.pw/thumbnail/data/ab/cd/hero.png'));
    assert.equal(post.thumb180, post.previewUrl);
    assert.equal(post.thumb360, post.previewUrl);
    assert.equal(post.thumb720, post.previewUrl);
    assert.equal(post.thumbSample, post.previewUrl);
    assert.equal(post.thumbOriginal, post.fileUrl);
    assert.equal(post.author, 'Art Guy');
  });

  await t.test('fetchPawchive returns empty array on sfw filter', async () => {
    const posts = await fetchPawchive({ tags: '', limit: 10, page: 1, ratingFilter: 'sfw' }, [], {});
    assert.deepEqual(posts, []);
  });

  await t.test('video posts share one thumbnail URL across all quality tiers', async () => {
    const client = mockContext.agent.get('https://pawchive.pw');
    client.intercept({
      path: (p) => p.includes('/api/v1/posts'),
      method: 'GET'
    }).reply(200, [
      {
        id: '3001',
        user: 'animator',
        service: 'fanbox',
        title: 'Tea Party 4K',
        content: 'Clip',
        file: {
          name: 'TeaPartyVik4K_H.265.mp4',
          path: '/ff/a5/TeaPartyVik4K_H.265.mp4'
        },
        attachments: []
      }
    ]);

    client.intercept({
      path: (p) => p.includes('/api/v1/creators'),
      method: 'GET'
    }).reply(200, [
      { id: 'animator', name: 'Animator', service: 'fanbox' }
    ]);

    const posts = await fetchPawchive({ tags: '', limit: 10, page: 1 }, [], {});
    assert.equal(posts.length, 1);
    const post = posts[0];
    assert.equal(post.isVideo, true);
    // Each tier used to request its own quality, forcing three full-file
    // downloads per video; all tiers must now point at one medium request.
    assert.ok(post.thumb180.startsWith('/api/video-thumbnail?'));
    assert.ok(post.thumb180.includes('quality=medium'));
    assert.equal(post.thumb180, post.thumb360);
    assert.equal(post.thumb360, post.thumb720);
    assert.equal(post.previewUrl, post.thumb180);
  });

  await t.test('fetchPawchivePostById resolves single post and creator profile', async () => {
    const client = mockContext.agent.get('https://pawchive.pw');
    client.intercept({
      path: (p) => p.includes('/api/v1/patreon/user/artguy/post/2001'),
      method: 'GET'
    }).reply(200, {
      id: '2001',
      user: 'artguy',
      service: 'patreon',
      title: 'Solo Art',
      tags: ['solo'],
      file: {
        name: 'art.png',
        path: '/data/ab/cd/art.png'
      },
      attachments: []
    });

    client.intercept({
      path: (p) => p.includes('/api/v1/patreon/user/artguy/profile'),
      method: 'GET'
    }).reply(200, {
      id: 'artguy',
      name: 'Art Guy',
      service: 'patreon'
    });

    const post = await fetchPawchivePostById('pawchive_patreon_artguy_2001', [], {});
    assert.ok(post);
    assertNormalizedPost(post, 'pawchive');
    assert.equal(post.originalId, '2001');
    assert.equal(post.author, 'Art Guy');
  });

  await t.test('fetchPawchive handles archive-only posts', async () => {
    const client = mockContext.agent.get('https://pawchive.pw');
    client.intercept({
      path: (p) => p.includes('/api/v1/patreon/user/artguy/post/9999'),
      method: 'GET'
    }).reply(200, {
      id: '9999',
      user: 'artguy',
      service: 'patreon',
      title: 'Pack PSD',
      tags: ['psd_pack'],
      file: {},
      attachments: [
        {
          name: 'project.zip',
          path: '/zips/project.zip',
          size: 1048576
        }
      ]
    });

    const post = await fetchPawchivePostById({ postId: '9999', service: 'patreon', user: 'artguy' }, [], {});
    assert.ok(post);
    assert.equal(post.id, 'pawchive_9999');
    assert.equal(post.isArchive, true);
    assert.equal(post.fileExt, 'zip');
    assert.ok(post.archiveUrls.length > 0);
  });

  await t.test('auth headers use the configured session token', async () => {
    // No interceptor is registered: any outbound request would throw, so a
    // resolved header proves the token path performs no network call.
    const headers = await getPawchiveAuthHeaders({ pawchiveSession: 'pinned-token' });
    assert.equal(headers.Cookie, 'session=pinned-token');
  });

  await t.test('auth headers normalize a pasted session cookie', async () => {
    const headers = await getPawchiveAuthHeaders({ pawchiveSession: 'session=jar-token; Path=/; HttpOnly' });
    assert.equal(headers.Cookie, 'session=jar-token');
  });

  await t.test('a blank token yields no cookie header', async () => {
    const headers = await getPawchiveAuthHeaders({ pawchiveSession: '   ' });
    assert.equal(headers.Cookie, undefined);
  });
});
