import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import * as tagHelpers from '../src/utils/tagHelpers.js';

const {
  normalizeTagList,
  toNormalizedTagSet,
  matchesTagBoundary,
  isArchivePost,
  getCriteriaSets,
  isPostMatchingFilters,
  checkIsAi,
  checkMediaTypes,
  normalizeDate,
  extractAuthor,
  classifyTags,
  adaptTagsForSite,
  decodeHtmlEntities
} = tagHelpers;

console.log('================================================================');
console.log('M1 ITERATION 2: PARAMETER RESILIENCE & FUZZING HARNESS');
console.log('Target: src/utils/tagHelpers.js (13 exported functions)');
console.log('================================================================\n');

const BASE_INPUTS = [
  null,
  undefined,
  true,
  false,
  0,
  1,
  -1,
  12345,
  NaN,
  Infinity,
  -Infinity,
  '',
  '   ',
  'normal_tag',
  'tag with spaces',
  'tag_with_underscores',
  [],
  [null, undefined, false, 0, 'sample', {}],
  {},
  { a: 1, b: 'two' },
  { length: 0 },
  { length: 5 },
  Object.create(null),
  () => {},
  new Date(),
  new RegExp('test'),
  new Set(['a', 'b']),
  new Map([['k', 'v']]),
  12345678901234567890n
];

let totalCalls = 0;
let caughtErrors = [];

function safeInvoke(fnName, fn, args) {
  totalCalls++;
  try {
    const res = fn(...args);
    return { ok: true, res };
  } catch (err) {
    caughtErrors.push({
      fnName,
      args: args.map(a => {
        try {
          if (typeof a === 'symbol') return a.toString();
          if (typeof a === 'bigint') return `${a}n`;
          if (typeof a === 'function') return '[Function]';
          if (a === null) return 'null';
          if (a === undefined) return 'undefined';
          if (typeof a === 'object') {
            if (Object.getPrototypeOf(a) === null) return '[Object: null prototype]';
            return JSON.stringify(a);
          }
          return String(a);
        } catch {
          return '[Unstringifiable]';
        }
      }),
      errorName: err.name,
      errorMessage: err.message,
      stack: err.stack
    });
    return { ok: false, error: err };
  }
}

// ----------------------------------------------------------------------------
// PHASE 1: DIRECT PARAMETER FUZZING ACROSS ALL 13 EXPORTED FUNCTIONS
// ----------------------------------------------------------------------------
console.log('--- PHASE 1: Direct Parameter Type Fuzzing ---');

// 1. normalizeTagList(list) - 1 arg
for (const val of BASE_INPUTS) {
  safeInvoke('normalizeTagList', normalizeTagList, [val]);
}
safeInvoke('normalizeTagList', normalizeTagList, []); // no args

// 2. toNormalizedTagSet(tags, fallback) - 2 args
for (const a of BASE_INPUTS) {
  for (const b of BASE_INPUTS) {
    safeInvoke('toNormalizedTagSet', toNormalizedTagSet, [a, b]);
  }
}
safeInvoke('toNormalizedTagSet', toNormalizedTagSet, []);

// 3. matchesTagBoundary(tag, pattern) - 2 args
for (const a of BASE_INPUTS) {
  for (const b of BASE_INPUTS) {
    safeInvoke('matchesTagBoundary', matchesTagBoundary, [a, b]);
  }
}
safeInvoke('matchesTagBoundary', matchesTagBoundary, []);

// 4. isArchivePost(post) - 1 arg
for (const val of BASE_INPUTS) {
  safeInvoke('isArchivePost', isArchivePost, [val]);
}
safeInvoke('isArchivePost', isArchivePost, []);

// 5. getCriteriaSets(criteria, ...7 active tags) - 8 args
for (const val of BASE_INPUTS) {
  safeInvoke('getCriteriaSets', getCriteriaSets, [val]);
  safeInvoke('getCriteriaSets', getCriteriaSets, [val, val, val, val, val, val, val, val]);
}
safeInvoke('getCriteriaSets', getCriteriaSets, []);

// 6. isPostMatchingFilters(post, criteria) - 2 args
for (const a of BASE_INPUTS) {
  for (const b of BASE_INPUTS) {
    safeInvoke('isPostMatchingFilters', isPostMatchingFilters, [a, b]);
  }
}
safeInvoke('isPostMatchingFilters', isPostMatchingFilters, []);

