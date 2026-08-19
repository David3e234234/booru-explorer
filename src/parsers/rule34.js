import { safeJsonParse, fetchSafe, resolvePreviewUrl } from '../utils/network.js';
import { checkIsAi, checkMediaTypes, extractAuthor, classifyTags, normalizeDate, adaptTagsForSite } from '../utils/tagHelpers.js';
import { logError } from '../utils/logger.js';

export async function fetchRule34(params, aiTagsList, settings) {
  const { tags = '', page = 1, limit = 40, category = '', typeFilter = 'all', ageFilter = 'all' } = params;
  
  let searchTags = adaptTagsForSite('rule34', tags, ageFilter, typeFilter);

  if (category === 'top') {
    searchTags = searchTags ? `${searchTags} sort:score:desc` : 'sort:score:desc';
  } else if (category === 'popular' || category === 'recommended') {
    searchTags = searchTags ? `${searchTags} sort:updated:desc` : 'sort:updated:desc';
  } else if (category === 'random') {
    searchTags = searchTags ? `${searchTags} sort:random` : 'sort:random';
  }

  const pid = Math.max(0, page - 1);

  // 1. Попытка через официальный DAPI если есть API ключ
  if (settings?.rule34ApiKey && settings?.rule34UserId) {
    const url = `https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&json=1&tags=${encodeURIComponent(searchTags)}&pid=${pid}&limit=${limit}&api_key=${encodeURIComponent(settings.rule34ApiKey)}&user_id=${encodeURIComponent(settings.rule34UserId)}`;
    try {
      const res = await fetchSafe(url);
      if (res.ok) {
        const text = await res.text();
        if (!text.includes('Missing authentication')) {
          const data = safeJsonParse(text, null);
          if (Array.isArray(data) && data.length > 0) {
            return data.map(item => {
              const rawTags = (item.tags || '').split(' ').filter(Boolean);
              let fileUrl = item.file_url || (item.image && item.directory ? `https://us.rule34.xxx/images/${item.directory}/${item.image}` : '');
              const { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(fileUrl, item.image || '', rawTags);
              let sampleUrl = item.sample_url || fileUrl;
              let previewUrl = item.preview_url || '';
              if (isVideo) {
                if (sampleUrl && (sampleUrl.endsWith('.jpg') || sampleUrl.endsWith('.jpeg') || sampleUrl.endsWith('.png'))) {
                  if (!previewUrl) previewUrl = sampleUrl;
                }
                sampleUrl = fileUrl;
              }
              previewUrl = resolvePreviewUrl(previewUrl, fileUrl, sampleUrl, isVideo);
              const author = extractAuthor(rawTags, item.source, item.owner || item.creator_id || item.author);
              const tagDetails = classifyTags(rawTags, author);
              const createdAt = normalizeDate(item.created_at || item.change);
              return {
                id: `rule34_${item.id}`,
                originalId: String(item.id),
                site: 'rule34',
                siteName: 'Rule34.xxx',
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
                createdAt,
                isAi: checkIsAi(rawTags, aiTagsList)
              };
            });
          }
        }
      }
    } catch (err) {
      logError('Rule34.xxx DAPI', 'Ошибка DAPI запроса, переключение на HTML парсинг', err);
    }
  }

  // 2. Универсальный веб-парсер Rule34.xxx (открытая выдача без API ключа)
  const htmlUrl = `https://rule34.xxx/index.php?page=post&s=list&tags=${encodeURIComponent(searchTags)}&pid=${pid * 42}`;
  try {
    const res = await fetchSafe(htmlUrl);
    if (res.ok) {
      const html = await res.text();
      const posts = [];
      // Универсальный поиск блоков превью: <span class="thumb" id="s123"> или <span id="s123" class="thumb">
      const spanRegex = /<span\b[^>]*?(?:class="[^"]*\bthumb\b[^"]*"[^>]*?id="s?(\d+)"|id="s?(\d+)"[^>]*?class="[^"]*\bthumb\b[^"]*")[^>]*>([\s\S]*?)<\/span>/gi;
      let match;
      while ((match = spanRegex.exec(html)) !== null) {
        const id = match[1] || match[2];
        const block = match[3];

        const imgMatch = block.match(/<img[^>]+(?:src|data-src)="([^"]+)"/i);
        const thumbUrl = imgMatch ? imgMatch[1].replace(/&amp;/g, '&') : '';

        const titleMatch = block.match(/title="([^"]*)"/i);
        const altMatch = block.match(/alt="([^"]*)"/i);
        const titleAttr = (titleMatch ? titleMatch[1] : (altMatch ? altMatch[1] : '')).replace(/&amp;/g, '&');

        const classMatch = block.match(/class="([^"]*)"/i);
        const classAttr = classMatch ? classMatch[1] : '';

        if (!id || !thumbUrl) continue;

        let score = 0;
        const scoreMatch = titleAttr.match(/score:(-?\d+)/i);
        if (scoreMatch) score = parseInt(scoreMatch[1], 10);

        let rating = 'e';
        const ratingMatch = titleAttr.match(/rating:(\w+)/i);
        if (ratingMatch) rating = ratingMatch[1].charAt(0).toLowerCase();

        const cleanTitleTags = titleAttr.replace(/score:-?\d+/gi, '').replace(/rating:\w+/gi, '').trim();
        const rawTags = cleanTitleTags.split(/\s+/).filter(Boolean);

        const isVideoClass = classAttr.includes('webm-thumb') || classAttr.includes('video-thumb');
        const isVideoTag = rawTags.includes('video') || rawTags.includes('animated') || rawTags.includes('webm') || rawTags.includes('mp4');
        const isVideo = isVideoClass || isVideoTag;

        const cleanThumb = thumbUrl.split('?')[0];
        const thumbMatch = cleanThumb.match(/\/thumbnails\/+(\d+)\/thumbnail_([a-f0-9]+)\./i);

        let fileUrl = '';
        let sampleUrl = '';
        const previewUrl = thumbUrl;
        let fileExt = isVideo ? 'mp4' : 'jpg';

        if (thumbMatch) {
          const dir = thumbMatch[1];
          const hash = thumbMatch[2];
          const host = cleanThumb.includes('wimg.rule34.xxx') ? 'https://wimg.rule34.xxx' : (cleanThumb.includes('us.rule34.xxx') ? 'https://us.rule34.xxx' : 'https://rule34.xxx');
          if (isVideo) {
            fileUrl = `${host}/images/${dir}/${hash}.mp4`;
            sampleUrl = fileUrl;
            fileExt = 'mp4';
          } else {
            fileUrl = `${host}/images/${dir}/${hash}.jpg`;
            sampleUrl = `${host}/samples/${dir}/sample_${hash}.jpg`;
          }
        } else {
          fileUrl = thumbUrl.replace('/thumbnails/', '/images/').replace('thumbnail_', '').split('?')[0];
          sampleUrl = thumbUrl.replace('/thumbnails/', '/samples/').replace('thumbnail_', 'sample_').split('?')[0];
        }

        const source = `https://rule34.xxx/index.php?page=post&s=view&id=${id}`;
        const author = extractAuthor(rawTags, source, '');
        const tagDetails = classifyTags(rawTags, author);

        posts.push({
          id: `rule34_${id}`,
          originalId: id,
          site: 'rule34',
          siteName: 'Rule34.xxx',
          previewUrl,
          sampleUrl,
          fileUrl,
          fileExt,
          isVideo,
          isGif: rawTags.includes('gif'),
          hasSound: isVideo && (rawTags.includes('sound') || rawTags.includes('audio')),
          author,
          tags: rawTags,
          tagDetails,
          score,
          rating,
          width: 0,
          height: 0,
          source,
          createdAt: '',
          isAi: checkIsAi(rawTags, aiTagsList)
        });
      }

      // Fallback: поиск по тегам <img title="..." id="p..."> если span с классом thumb не найден
      if (posts.length === 0 && html.includes('id="p')) {
        const altImgRegex = /<a[^>]*id="p(\d+)"[^>]*href="[^"]*id=(\d+)"[^>]*>[\s\S]*?<img[^>]+(?:src|data-src)="([^"]+)"[^>]*title="([^"]*)"/gi;
        let altMatch;
        while ((altMatch = altImgRegex.exec(html)) !== null) {
          const id = altMatch[1] || altMatch[2];
          const thumbUrl = altMatch[3].replace(/&amp;/g, '&');
          const titleAttr = altMatch[4].replace(/&amp;/g, '&');
          if (!id || !thumbUrl) continue;

          let score = 0;
          const scoreMatch = titleAttr.match(/score:(-?\d+)/i);
          if (scoreMatch) score = parseInt(scoreMatch[1], 10);

          let rating = 'e';
          const ratingMatch = titleAttr.match(/rating:(\w+)/i);
          if (ratingMatch) rating = ratingMatch[1].charAt(0).toLowerCase();

          const cleanTitleTags = titleAttr.replace(/score:-?\d+/gi, '').replace(/rating:\w+/gi, '').trim();
          const rawTags = cleanTitleTags.split(/\s+/).filter(Boolean);

          const isVideo = rawTags.includes('video') || rawTags.includes('animated') || rawTags.includes('webm') || rawTags.includes('mp4');
          const cleanThumb = thumbUrl.split('?')[0];
          const thumbMatch = cleanThumb.match(/\/thumbnails\/+(\d+)\/thumbnail_([a-f0-9]+)\./i);

          let fileUrl = thumbUrl;
          let sampleUrl = thumbUrl;
          let fileExt = isVideo ? 'mp4' : 'jpg';

          if (thumbMatch) {
            const dir = thumbMatch[1];
            const hash = thumbMatch[2];
            const host = cleanThumb.includes('wimg.rule34.xxx') ? 'https://wimg.rule34.xxx' : (cleanThumb.includes('us.rule34.xxx') ? 'https://us.rule34.xxx' : 'https://rule34.xxx');
            fileUrl = isVideo ? `${host}/images/${dir}/${hash}.mp4` : `${host}/images/${dir}/${hash}.jpg`;
            sampleUrl = isVideo ? fileUrl : `${host}/samples/${dir}/sample_${hash}.jpg`;
          }

          const source = `https://rule34.xxx/index.php?page=post&s=view&id=${id}`;
          const author = extractAuthor(rawTags, source, '');
          const tagDetails = classifyTags(rawTags, author);

          posts.push({
            id: `rule34_${id}`,
            originalId: id,
            site: 'rule34',
            siteName: 'Rule34.xxx',
            previewUrl: thumbUrl,
            sampleUrl,
            fileUrl,
            fileExt,
            isVideo,
            isGif: rawTags.includes('gif'),
            hasSound: isVideo && (rawTags.includes('sound') || rawTags.includes('audio')),
            author,
            tags: rawTags,
            tagDetails,
            score,
            rating,
            width: 0,
            height: 0,
            source,
            createdAt: '',
            isAi: checkIsAi(rawTags, aiTagsList)
          });
        }
      }

      if (posts.length > 0) {
        return posts.slice(0, limit);
      }
    }
  } catch (err) {
    logError('Rule34.xxx HTML', 'Ошибка веб-парсинга Rule34.xxx', err);
  }

  // 3. Fallback: Открытый Paheal API
  if (settings && settings.enablePaheal === false) {
    return [];
  }
  let pahealSearchTags = tags
    .replace(/([a-zA-Z0-9_-]+)_\([^)]+\)/g, '$1')
    .replace(/([a-zA-Z0-9_-]+)\s*\([^)]+\)/g, '$1')
    .replace(/[()]/g, '')
    .trim();

  const fetchPahealLimit = category === 'popular' ? Math.max(limit, 70) : limit;
  if (category === 'top') {
    pahealSearchTags = pahealSearchTags ? `order:score ${pahealSearchTags}` : 'order:score';
  }
  const parsePahealXml = async (queryTags) => {
    const pahealUrl = `https://rule34.paheal.net/api/danbooru/post/index.xml?tags=${encodeURIComponent(queryTags)}&limit=${fetchPahealLimit}&page=${page}`;
    const pahealRes = await fetchSafe(pahealUrl);
    if (!pahealRes.ok) return [];
    const text = await pahealRes.text();

    const posts = [];
    const tagRegex = /<tag\s+([^>]+)>/g;
    let match;
    while ((match = tagRegex.exec(text)) !== null) {
      const attrsStr = match[1];
      const attrs = {};
      const attrRegex = /([a-z0-9_]+)=['"]([^'"]*)['"]/gi;
      let attrMatch;
      while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
        attrs[attrMatch[1]] = attrMatch[2];
      }
      if (attrs.file_url) {
        const rawTags = (attrs.tags || '').split(' ').filter(Boolean);
        const fileName = attrs.file_name || '';
        let { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(attrs.file_url, fileName, rawTags);
        if (fileName.toLowerCase().endsWith('.mp4') || fileName.toLowerCase().endsWith('.webm')) {
          isVideo = true;
          fileExt = fileName.toLowerCase().endsWith('.webm') ? 'webm' : 'mp4';
        }
        const previewUrl = resolvePreviewUrl(attrs.preview_url, attrs.file_url, attrs.file_url, isVideo);
        const author = extractAuthor(rawTags, attrs.source, attrs.author);
        const tagDetails = classifyTags(rawTags, author);
        const createdAt = normalizeDate(attrs.created_at || attrs.date);
        posts.push({
          id: `paheal_${attrs.id}`,
          originalId: attrs.id,
          site: 'rule34',
          siteName: 'Rule34',
          previewUrl,
          sampleUrl: attrs.file_url,
          fileUrl: attrs.file_url,
          fileExt,
          isVideo,
          isGif,
          hasSound: isVideo && (hasSound || rawTags.includes('sound') || rawTags.includes('audio')),
          author,
          tags: rawTags,
          tagDetails,
          score: parseInt(attrs.score, 10) || 0,
          rating: 'e',
          width: parseInt(attrs.width, 10) || 0,
          height: parseInt(attrs.height, 10) || 0,
          source: attrs.source || '',
          createdAt,
          isAi: checkIsAi(rawTags, aiTagsList)
        });
      }
    }
    return posts;
  };

  try {
    let posts = await parsePahealXml(pahealSearchTags);
    
    // Если по snake_case тегам ничего не найдено на Paheal, пробуем Capitalized вариант (например Hu_Tao)
    if (posts.length === 0 && pahealSearchTags && !pahealSearchTags.includes(':')) {
      const capitalizedTags = pahealSearchTags.split(/\s+/).map(t => {
        return t.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('_');
      }).join(' ');
      if (capitalizedTags !== pahealSearchTags) {
        posts = await parsePahealXml(capitalizedTags);
      }
    }

    if (category === 'popular' && posts.length > 0) {
      posts.sort((a, b) => (b.score || 0) - (a.score || 0));
    }

    return posts.slice(0, limit);
  } catch (err) {
    logError('Rule34 Paheal', 'Ошибка запроса Paheal', err);
    return [];
  }
}
