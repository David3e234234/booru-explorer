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

export async function fetchGelbooru(params, aiTagsList, settings) {
  const { tags = '', page = 1, limit = 40, category = '', ratingFilter = 'all', typeFilter = 'all', ageFilter = 'all' } = params;
  
  let searchTags = adaptTagsForSite('gelbooru', tags, ageFilter, typeFilter);

  const customTag = settings?.siteSortTags?.gelbooru?.[category];
  if (customTag) {
    searchTags = searchTags ? `${searchTags} ${customTag}` : customTag;
  } else if (category === 'hot') {
    if (!searchTags.includes('sort:') && !searchTags.includes('order:') && !searchTags.includes('score:')) {
      searchTags = searchTags ? `${searchTags} score:>5` : 'score:>5';
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
    if (!searchTags.includes('sort:') && !searchTags.includes('order:') && !searchTags.includes('score:')) {
      searchTags = searchTags ? `${searchTags} score:>5` : 'score:>5';
    }
  } else if (category === 'random') {
    if (!searchTags.includes('sort:') && !searchTags.includes('order:')) {
      searchTags = searchTags ? `${searchTags} sort:random` : 'sort:random';
    }
  } else if (category === 'new' && settings?.siteSortTags?.gelbooru?.new) {
    searchTags = searchTags ? `${searchTags} ${settings.siteSortTags.gelbooru.new}` : settings.siteSortTags.gelbooru.new;
  }

  // Rating filter
  if (ratingFilter === 'nsfw') {
    if (!searchTags.includes('rating:')) searchTags = searchTags ? `${searchTags} rating:explicit` : 'rating:explicit';
  } else if (ratingFilter === 'questionable' || ratingFilter === '16+') {
    if (!searchTags.includes('rating:')) searchTags = searchTags ? `${searchTags} rating:questionable` : 'rating:questionable';
  } else if (ratingFilter === 'sfw') {
    if (!searchTags.includes('rating:')) searchTags = searchTags ? `${searchTags} rating:general` : 'rating:general';
  }

  const pid = Math.max(0, page - 1);

  // 1. Try the official DAPI when an API key is available
  if (settings?.gelbooruApiKey && settings?.gelbooruUserId) {
    const url = `https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&tags=${encodeURIComponent(searchTags)}&pid=${pid}&limit=${limit}&api_key=${encodeURIComponent(settings.gelbooruApiKey)}&user_id=${encodeURIComponent(settings.gelbooruUserId)}`;
    try {
      const res = await fetchSafe(url, { timeout: 8000, settings, site: 'gelbooru' });
      if (res.ok) {
        const text = await res.text();
        const data = safeJsonParse(text, []);
        const posts = data?.post || (Array.isArray(data) ? data : []);
        if (Array.isArray(posts) && posts.length > 0) {
          return await Promise.all(posts.map(async item => {
            const rawTags = decodeHtmlEntities(item.tags || '').split(' ').filter(Boolean);
            const fileUrl = item.file_url || '';
            const sampleUrl = item.sample_url || fileUrl;
            const { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(fileUrl, '', rawTags);
            const previewUrl = resolvePreviewUrl(item.preview_url, fileUrl, sampleUrl, isVideo);
            const { tagDetails, author, assistants } = await classifyPostTags(rawTags, item.source, '', settings);
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
              assistants: assistants || [],
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
          }));
        }
      } else {
        await discardResponse(res);
      }
    } catch (err) {
      logError('Gelbooru DAPI', 'Ошибка DAPI запроса, переключение на HTML парсинг', err);
    }
  }

  // 2. Universal fallback via the public Gelbooru HTML feed
  const htmlUrl = `https://gelbooru.com/index.php?page=post&s=list&tags=${encodeURIComponent(searchTags)}&pid=${pid * 42}`;
  try {
    const res = await fetchSafe(htmlUrl, { settings, site: 'gelbooru' });
    if (!res.ok) {
      await discardResponse(res);
      return [];
    }
    const html = await res.text();

    const rawParsed = [];
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

      const cleanTitleTags = decodeHtmlEntities(titleAttr.replace(/score:-?\d+/g, '').replace(/rating:\w+/g, '')).trim();
      const rawTags = cleanTitleTags.split(/\s+/).filter(Boolean);

      const fileUrl = thumbUrl.replace('/thumbnails/', '/images/').replace('thumbnail_', '');
      const sampleUrl = thumbUrl.replace('/thumbnails/', '/samples/').replace('thumbnail_', 'sample_');
      const { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(fileUrl, '', rawTags);
      const previewUrl = resolvePreviewUrl(thumbUrl, fileUrl, sampleUrl, isVideo);
      const source = `https://gelbooru.com/index.php?page=post&s=view&id=${id}`;

      rawParsed.push({
        id,
        thumbUrl,
        fileUrl,
        sampleUrl,
        fileExt,
        isVideo,
        isGif,
        hasSound,
        previewUrl,
        rawTags,
        score,
        rating,
        source
      });
    }

    if (rawParsed.length > 0) {
      return await Promise.all(rawParsed.map(async p => {
        const { tagDetails, author, assistants } = await classifyPostTags(p.rawTags, p.source, '', settings);
        const seriesKey = extractSeriesKey({
          source: '',
          parentId: null,
          hasChildren: false,
          originalId: p.id,
          tags: p.rawTags
        }, 'gelbooru');

        return {
          id: `gelbooru_${p.id}`,
          originalId: p.id,
          site: 'gelbooru',
          siteName: 'Gelbooru',
          previewUrl: p.previewUrl,
          sampleUrl: p.sampleUrl,
          fileUrl: p.fileUrl,
          fileExt: p.fileExt,
          isVideo: p.isVideo,
          isGif: p.isGif,
          hasSound: p.isVideo && p.hasSound,
          author,
          assistants: assistants || [],
          tags: p.rawTags,
          tagDetails,
          score: p.score,
          rating: p.rating,
          width: 0,
          height: 0,
          source: p.source,
          postUrl: p.source,
          parentId: null,
          hasChildren: false,
          seriesKey,
          createdAt: '',
          isAi: checkIsAi(p.rawTags, aiTagsList)
        };
      }));
    }

    return [];
  } catch (err) {
    logError('Gelbooru HTML', 'Ошибка веб-парсинга Gelbooru', err);
    return [];
  }
}

export async function fetchGelbooruPostById(id, aiTagsList = [], settings = {}, fallbackTags = []) {
  const cleanId = String(id || '').replace(/^gelbooru_/, '').split('_')[0].trim();
  if (!cleanId) return null;

  // 1. Direct DAPI request when api credentials exist
  if (settings?.gelbooruApiKey && settings?.gelbooruUserId) {
    try {
      const dapiUrl = `https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&id=${cleanId}&api_key=${encodeURIComponent(settings.gelbooruApiKey)}&user_id=${encodeURIComponent(settings.gelbooruUserId)}`;
      const res = await fetchSafe(dapiUrl, {
        headers: { Referer: 'https://gelbooru.com/' },
        timeout: 9000,
        settings,
        site: 'gelbooru'
      });
      if (res.ok) {
        const text = await res.text();
        const data = safeJsonParse(text, null);
        const item = Array.isArray(data) ? (data.find(p => String(p.id) === cleanId) || data[0]) : (data?.post?.[0] || null);
        if (item) {
          const rawTags = decodeHtmlEntities(item.tags || '').split(' ').filter(Boolean);
          const fileUrl = item.file_url || '';
          const sampleUrl = item.sample_url || fileUrl;
          const { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(fileUrl, '', rawTags);
          const previewUrl = resolvePreviewUrl(item.preview_url, fileUrl, sampleUrl, isVideo);
          const { tagDetails, author, assistants } = await classifyPostTags(rawTags, item.source, '', settings, true);
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
            assistants: assistants || [],
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
        }
      } else {
        await discardResponse(res);
      }
    } catch (err) {
      logError('Gelbooru Resolve DAPI', `Ошибка DAPI запроса поста id:${cleanId}`, err);
    }
  }

  // 2. HTML parsing of the post view page with authoritative tag classes
  try {
    const viewUrl = `https://gelbooru.com/index.php?page=post&s=view&id=${cleanId}`;
    const res = await fetchSafe(viewUrl, {
      headers: { Referer: 'https://gelbooru.com/' },
      timeout: 8000,
      settings,
      site: 'gelbooru'
    });

    if (res.ok) {
      const html = await res.text();
      const artistMatches = [...html.matchAll(/class="[^"]*tag-type-artist[^"]*"[^>]*>[\s\S]*?<a[^>]*tags=([^"&]+)[^>]*>([^<]+)<\/a>/gi)].map(m => decodeURIComponent(m[1]).trim());
      const copyrightMatches = [...html.matchAll(/class="[^"]*tag-type-copyright[^"]*"[^>]*>[\s\S]*?<a[^>]*tags=([^"&]+)[^>]*>([^<]+)<\/a>/gi)].map(m => decodeURIComponent(m[1]).trim());
      const characterMatches = [...html.matchAll(/class="[^"]*tag-type-character[^"]*"[^>]*>[\s\S]*?<a[^>]*tags=([^"&]+)[^>]*>([^<]+)<\/a>/gi)].map(m => decodeURIComponent(m[1]).trim());
      const metadataMatches = [...html.matchAll(/class="[^"]*tag-type-(?:metadata|meta)[^"]*"[^>]*>[\s\S]*?<a[^>]*tags=([^"&]+)[^>]*>([^<]+)<\/a>/gi)].map(m => decodeURIComponent(m[1]).trim());
      const generalMatches = [...html.matchAll(/class="[^"]*tag-type-general[^"]*"[^>]*>[\s\S]*?<a[^>]*tags=([^"&]+)[^>]*>([^<]+)<\/a>/gi)].map(m => decodeURIComponent(m[1]).trim());

      const allTags = [...new Set([...artistMatches, ...copyrightMatches, ...characterMatches, ...metadataMatches, ...generalMatches, ...fallbackTags])];

      const imgMatch = html.match(/<img[^>]+id="image"[^>]+src="([^"]+)"/i) || html.match(/<li><a\s+href="([^"]+)"[^>]*>Original image<\/a>/i);
      const fileUrl = imgMatch ? imgMatch[1].replace(/&amp;/g, '&') : '';

      const sampleMatch = html.match(/<img[^>]+id="image"[^>]+src="([^"]+)"/i);
      const sampleUrl = sampleMatch ? sampleMatch[1].replace(/&amp;/g, '&') : fileUrl;

      const sourceMatch = html.match(/Source:\s*<a[^>]+href="([^"]+)"/i) || html.match(/<li>Source:\s*([^\s<]+)/i);
      const source = sourceMatch ? sourceMatch[1].trim().replace(/&amp;/g, '&') : '';

      const { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(fileUrl, '', allTags);
      const previewUrl = resolvePreviewUrl(sampleUrl, fileUrl, sampleUrl, isVideo);

      const initialAuthor = artistMatches.join(', ');
      const { tagDetails, author, assistants } = await classifyPostTags(allTags, source, initialAuthor, settings, true);

      if (artistMatches.length > 0) tagDetails.artist = [...new Set([...artistMatches, ...(tagDetails.artist || [])])];
      if (copyrightMatches.length > 0) tagDetails.copyright = [...new Set([...copyrightMatches, ...(tagDetails.copyright || [])])];
      if (characterMatches.length > 0) tagDetails.character = [...new Set([...characterMatches, ...(tagDetails.character || [])])];
      if (metadataMatches.length > 0) tagDetails.meta = [...new Set([...metadataMatches, ...(tagDetails.meta || [])])];

      let score = 0;
      const scoreMatch = html.match(/Score:\s*(-?\d+)/i) || html.match(/id="psc">(-?\d+)</i);
      if (scoreMatch) score = parseInt(scoreMatch[1], 10) || 0;

      let rating = 's';
      const ratingMatch = html.match(/Rating:\s*(\w+)/i);
      if (ratingMatch) {
        const r = ratingMatch[1].toLowerCase();
        if (r === 'explicit') rating = 'e';
        else if (r === 'questionable') rating = 'q';
        else if (r === 'general' || r === 'safe') rating = 's';
      }

      const dateMatch = html.match(/Posted:\s*([0-9-]+\s+[0-9:]+)/i) || html.match(/([0-9]{4}-[0-9]{2}-[0-9]{2}\s+[0-9:]+)/i);
      const createdAt = dateMatch ? normalizeDate(dateMatch[1]) : '';

      return {
        id: `gelbooru_${cleanId}`,
        originalId: cleanId,
        site: 'gelbooru',
        siteName: 'Gelbooru',
        previewUrl,
        sampleUrl,
        fileUrl,
        fileExt,
        isVideo,
        isGif,
        hasSound: isVideo && hasSound,
        author: author || initialAuthor,
        assistants: assistants || [],
        tags: allTags,
        tagDetails,
        score,
        rating,
        width: 0,
        height: 0,
        source: source || viewUrl,
        postUrl: viewUrl,
        parentId: null,
        hasChildren: false,
        seriesKey: '',
        createdAt,
        isAi: checkIsAi(allTags, aiTagsList)
      };
    } else {
      await discardResponse(res);
    }
  } catch (err) {
    logError('Gelbooru Resolve HTML', `Ошибка HTML-парсинга поста id:${cleanId}`, err);
  }

  return null;
}

