import assert from 'node:assert/strict';
import { parseIsoDuration, formatDurationSeconds } from '../src/parsers/rule34video.js';
import { normalizeDapiRating } from '../src/parsers/dapi.js';
import { normalizeGelbooruRating, parseDapiXmlPosts } from '../src/parsers/gelbooru.js';
import { createMockAgent, restoreDispatcher, assertNormalizedPost } from '../test/unit/parsers/harness.js';
import { fetchDanbooru, fetchDanbooruPostById } from '../src/parsers/danbooru.js';
import { fetchGelbooru, fetchGelbooruPostById } from '../src/parsers/gelbooru.js';
import { fetchSafebooru, fetchSafebooruPostById } from '../src/parsers/safebooru.js';
import { fetchMoebooru, fetchMoebooruPostById } from '../src/parsers/moebooru.js';
import { fetchRule34, fetchRule34PostById } from '../src/parsers/rule34.js';
import { fetchRule34Video } from '../src/parsers/rule34video.js';
import { fetchXbooru, fetchHypnohub, fetchTbib, fetchXbooruPostById, fetchHypnohubPostById, fetchTbibPostById } from '../src/parsers/dapi.js';
import { fetchKemono, fetchKemonoPostById } from '../src/parsers/kemono.js';
import { fetchPawchive, fetchPawchivePostById } from '../src/parsers/pawchive.js';
import { fetchPosts, fetchSingleSiteBatch } from '../src/parsers/index.js';

console.log('--- Starting Auditor M2 Adversarial Stress Tests ---');

// 1. Stress test parseIsoDuration
assert.equal(parseIsoDuration('PT1H'), 3600);
assert.equal(parseIsoDuration('PT20M'), 1200);
assert.equal(parseIsoDuration('PT0S'), 0);
assert.equal(parseIsoDuration('PT1H2M3S'), 3723);
assert.equal(parseIsoDuration('not-a-duration'), 0);
assert.equal(parseIsoDuration(null), 0);
assert.equal(parseIsoDuration(undefined), 0);
assert.equal(parseIsoDuration(12345), 0);
assert.equal(parseIsoDuration({}), 0);
console.log('✔ parseIsoDuration stress test passed');

// 2. Stress test formatDurationSeconds
assert.equal(formatDurationSeconds(0), '');
assert.equal(formatDurationSeconds(-1), '');
assert.equal(formatDurationSeconds(59), '0:59');
assert.equal(formatDurationSeconds(60), '1:00');
assert.equal(formatDurationSeconds(3600), '1:00:00');
assert.equal(formatDurationSeconds(3661), '1:01:01');
assert.equal(formatDurationSeconds(NaN), '');
assert.equal(formatDurationSeconds(null), '');
assert.equal(formatDurationSeconds(undefined), '');
console.log('✔ formatDurationSeconds stress test passed');

// 3. Stress test normalizeDapiRating
assert.equal(normalizeDapiRating('SAFE'), 's');
assert.equal(normalizeDapiRating('safe'), 's');
assert.equal(normalizeDapiRating('GENERAL'), 's');
assert.equal(normalizeDapiRating('sensitive'), 'q');
assert.equal(normalizeDapiRating('QUESTIONABLE'), 'q');
assert.equal(normalizeDapiRating('EXPLICIT'), 'e');
assert.equal(normalizeDapiRating(null, 'default'), 'default');
assert.equal(normalizeDapiRating(undefined, 'default'), 'default');
assert.equal(normalizeDapiRating(123, 'e'), 'e');
assert.equal(normalizeDapiRating({}, 's'), 's');
console.log('✔ normalizeDapiRating stress test passed');

// 4. Stress test normalizeGelbooruRating
assert.equal(normalizeGelbooruRating('general'), 'g');
assert.equal(normalizeGelbooruRating('GENERAL'), 'g');
assert.equal(normalizeGelbooruRating('sensitive'), 's');
assert.equal(normalizeGelbooruRating('SENSITIVE'), 's');
assert.equal(normalizeGelbooruRating('questionable'), 'q');
assert.equal(normalizeGelbooruRating('explicit'), 'e');
assert.equal(normalizeGelbooruRating('safe'), 'g');
assert.equal(normalizeGelbooruRating(null), 'g');
assert.equal(normalizeGelbooruRating(undefined), 'g');
assert.equal(normalizeGelbooruRating('unknown'), 'u'); // fallback r.charAt(0)
console.log('✔ normalizeGelbooruRating stress test passed');

// 5. Stress test parseDapiXmlPosts
assert.deepEqual(parseDapiXmlPosts(''), []);
assert.deepEqual(parseDapiXmlPosts('   '), []);
assert.deepEqual(parseDapiXmlPosts('not xml at all'), []);
assert.deepEqual(parseDapiXmlPosts('<posts count="0"></posts>'), []);
const single = parseDapiXmlPosts('<posts><post id="42" tags="tag1 tag2" rating="s" file_url="https://img.com/42.jpg"/></posts>');
assert.equal(single.length, 1);
assert.equal(single[0].id, '42');
assert.equal(single[0].tags, 'tag1 tag2');
console.log('✔ parseDapiXmlPosts stress test passed');

// 6. Network mock resilience test with empty / broken responses
const { agent, originalDispatcher } = createMockAgent();

try {
  // Test Danbooru broken response
  const danbooruClient = agent.get('https://danbooru.donmai.us');
  danbooruClient.intercept({ path: (p) => p.includes('posts.json'), method: 'GET' }).reply(500, 'Server Error');
  const dRes = await fetchDanbooru({ tags: 'test' }, [], {});
  assert.deepEqual(dRes, [], 'Danbooru should return empty array on 500');

  // Test Danbooru empty json
  danbooruClient.intercept({ path: (p) => p.includes('posts.json'), method: 'GET' }).reply(200, []);
  const dEmpty = await fetchDanbooru({ tags: 'test' }, [], {});
  assert.deepEqual(dEmpty, [], 'Danbooru should return empty array on empty response');

  // Test Rule34 invalid ID
  const rInvalid = await fetchRule34PostById('not_a_number', [], {});
  assert.equal(rInvalid, null, 'Rule34 with invalid ID should return null');

  // Test Moebooru invalid ID
  const mInvalid = await fetchMoebooruPostById('yandere', 'https://yande.re', 'Yande.re', 'abc', [], {});
  assert.equal(mInvalid, null, 'Moebooru with invalid ID should return null');

  // Test Kemono invalid ID
  const kInvalid = await fetchKemonoPostById('', '', '', [], {});
  assert.equal(kInvalid, null, 'Kemono with empty ID should return null');

  // Test Pawchive invalid ID
  const pInvalid = await fetchPawchivePostById('', '', '', [], {});
  assert.equal(pInvalid, null, 'Pawchive with empty ID should return null');

  // Test Aggregator single-site unknown
  const aggUnknown = await fetchSingleSiteBatch('invalid_booru', {}, [], {});
  assert.deepEqual(aggUnknown, [], 'Aggregator should return [] for unknown site');

  console.log('✔ Network & input edge cases resilience test passed');
} finally {
  restoreDispatcher(originalDispatcher, agent);
}

console.log('--- ALL ADVERSARIAL STRESS TESTS COMPLETED SUCCESSFULLY ---');
