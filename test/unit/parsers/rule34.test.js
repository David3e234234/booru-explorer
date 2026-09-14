import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockAgent, restoreDispatcher, assertNormalizedPost } from './harness.js';
import { fetchRule34, fetchRule34PostById } from '../../../src/parsers/rule34.js';

test('Rule34 Parser Unit Tests (including Paheal integration)', async (t) => {
  let mockContext = null;
  const mockSettings = { rule34ApiKey: 'test_api_key', rule34UserId: '98765' };

  t.beforeEach(() => {
    mockContext = createMockAgent();
  });

  t.afterEach(() => {
    if (mockContext) {
      restoreDispatcher(mockContext.originalDispatcher, mockContext.agent);
    }
  });

  await t.test('fetchRule34 returns normalized posts from DAPI JSON', async () => {
    const client = mockContext.agent.get('https://api.rule34.xxx');
    client.intercept({
      path: (p) => p.includes('page=dapi') && p.includes('json=1'),
      method: 'GET'
    }).reply(200, [
      {
        id: 6001,
        directory: '6001',
        image: 'sample.jpg',
        preview_url: 'https://us.rule34.xxx/thumbnails/6001/thumbnail_sample.jpg',
        tags: 'overwatch tracer',
        rating: 'explicit',
        score: 99,
        width: 1920,
        height: 1080
      }
    ]);

    const posts = await fetchRule34({ tags: 'overwatch', limit: 1 }, [], mockSettings);
    assert.equal(posts.length, 1);
    const post = posts[0];
    assertNormalizedPost(post, 'rule34');
    assert.equal(post.rating, 'e');
    assert.equal(post.thumb180, 'https://us.rule34.xxx/thumbnails/6001/thumbnail_sample.jpg');
    assert.equal(post.thumbOriginal, 'https://us.rule34.xxx/images/6001/sample.jpg');
  });

  await t.test('fetchRule34PostById resolves normal Rule34 post from DAPI', async () => {
    const client = mockContext.agent.get('https://api.rule34.xxx');
    client.intercept({
      path: (p) => p.includes('6002'),
      method: 'GET'
    }).reply(200, [
      {
        id: 6002,
        directory: '6002',
        image: 'sample2.jpg',
        tags: 'overwatch mercy',
        rating: 'questionable',
        score: 45
      }
    ]);

    const post = await fetchRule34PostById('6002', [], mockSettings);
    assert.ok(post);
    assertNormalizedPost(post, 'rule34');
    assert.equal(post.originalId, '6002');
    assert.equal(post.rating, 'q');
  });

  await t.test('fetchRule34PostById resolves Paheal post with paheal_ prefix via XML', async () => {
    const pahealClient = mockContext.agent.get('https://rule34.paheal.net');
    const xml = `<?xml version="1.0" encoding="utf-8"?>
      <posts count="1" offset="0">
        <post id="7001" tags="overwatch d.va" score="50" rating="Explicit" file_url="https://r34.paheal.net/_images/7001.jpg" preview_url="https://r34.paheal.net/_thumbs/7001.jpg" />
      </posts>`;
    pahealClient.intercept({
      path: (p) => p.includes('7001'),
      method: 'GET'
    }).reply(200, xml);

    const post = await fetchRule34PostById('paheal_7001', [], {});
    assert.ok(post, 'Paheal post must resolve');
    assertNormalizedPost(post, 'rule34');
    assert.equal(post.id, 'paheal_7001');
    assert.equal(post.originalId, '7001');
    assert.equal(post.rating, 'e');
    assert.equal(post.fileUrl, 'https://r34.paheal.net/_images/7001.jpg');
    assert.equal(post.previewUrl, 'https://r34.paheal.net/_thumbs/7001.jpg');
  });

  await t.test('fetchRule34PostById populates complete post contract on HTML view fallback', async () => {
    // DAPI fails on api.rule34.xxx
    const apiClient = mockContext.agent.get('https://api.rule34.xxx');
    apiClient.intercept({
      path: (p) => p.includes('8001'),
      method: 'GET'
    }).reply(404, 'Not found');

    // HTML view page on rule34.xxx succeeds
    const htmlClient = mockContext.agent.get('https://rule34.xxx');
    const html = `<!DOCTYPE html>
      <html>
        <body>
          <img id="image" src="https://us.rule34.xxx/images/80/8001.jpg" />
          <ul id="tag-sidebar">
            <li class="tag-type-artist"><a href="index.php?page=post&amp;s=list&amp;tags=sakimichan">sakimichan</a></li>
            <li class="tag-type-general"><a href="index.php?page=post&amp;s=list&amp;tags=1girl">1girl</a></li>
          </ul>
          <div>Rating: Explicit</div>
          <div>Score: 150</div>
        </body>
      </html>`;
    htmlClient.intercept({
      path: (p) => p.includes('8001') && p.includes('s=view'),
      method: 'GET'
    }).reply(200, html);

    const post = await fetchRule34PostById('8001', [], mockSettings);
    assert.ok(post, 'HTML fallback post must resolve');
    assertNormalizedPost(post, 'rule34');
    assert.equal(post.originalId, '8001');
    assert.equal(post.rating, 'e');
    assert.equal(post.author, 'sakimichan');
    assert.ok(post.fileUrl.length > 0);
    assert.ok(post.previewUrl.length > 0);
    assert.ok(post.thumb180.length > 0);
  });

  await t.test('fetchRule34PostById populates complete post contract on fallback tags fallback', async () => {
    const apiClient = mockContext.agent.get('https://api.rule34.xxx');
    apiClient.intercept({
      path: (p) => p.includes('9001'),
      method: 'GET'
    }).reply(500, 'Error');

    const htmlClient = mockContext.agent.get('https://rule34.xxx');
    htmlClient.intercept({
      path: (p) => p.includes('9001'),
      method: 'GET'
    }).reply(500, 'Error');

    const post = await fetchRule34PostById('9001', [], mockSettings, ['fallback_artist', 'solo']);
    assert.ok(post, 'Fallback tags post must resolve');
    assertNormalizedPost(post, 'rule34');
    assert.equal(post.originalId, '9001');
    assert.ok(post.tags.includes('fallback_artist'));
  });
});
