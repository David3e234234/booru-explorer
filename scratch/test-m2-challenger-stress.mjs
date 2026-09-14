import assert from 'node:assert/strict';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';

import { fetchDanbooru, fetchDanbooruPostById } from '../src/parsers/danbooru.js';
import { fetchGelbooru, fetchGelbooruPostById, normalizeGelbooruRating, parseDapiXmlPosts } from '../src/parsers/gelbooru.js';
import { fetchSafebooru, fetchSafebooruPostById } from '../src/parsers/safebooru.js';
import { fetchMoebooru, fetchMoebooruPostById } from '../src/parsers/moebooru.js';
import { fetchRule34, fetchRule34PostById } from '../src/parsers/rule34.js';
import { fetchRule34Video, resolveRule34VideoFullMedia, parseIsoDuration, formatDurationSeconds } from '../src/parsers/rule34video.js';
import { fetchXbooru, fetchHypnohub, fetchTbib, fetchXbooruPostById } from '../src/parsers/dapi.js';
import { fetchKemono, fetchKemonoPostById } from '../src/parsers/kemono.js';
import { fetchPawchive, fetchPawchivePostById } from '../src/parsers/pawchive.js';
import { fetchAllgirl, fetchAllgirlPostById } from '../src/parsers/allgirl.js';
import { fetchPosts, fetchSingleSiteBatch } from '../src/parsers/index.js';

// Setup MockAgent
const originalDispatcher = getGlobalDispatcher();
const mockAgent = new MockAgent();
mockAgent.disableNetConnect();
setGlobalDispatcher(mockAgent);

const MANDATORY_14_FIELDS = [
  'id', 'originalId', 'site', 'siteName',
  'fileUrl', 'sampleUrl', 'previewUrl',
  'thumb180', 'thumb360', 'thumb720',
  'isVideo', 'hasSound', 'tags', 'rating'
];

export function check14Fields(post, expectedSite = null) {
  const issues = [];
  if (!post || typeof post !== 'object') {
    return [`Post is not an object: ${String(post)}`];
  }
  for (const field of MANDATORY_14_FIELDS) {
    if (!(field in post)) {
      issues.push(`Missing field: ${field}`);
    } else if (post[field] === undefined) {
      issues.push(`Field "${field}" is undefined`);
    }
  }
  if (typeof post.id !== 'string' || !post.id) issues.push(`Invalid id: ${post.id}`);
  if (typeof post.originalId !== 'string' || !post.originalId) issues.push(`Invalid originalId: ${post.originalId}`);
  if (typeof post.site !== 'string' || !post.site) issues.push(`Invalid site: ${post.site}`);
  if (expectedSite && post.site !== expectedSite) issues.push(`Site mismatch: expected ${expectedSite}, got ${post.site}`);
  if (typeof post.siteName !== 'string' || !post.siteName) issues.push(`Invalid siteName: ${post.siteName}`);
  if (typeof post.fileUrl !== 'string') issues.push(`fileUrl not string: typeof ${typeof post.fileUrl}`);
  if (typeof post.sampleUrl !== 'string') issues.push(`sampleUrl not string: typeof ${typeof post.sampleUrl}`);
  if (typeof post.previewUrl !== 'string') issues.push(`previewUrl not string: typeof ${typeof post.previewUrl}`);
  if (typeof post.thumb180 !== 'string') issues.push(`thumb180 not string: typeof ${typeof post.thumb180}`);
  if (typeof post.thumb360 !== 'string') issues.push(`thumb360 not string: typeof ${typeof post.thumb360}`);
  if (typeof post.thumb720 !== 'string') issues.push(`thumb720 not string: typeof ${typeof post.thumb720}`);
  if (typeof post.isVideo !== 'boolean') issues.push(`isVideo not boolean: typeof ${typeof post.isVideo}`);
  if (typeof post.hasSound !== 'boolean') issues.push(`hasSound not boolean: typeof ${typeof post.hasSound}`);
  if (!Array.isArray(post.tags)) issues.push(`tags not Array: typeof ${typeof post.tags}`);
  if (typeof post.rating !== 'string' || !['g', 's', 'q', 'e'].includes(post.rating)) {
    issues.push(`Invalid rating: "${post.rating}" (must be one of 'g', 's', 'q', 'e')`);
  }
  // Thumb cascade: if any media URL exists, thumb tiers must not be empty
  if (post.fileUrl || post.sampleUrl || post.previewUrl) {
    if (!post.thumb180) issues.push('thumb180 empty while media URL present');
    if (!post.thumb360) issues.push('thumb360 empty while media URL present');
    if (!post.thumb720) issues.push('thumb720 empty while media URL present');
  }
  return issues;
}

const suiteResults = [];

async function runTest(name, fn) {
  try {
    await fn();
    suiteResults.push({ name, passed: true });
    console.log(`✔ ${name}`);
  } catch (err) {
    suiteResults.push({ name, passed: false, error: err.message });
    console.error(`✖ ${name}`);
    console.error(`  ${err.message}`);
  }
}

