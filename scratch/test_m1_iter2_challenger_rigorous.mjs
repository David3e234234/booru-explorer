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

console.log('====================================================');
console.log('   M1 ITERATION 2: RIGOROUS ADVERSARIAL CHALLENGE   ');
console.log('====================================================');

const results = {
  total: 0,
  passed: 0,
  failed: 0,
  findings: []
};

function check(name, fn) {
  results.total++;
  try {
    fn();
    results.passed++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    results.failed++;
    console.log(`[FAIL] ${name} -> ${err.message}`);
    results.findings.push({ name, details: err.message });
  }
}

// -------------------------------------------------------------
// SECTION 1: PREVIOUS 6 DEFECTS REGRESSION
// -------------------------------------------------------------
console.log('\n--- Section 1: Previous 6 Defect Reproductions ---');

check('Bug 1: isArchivePost({ fileUrl: 12345 }) does not throw', () => {
  assert.strictEqual(isArchivePost({ fileUrl: 12345 }), false);
  assert.strictEqual(isArchivePost({ sampleUrl: 67890 }), false);
  assert.strictEqual(isArchivePost({ fileExt: 999 }), false);
});

check('Bug 2: isPostMatchingFilters({ rating: 1 }) does not throw', () => {
  const p = { previewUrl: 'https://example.com/p.jpg', rating: 1 };
  assert.strictEqual(isPostMatchingFilters(p, { ratingFilter: 'nsfw' }), false);
  assert.strictEqual(isPostMatchingFilters(p, { ratingFilter: 'sfw' }), false);
});

check('Bug 3: matchesTagBoundary(12345, "anthro") does not throw', () => {
  assert.strictEqual(matchesTagBoundary(12345, 'anthro'), false);
  assert.strictEqual(matchesTagBoundary('anthro', 12345), false);
  assert.strictEqual(matchesTagBoundary(null, undefined), false);
});

check('Bug 4: extractAuthor([null, "artist:wlop"]) does not throw and extracts artist', () => {
  assert.strictEqual(extractAuthor([null, 'artist:wlop']), 'wlop');
  assert.strictEqual(extractAuthor([undefined, 123, 'wlop_(artist)']), 'wlop');
});

check('Bug 5: classifyTags([], 12345) does not throw and ignores numeric author', () => {
  const res = classifyTags([], 12345);
  assert.deepStrictEqual(res.artist, []);
  assert.deepStrictEqual(res.general, []);
});

check('Bug 6: adaptTagsForSite("danbooru", ["1girl"]) does not throw on array', () => {
  const res = adaptTagsForSite('danbooru', ['1girl', 'solo']);
  assert.ok(res.includes('1girl'));
  assert.ok(res.includes('solo'));
  assert.strictEqual(adaptTagsForSite('danbooru', 12345), '12345');
});

// -------------------------------------------------------------
// SECTION 2: ADVERSARIAL UNICODE, EMOJIS, AND PUNCTUATION
// -------------------------------------------------------------
console.log('\n--- Section 2: Adversarial Unicode, Emojis, & Special Characters ---');

check('Non-ASCII CJK and Cyrillic in tags and blacklist', () => {
  const post = {
    previewUrl: 'https://example.com/p.jpg',
    tags: ['初音ミク', '東方_project', 'гуро', 'девушка_с_кошачьими_ушками', 'kawaii_🌸_flower']
  };
  // Blacklist exact match on Russian tag
  assert.strictEqual(isPostMatchingFilters(post, { blacklist: ['гуро'] }), false);
  // Blacklist spaced vs underscored on Japanese tag
  assert.strictEqual(isPostMatchingFilters(post, { blacklist: ['東方 project'] }), false);
  // Negative token on Cyrillic
  assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['-гуро'] }), false);
  // Negative token on CJK
  assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['-初音ミク'] }), false);
  // Clean post passes
  const cleanPost = {
    previewUrl: 'https://example.com/p.jpg',
    tags: ['初音ミク', 'kawaii_🌸_flower']
  };
  assert.strictEqual(isPostMatchingFilters(cleanPost, { blacklist: ['гуро', '東方_project'] }), true);
});

