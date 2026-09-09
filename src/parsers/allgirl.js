import { safeJsonParse, fetchSafe, resolvePreviewUrl, discardResponse } from '../utils/network.js';
import { checkIsAi, checkMediaTypes, normalizeDate, decodeHtmlEntities } from '../utils/tagHelpers.js';
import { classifyPostTags } from '../utils/tagClassifier.js';
import { extractSeriesKey } from '../utils/albumHelper.js';
import { logError } from '../utils/logger.js';

const BOORU_ORG_BASE = 'https://allgirl.booru.org';
const POSTS_PER_PAGE = 20;

function buildCookieHeader(settings) {
  const cookie = settings?.allgirlCookie || settings?.allgirlSession;
  return cookie ? { Cookie: cookie } : {};
}

export async function fetchAllgirl(params, aiTagsList, settings = {}) {
  const { tags = '', page = 1, limit = 40, category = '', ratingFilter = 'all', typeFilter = 'all' } = params;

  if (typeFilter === 'video' || typeFilter === 'audio' || typeFilter === 'sound') {
    return [];
  }

  // Gelbooru 0.1.11 rejects negative query tokens (-tag); exclude them from remote URL
  const searchTokens = (tags || '')
    .trim()
    .split(/\s+/)
    .filter(t => t && !t.startsWith('-') && !t.includes(':'));

  if (ratingFilter === 'nsfw') {
    searchTokens.push('rating:explicit');
  } else if (ratingFilter === 'questionable' || ratingFilter === '16+') {
    searchTokens.push('rating:questionable');
  } else if (ratingFilter === 'sfw') {
    searchTokens.push('rating:safe');
  }

  const customTag = settings?.siteSortTags?.allgirl?.[category];
  if (customTag) {
    customTag.split(/\s+/).forEach(t => {
      if (t) searchTokens.push(t);
    });
  }

  let pid = Math.max(0, (parseInt(page, 10) || 1) - 1) * POSTS_PER_PAGE;

  // Gelbooru 0.1 lacks native random sort tags; randomize pagination offset on random queries
  if (category === 'random' && !tags.trim()) {
    const estimatedMaxPid = 150000;
    const randomPage = Math.floor(Math.random() * (estimatedMaxPid / POSTS_PER_PAGE));
    pid = randomPage * POSTS_PER_PAGE;
  }

  const queryTags = searchTokens.join(' ').trim();
  const url = queryTags
    ? `${BOORU_ORG_BASE}/index.php?page=post&s=list&tags=${encodeURIComponent(queryTags)}&pid=${pid}`
    : `${BOORU_ORG_BASE}/index.php?page=post&s=list&pid=${pid}`;

  try {
    const res = await fetchSafe(url, {
      headers: {
        Referer: `${BOORU_ORG_BASE}/index.php?page=post&s=list`,
        ...buildCookieHeader(settings)
      },
      timeout: 8000,
      settings,
      site: 'allgirl'
    });

    if (!res.ok) {
      await discardResponse(res);
      return [];
    }

    const html = await res.text();
    const spanRegex = /<span\s+class="thumb"[^>]*>[\s\S]*?<a\s+id="p(\d+)"\s+href="([^"]*)"[^>]*>[\s\S]*?<img\s+src="([^"]+)"[^>]*title="([^"]*)"[^>]*>[\s\S]*?posts\[\1\]\s*=\s*(\{[\s\S]*?\})[\s\S]*?<\/span>/gi;

    const parsedItems = [];
    let match;

    while ((match = spanRegex.exec(html)) !== null) {
      const id = match[1];
      const thumbUrl = match[3];
      const titleAttr = match[4] || '';
      const jsObjStr = match[5];

      let postData = null;
      try {
        const sanitized = jsObjStr
          .replace(/'/g, '"')
          .replace(/\.split\(\/ \/g\)/g, '')
          .replace(/,\s*}/g, '}');
        postData = JSON.parse(sanitized);
      } catch {
        // Fallback to title attribute if script block parsing fails
      }

      let rawTags = [];
      if (Array.isArray(postData?.tags)) {
        rawTags = postData.tags.map(t => decodeHtmlEntities(String(t)).trim()).filter(Boolean);
      } else {
        const cleanTitle = titleAttr
          .replace(/score:-?\d+/gi, '')
          .replace(/rating:\w+/gi, '')
          .trim();
        rawTags = decodeHtmlEntities(cleanTitle).split(/\s+/).filter(Boolean);
      }

      let rating = 's';
      const ratingRaw = postData?.rating || titleAttr.match(/rating:(\w+)/i)?.[1] || '';
      const rLower = ratingRaw.toLowerCase();
      if (rLower === 'explicit') rating = 'e';
      else if (rLower === 'questionable') rating = 'q';
      else if (rLower === 'safe') rating = 's';

      let score = 0;
      if (typeof postData?.score === 'number') {
        score = postData.score;
      } else {
        const scoreMatch = titleAttr.match(/score:(-?\d+)/i);
        if (scoreMatch) score = parseInt(scoreMatch[1], 10) || 0;
      }

      const uploader = postData?.user || '';
      const fileUrl = thumbUrl
        .replace('thumbs.booru.org', 'img.booru.org')
        .replace('/thumbnails//', '/images/')
        .replace('thumbnail_', '');
      const sampleUrl = fileUrl;

      const { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(fileUrl, '', rawTags);
      const previewUrl = resolvePreviewUrl(thumbUrl, fileUrl, sampleUrl, false);

      parsedItems.push({
        id,
        thumbUrl,
        fileUrl,
        sampleUrl,
        previewUrl,
        fileExt,
        isVideo,
        isGif,
        hasSound,
        rawTags,
        rating,
        score,
        uploader
      });
    }

    if (parsedItems.length === 0) {
      return [];
    }

    const shaped = await Promise.all(parsedItems.map(async item => {
      const { tagDetails, author, assistants } = await classifyPostTags(item.rawTags, `${BOORU_ORG_BASE}/index.php?page=post&s=view&id=${item.id}`, item.uploader, settings, false);

      const seriesKey = extractSeriesKey({
        source: '',
        parentId: null,
        hasChildren: false,
        originalId: item.id,
        tags: item.rawTags
      }, 'allgirl');

      return {
        id: `allgirl_${item.id}`,
        originalId: item.id,
        site: 'allgirl',
        siteName: 'AllGirl',
        previewUrl: item.previewUrl,
        thumb180: item.thumbUrl,
        thumb360: item.thumbUrl,
        thumb720: item.thumbUrl,
        thumbSample: item.sampleUrl,
        thumbOriginal: item.fileUrl,
        sampleUrl: item.sampleUrl,
        fileUrl: item.fileUrl,
        fileExt: item.fileExt,
        isVideo: false,
        isGif: item.isGif,
        hasSound: false,
        author: author || item.uploader,
        assistants: assistants || [],
        tags: item.rawTags,
        tagDetails,
        score: item.score,
        rating: item.rating,
        width: 0,
        height: 0,
        source: `${BOORU_ORG_BASE}/index.php?page=post&s=view&id=${item.id}`,
        postUrl: `${BOORU_ORG_BASE}/index.php?page=post&s=view&id=${item.id}`,
        parentId: null,
        hasChildren: false,
        seriesKey,
        createdAt: '',
        isAi: checkIsAi(item.rawTags, aiTagsList)
      };
    }));

    if ((category === 'top' || category === 'views' || category === 'hot' || category === 'popular') && shaped.length > 1) {
      shaped.sort((a, b) => (b.score || 0) - (a.score || 0));
    }

    return shaped.slice(0, limit);
  } catch (err) {
    logError('AllGirl', 'Ошибка загрузки постов', err);
    return [];
  }
}

