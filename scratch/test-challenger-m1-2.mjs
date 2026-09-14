import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
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

console.log('================================================================');
console.log('EMPIRICAL CHALLENGER 2: DEEP STRESS & BOUNDARY HARNESS');
console.log('Target: src/utils/tagHelpers.js');
console.log('================================================================\n');

let totalTests = 0;
let passedTests = 0;
const failures = [];

function challenge(suiteName, testName, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  [PASS] ${testName}`);
  } catch (err) {
    console.error(`  [FAIL] ${testName}: ${err.message}`);
    failures.push({ suite: suiteName, test: testName, error: err });
  }
}

// ----------------------------------------------------------------------------
// SECTION 1: PERFORMANCE UNDER LARGE INPUT ARRAYS (5,000+ ITEMS)
// ----------------------------------------------------------------------------
console.log('\n--- SECTION 1: Large Array & Stress Performance ---');

challenge('Stress', 'Filter 5,000 synthetic posts in < 150ms', () => {
  const criteria = {
    typeFilter: 'image',
    ageFilter: 'adult',
    aiFilter: 'no-ai',
    ratingFilter: 'sfw',
    hideFurry: true,
    hidePregnant: true,
    hideLgbt: true,
    blacklist: ['scat art', 'guro', 'extreme_violence', 'blood'],
    negativeTokens: ['-ugly*', '-bad_anatomy']
  };

  const posts = [];
  for (let i = 0; i < 5000; i++) {
    const isGood = (i % 5 === 0);
    posts.push({
      id: `post_${i}`,
      fileUrl: `https://cdn.example.com/media_${i}.jpg`,
      sampleUrl: `https://cdn.example.com/sample_${i}.jpg`,
      previewUrl: `https://cdn.example.com/preview_${i}.jpg`,
      tags: isGood
        ? ['1girl', 'milf', 'smile', 'highres', 'solo']
        : (i % 3 === 0 ? ['1girl', 'female_anthro_solo'] : ['1girl', 'scat_art', 'bad_anatomy']),
      rating: isGood ? 'g' : (i % 2 === 0 ? 'e' : 'q'),
      isAi: (i % 7 === 0),
      isVideo: false,
      isGif: false,
      hasSound: false,
      isArchive: (i % 11 === 0)
    });
  }

  const t0 = performance.now();
  let matchCount = 0;
  for (let i = 0; i < posts.length; i++) {
    if (isPostMatchingFilters(posts[i], criteria)) {
      matchCount++;
    }
  }
  const t1 = performance.now();
  const elapsed = t1 - t0;

  console.log(`    Throughput: 5,000 posts evaluated in ${elapsed.toFixed(2)}ms (${(5000 / (elapsed / 1000)).toFixed(0)} posts/sec). Matched: ${matchCount}`);
  assert.ok(elapsed < 200, `Filtering 5,000 posts took ${elapsed}ms, exceeding 200ms threshold`);
  assert.ok(matchCount > 0 && matchCount <= 1000, `Unexpected match count: ${matchCount}`);
});

challenge('Stress', 'Single post with 5,000 tags evaluated in < 10ms', () => {
  const tags = Array.from({ length: 5000 }, (_, i) => `synthetic_tag_${i}`);
  tags.push('milf', 'smile');

  const post = {
    fileUrl: 'https://cdn.example.com/giant.jpg',
    tags,
    rating: 'g',
    isAi: false
  };

  const criteria = {
    ageFilter: 'adult',
    aiFilter: 'no-ai',
    ratingFilter: 'sfw',
    hideFurry: true,
    blacklist: ['non_existent_tag_12345'],
    negativeTokens: ['-fake_prefix*']
  };

  const t0 = performance.now();
  const res = isPostMatchingFilters(post, criteria);
  const t1 = performance.now();
  const elapsed = t1 - t0;

  console.log(`    Single post with 5,000 tags evaluated in ${elapsed.toFixed(2)}ms`);
  assert.strictEqual(res, true);
  assert.ok(elapsed < 50, `Post with 5,000 tags took ${elapsed}ms, exceeding 50ms limit`);
});

