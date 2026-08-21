import { safeJsonParse, fetchSafe, resolvePreviewUrl } from '../utils/network.js';
import { checkIsAi, checkMediaTypes, extractAuthor, classifyTags, normalizeDate, adaptTagsForSite } from '../utils/tagHelpers.js';
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

export async function fetchXbooru(params, aiTagsList) {
  const { tags = '', page = 1, limit = 40, category = '', ratingFilter = 'all', typeFilter = 'all', ageFilter = 'all', dateFilter = 'all' } = params;
  if (ratingFilter === 'sfw') {
    return [];
  }

  let searchTags = adaptTagsForSite('xbooru', tags, ageFilter, typeFilter);
  if (category === 'top') {
    if (!searchTags.includes('sort:') && !searchTags.includes('order:')) {
      searchTags = searchTags ? `${searchTags} sort:score:desc` : 'sort:score:desc';
    }
  } else if (category === 'views') {
    if (!searchTags.includes('sort:') && !searchTags.includes('order:')) {
      searchTags = searchTags ? `${searchTags} sort:views:desc` : 'sort:views:desc';
    }
  } else if (category === 'popular') {
    if (!searchTags.includes('sort:') && !searchTags.includes('order:') && !searchTags.includes('date:')) {
      const recentDate = getRecentDateFilter(30);
      searchTags = searchTags ? `${searchTags} ${recentDate} sort:score:desc` : `${recentDate} sort:score:desc`;
    }
  } else if (category === 'recommended') {
    if (!searchTags.includes('sort:') && !searchTags.includes('order:')) {
      searchTags = searchTags ? `${searchTags} sort:score:desc` : 'sort:score:desc';
    }
  } else if (category === 'random') {
    if (!searchTags.includes('sort:') && !searchTags.includes('order:')) {
      searchTags = searchTags ? `${searchTags} sort:random` : 'sort:random';
    }
  }

  if (dateFilter && dateFilter !== 'all' && !searchTags.includes('date:')) {
    const daysMap = { '24h': 1, '1d': 1, '2d': 2, '7d': 7, 'week': 7, '30d': 30, 'month': 30, '90d': 90, '3months': 90, '365d': 365, 'year': 365 };
    const days = daysMap[dateFilter];
    if (days) {
      const recentDate = getRecentDateFilter(days);
      searchTags = searchTags ? `${searchTags} ${recentDate}` : recentDate;
    }
  }

  if (typeFilter === 'video' || typeFilter === 'audio' || typeFilter === 'sound') {
    searchTags = searchTags ? `${searchTags} animated` : 'animated';
  }

  const pid = Math.max(0, page - 1);
  const url = `https://xbooru.com/index.php?page=dapi&s=post&q=index&json=1&tags=${encodeURIComponent(searchTags)}&pid=${pid}&limit=${limit}`;

  try {
    const res = await fetchSafe(url, {
      headers: {
        'Referer': 'https://xbooru.com/'
      }
    });
    if (!res.ok) return [];
    const text = await res.text();
    const data = safeJsonParse(text, []);
    const posts = data?.post || (Array.isArray(data) ? data : []);

    return posts.map(item => {
      const rawTags = (item.tags || '').split(' ').filter(Boolean);
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
      const author = extractAuthor(rawTags, item.source, item.owner || item.creator_id || item.author);
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
        hasSound: isVideo && (hasSound || rawTags.includes('sound') || rawTags.includes('audio')),
        author,
        tags: rawTags,
        tagDetails,
        score: parseInt(item.score, 10) || 0,
        rating: item.rating || 'e',
        width: parseInt(item.width, 10) || 0,
        height: parseInt(item.height, 10) || 0,
        source: item.source || '',
        parentId,
        hasChildren,
        seriesKey,
        createdAt,
        isAi: checkIsAi(rawTags, aiTagsList)
      };
    });
  } catch (err) {
    logError('Xbooru', 'Ошибка загрузки постов', err);
    return [];
  }
}

