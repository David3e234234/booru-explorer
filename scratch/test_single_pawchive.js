import { fetchPawchivePostById } from '../src/parsers/pawchive.js';

async function testSingle() {
  const p = await fetchPawchivePostById('12154911', 'fanbox', '97869630');
  console.log('fetchPawchivePostById result:', {
    id: p?.id,
    title: p?.title,
    author: p?.author,
    isAlbum: p?.isAlbum,
    albumCount: p?.albumCount,
    items: p?.albumItems?.length
  });
}

testSingle().catch(console.error);
