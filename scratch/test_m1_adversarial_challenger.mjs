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
console.log('   M1 CHALLENGER 1: EMPIRICAL ADVERSARIAL HARNESS    ');
console.log('====================================================');

const results = {
  total: 0,
  passed: 0,
  failed: 0,
  findings: []
};

function record(name, status, details = '') {
  results.total++;
  if (status === 'PASS') {
    results.passed++;
    console.log(`[PASS] ${name}`);
  } else {
    results.failed++;
    console.log(`[FAIL/CHALLENGE] ${name} -> ${details}`);
    results.findings.push({ name, details });
  }
}

// -------------------------------------------------------------
// SUITE 1: 10,000 TAGS PERFORMANCE & STRESS TEST
// -------------------------------------------------------------
console.log('\n--- SUITE 1: 10,000 Tags Performance & Stress ---');
{
  const tags10k = Array.from({ length: 10000 }, (_, i) => `tag_${i}_descriptor`);
  tags10k.push('milf', 'solo', 'safe_tag');

  const post10k = {
    id: 'danbooru_10000',
    originalId: '10000',
    site: 'danbooru',
    previewUrl: 'https://cdn.example.com/preview.jpg',
    fileUrl: 'https://cdn.example.com/image.jpg',
    tags: tags10k,
    rating: 'g',
    isAi: false,
    isVideo: false,
    isArchive: false
  };

  const heavyCriteria = {
    typeFilter: 'image',
    ageFilter: 'adult',
    aiFilter: 'no-ai',
    ratingFilter: 'sfw',
    hideFurry: true,
    hidePregnant: true,
    hideLgbt: true,
    blacklist: ['scat art', 'guro', 'extreme violence'],
    negativeTokens: ['-unwanted_tag_9999', 'bad_quality*']
  };

  // Warm-up
  isPostMatchingFilters(post10k, heavyCriteria);

  // Measure single invocation latency
  const startSingle = performance.now();
  const matched = isPostMatchingFilters(post10k, heavyCriteria);
  const durSingle = performance.now() - startSingle;

  if (matched === true && durSingle < 200) {
    record(`Single post 10,000 tags latency (${durSingle.toFixed(2)}ms < 200ms)`, 'PASS');
  } else {
    record(`Single post 10,000 tags latency (${durSingle.toFixed(2)}ms)`, 'FAIL', `Latency exceeded threshold or matched !== true`);
  }

  // Measure batch of 20 posts with 10k tags (representing a search result page)
  const startBatch = performance.now();
  for (let i = 0; i < 20; i++) {
    isPostMatchingFilters(post10k, heavyCriteria);
  }
  const durBatch = performance.now() - startBatch;
  const avgPerPost = durBatch / 20;

  console.log(`[PERF] 20 posts x 10,000 tags: total ${durBatch.toFixed(2)}ms, average ${avgPerPost.toFixed(2)}ms/post`);
  if (avgPerPost < 150) {
    record(`Batch 20 posts x 10,000 tags throughput (${avgPerPost.toFixed(2)}ms/post)`, 'PASS');
  } else {
    record(`Batch 20 posts x 10,000 tags throughput`, 'FAIL', `High latency: ${avgPerPost.toFixed(2)}ms/post`);
  }

  // Memory stability check
  const memBefore = process.memoryUsage().heapUsed;
  for (let i = 0; i < 50; i++) {
    isPostMatchingFilters(post10k, heavyCriteria);
  }
  const memAfter = process.memoryUsage().heapUsed;
  const memDiffMb = (memAfter - memBefore) / 1024 / 1024;
  console.log(`[MEM] Heap delta after 50 runs: ${memDiffMb.toFixed(2)} MB`);
  if (memDiffMb < 30) {
    record(`Memory delta under 10k tags stress (${memDiffMb.toFixed(2)} MB)`, 'PASS');
  } else {
    record(`Memory delta under 10k tags stress`, 'FAIL', `Possible leak: ${memDiffMb.toFixed(2)} MB`);
  }
}

