import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendRatingTag,
  buildThumbTiers,
  clampPageLimit,
  computePageOffset
} from '../../src/utils/searchCompat.js';

test('appendRatingTag', async (t) => {
  await t.test('appends the engine-specific rating tag', () => {
    assert.equal(appendRatingTag('1girl', 'nsfw', 'gelbooru'), '1girl rating:explicit');
    assert.equal(appendRatingTag('1girl', 'sfw', 'danbooru'), '1girl rating:g');
    assert.equal(appendRatingTag('1girl', 'questionable', 'rule34'), '1girl rating:questionable');
  });

  await t.test('keeps a caller-supplied rating constraint untouched', () => {
    assert.equal(appendRatingTag('1girl rating:safe', 'nsfw', 'gelbooru'), '1girl rating:safe');
    assert.equal(appendRatingTag('rating:q 1girl', 'sfw', 'moebooru'), 'rating:q 1girl');
  });

  await t.test('does not duplicate a rating tag when called twice', () => {
    const once = appendRatingTag('1girl', 'nsfw', 'dapi');
    assert.equal(appendRatingTag(once, 'nsfw', 'dapi'), once);
  });

  await t.test('handles an empty query and the all filter', () => {
    // A rating-only query must still be sent: returning '' here silently
    // disabled the filter on boards whose page has no other tags.
    assert.equal(appendRatingTag('', 'nsfw', 'moebooru'), 'rating:explicit');
    assert.equal(appendRatingTag('1girl', 'all', 'gelbooru'), '1girl');
    assert.equal(appendRatingTag('1girl', 'unknown', 'gelbooru'), '1girl');
    assert.equal(appendRatingTag(null, 'nsfw', 'gelbooru'), 'rating:explicit');
  });
});

test('buildThumbTiers', async (t) => {
  await t.test('keeps medium off the full file while a sample exists', () => {
    const tiers = buildThumbTiers({
      previewUrl: 'https://cdn/thumb.jpg',
      rawSampleUrl: 'https://cdn/sample.jpg',
      fileUrl: 'https://cdn/original.png',
      isVideo: false
    });
    assert.equal(tiers.thumb180, 'https://cdn/thumb.jpg');
    assert.equal(tiers.thumb360, 'https://cdn/sample.jpg');
    assert.equal(tiers.thumb720, 'https://cdn/sample.jpg');
  });

  await t.test('falls back to the preview when the board returns no sample', () => {
    const tiers = buildThumbTiers({
      previewUrl: 'https://cdn/thumb.jpg',
      rawSampleUrl: '',
      fileUrl: 'https://cdn/original.png',
      isVideo: false
    });
    assert.equal(tiers.thumb180, 'https://cdn/thumb.jpg');
    assert.equal(tiers.thumb360, 'https://cdn/thumb.jpg');
    assert.equal(tiers.thumb720, 'https://cdn/original.png');
  });

  await t.test('uses one shared URL for video previews', () => {
    const tiers = buildThumbTiers({
      previewUrl: '',
      rawSampleUrl: 'https://cdn/sample.mp4',
      fileUrl: 'https://cdn/original.mp4',
      isVideo: true
    });
    assert.equal(tiers.thumb180, 'https://cdn/sample.mp4');
    assert.equal(tiers.thumb360, tiers.thumb180);
    assert.equal(tiers.thumb720, tiers.thumb180);
  });
});

test('clampPageLimit', async (t) => {
  await t.test('parses and clamps to the board ceiling', () => {
    assert.equal(clampPageLimit('25', 100), 25);
    assert.equal(clampPageLimit('500', 100), 100);
    assert.equal(clampPageLimit('0', 100), 40);
    assert.equal(clampPageLimit('-5', 100), 40);
    assert.equal(clampPageLimit('abc', 100), 40);
  });

  await t.test('never returns less than one', () => {
    assert.equal(clampPageLimit(0, 100, 1), 1);
    assert.equal(clampPageLimit(1, 100), 1);
  });
});

test('computePageOffset', async (t) => {
  await t.test('continues exactly where the previous page stopped', () => {
    assert.equal(computePageOffset(1, 40), 0);
    assert.equal(computePageOffset(2, 40), 40);
    assert.equal(computePageOffset(3, 25), 50);
  });

  await t.test('repairs malformed page and limit input', () => {
    assert.equal(computePageOffset('-2', 40), 0);
    assert.equal(computePageOffset(2, 0), 40);
    assert.equal(computePageOffset('nope', 'nope'), 0);
  });
});