check('Punctuation tags: colons, slashes, brackets, dots, pluses', () => {
  const post = {
    previewUrl: 'https://example.com/p.jpg',
    tags: ['re:zero', 'fate/stay_night', 'c++', 'tag.with.dots', '[bracket_tag]']
  };
  // Exact matches
  assert.strictEqual(isPostMatchingFilters(post, { blacklist: ['re:zero'] }), false);
  assert.strictEqual(isPostMatchingFilters(post, { blacklist: ['c++'] }), false);
  assert.strictEqual(isPostMatchingFilters(post, { blacklist: ['fate/stay_night'] }), false);
  assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['-c++'] }), false);
  assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['-re:zero'] }), false);
});

// -------------------------------------------------------------
// SECTION 3: PROTOTYPE POLLUTION & OBJECT INJECTION
// -------------------------------------------------------------
console.log('\n--- Section 3: Prototype Pollution & Object Property Injection ---');

check('Post with prototype property names ("toString", "constructor", "__proto__")', () => {
  const protoPost = {
    previewUrl: 'https://example.com/p.jpg',
    tags: ['toString', 'constructor', '__proto__', 'valueOf', 'isPrototypeOf'],
    rating: 'g'
  };
  // Should not crash Set lookups or filter logic
  assert.doesNotThrow(() => isPostMatchingFilters(protoPost, { blacklist: ['scat'] }));
  assert.strictEqual(isPostMatchingFilters(protoPost, { blacklist: ['toString'] }), false);
  assert.strictEqual(isPostMatchingFilters(protoPost, { blacklist: ['constructor'] }), false);
  assert.strictEqual(isPostMatchingFilters(protoPost, { blacklist: ['scat'] }), true);
});

check('Criteria with prototype property names', () => {
  const weirdCriteria = {
    blacklist: ['toString', 'valueOf'],
    activeCurvyTags: ['constructor']
  };
  const normalPost = {
    previewUrl: 'https://example.com/p.jpg',
    tags: ['1girl', 'solo'],
    rating: 'g'
  };
  assert.doesNotThrow(() => isPostMatchingFilters(normalPost, weirdCriteria));
  assert.strictEqual(isPostMatchingFilters(normalPost, weirdCriteria), true);
});

// -------------------------------------------------------------
// SECTION 4: ARCHIVE & MEDIA EXTENSION ADVERSARIAL CASES
// -------------------------------------------------------------
console.log('\n--- Section 4: Archive & Media Extension Adversarial Cases ---');

check('Archive extensions in all formats and uppercase variants', () => {
  const exts = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'cbz', 'cbr', 'cb7', 'cbt', 'zst'];
  for (const ext of exts) {
    const pExt = { previewUrl: 'p.jpg', fileExt: ext.toUpperCase() };
    assert.strictEqual(isArchivePost(pExt), true, `Upper fileExt: ${ext.toUpperCase()}`);
    assert.strictEqual(isPostMatchingFilters(pExt, { typeFilter: 'image' }), false, `Reject image: ${ext}`);

    const pUrl = { previewUrl: 'p.jpg', fileUrl: `https://cdn.example.com/file.${ext.toUpperCase()}` };
    assert.strictEqual(isArchivePost(pUrl), true, `Upper fileUrl: ${ext.toUpperCase()}`);
    assert.strictEqual(isPostMatchingFilters(pUrl, { typeFilter: 'image' }), false, `Reject image url: ${ext}`);
  }
});

check('Double extensions (e.g. tar.gz, image.jpg.zip, doujin.cbz?auth=1#hash)', () => {
  const doubleArchive = {
    previewUrl: 'p.jpg',
    fileUrl: 'https://cdn.example.com/archive.tar.gz'
  };
  assert.strictEqual(isArchivePost(doubleArchive), true);
  assert.strictEqual(isPostMatchingFilters(doubleArchive, { typeFilter: 'image' }), false);

  const fakeImage = {
    previewUrl: 'p.jpg',
    fileUrl: 'https://cdn.example.com/image.jpg.zip?key=abc#section'
  };
  assert.strictEqual(isArchivePost(fakeImage), true);
  assert.strictEqual(isPostMatchingFilters(fakeImage, { typeFilter: 'image' }), false);

  // Real image with archive name in directory path or query param
  const realImage = {
    previewUrl: 'p.jpg',
    fileUrl: 'https://cdn.example.com/zip_archive/image.jpg?type=zip#zip'
  };
  assert.strictEqual(isArchivePost(realImage), false);
  assert.strictEqual(isPostMatchingFilters(realImage, { typeFilter: 'image' }), true);
});