// -------------------------------------------------------------
// SUITE 2: MALFORMED POSTS (NULL/UNDEFINED/TYPES/SYMBOLS)
// -------------------------------------------------------------
console.log('\n--- SUITE 2: Malformed Posts & Extreme Fault Injection ---');
{
  // Check A: Non-string rating with active ratingFilter
  const malformedRatings = [
    { label: 'number 1', rating: 1 },
    { label: 'number 0', rating: 0 },
    { label: 'boolean true', rating: true },
    { label: 'symbol Symbol(sfw)', rating: Symbol('sfw') },
    { label: 'object {}', rating: {} },
    { label: 'array []', rating: [] }
  ];

  for (const { label, rating } of malformedRatings) {
    try {
      const p = { previewUrl: 'https://example.com/p.jpg', rating, tags: ['1girl'] };
      isPostMatchingFilters(p, { ratingFilter: 'sfw' });
      record(`Fault injection: post.rating is ${label} under ratingFilter=sfw`, 'PASS');
    } catch (err) {
      record(`Fault injection: post.rating is ${label} under ratingFilter=sfw`, 'FAIL', `Throws ${err.name}: ${err.message}`);
    }
  }

  // Check B: Non-string fileExt in isArchivePost and isPostMatchingFilters
  const malformedFileExts = [
    { label: 'number 123', fileExt: 123 },
    { label: 'boolean true', fileExt: true },
    { label: 'object {}', fileExt: {} },
    { label: 'symbol Symbol(ext)', fileExt: Symbol('ext') }
  ];

  for (const { label, fileExt } of malformedFileExts) {
    try {
      const p = { previewUrl: 'https://example.com/p.jpg', fileExt, tags: ['1girl'] };
      isPostMatchingFilters(p, {});
      record(`Fault injection: post.fileExt is ${label} in isPostMatchingFilters`, 'PASS');
    } catch (err) {
      record(`Fault injection: post.fileExt is ${label} in isPostMatchingFilters`, 'FAIL', `Throws ${err.name}: ${err.message}`);
    }
  }

  // Check C: Non-string fileUrl and sampleUrl
  const malformedUrls = [
    { label: 'fileUrl is 123', post: { fileUrl: 123, previewUrl: 'x' } },
    { label: 'sampleUrl is 123', post: { sampleUrl: 123, previewUrl: 'x' } },
    { label: 'fileUrl is Symbol', post: { fileUrl: Symbol('url'), previewUrl: 'x' } }
  ];

  for (const { label, post } of malformedUrls) {
    try {
      isPostMatchingFilters(post, { typeFilter: 'image' });
      record(`Fault injection: ${label} under typeFilter=image`, 'PASS');
    } catch (err) {
      record(`Fault injection: ${label} under typeFilter=image`, 'FAIL', `Throws ${err.name}: ${err.message}`);
    }
  }

  // Check D: Weird tags structures
  const weirdTagsPosts = [
    { label: 'tags is null', tags: null },
    { label: 'tags is undefined', tags: undefined },
    { label: 'tags is number', tags: 123 },
    { label: 'tags is string', tags: '1girl, solo' },
    { label: 'tags is plain object', tags: { 0: '1girl', length: 1 } },
    { label: 'tags is array of Symbols', tags: [Symbol('1girl'), Symbol('solo')] },
    { label: 'tags is array of nulls/undefined', tags: [null, undefined, '', '   '] },
    { label: 'tags is array of objects', tags: [{ tag: '1girl' }] }
  ];

  for (const { label, tags } of weirdTagsPosts) {
    try {
      const p = { previewUrl: 'https://example.com/p.jpg', tags };
      const res = isPostMatchingFilters(p, { hideFurry: true, blacklist: ['scat'] });
      record(`Fault injection: ${label}`, 'PASS');
    } catch (err) {
      record(`Fault injection: ${label}`, 'FAIL', `Throws ${err.name}: ${err.message}`);
    }
  }

  // Check E: Post with Symbol properties and prototype manipulation
  try {
    const symKey = Symbol('custom_prop');
    const p = {
      [symKey]: 'secret',
      previewUrl: 'https://example.com/p.jpg',
      tags: ['1girl']
    };
    const res = isPostMatchingFilters(p, {});
    assert.strictEqual(res, true);
    record(`Post with Symbol properties`, 'PASS');
  } catch (err) {
    record(`Post with Symbol properties`, 'FAIL', err.message);
  }

  // Check F: Post with throwing getter
  try {
    const p = {
      previewUrl: 'https://example.com/p.jpg',
      tags: ['1girl'],
      get score() { throw new Error('getter error'); }
    };
    const res = isPostMatchingFilters(p, {});
    assert.strictEqual(res, true);
    record(`Post with unaccessed throwing getter on score`, 'PASS');
  } catch (err) {
    record(`Post with unaccessed throwing getter on score`, 'FAIL', err.message);
  }
}

