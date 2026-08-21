import { 
  CURVY_INCLUDE_TAGS, 
  CURVY_EXCLUDE_TAGS, 
  PETITE_INCLUDE_TAGS, 
  PETITE_EXCLUDE_TAGS 
} from '../config/constants.js';
import { safeJsonParse, fetchSafe, resolvePreviewUrl } from '../utils/network.js';
import { checkIsAi, checkMediaTypes } from '../utils/tagHelpers.js';
import { logInfo, logError } from '../utils/logger.js';

export async function fetchDanbooru(params, aiTagsList, settings) {
  const { tags = '', page = 1, limit = 40, category = '', ratingFilter = 'all', typeFilter = 'all', dateFilter = 'all' } = params;
  const userTagList = tags.trim().split(/\s+/).filter(Boolean);
  const queryTags = [];
  
  const prioritizeUserTags = settings?.prioritizeUserTags === true;
  const deepFetchPagesSetting = settings?.deepFetchPages ? parseInt(settings.deepFetchPages, 10) : 2;

  // Если приоритет у ручных тегов - сначала добавляем их
  if (prioritizeUserTags) {
    for (const t of userTagList) {
      if (queryTags.length < 2) queryTags.push(t);
    }
  }

  // Приоритет Видео/звук
  if (typeFilter === 'audio' || typeFilter === 'sound') {
    if (queryTags.length < 2) queryTags.push('sound');
  } else if (typeFilter === 'video') {
    if (queryTags.length < 2) queryTags.push('animated');
  }

  // Если ручные теги не в приоритете - добавляем их после медиа-фильтра
  if (!prioritizeUserTags) {
    for (const t of userTagList) {
      if (queryTags.length < 2) queryTags.push(t);
    }
  }

  // Приоритет Сортировка и фильтр по дате
  const hasDateFilter = dateFilter && dateFilter !== 'all';
  const ageMap = {
    '24h': 'age:..1d',
    '1d': 'age:..1d',
    '2d': 'age:..2d',
    '7d': 'age:..7d',
    'week': 'age:..7d',
    '30d': 'age:..30d',
    'month': 'age:..30d',
    '90d': 'age:..90d',
    '3months': 'age:..90d',
    '365d': 'age:..365d',
    'year': 'age:..365d'
  };

  if (queryTags.length < 2) {
    if (category === 'top' || category === 'views') {
      if (hasDateFilter) {
        queryTags.push('order:score');
      } else if (userTagList.length > 0) {
        queryTags.push('order:score');
      } else {
        queryTags.push('order:rank');
      }
    } else if (category === 'popular' || category === 'recommended') {
      queryTags.push('order:rank');
    } else if (category === 'random') {
      queryTags.push('order:random');
    }
  }

  // Приоритет Фильтр по дате (age:..Nd)
  if (queryTags.length < 2 && hasDateFilter && ageMap[dateFilter]) {
    queryTags.push(ageMap[dateFilter]);
  }

  // Приоритет Рейтинг
  if (queryTags.length < 2) {
    if (ratingFilter === 'nsfw') queryTags.push('rating:q,e');
    else if (ratingFilter === 'sfw') queryTags.push('rating:g,s');
  }

  const isTagsDropped = userTagList.length + (typeFilter !== 'all' ? 1 : 0) + (ratingFilter !== 'all' ? 1 : 0) > 2;
  const shouldDeepFetch = isTagsDropped || deepFetchPagesSetting > 1;
  const fetchLimit = shouldDeepFetch ? Math.max(limit, 200) : limit;

  const finalTags = queryTags.join(' ');
  let allData = [];

  logInfo('Danbooru', `Поиск в API: tags="${finalTags}", deepFetch=${shouldDeepFetch ? deepFetchPagesSetting + ' стр.' : 'выкл'}, userPriority=${prioritizeUserTags}`);

  const isPostMatch = (item) => {
    if (item.is_banned) return false;
    const rawTags = (item.tag_string || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (userTagList.length > 0) {
      const hasAll = userTagList.every(t => {
        const clean = t.toLowerCase();
        if (clean.startsWith('-')) return !rawTags.includes(clean.slice(1));
        if (clean.includes(':')) return true;
        return rawTags.includes(clean);
      });
      if (!hasAll) return false;
    }
    if (typeFilter === 'video' || typeFilter === 'audio' || typeFilter === 'sound') {
      const variants = item.media_asset?.variants || [];
      const hasVideoVariant = variants.some(v => v.file_ext === 'mp4' || v.file_ext === 'webm' || v.url?.includes('.mp4') || v.url?.includes('.webm'));
      const isVidExt = item.file_ext === 'mp4' || item.file_ext === 'webm' || item.file_ext === 'zip' || (item.file_url && (item.file_url.endsWith('.mp4') || item.file_url.endsWith('.webm')));
      const isAnimTag = rawTags.includes('animated') || rawTags.includes('video') || rawTags.includes('ugoira');
      if (!hasVideoVariant && !isVidExt && !isAnimTag) return false;
    }
    if (ratingFilter === 'nsfw') {
      const r = (item.rating || '').toLowerCase();
      if (r !== 'e' && r !== 'q' && r !== 'explicit' && r !== 'questionable' && r !== 'sensitive') return false;
    } else if (ratingFilter === 'sfw') {
      const r = (item.rating || '').toLowerCase();
      if (r !== 's' && r !== 'g' && r !== 'general') return false;
    }
    const activeCurvy = (Array.isArray(settings?.curvyTags) && settings.curvyTags.length > 0) ? settings.curvyTags : CURVY_INCLUDE_TAGS;
    const activePetite = (Array.isArray(settings?.petiteTags) && settings.petiteTags.length > 0) ? settings.petiteTags : PETITE_INCLUDE_TAGS;

    if (params.ageFilter === 'adult') {
      if (CURVY_EXCLUDE_TAGS.some(t => rawTags.includes(t))) return false;
      if (!userTagList.length && !activeCurvy.some(t => rawTags.includes(t))) return false;
    } else if (params.ageFilter === 'young') {
      if (PETITE_EXCLUDE_TAGS.some(t => rawTags.includes(t))) return false;
      if (!userTagList.length && !activePetite.some(t => rawTags.includes(t))) return false;
    }
    return true;
  };

  if (shouldDeepFetch) {
    const minDesiredPosts = Math.min(limit || 100, 200);
    const maxIterations = Math.max(deepFetchPagesSetting * 2, 12);
    let currentCursor = '';
    let matchedCount = 0;
    
    if (page > 1) {
      const startPageNum = (page - 1) * deepFetchPagesSetting + 1;
      if (startPageNum <= 5) {
        currentCursor = `page=${startPageNum}`;
      }
    }

    const authParam = (settings?.danbooruLogin && settings?.danbooruApiKey)
      ? `&login=${encodeURIComponent(settings.danbooruLogin)}&api_key=${encodeURIComponent(settings.danbooruApiKey)}`
      : '';

    for (let i = 0; i < maxIterations; i++) {
      let pageParam = currentCursor || `page=${(page - 1) * deepFetchPagesSetting + 1 + i}`;
      const url = `https://danbooru.donmai.us/posts.json?tags=${encodeURIComponent(finalTags)}&limit=${fetchLimit}${pageParam ? '&' + pageParam : ''}${authParam}`;
      
      let data = null;
      for (let retry = 0; retry < 2; retry++) {
        try {
          if (i > 0 || retry > 0) await new Promise(r => setTimeout(r, 150));
          const res = await fetchSafe(url);
          if (!res.ok) {
            if (res.status === 429) {
              await new Promise(r => setTimeout(r, 600));
              continue;
            }
            break;
          }
          const text = await res.text();
          const parsed = safeJsonParse(text, null);
          if (Array.isArray(parsed)) {
            data = parsed;
            break;
          }
        } catch (err) {
          if (retry === 0) {
            await new Promise(r => setTimeout(r, 300));
            continue;
          }
          logError('Danbooru', `Ошибка курсорного поиска на шаге ${i + 1}`, err);
          break;
        }
      }

      if (!data || data.length === 0) break;
      allData.push(...data);
      
      for (const item of data) {
        if (isPostMatch(item)) matchedCount++;
      }

      const ids = data.map(d => d.id).filter(id => typeof id === 'number');
      if (ids.length > 0) {
        const minId = Math.min(...ids);
        currentCursor = `page=b${minId}`;
      } else {
        break;
      }

      if (matchedCount >= minDesiredPosts && i >= deepFetchPagesSetting - 1) {
        break;
      }

      if (data.length < fetchLimit) {
        break;
      }
    }
  } else {
    const authParam = (settings?.danbooruLogin && settings?.danbooruApiKey)
      ? `&login=${encodeURIComponent(settings.danbooruLogin)}&api_key=${encodeURIComponent(settings.danbooruApiKey)}`
      : '';
    const url = `https://danbooru.donmai.us/posts.json?tags=${encodeURIComponent(finalTags)}&page=${page}&limit=${fetchLimit}${authParam}`;
    try {
      const res = await fetchSafe(url);
      if (res.ok) {
        const text = await res.text();
        const data = safeJsonParse(text, null);
        if (Array.isArray(data)) allData = data;
      } else {
        logError('Danbooru', `API статус: ${res.status}`);
      }
    } catch (err) {
      logError('Danbooru', 'Ошибка стандартного fetch', err);
    }
  }

  if (allData.length === 0 && userTagList.length === 1 && !userTagList[0].includes(':')) {
    const rawTag = userTagList[0].replace(/^@/, '');
    const sourceQuery = `source:*${rawTag}*`;
    logInfo('Danbooru', `Прямой тег не вернул результатов, пробуем поиск по автору в источнике: tags="${sourceQuery}"`);
    try {
      const authParam = (settings?.danbooruLogin && settings?.danbooruApiKey)
        ? `&login=${encodeURIComponent(settings.danbooruLogin)}&api_key=${encodeURIComponent(settings.danbooruApiKey)}`
        : '';
      const fallbackUrl = `https://danbooru.donmai.us/posts.json?tags=${encodeURIComponent(sourceQuery)}&limit=${fetchLimit}${authParam}`;
      const res = await fetchSafe(fallbackUrl);
      if (res.ok) {
        const text = await res.text();
        const data = safeJsonParse(text, null);
        if (Array.isArray(data) && data.length > 0) {
          allData = data;
        }
      }
    } catch (e) {}
  }

  // Общий надежный fallback для Danbooru при сбое API/таймауте
  if (allData.length === 0 && userTagList.length === 0) {
    try {
      const authParam = (settings?.danbooruLogin && settings?.danbooruApiKey)
        ? `&login=${encodeURIComponent(settings.danbooruLogin)}&api_key=${encodeURIComponent(settings.danbooruApiKey)}`
        : '';
      const fallbackUrl = `https://danbooru.donmai.us/posts.json?tags=order:rank&limit=${fetchLimit}${authParam}`;
      const res = await fetchSafe(fallbackUrl);
      if (res.ok) {
        const text = await res.text();
        const data = safeJsonParse(text, null);
        if (Array.isArray(data) && data.length > 0) {
          allData = data;
        }
      }
    } catch (e) {}
  }

  logInfo('Danbooru', `Получено из API: ${allData.length} постов до локальной фильтрации`);

  const validItems = allData.filter(item => {
    if (item.is_banned) return false;
    const variants = item.media_asset?.variants || [];
    const hasMedia = !!(item.file_url || item.large_file_url || item.preview_file_url || variants.length > 0);
    return hasMedia;
  });

  return validItems.map(item => {
    const rawTags = (item.tag_string || '').split(' ').filter(Boolean);
    const variants = item.media_asset?.variants || [];
    
    const mp4_720p = variants.find(v => (v.type === '720p' || v.type === 'sample') && (v.file_ext === 'mp4' || v.url?.includes('.mp4')));
    const mp4_orig = variants.find(v => v.type === 'original' && (v.file_ext === 'mp4' || v.url?.includes('.mp4')));
    const webm_var = variants.find(v => (v.type === 'sample' || v.file_ext === 'webm') && (v.file_ext === 'webm' || v.url?.includes('.webm')));
    const any_video = mp4_720p || mp4_orig || webm_var || variants.find(v => v.file_ext === 'mp4' || v.file_ext === 'webm');

    let fileUrl = item.file_url || item.large_file_url || item.preview_file_url || '';
    let sampleUrl = item.large_file_url || item.file_url || '';

    if (any_video && any_video.url) {
      sampleUrl = mp4_720p?.url || webm_var?.url || any_video.url;
      fileUrl = mp4_orig?.url || any_video.url || fileUrl;
    }

    const { isVideo: checkVideo, isGif, hasSound: checkSound, fileExt: detectedExt } = checkMediaTypes(fileUrl, item.file_ext, rawTags);
    const hasPlayableVideo = (fileUrl.endsWith('.mp4') || fileUrl.endsWith('.webm') || sampleUrl.endsWith('.mp4') || sampleUrl.endsWith('.webm') || !!any_video);
    const isVideo = (checkVideo || hasPlayableVideo) && (!fileUrl.endsWith('.zip') || !!any_video);
    const hasSound = isVideo && (checkSound || rawTags.includes('sound') || rawTags.includes('audio') || variants.some(v => v.has_sound || v.audio));
    
    const findImgVariant = (types) => variants.find(v => types.includes(v.type) && (v.file_ext === 'jpg' || v.file_ext === 'webp' || v.file_ext === 'png'));
    const thumb180 = findImgVariant(['180x180'])?.url || item.preview_file_url || '';
    const thumb360 = findImgVariant(['360x360'])?.url || '';
    const thumb720 = findImgVariant(['720x720'])?.url || '';
    const thumbSample = findImgVariant(['sample'])?.url || item.large_file_url || sampleUrl || '';
    const thumbOriginal = (!isVideo && (findImgVariant(['original'])?.url || item.file_url || fileUrl)) || '';
    const previewUrl = resolvePreviewUrl(thumb180 || item.preview_file_url, fileUrl, sampleUrl, isVideo);
    const isAi = checkIsAi(rawTags, aiTagsList) || (item.tag_string_meta && item.tag_string_meta.includes('ai_generated'));
    const author = (item.tag_string_artist || '').split(' ').filter(Boolean).join(', ') || item.uploader_name || '';

    const duration = item.media_asset?.duration || any_video?.duration || 0;
    let durationText = '';
    if (duration > 0) {
      const mins = Math.floor(duration / 60);
      const secs = Math.floor(duration % 60);
      durationText = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }

    return {
      id: `danbooru_${item.id}`,
      originalId: String(item.id),
      site: 'danbooru',
      siteName: 'Danbooru',
      previewUrl,
      thumb180,
      thumb360,
      thumb720,
      thumbSample,
      thumbOriginal,
      sampleUrl,
      fileUrl,
      fileExt: isVideo ? (any_video?.file_ext || 'mp4') : detectedExt,
      isVideo,
      isGif,
      hasSound,
      duration,
      durationText,
      author,
      tags: rawTags,
      tagDetails: {
        artist: (item.tag_string_artist || '').split(' ').filter(Boolean),
        character: (item.tag_string_character || '').split(' ').filter(Boolean),
        copyright: (item.tag_string_copyright || '').split(' ').filter(Boolean),
        general: (item.tag_string_general || '').split(' ').filter(Boolean),
        meta: (item.tag_string_meta || '').split(' ').filter(Boolean)
      },
      score: item.score || 0,
      favCount: item.fav_count || 0,
      rating: item.rating || 'g',
      width: item.image_width || 0,
      height: item.image_height || 0,
      source: item.source || '',
      createdAt: item.created_at || '',
      isAi
    };
  }).filter(p => p.fileUrl || p.sampleUrl || p.previewUrl);
}