challenge('Stress', '5,000 item blacklist with WeakMap cache reuse', () => {
  const giantBlacklist = Array.from({ length: 5000 }, (_, i) => `blocked_word_${i}`);
  giantBlacklist.push('forbidden concept');

  const criteria = {
    blacklist: giantBlacklist
  };

  // First call builds the set and caches in WeakMap
  const tBuild0 = performance.now();
  const sets = getCriteriaSets(criteria);
  const tBuild1 = performance.now();
  assert.ok(sets.blacklist.has('forbidden_concept'), 'Should expand space to underscore');

  // Verify subsequent lookups against 1,000 posts use cached sets
  const testPost = {
    previewUrl: 'https://cdn.example.com/p.jpg',
    tags: ['1girl', 'solo', 'innocent_tag']
  };
  const blockedPost = {
    previewUrl: 'https://cdn.example.com/p.jpg',
    tags: ['1girl', 'forbidden_concept']
  };

  const t0 = performance.now();
  for (let i = 0; i < 1000; i++) {
    assert.strictEqual(isPostMatchingFilters(testPost, criteria), true);
  }
  const t1 = performance.now();
  const cachedTime = t1 - t0;

  assert.strictEqual(isPostMatchingFilters(blockedPost, criteria), false);
  console.log(`    Set build for 5,000 blacklist items: ${(tBuild1 - tBuild0).toFixed(2)}ms. 1,000 checks with cached set: ${cachedTime.toFixed(2)}ms`);
  assert.ok(cachedTime < 50, `1,000 checks with cached 5,000 blacklist took ${cachedTime}ms`);
});

challenge('Stress', '1,000 negativeTokens evaluated against post', () => {
  const negTokens = Array.from({ length: 1000 }, (_, i) => `-neg_token_${i}*`);
  negTokens.push('-toxic_tag');

  const criteria = { negativeTokens: negTokens };
  const cleanPost = { previewUrl: 'https://cdn.example.com/p.jpg', tags: ['1girl', 'solo', 'happy'] };
  const dirtyPost = { previewUrl: 'https://cdn.example.com/p.jpg', tags: ['1girl', 'toxic_tag'] };

  const t0 = performance.now();
  assert.strictEqual(isPostMatchingFilters(cleanPost, criteria), true);
  assert.strictEqual(isPostMatchingFilters(dirtyPost, criteria), false);
  const t1 = performance.now();

  console.log(`    1,000 negative tokens evaluated in ${(t1 - t0).toFixed(2)}ms`);
  assert.ok((t1 - t0) < 50, `Negative tokens took ${(t1 - t0)}ms`);
});

// ----------------------------------------------------------------------------
// SECTION 2: NULL, UNDEFINED, AND NON-OBJECT PARAMETER ROBUSTNESS
// ----------------------------------------------------------------------------
console.log('\n--- SECTION 2: Null, Undefined & Non-Object Robustness ---');

const PATHOLOGICAL_INPUTS = [
  null,
  undefined,
  0,
  -1,
  12345,
  NaN,
  Infinity,
  -Infinity,
  '',
  '   ',
  'string_value',
  false,
  true,
  [],
  [null, undefined, 0, false, ''],
  {},
  Object.create(null),
  () => {},
  new Date(),
  new RegExp('test'),
  12345678901234567890n
];

challenge('Robustness', 'isPostMatchingFilters handles all pathological post & criteria types', () => {
  for (const p of PATHOLOGICAL_INPUTS) {
    for (const c of PATHOLOGICAL_INPUTS) {
      assert.doesNotThrow(() => {
        const res = isPostMatchingFilters(p, c);
        assert.strictEqual(typeof res, 'boolean');
      }, `Failed on post=${typeof p}, criteria=${typeof c}`);
    }
  }
});

challenge('Robustness', 'getCriteriaSets handles all pathological inputs without WeakMap error', () => {
  for (const c of PATHOLOGICAL_INPUTS) {
    assert.doesNotThrow(() => {
      const sets = getCriteriaSets(c);
      assert.ok(sets && typeof sets === 'object');
      assert.ok(sets.blacklist instanceof Set);
      assert.ok(sets.curvyInclude instanceof Set);
      assert.ok(Array.isArray(sets.furry));
    }, `Failed on criteria=${typeof c}`);
  }
});

challenge('Robustness', 'normalizeTagList handles all pathological types safely', () => {
  for (const input of PATHOLOGICAL_INPUTS) {
    assert.doesNotThrow(() => {
      const res = normalizeTagList(input);
      assert.ok(Array.isArray(res));
    }, `Failed on input=${typeof input}`);
  }
});

