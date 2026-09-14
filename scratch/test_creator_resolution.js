import { resolveAuthorCreators, extractPlatformInfoFromUrl } from '../src/services/creatorResolverService.js';

async function test() {
  console.log('--- Testing URL extraction ---');
  const urls = [
    'https://www.patreon.com/posts/wlop-38291823',
    'https://wlop.fanbox.cc/posts/12345',
    'https://www.pixiv.net/en/users/2188612',
    'https://fantia.jp/fanclubs/12345',
    'https://boosty.to/reistlinna_skyrim',
    'https://gumroad.com/vomnt',
    'https://twitter.com/wlopwang'
  ];
  for (const u of urls) {
    console.log(u, '->', extractPlatformInfoFromUrl(u));
  }

  console.log('\n--- Testing resolveAuthorCreators for "wlop" ---');
  const resWlop = await resolveAuthorCreators({
    author: 'wlop',
    source: 'https://www.patreon.com/posts/38291823',
    site: 'danbooru'
  });
  console.log('WLOP Results:', {
    author: resWlop.author,
    detectedSources: resWlop.detectedSources,
    kemonoMatches: resWlop.kemono.map(k => ({ name: k.name, service: k.service, id: k.id, favorited: k.favorited, reason: k.matchReason })),
    pawchiveMatches: resWlop.pawchive.map(p => ({ name: p.name, service: p.service, id: p.id, favorited: p.favorited, reason: p.matchReason }))
  });

  console.log('\n--- Testing resolveAuthorCreators for "kae\'est" (fanbox ID 58171803) ---');
  const resKae = await resolveAuthorCreators({
    author: 'kae\'est',
    source: 'https://www.pixiv.net/en/users/58171803',
    site: 'danbooru'
  });
  console.log('Kae\'est Results:', {
    author: resKae.author,
    detectedSources: resKae.detectedSources,
    kemonoMatches: resKae.kemono.map(k => ({ name: k.name, service: k.service, id: k.id, favorited: k.favorited, reason: k.matchReason }))
  });
}

test().catch(console.error);
