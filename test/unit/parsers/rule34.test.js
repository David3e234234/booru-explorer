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

  await t.test('fetchRule34 keeps healthy posts when one DAPI item is malformed', async () => {
    const client = mockContext.agent.get('https://api.rule34.xxx');
    client.intercept({
      path: (p) => p.includes('page=dapi') && p.includes('json=1') && p.includes('brokentest'),
      method: 'GET'
    }).reply(200, [
      { id: 6101, directory: '6101', image: 'ok.jpg', tags: 'overwatch tracer', rating: 'explicit', score: 10 },
      { id: 6102, directory: '6102', image: 'bad.jpg', tags: 'overwatch tracer', rating: 'explicit', score: 10, preview_url: 12345 }
    ]);

    const posts = await fetchRule34({ tags: 'brokentest', limit: 2 }, [], mockSettings);
    assert.equal(posts.length, 1);
    assertNormalizedPost(posts[0], 'rule34');
    assert.equal(posts[0].originalId, '6101');
  });

  await t.test('fetchRule34 does NOT auto-switch to Paheal when Rule34.xxx fails', async () => {
    // DAPI fails
    const apiClient = mockContext.agent.get('https://api.rule34.xxx');
    apiClient.intercept({
      path: () => true,
      method: 'GET'
    }).reply(500, 'Server Error');

    // HTML fallback fails
    const htmlClient = mockContext.agent.get('https://rule34.xxx');
    htmlClient.intercept({
      path: () => true,
      method: 'GET'
    }).reply(500, 'Server Error');

    // Paheal must NOT be called
    let pahealCalled = false;
    const pahealClient = mockContext.agent.get('https://rule34.paheal.net');
    pahealClient.intercept({
      path: () => true,
      method: 'GET'
    }).reply(200, () => {
      pahealCalled = true;
      return '<posts></posts>';
    });

    const posts = await fetchRule34({ tags: 'overwatch', limit: 10 }, [], { rule34Provider: 'rule34xxx', ...mockSettings });
    assert.equal(posts.length, 0);
    assert.equal(pahealCalled, false, 'Paheal must not be called when provider is rule34xxx');
  });

  await t.test('fetchRule34 queries Paheal directly when rule34Provider is paheal', async () => {
    const pahealClient = mockContext.agent.get('https://rule34.paheal.net');
    const xml = `<?xml version="1.0" encoding="utf-8"?>
      <posts count="1" offset="0">
        <post id="7101" tags="overwatch mercy" score="80" rating="Explicit" file_url="https://r34.paheal.net/_images/7101.jpg" preview_url="https://r34.paheal.net/_thumbs/7101.jpg" />
      </posts>`;
    pahealClient.intercept({
      path: (p) => p.includes('tags=overwatch'),
      method: 'GET'
    }).reply(200, xml);

    const posts = await fetchRule34({ tags: 'overwatch', limit: 10 }, [], { rule34Provider: 'paheal' });
    assert.equal(posts.length, 1);
    assert.equal(posts[0].id, 'paheal_7101');
    assert.equal(posts[0].site, 'rule34');
    assert.equal(posts[0].siteName, 'Rule34');
  });

  await t.test('fetchRule34 medium tier uses preview when DAPI has no sample_url', async () => {
    // Without a distinct sample the medium tier must stay on the small
    // thumbnail instead of aliasing the multi-MB original
    const client = mockContext.agent.get('https://api.rule34.xxx');
    client.intercept({
      path: (p) => p.includes('page=dapi') && p.includes('json=1'),
      method: 'GET'
    }).reply(200, [
      {
        id: 6201,
        directory: '6201',
        image: 'pic.jpg',
        preview_url: 'https://us.rule34.xxx/thumbnails/6201/thumbnail_pic.jpg',
        tags: 'touhou solo',
        rating: 'explicit',
        score: 5
      }
    ]);

    const posts = await fetchRule34({ tags: 'touhou', limit: 1 }, [], mockSettings);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].thumb180, 'https://us.rule34.xxx/thumbnails/6201/thumbnail_pic.jpg');
    assert.equal(posts[0].thumb360, 'https://us.rule34.xxx/thumbnails/6201/thumbnail_pic.jpg');
    assert.equal(posts[0].thumb720, 'https://us.rule34.xxx/images/6201/pic.jpg');
    assert.equal(posts[0].thumbOriginal, 'https://us.rule34.xxx/images/6201/pic.jpg');
  });

  await t.test('fetchRule34 paheal medium tier uses preview thumbnail, not full file', async () => {
    const pahealClient = mockContext.agent.get('https://rule34.paheal.net');
    const xml = `<?xml version="1.0" encoding="utf-8"?>
      <posts count="1" offset="0">
        <post id="7102" tags="touhou solo" score="10" rating="Explicit" file_url="https://r34.paheal.net/_images/7102.jpg" preview_url="https://r34.paheal.net/_thumbs/7102.jpg" />
      </posts>`;
    pahealClient.intercept({
      path: (p) => p.includes('tags=touhou'),
      method: 'GET'
    }).reply(200, xml);

    const posts = await fetchRule34({ tags: 'touhou', limit: 10 }, [], { rule34Provider: 'paheal' });
    assert.equal(posts.length, 1);
    assert.equal(posts[0].thumb180, 'https://r34.paheal.net/_thumbs/7102.jpg');
    assert.equal(posts[0].thumb360, 'https://r34.paheal.net/_thumbs/7102.jpg');
    assert.equal(posts[0].thumb720, 'https://r34.paheal.net/_images/7102.jpg');
  });

  await t.test('fetchRule34 returns empty without HTML fallback on definitive empty DAPI', async () => {
    // An empty DAPI page means "no posts", not "request failed": the slow HTML
    // feed must not fire. The mocked HTML page below would parse into a post,
    // so a non-empty result proves the fallback ran.
    const apiClient = mockContext.agent.get('https://api.rule34.xxx');
    apiClient.intercept({
      path: (p) => p.includes('page=dapi'),
      method: 'GET'
    }).reply(200, []);
    const htmlClient = mockContext.agent.get('https://rule34.xxx');
    htmlClient.intercept({
      path: (p) => p.includes('s=list'),
      method: 'GET'
    }).reply(200, `<span class="thumb" id="s7777"><a href="/index.php?page=post&s=view&id=7777"><img src="https://api-cdn.rule34.xxx/thumbnails/7777/thumbnail_abcdef.jpg" title="touhou solo score:5 rating:explicit"></a></span>`);

    const posts = await fetchRule34({ tags: 'zzzznoresults', limit: 10 }, [], mockSettings);
    assert.equal(posts.length, 0);
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
