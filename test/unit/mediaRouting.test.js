import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldProxyMedia, getMediaUrl, getProxiedUrl } from '../../public/js/api.js';

describe('Media Routing & Per-Source Proxy Selection', () => {
  it('correctly uses global type defaults when site mode is default or unset', () => {
    const settings = {
      proxyThumbnails: true,
      proxyFullImages: false,
      proxyVideos: true,
      proxyDownloads: true,
      siteMediaProxy: {}
    };

    assert.strictEqual(shouldProxyMedia({ site: 'gelbooru', url: 'https://gelbooru.com/thumb.jpg', type: 'thumbnail', settings }), true);
    assert.strictEqual(shouldProxyMedia({ site: 'gelbooru', url: 'https://gelbooru.com/full.jpg', type: 'image', settings }), false);
    assert.strictEqual(shouldProxyMedia({ site: 'gelbooru', url: 'https://gelbooru.com/clip.mp4', type: 'video', settings }), true);
  });

  it('forces server proxying when siteMediaProxy is set to "server"', () => {
    const settings = {
      proxyThumbnails: false,
      proxyFullImages: false,
      proxyVideos: false,
      siteMediaProxy: {
        gelbooru: 'server'
      }
    };

    // Even though global switches are false, gelbooru is forced to server
    assert.strictEqual(shouldProxyMedia({ site: 'gelbooru', url: 'https://gelbooru.com/thumb.jpg', type: 'thumbnail', settings }), true);
    assert.strictEqual(shouldProxyMedia({ site: 'gelbooru', url: 'https://gelbooru.com/full.jpg', type: 'image', settings }), true);

    // Another site remains adhering to global switches
    assert.strictEqual(shouldProxyMedia({ site: 'konachan', url: 'https://konachan.com/thumb.jpg', type: 'thumbnail', settings }), false);
  });

  it('forces direct CDN when siteMediaProxy is set to "direct"', () => {
    const settings = {
      proxyThumbnails: true,
      proxyFullImages: true,
      proxyVideos: true,
      siteMediaProxy: {
        danbooru: 'direct',
        rule34: 'direct'
      }
    };

    // Even Danbooru hotlink defaults are bypassed if user explicitly forces direct
    assert.strictEqual(shouldProxyMedia({ site: 'danbooru', url: 'https://danbooru.donmai.us/sample.jpg', type: 'image', settings }), false);
    assert.strictEqual(shouldProxyMedia({ site: 'rule34', url: 'https://rule34.xxx/sample.jpg', type: 'image', settings }), false);
  });

  it('never loops already-local /api/ URLs', () => {
    assert.strictEqual(shouldProxyMedia({ site: 'danbooru', url: '/api/archive/file/1', type: 'image' }), false);
    assert.strictEqual(getMediaUrl('/api/archive/file/1', { site: 'danbooru' }), '/api/archive/file/1');
    assert.strictEqual(getProxiedUrl('/api/archive/file/1'), '/api/archive/file/1');
  });

  it('correctly constructs proxied vs direct URLs via getMediaUrl', () => {
    const settings = {
      siteMediaProxy: {
        gelbooru: 'server',
        konachan: 'direct'
      }
    };

    const gelbooruUrl = 'https://gelbooru.com/image.jpg';
    const konachanUrl = 'https://konachan.com/image.jpg';

    assert.strictEqual(getMediaUrl(gelbooruUrl, { site: 'gelbooru', type: 'image', settings }), `/api/proxy?url=${encodeURIComponent(gelbooruUrl)}`);
    assert.strictEqual(getMediaUrl(konachanUrl, { site: 'konachan', type: 'image', settings }), konachanUrl);
  });
});
