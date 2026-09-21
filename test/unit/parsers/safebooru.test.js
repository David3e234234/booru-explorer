import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockAgent, restoreDispatcher, assertNormalizedPost } from './harness.js';
import { fetchSafebooru, fetchSafebooruPostById } from '../../../src/parsers/safebooru.js';

test('Safebooru Parser Unit Tests', async (t) => {
  let mockContext = null;

  t.beforeEach(() => {
    mockContext = createMockAgent();
  });

  t.afterEach(() => {
    if (mockContext) {
      restoreDispatcher(mockContext.originalDispatcher, mockContext.agent);
    }
  });

  await t.test('fetchSafebooru returns normalized posts with strict rating "s" and thumb tiers', async () => {
    const client = mockContext.agent.get('https://safebooru.org');
    client.intercept({
      path: (p) => p.includes('page=dapi') && p.includes('json=1'),
      method: 'GET'
    }).reply(200, [
      {
        id: 3001,
        directory: 'sample_dir',
        image: 'img_3001.jpg',
        tags: 'landscape scenery nature',
        rating: 'safe',
        score: 50,
        width: 1920,
        height: 1080
      }
    ]);

    const posts = await fetchSafebooru({ tags: 'landscape', limit: 1 }, [], {});
    assert.equal(posts.length, 1);
    const post = posts[0];
    assertNormalizedPost(post, 'safebooru');
    assert.equal(post.rating, 's');
    assert.equal(post.thumb180, 'https://safebooru.org/thumbnails/sample_dir/thumbnail_img_3001.jpg');
    assert.equal(post.thumb360, 'https://safebooru.org/images/sample_dir/img_3001.jpg');
    assert.equal(post.thumb720, 'https://safebooru.org/images/sample_dir/img_3001.jpg');
    assert.equal(post.thumbOriginal, 'https://safebooru.org/images/sample_dir/img_3001.jpg');
  });

  await t.test('fetchSafebooru falls back to XML parsing when JSON is unavailable', async () => {
    const client = mockContext.agent.get('https://safebooru.org');
    const xml = `<posts count="1"><post id="3002" file_url="https://safebooru.org/images/dir2/3002.png" preview_url="https://safebooru.org/thumbnails/dir2/thumbnail_3002.jpg" sample_url="https://safebooru.org/images/dir2/3002.png" tags="cat animal" rating="s" score="10"/></posts>`;
    client.intercept({
      path: (p) => p.includes('page=dapi'),
      method: 'GET'
    }).reply(200, xml);

    const posts = await fetchSafebooru({ tags: 'cat', limit: 1 }, [], {});
    assert.equal(posts.length, 1);
    const post = posts[0];
    assertNormalizedPost(post, 'safebooru');
    assert.equal(post.originalId, '3002');
    assert.equal(post.rating, 's');
  });

  await t.test('fetchSafebooruPostById resolves post from JSON or XML fallback', async () => {
    const client = mockContext.agent.get('https://safebooru.org');
    const xml = `<posts count="1"><post id="3003" file_url="https://safebooru.org/images/dir3/3003.jpg" preview_url="https://safebooru.org/thumbnails/dir3/thumbnail_3003.jpg" tags="solo 1girl" rating="general" score="42"/></posts>`;
    client.intercept({
      path: (p) => p.includes('id=3003'),
      method: 'GET'
    }).reply(200, xml);

    const post = await fetchSafebooruPostById('3003', [], {});
    assert.ok(post);
    assertNormalizedPost(post, 'safebooru');
    assert.equal(post.originalId, '3003');
    assert.equal(post.rating, 's');
  });

  await t.test('fetchSafebooru returns empty array on network socket error without throwing', async () => {
    const client = mockContext.agent.get('https://safebooru.org');
    client.intercept({
      path: (p) => p.includes('page=dapi'),
      method: 'GET'
    }).replyWithError(new Error('read ECONNRESET'));

    const posts = await fetchSafebooru({ tags: 'network_fail', limit: 10 }, [], {});
    assert.ok(Array.isArray(posts));
    assert.equal(posts.length, 0);
  });

  await t.test('fetchSafebooru ignores null elements in API array without throwing', async () => {
    const client = mockContext.agent.get('https://safebooru.org');
    client.intercept({
      path: (p) => p.includes('page=dapi') && p.includes('nulltest'),
      method: 'GET'
    }).reply(200, [
      null,
      { id: 3004, directory: 'dir', image: '3004.jpg', tags: 'solo', score: 5 },
      null
    ]);

    const posts = await fetchSafebooru({ tags: 'nulltest', limit: 10 }, [], {});
    assert.equal(posts.length, 1);
    assert.equal(posts[0].originalId, '3004');
  });

  await t.test('fetchSafebooru keeps healthy posts when one item has a non-string media field', async () => {
    const client = mockContext.agent.get('https://safebooru.org');
    client.intercept({
      path: (p) => p.includes('page=dapi') && p.includes('brokentest'),
      method: 'GET'
    }).reply(200, [
      { id: 3101, directory: '3101', image: '3101.jpg', tags: 'cat solo', rating: 'safe' },
      { id: 3102, directory: '3102', image: '3102.jpg', tags: 'cat solo', rating: 'safe', preview_url: 12345 }
    ]);

    const posts = await fetchSafebooru({ tags: 'brokentest', limit: 10 }, [], {});
    assert.equal(posts.length, 1);
    assert.equal(posts[0].originalId, '3101');
  });
});
