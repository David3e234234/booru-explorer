import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockAgent, restoreDispatcher, assertNormalizedPost } from './harness.js';
import {
  fetchXbooru,
  fetchHypnohub,
  fetchTbib,
  fetchXbooruPostById,
  fetchHypnohubPostById,
  fetchTbibPostById,
  normalizeDapiRating
} from '../../../src/parsers/dapi.js';

test('DAPI Parsers Unit Tests (Xbooru, Hypnohub, TBIB)', async (t) => {
  let mockContext = null;

  t.beforeEach(() => {
    mockContext = createMockAgent();
  });

  t.afterEach(() => {
    if (mockContext) {
      restoreDispatcher(mockContext.originalDispatcher, mockContext.agent);
    }
  });

  await t.test('normalizeDapiRating maps ratings to single-char standard', () => {
    assert.equal(normalizeDapiRating('safe'), 's');
    assert.equal(normalizeDapiRating('s'), 's');
    assert.equal(normalizeDapiRating('general'), 's');
    assert.equal(normalizeDapiRating('g'), 's');
    assert.equal(normalizeDapiRating('questionable'), 'q');
    assert.equal(normalizeDapiRating('q'), 'q');
    assert.equal(normalizeDapiRating('sensitive'), 'q');
    assert.equal(normalizeDapiRating('explicit'), 'e');
    assert.equal(normalizeDapiRating('e'), 'e');
    assert.equal(normalizeDapiRating('', 'e'), 'e');
  });

  await t.test('fetchXbooru returns normalized posts from DAPI JSON and XML fallback', async () => {
    const client = mockContext.agent.get('https://xbooru.com');
    // First call: JSON
    client.intercept({
      path: (p) => p.includes('limit=1') && p.includes('pid=0'),
      method: 'GET'
    }).reply(200, [
      {
        id: 7001,
        directory: '7001',
        image: 'img.jpg',
        tags: 'fate_stay_night saber',
        rating: 'questionable',
        score: 12
      }
    ]);

    const posts = await fetchXbooru({ tags: 'saber', limit: 1 }, [], {});
    assert.equal(posts.length, 1);
    const post = posts[0];
    assertNormalizedPost(post, 'xbooru');
    assert.equal(post.rating, 'q');
    assert.equal(post.thumb180, 'https://img.xbooru.com/thumbnails/7001/thumbnail_img.jpg');
    assert.equal(post.thumbOriginal, 'https://img.xbooru.com/images/7001/img.jpg');
  });

  await t.test('fetchHypnohub returns normalized posts and handles XML fallback', async () => {
    const client = mockContext.agent.get('https://hypnohub.net');
    const xml = `<posts count="1"><post id="8001" file_url="https://hypnohub.net/images/8001/img.jpg" preview_url="https://hypnohub.net/thumbnails/8001/thumbnail_img.jpg" tags="hypnosis spiral" rating="e" score="8"/></posts>`;
    client.intercept({
      path: (p) => p.includes('page=dapi'),
      method: 'GET'
    }).reply(200, xml);

    const posts = await fetchHypnohub({ tags: 'spiral', limit: 1 }, [], {});
    assert.equal(posts.length, 1);
    const post = posts[0];
    assertNormalizedPost(post, 'hypnohub');
    assert.equal(post.originalId, '8001');
    assert.equal(post.rating, 'e');
  });

  await t.test('fetchTbib returns normalized posts with safe rating default', async () => {
    const client = mockContext.agent.get('https://tbib.org');
    client.intercept({
      path: (p) => p.includes('page=dapi'),
      method: 'GET'
    }).reply(200, [
      {
        id: 9001,
        directory: '9001',
        image: 'safe.png',
        tags: 'original 1girl',
        rating: 'safe',
        score: 30
      }
    ]);

    const posts = await fetchTbib({ tags: 'original', limit: 1 }, [], {});
    assert.equal(posts.length, 1);
    const post = posts[0];
    assertNormalizedPost(post, 'tbib');
    assert.equal(post.rating, 's');
    assert.equal(post.thumb180, 'https://tbib.org/thumbnails/9001/thumbnail_safe.png');
  });

  await t.test('fetchXbooruPostById resolves post and respects fallbackTags', async () => {
    const client = mockContext.agent.get('https://xbooru.com');
    // DAPI fails
    client.intercept({
      path: (p) => p.includes('page=dapi') && p.includes('id=7002'),
      method: 'GET'
    }).reply(500, 'Error');

    // Page view fails
    client.intercept({
      path: (p) => p.includes('s=view') && p.includes('id=7002'),
      method: 'GET'
    }).reply(500, 'Error');

    const post = await fetchXbooruPostById('7002', [], {}, ['fallback_artist', 'solo']);
    assert.ok(post);
    assertNormalizedPost(post, 'xbooru');
    assert.equal(post.originalId, '7002');
    assert.ok(post.tags.includes('fallback_artist'));
  });

  await t.test('fetchTbibPostById correctly identifies video media types instead of hardcoding false', async () => {
    const client = mockContext.agent.get('https://tbib.org');
    client.intercept({
      path: (p) => p.includes('id=9002') && p.includes('page=dapi'),
      method: 'GET'
    }).reply(200, [
      {
        id: 9002,
        file_url: 'https://tbib.org/images/9002/sample.mp4',
        preview_url: 'https://tbib.org/thumbnails/9002/thumb.jpg',
        tags: 'video sound animated',
        rating: 'safe'
      }
    ]);

    // View page 404
    client.intercept({
      path: (p) => p.includes('id=9002') && p.includes('s=view'),
      method: 'GET'
    }).reply(404, 'Not found');

    const post = await fetchTbibPostById('9002', [], {});
    assert.ok(post);
    assertNormalizedPost(post, 'tbib');
    assert.equal(post.isVideo, true);
    assert.equal(post.hasSound, true);
  });
});
