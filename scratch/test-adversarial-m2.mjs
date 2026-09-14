import assert from 'node:assert/strict';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import { parseDapiXmlPosts, normalizeGelbooruRating } from '../src/parsers/gelbooru.js';
import { normalizeRule34Rating, fetchRule34PostById } from '../src/parsers/rule34.js';
import { normalizeDapiRating } from '../src/parsers/dapi.js';
import { parseIsoDuration, formatDurationSeconds } from '../src/parsers/rule34video.js';
import { isPostMatchingFilters } from '../src/utils/tagHelpers.js';
import { fetchDanbooru, fetchDanbooruPostById } from '../src/parsers/danbooru.js';
import { fetchSafebooru, fetchSafebooruPostById } from '../src/parsers/safebooru.js';
import { fetchMoebooru, fetchMoebooruPostById } from '../src/parsers/moebooru.js';
import { fetchKemono, fetchKemonoPostById } from '../src/parsers/kemono.js';
import { fetchPawchive, fetchPawchivePostById } from '../src/parsers/pawchive.js';
import { fetchAllgirl, fetchAllgirlPostById } from '../src/parsers/allgirl.js';
import { fetchSingleSiteBatch, fetchPosts } from '../src/parsers/index.js';
import { assertNormalizedPost } from '../test/unit/parsers/harness.js';

let passed = 0;
let total = 0;

function runTest(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✔ [PASS] ${name}`);
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(err);
    throw err;
  }
}

async function runAsyncTest(name, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  ✔ [PASS] ${name}`);
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(err);
    throw err;
  }
}

console.log('--- STARTING ADVERSARIAL STRESS TESTS FOR MILESTONE 2 ---');

// ==========================================
// Suite 1: parseDapiXmlPosts XML Edge Cases
// ==========================================
console.log('\n[Suite 1: XML Parsing Edge Cases]');

runTest('Handles empty, null, and non-string inputs safely', () => {
  assert.deepEqual(parseDapiXmlPosts(''), []);
  assert.deepEqual(parseDapiXmlPosts(null), []);
  assert.deepEqual(parseDapiXmlPosts(undefined), []);
  assert.deepEqual(parseDapiXmlPosts(123), []);
  assert.deepEqual(parseDapiXmlPosts({}), []);
});

runTest('Parses multiline attributes and mixed single/double quotes', () => {
  const xml = `
    <posts count="2">
      <post
        id='1001'
        file_url="https://example.com/1001.jpg"
        tags='girl solo 1girl'
        rating="general"
      />
      <post id="1002"
            file_url='https://example.com/1002.png'
            rating='explicit'
            score="50"
      ></post>
    </posts>
  `;
  const parsed = parseDapiXmlPosts(xml);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].id, '1001');
  assert.equal(parsed[0].file_url, 'https://example.com/1001.jpg');
  assert.equal(parsed[0].tags, 'girl solo 1girl');
  assert.equal(parsed[0].rating, 'general');

  assert.equal(parsed[1].id, '1002');
  assert.equal(parsed[1].file_url, 'https://example.com/1002.png');
  assert.equal(parsed[1].rating, 'explicit');
});

runTest('Parses posts with image & directory instead of file_url', () => {
  const xml = `<posts><post id="2001" directory="ab/cd" image="sample.jpg" rating="s" /></posts>`;
  const parsed = parseDapiXmlPosts(xml);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, '2001');
  assert.equal(parsed[0].directory, 'ab/cd');
  assert.equal(parsed[0].image, 'sample.jpg');
});

runTest('Ignores elements missing id or media attributes', () => {
  const xml = `
    <posts count="0">
      <post tags="no id here" file_url="https://test.com/a.jpg" />
      <post id="999" />
      <tag name="solo" count="500" />
    </posts>
  `;
  const parsed = parseDapiXmlPosts(xml);
  assert.equal(parsed.length, 0);
});

// ==========================================
// Suite 2: Gelbooru Rating Logic & SFW Filter Integration
// ==========================================
console.log('\n[Suite 2: Gelbooru Rating Logic & 4-Tier Integration]');

runTest('normalizeGelbooruRating maps all standard & legacy tiers accurately', () => {
  assert.equal(normalizeGelbooruRating('general'), 'g');
  assert.equal(normalizeGelbooruRating('safe'), 'g');
  assert.equal(normalizeGelbooruRating('g'), 'g');
  assert.equal(normalizeGelbooruRating('GENERAL'), 'g');
  assert.equal(normalizeGelbooruRating('SAFE'), 'g');

  assert.equal(normalizeGelbooruRating('sensitive'), 's');
  assert.equal(normalizeGelbooruRating('s'), 's');
  assert.equal(normalizeGelbooruRating('SENSITIVE'), 's');

  assert.equal(normalizeGelbooruRating('questionable'), 'q');
  assert.equal(normalizeGelbooruRating('q'), 'q');

  assert.equal(normalizeGelbooruRating('explicit'), 'e');
  assert.equal(normalizeGelbooruRating('e'), 'e');

  // Fallback
  assert.equal(normalizeGelbooruRating(''), 'g');
  assert.equal(normalizeGelbooruRating(null), 'g');
  assert.equal(normalizeGelbooruRating(undefined), 'g');
});

