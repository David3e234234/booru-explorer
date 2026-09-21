import { getCreatorsDirectory as getKemonoCreators } from '../parsers/kemono.js';
import { getCreatorsDirectory as getPawchiveCreators } from '../parsers/pawchive.js';
import { fetchSafe, safeJsonParse, discardResponse } from '../utils/network.js';
import { logInfo, logError } from '../utils/logger.js';

// Cache for booru artist API responses (TTL: 1 hour)
const artistApiCache = new Map();
const ARTIST_CACHE_TTL = 3600 * 1000;

function cleanString(str) {
  return String(str || '').trim();
}

function normalizeName(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[_.\s\-–—/\\()\[\]{}'"`~@#$!%^&*+=|:;?<>]+/g, '')
    .trim();
}

/**
 * Parses a source URL and extracts candidate platform services and identifiers/slugs.
 * @param {string} sourceUrl
 * @returns {Array<{ service: string, id?: string, slug?: string, url: string }>}
 */
export function extractPlatformInfoFromUrl(sourceUrl) {
  if (!sourceUrl || typeof sourceUrl !== 'string') return [];
  const results = [];
  const cleanUrl = sourceUrl.trim();

  try {
    // 1. Patreon
    if (/patreon\.com/i.test(cleanUrl)) {
      const uParamMatch = cleanUrl.match(/[?&]u=(\d+)/i);
      if (uParamMatch) {
        results.push({ service: 'patreon', id: uParamMatch[1], url: cleanUrl });
      }

      // e.g. https://www.patreon.com/posts/artistname-12345678
      const postSlugMatch = cleanUrl.match(/patreon\.com\/posts\/([a-zA-Z0-9_]+)(?:-[a-zA-Z0-9_-]+)?-(\d+)/i);
      if (postSlugMatch && postSlugMatch[1] && postSlugMatch[1].length >= 3 && !/^\d+$/.test(postSlugMatch[1])) {
        results.push({ service: 'patreon', slug: postSlugMatch[1].toLowerCase(), url: cleanUrl });
      }

      const slugMatch = cleanUrl.match(/patreon\.com\/(?:m\/|user\/)?([a-zA-Z0-9_-]+)/i);
      if (slugMatch && !['posts', 'creation', 'bePatron', 'home', 'join', 'login', 'signup', 'checkout', 'settings', 'user'].includes(slugMatch[1].toLowerCase())) {
        results.push({ service: 'patreon', slug: slugMatch[1].toLowerCase(), url: cleanUrl });
      }
    }

    // 2. Pixiv Fanbox
    if (/fanbox\.cc/i.test(cleanUrl) || /pixiv\.net\/fanbox/i.test(cleanUrl)) {
      const subMatch = cleanUrl.match(/https?:\/\/([a-zA-Z0-9_-]+)\.fanbox\.cc/i);
      if (subMatch && !['www', 'api', 'downloads'].includes(subMatch[1].toLowerCase())) {
        results.push({ service: 'fanbox', slug: subMatch[1].toLowerCase(), url: cleanUrl });
      }

      const atMatch = cleanUrl.match(/fanbox\.cc\/@([a-zA-Z0-9_-]+)/i);
      if (atMatch) {
        results.push({ service: 'fanbox', slug: atMatch[1].toLowerCase(), url: cleanUrl });
      }

      const creatorIdMatch = cleanUrl.match(/fanbox\/(?:creator\/)?(\d+)/i);
      if (creatorIdMatch) {
        results.push({ service: 'fanbox', id: creatorIdMatch[1], url: cleanUrl });
      }
    }

    // 3. Pixiv Main (user id matches Fanbox creator id in Kemono/Pawchive)
    if (/pixiv\.net/i.test(cleanUrl)) {
      const pUserMatch = cleanUrl.match(/users\/(\d+)/i) || cleanUrl.match(/member\.php\?.*id=(\d+)/i);
      if (pUserMatch) {
        results.push({ service: 'fanbox', id: pUserMatch[1], url: cleanUrl });
      }
    }

    // 4. Fantia
    if (/fantia\.jp/i.test(cleanUrl)) {
      const fcMatch = cleanUrl.match(/fanclubs\/(\d+)/i);
      if (fcMatch) {
        results.push({ service: 'fantia', id: fcMatch[1], url: cleanUrl });
      }
    }

    // 5. Boosty
    if (/boosty\.to/i.test(cleanUrl)) {
      const bMatch = cleanUrl.match(/boosty\.to\/([a-zA-Z0-9_.-]+)/i);
      if (bMatch && !['app', 'feed', 'login', 'signup', 'explore'].includes(bMatch[1].toLowerCase())) {
        results.push({ service: 'boosty', id: bMatch[1].toLowerCase(), slug: bMatch[1].toLowerCase(), url: cleanUrl });
      }
    }

    // 6. Gumroad
    if (/gumroad\.com/i.test(cleanUrl)) {
      const gSubMatch = cleanUrl.match(/https?:\/\/([a-zA-Z0-9_-]+)\.gumroad\.com/i);
      if (gSubMatch && !['www', 'api', 'app'].includes(gSubMatch[1].toLowerCase())) {
        results.push({ service: 'gumroad', id: gSubMatch[1].toLowerCase(), slug: gSubMatch[1].toLowerCase(), url: cleanUrl });
      } else {
        const gPathMatch = cleanUrl.match(/gumroad\.com\/([a-zA-Z0-9_-]+)/i);
        if (gPathMatch && !['l', 'd', 'p', 'discover', 'features'].includes(gPathMatch[1].toLowerCase())) {
          results.push({ service: 'gumroad', id: gPathMatch[1].toLowerCase(), slug: gPathMatch[1].toLowerCase(), url: cleanUrl });
        }
      }
    }

    // 7. Subscribestar
    if (/subscribestar\.(?:adult|com)/i.test(cleanUrl)) {
      const sMatch = cleanUrl.match(/subscribestar\.(?:adult|com)\/([a-zA-Z0-9_.-]+)/i);
      if (sMatch && !['posts', 'feed', 'explore'].includes(sMatch[1].toLowerCase())) {
        results.push({ service: 'subscribestar', id: sMatch[1].toLowerCase(), slug: sMatch[1].toLowerCase(), url: cleanUrl });
      }
    }

    // 8. Afdian
    if (/afdian\.(?:com|net)/i.test(cleanUrl)) {
      const aMatch = cleanUrl.match(/afdian\.(?:com|net)\/(?:a\/)?([a-zA-Z0-9_.-]+)/i);
      if (aMatch) {
        results.push({ service: 'afdian', id: aMatch[1].toLowerCase(), slug: aMatch[1].toLowerCase(), url: cleanUrl });
      }
    }

    // 9. Twitter / X
    if (/(?:twitter\.com|x\.com)/i.test(cleanUrl)) {
      const twMatch = cleanUrl.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/i);
      if (twMatch && !['i', 'intent', 'home', 'search', 'explore'].includes(twMatch[1].toLowerCase())) {
        results.push({ service: 'twitter', slug: twMatch[1].toLowerCase(), url: cleanUrl });
      }
    }
  } catch {}

  return results;
}

