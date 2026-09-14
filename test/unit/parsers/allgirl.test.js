import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockAgent, restoreDispatcher, assertNormalizedPost } from './harness.js';
import { fetchAllgirl, fetchAllgirlPostById } from '../../../src/parsers/allgirl.js';

test('AllGirl Parser Unit Tests', async (t) => {
  let mockContext = null;

  t.beforeEach(() => {
    mockContext = createMockAgent();
  });

  t.afterEach(() => {
    if (mockContext) {
      restoreDispatcher(mockContext.originalDispatcher, mockContext.agent);
    }
  });

  await t.test('fetchAllgirl returns normalized posts adhering to 14-field contract', async () => {
    const client = mockContext.agent.get('https://allgirl.booru.org');
    const sampleHtml = `
      <span class="thumb">
        <a id="p1001" href="index.php?page=post&s=view&id=1001">
          <img src="//thumbs.booru.org/allgirl/thumbnails/1/thumbnail_image1.jpg" title="girl solo rating:explicit score:5">
        </a>
        <script>
          posts[1001] = {'id': 1001, 'tags': ['girl', 'solo'], 'rating': 'explicit', 'score': 5, 'user': 'admin'};
        </script>
      </span>
    `;

    client.intercept({
      path: (p) => p.includes('page=post') && p.includes('s=list'),
      method: 'GET'
    }).reply(200, sampleHtml, {
      headers: { 'content-type': 'text/html' }
    });

    const posts = await fetchAllgirl({ tags: 'solo', limit: 10, page: 1 }, [], {});
    assert.equal(posts.length, 1);
    const post = posts[0];
    assertNormalizedPost(post, 'allgirl');
    assert.equal(post.id, 'allgirl_1001');
    assert.equal(post.originalId, '1001');
    assert.equal(post.rating, 'e');
    assert.equal(post.score, 5);
    assert.ok(post.fileUrl.startsWith('https://img.booru.org'));
    assert.ok(post.thumb180.startsWith('https://thumbs.booru.org'));
    assert.ok(post.thumb360.startsWith('https://thumbs.booru.org'));
    assert.ok(post.thumb720.startsWith('https://thumbs.booru.org'));
  });

  await t.test('fetchAllgirl returns empty array when typeFilter is video', async () => {
    const posts = await fetchAllgirl({ tags: 'solo', typeFilter: 'video' }, [], {});
    assert.deepEqual(posts, []);
  });

  await t.test('fetchAllgirlPostById resolves single post from HTML view', async () => {
    const client = mockContext.agent.get('https://allgirl.booru.org');
    const postHtml = `
      <div>
        <img id="image" src="//img.booru.org/allgirl/images/1/image1.jpg" alt="girl solo" />
        <div>Size: 1920x1080</div>
        <div>Posted: 2024-01-15 12:00:00</div>
        <div>By: CoolUploader</div>
        <div>Source: <a href="https://twitter.com/artist/status/123">link</a></div>
        <div id="psc">12</div>
        <div>Rating: Explicit</div>
        <ul id="tag-sidebar">
          <li><a href="index.php?page=post&amp;s=list&amp;tags=girl">girl</a></li>
          <li><a href="index.php?page=post&amp;s=list&amp;tags=solo">solo</a></li>
        </ul>
      </div>
    `;

    client.intercept({
      path: (p) => p.includes('page=post') && p.includes('s=view') && p.includes('1001'),
      method: 'GET'
    }).reply(200, postHtml, {
      headers: { 'content-type': 'text/html' }
    });

    const post = await fetchAllgirlPostById('1001', [], {});
    assert.ok(post);
    assertNormalizedPost(post, 'allgirl');
    assert.equal(post.id, 'allgirl_1001');
    assert.equal(post.originalId, '1001');
    assert.equal(post.rating, 'e');
    assert.equal(post.width, 1920);
    assert.equal(post.height, 1080);
    assert.equal(post.score, 12);
    assert.ok(post.fileUrl.startsWith('https://img.booru.org'));
    assert.ok(post.tags.includes('girl'));
    assert.ok(post.tags.includes('solo'));
  });

  await t.test('fetchAllgirlPostById returns null if image element is missing', async () => {
    const client = mockContext.agent.get('https://allgirl.booru.org');
    client.intercept({
      path: (p) => p.includes('page=post') && p.includes('s=view') && p.includes('9999'),
      method: 'GET'
    }).reply(200, '<div>Post deleted or not found</div>', {
      headers: { 'content-type': 'text/html' }
    });

    const post = await fetchAllgirlPostById('9999', [], {});
    assert.equal(post, null);
  });
});
