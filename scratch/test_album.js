import { fetchPawchive } from '../src/parsers/pawchive.js';
import { groupPostsIntoAlbums } from '../src/utils/albumHelper.js';

async function test() {
  const posts = await fetchPawchive({ tags: 'hyuk' }, []);
  const p = posts.find(x => x.originalId === '12154911');
  console.log('Pawchive raw post:', {
    id: p?.id,
    isAlbum: p?.isAlbum,
    albumCount: p?.albumCount,
    albumItemsCount: p?.albumItems?.length,
    albumItems: p?.albumItems?.map(a => ({ id: a.id, fileUrl: a.fileUrl, previewUrl: a.previewUrl }))
  });

  const grouped = groupPostsIntoAlbums(posts);
  const pGrouped = grouped.find(x => x.originalId === '12154911');
  console.log('Grouped post:', {
    id: pGrouped?.id,
    isAlbum: pGrouped?.isAlbum,
    albumCount: pGrouped?.albumCount,
    albumItemsCount: pGrouped?.albumItems?.length
  });
}

test().catch(console.error);
