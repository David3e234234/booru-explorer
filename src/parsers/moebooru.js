import { safeJsonParse, fetchSafe, resolvePreviewUrl } from '../utils/network.js';
import { checkIsAi, checkMediaTypes, extractAuthor, classifyTags, normalizeDate, adaptTagsForSite } from '../utils/tagHelpers.js';
import { logError } from '../utils/logger.js';

export async function fetchMoebooru(siteId, siteUrl, siteName, params, aiTagsList) {
  const { tags = '', page = 1, limit = 40, category = '', ratingFilter = 'all', typeFilter = 'all', ageFilter = 'all', dateFilter = 'all' } = params;
  if (typeFilter === 'video' || typeFilter === 'audio' || typeFilter === 'sound') {
    return [];
  }

  let finalTags = adaptTagsForSite(siteId, tags, ageFilter, typeFilter);
  let url = '';

  if (category === 'top') {
    finalTags = finalTags ? `${finalTags} order:score` : 'order:score';
  } else if (category === 'views' || category === 'popular' || category === 'recommended') {
    finalTags = finalTags ? `${finalTags} order:vote` : 'order:vote';
  } else if (category === 'random') {
    finalTags = finalTags ? `${finalTags} order:random` : 'order:random';
  }

  if (ratingFilter === 'nsfw') {
    finalTags += ' rating:questionable,explicit';
  } else if (ratingFilter === 'sfw') {
    finalTags += ' rating:safe';
  }

  url = `${siteUrl}/post.json?tags=${encodeURIComponent(finalTags.trim())}&page=${page}&limit=${limit}`;
  let res = null;
  try {
    res = await fetchSafe(url);
    if (!res.ok && siteId === 'konachan' && siteUrl.includes('.net')) {
      const altUrl = url.replace('konachan.net', 'konachan.com');
      const altRes = await fetchSafe(altUrl);
      if (altRes.ok) res = altRes;
    }
  } catch (e) {
    if (siteId === 'konachan' && siteUrl.includes('.net')) {
      try {
        const altUrl = url.replace('konachan.net', 'konachan.com');
        res = await fetchSafe(altUrl);
      } catch (err) {}
    }
  }
  if (!res || !res.ok) {
    logError(siteName, `API статус: ${res?.status || 'network error'}`);
    return [];
  }
  const text = await res.text();
  const data = safeJsonParse(text, []);
  if (!Array.isArray(data)) return [];

  return data.map(item => {
    const rawTags = (item.tags || '').split(' ').filter(Boolean);
    const fileUrl = item.file_url || item.jpeg_url || item.sample_url || item.preview_url;
    const sampleUrl = item.sample_url || item.jpeg_url || fileUrl;
    const { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(fileUrl, '', rawTags);
    const previewUrl = resolvePreviewUrl(item.preview_url, fileUrl, sampleUrl, isVideo);
    const isAi = checkIsAi(rawTags, aiTagsList);
    const author = extractAuthor(rawTags, item.source, item.author);
    const tagDetails = classifyTags(rawTags, author);
    const createdAt = normalizeDate(item.created_at);

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
      tags: rawTags,
      tagDetails,
      score: item.score || 0,
      rating: item.rating || 's',
      width: parseInt(item.width, 10) || 0,
      height: parseInt(item.height, 10) || 0,
      source: item.source || '',
      createdAt,
      isAi
    };
  });
}