/**
 * Queries Danbooru or e621 artist API for aliases and external URLs.
 * @param {string} rawAuthor
 * @param {string} booruSite
 * @param {Object} settings
 * @returns {Promise<{ aliases: string[], urls: string[] }>}
 */
export async function fetchBooruArtistInfo(rawAuthor, booruSite = 'danbooru', settings = {}) {
  const cleanAuthor = cleanString(rawAuthor)
    .replace(/^(?:@|pixiv:)+/i, '')
    .replace(/_?\((artist|creator|circle|studio|doujin|illustrator|mangaka|animator)\)$/i, '')
    .replace(/\s+/g, '_')
    .toLowerCase();

  if (!cleanAuthor || cleanAuthor.length < 2) {
    return { aliases: [], urls: [] };
  }

  const cacheKey = `${booruSite}:${cleanAuthor}`;
  const cached = artistApiCache.get(cacheKey);
  if (cached && (Date.now() - cached.time) < ARTIST_CACHE_TTL) {
    return cached.data;
  }

  const aliases = new Set();
  const urls = new Set();

  try {
    if (booruSite === 'e621') {
      const reqUrl = `https://e621.net/artists.json?search[name]=${encodeURIComponent(cleanAuthor)}&limit=1`;
      const res = await fetchSafe(reqUrl, {
        timeout: 3000,
        settings,
        site: 'e621',
        headers: { 'User-Agent': 'BooruExplorer/1.0' }
      });
      if (res.ok) {
        const text = await res.text();
        const data = safeJsonParse(text, null);
        if (Array.isArray(data) && data.length > 0) {
          const a = data[0];
          if (a.name) aliases.add(a.name);
          if (Array.isArray(a.other_names)) a.other_names.forEach(n => n && aliases.add(n));
          if (Array.isArray(a.urls)) {
            a.urls.forEach(u => {
              const uStr = typeof u === 'string' ? u : u?.url;
              if (uStr) urls.add(uStr);
            });
          }
        }
      } else {
        await discardResponse(res);
      }
    } else {
      const authParam = (settings?.danbooruLogin && settings?.danbooruApiKey)
        ? `&login=${encodeURIComponent(settings.danbooruLogin)}&api_key=${encodeURIComponent(settings.danbooruApiKey)}`
        : '';
      const reqUrl = `https://danbooru.donmai.us/artists.json?search[name]=${encodeURIComponent(cleanAuthor)}&limit=1${authParam}`;
      const res = await fetchSafe(reqUrl, {
        timeout: 3000,
        settings,
        site: 'danbooru',
        headers: { 'User-Agent': 'BooruExplorer/1.0' }
      });
      if (res.ok) {
        const text = await res.text();
        const data = safeJsonParse(text, null);
        if (Array.isArray(data) && data.length > 0) {
          const a = data[0];
          if (a.name) aliases.add(a.name);
          if (Array.isArray(a.other_names)) a.other_names.forEach(n => n && aliases.add(n));
          if (Array.isArray(a.urls)) {
            a.urls.forEach(u => {
              const uStr = typeof u === 'string' ? u : u?.url;
              if (uStr) urls.add(uStr);
            });
          }
        }
      } else {
        await discardResponse(res);
      }
    }
  } catch (err) {
    logError('CreatorResolver', `Failed to fetch booru artist info for "${cleanAuthor}"`, err);
  }

  const result = {
    aliases: Array.from(aliases),
    urls: Array.from(urls)
  };

  artistApiCache.set(cacheKey, { data: result, time: Date.now() });
  return result;
}