// -------------------------------------------------------------
// SUITE 3: RATING SCALE PERMUTATIONS (4-TIER VS 3-TIER)
// -------------------------------------------------------------
console.log('\n--- SUITE 3: Rating Scale Permutations & Case Sensitivity ---');
{
  // Test 1: Danbooru 4-tier exact mapping
  // Danbooru: g (general), s (sensitive), q (questionable), e (explicit)
  const danbooruG = { site: 'danbooru', rating: 'g', previewUrl: 'x' };
  const danbooruS = { site: 'danbooru', rating: 's', previewUrl: 'x' };
  const danbooruQ = { site: 'danbooru', rating: 'q', previewUrl: 'x' };
  const danbooruE = { site: 'danbooru', rating: 'e', previewUrl: 'x' };

  // SFW filter: only 'g' passes
  assert.strictEqual(isPostMatchingFilters(danbooruG, { ratingFilter: 'sfw' }), true);
  assert.strictEqual(isPostMatchingFilters(danbooruS, { ratingFilter: 'sfw' }), false);
  assert.strictEqual(isPostMatchingFilters(danbooruQ, { ratingFilter: 'sfw' }), false);
  assert.strictEqual(isPostMatchingFilters(danbooruE, { ratingFilter: 'sfw' }), false);
  record(`Danbooru 4-tier sfw filter (g=true, s=false, q=false, e=false)`, 'PASS');

  // Questionable filter: 's' and 'q' pass
  assert.strictEqual(isPostMatchingFilters(danbooruG, { ratingFilter: 'questionable' }), false);
  assert.strictEqual(isPostMatchingFilters(danbooruS, { ratingFilter: 'questionable' }), true);
  assert.strictEqual(isPostMatchingFilters(danbooruQ, { ratingFilter: 'questionable' }), true);
  assert.strictEqual(isPostMatchingFilters(danbooruE, { ratingFilter: 'questionable' }), false);
  record(`Danbooru 4-tier questionable filter (g=false, s=true, q=true, e=false)`, 'PASS');

  // NSFW filter: 'e' passes
  assert.strictEqual(isPostMatchingFilters(danbooruG, { ratingFilter: 'nsfw' }), false);
  assert.strictEqual(isPostMatchingFilters(danbooruS, { ratingFilter: 'nsfw' }), false);
  assert.strictEqual(isPostMatchingFilters(danbooruQ, { ratingFilter: 'nsfw' }), false);
  assert.strictEqual(isPostMatchingFilters(danbooruE, { ratingFilter: 'nsfw' }), true);
  record(`Danbooru 4-tier nsfw filter (g=false, s=false, q=false, e=true)`, 'PASS');

  // Test 2: Legacy 3-tier exact mapping (Safebooru, Rule34, Yandere, Konachan)
  // Legacy: s (safe), q (questionable), e (explicit)
  const legacyS = { site: 'safebooru', rating: 's', previewUrl: 'x' };
  const legacyQ = { site: 'safebooru', rating: 'q', previewUrl: 'x' };
  const legacyE = { site: 'safebooru', rating: 'e', previewUrl: 'x' };
  const legacyG = { site: 'safebooru', rating: 'g', previewUrl: 'x' };

  // SFW filter: 's' and 'g' pass
  assert.strictEqual(isPostMatchingFilters(legacyS, { ratingFilter: 'sfw' }), true);
  assert.strictEqual(isPostMatchingFilters(legacyG, { ratingFilter: 'sfw' }), true);
  assert.strictEqual(isPostMatchingFilters(legacyQ, { ratingFilter: 'sfw' }), false);
  assert.strictEqual(isPostMatchingFilters(legacyE, { ratingFilter: 'sfw' }), false);
  record(`Legacy 3-tier sfw filter (s=true, g=true, q=false, e=false)`, 'PASS');

  // Questionable filter: only 'q' passes, 's' is rejected
  assert.strictEqual(isPostMatchingFilters(legacyS, { ratingFilter: 'questionable' }), false);
  assert.strictEqual(isPostMatchingFilters(legacyQ, { ratingFilter: 'questionable' }), true);
  assert.strictEqual(isPostMatchingFilters(legacyE, { ratingFilter: 'questionable' }), false);
  record(`Legacy 3-tier questionable filter (s=false, q=true, e=false)`, 'PASS');

  // Test 3: Capitalized post.site ('Danbooru' / 'Gelbooru')
  const danbooruCaps = { site: 'Danbooru', rating: 's', previewUrl: 'x' };
  const gelbooruCaps = { site: 'Gelbooru', rating: 's', previewUrl: 'x' };

  const leakDanbooru = isPostMatchingFilters(danbooruCaps, { ratingFilter: 'sfw' });
  const leakGelbooru = isPostMatchingFilters(gelbooruCaps, { ratingFilter: 'sfw' });

  if (leakDanbooru === false && leakGelbooru === false) {
    record(`Capitalized post.site ('Danbooru' / 'Gelbooru') sensitive rejected in SFW`, 'PASS');
  } else {
    record(
      `Capitalized post.site ('Danbooru' / 'Gelbooru') sensitive rejected in SFW`,
      'FAIL',
      `post.site capitalization bypasses 4-tier check: Danbooru leaked=${leakDanbooru}, Gelbooru leaked=${leakGelbooru}`
    );
  }

  // Test 4: Danbooru post with rating 'safe' (word form)
  const danbooruSafeWord = { site: 'danbooru', rating: 'safe', previewUrl: 'x' };
  const danbooruSafeWordResult = isPostMatchingFilters(danbooruSafeWord, { ratingFilter: 'sfw' });
  console.log(`[OBSERVATION] Danbooru rating='safe' under sfw: ${danbooruSafeWordResult}`);
}

