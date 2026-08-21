import { safeJsonParse, fetchSafe, resolvePreviewUrl } from '../utils/network.js';
import { checkIsAi, checkMediaTypes, extractAuthor, classifyTags, normalizeDate, adaptTagsForSite } from '../utils/tagHelpers.js';
import { extractSeriesKey } from '../utils/albumHelper.js';

function getRecentDateFilter(days = 30) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `date:>=${year}-${month}-${day}`;
}

export async function fetchSafebooru(params, aiTagsList) {
  const { tags = '', page = 1, limit = 40, category = '', typeFilter = 'all', ratingFilter = 'all', ageFilter = 'all', dateFilter = 'all' } = params;
  if (typeFilter === 'video' || typeFilter === 'audio' || typeFilter === 'sound' || ratingFilter === 'nsfw') {
    return [];
  }

  let finalTags = adaptTagsForSite('safebooru', tags, ageFilter, typeFilter);
  if (category === 'top') {
    if (!finalTags.includes('sort:') && !finalTags.includes('order:')) {
      finalTags = finalTags ? `${finalTags} sort:score:desc` : 'sort:score:desc';
    }
  } else if (category === 'views') {
    if (!finalTags.includes('sort:') && !finalTags.includes('order:')) {
      finalTags = finalTags ? `${finalTags} sort:views:desc` : 'sort:views:desc';
    }
  } else if (category === 'popular') {
    if (!finalTags.includes('sort:') && !finalTags.includes('order:') && !finalTags.includes('date:')) {
      const recentDate = getRecentDateFilter(30);
      finalTags = finalTags ? `${finalTags} ${recentDate} sort:score:desc` : `${recentDate} sort:score:desc`;
    }
  } else if (category === 'recommended') {
    if (!finalTags.includes('sort:') && !finalTags.includes('order:')) {
      finalTags = finalTags ? `${finalTags} sort:score:desc` : 'sort:score:desc';
    }
  } else if (category === 'random') {
    if (!finalTags.includes('sort:') && !finalTags.includes('order:')) {
      finalTags = finalTags ? `${finalTags} sort:random` : 'sort:random';
    }
  }

  if (dateFilter && dateFilter !== 'all' && !finalTags.includes('date:')) {
    const daysMap = {
      '24h': 1,
      '1d': 1,
      '2d': 2,
      '7d': 7,
      'week': 7,
      '30d': 30,
      'month': 30,
      '90d': 90,
      '3months': 90,
      '365d': 365,
      'year': 365
    };
    const days = daysMap[dateFilter];
    if (days) {
      const recentDate = getRecentDateFilter(days);
      finalTags = finalTags ? `${finalTags} ${recentDate}` : recentDate;
    }
  }

  const pid = Math.max(0, page - 1);
  const url = `https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&tags=${encodeURIComponent(finalTags)}&pid=${pid}&limit=${limit}`;
  const res = await fetchSafe(url);
  if (!res.ok) return [];
  const text = await res.text();
  const data = safeJsonParse(text, []);
  const posts = Array.isArray(data) ? data : (data?.post || []);

  return posts.map(item => {
    const rawTags = (item.tags || '').split(' ').filter(Boolean);
    let fileUrl = item.file_url || '';
    if (fileUrl.startsWith('//')) fileUrl = 'https:' + fileUrl;
    else if (fileUrl.startsWith('/')) fileUrl = 'https://safebooru.org' + fileUrl;

    let sampleUrl = item.sample_url || fileUrl;
    if (sampleUrl.startsWith('//')) sampleUrl = 'https:' + sampleUrl;
    else if (sampleUrl.startsWith('/')) sampleUrl = 'https://safebooru.org' + sampleUrl;

    let previewUrlRaw = item.preview_url || item.sample_url || fileUrl;
    if (previewUrlRaw.startsWith('//')) previewUrlRaw = 'https:' + previewUrlRaw;
    else if (previewUrlRaw.startsWith('/')) previewUrlRaw = 'https://safebooru.org' + previewUrlRaw;

    const { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(fileUrl, '', rawTags);
    const previewUrl = resolvePreviewUrl(previewUrlRaw, fileUrl, sampleUrl, isVideo);
    const isAi = checkIsAi(rawTags, aiTagsList);
    const author = extractAuthor(rawTags, item.source, item.author || item.owner);
    const tagDetails = classifyTags(rawTags, author);
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
      rating: item.rating || 's',
      width: parseInt(item.width, 10) || 0,
      height: parseInt(item.height, 10) || 0,
      source: item.source || '',
      parentId,
      hasChildren,
      seriesKey,
      createdAt,
      isAi
    };
  });
}
