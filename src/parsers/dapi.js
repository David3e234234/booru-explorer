import { safeJsonParse, fetchSafe, resolvePreviewUrl, discardResponse } from '../utils/network.js';
import { checkIsAi, checkMediaTypes, normalizeDate, adaptTagsForSite, decodeHtmlEntities } from '../utils/tagHelpers.js';
import { classifyPostTags } from '../utils/tagClassifier.js';
import { extractSeriesKey } from '../utils/albumHelper.js';
import { logError } from '../utils/logger.js';

function getRecentDateFilter(days = 30) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `date:>=${year}-${month}-${day}`;
}

let cachedXbooruMaxId = 1270000;
let lastXbooruMaxIdCheck = 0;

async function getXbooruMaxId(settings) {
  const now = Date.now();
  if (now - lastXbooruMaxIdCheck < 3600 * 1000 && cachedXbooruMaxId > 0) {
    return cachedXbooruMaxId;
  }
  try {
    const res = await fetchSafe('https://xbooru.com/index.php?page=dapi&s=post&q=index&json=1&limit=1', { settings, site: 'xbooru' });
    if (res.ok) {
      const data = safeJsonParse(await res.text(), []);
      const first = Array.isArray(data) ? data[0] : data?.post?.[0];
      if (first?.id) {
        cachedXbooruMaxId = parseInt(first.id, 10);
        lastXbooruMaxIdCheck = now;
      }
    }
  } catch {}
  return cachedXbooruMaxId;
}

let cachedHypnohubMaxId = 280000;
let lastHypnohubMaxIdCheck = 0;

async function getHypnohubMaxId(settings) {
  const now = Date.now();
  if (now - lastHypnohubMaxIdCheck < 3600 * 1000 && cachedHypnohubMaxId > 0) {
    return cachedHypnohubMaxId;
  }
  try {
    const res = await fetchSafe('https://hypnohub.net/index.php?page=dapi&s=post&q=index&json=1&limit=1', { settings, site: 'hypnohub' });
    if (res.ok) {
      const data = safeJsonParse(await res.text(), []);
      const first = Array.isArray(data) ? data[0] : data?.post?.[0];
      if (first?.id) {
        cachedHypnohubMaxId = parseInt(first.id, 10);
        lastHypnohubMaxIdCheck = now;
      }
    }
  } catch {}
  return cachedHypnohubMaxId;
}

