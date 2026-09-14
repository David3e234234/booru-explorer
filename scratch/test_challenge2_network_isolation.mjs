import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import assert from 'node:assert/strict';
import { fetchPosts, fetchSingleSiteBatch, fetchDanbooru, fetchSafebooru, fetchGelbooru, fetchRule34, fetchRule34Video, fetchMoebooru, fetchXbooru, fetchHypnohub, fetchTbib, fetchPawchive, fetchKemono, fetchAllgirl } from '../src/parsers/index.js';
import { fetchDanbooruPostById } from '../src/parsers/danbooru.js';
import { fetchGelbooruPostById } from '../src/parsers/gelbooru.js';
import { fetchRule34PostById } from '../src/parsers/rule34.js';
import { fetchSafebooruPostById } from '../src/parsers/safebooru.js';
import { fetchMoebooruPostById } from '../src/parsers/moebooru.js';
import { fetchXbooruPostById } from '../src/parsers/dapi.js';
import { fetchKemonoPostById } from '../src/parsers/kemono.js';
import { fetchPawchivePostById } from '../src/parsers/pawchive.js';
import { fetchAllgirlPostById } from '../src/parsers/allgirl.js';
import { resolveRule34VideoFullMedia } from '../src/parsers/rule34video.js';
import { fetchSafe, runWithDeadlineSignal } from '../src/utils/network.js';
import { assertNormalizedPost } from '../test/unit/parsers/harness.js';

const ALL_DOMAINS = [
  'https://danbooru.donmai.us',
  'https://gelbooru.com',
  'https://api.rule34.xxx',
  'https://rule34.xxx',
  'https://rule34.paheal.net',
  'https://rule34video.com',
  'https://safebooru.org',
  'https://yande.re',
  'https://konachan.com',
  'https://konachan.net',
  'https://xbooru.com',
  'https://hypnohub.net',
  'https://tbib.org',
  'https://kemono.cr',
  'https://pawchive.pw',
  'https://allgirl.booru.org'
];

const ALL_SITES = [
  'danbooru', 'yandere', 'safebooru', 'konachan',
  'rule34', 'gelbooru', 'rule34video', 'xbooru',
  'hypnohub', 'tbib', 'pawchive', 'kemono', 'allgirl'
];

let globalUnhandled = [];
process.on('unhandledRejection', (reason, promise) => {
  console.error('!!! UNHANDLED REJECTION DETECTED !!!', reason);
  globalUnhandled.push(reason);
});

