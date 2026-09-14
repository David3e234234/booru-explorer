import assert from 'node:assert/strict';
import {
  isPostMatchingFilters,
  getCriteriaSets,
  checkIsAi,
  checkMediaTypes,
  normalizeDate,
  extractAuthor,
  classifyTags,
  adaptTagsForSite,
  decodeHtmlEntities,
  isArchivePost,
  normalizeTagList,
  toNormalizedTagSet,
  matchesTagBoundary
} from '../src/utils/tagHelpers.js';

console.log('--- STARTING ADVERSARIAL INTEGRITY VERIFICATION ---');

let passedChecks = 0;
function test(name, fn) {
  try {
    fn();
    passedChecks++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err);
    process.exit(1);
  }
}

// 1. Extreme Type Confusion & Fault Injection
test('isPostMatchingFilters handles non-object post safely', () => {
  assert.strictEqual(isPostMatchingFilters(null, {}), false);
  assert.strictEqual(isPostMatchingFilters(undefined, {}), false);
  assert.strictEqual(isPostMatchingFilters(0, {}), false);
  assert.strictEqual(isPostMatchingFilters('', {}), false);
  assert.strictEqual(isPostMatchingFilters(false, {}), false);
  assert.strictEqual(isPostMatchingFilters(NaN, {}), false);
  assert.strictEqual(isPostMatchingFilters(Infinity, {}), false);
  assert.strictEqual(isPostMatchingFilters({}, {}), false);
});

test('isPostMatchingFilters handles non-object criteria safely without WeakMap error', () => {
  const post = { previewUrl: 'https://cdn.example.com/p.jpg', tags: ['1girl'] };
  assert.strictEqual(isPostMatchingFilters(post, null), true);
  assert.strictEqual(isPostMatchingFilters(post, undefined), true);
  assert.strictEqual(isPostMatchingFilters(post, 123), true);
  assert.strictEqual(isPostMatchingFilters(post, 'criteria_string'), true);
  assert.strictEqual(isPostMatchingFilters(post, true), true);
  assert.strictEqual(isPostMatchingFilters(post, false), true);
  assert.strictEqual(isPostMatchingFilters(post, NaN), true);
});

test('getCriteriaSets handles non-object criteria safely without throwing WeakMap error', () => {
  assert.doesNotThrow(() => getCriteriaSets(null));
  assert.doesNotThrow(() => getCriteriaSets(undefined));
  assert.doesNotThrow(() => getCriteriaSets(12345));
  assert.doesNotThrow(() => getCriteriaSets('string'));
  assert.doesNotThrow(() => getCriteriaSets(true));
  const res = getCriteriaSets(null);
  assert.ok(res && res.blacklist instanceof Set);
});

test('normalizeTagList handles malformed inputs and expands symmetrically', () => {
  assert.deepStrictEqual(normalizeTagList(null), []);
  assert.deepStrictEqual(normalizeTagList(undefined), []);
  assert.deepStrictEqual(normalizeTagList(123), []);
  assert.deepStrictEqual(normalizeTagList({}), []);
  const expanded = normalizeTagList(['  Big  Breasts  ', 'cat_ears']);
  assert.ok(expanded.includes('big  breasts'));
  assert.ok(expanded.includes('big_breasts'));
  assert.ok(expanded.includes('cat_ears'));
  assert.ok(expanded.includes('cat ears'));
});

test('matchesTagBoundary handles edge cases, empty strings, and special characters', () => {
  assert.strictEqual(matchesTagBoundary(null, 'test'), false);
  assert.strictEqual(matchesTagBoundary('test', null), false);
  assert.strictEqual(matchesTagBoundary('', ''), false);
  assert.strictEqual(matchesTagBoundary('a', ''), false);
  assert.strictEqual(matchesTagBoundary('', 'b'), false);
  assert.strictEqual(matchesTagBoundary('c++', 'c++'), true);
  assert.strictEqual(matchesTagBoundary('c++_art', 'c++'), true);
  assert.strictEqual(matchesTagBoundary('anthro', 'anthro'), true);
  assert.strictEqual(matchesTagBoundary('cute_anthro', 'anthro'), true);
  assert.strictEqual(matchesTagBoundary('anthro_wolf', 'anthro'), true);
  assert.strictEqual(matchesTagBoundary('cute_anthro_wolf', 'anthro'), true);
  assert.strictEqual(matchesTagBoundary('philanthropic', 'anthro'), false);
  assert.strictEqual(matchesTagBoundary('misanthrope', 'anthro'), false);
});