check('Data URLs and Blob URLs', () => {
  const dataImg = {
    fileUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD',
    previewUrl: 'p.jpg'
  };
  assert.strictEqual(isArchivePost(dataImg), false);
  assert.strictEqual(isPostMatchingFilters(dataImg, { typeFilter: 'image' }), true);

  const blobImg = {
    fileUrl: 'blob:http://localhost:3000/1234-5678',
    previewUrl: 'p.jpg'
  };
  assert.strictEqual(isArchivePost(blobImg), false);
  assert.strictEqual(isPostMatchingFilters(blobImg, { typeFilter: 'image' }), true);
});

// -------------------------------------------------------------
// SECTION 5: RATING SCALE CASE & SITE NORMALIZATION
// -------------------------------------------------------------
console.log('\n--- Section 5: Rating Scale Case & Site Normalization ---');

check('Site name case insensitivity and whitespace stripping', () => {
  const variations = ['danbooru', 'Danbooru', 'DANBOORU', '  danbooru  ', 'DanBooru', 'gelbooru', 'Gelbooru', 'GELBOORU'];
  for (const site of variations) {
    // Under Danbooru/Gelbooru, rating 's' is sensitive (16+ questionable), NOT SFW general
    const postS = { site, rating: 's', previewUrl: 'p.jpg' };
    assert.strictEqual(isPostMatchingFilters(postS, { ratingFilter: 'sfw' }), false, `${site} s must NOT pass sfw`);
    assert.strictEqual(isPostMatchingFilters(postS, { ratingFilter: 'questionable' }), true, `${site} s MUST pass questionable`);

    // Rating 'g' is general (SFW)
    const postG = { site, rating: 'g', previewUrl: 'p.jpg' };
    assert.strictEqual(isPostMatchingFilters(postG, { ratingFilter: 'sfw' }), true, `${site} g MUST pass sfw`);
    assert.strictEqual(isPostMatchingFilters(postG, { ratingFilter: 'questionable' }), false, `${site} g must NOT pass questionable`);
  }
});

check('Legacy 3-tier sites case insensitivity', () => {
  const legacySites = ['safebooru', 'Safebooru', 'SAFEBOORU', 'rule34', 'Rule34', 'yandere', 'Yandere'];
  for (const site of legacySites) {
    const postS = { site, rating: 's', previewUrl: 'p.jpg' };
    assert.strictEqual(isPostMatchingFilters(postS, { ratingFilter: 'sfw' }), true, `${site} s MUST pass sfw`);
    assert.strictEqual(isPostMatchingFilters(postS, { ratingFilter: 'questionable' }), false, `${site} s must NOT pass questionable`);

    const postQ = { site, rating: 'q', previewUrl: 'p.jpg' };
    assert.strictEqual(isPostMatchingFilters(postQ, { ratingFilter: 'sfw' }), false, `${site} q must NOT pass sfw`);
    assert.strictEqual(isPostMatchingFilters(postQ, { ratingFilter: 'questionable' }), true, `${site} q MUST pass questionable`);
  }
});

// -------------------------------------------------------------
// SECTION 6: CONFLICTING TAGS & ARCHETYPE COMBINATIONS
// -------------------------------------------------------------
console.log('\n--- Section 6: Conflicting Tags & Archetype Filtering ---');

check('Conflicting tags on single post (loli + milf)', () => {
  const postConflict = {
    previewUrl: 'p.jpg',
    tags: ['loli', 'milf', 'solo', 'smile']
  };

  // Under adult filter: 'loli' is in CURVY_EXCLUDE_TAGS, so it must be rejected!
  assert.strictEqual(isPostMatchingFilters(postConflict, { ageFilter: 'adult' }), false);

  // Under young filter: 'milf' is in PETITE_EXCLUDE_TAGS, so it must be rejected!
  assert.strictEqual(isPostMatchingFilters(postConflict, { ageFilter: 'young' }), false);

  // Under all filter: passes
  assert.strictEqual(isPostMatchingFilters(postConflict, { ageFilter: 'all' }), true);
});

check('Custom tag sets passed as comma/space/newline strings or arrays', () => {
  const post = { previewUrl: 'p.jpg', tags: ['custom_curvy_body'] };

  // Comma-delimited string
  assert.strictEqual(isPostMatchingFilters(post, {
    ageFilter: 'adult',
    activeCurvyTags: 'custom_curvy_body, other_tag'
  }), true);

  // Newline-delimited string
  assert.strictEqual(isPostMatchingFilters(post, {
    ageFilter: 'adult',
    activeCurvyTags: 'custom_curvy_body\nother_tag'
  }), true);

  // Semicolon-delimited string
  assert.strictEqual(isPostMatchingFilters(post, {
    ageFilter: 'adult',
    activeCurvyTags: 'custom_curvy_body; other_tag'
  }), true);

  // Array with uppercase and whitespace
  assert.strictEqual(isPostMatchingFilters(post, {
    ageFilter: 'adult',
    activeCurvyTags: ['  Custom_Curvy_Body  ']
  }), true);
});