export async function fetchHypnohub(params, aiTagsList) {
  const { tags = '', page = 1, limit = 40, category = '', ratingFilter = 'all', typeFilter = 'all', ageFilter = 'all', dateFilter = 'all' } = params;

  let searchTags = adaptTagsForSite('hypnohub', tags, ageFilter, typeFilter);
  if (category === 'top') {
    if (!searchTags.includes('sort:') && !searchTags.includes('order:')) {
      searchTags = searchTags ? `${searchTags} sort:score:desc` : 'sort:score:desc';
    }
  } else if (category === 'views') {
    if (!searchTags.includes('sort:') && !searchTags.includes('order:')) {
      searchTags = searchTags ? `${searchTags} sort:views:desc` : 'sort:views:desc';
    }
  } else if (category === 'popular') {
    if (!searchTags.includes('sort:') && !searchTags.includes('order:') && !searchTags.includes('date:')) {
      const recentDate = getRecentDateFilter(30);
      searchTags = searchTags ? `${searchTags} ${recentDate} sort:score:desc` : `${recentDate} sort:score:desc`;
    }
  } else if (category === 'recommended') {
    if (!searchTags.includes('sort:') && !searchTags.includes('order:')) {
      searchTags = searchTags ? `${searchTags} sort:score:desc` : 'sort:score:desc';
    }
  } else if (category === 'random') {
    if (!searchTags.includes('sort:') && !searchTags.includes('order:')) {
      searchTags = searchTags ? `${searchTags} sort:random` : 'sort:random';
    }
  }

  if (dateFilter && dateFilter !== 'all' && !searchTags.includes('date:')) {
    const daysMap = { '24h': 1, '1d': 1, '2d': 2, '7d': 7, 'week': 7, '30d': 30, 'month': 30, '90d': 90, '3months': 90, '365d': 365, 'year': 365 };
    const days = daysMap[dateFilter];
    if (days) {
      const recentDate = getRecentDateFilter(days);
      searchTags = searchTags ? `${searchTags} ${recentDate}` : recentDate;
    }
  }

  if (ratingFilter === 'nsfw') {
    searchTags = searchTags ? `${searchTags} rating:e` : 'rating:e';
  } else if (ratingFilter === 'sfw') {
    searchTags = searchTags ? `${searchTags} rating:s` : 'rating:s';
  }

  if (typeFilter === 'video' || typeFilter === 'audio' || typeFilter === 'sound') {
    searchTags = searchTags ? `${searchTags} animated` : 'animated';
  }

  const pid = Math.max(0, page - 1);
  const url = `https://hypnohub.net/index.php?page=dapi&s=post&q=index&json=1&tags=${encodeURIComponent(searchTags)}&pid=${pid}&limit=${limit}`;

  try {
    const res = await fetchSafe(url, {
      headers: {
        'Referer': 'https://hypnohub.net/'
      }
    });
    if (!res.ok) return [];
    const text = await res.text();
    const data = safeJsonParse(text, []);
    const posts = data?.post || (Array.isArray(data) ? data : []);

    return posts.map(item => {
      const rawTags = (item.tags || '').split(' ').filter(Boolean);
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
      const author = extractAuthor(rawTags, item.source, item.owner || item.creator_id || item.author);
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
        hasSound: isVideo && (hasSound || rawTags.includes('sound') || rawTags.includes('audio')),
        author,
        tags: rawTags,
        tagDetails,
        score: parseInt(item.score, 10) || 0,
        rating: item.rating || 'q',
        width: parseInt(item.width, 10) || 0,
        height: parseInt(item.height, 10) || 0,
        source: item.source || '',
        parentId,
        hasChildren,
        seriesKey,
        createdAt,
        isAi: checkIsAi(rawTags, aiTagsList)
      };
    });
  } catch (err) {
    logError('Hypnohub', 'Ошибка загрузки постов', err);
    return [];
  }
}