/**
 * Searches a creator directory list for matches against candidate IDs, candidate names, and aliases.
 * @param {Array<Object>} creatorsList - [{ id, name, service, favorited }, ...]
 * @param {Object} criteria
 * @param {Map<string, Set<string>>} criteria.serviceIds - service -> Set of string IDs/slugs
 * @param {Set<string>} criteria.exactNamesLower - Set of lowercase candidate names
 * @param {Set<string>} criteria.normalizedNames - Set of stripped/alphanumeric candidate names
 * @param {string} targetSite - 'kemono' or 'pawchive'
 * @returns {Array<Object>} Matches ranked by confidence and popularity
 */
function matchCreatorsAgainstDirectory(creatorsList, criteria, targetSite) {
  if (!Array.isArray(creatorsList) || creatorsList.length === 0) return [];

  const { serviceIds, exactNamesLower, normalizedNames } = criteria;
  const scoredMap = new Map();

  for (const c of creatorsList) {
    if (!c || !c.service || !c.id) continue;

    const svc = String(c.service).toLowerCase();
    const cIdStr = String(c.id).toLowerCase();
    const cName = String(c.name || '').trim();
    const cNameLower = cName.toLowerCase();
    const cNameNorm = normalizeName(cName);
    const key = `${svc}:${c.id}`;

    let score = 0;
    let matchReason = '';

    // 1. Exact Service + ID match (from source URL)
    if (serviceIds.has(svc) && serviceIds.get(svc).has(cIdStr)) {
      score = 1000;
      matchReason = 'exact_id';
    }
    // 2. Exact Service + Slug match (from source URL)
    else if (serviceIds.has(svc) && serviceIds.get(svc).has(cNameLower)) {
      score = 900;
      matchReason = 'exact_service_name';
    }
    // 3. Exact full name match
    else if (exactNamesLower.has(cNameLower)) {
      score = 800;
      matchReason = 'exact_name';
    }
    // 4. Normalized name match (ignoring spaces, punctuation, underscores)
    else if (cNameNorm && normalizedNames.has(cNameNorm)) {
      score = 700;
      matchReason = 'normalized_name';
    }
    // 5. High-confidence prefix / suffix match for longer names (>= 4 chars)
    else if (cNameNorm.length >= 4) {
      for (const n of normalizedNames) {
        if (n.length >= 4 && (cNameNorm.startsWith(n) || n.startsWith(cNameNorm))) {
          score = 500;
          matchReason = 'prefix_match';
          break;
        }
      }
    }

    if (score > 0) {
      const favoritedBonus = Math.min((c.favorited || 0) / 100, 50);
      const totalScore = score + favoritedBonus;

      const existing = scoredMap.get(key);
      if (!existing || totalScore > existing.totalScore) {
        scoredMap.set(key, {
          creator: c,
          totalScore,
          score,
          matchReason
        });
      }
    }
  }

  const sorted = Array.from(scoredMap.values()).sort((a, b) => b.totalScore - a.totalScore);

  return sorted.slice(0, 8).map(({ creator, score, matchReason }) => {
    const svc = String(creator.service || '').toLowerCase();
    const id = String(creator.id);
    const baseUrl = targetSite === 'kemono' ? 'https://kemono.cr' : 'https://pawchive.pw';
    const webUrl = `${baseUrl}/${svc}/user/${encodeURIComponent(id)}`;

    return {
      site: targetSite,
      service: svc,
      id,
      name: creator.name || id,
      favorited: creator.favorited || 0,
      indexed: creator.indexed || 0,
      updated: creator.updated || 0,
      url: webUrl,
      searchQuery: `creator:${id}`,
      matchConfidence: score >= 900 ? 'high' : (score >= 700 ? 'medium' : 'fuzzy'),
      matchReason
    };
  });
}

