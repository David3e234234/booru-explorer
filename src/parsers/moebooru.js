import crypto from 'crypto';
import { safeJsonParse, fetchSafe, resolvePreviewUrl, discardResponse } from '../utils/network.js';
import { checkIsAi, checkMediaTypes, normalizeDate, adaptTagsForSite } from '../utils/tagHelpers.js';
import { classifyPostTags } from '../utils/tagClassifier.js';
import { extractSeriesKey } from '../utils/albumHelper.js';
import { logError } from '../utils/logger.js';

// Moebooru API auth: password_hash is SHA1 of a fixed-salted password,
// see "Logging In" on the site help/api page
const MOEBOORU_PASSWORD_SALT = 'So-I-Heard-You-Like-Mupkids-?--';

const MOEBOORU_AUTH_FIELDS = {
  konachan: { login: 'konachanLogin', password: 'konachanPassword' },
  yandere: { login: 'yandereLogin', password: 'yanderePassword' }
};

function buildAuthQuery(siteId, settings) {
  const fields = MOEBOORU_AUTH_FIELDS[siteId];
  if (!fields || !settings) return '';
  const login = String(settings[fields.login] || '').trim();
  const password = String(settings[fields.password] || '').trim();
  if (!login || !password) return '';
  const hash = crypto.createHash('sha1').update(`${MOEBOORU_PASSWORD_SALT}${password}--`).digest('hex');
  return `&login=${encodeURIComponent(login)}&password_hash=${hash}`;
}

// Sticky failover: if konachan.com is unreachable/blocked, switch to konachan.net for 30 minutes
let preferredKonachanHost = 'konachan.com';
let lastKonachanFailureTime = 0;
const KONACHAN_FAILOVER_TTL_MS = 30 * 60 * 1000;