// 7. checkIsAi(tagsArray, aiTagsList) - 2 args
for (const a of BASE_INPUTS) {
  for (const b of BASE_INPUTS) {
    safeInvoke('checkIsAi', checkIsAi, [a, b]);
  }
}
safeInvoke('checkIsAi', checkIsAi, []);

// 8. checkMediaTypes(url, fileExt, rawTags) - 3 args
for (const a of BASE_INPUTS) {
  for (const b of BASE_INPUTS) {
    safeInvoke('checkMediaTypes', checkMediaTypes, [a, b, [a, b]]);
  }
}
safeInvoke('checkMediaTypes', checkMediaTypes, []);

// 9. normalizeDate(rawDate) - 1 arg
for (const val of BASE_INPUTS) {
  safeInvoke('normalizeDate', normalizeDate, [val]);
}
safeInvoke('normalizeDate', normalizeDate, []);

// 10. extractAuthor(rawTags, source, itemAuthor) - 3 args
for (const a of BASE_INPUTS) {
  for (const b of BASE_INPUTS) {
    safeInvoke('extractAuthor', extractAuthor, [a, b, a]);
  }
}
safeInvoke('extractAuthor', extractAuthor, []);

// 11. classifyTags(rawTags, author) - 2 args
for (const a of BASE_INPUTS) {
  for (const b of BASE_INPUTS) {
    safeInvoke('classifyTags', classifyTags, [a, b]);
  }
}
safeInvoke('classifyTags', classifyTags, []);

// 12. adaptTagsForSite(site, rawTags, ageFilter, typeFilter, settings) - 5 args
const siteSamples = ['danbooru', 'gelbooru', 'rule34', 'safebooru', 'rule34video', null, undefined, 123, false, {}];
for (const s of siteSamples) {
  for (const t of BASE_INPUTS) {
    safeInvoke('adaptTagsForSite', adaptTagsForSite, [s, t, 'all', 'all', null]);
    safeInvoke('adaptTagsForSite', adaptTagsForSite, [s, t, t, t, t]);
  }
}
safeInvoke('adaptTagsForSite', adaptTagsForSite, []);

// 13. decodeHtmlEntities(str) - 1 arg
for (const val of BASE_INPUTS) {
  safeInvoke('decodeHtmlEntities', decodeHtmlEntities, [val]);
}
safeInvoke('decodeHtmlEntities', decodeHtmlEntities, []);

console.log(`Phase 1 calls completed: ${totalCalls}`);
console.log(`Phase 1 unhandled exceptions: ${caughtErrors.length}`);
if (caughtErrors.length > 0) {
  for (const e of caughtErrors.slice(0, 10)) {
    console.log(`  ERROR in ${e.fnName}(${e.args.join(', ')}): [${e.errorName}] ${e.errorMessage}`);
  }
}

// ----------------------------------------------------------------------------
// PHASE 2: DEEP PROPERTY-LEVEL FUZZING FOR post AND criteria
// ----------------------------------------------------------------------------
console.log('\n--- PHASE 2: Deep Property-Level Fuzzing (post and criteria) ---');

const postFieldSamples = {
  id: [null, undefined, 123, 'post_1', {}, []],
  fileUrl: [null, undefined, 123, false, 'https://cdn.example.com/art.jpg', 'https://cdn.example.com/pack.zip?key=val#dl', {}, []],
  sampleUrl: [null, undefined, 123, false, 'https://cdn.example.com/sample.webm', {}, []],
  previewUrl: [null, undefined, 123, false, 'https://cdn.example.com/thumb.jpg', {}, []],
  fileExt: [null, undefined, 123, false, 'jpg', 'zip', 'cbz', '.cbz?dl=1', {}, []],
  tags: [null, undefined, 123, false, '1girl solo', ['1girl', null, 123, 'milf', {}], {}, []],
  rating: [null, undefined, 123, false, 's', 'g', 'q', 'e', 'explicit', 'safe', {}, []],
  site: [null, undefined, 123, false, 'danbooru', 'Danbooru', 'gelbooru', 'safebooru', {}, []],
  isVideo: [null, undefined, true, false, 0, 1, 'true', {}],
  isGif: [null, undefined, true, false, 0, 1, 'true', {}],
  hasSound: [null, undefined, true, false, 0, 1, 'true', {}],
  isAi: [null, undefined, true, false, 0, 1, 'true', {}],
  isArchive: [null, undefined, true, false, 0, 1, 'true', {}],
  archiveUrls: [null, undefined, [], ['https://cdn.example.com/1.zip'], 123, 'url', {}]
};