runTest('Gelbooru ratings interact with isPostMatchingFilters strictly in 4-tier mode', () => {
  const gPost = { id: 'gelbooru_1', originalId: '1', site: 'gelbooru', rating: 'g', tags: ['solo'], fileUrl: 'https://img.gelbooru.com/1.jpg' };
  const sPost = { id: 'gelbooru_2', originalId: '2', site: 'gelbooru', rating: 's', tags: ['solo'], fileUrl: 'https://img.gelbooru.com/2.jpg' };
  const qPost = { id: 'gelbooru_3', originalId: '3', site: 'gelbooru', rating: 'q', tags: ['solo'], fileUrl: 'https://img.gelbooru.com/3.jpg' };
  const ePost = { id: 'gelbooru_4', originalId: '4', site: 'gelbooru', rating: 'e', tags: ['solo'], fileUrl: 'https://img.gelbooru.com/4.jpg' };

  // SFW filter: ONLY g is accepted; s (sensitive) is 16+ so REJECTED
  assert.equal(isPostMatchingFilters(gPost, { ratingFilter: 'sfw' }), true, 'g must pass SFW');
  assert.equal(isPostMatchingFilters(sPost, { ratingFilter: 'sfw' }), false, 's must NOT pass SFW');
  assert.equal(isPostMatchingFilters(qPost, { ratingFilter: 'sfw' }), false, 'q must NOT pass SFW');
  assert.equal(isPostMatchingFilters(ePost, { ratingFilter: 'sfw' }), false, 'e must NOT pass SFW');

  // Questionable filter: s (sensitive) and q are accepted; g and e are rejected
  assert.equal(isPostMatchingFilters(gPost, { ratingFilter: 'questionable' }), false);
  assert.equal(isPostMatchingFilters(sPost, { ratingFilter: 'questionable' }), true, 's must pass questionable');
  assert.equal(isPostMatchingFilters(qPost, { ratingFilter: 'questionable' }), true, 'q must pass questionable');
  assert.equal(isPostMatchingFilters(ePost, { ratingFilter: 'questionable' }), false);

  // NSFW filter: ONLY e is accepted
  assert.equal(isPostMatchingFilters(gPost, { ratingFilter: 'nsfw' }), false);
  assert.equal(isPostMatchingFilters(sPost, { ratingFilter: 'nsfw' }), false);
  assert.equal(isPostMatchingFilters(qPost, { ratingFilter: 'nsfw' }), false);
  assert.equal(isPostMatchingFilters(ePost, { ratingFilter: 'nsfw' }), true, 'e must pass NSFW');
});

// ==========================================
// Suite 3: Paheal Prefix Preservation & Routing
// ==========================================
console.log('\n[Suite 3: Paheal Prefix Preservation & Routing]');

runTest('Paheal ID extraction and normalization logic', () => {
  // Simulating posts.routes.js:364 logic
  function resolveTargetPostId(targetPostId, targetSite) {
    const isPaheal = String(targetPostId).startsWith('paheal_') || targetSite === 'paheal';
    const numId = String(targetPostId).replace(/^(?:rule34_|paheal_)/, '').split('_')[0].trim();
    return isPaheal ? `paheal_${numId}` : numId;
  }

  assert.equal(resolveTargetPostId('paheal_12345', 'rule34'), 'paheal_12345');
  assert.equal(resolveTargetPostId('12345', 'paheal'), 'paheal_12345');
  assert.equal(resolveTargetPostId('paheal_12345', 'paheal'), 'paheal_12345');
  assert.equal(resolveTargetPostId('rule34_67890', 'rule34'), '67890');
  assert.equal(resolveTargetPostId('67890', 'rule34'), '67890');
});

// ==========================================
// Suite 4: Network Isolation & Hermeticity
// ==========================================
console.log('\n[Suite 4: Network Hermeticity via Undici MockAgent]');

await runAsyncTest('Unmocked network request throws immediately with NetConnectNotAllowedError', async () => {
  const orig = getGlobalDispatcher();
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);

  try {
    let threw = false;
    try {
      await fetch('https://danbooru.donmai.us/posts.json');
    } catch (err) {
      threw = true;
      assert.ok(err.message.includes('fetch failed') || err.name === 'TypeError' || err.code === 'UND_ERR_REQ_FAILED', `Expected Undici fetch failed, got: ${err.message}`);
    }
    assert.equal(threw, true, 'Outbound fetch must throw when disableNetConnect() is active');
  } finally {
    agent.close();
    setGlobalDispatcher(orig);
  }
});

// ==========================================
// Suite 5: Duration Parsing & Edge Cases (Rule34Video)
// ==========================================
console.log('\n[Suite 5: Rule34Video Duration Parsing]');

runTest('parseIsoDuration edge cases', () => {
  assert.equal(parseIsoDuration('PT1H'), 3600);
  assert.equal(parseIsoDuration('PT30M'), 1800);
  assert.equal(parseIsoDuration('PT45S'), 45);
  assert.equal(parseIsoDuration('PT1H2M3S'), 3723);
  assert.equal(parseIsoDuration('invalid'), 0);
  assert.equal(parseIsoDuration(null), 0);
});

runTest('formatDurationSeconds edge cases', () => {
  assert.equal(formatDurationSeconds(0), '');
  assert.equal(formatDurationSeconds(-5), '');
  assert.equal(formatDurationSeconds(9), '0:09');
  assert.equal(formatDurationSeconds(59), '0:59');
  assert.equal(formatDurationSeconds(60), '1:00');
  assert.equal(formatDurationSeconds(3600), '1:00:00');
  assert.equal(formatDurationSeconds(3661), '1:01:01');
});

console.log(`\n--- ALL ${passed}/${total} ADVERSARIAL STRESS TESTS COMPLETED SUCCESSFULLY ---`);