test('isArchivePost detects archive formats reliably and rejects non-archives', () => {
  assert.strictEqual(isArchivePost(null), false);
  assert.strictEqual(isArchivePost({}), false);
  assert.strictEqual(isArchivePost({ isArchive: true }), true);
  assert.strictEqual(isArchivePost({ fileExt: 'zip' }), true);
  assert.strictEqual(isArchivePost({ fileExt: 'RAR' }), true);
  assert.strictEqual(isArchivePost({ fileExt: '7z' }), true);
  assert.strictEqual(isArchivePost({ fileExt: 'tar' }), true);
  assert.strictEqual(isArchivePost({ fileExt: 'gz' }), true);
  assert.strictEqual(isArchivePost({ fileExt: 'bz2' }), true);
  assert.strictEqual(isArchivePost({ fileExt: 'xz' }), true);
  assert.strictEqual(isArchivePost({ archiveUrls: ['https://example.com/p.zip'] }), true);
  assert.strictEqual(isArchivePost({ fileUrl: 'https://example.com/pack.zip?key=1' }), true);
  assert.strictEqual(isArchivePost({ sampleUrl: 'https://example.com/pack.7z' }), true);
  assert.strictEqual(isArchivePost({ fileUrl: 'https://example.com/image.jpg' }), false);
  assert.strictEqual(isArchivePost({ fileUrl: 'https://example.com/video.mp4' }), false);
});

// 2. Strict Filter Invariants
test('Archive post cannot leak into image, video, or audio filters', () => {
  const archivePost = {
    previewUrl: 'https://cdn.example.com/p.jpg',
    fileUrl: 'https://cdn.example.com/pack.zip',
    isArchive: true,
    isVideo: true,
    hasSound: true,
    tags: ['1girl']
  };
  assert.strictEqual(isPostMatchingFilters(archivePost, { typeFilter: 'image' }), false, 'Must reject in image');
  assert.strictEqual(isPostMatchingFilters(archivePost, { typeFilter: 'video' }), false, 'Must reject in video');
  assert.strictEqual(isPostMatchingFilters(archivePost, { typeFilter: 'audio' }), false, 'Must reject in audio');
  assert.strictEqual(isPostMatchingFilters(archivePost, { typeFilter: 'zip' }), true, 'Must pass in zip');
  assert.strictEqual(isPostMatchingFilters(archivePost, { typeFilter: 'archive' }), true, 'Must pass in archive');
  assert.strictEqual(isPostMatchingFilters(archivePost, { typeFilter: 'all' }), true, 'Must pass in all');
});

test('Video and audio files cannot leak into image filter', () => {
  const postMp4 = { fileUrl: 'https://cdn.example.com/art.mp4', tags: ['1girl'] };
  const postWebm = { sampleUrl: 'https://cdn.example.com/art.webm?param=1', tags: ['1girl'] };
  const postMp3 = { fileUrl: 'https://cdn.example.com/audio.mp3', tags: ['1girl'] };
  const postGif = { isGif: true, fileUrl: 'https://cdn.example.com/anim.gif', tags: ['1girl'] };
  const postSound = { previewUrl: 'https://cdn.example.com/p.jpg', isVideo: false, hasSound: true, tags: ['1girl'] };

  assert.strictEqual(isPostMatchingFilters(postMp4, { typeFilter: 'image' }), false);
  assert.strictEqual(isPostMatchingFilters(postWebm, { typeFilter: 'image' }), false);
  assert.strictEqual(isPostMatchingFilters(postMp3, { typeFilter: 'image' }), false);
  assert.strictEqual(isPostMatchingFilters(postGif, { typeFilter: 'image' }), false);
  assert.strictEqual(isPostMatchingFilters(postSound, { typeFilter: 'image' }), false);
});

test('Blacklist handles multi-word space/underscore symmetry without substring collateral damage', () => {
  const postUnder = { previewUrl: 'https://cdn.example.com/p.jpg', tags: ['scat_art', '1girl'] };
  const postSpace = { previewUrl: 'https://cdn.example.com/p.jpg', tags: ['scat art', '1girl'] };
  const postClean = { previewUrl: 'https://cdn.example.com/p.jpg', tags: ['art', 'artist_name', '1girl'] };

  assert.strictEqual(isPostMatchingFilters(postUnder, { blacklist: ['scat art'] }), false);
  assert.strictEqual(isPostMatchingFilters(postSpace, { blacklist: ['scat_art'] }), false);
  assert.strictEqual(isPostMatchingFilters(postUnder, { blacklist: 'scat art' }), false);
  assert.strictEqual(isPostMatchingFilters(postClean, { blacklist: ['scat art'] }), true);
});