async function runAll() {
  console.log('=== EMPIRICAL CHALLENGER STRESS SUITE (M2) ===\n');

  // -------------------------------------------------------------------------
  // DEFECT 1: Moebooru returns undefined fileUrl and sampleUrl on missing media
  // -------------------------------------------------------------------------
  await runTest('DEFECT 1 (Moebooru): Missing media URLs in payload cause undefined fileUrl/sampleUrl', async () => {
    const client = mockAgent.get('https://yande.re');
    client.intercept({ path: (p) => p.startsWith('/post.json') && p.includes('tags=nomedia'), method: 'GET' })
      .reply(200, [{ id: 401, tags: 'solo', rating: 's', score: 10 }]);

    const posts = await fetchMoebooru('yandere', 'https://yande.re', 'Yande.re', { tags: 'nomedia', limit: 1 }, [], {});
    assert.equal(posts.length, 1);
    const issues = check14Fields(posts[0], 'yandere');
    assert.deepEqual(issues, [], `Contract violation: ${issues.join('; ')}`);
  });

  // -------------------------------------------------------------------------
  // DEFECT 2: Gelbooru rating normalization returns invalid characters for unknown ratings
  // -------------------------------------------------------------------------
  await runTest('DEFECT 2 (Gelbooru): normalizeGelbooruRating returns invalid characters for unrecognized ratings', () => {
    const ratings = ['unknown', 'none', 'other', '123', 'pending'];
    for (const r of ratings) {
      const normalized = normalizeGelbooruRating(r);
      assert.ok(
        ['g', 's', 'q', 'e'].includes(normalized),
        `normalizeGelbooruRating('${r}') returned '${normalized}', which is not one of 'g', 's', 'q', 'e'`
      );
    }
  });

  // -------------------------------------------------------------------------
  // DEFECT 3: Gelbooru fetchGelbooruPostById returns ghost post on missing/deleted post
  // -------------------------------------------------------------------------
  await runTest('DEFECT 3 (Gelbooru): fetchGelbooruPostById returns phantom post when HTML contains no image/post', async () => {
    const client = mockAgent.get('https://gelbooru.com');
    // DAPI 404
    client.intercept({ path: (p) => p.includes('page=dapi') && p.includes('id=999999'), method: 'GET' })
      .reply(404, 'Not found');
    // HTML page has no post/image (deleted post page or soft 404)
    client.intercept({ path: (p) => p.includes('s=view') && p.includes('id=999999'), method: 'GET' })
      .reply(200, '<html><head><title>Post Deleted</title></head><body>This post does not exist.</body></html>');

    const post = await fetchGelbooruPostById('999999', [], {});
    assert.equal(post, null, 'fetchGelbooruPostById should return null for non-existent/image-less post');
  });

  // -------------------------------------------------------------------------
  // DEFECT 4: Danbooru crashes with TypeError when API payload contains null items
  // -------------------------------------------------------------------------
  await runTest('DEFECT 4 (Danbooru): Unhandled TypeError when API payload contains null elements', async () => {
    const client = mockAgent.get('https://danbooru.donmai.us');
    client.intercept({ path: (p) => p.startsWith('/posts.json') && p.includes('tags=nulltest'), method: 'GET' })
      .reply(200, [null]);

    let threw = false;
    let errMessage = '';
    try {
      await fetchDanbooru({ tags: 'nulltest' }, [], {});
    } catch (e) {
      threw = true;
      errMessage = e.message;
    }
    assert.equal(threw, false, `fetchDanbooru threw uncaught exception on null item: ${errMessage}`);
  });

  // -------------------------------------------------------------------------
  // DEFECT 5: Moebooru crashes with TypeError when API payload contains null items
  // -------------------------------------------------------------------------
  await runTest('DEFECT 5 (Moebooru): Unhandled TypeError when API payload contains null elements', async () => {
    const client = mockAgent.get('https://yande.re');
    client.intercept({ path: (p) => p.startsWith('/post.json') && p.includes('tags=nulltest2'), method: 'GET' })
      .reply(200, [null]);

    let threw = false;
    let errMessage = '';
    try {
      await fetchMoebooru('yandere', 'https://yande.re', 'Yande.re', { tags: 'nulltest2' }, [], {});
    } catch (e) {
      threw = true;
      errMessage = e.message;
    }
    assert.equal(threw, false, `fetchMoebooru threw uncaught exception on null item: ${errMessage}`);
  });

  // -------------------------------------------------------------------------
  // DEFECT 6: Safebooru crashes with TypeError when API payload contains null items
  // -------------------------------------------------------------------------
  await runTest('DEFECT 6 (Safebooru): Unhandled TypeError when API payload contains null elements', async () => {
    const client = mockAgent.get('https://safebooru.org');
    client.intercept({ path: (p) => p.includes('tags=nulltest3'), method: 'GET' })
      .reply(200, [null]);

    let threw = false;
    let errMessage = '';
    try {
      await fetchSafebooru({ tags: 'nulltest3' }, [], {});
    } catch (e) {
      threw = true;
      errMessage = e.message;
    }
    assert.equal(threw, false, `fetchSafebooru threw uncaught exception on null item: ${errMessage}`);
  });

  console.log('\n=== RESULTS SUMMARY ===');
  const total = suiteResults.length;
  const passed = suiteResults.filter(r => r.passed).length;
  const failed = suiteResults.filter(r => !r.passed).length;
  console.log(`Total Probes: ${total}, Confirmed Robust: ${passed}, Confirmed Deficiencies: ${failed}`);
}

runAll().catch(console.error);