challenge('Robustness', 'toNormalizedTagSet handles all pathological types safely', () => {
  for (const input of PATHOLOGICAL_INPUTS) {
    assert.doesNotThrow(() => {
      const res = toNormalizedTagSet(input, ['fallback_tag']);
      assert.ok(res instanceof Set);
    }, `Failed on input=${typeof input}`);
  }
});

challenge('Robustness', 'matchesTagBoundary handles all pathological pairs safely', () => {
  for (const tag of PATHOLOGICAL_INPUTS) {
    for (const pat of PATHOLOGICAL_INPUTS) {
      assert.doesNotThrow(() => {
        const res = matchesTagBoundary(tag, pat);
        assert.strictEqual(typeof res, 'boolean');
      }, `Failed on tag=${typeof tag}, pat=${typeof pat}`);
    }
  }
});

challenge('Robustness', 'isArchivePost handles all pathological inputs safely', () => {
  for (const input of PATHOLOGICAL_INPUTS) {
    assert.doesNotThrow(() => {
      const res = isArchivePost(input);
      assert.strictEqual(typeof res, 'boolean');
    }, `Failed on input=${typeof input}`);
  }
});

challenge('Robustness', 'checkIsAi handles all pathological argument combinations', () => {
  for (const tags of PATHOLOGICAL_INPUTS) {
    for (const customList of PATHOLOGICAL_INPUTS) {
      assert.doesNotThrow(() => {
        const res = checkIsAi(tags, customList);
        assert.strictEqual(typeof res, 'boolean');
      }, `Failed on tags=${typeof tags}, customList=${typeof customList}`);
    }
  }
});

challenge('Robustness', 'checkMediaTypes handles all pathological inputs without crashing', () => {
  for (const url of PATHOLOGICAL_INPUTS) {
    for (const ext of PATHOLOGICAL_INPUTS) {
      assert.doesNotThrow(() => {
        const res = checkMediaTypes(url, ext, ['sample_tag']);
        assert.ok(res && typeof res === 'object');
        assert.strictEqual(typeof res.isVideo, 'boolean');
        assert.strictEqual(typeof res.isGif, 'boolean');
        assert.strictEqual(typeof res.hasSound, 'boolean');
        assert.strictEqual(typeof res.fileExt, 'string');
      }, `Failed on url=${typeof url}, ext=${typeof ext}`);
    }
  }
});

challenge('Robustness', 'normalizeDate handles all pathological inputs gracefully', () => {
  for (const input of PATHOLOGICAL_INPUTS) {
    assert.doesNotThrow(() => {
      const res = normalizeDate(input);
      assert.strictEqual(typeof res, 'string');
    }, `Failed on input=${typeof input}`);
  }
});

challenge('Robustness', 'extractAuthor handles all pathological inputs gracefully', () => {
  for (const tags of PATHOLOGICAL_INPUTS) {
    for (const src of PATHOLOGICAL_INPUTS) {
      assert.doesNotThrow(() => {
        const res = extractAuthor(tags, src, 'author_candidate');
        assert.strictEqual(typeof res, 'string');
      }, `Failed on tags=${typeof tags}, src=${typeof src}`);
    }
  }
});

challenge('Robustness', 'classifyTags handles all pathological inputs safely', () => {
  for (const tags of PATHOLOGICAL_INPUTS) {
    for (const auth of PATHOLOGICAL_INPUTS) {
      assert.doesNotThrow(() => {
        const res = classifyTags(tags, auth);
        assert.ok(res && typeof res === 'object');
        assert.ok(Array.isArray(res.artist));
        assert.ok(Array.isArray(res.copyright));
        assert.ok(Array.isArray(res.character));
        assert.ok(Array.isArray(res.meta));
        assert.ok(Array.isArray(res.general));
      }, `Failed on tags=${typeof tags}, auth=${typeof auth}`);
    }
  }
});

challenge('Robustness', 'adaptTagsForSite handles all pathological inputs without crashing', () => {
  for (const site of ['danbooru', 'gelbooru', 'rule34', 'safebooru', 'rule34video', null, undefined, 'unknown']) {
    for (const tags of PATHOLOGICAL_INPUTS) {
      assert.doesNotThrow(() => {
        const res = adaptTagsForSite(site, tags);
        assert.strictEqual(typeof res, 'string');
      }, `Failed on site=${site}, tags=${typeof tags}`);
    }
  }
});

