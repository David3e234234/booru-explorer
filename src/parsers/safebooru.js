import { safeJsonParse, fetchSafe, resolvePreviewUrl, discardResponse } from '../utils/network.js';
import { checkIsAi, checkMediaTypes, normalizeDate, adaptTagsForSite, decodeHtmlEntities } from '../utils/tagHelpers.js';
import { classifyPostTags } from '../utils/tagClassifier.js';
import { extractSeriesKey } from '../utils/albumHelper.js';
import { logError } from '../utils/logger.js';
import { parseDapiXmlPosts } from './gelbooru.js';

function safeDecodeURIComponent(str) {
  try {
    return decodeURIComponent(String(str || ''));
  } catch {
    return String(str || '');
  }
}

function getRecentDateFilter(days = 30) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `date:>=${year}-${month}-${day}`;
}

let cachedSafebooruMaxId = 7100000;
let lastMaxIdCheck = 0;

async function getSafebooruMaxId(settings) {
  const now = Date.now();
  if (now - lastMaxIdCheck < 3600 * 1000 && cachedSafebooruMaxId > 0) {
    return cachedSafebooruMaxId;
  }
  try {
    const res = await fetchSafe('https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&limit=1', { settings, site: 'safebooru' });
    if (res.ok) {
      const data = safeJsonParse(await res.text(), []);
      const first = Array.isArray(data) ? data[0] : data?.post?.[0];
      if (first?.id) {
        cachedSafebooruMaxId = parseInt(first.id, 10);
        lastMaxIdCheck = now;
      }
    }
  } catch {}
  return cachedSafebooruMaxId;
}

