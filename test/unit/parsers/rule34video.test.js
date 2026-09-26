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

  // The feed markup only carries the ~20s teaser. The viewer must be able to tell
  // that apart from final media, otherwise it autoplays the teaser as the video.
  await t.test('feed posts flag teaser media instead of pretending it is the video', async () => {
    const client = mockContext.agent.get('https://rule34video.com');
    const html = `<!DOCTYPE html>
      <html><body>
        <div class="item">
          <a href="/video/12345/genshin-animation-4k/" title="Genshin Animation 4K">
            <img src="https://static.rule34video.com/thumbs/12345.jpg" />
            <div class="duration">03:45</div>
          </a>
          <div class="video-preview" data-preview="https://rule34video.com/get_file/58/abc/4627000/4627795/4627795_preview.mp4/"></div>
        </div>
      </body></html>`;

    client.intercept({ path: (p) => p.includes('search') || p.includes('latest-updates'), method: 'GET' }).reply(200, html);

    const posts = await fetchRule34Video({ tags: 'genshin', limit: 1 }, [], {});
    assert.equal(posts.length, 1);
    const post = posts[0];
    assert.equal(post.hasFullMediaPending, true);
    assert.equal(post.teaserUrl, 'https://rule34video.com/get_file/58/abc/4627000/4627795/4627795_preview.mp4/');
    assert.match(post.fileUrl, /_preview\.mp4\/$/);
    // The still frame stays a real image so cards and the viewer poster can use it
    assert.equal(post.previewUrl, 'https://static.rule34video.com/thumbs/12345.jpg');
  });

  await t.test('resolveRule34VideoFullMedia resolves full video details and tags', async () => {
    const client = mockContext.agent.get('https://rule34video.com');
    const html = `<!DOCTYPE html>
      <html>
        <head>
          <title>Genshin Impact 3D Animation [1080p]</title>
          <meta property="og:image" content="https://static.rule34video.com/thumbs/70001.jpg" />
        </head>
        <body>
          <h1>Genshin Impact 3D Animation [1080p]</h1>
          <script>
            var flashvars = {
              video_url: 'https://cdn.rule34video.com/videos/70001_1080p.mp4',
              video_tags: 'genshin_impact, ganyu'
            };
          </script>
          <span class="duration">01:30</span>
        </body>
      </html>`;

    client.intercept({
      path: '/video/70001/x/',
      method: 'GET'
    }).reply(200, html);

    const post = await resolveRule34VideoFullMedia('', '70001', {});
    assert.ok(post);
    assert.equal(post.success, true);
    assert.equal(post.fullVideoUrl, 'https://cdn.rule34video.com/videos/70001_1080p.mp4');
    assert.equal(post.quality, '1080p Full HD');
    assert.equal(post.duration, 90);
    assert.ok(post.tags.includes('genshin_impact'));
  });

  // The board answers `/video/<id>/x/` with a 301 to the canonical slugged page.
  // fetchSafe() keeps redirect: 'manual', so the parser has to make that one hop
  // itself. Without it every resolve returned null and the viewer played the teaser.
  await t.test('resolves the full stream through the canonical slug redirect', async () => {
    const client = mockContext.agent.get('https://rule34video.com');
    const html = `<!DOCTYPE html>
      <html><body>
        <h1>Genshin Impact 3D Animation [1080p]</h1>
        <script>
          var flashvars = {
            video_url: 'https://cdn.rule34video.com/videos/70002_1080p.mp4'
          };
        </script>
      </body></html>`;

    client.intercept({ path: '/video/70002/x/', method: 'GET' })
      .reply(301, '', { headers: { location: '/video/70002/genshin-animation-4k/' } });
    client.intercept({ path: '/video/70002/genshin-animation-4k/', method: 'GET' }).reply(200, html);

    const post = await resolveRule34VideoFullMedia('', '70002', {});
    assert.ok(post, 'resolve must survive the canonical redirect');
    assert.equal(post.success, true);
    assert.equal(post.fullVideoUrl, 'https://cdn.rule34video.com/videos/70002_1080p.mp4');
  });

  // A Location header is untrusted input, so a redirect off the board must not be
  // followed even though the resolve itself is allowed to make one hop.
  // Each case uses its own id: resolvedVideoCache is keyed by id and would answer
  // the later cases from the first one.
  await t.test('refuses a redirect that leaves the board', async () => {
    const client = mockContext.agent.get('https://rule34video.com');
    client.intercept({ path: '/video/70003/x/', method: 'GET' })
      .reply(301, '', { headers: { location: 'https://evil.example.com/steal' } });

    const post = await resolveRule34VideoFullMedia('', '70003', {});
    assert.equal(post, null);
  });

  // Resolving by id goes through the video page, so the link is already final and
  // the viewer must not wait for a second resolve.
  await t.test('id lookup returns final media without a pending flag', async () => {
    const client = mockContext.agent.get('https://rule34video.com');
    const html = `<!DOCTYPE html>
      <html>
        <body>
          <h1>Genshin Impact 3D Animation [1080p]</h1>
          <script>
            var flashvars = {
              video_url: 'https://cdn.rule34video.com/videos/70004_1080p.mp4',
              video_tags: 'genshin_impact'
            };
          </script>
        </body>
      </html>`;

    client.intercept({ path: '/video/70004/x/', method: 'GET' }).reply(200, html);

    const posts = await fetchRule34Video({ tags: 'id:70004' }, [], {});
    assert.equal(posts.length, 1);
    assert.equal(posts[0].hasFullMediaPending, false);
    assert.equal(posts[0].teaserUrl, '');
    assert.equal(posts[0].fileUrl, 'https://cdn.rule34video.com/videos/70004_1080p.mp4');
  });

  // Feed posts already know the canonical page, so the resolve must reuse it
  // instead of spending a request on the redirect hop.
  await t.test('uses the post page link when the caller supplies one', async () => {
    const client = mockContext.agent.get('https://rule34video.com');
    const html = `<!DOCTYPE html>
      <html><body>
        <h1>Genshin Impact 3D Animation [1080p]</h1>
        <script>
          var flashvars = { video_url: 'https://cdn.rule34video.com/videos/70005_1080p.mp4' };
        </script>
      </body></html>`;

    client.intercept({ path: '/video/70005/genshin-animation-4k/', method: 'GET' }).reply(200, html);

    const post = await resolveRule34VideoFullMedia('https://rule34video.com/video/70005/genshin-animation-4k/', '70005', {});
    assert.ok(post);
    assert.equal(post.fullVideoUrl, 'https://cdn.rule34video.com/videos/70005_1080p.mp4');
  });
});