// -------------------------------------------------------------
// SUITE 4: COMPOUND FURRY & BLACKLIST TAG MATCHING
// -------------------------------------------------------------
console.log('\n--- SUITE 4: Compound Furry & Blacklist Tags ---');
{
  // Check A: Furry compounds
  const furryCompounds = [
    { tag: 'cute_furry_art', desc: 'infix furry' },
    { tag: 'furry_cat_art', desc: 'prefix furry with infix cat' },
    { tag: 'art_cute_furry', desc: 'suffix furry' },
    { tag: 'cute furry art', desc: 'spaced infix furry' },
    { tag: 'female_anthro_solo', desc: 'infix anthro' },
    { tag: 'solo_kemono_art', desc: 'infix kemono' }
  ];

  for (const { tag, desc } of furryCompounds) {
    const post = { previewUrl: 'x', tags: [tag] };
    const matched = isPostMatchingFilters(post, { hideFurry: true });
    if (matched === false) {
      record(`hideFurry hides compound: ${desc} ('${tag}')`, 'PASS');
    } else {
      record(`hideFurry hides compound: ${desc} ('${tag}')`, 'FAIL', `Post was not filtered`);
    }
  }

  // Check B: Blacklist space vs underscore symmetry
  const blacklistCases = [
    { blacklist: ['scat art'], postTags: ['scat_art'], desc: 'space in blacklist vs underscore in tag' },
    { blacklist: ['scat_art'], postTags: ['scat art'], desc: 'underscore in blacklist vs space in tag' },
    { blacklist: ['scat art'], postTags: ['scat   art'], desc: 'space in blacklist vs multiple spaces in tag' },
    { blacklist: ['scat art'], postTags: ['scat___art'], desc: 'space in blacklist vs multiple underscores in tag' },
    { blacklist: 'scat art, guro', postTags: ['scat_art'], desc: 'comma string blacklist' },
    { blacklist: ['  SCAT   ART  '], postTags: ['scat_art'], desc: 'untrimmed uppercase space blacklist' }
  ];

  for (const { blacklist, postTags, desc } of blacklistCases) {
    const post = { previewUrl: 'x', tags: postTags };
    const matched = isPostMatchingFilters(post, { blacklist });
    if (matched === false) {
      record(`Blacklist symmetry: ${desc}`, 'PASS');
    } else {
      record(`Blacklist symmetry: ${desc}`, 'FAIL', `Post was not filtered`);
    }
  }

  // Check C: Innocent tags should NOT be filtered by blacklist or furry
  const innocentTags = [
    { tag: 'birthday_cake', criteria: { hidePregnant: true }, desc: 'birthday_cake not hidden by hidePregnant' },
    { tag: 'philanthropic', criteria: { hideFurry: true }, desc: 'philanthropic not hidden by hideFurry' },
    { tag: 'art_museum', criteria: { blacklist: ['scat art'] }, desc: 'art_museum not hidden by scat art blacklist' },
    { tag: 'scattered_flowers', criteria: { blacklist: ['scat'] }, desc: 'scattered_flowers not hidden by scat blacklist' },
    { tag: 'canine_teeth', criteria: { hideFurry: true }, desc: 'canine_teeth anime tag under hideFurry' }
  ];

  for (const { tag, criteria, desc } of innocentTags) {
    const post = { previewUrl: 'x', tags: [tag] };
    const matched = isPostMatchingFilters(post, criteria);
    if (tag === 'canine_teeth') {
      console.log(`[OBSERVATION] canine_teeth under hideFurry: matched=${matched} (false means anime fang girl filtered)`);
    }
    if (tag !== 'canine_teeth') {
      if (matched === true) {
        record(`Innocent tag preservation: ${desc}`, 'PASS');
      } else {
        record(`Innocent tag preservation: ${desc}`, 'FAIL', `False positive: innocent tag was filtered`);
      }
    }
  }

  // Check D: Custom tags passed as string in criteria
  const customStringCriteria = {
    ageFilter: 'adult',
    activeCurvyTags: 'custom_curvy, voluptuous_milf',
    hasUserPositiveTags: false
  };
  const postCustomCurvy = { previewUrl: 'x', tags: ['custom_curvy'] };
  const matchedCustomStr = isPostMatchingFilters(postCustomCurvy, customStringCriteria);
  if (matchedCustomStr === true) {
    record(`Custom activeCurvyTags as comma-delimited string is recognized`, 'PASS');
  } else {
    record(
      `Custom activeCurvyTags as comma-delimited string is recognized`,
      'FAIL',
      `toNormalizedTagSet rejected string parameter and reverted to fallback CURVY_INCLUDE_TAGS`
    );
  }
}