test('hideFurry / hidePregnant / hideLgbt handle infix compound tags correctly without false positives', () => {
  const postInfixFurry = { previewUrl: 'https://cdn.example.com/p.jpg', tags: ['female_anthro_solo'] };
  const postInfixPregnant = { previewUrl: 'https://cdn.example.com/p.jpg', tags: ['visibly_pregnant_woman'] };
  const postInfixLgbt = { previewUrl: 'https://cdn.example.com/p.jpg', tags: ['cute_femboy_maid'] };

  const postInnocent1 = { previewUrl: 'https://cdn.example.com/p.jpg', tags: ['philanthropic', 'birthday_cake', '1girl'] };
  const postInnocent2 = { previewUrl: 'https://cdn.example.com/p.jpg', tags: ['rebirth', 'cat_ears', '1girl'] };

  assert.strictEqual(isPostMatchingFilters(postInfixFurry, { hideFurry: true }), false);
  assert.strictEqual(isPostMatchingFilters(postInfixPregnant, { hidePregnant: true }), false);
  assert.strictEqual(isPostMatchingFilters(postInfixLgbt, { hideLgbt: true }), false);

  assert.strictEqual(isPostMatchingFilters(postInnocent1, { hideFurry: true, hidePregnant: true, hideLgbt: true }), true);
  assert.strictEqual(isPostMatchingFilters(postInnocent2, { hideFurry: true, hidePregnant: true, hideLgbt: true }), true);
});

test('Negative tokens support wildcards, leading minus, and exact matching safely', () => {
  const post = { previewUrl: 'https://cdn.example.com/p.jpg', tags: ['blonde_haired_girl', 'bad_anatomy', 'caterpillar'] };

  // Wildcard matching
  assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['-blonde*'] }), false);
  assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['bad*'] }), false);
  assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['-cat*'] }), false);

  // Exact matching does not trigger on substring
  assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['blonde'] }), true);
  assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['cat'] }), true);
  assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['anatomy'] }), true);

  // Pathological negative tokens
  assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['*'] }), true);
  assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['-*'] }), true);
  assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['-'] }), true);
  assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: [null, undefined, ''] }), true);
});

test('Rating system distinctions (Danbooru 4-tier vs Legacy 3-tier) are strictly enforced', () => {
  const danbooruSensitive = { previewUrl: 'https://cdn.example.com/p.jpg', site: 'danbooru', rating: 's' };
  const safebooruSafe = { previewUrl: 'https://cdn.example.com/p.jpg', site: 'safebooru', rating: 's' };

  // Danbooru SFW rejects 's'
  assert.strictEqual(isPostMatchingFilters(danbooruSensitive, { ratingFilter: 'sfw' }), false);
  // Safebooru SFW accepts 's'
  assert.strictEqual(isPostMatchingFilters(safebooruSafe, { ratingFilter: 'sfw' }), true);

  // Danbooru Questionable accepts 's' (16+ sensitive)
  assert.strictEqual(isPostMatchingFilters(danbooruSensitive, { ratingFilter: 'questionable' }), true);
  // Safebooru Questionable rejects 's'
  assert.strictEqual(isPostMatchingFilters(safebooruSafe, { ratingFilter: 'questionable' }), false);
});

test('AI detection is robust against invalid parameters and detects modern model tags', () => {
  assert.strictEqual(checkIsAi(null, null), false);
  assert.strictEqual(checkIsAi([], null), false);
  assert.strictEqual(checkIsAi(['ai_generated'], null), true);
  assert.strictEqual(checkIsAi(['novelai_diffusion'], null), true);
  assert.strictEqual(checkIsAi(['pony_diffusion'], null), true);
  assert.strictEqual(checkIsAi(['flux.1'], null), true);
  assert.strictEqual(checkIsAi(['traditional_oil_painting'], null), false);
  assert.strictEqual(checkIsAi(['traditional_oil_painting'], 'invalid_arg'), false);
  assert.strictEqual(checkIsAi(['custom_ai'], ['custom_ai']), true);
});

test('Performance and memory under high load (10,000 iterations)', () => {
  const criteria = {
    typeFilter: 'image',
    ageFilter: 'adult',
    aiFilter: 'no-ai',
    ratingFilter: 'sfw',
    hideFurry: true,
    hidePregnant: true,
    hideLgbt: true,
    blacklist: ['scat art', 'guro', 'extreme violence'],
    negativeTokens: ['-ugly*']
  };
  const post = {
    previewUrl: 'https://cdn.example.com/p.jpg',
    tags: ['1girl', 'milf', 'smile', 'highres'],
    rating: 'g',
    isAi: false
  };

  const start = Date.now();
  for (let i = 0; i < 10000; i++) {
    const res = isPostMatchingFilters(post, criteria);
    if (!res) throw new Error('Failed filtering on iteration ' + i);
  }
  const duration = Date.now() - start;
  assert.ok(duration < 500, `10,000 iterations took ${duration}ms, expected <500ms`);
  console.log(`[PERF] 10,000 iterations completed in ${duration}ms (${(duration / 10000).toFixed(4)}ms per check)`);
});

console.log(`--- ALL ${passedChecks} ADVERSARIAL INTEGRITY CHECKS PASSED EMPIRICALLY ---`);
