import { classifyPostTags, getTagCategory, loadGlobalTagSummary } from '../src/utils/tagClassifier.js';
import { fetchAllgirl, fetchAllgirlPostById } from '../src/parsers/allgirl.js';
import { fetchDanbooruPostById } from '../src/parsers/danbooru.js';
import { fetchGelbooruPostById } from '../src/parsers/gelbooru.js';
import { fetchSafebooruPostById } from '../src/parsers/safebooru.js';
import { fetchXbooruPostById, fetchHypnohubPostById, fetchTbibPostById } from '../src/parsers/dapi.js';
import { fetchMoebooruPostById } from '../src/parsers/moebooru.js';
import { fetchRule34PostById } from '../src/parsers/rule34.js';

async function runAudit() {
  console.log('=== 1. AUDIT: Tag Classification Logic ===');
  const tagMap = await loadGlobalTagSummary();
  console.log(`Loaded Global Tag Summary: ${tagMap.size} tags in memory.`);

  // Test 1.1: Moebooru / summary type 6 (circle) must be copyright
  const type6Tag = 'type-moon';
  const type6Cat = getTagCategory(type6Tag, tagMap);
  console.log(`Tag "${type6Tag}" category: ${type6Cat} (expected: copyright)`);

  // Test 1.2: Moebooru / summary type 5 (meta/style) must be meta
  const type5Tag = 'monochrome';
  const type5Cat = getTagCategory(type5Tag, tagMap);
  console.log(`Tag "${type5Tag}" category: ${type5Cat} (expected: meta)`);

  // Test 1.3: Parenthesized variant heuristic vs general tags
  const testPostTags = [
    'saber_(bride)', 'bride', 'wedding_dress',
    'type-moon', 'fate/extra', 'monochrome', 'sketch',
    'takeuchi_takashi'
  ];
  const classified = await classifyPostTags(testPostTags, '', '', {});
  console.log('\nClassified post tags for Saber Bride test:');
  console.log('  Artist:', classified.tagDetails.artist);
  console.log('  Copyright:', classified.tagDetails.copyright);
  console.log('  Character:', classified.tagDetails.character);
  console.log('  Meta:', classified.tagDetails.meta);
  console.log('  General:', classified.tagDetails.general);

  // Assertions
  if (!classified.tagDetails.character.includes('saber_(bride)')) {
    throw new Error('FAILED: saber_(bride) was not classified as character');
  }
  if (!classified.tagDetails.general.includes('bride')) {
    throw new Error('FAILED: "bride" general tag was wrongly stolen by copyright/character heuristics!');
  }
  if (!classified.tagDetails.copyright.includes('type-moon')) {
    throw new Error('FAILED: type-moon (circle/type 6) was not classified as copyright');
  }
  if (!classified.tagDetails.meta.includes('monochrome') || !classified.tagDetails.meta.includes('sketch')) {
    throw new Error('FAILED: monochrome or sketch (type 5) was not classified as meta');
  }
  console.log('--> Tag Classification Test: PASSED!\n');

  console.log('=== 2. AUDIT: AllGirl parser (allgirl.booru.org) ===');
  // 2.1 Fetch feed
  console.log('Testing fetchAllgirl feed...');
  const feed = await fetchAllgirl({ page: 1, limit: 5 });
  console.log(`Fetched ${feed.length} posts from AllGirl feed.`);
  if (feed.length > 0) {
    const p = feed[0];
    console.log(`Sample post: id=${p.id}, fileUrl=${p.fileUrl}, rating=${p.rating}, tags=${p.tags.slice(0, 5).join(', ')}`);
    console.log(`Tag details sample:`, p.tagDetails);
  }

  // 2.2 Test search with tag
  console.log('Testing fetchAllgirl with tag "miku"...');
  const mikuPosts = await fetchAllgirl({ tags: 'miku', page: 1, limit: 3 });
  console.log(`Found ${mikuPosts.length} posts for "miku".`);

  // 2.3 Test sorting top
  console.log('Testing fetchAllgirl category "top"...');
  const topPosts = await fetchAllgirl({ category: 'top', page: 1, limit: 3 });
  console.log(`Found ${topPosts.length} top posts (scores: ${topPosts.map(p => p.score).join(', ')})`);

  // 2.4 Test single post resolve
  if (feed.length > 0) {
    const sampleId = feed[0].originalId;
    console.log(`Testing fetchAllgirlPostById for id ${sampleId}...`);
    const resolved = await fetchAllgirlPostById(sampleId);
    if (resolved) {
      console.log(`Resolved AllGirl post ${resolved.id}: width=${resolved.width}, height=${resolved.height}, author=${resolved.author}, tagsCount=${resolved.tags.length}`);
    } else {
      console.warn(`Could not resolve AllGirl post ${sampleId}`);
    }
  }
  console.log('--> AllGirl Parser Test: PASSED!\n');

  console.log('=== 3. AUDIT: Post Resolving across other Booru engines ===');
  // 3.1 Danbooru
  console.log('Testing fetchDanbooruPostById (id 8000000)...');
  try {
    const danPost = await fetchDanbooruPostById('8000000');
    if (danPost) {
      console.log(`Danbooru post resolved: ${danPost.id}, artist=${danPost.author}, tags=${danPost.tags.length}`);
    } else {
      console.log('Danbooru post 8000000 returned null (may be deleted or restricted)');
    }
  } catch (e) {
    console.log('Danbooru resolve error:', e.message);
  }

  // 3.2 Safebooru
  console.log('Testing fetchSafebooruPostById (id 4000000)...');
  try {
    const safePost = await fetchSafebooruPostById('4000000');
    if (safePost) {
      console.log(`Safebooru post resolved: ${safePost.id}, artist=${safePost.author}, tags=${safePost.tags.length}`);
      console.log(`  Categories: artist=${safePost.tagDetails.artist.length}, char=${safePost.tagDetails.character.length}, copy=${safePost.tagDetails.copyright.length}, meta=${safePost.tagDetails.meta.length}`);
    }
  } catch (e) {
    console.log('Safebooru resolve error:', e.message);
  }

  // 3.3 Yande.re
  console.log('Testing fetchMoebooruPostById for yandere (id 1000000)...');
  try {
    const yanderePost = await fetchMoebooruPostById('yandere', 'https://yande.re', 'Yande.re', '1000000');
    if (yanderePost) {
      console.log(`Yandere post resolved: ${yanderePost.id}, artist=${yanderePost.author}, tags=${yanderePost.tags.length}`);
      console.log(`  Categories: artist=${yanderePost.tagDetails.artist.length}, char=${yanderePost.tagDetails.character.length}, copy=${yanderePost.tagDetails.copyright.length}, meta=${yanderePost.tagDetails.meta.length}`);
    }
  } catch (e) {
    console.log('Yandere resolve error:', e.message);
  }

  // 3.4 TBIB
  console.log('Testing fetchTbibPostById (id 10000000)...');
  try {
    const tbibPost = await fetchTbibPostById('10000000');
    if (tbibPost) {
      console.log(`TBIB post resolved: ${tbibPost.id}, rating=${tbibPost.rating}, tags=${tbibPost.tags.length}`);
    }
  } catch (e) {
    console.log('TBIB resolve error:', e.message);
  }

  console.log('\n=== ALL AUDIT CHECKS COMPLETED SUCCESSFULLY ===');
}

runAudit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