export async function fetchXbooru(params, aiTagsList, settings = {}) {
  const { tags = '', page = 1, limit = 40, category = '', ratingFilter = 'all', typeFilter = 'all', ageFilter = 'all' } = params;

  let searchTags = adaptTagsForSite('xbooru', tags, ageFilter, typeFilter);
  const customXbooruTag = settings?.siteSortTags?.xbooru?.[category];
  if (customXbooruTag) {
    searchTags = searchTags ? `${searchTags} ${customXbooruTag}` : customXbooruTag;
  } else if (category === 'hot') {
    if (!searchTags.includes('sort:') && !searchTags.includes('order:')) {
      const maxId = await getXbooruMaxId(settings);
      const minId = Math.max(1, maxId - 50000);
      searchTags = searchTags ? `${searchTags} id:>=${minId} sort:score:desc` : `id:>=${minId} sort:score:desc`;
    }
  } else if (category === 'top') {
    if (!searchTags.includes('sort:') && !searchTags.includes('order:')) {
      searchTags = searchTags ? `${searchTags} sort:score:desc` : 'sort:score:desc';
    }
  } else if (category === 'views') {
    if (!searchTags.includes('sort:') && !searchTags.includes('order:')) {
      searchTags = searchTags ? `${searchTags} sort:views:desc` : 'sort:views:desc';
    }
  } else if (category === 'popular' || category === 'recommended') {
    if (!searchTags.includes('sort:') && !searchTags.includes('order:')) {
      searchTags = searchTags ? `${searchTags} sort:score:desc` : 'sort:score:desc';
    }
  } else if (category === 'random') {
    if (!searchTags.includes('sort:') && !searchTags.includes('order:')) {
      searchTags = searchTags ? `${searchTags} sort:random` : 'sort:random';
    }
  } else if (category === 'new' && settings?.siteSortTags?.xbooru?.new) {
    searchTags = searchTags ? `${searchTags} ${settings.siteSortTags.xbooru.new}` : settings.siteSortTags.xbooru.new;
  }

  // Rating filter
  if (ratingFilter === 'nsfw') {
    if (!searchTags.includes('rating:')) searchTags = searchTags ? `${searchTags} rating:e` : 'rating:e';
  } else if (ratingFilter === 'questionable' || ratingFilter === '16+') {
    if (!searchTags.includes('rating:')) searchTags = searchTags ? `${searchTags} rating:q` : 'rating:q';
  } else if (ratingFilter === 'sfw') {
    if (!searchTags.includes('rating:')) searchTags = searchTags ? `${searchTags} rating:s` : 'rating:s';
  }

  const pid = Math.max(0, page - 1);
  const url = `https://xbooru.com/index.php?page=dapi&s=post&q=index&json=1&tags=${encodeURIComponent(searchTags)}&pid=${pid}&limit=${limit}`;

  try {
    const res = await fetchSafe(url, { settings, site: 'xbooru' });
    if (!res.ok) {
      await discardResponse(res);
      return [];
    }
    const text = await res.text();
    const data = safeJsonParse(text, []);
    const posts = data?.post || (Array.isArray(data) ? data : []);

    return await Promise.all(posts.map(async item => {
      const rawTags = decodeHtmlEntities(item.tags || '').split(' ').filter(Boolean);
      let fileUrl = item.file_url || '';
      if (!fileUrl && item.directory && item.image) {
        fileUrl = `https://img.xbooru.com/images/${item.directory}/${item.image}`;
      } else if (fileUrl.startsWith('//')) {
        fileUrl = 'https:' + fileUrl;
      }

      let sampleUrl = item.sample_url || fileUrl;
      if (sampleUrl.startsWith('//')) sampleUrl = 'https:' + sampleUrl;

      let previewUrlRaw = item.preview_url || (item.directory && item.image ? `https://img.xbooru.com/thumbnails/${item.directory}/thumbnail_${item.image}` : fileUrl);
      if (previewUrlRaw.startsWith('//')) previewUrlRaw = 'https:' + previewUrlRaw;

      const { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(fileUrl, '', rawTags);
      const previewUrl = resolvePreviewUrl(previewUrlRaw, fileUrl, sampleUrl, isVideo);
      const { tagDetails, author } = await classifyPostTags(rawTags, item.source, '', settings);
      const createdAt = normalizeDate(item.created_at || item.change);

      const parentId = item.parent_id && String(item.parent_id) !== '0' ? String(item.parent_id) : null;
      const hasChildren = Boolean(item.has_children);
      const seriesKey = extractSeriesKey({
        source: item.source || '',
        parentId,
        hasChildren,
        originalId: String(item.id),
        tags: rawTags
      }, 'xbooru');

      return {
        id: `xbooru_${item.id}`,
        originalId: String(item.id),
        site: 'xbooru',
        siteName: 'Xbooru',
        previewUrl,
        sampleUrl,
        fileUrl,
        fileExt,
        isVideo,
        isGif,
        hasSound: isVideo && hasSound,
        author,
        tags: rawTags,
        tagDetails,
        score: parseInt(item.score, 10) || 0,
        rating: item.rating || 'e',
        width: parseInt(item.width, 10) || 0,
        height: parseInt(item.height, 10) || 0,
        source: item.source || '',
        postUrl: `https://xbooru.com/index.php?page=post&s=view&id=${item.id}`,
        parentId,
        hasChildren,
        seriesKey,
        createdAt,
        isAi: checkIsAi(rawTags, aiTagsList)
      };
    }));
  } catch (err) {
    logError('Xbooru', 'Ошибка загрузки постов', err);
    return [];
  }
}

export async function fetchHypnohub(params, aiTagsList, settings = {}) {
  const { tags = '', page = 1, limit = 40, category = '', ratingFilter = 'all', typeFilter = 'all', ageFilter = 'all' } = params;

  let searchTags = adaptTagsForSite('hypnohub', tags, ageFilter, typeFilter);
  const customHypnohubTag = settings?.siteSortTags?.hypnohub?.[category];
  if (customHypnohubTag) {
    searchTags = searchTags ? `${searchTags} ${customHypnohubTag}` : customHypnohubTag;
  } else if (category === 'hot') {
    if (!searchTags.includes('sort:') && !searchTags.includes('order:')) {
      const maxId = await getHypnohubMaxId(settings);
      const minId = Math.max(1, maxId - 20000);
      searchTags = searchTags ? `${searchTags} id:>=${minId} sort:score:desc` : `id:>=${minId} sort:score:desc`;
    }
  } else if (category === 'top') {
    if (!searchTags.includes('sort:') && !searchTags.includes('order:')) {
      searchTags = searchTags ? `${searchTags} sort:score:desc` : 'sort:score:desc';
    }
  } else if (category === 'views') {
    if (!searchTags.includes('sort:') && !searchTags.includes('order:')) {
      searchTags = searchTags ? `${searchTags} sort:views:desc` : 'sort:views:desc';
    }
  } else if (category === 'popular' || category === 'recommended') {
    if (!searchTags.includes('sort:') && !searchTags.includes('order:')) {
      searchTags = searchTags ? `${searchTags} sort:score:desc` : 'sort:score:desc';
    }
  } else if (category === 'random') {
    if (!searchTags.includes('sort:') && !searchTags.includes('order:')) {
      searchTags = searchTags ? `${searchTags} sort:random` : 'sort:random';
    }
  } else if (category === 'new' && settings?.siteSortTags?.hypnohub?.new) {
    searchTags = searchTags ? `${searchTags} ${settings.siteSortTags.hypnohub.new}` : settings.siteSortTags.hypnohub.new;
  }

  // Rating filter
  if (ratingFilter === 'nsfw') {
    if (!searchTags.includes('rating:')) searchTags = searchTags ? `${searchTags} rating:e` : 'rating:e';
  } else if (ratingFilter === 'questionable' || ratingFilter === '16+') {
    if (!searchTags.includes('rating:')) searchTags = searchTags ? `${searchTags} rating:q` : 'rating:q';
  } else if (ratingFilter === 'sfw') {
    if (!searchTags.includes('rating:')) searchTags = searchTags ? `${searchTags} rating:s` : 'rating:s';
  }

  const pid = Math.max(0, page - 1);
  const url = `https://hypnohub.net/index.php?page=dapi&s=post&q=index&json=1&tags=${encodeURIComponent(searchTags)}&pid=${pid}&limit=${limit}`;

  try {
    const res = await fetchSafe(url, { settings, site: 'hypnohub' });
    if (!res.ok) {
      await discardResponse(res);
      return [];
    }
    const text = await res.text();
    const data = safeJsonParse(text, []);
    const posts = data?.post || (Array.isArray(data) ? data : []);

    return await Promise.all(posts.map(async item => {
      const rawTags = decodeHtmlEntities(item.tags || '').split(' ').filter(Boolean);
      let fileUrl = item.file_url || '';
      if (!fileUrl && item.directory && item.image) {
        fileUrl = `https://hypnohub.net/images/${item.directory}/${item.image}`;
      } else if (fileUrl.startsWith('//')) {
        fileUrl = 'https:' + fileUrl;
      }

      let sampleUrl = item.sample_url || fileUrl;
      if (sampleUrl.startsWith('//')) sampleUrl = 'https:' + sampleUrl;

      let previewUrlRaw = item.preview_url || (item.directory && item.image ? `https://hypnohub.net/thumbnails/${item.directory}/thumbnail_${item.image}` : fileUrl);
      if (previewUrlRaw.startsWith('//')) previewUrlRaw = 'https:' + previewUrlRaw;

      const { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(fileUrl, '', rawTags);
      const previewUrl = resolvePreviewUrl(previewUrlRaw, fileUrl, sampleUrl, isVideo);
      const { tagDetails, author } = await classifyPostTags(rawTags, item.source, '', settings);
      const createdAt = normalizeDate(item.created_at || item.change);
      const parentId = item.parent_id && String(item.parent_id) !== '0' ? String(item.parent_id) : null;
      const hasChildren = Boolean(item.has_children);
      const seriesKey = extractSeriesKey({
        source: item.source || '',
        parentId,
        hasChildren,
        originalId: String(item.id),
        tags: rawTags
      }, 'hypnohub');

      return {
        id: `hypnohub_${item.id}`,
        originalId: String(item.id),
        site: 'hypnohub',
        siteName: 'Hypnohub',
        previewUrl,
        sampleUrl,
        fileUrl,
        fileExt,
        isVideo,
        isGif,
        hasSound: isVideo && hasSound,
        author,
        tags: rawTags,
        tagDetails,
        score: parseInt(item.score, 10) || 0,
        rating: item.rating || 'e',
        width: parseInt(item.width, 10) || 0,
        height: parseInt(item.height, 10) || 0,
        source: item.source || '',
        postUrl: `https://hypnohub.net/index.php?page=post&s=view&id=${item.id}`,
        parentId,
        hasChildren,
        seriesKey,
        createdAt,
        isAi: checkIsAi(rawTags, aiTagsList)
      };
    }));
  } catch (err) {
    logError('Hypnohub', 'Ошибка загрузки постов', err);
    return [];
  }
}

// Normalize TBIB ratings: the JSON API returns full words (safe/questionable/explicit)
function normalizeTbibRating(raw) {
  const r = String(raw || '').toLowerCase();
  if (r === 'safe' || r === 's') return 's';
  if (r === 'questionable' || r === 'q') return 'q';
  return 'e';
}

export async function fetchTbib(params, aiTagsList, settings = {}) {
  const { tags = '', page = 1, limit = 40, category = '', ratingFilter = 'all', typeFilter = 'all', ageFilter = 'all' } = params;

  let searchTags = adaptTagsForSite('tbib', tags, ageFilter, typeFilter);
  // TBIB does not support date:* metatags - strip them or results come back empty
  searchTags = searchTags.replace(/\bdate:\S+/gi, '').trim();

  const customTbibTag = settings?.siteSortTags?.tbib?.[category];
  if (customTbibTag) {
    searchTags = searchTags ? `${searchTags} ${customTbibTag}` : customTbibTag;
  } else if (category === 'top' || category === 'hot' || category === 'views' || category === 'recommended') {
    if (!searchTags.includes('sort:') && !searchTags.includes('order:')) {
      searchTags = searchTags ? `${searchTags} sort:score:desc` : 'sort:score:desc';
    }
  } else if (category === 'popular') {
    // Without date:* support, popular-this-month degrades to score sorting
    if (!searchTags.includes('sort:') && !searchTags.includes('order:')) {
      searchTags = searchTags ? `${searchTags} sort:score:desc` : 'sort:score:desc';
    }
  } else if (category === 'random') {
    if (!searchTags.includes('sort:') && !searchTags.includes('order:')) {
      searchTags = searchTags ? `${searchTags} sort:random` : 'sort:random';
    }
  } else if (category === 'new' && settings?.siteSortTags?.tbib?.new) {
    searchTags = searchTags ? `${searchTags} ${settings.siteSortTags.tbib.new}` : settings.siteSortTags.tbib.new;
  }

  // Rating filter: TBIB only accepts full words (rating:safe etc.)
  if (ratingFilter === 'nsfw') {
    if (!searchTags.includes('rating:')) searchTags = searchTags ? `${searchTags} rating:explicit` : 'rating:explicit';
  } else if (ratingFilter === 'questionable' || ratingFilter === '16+') {
    if (!searchTags.includes('rating:')) searchTags = searchTags ? `${searchTags} rating:questionable` : 'rating:questionable';
  } else if (ratingFilter === 'sfw') {
    if (!searchTags.includes('rating:')) searchTags = searchTags ? `${searchTags} rating:safe` : 'rating:safe';
  }

  const pid = Math.max(0, page - 1);
  const url = `https://tbib.org/index.php?page=dapi&s=post&q=index&json=1&tags=${encodeURIComponent(searchTags)}&pid=${pid}&limit=${limit}`;

  try {
    const res = await fetchSafe(url, { settings, site: 'tbib' });
    if (!res.ok) {
      await discardResponse(res);
      return [];
    }
    const text = await res.text();
    const data = safeJsonParse(text, []);
    const posts = Array.isArray(data) ? data : [];

    return await Promise.all(posts.map(async item => {
      const rawTags = decodeHtmlEntities(item.tags || '').split(' ').filter(Boolean);
      let fileUrl = item.file_url || '';
      if (!fileUrl && item.directory && item.image) {
        fileUrl = `https://tbib.org/images/${item.directory}/${item.image}`;
      }

      const sampleUrl = fileUrl;
      let previewUrlRaw = item.preview_url || (item.directory && item.image ? `https://tbib.org/thumbnails/${item.directory}/thumbnail_${item.image}` : fileUrl);
      if (previewUrlRaw.startsWith('//')) previewUrlRaw = 'https:' + previewUrlRaw;

      const { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(fileUrl, '', rawTags);
      const previewUrl = resolvePreviewUrl(previewUrlRaw, fileUrl, sampleUrl, isVideo);
      const { tagDetails, author } = await classifyPostTags(rawTags, item.source, '', settings);
      const createdAt = normalizeDate(item.created_at || item.change);

      const parentId = item.parent_id && String(item.parent_id) !== '0' ? String(item.parent_id) : null;
      const hasChildren = Boolean(item.has_children);
      const seriesKey = extractSeriesKey({
        source: item.source || '',
        parentId,
        hasChildren,
        originalId: String(item.id),
        tags: rawTags
      }, 'tbib');

      return {
        id: `tbib_${item.id}`,
        originalId: String(item.id),
        site: 'tbib',
        siteName: 'TBIB',
        previewUrl,
        sampleUrl,
        fileUrl,
        fileExt,
        isVideo,
        isGif,
        hasSound: isVideo && hasSound,
        author,
        tags: rawTags,
        tagDetails,
        score: parseInt(item.score, 10) || 0,
        rating: normalizeTbibRating(item.rating),
        width: parseInt(item.width, 10) || 0,
        height: parseInt(item.height, 10) || 0,
        source: item.source || '',
        postUrl: `https://tbib.org/index.php?page=post&s=view&id=${item.id}`,
        parentId,
        hasChildren,
        seriesKey,
        createdAt,
        isAi: checkIsAi(rawTags, aiTagsList)
      };
    }));
  } catch (err) {
    logError('TBIB', 'Ошибка загрузки постов', err);
    return [];
  }
}

/**
 * Resolves full post details for Xbooru including categorized tags and verified artist
 */
export async function fetchXbooruPostById(postId, aiTagsList = [], settings = {}) {
  const cleanId = String(postId || '').replace(/^xbooru_/, '').split('_')[0].trim();
  if (!cleanId || !/^\d+$/.test(cleanId)) return null;

  try {
    const dapiUrl = `https://xbooru.com/index.php?page=dapi&s=post&q=index&json=1&id=${cleanId}`;
    const dapiRes = await fetchSafe(dapiUrl, { settings, site: 'xbooru' });
    let postItem = null;
    if (dapiRes.ok) {
      const text = await dapiRes.text();
      const data = safeJsonParse(text, null);
      postItem = Array.isArray(data) ? (data.find(p => String(p.id) === cleanId) || data[0]) : null;
    } else {
      await discardResponse(dapiRes);
    }

    const pageUrl = `https://xbooru.com/index.php?page=post&s=view&id=${cleanId}`;
    const pageRes = await fetchSafe(pageUrl, {
      headers: { 'Referer': 'https://xbooru.com/' },
      timeout: 5000,
      settings,
      site: 'xbooru'
    });

    const tagDetails = { artist: [], copyright: [], character: [], general: [], meta: [] };
    const allTags = [];
    let pageSource = '';

    if (pageRes.ok) {
      const html = await pageRes.text();
      const srcMatch = html.match(/Source:?\s*<a[^>]*href="([^"]+)"/i) || html.match(/Source:?\s*([^\s<"'>]+)/i);
      if (srcMatch && srcMatch[1] && !srcMatch[1].startsWith('"')) {
        pageSource = srcMatch[1].trim();
      }

      const tagMatches = [...html.matchAll(/class="tag-type-([^"]+)"[^>]*>[\s\S]*?<a[^>]*tags=([^"&]+)[\s\S]*?<\/li>/gi)];
      for (const m of tagMatches) {
        const rawType = m[1].replace(/\s+tag/, '').trim().toLowerCase();
        const tagName = decodeURIComponent(m[2]).trim();
        if (!tagName) continue;
        if (!allTags.includes(tagName)) allTags.push(tagName);

        if (rawType === 'artist') {
          if (!tagDetails.artist.includes(tagName)) tagDetails.artist.push(tagName);
        } else if (rawType === 'copyright') {
          if (!tagDetails.copyright.includes(tagName)) tagDetails.copyright.push(tagName);
        } else if (rawType === 'character') {
          if (!tagDetails.character.includes(tagName)) tagDetails.character.push(tagName);
        } else if (rawType === 'metadata' || rawType === 'meta') {
          if (!tagDetails.meta.includes(tagName)) tagDetails.meta.push(tagName);
        } else {
          if (!tagDetails.general.includes(tagName)) tagDetails.general.push(tagName);
        }
      }
    } else {
      await discardResponse(pageRes);
    }

    if (!postItem && allTags.length === 0) return null;

    const rawTags = allTags.length > 0 ? allTags : (decodeHtmlEntities(postItem?.tags || '').split(' ').filter(Boolean));
    const finalSource = pageSource || postItem?.source || '';
    let author = tagDetails.artist[0] || '';
    if (!author && rawTags.length > 0) {
      const classified = await classifyPostTags(rawTags, finalSource, '', settings, false);
      if (classified.author) author = classified.author;
      if (tagDetails.artist.length === 0 && classified.tagDetails?.artist?.length > 0) {
        tagDetails.artist = classified.tagDetails.artist;
      }
    }

    let fileUrl = postItem?.file_url || '';
    if (!fileUrl && postItem?.directory && postItem?.image) {
      fileUrl = `https://img.xbooru.com/images/${postItem.directory}/${postItem.image}`;
    } else if (fileUrl.startsWith('//')) {
      fileUrl = 'https:' + fileUrl;
    }

    let sampleUrl = postItem?.sample_url || fileUrl;
    if (sampleUrl.startsWith('//')) sampleUrl = 'https:' + sampleUrl;

    let previewUrlRaw = postItem?.preview_url || (postItem?.directory && postItem?.image ? `https://img.xbooru.com/thumbnails/${postItem.directory}/thumbnail_${postItem.image}` : fileUrl);
    if (previewUrlRaw.startsWith('//')) previewUrlRaw = 'https:' + previewUrlRaw;

    const { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(fileUrl, '', rawTags);
    const previewUrl = resolvePreviewUrl(previewUrlRaw, fileUrl, sampleUrl, isVideo);
    const createdAt = normalizeDate(postItem?.created_at || postItem?.change);

    const parentId = postItem?.parent_id && String(postItem.parent_id) !== '0' ? String(postItem.parent_id) : null;
    const hasChildren = Boolean(postItem?.has_children);
    const seriesKey = extractSeriesKey({
      source: finalSource,
      parentId,
      hasChildren,
      originalId: cleanId,
      tags: rawTags
    }, 'xbooru');

    return {
      id: `xbooru_${cleanId}`,
      originalId: cleanId,
      site: 'xbooru',
      siteName: 'Xbooru',
      previewUrl,
      sampleUrl,
      fileUrl,
      fileExt,
      isVideo,
      isGif,
      hasSound: isVideo && hasSound,
      author,
      tags: rawTags,
      tagDetails,
      score: parseInt(postItem?.score, 10) || 0,
      rating: postItem?.rating || 'e',
      width: parseInt(postItem?.width, 10) || 0,
      height: parseInt(postItem?.height, 10) || 0,
      source: finalSource,
      postUrl: `https://xbooru.com/index.php?page=post&s=view&id=${cleanId}`,
      parentId,
      hasChildren,
      seriesKey,
      createdAt,
      isAi: checkIsAi(rawTags, aiTagsList)
    };
  } catch (err) {
    logError('Xbooru Resolve', `Ошибка разрешения поста xbooru id:${cleanId}`, err);
    return null;
  }
}

