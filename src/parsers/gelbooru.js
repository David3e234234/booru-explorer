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

export async function fetchGelbooru(params, aiTagsList, settings) {
  const { tags = '', page = 1, limit = 40, category = '', ratingFilter = 'all', typeFilter = 'all', ageFilter = 'all', dateFilter = 'all' } = params;
  
  let searchTags = adaptTagsForSite('gelbooru', tags, ageFilter, typeFilter);

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

  // Фильтр рейтинга
  if (ratingFilter === 'nsfw') {
    if (!searchTags.includes('rating:')) searchTags = searchTags ? `${searchTags} rating:explicit` : 'rating:explicit';
  } else if (ratingFilter === 'questionable' || ratingFilter === '16+') {
    if (!searchTags.includes('rating:')) searchTags = searchTags ? `${searchTags} rating:questionable` : 'rating:questionable';
  } else if (ratingFilter === 'sfw') {
    if (!searchTags.includes('rating:')) searchTags = searchTags ? `${searchTags} rating:general` : 'rating:general';
  }

  if (dateFilter && dateFilter !== 'all' && !searchTags.includes('date:')) {
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
      searchTags = searchTags ? `${searchTags} ${recentDate}` : recentDate;
    }
  }

  const pid = Math.max(0, page - 1);

  // 1. Попытка через официальный DAPI если есть ключ
  if (settings?.gelbooruApiKey && settings?.gelbooruUserId) {
    const url = `https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&tags=${encodeURIComponent(searchTags)}&pid=${pid}&limit=${limit}&api_key=${encodeURIComponent(settings.gelbooruApiKey)}&user_id=${encodeURIComponent(settings.gelbooruUserId)}`;
    try {
      const res = await fetchSafe(url);
      if (res.ok) {
        const text = await res.text();
        const data = safeJsonParse(text, []);
        const posts = data?.post || (Array.isArray(data) ? data : []);
        if (Array.isArray(posts) && posts.length > 0) {
          return posts.map(item => {
            const rawTags = (item.tags || '').split(' ').filter(Boolean);
            const fileUrl = item.file_url || '';
            const sampleUrl = item.sample_url || fileUrl;
            const { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(fileUrl, '', rawTags);
            const previewUrl = resolvePreviewUrl(item.preview_url, fileUrl, sampleUrl, isVideo);
            const author = extractAuthor(rawTags, item.source, '');
            const tagDetails = classifyTags(rawTags, author);
            const createdAt = normalizeDate(item.created_at || item.change);
            const parentId = item.parent_id && String(item.parent_id) !== '0' ? String(item.parent_id) : null;
            const hasChildren = item.has_children === 'true' || item.has_children === true;
            const seriesKey = extractSeriesKey({
              source: item.source || '',
              parentId,
              hasChildren,
              originalId: String(item.id),
              tags: rawTags
            }, 'gelbooru');

            return {
              id: `gelbooru_${item.id}`,
              originalId: String(item.id),
              site: 'gelbooru',
              siteName: 'Gelbooru',
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
              rating: item.rating || 's',
              width: parseInt(item.width, 10) || 0,
              height: parseInt(item.height, 10) || 0,
              source: item.source || '',
              postUrl: `https://gelbooru.com/index.php?page=post&s=view&id=${item.id}`,
              parentId,
              hasChildren,
              seriesKey,
              createdAt,
              isAi: checkIsAi(rawTags, aiTagsList)
            };
          });
        }
      }
    } catch (err) {
      logError('Gelbooru DAPI', 'Ошибка DAPI запроса, переключение на HTML парсинг', err);
    }
  }

  // 2. Универсальный fallback через открытую веб-выдачу Gelbooru HTML
  const htmlUrl = `https://gelbooru.com/index.php?page=post&s=list&tags=${encodeURIComponent(searchTags)}&pid=${pid * 42}`;
  try {
    const res = await fetchSafe(htmlUrl);
    if (!res.ok) return [];
    const html = await res.text();

    const posts = [];
    const articleRegex = /<article\s+class="thumbnail-preview"[^>]*>[\s\S]*?<\/article>/g;
    let match;
    while ((match = articleRegex.exec(html)) !== null) {
      const block = match[0];
      const idMatch = block.match(/id="p(\d+)"/) || block.match(/id=(\d+)/);
      const id = idMatch ? idMatch[1] : '';
      const imgMatch = block.match(/<img[^>]+src="([^"]+)"/);
      const thumbUrl = imgMatch ? imgMatch[1] : '';
      const titleMatch = block.match(/title="([^"]*)"/);
      const titleAttr = titleMatch ? titleMatch[1] : '';

      if (!id || !thumbUrl) continue;

      let score = 0;
      const scoreMatch = titleAttr.match(/score:(-?\d+)/);
      if (scoreMatch) score = parseInt(scoreMatch[1], 10);

      let rating = 's';
      const ratingMatch = titleAttr.match(/rating:(\w+)/);
      if (ratingMatch) rating = ratingMatch[1].charAt(0).toLowerCase();

      const cleanTitleTags = titleAttr.replace(/score:-?\d+/g, '').replace(/rating:\w+/g, '').trim();
      const rawTags = cleanTitleTags.split(/\s+/).filter(Boolean);

      const fileUrl = thumbUrl.replace('/thumbnails/', '/images/').replace('thumbnail_', '');
      const sampleUrl = thumbUrl.replace('/thumbnails/', '/samples/').replace('thumbnail_', 'sample_');
      const { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(fileUrl, '', rawTags);
      const previewUrl = resolvePreviewUrl(thumbUrl, fileUrl, sampleUrl, isVideo);
      const author = extractAuthor(rawTags, `https://gelbooru.com/index.php?page=post&s=view&id=${id}`, '');
      const tagDetails = classifyTags(rawTags, author);

      const seriesKey = extractSeriesKey({
        source: '',
        parentId: null,
        hasChildren: false,
        originalId: id,
        tags: rawTags
      }, 'gelbooru');

      posts.push({
        id: `gelbooru_${id}`,
        originalId: id,
        site: 'gelbooru',
        siteName: 'Gelbooru',
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
        score,
        rating,
        width: 0,
        height: 0,
        source: `https://gelbooru.com/index.php?page=post&s=view&id=${id}`,
        postUrl: `https://gelbooru.com/index.php?page=post&s=view&id=${id}`,
        parentId: null,
        hasChildren: false,
        seriesKey,
        createdAt: '',
        isAi: checkIsAi(rawTags, aiTagsList)
      });
    }

    return posts;
  } catch (err) {
    logError('Gelbooru HTML', 'Ошибка веб-парсинга Gelbooru', err);
    return [];
  }
}
