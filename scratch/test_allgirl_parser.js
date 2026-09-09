import { fetchAllgirl, fetchAllgirlPostById } from '../src/parsers/allgirl.js';

async function testAllgirlParser() {
  console.log('Testing fetchAllgirl (latest)...');
  const posts = await fetchAllgirl({ limit: 5 }, []);
  console.log(`Fetched ${posts.length} posts.`);
  if (posts.length > 0) {
    const p = posts[0];
    console.log('Post 0:', {
      id: p.id,
      rating: p.rating,
      score: p.score,
      author: p.author,
      fileUrl: p.fileUrl,
      previewUrl: p.previewUrl,
      tagsCount: p.tags.length,
      tagDetails: {
        artist: p.tagDetails.artist,
        copyright: p.tagDetails.copyright,
        character: p.tagDetails.character,
        meta: p.tagDetails.meta,
        general: p.tagDetails.general.slice(0, 5)
      }
    });

    console.log('\nTesting fetchAllgirlPostById for id:', p.originalId);
    const resolved = await fetchAllgirlPostById(p.originalId, []);
    console.log('Resolved:', {
      id: resolved?.id,
      width: resolved?.width,
      height: resolved?.height,
      author: resolved?.author,
      createdAt: resolved?.createdAt,
      source: resolved?.source,
      tagsCount: resolved?.tags.length
    });
  }
}

testAllgirlParser();