const criteriaFieldSamples = {
  typeFilter: ['all', 'image', 'video', 'audio', 'sound', 'zip', 'archive', null, undefined, 123, false, {}],
  ageFilter: ['all', 'adult', 'young', null, undefined, 123, false, {}],
  aiFilter: ['all', 'no-ai', 'only-ai', null, undefined, 123, false, {}],
  ratingFilter: ['all', 'sfw', 'questionable', '16+', 'nsfw', null, undefined, 123, false, {}],
  hideFurry: [true, false, null, undefined, 1, 0, {}],
  hidePregnant: [true, false, null, undefined, 1, 0, {}],
  hideLgbt: [true, false, null, undefined, 1, 0, {}],
  negativeTokens: [
    null,
    undefined,
    [],
    ['-ugly*'],
    ['-tag', 'bad_tag'],
    123,
    false,
    true,
    'string_token',
    {},
    { length: 0 },
    { length: 5 },
    [null, undefined, 123, false, {}, '-valid']
  ],
  blacklist: [
    null,
    undefined,
    [],
    ['scat art', 'guro'],
    'scat art, guro; blood',
    123,
    false,
    {},
    { length: 5 },
    [null, undefined, 123, 'blacklisted']
  ],
  activeCurvyTags: [null, undefined, [], ['milf'], 'milf, curvy', 123, false, {}],
  activePetiteTags: [null, undefined, [], ['petite'], 'petite, loli', 123, false, {}],
  activeFurryTags: [null, undefined, [], ['furry'], 'furry, anthro', 123, false, {}],
  activePregnantTags: [null, undefined, [], ['pregnant'], 'pregnant', 123, false, {}],
  activeLgbtTags: [null, undefined, [], ['yaoi'], 'yaoi, yuri', 123, false, {}],
  activeCurvyExcludeTags: [null, undefined, [], ['loli'], 123, {}],
  activePetiteExcludeTags: [null, undefined, [], ['milf'], 123, {}],
  hasUserPositiveTags: [true, false, null, undefined, 1, 0, {}]
};

// Generate 2,000 randomized post & criteria combinations
let deepFuzzPassed = 0;
for (let i = 0; i < 2000; i++) {
  const post = {};
  for (const [key, options] of Object.entries(postFieldSamples)) {
    post[key] = options[Math.floor(Math.random() * options.length)];
  }

  const criteria = {};
  for (const [key, options] of Object.entries(criteriaFieldSamples)) {
    criteria[key] = options[Math.floor(Math.random() * options.length)];
  }

  safeInvoke('isArchivePost', isArchivePost, [post]);
  safeInvoke('getCriteriaSets', getCriteriaSets, [criteria]);
  safeInvoke('isPostMatchingFilters', isPostMatchingFilters, [post, criteria]);
  deepFuzzPassed++;
}

console.log(`Deep property fuzzing completed: ${deepFuzzPassed} randomized pairs evaluated`);
console.log(`Total calls across all phases: ${totalCalls}`);
console.log(`Total unhandled exceptions: ${caughtErrors.length}`);

// ----------------------------------------------------------------------------
// PHASE 3: HIGH-THROUGHPUT PERFORMANCE STRESS TEST (>10,000 OPERATIONS)
// ----------------------------------------------------------------------------
console.log('\n--- PHASE 3: High-Throughput Performance Stress (>10,000 ops) ---');

