import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockAgent, restoreDispatcher, assertNormalizedPost } from './harness.js';
import { fetchMoebooru, fetchMoebooruPostById } from '../../../src/parsers/moebooru.js';

test('Moebooru Parser Unit Tests (Yande.re & Konachan)', async (t) => {
  let mockContext = null;

  t.beforeEach(() => {
    mockContext = createMockAgent();
  });

  t.afterEach(() => {
    if (mockContext) {
      restoreDispatcher(mockContext.originalDispatcher, mockContext.agent);
    }
  });

  await t.test('fetchMoebooru returns normalized 14-field posts for Yande.re', async () => {
    const client = mockContext.agent.get('https://yande.re');
    client.intercept({
      path: (p) => p.includes('/post.json'),
      method: 'GET'
    }).reply(200, [
      {
        id: 4001,
        tags: 'rem_re_zero blue_hair maid',
        rating: 's',
        score: 88,
        file_url: 'https://files.yande.re/image/4001/file.jpg',
        sample_url: 'https://files.yande.re/sample/4001/sample.jpg',
        preview_url: 'https://files.yande.re/preview/4001/preview.jpg',
        width: 1920,
        height: 1080
      }
    ]);

    const posts = await fetchMoebooru('yandere', 'https://yande.re', 'Yande.re', { tags: 'rem_re_zero', limit: 1 }, [], {});
    assert.equal(posts.length, 1);
    const post = posts[0];
    assertNormalizedPost(post, 'yandere');
    assert.equal(post.siteName, 'Yande.re');
    assert.equal(post.rating, 's');
    assert.equal(post.thumb180, 'https://files.yande.re/preview/4001/preview.jpg');
    assert.equal(post.thumb360, 'https://files.yande.re/preview/4001/preview.jpg');
    assert.equal(post.thumb720, 'https://files.yande.re/sample/4001/sample.jpg');
  });

  await t.test('fetchMoebooru returns normalized 14-field posts for Konachan', async () => {
    const client = mockContext.agent.get('https://konachan.com');
    client.intercept({
      path: (p) => p.includes('/post.json'),
      method: 'GET'
    }).reply(200, [
      {
        id: 5001,
        tags: 'original 1girl flowers',
        rating: 'q',
        score: 35,
        file_url: 'https://konachan.com/image/5001/file.png',
        sample_url: 'https://konachan.com/sample/5001/sample.jpg',
        preview_url: 'https://konachan.com/preview/5001/preview.jpg'
      }
    ]);

    const posts = await fetchMoebooru('konachan', 'https://konachan.com', 'Konachan', { tags: 'original', limit: 1 }, [], {});
    assert.equal(posts.length, 1);
    const post = posts[0];
    assertNormalizedPost(post, 'konachan');
    assert.equal(post.siteName, 'Konachan');
    assert.equal(post.rating, 'q');
  });

  await t.test('fetchMoebooruPostById resolves post from DAPI JSON', async () => {
    const client = mockContext.agent.get('https://yande.re');
    client.intercept({
      path: (p) => p.includes('/post.json') && p.includes('4002'),
      method: 'GET'
    }).reply(200, [
      {
        id: 4002,
        tags: 'genshin_impact furina',
        rating: 'e',
        score: 120,
        file_url: 'https://files.yande.re/image/4002/file.jpg',
        sample_url: 'https://files.yande.re/sample/4002/sample.jpg',
        preview_url: 'https://files.yande.re/preview/4002/preview.jpg'
      }
    ]);

    const post = await fetchMoebooruPostById('yandere', 'https://yande.re', 'Yande.re', '4002', [], {});
    assert.ok(post);
    assertNormalizedPost(post, 'yandere');
    assert.equal(post.originalId, '4002');
    assert.equal(post.rating, 'e');
  });

  await t.test('fetchMoebooruPostById extracts media URLs from HTML scraping when DAPI fails', async () => {
    const client = mockContext.agent.get('https://yande.re');
    // DAPI fails
    client.intercept({
      path: (p) => p.includes('/post.json') && p.includes('tags=id:4003'),
      method: 'GET'
    }).reply(500, 'Server Error');

    // HTML view page succeeds
    const html = `<!DOCTYPE html>
      <html>
        <body>
          <img id="image" class="image" src="https://files.yande.re/sample/4003/sample.jpg" />
          <a id="highres" class="original-file-unchanged" href="https://files.yande.re/image/4003/original.png">Download</a>
          <ul id="tag-sidebar">
            <li class="tag-type-artist"><a href="/post?tags=artist_name">artist_name</a></li>
            <li class="tag-type-general"><a href="/post?tags=solo">solo</a></li>
          </ul>
          <div>Rating: Questionable</div>
          <div>Score: 65</div>
        </body>
      </html>`;
    client.intercept({
      path: '/post/show/4003',
      method: 'GET'
    }).reply(200, html);

    const post = await fetchMoebooruPostById('yandere', 'https://yande.re', 'Yande.re', '4003', [], {});
    assert.ok(post, 'Post should resolve from HTML fallback');
    assertNormalizedPost(post, 'yandere');
    assert.equal(post.originalId, '4003');
    assert.equal(post.fileUrl, 'https://files.yande.re/image/4003/original.png');
    assert.equal(post.sampleUrl, 'https://files.yande.re/sample/4003/sample.jpg');
    assert.ok(post.previewUrl.length > 0);
    assert.equal(post.rating, 'q');
  });

  await t.test('fetchMoebooru handles missing media fields and passes 14-field contract', async () => {
    const client = mockContext.agent.get('https://yande.re');
    client.intercept({
      path: (p) => p.includes('/post.json') && p.includes('nomedia'),
      method: 'GET'
    }).reply(200, [
      { id: 4005, tags: 'solo', rating: 's', score: 10 }
    ]);

    const posts = await fetchMoebooru('yandere', 'https://yande.re', 'Yande.re', { tags: 'nomedia', limit: 1 }, [], {});
    assert.equal(posts.length, 1);
    assertNormalizedPost(posts[0], 'yandere');
    assert.equal(typeof posts[0].fileUrl, 'string');
    assert.equal(typeof posts[0].sampleUrl, 'string');
    assert.equal(posts[0].fileUrl, '');
    assert.equal(posts[0].sampleUrl, '');
  });

  await t.test('fetchMoebooru ignores null elements in API array without throwing', async () => {
    const client = mockContext.agent.get('https://yande.re');
    client.intercept({
      path: (p) => p.includes('/post.json') && p.includes('nulltest'),
      method: 'GET'
    }).reply(200, [
      null,
      { id: 4006, tags: 'solo', rating: 's', score: 10, file_url: 'https://files.yande.re/image/4006/f.jpg' },
      null
    ]);

    const posts = await fetchMoebooru('yandere', 'https://yande.re', 'Yande.re', { tags: 'nulltest', limit: 5 }, [], {});
    assert.equal(posts.length, 1);
    assert.equal(posts[0].originalId, '4006');
  });
});