/**
 * Resolves an author and/or post source to matching creators on Kemono and Pawchive.
 *
 * @param {Object} params
 * @param {string} [params.author] - Author tag/name from post
 * @param {string} [params.source] - Post source URL (Patreon, Fanbox, Twitter, Pixiv, etc.)
 * @param {string} [params.site] - Current post booru site
 * @param {string} [params.originalId] - Current post booru ID
 * @param {Object} [params.settings] - App settings
 * @returns {Promise<Object>} Resolved creators and source metadata
 */
export async function resolveAuthorCreators({ author = '', source = '', site = '', originalId = '', settings = {} } = {}) {
  const rawAuthor = cleanString(author);
  const cleanAuthor = rawAuthor
    .replace(/^(?:@|pixiv:)+/i, '')
    .replace(/_?\((artist|creator|circle|studio|doujin|illustrator|mangaka|animator)\)$/i, '')
    .trim();

  logInfo('CreatorResolver', `Resolving creator for author="${cleanAuthor}", site="${site}", source="${source?.slice(0, 60)}"`);

  // 1. Parse platform info directly from the post's source URL
  const sourcePlatforms = extractPlatformInfoFromUrl(source);

  // 2. Query booru artist API (Danbooru or e621) if author is available
  let booruArtistInfo = { aliases: [], urls: [] };
  if (cleanAuthor) {
    booruArtistInfo = await fetchBooruArtistInfo(cleanAuthor, site, settings);
  }

  // 3. Extract platform info from artist profile URLs
  for (const u of booruArtistInfo.urls) {
    const extraPlatforms = extractPlatformInfoFromUrl(u);
    for (const ep of extraPlatforms) {
      if (!sourcePlatforms.some(sp => sp.service === ep.service && (sp.id === ep.id || sp.slug === ep.slug))) {
        sourcePlatforms.push(ep);
      }
    }
  }

  // 4. Build candidate search sets
  const exactNamesLower = new Set();
  const normalizedNames = new Set();
  const serviceIds = new Map();

  const addNameCandidate = (nameStr) => {
    if (!nameStr || typeof nameStr !== 'string') return;
    const clean = nameStr.trim();
    if (clean.length < 2) return;

    exactNamesLower.add(clean.toLowerCase());
    exactNamesLower.add(clean.replace(/_/g, ' ').toLowerCase());
    exactNamesLower.add(clean.replace(/\s+/g, '_').toLowerCase());

    const norm = normalizeName(clean);
    if (norm.length >= 2) normalizedNames.add(norm);

    const noDigits = norm.replace(/\d+$/, '');
    if (noDigits.length >= 4 && noDigits !== norm) {
      normalizedNames.add(noDigits);
      exactNamesLower.add(noDigits);
    }
  };

  if (rawAuthor) addNameCandidate(rawAuthor);
  if (cleanAuthor) addNameCandidate(cleanAuthor);

  for (const alias of booruArtistInfo.aliases) {
    addNameCandidate(alias);
  }

  for (const sp of sourcePlatforms) {
    if (!serviceIds.has(sp.service)) {
      serviceIds.set(sp.service, new Set());
    }
    const set = serviceIds.get(sp.service);
    if (sp.id) set.add(String(sp.id).toLowerCase());
    if (sp.slug) {
      set.add(String(sp.slug).toLowerCase());
      addNameCandidate(sp.slug);
    }
  }

  // 5. Load cached Kemono and Pawchive directories in parallel
  const [kemonoDir, pawchiveDir] = await Promise.all([
    getKemonoCreators(settings).catch(() => ({ list: [] })),
    getPawchiveCreators(settings).catch(() => ({ list: [] }))
  ]);

  const criteria = {
    serviceIds,
    exactNamesLower,
    normalizedNames
  };

  // 6. Match against directories
  const kemonoMatches = matchCreatorsAgainstDirectory(kemonoDir?.list || [], criteria, 'kemono');
  const pawchiveMatches = matchCreatorsAgainstDirectory(pawchiveDir?.list || [], criteria, 'pawchive');

  // 7. Generate fallback direct search URLs
  const primarySearchName = cleanAuthor || (sourcePlatforms[0]?.slug || '');
  const fallbackSearch = {
    kemonoWebUrl: primarySearchName ? `https://kemono.cr/artists?q=${encodeURIComponent(primarySearchName)}` : 'https://kemono.cr/artists',
    pawchiveWebUrl: primarySearchName ? `https://pawchive.pw/artists?q=${encodeURIComponent(primarySearchName)}` : 'https://pawchive.pw/artists',
    kemonoAppQuery: primarySearchName,
    pawchiveAppQuery: primarySearchName
  };

  return {
    success: true,
    author: cleanAuthor,
    aliases: booruArtistInfo.aliases,
    detectedSources: sourcePlatforms.map(s => ({
      service: s.service,
      id: s.id || null,
      slug: s.slug || null,
      url: s.url
    })),
    kemono: kemonoMatches,
    pawchive: pawchiveMatches,
    fallbackSearch
  };
}