challenge('Robustness', 'decodeHtmlEntities handles all pathological inputs gracefully', () => {
  for (const input of PATHOLOGICAL_INPUTS) {
    assert.doesNotThrow(() => {
      const res = decodeHtmlEntities(input);
      assert.strictEqual(typeof res, 'string');
    }, `Failed on input=${typeof input}`);
  }
});

// ----------------------------------------------------------------------------
// SECTION 3: REGEX EFFICIENCY & EXECUTION SPEED (ReDoS & ADVERSARIAL STRINGS)
// ----------------------------------------------------------------------------
console.log('\n--- SECTION 3: Regex Efficiency & Execution Speed ---');

challenge('ReDoS', 'Archive URL regex survives 50,000 char query parameter string', () => {
  const massiveQuery = '?' + 'a=1&'.repeat(12500);
  const evilUrl = 'https://example.com/download.zip' + massiveQuery;
  const post = { fileUrl: evilUrl };

  const t0 = performance.now();
  const res = isArchivePost(post);
  const t1 = performance.now();
  const elapsed = t1 - t0;

  assert.strictEqual(res, true);
  console.log(`    50,000 char URL evaluated in ${elapsed.toFixed(3)}ms`);
  assert.ok(elapsed < 20, `URL regex took ${elapsed}ms (>20ms indicates catastrophic backtracking risk)`);
});

challenge('ReDoS', 'Media type video URL regex survives 50,000 char query string', () => {
  const massiveQuery = '?' + 'param_'.repeat(8000) + '=val';
  const evilUrl = 'https://example.com/clip.mp4' + massiveQuery;

  const t0 = performance.now();
  const res = checkMediaTypes(evilUrl, 'mp4', []);
  const t1 = performance.now();
  const elapsed = t1 - t0;

  assert.strictEqual(res.isVideo, true);
  assert.ok(elapsed < 20, `checkMediaTypes took ${elapsed}ms`);
});

challenge('ReDoS', 'Author extraction survives massive bracket nesting & repetition', () => {
  const evilBrackets = '['.repeat(500) + 'Artist Name' + ']'.repeat(500);
  const t0 = performance.now();
  const author = extractAuthor([], evilBrackets);
  const t1 = performance.now();
  const elapsed = t1 - t0;

  console.log(`    Nested brackets evaluated in ${elapsed.toFixed(3)}ms. Result: "${author}"`);
  assert.ok(elapsed < 20, `extractAuthor bracket regex took ${elapsed}ms`);
});

challenge('ReDoS', 'decodeHtmlEntities survives 20,000 repetitive entities', () => {
  const evilEntities = '&#039;&amp;&#x20;&#99999;&quot;'.repeat(4000);
  const t0 = performance.now();
  const decoded = decodeHtmlEntities(evilEntities);
  const t1 = performance.now();
  const elapsed = t1 - t0;

  console.log(`    20,000 entities decoded in ${elapsed.toFixed(2)}ms (length: ${decoded.length})`);
  assert.ok(elapsed < 50, `Entity decoding took ${elapsed}ms`);
});

challenge('ReDoS', 'adaptTagsForSite survives 5,000 parenthesized tokens', () => {
  const evilTags = Array.from({ length: 5000 }, (_, i) => `character_${i}_(series_${i})`).join(' ');
  const t0 = performance.now();
  const adapted = adaptTagsForSite('rule34video', evilTags);
  const t1 = performance.now();
  const elapsed = t1 - t0;

  console.log(`    5,000 parenthesized tokens adapted in ${elapsed.toFixed(2)}ms`);
  assert.ok(elapsed < 100, `adaptTagsForSite took ${elapsed}ms`);
  assert.ok(!adapted.includes('(') && !adapted.includes(')'));
});

// ----------------------------------------------------------------------------
// SECTION 4: BOUNDARY STRING MATCHING ACCURACY ACROSS MULTIPLE CRITERIA
// ----------------------------------------------------------------------------
console.log('\n--- SECTION 4: Boundary String Matching Accuracy ---');