// -------------------------------------------------------------
// SUITE 5: ARCHIVE FORMATS UNDER typeFilter === 'image'
// -------------------------------------------------------------
console.log('\n--- SUITE 5: Archive Formats under typeFilter === "image" ---');
{
  const archivePosts = [
    { label: 'isArchive: true', post: { isArchive: true, previewUrl: 'x' } },
    { label: 'fileExt: "zip"', post: { fileExt: 'zip', previewUrl: 'x' } },
    { label: 'fileExt: "rar"', post: { fileExt: 'rar', previewUrl: 'x' } },
    { label: 'fileExt: "7z"', post: { fileExt: '7z', previewUrl: 'x' } },
    { label: 'fileExt: "tar"', post: { fileExt: 'tar', previewUrl: 'x' } },
    { label: 'fileExt: "gz"', post: { fileExt: 'gz', previewUrl: 'x' } },
    { label: 'fileExt: "bz2"', post: { fileExt: 'bz2', previewUrl: 'x' } },
    { label: 'fileExt: "xz"', post: { fileExt: 'xz', previewUrl: 'x' } },
    { label: 'fileExt: "cbz"', post: { fileExt: 'cbz', previewUrl: 'x' } },
    { label: 'fileExt: "cbr"', post: { fileExt: 'cbr', previewUrl: 'x' } },
    { label: 'archiveUrls populated', post: { archiveUrls: ['https://example.com/p.zip'], previewUrl: 'x' } },
    { label: 'fileUrl: .zip', post: { fileUrl: 'https://cdn.example.com/art.zip', previewUrl: 'x' } },
    { label: 'fileUrl: .rar?key=1', post: { fileUrl: 'https://cdn.example.com/art.rar?key=1', previewUrl: 'x' } },
    { label: 'sampleUrl: .7z', post: { sampleUrl: 'https://cdn.example.com/art.7z', previewUrl: 'x' } },
    { label: 'fileUrl with hash fragment: .zip#dl', post: { fileUrl: 'https://cdn.example.com/art.zip#dl', previewUrl: 'x' } }
  ];

  for (const { label, post } of archivePosts) {
    const matched = isPostMatchingFilters(post, { typeFilter: 'image' });
    if (matched === false) {
      record(`Reject archive under typeFilter=image: ${label}`, 'PASS');
    } else {
      record(`Reject archive under typeFilter=image: ${label}`, 'FAIL', `Archive post leaked into image filter (matched=true)`);
    }
  }

  // Ensure normal images are NOT rejected
  const normalImages = [
    { label: 'jpg image', post: { fileUrl: 'https://cdn.example.com/art.jpg', previewUrl: 'x' } },
    { label: 'png image', post: { fileUrl: 'https://cdn.example.com/art.png', previewUrl: 'x' } },
    { label: 'webp image', post: { fileUrl: 'https://cdn.example.com/art.webp', previewUrl: 'x' } },
    { label: 'zip in query param (not ext)', post: { fileUrl: 'https://cdn.example.com/art.jpg?source=zip', previewUrl: 'x' } }
  ];

  for (const { label, post } of normalImages) {
    const matched = isPostMatchingFilters(post, { typeFilter: 'image' });
    if (matched === true) {
      record(`Accept clean image under typeFilter=image: ${label}`, 'PASS');
    } else {
      record(`Accept clean image under typeFilter=image: ${label}`, 'FAIL', `Clean image was falsely rejected`);
    }
  }
}

// -------------------------------------------------------------
// SUMMARY & VERDICT
// -------------------------------------------------------------
console.log('\n====================================================');
console.log(`TOTAL CHECKS: ${results.total}`);
console.log(`PASSED:       ${results.passed}`);
console.log(`FAILED:       ${results.failed}`);
console.log('====================================================');

if (results.failed > 0) {
  console.log('\nCONFIRMED DEFECTS / EMPIRICAL CHALLENGES:');
  results.findings.forEach((f, idx) => {
    console.log(`${idx + 1}. ${f.name}`);
    console.log(`   Details: ${f.details}`);
  });
}
