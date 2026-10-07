import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compactStoredPost, sanitizeStoredPost } from '../../src/services/storedPostSchema.js';

function makePost(overrides = {}) {
  return {
    id: 'danbooru_123',
    originalId: '123',
    site: 'danbooru',
    siteName: 'Danbooru',
    author: 'some_artist',
    previewUrl: 'https://example.com/preview.jpg',
    sampleUrl: 'https://example.com/sample.jpg',
    fileUrl: 'https://example.com/original.jpg',
    thumb180: 'https://example.com/180.jpg',
    thumb360: 'https://example.com/360.jpg',
    thumb720: 'https://example.com/720.jpg',
    thumbSample: 'https://example.com/sample.jpg',
    thumbOriginal: 'https://example.com/original.jpg',
    isVideo: false,
    tags: ['1girl', 'long_hair'],
    tagDetails: { artist: ['some_artist'], general: ['1girl', 'long_hair'] },
    likedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

describe('Stored post schema', () => {
  it('keeps the fields the renderer and recommendations read', () => {
    const stored = sanitizeStoredPost(makePost());
    for (const field of ['id', 'site', 'author', 'tags', 'tagDetails', 'previewUrl', 'fileUrl', 'likedAt']) {
      assert.ok(field in stored, `${field} must survive storage`);
    }
  });

  it('drops the similar-posts pool and other internal viewer state', () => {
    // The leak that made a single like cost up to ~300 KB: the viewer attaches
    // its whole similar-posts pool to the post it is showing.
    const pool = Array.from({ length: 120 }, (_, i) => ({ post: { id: `x_${i}`, tags: ['a'] }, score: 1 }));
    const stored = sanitizeStoredPost(makePost({
      _similarPosts: pool,
      _similarSession: { pool },
      _albumFetchInProgress: false,
      _albumFullyFetched: true,
      _archivePromise: {},
      _archiveUnpacked: { files: [] },
      _unpackedZips: []
    }));

    assert.equal(stored._similarPosts, undefined);
    assert.equal(stored._similarSession, undefined);
    assert.equal(stored._albumFetchInProgress, undefined);
    assert.equal(stored._albumFullyFetched, undefined);
    assert.equal(stored._archivePromise, undefined);
    assert.equal(stored._archiveUnpacked, undefined);
    assert.equal(stored._unpackedZips, undefined);
  });

  it('drops album items and recomputed series keys', () => {
    const stored = sanitizeStoredPost(makePost({
      albumItems: [{ hugeData: 'bloat'.repeat(50) }],
      allSeriesKeys: ['danbooru_1', 'danbooru_2']
    }));
    assert.equal(stored.albumItems, undefined);
    assert.equal(stored.allSeriesKeys, undefined);
  });

  it('drops unknown fields rather than persisting whatever a post carries', () => {
    const stored = sanitizeStoredPost(makePost({ someFutureUpstreamField: 'x', desiredState: true }));
    assert.equal(stored.someFutureUpstreamField, undefined);
    assert.equal(stored.desiredState, undefined);
  });

  it('elides a thumb tier only when it duplicates another tier', () => {
    const redundant = sanitizeStoredPost(makePost());
    assert.equal(redundant.thumbOriginal, undefined, 'thumbOriginal === fileUrl');
    assert.equal(redundant.thumbSample, undefined, 'thumbSample === sampleUrl and thumb720 exists');
  });

  it('keeps thumbSample when there is no higher tier to prefer', () => {
    const post = makePost();
    delete post.thumb720;
    const stored = sanitizeStoredPost(post);
    assert.equal(stored.thumbSample, post.sampleUrl, 'thumbSample is still the card preview');
  });

  it('keeps a distinct thumbOriginal instead of guessing', () => {
    const post = makePost({ thumbOriginal: 'https://example.com/other-original.jpg' });
    const stored = sanitizeStoredPost(post);
    assert.equal(stored.thumbOriginal, 'https://example.com/other-original.jpg');
  });

  it('keeps every field in a raw-compact post for backups', () => {
    const stored = sanitizeStoredPost(makePost({ _similarPosts: [{ score: 1 }] }), { rawCompact: true });
    assert.equal(stored.thumbOriginal, 'https://example.com/original.jpg', 'tiers stay intact for restore');
    assert.equal(stored.thumbSample, 'https://example.com/sample.jpg');
    assert.equal(stored._similarPosts, undefined, 'internal state is still not exported');
  });

  it('preserves non-object input untouched', () => {
    assert.equal(sanitizeStoredPost(null), null);
    assert.equal(sanitizeStoredPost(undefined), undefined);
    assert.equal(sanitizeStoredPost('danbooru_1'), 'danbooru_1');
  });
});

describe('Compacting a legacy stored post', () => {
  it('strips internal state without re-deriving the allowlist', () => {
    // Migration path: a record written before the allowlist must shrink, but it
    // must not lose a public field the newer schema did not enumerate.
    const compacted = compactStoredPost({
      id: 'danbooru_9',
      site: 'danbooru',
      tags: ['a'],
      someLegacyPublicField: 'keep',
      _similarPosts: [{ post: {} }],
      albumItems: [{ big: 1 }],
      allSeriesKeys: ['k'],
      thumbOriginal: 'https://example.com/o.jpg',
      fileUrl: 'https://example.com/o.jpg'
    });

    assert.equal(compacted.someLegacyPublicField, 'keep');
    assert.equal(compacted._similarPosts, undefined);
    assert.equal(compacted.albumItems, undefined);
    assert.equal(compacted.allSeriesKeys, undefined);
    assert.equal(compacted.thumbOriginal, undefined);
  });
});