export async function fetchSafebooru(params, aiTagsList, settings = {}) {
  const { tags = '', page = 1, limit = 40, category = '', typeFilter = 'all', ratingFilter = 'all', ageFilter = 'all' } = params;
  if (typeFilter === 'video' || typeFilter === 'audio' || typeFilter === 'sound' || ratingFilter === 'nsfw' || ratingFilter === 'questionable' || ratingFilter === '16+') {
    return [];
  }

  let finalTags = adaptTagsForSite('safebooru', tags, ageFilter, typeFilter, settings);
  const customSafebooruTag = settings?.siteSortTags?.safebooru?.[category];
  if (customSafebooruTag) {
    finalTags = finalTags ? `${finalTags} ${customSafebooruTag}` : customSafebooruTag;
  } else if (category === 'hot') {
    if (!finalTags.includes('sort:') && !finalTags.includes('order:')) {
      const maxId = await getSafebooruMaxId(settings);
      const minId = Math.max(1, maxId - 100000);
      finalTags = finalTags ? `${finalTags} id:>=${minId} sort:score:desc` : `id:>=${minId} sort:score:desc`;
    }
  } else if (category === 'top') {
    if (!finalTags.includes('sort:') && !finalTags.includes('order:')) {
      finalTags = finalTags ? `${finalTags} sort:score:desc` : 'sort:score:desc';
    }
  } else if (category === 'views') {
    if (!finalTags.includes('sort:') && !finalTags.includes('order:')) {
      finalTags = finalTags ? `${finalTags} sort:views:desc` : 'sort:views:desc';
    }
  } else if (category === 'popular' || category === 'recommended') {
    if (!finalTags.includes('sort:') && !finalTags.includes('order:')) {
      finalTags = finalTags ? `${finalTags} sort:score:desc` : 'sort:score:desc';
    }
  } else if (category === 'random') {
    if (!finalTags.includes('sort:') && !finalTags.includes('order:')) {
      finalTags = finalTags ? `${finalTags} sort:random` : 'sort:random';
    }
  } else if (category === 'new' && settings?.siteSortTags?.safebooru?.new) {
    finalTags = finalTags ? `${finalTags} ${settings.siteSortTags.safebooru.new}` : settings.siteSortTags.safebooru.new;
  }

  const pid = Math.max(0, page - 1);
  const url = `https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&tags=${encodeURIComponent(finalTags)}&pid=${pid}&limit=${limit}`;

  try {
    const res = await fetchSafe(url, { settings, site: 'safebooru' });
    if (!res.ok) {
      logError('Safebooru', `API статус: ${res.status}`);
      await discardResponse(res);
      return [];
    }
    const text = await res.text();
    let posts = [];
    const data = safeJsonParse(text, null);
    if (data) {
      posts = Array.isArray(data) ? data : (data?.post || []);
    } else if (text.includes('<post')) {
      posts = parseDapiXmlPosts(text);
    }

    const validPosts = (Array.isArray(posts) ? posts : []).filter(item => item && typeof item === 'object');

    // One malformed item must not blank the whole page: each post settles on its
    // own and only the rejections are dropped
    const settled = await Promise.allSettled(validPosts.map(async item => {
      const rawTags = decodeHtmlEntities(item.tags || '').split(/\s+/).filter(Boolean);
      let fileUrl = item.file_url || '';
      if (!fileUrl && item.directory && item.image) {
        fileUrl = `https://safebooru.org/images/${item.directory}/${item.image}`;
      } else if (fileUrl.startsWith('//')) {
        fileUrl = 'https:' + fileUrl;
      } else if (fileUrl.startsWith('/')) {
        fileUrl = 'https://safebooru.org' + fileUrl;
      }

      let sampleUrl = item.sample_url || fileUrl || '';
      if (sampleUrl.startsWith('//')) sampleUrl = 'https:' + sampleUrl;
      else if (sampleUrl.startsWith('/')) sampleUrl = 'https://safebooru.org' + sampleUrl;

      let previewUrlRaw = item.preview_url || (item.directory && item.image ? `https://safebooru.org/thumbnails/${item.directory}/thumbnail_${item.image}` : fileUrl);
      if (previewUrlRaw.startsWith('//')) previewUrlRaw = 'https:' + previewUrlRaw;
      else if (previewUrlRaw.startsWith('/')) previewUrlRaw = 'https://safebooru.org' + previewUrlRaw;

      const { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(fileUrl, '', rawTags);
      const previewUrl = resolvePreviewUrl(previewUrlRaw, fileUrl, sampleUrl, isVideo);
      const thumb180 = previewUrl || sampleUrl || fileUrl || '';
      const thumb360 = sampleUrl || previewUrl || fileUrl || '';
      const thumb720 = sampleUrl || fileUrl || previewUrl || '';
      const thumbSample = sampleUrl;
      const thumbOriginal = fileUrl;
      const isAi = checkIsAi(rawTags, aiTagsList);
      const { tagDetails, author, assistants } = await classifyPostTags(rawTags, item.source, '', settings);
      const createdAt = normalizeDate(item.created_at || item.change);
      const parentId = item.parent_id && String(item.parent_id) !== '0' ? String(item.parent_id) : null;
      const hasChildren = Boolean(item.has_children);
      const seriesKey = extractSeriesKey({
        source: item.source || '',
        parentId,
        hasChildren,
        originalId: String(item.id),
        tags: rawTags
      }, 'safebooru');

      return {
        id: `safebooru_${item.id}`,
        originalId: String(item.id),
        site: 'safebooru',
        siteName: 'Safebooru',
        previewUrl,
        thumb180,
        thumb360,
        thumb720,
        thumbSample,
        thumbOriginal,
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
        score: parseInt(item.score, 10) || 0,
        rating: 's',
        width: parseInt(item.width, 10) || 0,
        height: parseInt(item.height, 10) || 0,
        source: item.source || '',
        postUrl: `https://safebooru.org/index.php?page=post&s=view&id=${item.id}`,
        parentId,
        hasChildren,
        seriesKey,
        createdAt,
        isAi
      };
    }));
    settled.forEach(r => { if (r.status === 'rejected') logError('Safebooru', 'Пропущен битый элемент апстрима', r.reason); });
    return settled.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
  } catch (err) {
    logError('Safebooru', 'Ошибка загрузки постов Safebooru', err);
    return [];
  }
}

export async function fetchSafebooruPostById(id, aiTagsList = [], settings = {}, fallbackTags = []) {
  const cleanId = String(id || '').replace(/^safebooru_/, '').split('_')[0].trim();
  if (!cleanId) return null;

  let dapiItem = null;
  try {
    const dapiUrl = `https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&id=${cleanId}`;
    const res = await fetchSafe(dapiUrl, { timeout: 6000, settings, site: 'safebooru' });
    if (res.ok) {
      const text = await res.text();
      const data = safeJsonParse(text, null);
      if (data) {
        const valid = (Array.isArray(data) ? data : (data?.post || [])).filter(p => p && typeof p === 'object');
        dapiItem = valid.find(p => String(p.id) === cleanId) || valid[0] || null;
      } else if (text.includes('<post')) {
        const xmlPosts = (parseDapiXmlPosts(text) || []).filter(p => p && typeof p === 'object');
        dapiItem = xmlPosts.find(p => String(p.id) === cleanId) || xmlPosts[0] || null;
      }
    } else {
      await discardResponse(res);
    }
  } catch (err) {}

  let htmlTags = { artist: [], copyright: [], character: [], meta: [], general: [] };
  let htmlSource = '';
  let htmlDate = '';

  try {
    const viewUrl = `https://safebooru.org/index.php?page=post&s=view&id=${cleanId}`;
    const res = await fetchSafe(viewUrl, { timeout: 7000, settings, site: 'safebooru' });
    if (res.ok) {
      const html = await res.text();
      const artistMatches = [...html.matchAll(/class="[^"]*tag-type-artist[^"]*"[^>]*>[\s\S]*?<a[^>]*tags=([^"&]+)[^>]*>([^<]+)<\/a>/gi)].map(m => safeDecodeURIComponent(m[1]).trim());
      const copyrightMatches = [...html.matchAll(/class="[^"]*tag-type-copyright[^"]*"[^>]*>[\s\S]*?<a[^>]*tags=([^"&]+)[^>]*>([^<]+)<\/a>/gi)].map(m => safeDecodeURIComponent(m[1]).trim());
      const characterMatches = [...html.matchAll(/class="[^"]*tag-type-character[^"]*"[^>]*>[\s\S]*?<a[^>]*tags=([^"&]+)[^>]*>([^<]+)<\/a>/gi)].map(m => safeDecodeURIComponent(m[1]).trim());
      const metadataMatches = [...html.matchAll(/class="[^"]*tag-type-(?:metadata|meta)[^"]*"[^>]*>[\s\S]*?<a[^>]*tags=([^"&]+)[^>]*>([^<]+)<\/a>/gi)].map(m => safeDecodeURIComponent(m[1]).trim());
      const generalMatches = [...html.matchAll(/class="[^"]*tag-type-general[^"]*"[^>]*>[\s\S]*?<a[^>]*tags=([^"&]+)[^>]*>([^<]+)<\/a>/gi)].map(m => safeDecodeURIComponent(m[1]).trim());

      htmlTags = {
        artist: artistMatches,
        copyright: copyrightMatches,
        character: characterMatches,
        meta: metadataMatches,
        general: generalMatches
      };

      const sourceMatch = html.match(/Source:\s*<a[^>]+href="([^"]+)"/i) || html.match(/<li>Source:\s*([^\s<]+)/i);
      if (sourceMatch && sourceMatch[1] && !sourceMatch[1].includes('<')) htmlSource = sourceMatch[1].trim();

      const dateMatch = html.match(/Posted:\s*([0-9-]+\s+[0-9:]+)/i) || html.match(/([0-9]{4}-[0-9]{2}-[0-9]{2}\s+[0-9:]+)/i);
      if (dateMatch) htmlDate = normalizeDate(dateMatch[1]);
    } else {
      await discardResponse(res);
    }
  } catch (err) {}

  const collectedTags = [...new Set([
    ...htmlTags.artist,
    ...htmlTags.copyright,
    ...htmlTags.character,
    ...htmlTags.meta,
    ...htmlTags.general,
    ...(dapiItem?.tags ? decodeHtmlEntities(dapiItem.tags).split(/\s+/).filter(Boolean) : []),
    ...fallbackTags
  ])];

  if (!dapiItem && collectedTags.length === 0) return null;

  let fileUrl = dapiItem?.file_url || '';
  if (!fileUrl && dapiItem?.directory && dapiItem?.image) {
    fileUrl = `https://safebooru.org/images/${dapiItem.directory}/${dapiItem.image}`;
  } else if (fileUrl.startsWith('//')) {
    fileUrl = 'https:' + fileUrl;
  } else if (fileUrl.startsWith('/')) {
    fileUrl = 'https://safebooru.org' + fileUrl;
  }

  let sampleUrl = dapiItem?.sample_url || fileUrl;
  if (sampleUrl.startsWith('//')) sampleUrl = 'https:' + sampleUrl;
  else if (sampleUrl.startsWith('/')) sampleUrl = 'https://safebooru.org' + sampleUrl;

  let previewUrlRaw = dapiItem?.preview_url || (dapiItem?.directory && dapiItem?.image ? `https://safebooru.org/thumbnails/${dapiItem.directory}/thumbnail_${dapiItem.image}` : fileUrl);
  if (previewUrlRaw.startsWith('//')) previewUrlRaw = 'https:' + previewUrlRaw;
  else if (previewUrlRaw.startsWith('/')) previewUrlRaw = 'https://safebooru.org' + previewUrlRaw;

  const { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(fileUrl, '', collectedTags);
  const previewUrl = resolvePreviewUrl(previewUrlRaw, fileUrl, sampleUrl, isVideo);
  const thumb180 = previewUrl || sampleUrl || fileUrl || '';
  const thumb360 = sampleUrl || previewUrl || fileUrl || '';
  const thumb720 = sampleUrl || fileUrl || previewUrl || '';
  const thumbSample = sampleUrl;
  const thumbOriginal = fileUrl;

  const initialAuthor = htmlTags.artist.join(', ');
  const finalSource = htmlSource || dapiItem?.source || '';
  const { tagDetails, author, assistants } = await classifyPostTags(collectedTags, finalSource, initialAuthor, settings, true);

  if (htmlTags.artist.length > 0) tagDetails.artist = [...new Set([...htmlTags.artist, ...(tagDetails.artist || [])])];
  if (htmlTags.copyright.length > 0) tagDetails.copyright = [...new Set([...htmlTags.copyright, ...(tagDetails.copyright || [])])];
  if (htmlTags.character.length > 0) tagDetails.character = [...new Set([...htmlTags.character, ...(tagDetails.character || [])])];
  if (htmlTags.meta.length > 0) tagDetails.meta = [...new Set([...htmlTags.meta, ...(tagDetails.meta || [])])];

  const parentId = dapiItem?.parent_id && String(dapiItem.parent_id) !== '0' ? String(dapiItem.parent_id) : null;
  const hasChildren = Boolean(dapiItem?.has_children);
  const seriesKey = extractSeriesKey({
    source: finalSource,
    parentId,
    hasChildren,
    originalId: cleanId,
    tags: collectedTags
  }, 'safebooru');

  return {
    id: `safebooru_${cleanId}`,
    originalId: cleanId,
    site: 'safebooru',
    siteName: 'Safebooru',
    previewUrl,
    thumb180,
    thumb360,
    thumb720,
    thumbSample,
    thumbOriginal,
    sampleUrl,
    fileUrl,
    fileExt,
    isVideo,
    isGif,
    hasSound: isVideo && hasSound,
    author: author || initialAuthor,
    assistants: assistants || [],
    tags: collectedTags,
    tagDetails,
    score: parseInt(dapiItem?.score, 10) || 0,
    rating: 's',
    width: parseInt(dapiItem?.width, 10) || 0,
    height: parseInt(dapiItem?.height, 10) || 0,
    source: finalSource,
    postUrl: `https://safebooru.org/index.php?page=post&s=view&id=${cleanId}`,
    parentId,
    hasChildren,
    seriesKey,
    createdAt: htmlDate || normalizeDate(dapiItem?.created_at || dapiItem?.change),
    isAi: checkIsAi(collectedTags, aiTagsList)
  };
}