export async function fetchMoebooru(siteId, siteUrl, siteName, params, aiTagsList, settings) {
  const { tags = '', page = 1, limit = 40, category = '', ratingFilter = 'all', typeFilter = 'all', ageFilter = 'all' } = params;
  if (typeFilter === 'video' || typeFilter === 'audio' || typeFilter === 'sound') {
    return [];
  }

  let effectiveSiteUrl = siteUrl;
  if (siteId === 'konachan' && preferredKonachanHost === 'konachan.net' && (Date.now() - lastKonachanFailureTime < KONACHAN_FAILOVER_TTL_MS)) {
    effectiveSiteUrl = 'https://konachan.net';
  }

  let finalTags = adaptTagsForSite(siteId, tags, ageFilter, typeFilter);
  let url = '';

  const customMoebooruTag = settings?.siteSortTags?.[siteId]?.[category];
  if (customMoebooruTag) {
    finalTags = finalTags ? `${finalTags} ${customMoebooruTag}` : customMoebooruTag;
  } else if (category === 'hot') {
    if (!tags.trim() && ratingFilter === 'all') {
      url = `${effectiveSiteUrl}/post/popular_recent.json?period=1w&page=${page}&limit=${limit}`;
    } else {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      finalTags = finalTags ? `${finalTags} date:>${ymd} order:vote` : `date:>${ymd} order:vote`;
    }
  } else if (category === 'top') {
    finalTags = finalTags ? `${finalTags} order:score` : 'order:score';
  } else if (category === 'views' || category === 'popular' || category === 'recommended') {
    finalTags = finalTags ? `${finalTags} order:score` : 'order:score';
  } else if (category === 'random') {
    finalTags = finalTags ? `${finalTags} order:random` : 'order:random';
  } else if (category === 'new' && settings?.siteSortTags?.[siteId]?.new) {
    finalTags = finalTags ? `${finalTags} ${settings.siteSortTags[siteId].new}` : settings.siteSortTags[siteId].new;
  }

  if (ratingFilter === 'nsfw') {
    finalTags += ' rating:explicit';
  } else if (ratingFilter === 'questionable' || ratingFilter === '16+') {
    finalTags += ' rating:questionable';
  } else if (ratingFilter === 'sfw') {
    finalTags += ' rating:safe';
  }

  if (!url) {
    url = `${effectiveSiteUrl}/post.json?tags=${encodeURIComponent(finalTags.trim())}&page=${page}&limit=${limit}`;
  }
  const authQuery = buildAuthQuery(siteId, settings);
  if (authQuery && !url.includes('konachan.net')) url += authQuery;

  // konachan.net is a separate site with its own accounts, so the fallback goes anonymous
  const toAltKonachanUrl = (u) => {
    const bare = authQuery && u.endsWith(authQuery) ? u.slice(0, -authQuery.length) : u;
    return bare.includes('konachan.com') ? bare.replace('konachan.com', 'konachan.net') : bare.replace('konachan.net', 'konachan.com');
  };

  let res = null;
  const isKonachanPrimaryCom = siteId === 'konachan' && url.includes('konachan.com');
  const requestTimeout = isKonachanPrimaryCom ? 3500 : 8000;

  try {
    res = await fetchSafe(url, { timeout: requestTimeout, settings, site: siteId });
    if (!res.ok && siteId === 'konachan' && ratingFilter !== 'nsfw' && ratingFilter !== 'questionable' && ratingFilter !== '16+') {
      preferredKonachanHost = 'konachan.net';
      lastKonachanFailureTime = Date.now();
      const altRes = await fetchSafe(toAltKonachanUrl(url), { settings, site: siteId });
      if (altRes.ok) {
        await discardResponse(res);
        res = altRes;
      } else {
        await discardResponse(altRes);
      }
    }
  } catch (e) {
    if (siteId === 'konachan' && ratingFilter !== 'nsfw' && ratingFilter !== 'questionable' && ratingFilter !== '16+') {
      preferredKonachanHost = 'konachan.net';
      lastKonachanFailureTime = Date.now();
      try {
        res = await fetchSafe(toAltKonachanUrl(url), { settings, site: siteId });
      } catch (err) {}
    }
  }
  if (!res || !res.ok) {
    logError(siteName, `API статус: ${res?.status || 'network error'}`);
    await discardResponse(res);
    return [];
  }
  const text = await res.text();
  const data = safeJsonParse(text, []);
  if (!Array.isArray(data)) return [];

  return await Promise.all(data.map(async item => {
    const rawTags = (item.tags || '').split(' ').filter(Boolean);
    const fileUrl = item.file_url || item.jpeg_url || item.sample_url || item.preview_url;
    const sampleUrl = item.sample_url || item.jpeg_url || fileUrl;
    const { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(fileUrl, '', rawTags);
    const previewUrl = resolvePreviewUrl(item.preview_url, fileUrl, sampleUrl, isVideo);
    const isAi = checkIsAi(rawTags, aiTagsList);

    const { tagDetails, author, assistants } = await classifyPostTags(rawTags, item.source, '', settings);

    const createdAt = normalizeDate(item.created_at);
    const parentId = item.parent_id && String(item.parent_id) !== '0' ? String(item.parent_id) : null;
    const hasChildren = Boolean(item.has_children);
    const seriesKey = extractSeriesKey({
      source: item.source || '',
      parentId,
      hasChildren,
      originalId: String(item.id),
      tags: rawTags
    }, siteId);

    return {
      id: `${siteId}_${item.id}`,
      originalId: String(item.id),
      site: siteId,
      siteName,
      previewUrl,
      sampleUrl,
      fileUrl,
      fileExt,
      isVideo,
      isGif,
      hasSound: isVideo && hasSound,
      author,
      assistants: assistants || [],
      tags: rawTags,
      tagDetails,
      score: item.score || 0,
      rating: item.rating || 's',
      width: parseInt(item.width, 10) || 0,
      height: parseInt(item.height, 10) || 0,
      source: item.source || '',
      postUrl: `${siteUrl}/post/show/${item.id}`,
      parentId,
      hasChildren,
      seriesKey,
      createdAt,
      isAi
    };
  }));
}

export async function fetchMoebooruPostById(siteId, siteUrl, siteName, id, aiTagsList = [], settings = {}, fallbackTags = []) {
  const cleanId = String(id || '').replace(new RegExp(`^${siteId}_`), '').split('_')[0].trim();
  if (!cleanId || !/^\d+$/.test(cleanId)) return null;

  let effectiveSiteUrl = siteUrl;
  if (siteId === 'konachan' && preferredKonachanHost === 'konachan.net' && (Date.now() - lastKonachanFailureTime < KONACHAN_FAILOVER_TTL_MS)) {
    effectiveSiteUrl = 'https://konachan.net';
  }

  let postItem = null;
  const authQuery = buildAuthQuery(siteId, settings);
  const dapiUrl = `${effectiveSiteUrl}/post.json?tags=id:${cleanId}${authQuery}`;

  try {
    const res = await fetchSafe(dapiUrl, { timeout: 6000, settings, site: siteId });
    if (res.ok) {
      const text = await res.text();
      const data = safeJsonParse(text, []);
      if (Array.isArray(data) && data.length > 0) {
        postItem = data.find(p => String(p.id) === cleanId) || data[0];
      }
    } else {
      await discardResponse(res);
    }
  } catch (err) {}

  let htmlTags = [];
  let htmlSource = '';
  let htmlAuthor = '';
  let htmlDate = '';

  if (!postItem) {
    try {
      const showUrl = `${effectiveSiteUrl}/post/show/${cleanId}`;
      const res = await fetchSafe(showUrl, { timeout: 7000, settings, site: siteId });
      if (res.ok) {
        const html = await res.text();
        const tagMatches = [...html.matchAll(/class="[^"]*tag-type-([a-z0-9_-]+)[^"]*"[^>]*>[\s\S]*?<a[^>]*tags=([^"&]+)[^>]*>([^<]+)<\/a>/gi)];
        for (const m of tagMatches) {
          const tagName = decodeURIComponent(m[2]).trim();
          if (tagName && !htmlTags.includes(tagName)) htmlTags.push(tagName);
        }
        const srcMatch = html.match(/Source:?\s*<a[^>]*href="([^"]+)"/i) || html.match(/Source:?\s*([^\s<"'>]+)/i);
        if (srcMatch && srcMatch[1]) htmlSource = srcMatch[1].trim();
        const authorMatch = html.match(/Posted by:?\s*<a[^>]*>([^<]+)<\/a>/i);
        if (authorMatch) htmlAuthor = authorMatch[1].trim();
        const dateMatch = html.match(/([0-9]{4}-[0-9]{2}-[0-9]{2}\s+[0-9:]+)/i);
        if (dateMatch) htmlDate = normalizeDate(dateMatch[1]);
      } else {
        await discardResponse(res);
      }
    } catch (err) {}
  }

  if (!postItem && htmlTags.length === 0 && fallbackTags.length === 0) return null;

  const rawTags = postItem?.tags
    ? (postItem.tags || '').split(' ').filter(Boolean)
    : (htmlTags.length > 0 ? htmlTags : fallbackTags);

  const fileUrl = postItem?.file_url || postItem?.jpeg_url || postItem?.sample_url || postItem?.preview_url || '';
  const sampleUrl = postItem?.sample_url || postItem?.jpeg_url || fileUrl;
  const { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(fileUrl, '', rawTags);
  const previewUrl = resolvePreviewUrl(postItem?.preview_url, fileUrl, sampleUrl, isVideo);
  const isAi = checkIsAi(rawTags, aiTagsList);

  const finalSource = htmlSource || postItem?.source || '';
  const initialAuthor = htmlAuthor || postItem?.author || '';
  const { tagDetails, author, assistants } = await classifyPostTags(rawTags, finalSource, initialAuthor, settings, true);

  const createdAt = htmlDate || normalizeDate(postItem?.created_at);
  const parentId = postItem?.parent_id && String(postItem.parent_id) !== '0' ? String(postItem.parent_id) : null;
  const hasChildren = Boolean(postItem?.has_children);
  const seriesKey = extractSeriesKey({
    source: finalSource,
    parentId,
    hasChildren,
    originalId: cleanId,
    tags: rawTags
  }, siteId);

  return {
    id: `${siteId}_${cleanId}`,
    originalId: cleanId,
    site: siteId,
    siteName,
    previewUrl,
    sampleUrl,
    fileUrl,
    fileExt,
    isVideo,
    isGif,
    hasSound: isVideo && hasSound,
    author: author || initialAuthor,
    assistants: assistants || [],
    tags: rawTags,
    tagDetails,
    score: postItem?.score || 0,
    rating: postItem?.rating || 's',
    width: parseInt(postItem?.width, 10) || 0,
    height: parseInt(postItem?.height, 10) || 0,
    source: finalSource,
    postUrl: `${siteUrl}/post/show/${cleanId}`,
    parentId,
    hasChildren,
    seriesKey,
    createdAt,
    isAi
  };
}

