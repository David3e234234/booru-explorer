import { 
  getCreatorsDirectory, 
  getKemonoServices, 
  resolveKemonoCreators, 
  fetchKemono, 
  fetchKemonoPostById 
} from '../src/parsers/kemono.js';
import { extractSeriesKey } from '../src/utils/albumHelper.js';
import { isAllowedArchiveUrl } from '../src/services/archiveService.js';

async function runTests() {
  console.log('--- Starting Kemono Integration Tests ---');

  // Test 1: Services
  console.log('\n[1] Testing getKemonoServices...');
  const services = await getKemonoServices();
  console.log('Kemono services found:', services);
  if (!services.includes('patreon') || !services.includes('fanbox')) {
    throw new Error('Expected patreon and fanbox in services list');
  }

  // Test 2: Creators Directory & Resolution
  console.log('\n[2] Testing resolveKemonoCreators (directory search)...');
  const creators = await resolveKemonoCreators('wlop');
  console.log(`Found ${creators.length} creators for "wlop":`, creators.map(c => ({ id: c.id, name: c.name, service: c.service })));

  // Test 3: Fetch Posts Feed
  console.log('\n[3] Testing fetchKemono (recent feed)...');
  const feedPosts = await fetchKemono({ page: 1, limit: 5 });
  console.log(`Feed returned ${feedPosts.length} posts.`);
  if (feedPosts.length > 0) {
    const p0 = feedPosts[0];
    console.log('Sample post 0:', {
      id: p0.id,
      site: p0.site,
      author: p0.author,
      title: p0.title,
      fileUrl: p0.fileUrl?.slice(0, 50) + '...',
      previewUrl: p0.previewUrl?.slice(0, 50) + '...',
      isAlbum: p0.isAlbum,
      albumCount: p0.albumCount,
      seriesKey: p0.seriesKey
    });
  }

  // Test 4: Fetch Creator Posts
  console.log('\n[4] Testing fetchKemono for creator "wlop" (or first found creator)...');
  const targetCreator = creators[0] || { name: 'wlop', service: 'patreon', id: '2188612' };
  const creatorPosts = await fetchKemono({ query: `creator:${targetCreator.id}`, page: 1, limit: 5 });
  console.log(`Creator query returned ${creatorPosts.length} posts.`);
  if (creatorPosts.length > 0) {
    console.log('Creator sample post:', {
      id: creatorPosts[0].id,
      service: creatorPosts[0].service,
      user: creatorPosts[0].user,
      author: creatorPosts[0].author
    });
  }

  // Test 5: Fetch Single Post Details
  if (feedPosts.length > 0) {
    const sample = feedPosts[0];
    console.log(`\n[5] Testing fetchKemonoPostById for service=${sample.service}, user=${sample.user}, post=${sample.originalId}...`);
    const resolved = await fetchKemonoPostById({ 
      service: sample.service, 
      user: sample.user, 
      postId: sample.originalId 
    });
    if (resolved) {
      console.log('Resolved post details successfully:', {
        id: resolved.id,
        title: resolved.title,
        albumCount: resolved.albumCount,
        albumItemsLength: resolved.albumItems?.length
      });
    } else {
      console.log('Could not resolve individual post details');
    }
  }

  // Test 6: Album Helper & Series Key
  console.log('\n[6] Testing albumHelper for Kemono...');
  const fakePost = {
    site: 'kemono',
    source: 'https://kemono.cr/patreon/user/2188612/post/123456'
  };
  const key = extractSeriesKey(fakePost, 'kemono');
  console.log('Extracted seriesKey:', key);
  if (key !== 'kemono:patreon:2188612:123456') {
    throw new Error(`Unexpected seriesKey: ${key}`);
  }

  // Test 7: Archive Host Check
  console.log('\n[7] Testing isAllowedArchiveUrl for kemono.cr...');
  const kemonoAllowed = isAllowedArchiveUrl('https://n1.kemono.cr/data/sample.zip');
  console.log('n1.kemono.cr allowed:', kemonoAllowed);
  if (!kemonoAllowed) {
    throw new Error('Expected n1.kemono.cr to be allowed in isAllowedArchiveUrl');
  }

  console.log('\n[ALL TESTS PASSED SUCCESSFULLY]');
}

runTests().catch(err => {
  console.error('\n[TEST FAILED]:', err);
  process.exit(1);
});