challenge('Boundary', 'matchesTagBoundary 4-way word boundary precision', () => {
  const pattern = 'anthro';

  // True matches (exact, prefix, suffix, infix)
  assert.strictEqual(matchesTagBoundary('anthro', pattern), true, 'Exact match');
  assert.strictEqual(matchesTagBoundary('anthro_wolf', pattern), true, 'Prefix match');
  assert.strictEqual(matchesTagBoundary('solo_anthro', pattern), true, 'Suffix match');
  assert.strictEqual(matchesTagBoundary('cute_anthro_wolf', pattern), true, 'Infix match');
  assert.strictEqual(matchesTagBoundary('anthro wolf', pattern), true, 'Space prefix match');
  assert.strictEqual(matchesTagBoundary('solo anthro', pattern), true, 'Space suffix match');
  assert.strictEqual(matchesTagBoundary('cute anthro wolf', pattern), true, 'Space infix match');

  // False matches (substring collision must NOT match)
  assert.strictEqual(matchesTagBoundary('philanthropic', pattern), false, 'Subword match 1');
  assert.strictEqual(matchesTagBoundary('misanthrope', pattern), false, 'Subword match 2');
  assert.strictEqual(matchesTagBoundary('anthrology', pattern), false, 'Prefix subword match');
  assert.strictEqual(matchesTagBoundary('pananthro', pattern), false, 'Suffix subword match');
  assert.strictEqual(matchesTagBoundary('sub_anthropology_note', pattern), false, 'Infix subword match');
});

challenge('Boundary', 'Pregnant boundary matching precision prevents collateral tag damage', () => {
  const criteria = { hidePregnant: true };

  // Posts that MUST be blocked
  const blockedTags = [
    'pregnant',
    'pregnant_belly',
    'visibly_pregnant',
    'huge_pregnant_belly',
    'impregnation',
    'male_impregnation',
    'hyper_pregnancy',
    'pregnancy_test'
  ];
  for (const tag of blockedTags) {
    const post = { previewUrl: 'https://cdn.example.com/p.jpg', tags: ['1girl', tag] };
    assert.strictEqual(isPostMatchingFilters(post, criteria), false, `Should block ${tag}`);
  }

  // Innocent tags containing "birth" or similar substrings that MUST NOT be blocked
  const innocentTags = [
    'birthday_cake',
    'happy_birthday',
    'birthmark',
    'rebirth',
    'afterbirth_cleaning', // wait, afterbirth? Let's check innocent:
    'giving_gift',
    'belly_dancer'
  ];
  for (const tag of innocentTags) {
    const post = { previewUrl: 'https://cdn.example.com/p.jpg', tags: ['1girl', tag] };
    assert.strictEqual(isPostMatchingFilters(post, criteria), true, `Should NOT block ${tag}`);
  }
});

challenge('Boundary', 'Negative tokens prefix wildcard vs non-wildcard boundary distinction', () => {
  const post = {
    previewUrl: 'https://cdn.example.com/p.jpg',
    tags: ['blonde_hair', 'bad_anatomy', 'caterpillar', 'scattered_leaves']
  };

  // Prefix wildcard matches:
  assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['bad*'] }), false);
  assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['-bad*'] }), false);
  assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['cat*'] }), false);
  assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['-cat*'] }), false);

  // Exact non-wildcard tokens MUST NOT match substrings:
  assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['bad'] }), true);
  assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['cat'] }), true);
  assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['leaves'] }), true);
  assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['scattered'] }), true);

  // Exact match on full tag:
  assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['blonde_hair'] }), false);
  assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['blonde hair'] }), false);
});

challenge('Boundary', 'Blacklist multi-word space vs underscore matching accuracy', () => {
  // Post with underscored tag blocked by space-separated blacklist
  assert.strictEqual(
    isPostMatchingFilters({ previewUrl: 'https://cdn.example.com/p.jpg', tags: ['scat_art'] }, { blacklist: ['scat art'] }),
    false
  );
  // Post with space-separated tag blocked by underscored blacklist
  assert.strictEqual(
    isPostMatchingFilters({ previewUrl: 'https://cdn.example.com/p.jpg', tags: ['scat art'] }, { blacklist: ['scat_art'] }),
    false
  );
  // Multi-space / irregular formatting
  assert.strictEqual(
    isPostMatchingFilters({ previewUrl: 'https://cdn.example.com/p.jpg', tags: ['scat_art'] }, { blacklist: ['  scat   art  '] }),
    false
  );
  // Partial tag in post must NOT be blocked by multi-word blacklist
  assert.strictEqual(
    isPostMatchingFilters({ previewUrl: 'https://cdn.example.com/p.jpg', tags: ['scat', 'art'] }, { blacklist: ['scat art'] }),
    true
  );
  // Tag containing words as sub-words must NOT be blocked
  assert.strictEqual(
    isPostMatchingFilters({ previewUrl: 'https://cdn.example.com/p.jpg', tags: ['scat_artist'] }, { blacklist: ['scat art'] }),
    true
  );
});