// -------------------------------------------------------------
// SECTION 7: ANIME FANGS & KEMONOMIMI FALSE POSITIVE AUDIT
// -------------------------------------------------------------
console.log('\n--- Section 7: Anime Fangs & Kemonomimi False Positive Audit ---');

check('Kemonomimi anime tags (cat_ears, dog_ears, wolf_ears, fox_ears) are preserved under hideFurry', () => {
  const kemonomimiTags = ['cat_ears', 'dog_ears', 'fox_ears', 'wolf_ears', 'catgirl', 'foxgirl', 'bunny_ears'];
  for (const tag of kemonomimiTags) {
    const post = { previewUrl: 'p.jpg', tags: [tag, '1girl', 'solo'] };
    const passed = isPostMatchingFilters(post, { hideFurry: true });
    assert.strictEqual(passed, true, `Kemonomimi tag '${tag}' should NOT be filtered by hideFurry`);
  }
});

// -------------------------------------------------------------
// SECTION 8: EXTREME SCALE & COMPLEXITY STRESS TEST
// -------------------------------------------------------------
console.log('\n--- Section 8: Extreme Scale & Complexity Stress Test ---');

check('Post with 50,000 tags evaluated across all active filters', () => {
  const tags50k = Array.from({ length: 50000 }, (_, i) => `descriptor_tag_${i}`);
  tags50k.push('milf', 'solo', 'safe_general_tag');

  const post50k = {
    previewUrl: 'https://cdn.example.com/p.jpg',
    fileUrl: 'https://cdn.example.com/image.jpg',
    tags: tags50k,
    rating: 'g',
    site: 'danbooru',
    isAi: false,
    isVideo: false,
    isArchive: false
  };

  const fullCriteria = {
    typeFilter: 'image',
    ageFilter: 'adult',
    aiFilter: 'no-ai',
    ratingFilter: 'sfw',
    hideFurry: true,
    hidePregnant: true,
    hideLgbt: true,
    blacklist: ['scat art', 'guro', 'extreme violence'],
    negativeTokens: ['-unwanted_tag_49999', 'bad_quality*']
  };

  const start = performance.now();
  const matched = isPostMatchingFilters(post50k, fullCriteria);
  const elapsed = performance.now() - start;

  console.log(`[PERF] 50,000 tags evaluation time: ${elapsed.toFixed(2)}ms`);
  assert.strictEqual(matched, true);
  assert.ok(elapsed < 1000, `50k tags took ${elapsed}ms, expected < 1000ms`);
});

check('Criteria with 2,000 blacklist tags evaluated on 100 posts', () => {
  const blacklist2k = Array.from({ length: 2000 }, (_, i) => `forbidden_tag_${i}`);
  const criteria2k = {
    blacklist: blacklist2k
  };

  const testPosts = Array.from({ length: 100 }, (_, i) => ({
    previewUrl: 'https://cdn.example.com/p.jpg',
    tags: [`tag_${i}`, '1girl', 'solo']
  }));

  const start = performance.now();
  for (const p of testPosts) {
    const matched = isPostMatchingFilters(p, criteria2k);
    assert.strictEqual(matched, true);
  }
  const elapsed = performance.now() - start;
  const avg = elapsed / 100;
  console.log(`[PERF] 2,000 blacklist tags across 100 posts: total ${elapsed.toFixed(2)}ms, avg ${avg.toFixed(2)}ms/post`);
  assert.ok(avg < 5, `Expected < 5ms/post with 2k blacklist items, got ${avg}ms`);
});

// -------------------------------------------------------------
// SUMMARY
// -------------------------------------------------------------
console.log('\n====================================================');
console.log(`TOTAL CHECKS: ${results.total}`);
console.log(`PASSED:       ${results.passed}`);
console.log(`FAILED:       ${results.failed}`);
console.log('====================================================');

if (results.failed > 0) {
  process.exit(1);
} else {
  console.log('ALL RIGOROUS ADVERSARIAL CHECKS PASSED EMPIRICALLY!');
  process.exit(0);
}