export async function fetchAllgirlPostById(id, aiTagsList = [], settings = {}, fallbackTags = []) {
  const cleanId = String(id || '').replace(/^allgirl_/, '').split('_')[0].trim();
  if (!cleanId) return null;

  try {
    const postUrl = `${BOORU_ORG_BASE}/index.php?page=post&s=view&id=${cleanId}`;
    const res = await fetchSafe(postUrl, {
      headers: {
        Referer: `${BOORU_ORG_BASE}/index.php?page=post&s=list`,
        ...buildCookieHeader(settings)
      },
      timeout: 8000,
      settings,
      site: 'allgirl'
    });

    if (!res.ok) {
      await discardResponse(res);
      return null;
    }

    const html = await res.text();
    const imgMatch = html.match(/<img[^>]+id="image"[^>]+src="([^"]+)"/i) || html.match(/<img[^>]+src="([^"]+images[^"]+)"[^>]*id="image"/i);
    const fileUrl = imgMatch ? imgMatch[1] : '';

    let width = 0;
    let height = 0;
    const sizeMatch = html.match(/Size:\s*(\d+)x(\d+)/i);
    if (sizeMatch) {
      width = parseInt(sizeMatch[1], 10) || 0;
      height = parseInt(sizeMatch[2], 10) || 0;
    }

    let createdAt = '';
    const postedMatch = html.match(/Posted:\s*([0-9-]+\s+[0-9:]+)/i);
    if (postedMatch) {
      createdAt = normalizeDate(postedMatch[1]);
    }

    let uploader = '';
    const byMatch = html.match(/By:\s*([^\s<]+)/i);
    if (byMatch) {
      uploader = byMatch[1].trim();
    }

    let source = '';
    const sourceMatch = html.match(/Source:\s*<a[^>]+href="([^"]+)"/i) || html.match(/Source:\s*([^\s<]+)/i);
    if (sourceMatch && sourceMatch[1] && !sourceMatch[1].includes('<')) {
      source = sourceMatch[1].trim();
    }

    let score = 0;
    const scoreMatch = html.match(/Score:\s*(-?\d+)/i) || html.match(/id="psc">(-?\d+)</i);
    if (scoreMatch) {
      score = parseInt(scoreMatch[1], 10) || 0;
    }

    let rating = 's';
    const ratingMatch = html.match(/Rating:\s*(\w+)/i);
    if (ratingMatch) {
      const r = ratingMatch[1].toLowerCase();
      if (r === 'explicit') rating = 'e';
      else if (r === 'questionable') rating = 'q';
      else if (r === 'safe') rating = 's';
    }

    const tagMatches = [...html.matchAll(/<a[^>]+href="index\.php\?page=post&amp;s=list&amp;tags=([^"&]+)"[^>]*>([^<]+)<\/a>/gi)];
    const parsedTags = [];
    tagMatches.forEach(m => {
      const rawTag = decodeURIComponent(m[1]).replace(/\+/g, '_').trim().toLowerCase();
      if (rawTag && rawTag !== 'all' && !parsedTags.includes(rawTag)) {
        parsedTags.push(rawTag);
      }
    });

    const allTags = parsedTags.length > 0 ? parsedTags : fallbackTags;
    const { tagDetails, author, assistants } = await classifyPostTags(allTags, source, uploader, settings, true);

    const { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(fileUrl, '', allTags);
    const thumbUrl = fileUrl
      .replace('img.booru.org', 'thumbs.booru.org')
      .replace('/images/', '/thumbnails//')
      .replace(/(\/[^/]+)$/, '/thumbnail_$1'.replace('//', '/'));

    const seriesKey = extractSeriesKey({
      source,
      parentId: null,
      hasChildren: false,
      originalId: cleanId,
      tags: allTags
    }, 'allgirl');

    return {
      id: `allgirl_${cleanId}`,
      originalId: cleanId,
      site: 'allgirl',
      siteName: 'AllGirl',
      previewUrl: thumbUrl || fileUrl,
      sampleUrl: fileUrl,
      fileUrl,
      fileExt,
      isVideo: false,
      isGif,
      hasSound: false,
      author: author || uploader,
      assistants: assistants || [],
      tags: allTags,
      tagDetails,
      score,
      rating,
      width,
      height,
      source,
      postUrl,
      parentId: null,
      hasChildren: false,
      seriesKey,
      createdAt,
      isAi: checkIsAi(allTags, aiTagsList)
    };
  } catch (err) {
    logError('AllGirl Resolve', `Ошибка разрешения поста allgirl id:${cleanId}`, err);
    return null;
  }
}
