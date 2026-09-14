import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockAgent, restoreDispatcher, assertNormalizedPost } from './harness.js';
import { fetchRule34Video, resolveRule34VideoFullMedia, parseIsoDuration, formatDurationSeconds } from '../../../src/parsers/rule34video.js';

test('Rule34Video Parser Unit Tests', async (t) => {
  let mockContext = null;

  t.beforeEach(() => {
    mockContext = createMockAgent();
  });

  t.afterEach(() => {
    if (mockContext) {
      restoreDispatcher(mockContext.originalDispatcher, mockContext.agent);
    }
  });

  await t.test('parseIsoDuration correctly parses ISO 8601 duration strings', () => {
    assert.equal(parseIsoDuration('PT45S'), 45);
    assert.equal(parseIsoDuration('PT2M15S'), 135);
    assert.equal(parseIsoDuration('PT1H30M10S'), 5410);
    assert.equal(parseIsoDuration(''), 0);
    assert.equal(parseIsoDuration(null), 0);
  });

  await t.test('formatDurationSeconds converts seconds to MM:SS and HH:MM:SS formats', () => {
    assert.equal(formatDurationSeconds(45), '0:45');
    assert.equal(formatDurationSeconds(135), '2:15');
    assert.equal(formatDurationSeconds(3665), '1:01:05');
    assert.equal(formatDurationSeconds(0), '');
    assert.equal(formatDurationSeconds(-10), '');
  });

  await t.test('fetchRule34Video parses HTML search feed and satisfies 14-field contract', async () => {
    const client = mockContext.agent.get('https://rule34video.com');
    const html = `<!DOCTYPE html>
      <html>
        <body>
          <div class="item">
            <a href="/video/12345/genshin-animation-4k/" title="Genshin Animation 4K">
              <img src="https://static.rule34video.com/thumbs/12345.jpg" />
              <div class="duration">03:45</div>
            </a>
            <div class="video-preview" data-preview="https://static.rule34video.com/previews/12345.mp4"></div>
          </div>
        </body>
      </html>`;

    client.intercept({
      path: (p) => p.includes('models_json.php'),
      method: 'GET'
    }).reply(200, { items: [] });

    client.intercept({
      path: (p) => p.includes('search') || p.includes('latest-updates'),
      method: 'GET'
    }).reply(200, html);

    const posts = await fetchRule34Video({ tags: 'genshin', limit: 1 }, [], {});
    assert.equal(posts.length, 1);
    const post = posts[0];
    assertNormalizedPost(post, 'rule34video');
    assert.equal(post.isVideo, true);
    assert.equal(post.hasSound, true);
    assert.equal(post.rating, 'e');
    assert.ok(post.thumb180.length > 0);
    assert.ok(post.thumb360.length > 0);
    assert.ok(post.thumb720.length > 0);
    assert.equal(post.duration, 225);
    assert.equal(post.width, 3840);
    assert.equal(post.height, 2160);
  });

  await t.test('resolveRule34VideoFullMedia resolves full video details and tags', async () => {
    const client = mockContext.agent.get('https://rule34video.com');
    const html = `<!DOCTYPE html>
      <html>
        <head>
          <title>Genshin Impact 3D Animation [1080p]</title>
          <meta property="og:image" content="https://static.rule34video.com/thumbs/99999.jpg" />
        </head>
        <body>
          <h1>Genshin Impact 3D Animation [1080p]</h1>
          <script>
            var flashvars = {
              video_url: 'https://cdn.rule34video.com/videos/99999_1080p.mp4',
              video_tags: 'genshin_impact, ganyu'
            };
          </script>
          <span class="duration">01:30</span>
        </body>
      </html>`;

    client.intercept({
      path: '/video/99999/',
      method: 'GET'
    }).reply(200, html);

    const post = await resolveRule34VideoFullMedia('', '99999', {});
    assert.ok(post);
    assert.equal(post.success, true);
    assert.equal(post.fullVideoUrl, 'https://cdn.rule34video.com/videos/99999_1080p.mp4');
    assert.equal(post.quality, '1080p Full HD');
    assert.equal(post.duration, 90);
    assert.ok(post.tags.includes('genshin_impact'));
  });
});