function resetMocks() {
  const agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  return agent;
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('STARTING CHALLENGER 2: NETWORK RESILIENCE & TIMEOUT ISOLATION');
  console.log('================================================================\n');

  let passedTests = 0;
  let failedTests = 0;
  const findings = [];

  function recordResult(testName, passed, detail = '') {
    if (passed) {
      console.log(`  ✔ ${testName}`);
      passedTests++;
    } else {
      console.error(`  ✖ ${testName} - ${detail}`);
      failedTests++;
      findings.push({ testName, detail });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SUITE 1: Upstream 429 Rate Limiting
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('▶ SUITE 1: Upstream 429 Rate Limiting Handling');
  {
    const agent = resetMocks();
    for (const d of ALL_DOMAINS) {
      agent.get(d).intercept({ path: () => true, method: () => true }).reply(429, 'Rate limited').persist();
    }

    // 1.1 fetchSingleSiteBatch for all sites
    for (const site of ALL_SITES) {
      try {
        const res = await fetchSingleSiteBatch(site, { tags: 'test', limit: 10 }, [], {});
        recordResult(`429: fetchSingleSiteBatch('${site}') returns array without throwing`, Array.isArray(res) && res.length === 0);
      } catch (err) {
        recordResult(`429: fetchSingleSiteBatch('${site}') returns array without throwing`, false, `Threw: ${err.message}`);
      }
    }

    // 1.2 Single post resolvers under 429
    const singleResolvers = [
      ['danbooru', () => fetchDanbooruPostById('101')],
      ['gelbooru', () => fetchGelbooruPostById('102')],
      ['rule34', () => fetchRule34PostById('103')],
      ['safebooru', () => fetchSafebooruPostById('104')],
      ['moebooru', () => fetchMoebooruPostById('yandere', 'https://yande.re', '105')],
      ['xbooru', () => fetchXbooruPostById('106')],
      ['kemono', () => fetchKemonoPostById('107')],
      ['pawchive', () => fetchPawchivePostById('108')],
      ['allgirl', () => fetchAllgirlPostById('109')],
      ['rule34video', () => resolveRule34VideoFullMedia('https://rule34video.com/video/110', '110')]
    ];

    for (const [site, fn] of singleResolvers) {
      try {
        const res = await fn();
        recordResult(`429: single resolver for '${site}' returns null`, res === null);
      } catch (err) {
        recordResult(`429: single resolver for '${site}' returns null`, false, `Threw: ${err.message}`);
      }
    }

    // 1.3 fetchPosts in all-sites mode when all return 429
    try {
      const posts = await fetchPosts('all', { tags: 'cat', limit: 30 }, [], {});
      recordResult(`429: fetchPosts('all') returns empty array when all sites 429`, Array.isArray(posts) && posts.length === 0);
    } catch (err) {
      recordResult(`429: fetchPosts('all') returns empty array when all sites 429`, false, `Threw: ${err.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SUITE 2: Upstream 500 / 502 / 503 / 504 Internal Server Errors
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n▶ SUITE 2: Upstream 500 / 502 / 503 / 504 Error Isolation');
  {
    const agent = resetMocks();
    const errorCodes = [500, 502, 503, 504];
    ALL_DOMAINS.forEach((d, idx) => {
      const status = errorCodes[idx % errorCodes.length];
      agent.get(d).intercept({ path: () => true, method: () => true }).reply(status, `Error ${status}`).persist();
    });

    for (const site of ALL_SITES) {
      try {
        const res = await fetchSingleSiteBatch(site, { tags: 'test', limit: 10 }, [], {});
        recordResult(`5xx: fetchSingleSiteBatch('${site}') returns empty array`, Array.isArray(res) && res.length === 0);
      } catch (err) {
        recordResult(`5xx: fetchSingleSiteBatch('${site}') returns empty array`, false, `Threw: ${err.message}`);
      }
    }

    try {
      const posts = await fetchPosts('all', { tags: 'cat', limit: 30 }, [], {});
      recordResult(`5xx: fetchPosts('all') returns empty array without throwing`, Array.isArray(posts) && posts.length === 0);
    } catch (err) {
      recordResult(`5xx: fetchPosts('all') returns empty array without throwing`, false, `Threw: ${err.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SUITE 3: Socket Errors & Connection Disruptions (ECONNRESET, ETIMEDOUT, etc.)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n▶ SUITE 3: Socket Errors (ECONNRESET, ETIMEDOUT, DNS failure)');
  {
    const agent = resetMocks();
    for (const d of ALL_DOMAINS) {
      agent.get(d).intercept({ path: () => true, method: () => true }).replyWithError(new Error('read ECONNRESET')).persist();
    }

    // 3.1 Test all parsers individually under socket error
    const directParsers = [
      ['danbooru', () => fetchDanbooru({ tags: 'test' }, [], {})],
      ['gelbooru', () => fetchGelbooru({ tags: 'test' }, [], {})],
      ['rule34', () => fetchRule34({ tags: 'test' }, [], {})],
      ['rule34video', () => fetchRule34Video({ tags: 'test' }, [], {})],
      ['safebooru', () => fetchSafebooru({ tags: 'test' }, [], {})],
      ['yandere', () => fetchMoebooru('yandere', 'https://yande.re', 'Yande.re', { tags: 'test' }, [], {})],
      ['konachan', () => fetchMoebooru('konachan', 'https://konachan.com', 'Konachan', { tags: 'test' }, [], {})],
      ['xbooru', () => fetchXbooru({ tags: 'test' }, [], {})],
      ['hypnohub', () => fetchHypnohub({ tags: 'test' }, [], {})],
      ['tbib', () => fetchTbib({ tags: 'test' }, [], {})],
      ['pawchive', () => fetchPawchive({ tags: 'test' }, [], {})],
      ['kemono', () => fetchKemono({ tags: 'test' }, [], {})],
      ['allgirl', () => fetchAllgirl({ tags: 'test' }, [], {})]
    ];

    for (const [site, fn] of directParsers) {
      try {
        const res = await fn();
        recordResult(`SocketError: direct parser '${site}' returns empty array`, Array.isArray(res) && res.length === 0);
      } catch (err) {
        recordResult(`SocketError: direct parser '${site}' returns empty array`, false, `Direct parser '${site}' THREW: ${err.message}`);
      }
    }

    // 3.2 fetchSingleSiteBatch on socket error
    for (const site of ALL_SITES) {
      try {
        const res = await fetchSingleSiteBatch(site, { tags: 'test' }, [], {});
        recordResult(`SocketError: fetchSingleSiteBatch('${site}') returns empty array`, Array.isArray(res) && res.length === 0);
      } catch (err) {
        recordResult(`SocketError: fetchSingleSiteBatch('${site}') returns empty array`, false, `fetchSingleSiteBatch('${site}') THREW: ${err.message}`);
      }
    }

    // 3.3 fetchPosts single site on socket error
    for (const site of ALL_SITES) {
      try {
        const res = await fetchPosts(site, { tags: 'test', limit: 10 }, [], {});
        recordResult(`SocketError: fetchPosts('${site}') returns empty array`, Array.isArray(res) && res.length === 0);
      } catch (err) {
        recordResult(`SocketError: fetchPosts('${site}') returns empty array`, false, `fetchPosts('${site}') THREW: ${err.message}`);
      }
    }

    // 3.4 fetchPosts all-sites on socket error across all
    try {
      const posts = await fetchPosts('all', { tags: 'test', limit: 30 }, [], {});
      recordResult(`SocketError: fetchPosts('all') returns empty array`, Array.isArray(posts) && posts.length === 0);
    } catch (err) {
      recordResult(`SocketError: fetchPosts('all') returns empty array`, false, `fetchPosts('all') THREW: ${err.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SUITE 4: Timeout Aborts & withDeadline Isolation
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n▶ SUITE 4: Timeout Aborts & withDeadline Isolation');
  {
    const agent = resetMocks();

    // 4.1 Ambient deadline propagation via runWithDeadlineSignal
    let wasAborted = false;
    const testController = new AbortController();
    testController.signal.addEventListener('abort', () => { wasAborted = true; });

    // Mock hanging URL
    agent.get('https://example.com').intercept({ path: '/hang', method: 'GET' }).reply(200, () => {
      return new Promise(() => {}); // never resolves
    });

    const startHang = Date.now();
    const deadlinePromise = runWithDeadlineSignal(testController.signal, async () => {
      return await fetchSafe('https://example.com/hang', { timeout: 10000 });
    });

    // Abort after 100ms
    setTimeout(() => testController.abort(), 100);

    try {
      await deadlinePromise;
      recordResult('withDeadline: abort signal cancels in-flight fetchSafe', false, 'Did not abort');
    } catch (err) {
      const elapsed = Date.now() - startHang;
      const abortedProperly = wasAborted && elapsed < 1000;
      recordResult('withDeadline: abort signal cancels in-flight fetchSafe promptly', abortedProperly, `Elapsed: ${elapsed}ms, wasAborted: ${wasAborted}`);
    }

    // 4.2 Mixed all-sites query: 1 hung site, 2 fast sites
    const mixedAgent = resetMocks();
    // Safebooru hangs indefinitely
    mixedAgent.get('https://safebooru.org').intercept({ path: () => true, method: () => true }).reply(200, () => {
      return new Promise(() => {}); // hang
    }).persist();

    // Danbooru returns 1 post
    mixedAgent.get('https://danbooru.donmai.us').intercept({ path: () => true, method: () => true }).reply(200, [
      {
        id: 701,
        tag_string: 'cat solo',
        rating: 'g',
        file_url: 'https://danbooru.donmai.us/701.jpg',
        file_ext: 'jpg',
        media_asset: { variants: [{ type: '180x180', url: 'https://danbooru.donmai.us/701_180.jpg' }] }
      }
    ]).persist();

    // Yande.re returns 1 post
    mixedAgent.get('https://yande.re').intercept({ path: () => true, method: () => true }).reply(200, [
      {
        id: 702,
        tags: 'cat cute',
        rating: 's',
        file_url: 'https://yande.re/702.jpg',
        sample_url: 'https://yande.re/702_sample.jpg',
        preview_url: 'https://yande.re/702_preview.jpg'
      }
    ]).persist();

    const startMixed = Date.now();
    const mixedResults = await fetchPosts('custom', {
      customSites: 'safebooru,danbooru,yandere',
      tags: 'cat',
      limit: 10
    }, [], {});
    const mixedElapsed = Date.now() - startMixed;

    recordResult(
      'withDeadline: isolates hung site in all-sites mode and resolves within deadline',
      mixedElapsed < 5000 && mixedResults.length === 2,
      `Elapsed: ${mixedElapsed}ms, results count: ${mixedResults.length}`
    );

    if (mixedResults.length > 0) {
      mixedResults.forEach(p => assertNormalizedPost(p));
      recordResult('withDeadline: surviving posts satisfy 14-field normalization contract', true);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SUITE 5: Zero Unhandled Promise Rejections Verification
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n▶ SUITE 5: Global Unhandled Promise Rejections Check');
  {
    // Wait for any trailing asynchronous events or timers to settle
    await new Promise(r => setTimeout(r, 1000));
    const unhandledCount = globalUnhandled.length;
    recordResult(
      'Zero unhandled promise rejections during all network faults and aborts',
      unhandledCount === 0,
      `Detected ${unhandledCount} unhandled rejections: ${globalUnhandled.map(e => e?.message || e).join(', ')}`
    );
  }

  console.log('\n================================================================');
  console.log(`CHALLENGER 2 SUMMARY: ${passedTests} passed, ${failedTests} failed`);
  if (findings.length > 0) {
    console.log('CRITICAL FINDINGS:');
    findings.forEach(f => console.log(`  - [${f.testName}]: ${f.detail}`));
  }
  console.log('================================================================\n');

  return { passedTests, failedTests, findings };
}

runTestSuite().then(res => {
  if (res.failedTests > 0) {
    process.exit(1);
  }
  process.exit(0);
});