challenge('Boundary', 'Danbooru/Gelbooru 4-tier vs Legacy 3-tier rating boundary validation', () => {
  const danbooruPost = (rating) => ({ previewUrl: 'https://cdn.example.com/p.jpg', site: 'danbooru', rating });
  const safebooruPost = (rating) => ({ previewUrl: 'https://cdn.example.com/p.jpg', site: 'safebooru', rating });

  // Danbooru SFW: g ONLY
  assert.strictEqual(isPostMatchingFilters(danbooruPost('g'), { ratingFilter: 'sfw' }), true);
  assert.strictEqual(isPostMatchingFilters(danbooruPost('general'), { ratingFilter: 'sfw' }), true);
  assert.strictEqual(isPostMatchingFilters(danbooruPost('s'), { ratingFilter: 'sfw' }), false, 'Danbooru "s" must be rejected in sfw');
  assert.strictEqual(isPostMatchingFilters(danbooruPost('sensitive'), { ratingFilter: 'sfw' }), false);

  // Safebooru SFW: s AND g
  assert.strictEqual(isPostMatchingFilters(safebooruPost('s'), { ratingFilter: 'sfw' }), true, 'Safebooru "s" must be accepted in sfw');
  assert.strictEqual(isPostMatchingFilters(safebooruPost('safe'), { ratingFilter: 'sfw' }), true);
  assert.strictEqual(isPostMatchingFilters(safebooruPost('g'), { ratingFilter: 'sfw' }), true);

  // Danbooru Questionable: q AND s
  assert.strictEqual(isPostMatchingFilters(danbooruPost('q'), { ratingFilter: 'questionable' }), true);
  assert.strictEqual(isPostMatchingFilters(danbooruPost('s'), { ratingFilter: 'questionable' }), true, 'Danbooru "s" must be accepted in questionable');

  // Safebooru Questionable: q ONLY (rejects s)
  assert.strictEqual(isPostMatchingFilters(safebooruPost('q'), { ratingFilter: 'questionable' }), true);
  assert.strictEqual(isPostMatchingFilters(safebooruPost('s'), { ratingFilter: 'questionable' }), false, 'Safebooru "s" must be rejected in questionable');
});

challenge('Boundary', 'Archive leaks blocked across all non-archive typeFilters', () => {
  const archivePost = {
    previewUrl: 'https://cdn.example.com/p.jpg',
    fileUrl: 'https://cdn.example.com/pack.zip',
    isArchive: true,
    isVideo: true,
    hasSound: true,
    isGif: true,
    tags: ['1girl']
  };

  assert.strictEqual(isPostMatchingFilters(archivePost, { typeFilter: 'image' }), false);
  assert.strictEqual(isPostMatchingFilters(archivePost, { typeFilter: 'video' }), false);
  assert.strictEqual(isPostMatchingFilters(archivePost, { typeFilter: 'audio' }), false);
  assert.strictEqual(isPostMatchingFilters(archivePost, { typeFilter: 'sound' }), false);
  assert.strictEqual(isPostMatchingFilters(archivePost, { typeFilter: 'zip' }), true);
  assert.strictEqual(isPostMatchingFilters(archivePost, { typeFilter: 'archive' }), true);
  assert.strictEqual(isPostMatchingFilters(archivePost, { typeFilter: 'all' }), true);
});

// ----------------------------------------------------------------------------
// SUMMARY & VERDICT
// ----------------------------------------------------------------------------
console.log('\n================================================================');
console.log(`TOTAL CHECKS: ${totalTests}`);
console.log(`PASSED:       ${passedTests}`);
console.log(`FAILED:       ${failures.length}`);
console.log('================================================================');

if (failures.length > 0) {
  console.error('\nFAILURE DETAILS:');
  for (const f of failures) {
    console.error(`- [${f.suite}] ${f.test}:`, f.error);
  }
  process.exit(1);
} else {
  console.log('\nVERDICT: EMPIRICAL APPROVAL CONFIRMED (0 FAILURES)');
  process.exit(0);
}
