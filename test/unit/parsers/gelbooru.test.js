import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockAgent, restoreDispatcher, assertNormalizedPost } from './harness.js';
import { fetchGelbooru, fetchGelbooruPostById, normalizeGelbooruRating, parseDapiXmlPosts } from '../../../src/parsers/gelbooru.js';

test('Gelbooru Parser Unit Tests', async (t) => {
  let mockContext = null;
  const mockSettings = { gelbooruApiKey: 'test_key', gelbooruUserId: '12345' };

  t.beforeEach(() => {
    mockContext = createMockAgent();
  });

  t.afterEach(() => {
    if (mockContext) {
      restoreDispatcher(mockContext.originalDispatcher, mockContext.agent);
    }
  });

  await t.test('normalizeGelbooruRating properly maps all Gelbooru rating tiers', () => {
    assert.equal(normalizeGelbooruRating('general'), 'g');
    assert.equal(normalizeGelbooruRating('g'), 'g');
    assert.equal(normalizeGelbooruRating('safe'), 'g');
    assert.equal(normalizeGelbooruRating('sensitive'), 's');
    assert.equal(normalizeGelbooruRating('s'), 's');
    assert.equal(normalizeGelbooruRating('questionable'), 'q');
    assert.equal(normalizeGelbooruRating('q'), 'q');
    assert.equal(normalizeGelbooruRating('explicit'), 'e');
    assert.equal(normalizeGelbooruRating('e'), 'e');
    assert.equal(normalizeGelbooruRating(''), 'g');
    assert.equal(normalizeGelbooruRating(null), 'g');
    assert.equal(normalizeGelbooruRating('unknown'), 'g');
    assert.equal(normalizeGelbooruRating('123'), 'g');
    assert.equal(normalizeGelbooruRating('none'), 'g');
    assert.equal(normalizeGelbooruRating('pending'), 'g');
    assert.equal(normalizeGelbooruRating('other'), 'g');
  });

  await t.test('parseDapiXmlPosts parses XML posts with attributes', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <posts count="1" offset="0">
        <post id="777" file_url="https://img3.gelbooru.com/images/ab/cd/777.jpg" preview_url="https://img3.gelbooru.com/thumbnails/ab/cd/thumbnail_777.jpg" sample_url="https://img3.gelbooru.com/samples/ab/cd/sample_777.jpg" tags="hatsune_miku 1girl" rating="general" score="99" width="1280" height="720"/>
      </posts>`;
    const posts = parseDapiXmlPosts(xml);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].id, '777');
    assert.equal(posts[0].rating, 'general');
    assert.equal(posts[0].file_url, 'https://img3.gelbooru.com/images/ab/cd/777.jpg');
  });

  await t.test('fetchGelbooru parses JSON API and outputs normalized 14-field posts', async () => {
    const client = mockContext.agent.get('https://gelbooru.com');
    client.intercept({
      path: (p) => p.includes('page=dapi') && p.includes('json=1'),
      method: 'GET'
    }).reply(200, {
      post: [
        {
          id: 101,
          file_url: 'https://img3.gelbooru.com/images/12/34/101.jpg',
          preview_url: 'https://img3.gelbooru.com/thumbnails/12/34/thumbnail_101.jpg',
          sample_url: 'https://img3.gelbooru.com/samples/12/34/sample_101.jpg',
          tags: 'touhou reimu_hakurei',
          rating: 'sensitive',
          score: 15,
          width: 800,
          height: 600,
          created_at: '2026-01-01 12:00:00'
        }
      ]
    });

    const posts = await fetchGelbooru({ tags: 'touhou', limit: 1 }, [], mockSettings);
    assert.equal(posts.length, 1);
    const post = posts[0];
    assertNormalizedPost(post, 'gelbooru');
    assert.equal(post.rating, 's'); // sensitive maps to 's'
    assert.equal(post.thumb180, 'https://img3.gelbooru.com/thumbnails/12/34/thumbnail_101.jpg');
    assert.equal(post.thumb360, 'https://img3.gelbooru.com/samples/12/34/sample_101.jpg');
    assert.equal(post.thumb720, 'https://img3.gelbooru.com/samples/12/34/sample_101.jpg');
  });

  await t.test('fetchGelbooru falls back to XML when JSON is unavailable', async () => {
    const client = mockContext.agent.get('https://gelbooru.com');
    const xml = `<posts count="1"><post id="102" file_url="https://img3.gelbooru.com/images/12/34/102.jpg" preview_url="https://img3.gelbooru.com/thumbnails/12/34/thumbnail_102.jpg" sample_url="https://img3.gelbooru.com/samples/12/34/sample_102.jpg" tags="touhou marisa_kirisame" rating="general" score="20"/></posts>`;
    client.intercept({
      path: (p) => p.includes('page=dapi'),
      method: 'GET'
    }).reply(200, xml);

    const posts = await fetchGelbooru({ tags: 'touhou', limit: 1 }, [], mockSettings);
    assert.equal(posts.length, 1);
    const post = posts[0];
    assertNormalizedPost(post, 'gelbooru');
    assert.equal(post.originalId, '102');
    assert.equal(post.rating, 'g');
  });

  await t.test('fetchGelbooru keeps healthy posts when one DAPI item is malformed', async () => {
    // The malformed item used to reject the whole page and push the parser into the
    // HTML fallback, losing every valid post of the batch
    const client = mockContext.agent.get('https://gelbooru.com');
    client.intercept({
      path: (p) => p.includes('page=dapi'),
      method: 'GET'
    }).reply(200, [
      { id: 201, image: '201.jpg', directory: '201', tags: 'touhou marisa', rating: 'general', score: 10, file_url: 'https://img3.gelbooru.com/images/201/201.jpg' },
      { id: 202, image: '202.jpg', directory: '202', tags: 'touhou marisa', rating: 'general', score: 10, file_url: 'https://img3.gelbooru.com/images/202/202.jpg', preview_url: 12345 }
    ]);

    const posts = await fetchGelbooru({ tags: 'touhou', limit: 2 }, [], mockSettings);
    assert.equal(posts.length, 1);
    assertNormalizedPost(posts[0], 'gelbooru');
    assert.equal(posts[0].originalId, '201');
  });

  await t.test('fetchGelbooruPostById parses DAPI XML fallback and normalizes post', async () => {
    const client = mockContext.agent.get('https://gelbooru.com');
    const xml = `<posts count="1"><post id="8888" file_url="https://img3.gelbooru.com/images/ab/cd/8888.jpg" preview_url="https://img3.gelbooru.com/thumbnails/ab/cd/thumbnail_8888.jpg" sample_url="https://img3.gelbooru.com/samples/ab/cd/sample_8888.jpg" tags="solo 1girl" rating="questionable" score="55"/></posts>`;
    client.intercept({
      path: (p) => p.includes('page=dapi') && p.includes('id=8888'),
      method: 'GET'
    }).reply(200, xml);

    const post = await fetchGelbooruPostById('8888', [], mockSettings);
    assert.ok(post);
    assertNormalizedPost(post, 'gelbooru');
    assert.equal(post.originalId, '8888');
    assert.equal(post.rating, 'q');
  });

  await t.test('fetchGelbooruPostById resolves post from HTML view page when DAPI fails', async () => {
    const client = mockContext.agent.get('https://gelbooru.com');
    // DAPI fails with 404
    client.intercept({
      path: (p) => p.includes('id=9999') && p.includes('page=dapi'),
      method: 'GET'
    }).reply(404, 'Not found');

    // HTML view page succeeds
    const html = `<!DOCTYPE html>
      <html>
        <body>
          <img id="image" src="https://img3.gelbooru.com/images/ee/ff/9999.jpg" />
          <ul id="tag-list">
            <li class="tag-type-artist"><a href="index.php?page=post&amp;s=list&amp;tags=artist_name">artist_name</a></li>
            <li class="tag-type-general"><a href="index.php?page=post&amp;s=list&amp;tags=solo">solo</a></li>
          </ul>
          <div>Rating: Questionable</div>
          <div>Score: 77</div>
        </body>
      </html>`;
    client.intercept({
      path: (p) => p.includes('id=9999') && p.includes('s=view'),
      method: 'GET'
    }).reply(200, html);

    const post = await fetchGelbooruPostById('9999', [], mockSettings);
    assert.ok(post);
    assertNormalizedPost(post, 'gelbooru');
    assert.equal(post.originalId, '9999');
    assert.equal(post.rating, 'q');
    assert.equal(post.author, 'artist_name');
  });

  await t.test('fetchGelbooruPostById returns null when post has no media in HTML page', async () => {
    const client = mockContext.agent.get('https://gelbooru.com');
    client.intercept({
      path: (p) => p.includes('id=999999') && p.includes('page=dapi'),
      method: 'GET'
    }).reply(404, 'Not found');

    client.intercept({
      path: (p) => p.includes('id=999999') && p.includes('s=view'),
      method: 'GET'
    }).reply(200, '<html><head><title>Post Deleted</title></head><body>This post does not exist.</body></html>');

    const post = await fetchGelbooruPostById('999999', [], mockSettings);
    assert.equal(post, null);
  });
});