const benchmarkCriteria = {
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

const syntheticPosts = [];
for (let i = 0; i < 2000; i++) {
  const isGood = (i % 5 === 0);
  syntheticPosts.push({
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
    isArchive: false
  });
}

// Perform 10 iterations over 2,000 posts = 20,000 operations!
const OP_COUNT = 20000;
console.log(`Executing ${OP_COUNT.toLocaleString()} filtering operations...`);

const tStart = performance.now();
let matchedTotal = 0;

for (let iter = 0; iter < 10; iter++) {
  for (let i = 0; i < syntheticPosts.length; i++) {
    if (isPostMatchingFilters(syntheticPosts[i], benchmarkCriteria)) {
      matchedTotal++;
    }
  }
}

const tEnd = performance.now();
const elapsedTotalMs = tEnd - tStart;
const opsPerSec = (OP_COUNT / (elapsedTotalMs / 1000));

console.log(`Performance Results:`);
console.log(`  Total operations: ${OP_COUNT.toLocaleString()}`);
console.log(`  Total time:       ${elapsedTotalMs.toFixed(2)}ms`);
console.log(`  Throughput:       ${opsPerSec.toFixed(0)} ops/sec`);
console.log(`  Avg time per op:  ${(elapsedTotalMs / OP_COUNT * 1000).toFixed(2)}µs`);
console.log(`  Total matches:    ${matchedTotal}`);

// ----------------------------------------------------------------------------
// PHASE 4: AUXILIARY FUNCTIONS THROUGHPUT (>10,000 OPERATIONS EACH)
// ----------------------------------------------------------------------------
console.log('\n--- PHASE 4: Auxiliary Functions Throughput (10,000 ops each) ---');

const AUX_OPS = 10000;

// 1. normalizeTagList throughput
const sampleTagList = ['1girl', 'solo', 'scat art', 'blue_hair', 'huge_breasts', 'highres'];
const t0_norm = performance.now();
for (let i = 0; i < AUX_OPS; i++) {
  normalizeTagList(sampleTagList);
}
const t1_norm = performance.now();
console.log(`  normalizeTagList: ${AUX_OPS.toLocaleString()} ops in ${(t1_norm - t0_norm).toFixed(2)}ms (${(AUX_OPS / ((t1_norm - t0_norm)/1000)).toFixed(0)} ops/s)`);

// 2. matchesTagBoundary throughput
const t0_match = performance.now();
for (let i = 0; i < AUX_OPS; i++) {
  matchesTagBoundary('female_anthro_wolf', 'anthro');
}
const t1_match = performance.now();
console.log(`  matchesTagBoundary: ${AUX_OPS.toLocaleString()} ops in ${(t1_match - t0_match).toFixed(2)}ms (${(AUX_OPS / ((t1_match - t0_match)/1000)).toFixed(0)} ops/s)`);

// 3. checkMediaTypes throughput
const t0_media = performance.now();
for (let i = 0; i < AUX_OPS; i++) {
  checkMediaTypes('https://cdn.example.com/video.webm?key=1#preview', 'webm', ['animated', 'web_audio']);
}
const t1_media = performance.now();
console.log(`  checkMediaTypes: ${AUX_OPS.toLocaleString()} ops in ${(t1_media - t0_media).toFixed(2)}ms (${(AUX_OPS / ((t1_media - t0_media)/1000)).toFixed(0)} ops/s)`);

// 4. classifyTags throughput
const dirtyTags = ['artist:wlop', 'fate_(series)', 'saber_(fate)', 'highres', 'sword', 'masterpiece'];
const t0_class = performance.now();
for (let i = 0; i < AUX_OPS; i++) {
  classifyTags(dirtyTags, 'wlop');
}
const t1_class = performance.now();
console.log(`  classifyTags: ${AUX_OPS.toLocaleString()} ops in ${(t1_class - t0_class).toFixed(2)}ms (${(AUX_OPS / ((t1_class - t0_class)/1000)).toFixed(0)} ops/s)`);

// 5. decodeHtmlEntities throughput
const htmlSample = '&lt;div class=&quot;post&quot;&gt;&#039;Hello &amp; World&#039;&lt;/div&gt;';
const t0_decode = performance.now();
for (let i = 0; i < AUX_OPS; i++) {
  decodeHtmlEntities(htmlSample);
}
const t1_decode = performance.now();
console.log(`  decodeHtmlEntities: ${AUX_OPS.toLocaleString()} ops in ${(t1_decode - t0_decode).toFixed(2)}ms (${(AUX_OPS / ((t1_decode - t0_decode)/1000)).toFixed(0)} ops/s)`);

// ----------------------------------------------------------------------------
// FINAL SUMMARY & DIAGNOSTICS
// ----------------------------------------------------------------------------
console.log('\n================================================================');
console.log('FINAL STRESS TEST SUMMARY');
console.log(`Total Invocations:     ${totalCalls.toLocaleString()}`);
console.log(`Exceptions Caught:     ${caughtErrors.length}`);
console.log(`Performance ops (>10k): ${OP_COUNT.toLocaleString()} main + ${(AUX_OPS * 5).toLocaleString()} auxiliary`);
console.log('================================================================');

if (caughtErrors.length > 0) {
  console.log('\nUNHANDLED EXCEPTIONS BREAKDOWN:');
  const errorMap = new Map();
  for (const err of caughtErrors) {
    const key = `${err.fnName}: [${err.errorName}] ${err.errorMessage}`;
    errorMap.set(key, (errorMap.get(key) || 0) + 1);
  }
  for (const [key, count] of errorMap.entries()) {
    console.log(`- ${key} (count: ${count})`);
  }
  process.exit(1);
} else {
  console.log('\nSUCCESS: Zero unhandled exceptions or TypeErrors across all tests!');
  process.exit(0);
}
