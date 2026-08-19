import { safeJsonParse, fetchSafe, resolvePreviewUrl } from '../utils/network.js';
import { checkIsAi, checkMediaTypes, extractAuthor, classifyTags, normalizeDate, adaptTagsForSite } from '../utils/tagHelpers.js';
import { logError } from '../utils/logger.js';

export async function fetchGelbooru(params, aiTagsList, settings) {
  const { tags = '', page = 1, limit = 40, category = '', typeFilter = 'all', ageFilter = 'all' } = params;
  
  let searchTags = adaptTagsForSite('gelbooru', tags, ageFilter, typeFilter);

  if (category === 'top') {
    searchTags = searchTags ? `${searchTags} sort:score:desc` : 'sort:score:desc';
  } else if (category === 'popular' || category === 'recommended') {
    searchTags = searchTags ? `${searchTags} sort:updated:desc` : 'sort:updated:desc';
  } else if (category === 'random') {
    searchTags = searchTags ? `${searchTags} sort:random` : 'sort:random';
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
            const author = extractAuthor(rawTags, item.source, item.owner || item.creator_id || item.author);
            const tagDetails = classifyTags(rawTags, author);
            const createdAt = normalizeDate(item.created_at || item.change);
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
