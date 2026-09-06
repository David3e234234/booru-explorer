/**
 * Module grouping related posts (multi-image sets, Pixiv galleries,
 * variations, comics, and Parent/Child relations) into unified albums.
 */

import { logInfo, logError } from './logger.js';

function isValidRelationKey(key) {
  if (!key || typeof key !== 'string') return false;
  if (key.includes('undefined') || key.includes('null') || key.includes('NaN')) return false;
  if (key.endsWith(':') || key.startsWith(':')) return false;
  const parts = key.split(':');
  if (parts.length < 2) return false;
  if (parts.some(p => !p || p.trim() === '')) return false;
  if (parts[0] === 'parent' && parts[2] && (parts[2].length < 2 || parts[2] === '0')) return false;

  const lastPart = parts[parts.length - 1].toLowerCase();
  // Filter out generic paths, profile URLs, and store pages
  if (['home', 'profile', 'photos', 'albums', 'posts', 'artwork', 'status', 'user', 'store', 'shop', 'all'].includes(lastPart)) {
    return false;
  }
  return true;
}

/**
 * Extracts page number from post metadata (source, fileUrl, sampleUrl, tags)
 * @param {Object} item 
 * @returns {number|null} 0-indexed or positive page number, or null if unknown
 */
export function extractPageNumber(item) {
  if (!item) return null;
  if (typeof item.pageIndex === 'number' && !isNaN(item.pageIndex)) return item.pageIndex;
  if (typeof item.order === 'number' && !isNaN(item.order)) return item.order;
  if (typeof item.page === 'number' && !isNaN(item.page)) return item.page;

  // Search all string fields: source, originalFilename, fileUrl, sampleUrl, previewUrl
  const targets = [
    item.source || '',
    item.originalFilename || '',
    item.fileUrl || '',
    item.sampleUrl || '',
    item.previewUrl || ''
  ];

  for (const str of targets) {
    if (!str || typeof str !== 'string') continue;

    // Pixiv standard: _p0.jpg, _p1.png, /p0.jpg, p0.png, _p0_master
    const pixivMatch = str.match(/_p(\d+)(?:\.[a-z0-9]+|[_\b])/i) || str.match(/\/p(\d+)(?:\.[a-z0-9]+|[_\b])/i);
    if (pixivMatch) return parseInt(pixivMatch[1], 10);

    // Pixiv artwork page anchor: /artworks/12345#1 or /artworks/12345/1 or #page_0
    const pixivArtMatch = str.match(/artworks\/\d+[#\/](\d+)/i) || str.match(/#page_?(\d+)/i) || str.match(/#(\d+)$/);
    if (pixivArtMatch) return parseInt(pixivArtMatch[1], 10);

    // Twitter photo index: /photo/1, /photo/2 -> convert to 0-indexed
    const twMatch = str.match(/\/photo\/(\d+)/i);
    if (twMatch) return parseInt(twMatch[1], 10) - 1;

    // page_0, page01, page-2
    const pageMatch = str.match(/(?:^|[^\w])page[_-]?(\d+)/i);
    if (pageMatch) return parseInt(pageMatch[1], 10);

    // [01], (02) before extension
    const bracketMatch = str.match(/[\[\(](\d{1,3})[\]\)]\.[a-z0-9]+$/i);
    if (bracketMatch) return parseInt(bracketMatch[1], 10);

    // Trailing numbers in filename like name_01.jpg, art-02.png
    const trailingMatch = str.match(/[_-](\d{1,3})\.[a-z0-9]+$/i);
    if (trailingMatch) return parseInt(trailingMatch[1], 10);
  }

  // Also check tags: page_1, p1
  if (Array.isArray(item.tags)) {
    for (const tag of item.tags) {
      const tagMatch = tag.match(/^page[_-]?(\d+)$/i) || tag.match(/^p(\d+)$/i);
      if (tagMatch) return parseInt(tagMatch[1], 10);
    }
  }

  return null;
}

/**
 * Extracts ALL possible series/album keys from post metadata
 * @param {Object} post - Normalized or raw post object
 * @param {string} site - Booru site identifier
 * @returns {Array<string>} Array of relation keys (Pixiv, Twitter, Parent/Child, Fanbox, etc.)
 */
export function extractAllSeriesKeys(post, site = '') {
  if (!post) return [];
  const keys = new Set();
  const siteId = site || post.site || '';
  const source = (post.source || '').trim();
  const tags = Array.isArray(post.tags) ? post.tags : (typeof post.tag_string === 'string' ? post.tag_string.split(/\s+/) : []);

  // 1. Pixiv ID (source, tags, pixiv_id field) - require at least 5 digits to avoid tag false positives
  const pixivPatterns = [
    /pixiv\.net\/(?:en\/)?artworks\/(\d{5,})/i,
    /pixiv\.net\/member_illust\.php\?.*illust_id=(\d{5,})/i,
    /i\.pximg\.net\/.*\/(\d{5,})_p\d+/i
  ];
  for (const regex of pixivPatterns) {
    const match = source.match(regex);
    if (match && match[1]) keys.add(`pixiv:${match[1]}`);
  }
  for (const tag of tags) {
    const tagMatch = tag.match(/^(?:pixiv|pixiv_id):(\d{5,})$/i);
    if (tagMatch && tagMatch[1]) keys.add(`pixiv:${tagMatch[1]}`);
  }
  if (post.pixiv_id || post.pixivId) {
    const pid = String(post.pixiv_id || post.pixivId);
    if (pid.length >= 5) keys.add(`pixiv:${pid}`);
  }

  // 2. Twitter / X Status ID (source and tags) - snowflake IDs are at least 8 digits
  const twitterMatch = source.match(/(?:twitter\.com|x\.com)\/(?:[^\s"'<>]+\/)*status\/(\d{8,})/i);
  if (twitterMatch && twitterMatch[1]) {
    keys.add(`twitter:${twitterMatch[1]}`);
  }
  for (const tag of tags) {
    const twitterTagMatch = tag.match(/^(?:twitter|twitter_id|x_id):(\d{8,})$/i);
    if (twitterTagMatch && twitterTagMatch[1]) keys.add(`twitter:${twitterTagMatch[1]}`);
  }

  // 3. Bluesky Post ID
  const bskyMatch = source.match(/bsky\.app\/profile\/[^/]+\/post\/([a-zA-Z0-9]+)/i);
  if (bskyMatch && bskyMatch[1]) {
    keys.add(`bsky:${bskyMatch[1]}`);
  }

  // 4. Fanbox
  const fanboxMatch = source.match(/(?:(?:[\w.-]+\.)?fanbox\.(?:cc|pixiv\.net)\/(?:@[\w.-]+\/|[\w.-]+\/)?posts?\/|fanbox\/user\/\d+\/post\/)(\d+)/i);
  if (fanboxMatch && fanboxMatch[1]) keys.add(`fanbox:${fanboxMatch[1]}`);
  for (const tag of tags) {
    const fbTagMatch = tag.match(/^(?:fanbox|fanbox_id):(\d+)$/i);
    if (fbTagMatch && fbTagMatch[1]) keys.add(`fanbox:${fbTagMatch[1]}`);
  }

  // 5. Fantia
  const fantiaMatch = source.match(/(?:fantia\.jp\/(?:[^\s"'<>]*\/)?posts?\/|fantia\/user\/\d+\/post\/)(\d+)/i);
  if (fantiaMatch && fantiaMatch[1]) keys.add(`fantia:${fantiaMatch[1]}`);
  for (const tag of tags) {
    const fantiaTagMatch = tag.match(/^(?:fantia|fantia_id):(\d+)$/i);
    if (fantiaTagMatch && fantiaTagMatch[1]) keys.add(`fantia:${fantiaTagMatch[1]}`);
  }

  // 6. Patreon
  const patreonMatch = source.match(/(?:patreon\.com\/(?:[^\s"'<>]*\/)?posts\/(?:[\w-]+-)?|patreon\/user\/\d+\/post\/)(\d+)/i);
  if (patreonMatch && patreonMatch[1]) keys.add(`patreon:${patreonMatch[1]}`);
  for (const tag of tags) {
    const patreonTagMatch = tag.match(/^(?:patreon|patreon_id):(\d+)$/i);
    if (patreonTagMatch && patreonTagMatch[1]) keys.add(`patreon:${patreonTagMatch[1]}`);
  }

  // 7. Pawchive (always namespaced to avoid collisions)
  const pawchiveMatch = source.match(/pawchive\.pw\/([a-z0-9_-]+)\/user\/(\d+)\/post\/(\d+)/i);
  if (pawchiveMatch && pawchiveMatch[1] && pawchiveMatch[2] && pawchiveMatch[3]) {
    keys.add(`pawchive:${pawchiveMatch[1]}:${pawchiveMatch[2]}:${pawchiveMatch[3]}`);
  }

  // 7b. Kemono (always namespaced to avoid collisions)
  const kemonoMatch = source.match(/kemono\.(?:cr|su|party)\/([a-z0-9_-]+)\/user\/([a-z0-9_-]+)\/post\/([a-z0-9_-]+)/i);
  if (kemonoMatch && kemonoMatch[1] && kemonoMatch[2] && kemonoMatch[3]) {
    keys.add(`kemono:${kemonoMatch[1]}:${kemonoMatch[2]}:${kemonoMatch[3]}`);
  }

  // 8. Ci-en
  const cienMatch = source.match(/ci-en\.(?:dlsite\.com|net)\/(?:[^\s"'<>]*\/)?article\/(\d+)/i);
  if (cienMatch && cienMatch[1]) keys.add(`cien:${cienMatch[1]}`);

  // 9. Gumroad - only posts/, avoid generic store links (/l/...)
  const gumroadMatch = source.match(/gumroad\.com\/posts\/([a-zA-Z0-9_-]+)/i);
  if (gumroadMatch && gumroadMatch[1]) keys.add(`gumroad:${gumroadMatch[1]}`);

  // 10. Boosty
  const boostyMatch = source.match(/boosty\.to\/[^/]+\/posts\/([a-zA-Z0-9-]+)/i);
  if (boostyMatch && boostyMatch[1]) keys.add(`boosty:${boostyMatch[1]}`);

  // 11. Subscribestar
  const subStarMatch = source.match(/subscribestar\.(?:adult|com)\/posts\/(\d+)/i);
  if (subStarMatch && subStarMatch[1]) keys.add(`subscribestar:${subStarMatch[1]}`);

  // 12. Aipictors
  const aipictorsMatch = source.match(/aipictors\.com\/works\/(\d+)/i);
  if (aipictorsMatch && aipictorsMatch[1]) keys.add(`aipictors:${aipictorsMatch[1]}`);

  // 13. Weibo - status IDs only
  const weiboMatch = source.match(/(?:weibo\.(?:com|cn)\/(?:[^\s"'<>]*\/)?status\/)(\d+|[a-zA-Z0-9]{9,})/i);
  if (weiboMatch && weiboMatch[1]) keys.add(`weibo:${weiboMatch[1]}`);

  // 14. Lofter
  const lofterMatch = source.match(/([\w-]+)\.lofter\.com\/post\/([a-zA-Z0-9_]+)/i);
  if (lofterMatch && lofterMatch[1] && lofterMatch[2]) keys.add(`lofter:${lofterMatch[1]}:${lofterMatch[2]}`);

  // 15. Bilibili
  const bilibiliMatch = source.match(/(?:bilibili\.com\/opus\/|t\.bilibili\.com\/)(\d+)/i);
  if (bilibiliMatch && bilibiliMatch[1]) keys.add(`bilibili:${bilibiliMatch[1]}`);

  // 16. Plurk
  const plurkMatch = source.match(/plurk\.com\/p\/([a-zA-Z0-9]+)/i);
  if (plurkMatch && plurkMatch[1]) keys.add(`plurk:${plurkMatch[1]}`);

  if (post.seriesKey && !post.seriesKey.startsWith('pool:')) keys.add(post.seriesKey);
  if (Array.isArray(post.allSeriesKeys)) {
    post.allSeriesKeys.forEach(k => { if (k && !k.startsWith('pool:')) keys.add(k); });
  }

  // 17. Booru Parent/Child relation (verified bridge within the same site)
  const rawParentId = post.parentId || post.parent_id;
  if (rawParentId && String(rawParentId) !== '0' && String(rawParentId) !== 'null') {
    keys.add(`parent:${siteId}:${String(rawParentId)}`);
  }

  // When the post itself has children
  const hasChildren = Boolean(post.hasChildren || post.has_children || post.has_active_children);
  if (hasChildren && (post.originalId || post.id)) {
    const rawIdStr = String(post.originalId || post.id || '');
    const rootId = rawIdStr.replace(/^[a-z0-9]+_/, '');
    if (rootId && rootId !== '0' && rootId !== 'null' && rootId.length >= 2) {
      keys.add(`parent:${siteId}:${rootId}`);
    }
  }

  // NOTE: pool: tags/IDs are intentionally NOT included in automatic feed series keys.
  // In Boorus, pools are user collections / playlists that contain hundreds of unrelated images.
  // Automatic merging by pool was a primary cause of unrelated images collapsing into single posts.

  return Array.from(keys).filter(isValidRelationKey);
}

/**
 * Extracts the primary normalized series key for a single post
 */
export function extractSeriesKey(post, site = '') {
  const keys = extractAllSeriesKeys(post, site);
  if (keys.length === 0) return null;
  const targetSite = site || post?.site || '';

  if (targetSite === 'kemono') {
    const kemonoKey = keys.find(k => k.startsWith('kemono:'));
    if (kemonoKey) return kemonoKey;
  }
  if (targetSite === 'pawchive') {
    const pawchiveKey = keys.find(k => k.startsWith('pawchive:'));
    if (pawchiveKey) return pawchiveKey;
  }

  // Priority: pixiv -> fanbox -> fantia -> patreon -> parent -> pawchive -> kemono -> twitter -> others
  const pixivKey = keys.find(k => k.startsWith('pixiv:'));
  if (pixivKey) return pixivKey;
  const fanboxKey = keys.find(k => k.startsWith('fanbox:'));
  if (fanboxKey) return fanboxKey;
  const fantiaKey = keys.find(k => k.startsWith('fantia:'));
  if (fantiaKey) return fantiaKey;
  const patreonKey = keys.find(k => k.startsWith('patreon:'));
  if (patreonKey) return patreonKey;
  const parentKey = keys.find(k => k.startsWith('parent:'));
  if (parentKey) return parentKey;
  const pawchiveKey = keys.find(k => k.startsWith('pawchive:'));
  if (pawchiveKey) return pawchiveKey;
  const kemonoKey = keys.find(k => k.startsWith('kemono:'));
  if (kemonoKey) return kemonoKey;
  const twitterKey = keys.find(k => k.startsWith('twitter:'));
  if (twitterKey) return twitterKey;
  return keys[0];
}

/**
 * Sort pages within a set: explicit page numbers are the highest priority!
 */
export function sortAlbumItems(items) {
  return [...items].sort((a, b) => {
    const pageA = extractPageNumber(a);
    const pageB = extractPageNumber(b);

    // 1. Explicit page numbers are the highest truth!
    if (pageA !== null && pageB !== null) {
      if (pageA !== pageB) return pageA - pageB;
    } else if (pageA !== null && pageB === null) {
      return -1; // Numbered page comes before unnumbered
    } else if (pageA === null && pageB !== null) {
      return 1;
    }

    // 2. Parent post comes first if no page numbers
    const aIsParent = Boolean(a.hasChildren && !a.parentId);
    const bIsParent = Boolean(b.hasChildren && !b.parentId);
    if (aIsParent && !bIsParent) return -1;
    if (!aIsParent && bIsParent) return 1;

    // 3. Fallback: sort by ascending original ID
    const idA = parseInt(String(a.originalId || a.id).replace(/\D/g, ''), 10) || 0;
    const idB = parseInt(String(b.originalId || b.id).replace(/\D/g, ''), 10) || 0;
    return idA - idB;
  });
}

/**
 * Checks whether two posts have compatible authors (i.e. not different creators)
 */
function arePostsAuthorCompatible(postA, postB) {
  if (!postA || !postB) return true;
  const authorA = (postA.author || '').trim().toLowerCase().replace(/^[@pixiv:]+/, '').replace(/[\s_]+/g, ' ');
  const authorB = (postB.author || '').trim().toLowerCase().replace(/^[@pixiv:]+/, '').replace(/[\s_]+/g, ' ');
  // If both posts have distinct non-empty authors, they cannot be merged
  if (authorA && authorB && authorA !== authorB) {
    const assistantsA = (Array.isArray(postA.assistants) ? postA.assistants : []).map(a => a.toLowerCase().replace(/^[@pixiv:]+/, '').replace(/[\s_]+/g, ' '));
    const assistantsB = (Array.isArray(postB.assistants) ? postB.assistants : []).map(a => a.toLowerCase().replace(/^[@pixiv:]+/, '').replace(/[\s_]+/g, ' '));
    if (!assistantsA.includes(authorB) && !assistantsB.includes(authorA)) {
      return false;
    }
  }
  return true;
}

/**
 * Groups an array of posts into multiposts (albums) via a multi-key union-find
 * @param {Array} posts - Source array of posts
 * @param {Object} options - Grouping options
 * @returns {Array} Array of posts with albums collapsed
 */
export function groupPostsIntoAlbums(posts, options = {}) {
  if (!Array.isArray(posts) || posts.length === 0) return [];
  if (options.enabled === false) return posts;

  const n = posts.length;
  const parent = Array.from({ length: n }, (_, i) => i);

  function find(i) {
    if (parent[i] === i) return i;
    parent[i] = find(parent[i]);
    return parent[i];
  }

  function union(i, j) {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) {
      if (rootI < rootJ) {
        parent[rootJ] = rootI;
      } else {
        parent[rootI] = rootJ;
      }
    }
  }

  const keyToPostIdx = new Map();
  const postKeysList = [];
  const keysByPost = new Map();

  // 1. Collect all relation keys for each post and union related posts (with author check)
  posts.forEach((post, idx) => {
    const keys = extractAllSeriesKeys(post, post.site);
    postKeysList[idx] = keys;
    keysByPost.set(post, keys);

    keys.forEach(key => {
      if (keyToPostIdx.has(key)) {
        const otherIdx = keyToPostIdx.get(key);
        if (arePostsAuthorCompatible(post, posts[otherIdx])) {
          union(idx, otherIdx);
        }
      } else {
        keyToPostIdx.set(key, idx);
      }
    });
  });

  // 2. Group posts by root index
  const clusters = new Map();
  posts.forEach((post, idx) => {
    const root = find(idx);
    if (!clusters.has(root)) {
      clusters.set(root, {
        firstIndex: root,
        items: []
      });
    }
    clusters.get(root).items.push(post);
  });

  // 3. Build the final post list
  const resultMap = new Map();

  clusters.forEach((cluster, rootIndex) => {
    const { items } = cluster;

    if (items.length > 1) {
      // Guard against runaway transitive merging of too many separate posts
      const distinctRootPosts = new Set(items.map(it => String(it.originalId || it.id).replace(/^[a-z0-9]+_/, '').split('_')[0]));
      if (distinctRootPosts.size > 20) {
        items.forEach((item, itemIdx) => {
          resultMap.set(rootIndex + itemIdx * 0.001, item);
        });
        return;
      }

      // Multiple items clustered together
      const flattenedItems = [];
      items.forEach(item => {
        if (item.isAlbum && Array.isArray(item.albumItems) && item.albumItems.length > 0) {
          flattenedItems.push(...item.albumItems);
        } else {
          flattenedItems.push(item);
        }
      });

      const sortedItems = sortAlbumItems(flattenedItems);
      // The first item in sorted order is guaranteed to be the first photo (page 0)
      const rootPost = sortedItems[0];

      // Strip circular references from nested items
      const cleanItems = sortedItems.map(item => {
        const copy = { ...item };
        delete copy.albumItems;
        return copy;
      });

      // Collect all tags and keys
      const allTagsSet = new Set();
      const allKeysSet = new Set();

      cleanItems.forEach(item => {
        if (Array.isArray(item.tags)) {
          item.tags.forEach(t => allTagsSet.add(t));
        }
        const kList = keysByPost.get(item) || extractAllSeriesKeys(item, item.site);
        kList.forEach(k => allKeysSet.add(k));
      });

      const maxScore = Math.max(...cleanItems.map(i => i.score || 0));
      const maxFavs = Math.max(...cleanItems.map(i => i.favCount || 0));
      const maxViews = Math.max(...cleanItems.map(i => i.views || 0));

      const primaryKey = Array.from(allKeysSet).find(k => k.startsWith('pixiv:')) ||
                         Array.from(allKeysSet).find(k => k.startsWith('parent:')) ||
                         Array.from(allKeysSet).find(k => k.startsWith('pawchive:')) ||
                         Array.from(allKeysSet).find(k => k.startsWith('kemono:')) ||
                         Array.from(allKeysSet)[0] || '';

      // Use the most recent upload/update date among album items
      const validDates = cleanItems
        .map(i => i.createdAt)
        .filter(d => typeof d === 'string' && d.trim().length > 0);
      let latestCreatedAt = rootPost.createdAt || '';
      if (validDates.length > 0) {
        latestCreatedAt = validDates.reduce((latest, curr) => {
          const t1 = new Date(latest).getTime();
          const t2 = new Date(curr).getTime();
          if (isNaN(t1)) return curr;
          if (isNaN(t2)) return latest;
          return t2 > t1 ? curr : latest;
        });
      }

      // Root post always represents photo #1 (preview, thumbs, and video state)
      const albumPost = {
        ...rootPost,
        previewUrl: rootPost.previewUrl,
        thumb180: rootPost.thumb180,
        thumb360: rootPost.thumb360,
        thumb720: rootPost.thumb720,
        thumbSample: rootPost.thumbSample,
        thumbOriginal: rootPost.thumbOriginal,
        sampleUrl: rootPost.sampleUrl,
        fileUrl: rootPost.fileUrl,
        fileExt: rootPost.fileExt,
        isVideo: rootPost.isVideo,
        isGif: rootPost.isGif,
        hasSound: rootPost.hasSound,
        author: rootPost.author,
        assistants: rootPost.assistants || [],
        isAlbum: true,
        albumCount: cleanItems.length,
        albumItems: cleanItems,
        seriesKey: primaryKey,
        allSeriesKeys: Array.from(allKeysSet),
        canFetchAlbum: true,
        tags: Array.from(allTagsSet),
        score: maxScore,
        favCount: maxFavs,
        views: maxViews,
        createdAt: latestCreatedAt
      };

      resultMap.set(rootIndex, albumPost);
    } else {
      // Single post
      const singlePost = { ...items[0] };
      const keys = postKeysList[rootIndex] || [];
      const hasChildren = Boolean(singlePost.hasChildren || singlePost.has_children || singlePost.has_active_children);
      const hasParent = Boolean(singlePost.parentId && String(singlePost.parentId) !== '0');
      const hasExternalSet = keys.some(k => k.startsWith('pixiv:') || k.startsWith('twitter:') || k.startsWith('fanbox:') || k.startsWith('fantia:') || k.startsWith('patreon:'));

      if (singlePost.isAlbum && Array.isArray(singlePost.albumItems) && singlePost.albumItems.length > 1) {
        // Already an album (e.g. multi-media post from parser)
        singlePost.isAlbum = true;
        singlePost.albumCount = singlePost.albumItems.length;
        singlePost.seriesKey = singlePost.seriesKey || keys[0] || null;
        singlePost.allSeriesKeys = (Array.isArray(singlePost.allSeriesKeys) && singlePost.allSeriesKeys.length > 0) ? singlePost.allSeriesKeys : keys;
        singlePost.canFetchAlbum = true;
      } else {
        delete singlePost.albumItems;
        singlePost.isAlbum = false;
        singlePost.albumCount = 1;
        singlePost.seriesKey = keys[0] || null;
        singlePost.allSeriesKeys = keys;
        singlePost.canFetchAlbum = Boolean(hasChildren || hasParent || hasExternalSet);
      }

      resultMap.set(rootIndex, singlePost);
    }
  });

  // 4. Restore order
  const sortedIndices = Array.from(resultMap.keys()).sort((a, b) => a - b);
  return sortedIndices.map(idx => resultMap.get(idx));
}
