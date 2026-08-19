import { 
  DEFAULT_AI_TAGS, 
  SOUND_KEYWORDS,
  CURVY_INCLUDE_TAGS, 
  CURVY_EXCLUDE_TAGS, 
  PETITE_INCLUDE_TAGS, 
  PETITE_EXCLUDE_TAGS,
  FURRY_TAGS,
  PREGNANT_TAGS
} from '../config/constants.js';

export function isPostMatchingFilters(post, criteria = {}) {
  if (!post || (!post.previewUrl && !post.fileUrl && !post.sampleUrl)) return false;

  const {
    typeFilter = 'all',
    ageFilter = 'all',
    aiFilter = 'no-ai',
    ratingFilter = 'all',
    hideFurry = false,
    hidePregnant = false,
    blacklist = [],
    negativeTokens = [],
    activeCurvyTags = CURVY_INCLUDE_TAGS,
    activePetiteTags = PETITE_INCLUDE_TAGS,
    hasUserPositiveTags = false
  } = criteria;

  // 1. Фильтр типа контента
  if (typeFilter === 'audio' || typeFilter === 'sound') {
    if (!post.isVideo || !post.hasSound) return false;
  } else if (typeFilter === 'video') {
    if (!post.isVideo && !post.isGif) return false;
  } else if (typeFilter === 'image') {
    if (post.isVideo || post.isGif) return false;
  }

  const postTags = Array.isArray(post.tags) ? post.tags.map(t => (typeof t === 'string' ? t.toLowerCase().trim() : '')).filter(Boolean) : [];
  const postTagsFlat = postTags.join(' ').replace(/_/g, ' ');

  // 2. Локальная фильтрация по исключающим (-tag) тегам
  if (negativeTokens && negativeTokens.length > 0) {
    if (negativeTokens.some(neg => postTagsFlat.includes(neg) || postTags.includes(neg))) return false;
  }

  // 3. Фильтр телосложения и типажей (Мамочки vs Лоли)
  if (ageFilter === 'adult') {
    if (CURVY_EXCLUDE_TAGS.some(tag => postTags.includes(tag))) return false;
    if (!hasUserPositiveTags && !activeCurvyTags.some(tag => postTags.includes(tag))) return false;
  } else if (ageFilter === 'young') {
    if (PETITE_EXCLUDE_TAGS.some(tag => postTags.includes(tag))) return false;
    if (!hasUserPositiveTags && !activePetiteTags.some(tag => postTags.includes(tag))) return false;
  }

  // 4. AI Фильтр
  if (aiFilter === 'no-ai') {
    if (post.isAi) return false;
  } else if (aiFilter === 'only-ai') {
    if (!post.isAi) return false;
  }

  // 5. Возрастной рейтинг
  if (ratingFilter === 'nsfw') {
    const r = (post.rating || '').toLowerCase();
    if (r !== 'e' && r !== 'q' && r !== 'explicit' && r !== 'questionable' && r !== 'sensitive' && r !== '?') return false;
  } else if (ratingFilter === 'sfw') {
    const r = (post.rating || '').toLowerCase();
    if (r !== 's' && r !== 'g' && r !== 'safe' && r !== 'general') return false;
  }

  // 6. Фильтр фурри
  if (hideFurry) {
    if (FURRY_TAGS.some(fTag => postTags.some(t => t === fTag || t.startsWith(fTag + '_') || t.endsWith('_' + fTag)))) return false;
  }

  // 7. Фильтр беременности
  if (hidePregnant) {
    if (PREGNANT_TAGS.some(pTag => postTags.some(t => t === pTag || t.includes(pTag)))) return false;
  }

  // 8. Черный список
  if (blacklist && blacklist.length > 0) {
    const lowerBlacklist = blacklist.map(b => (typeof b === 'string' ? b.toLowerCase().trim() : '')).filter(Boolean);
    if (lowerBlacklist.some(blackTag => postTags.includes(blackTag))) return false;
  }

  return true;
}

export function checkIsAi(tagsArray, aiTagsList) {
  if (!Array.isArray(tagsArray)) return false;
  const lowerTags = tagsArray.map(t => (typeof t === 'string' ? t.toLowerCase().trim() : ''));
  const checkList = (aiTagsList && aiTagsList.length > 0 ? aiTagsList : DEFAULT_AI_TAGS).map(t => t.toLowerCase().trim());
  return lowerTags.some(tag => checkList.includes(tag) || tag.includes('ai_gen') || tag.includes('novelai') || tag.includes('stable_diffusion') || tag.includes('midjourney'));
}

export function checkMediaTypes(url = '', fileExt = '', rawTags = []) {
  const lowerTags = Array.isArray(rawTags) ? rawTags.map(t => (typeof t === 'string' ? t.toLowerCase().trim() : '')) : [];
  const tagsStr = lowerTags.join(' ');
  
  // 1. Извлекаем чистое расширение (без пути, параметров и лишних точек)
  let ext = '';
  if (fileExt && typeof fileExt === 'string') {
    const cleanExt = fileExt.trim().split('?')[0];
    const dotIdx = cleanExt.lastIndexOf('.');
    if (dotIdx !== -1) {
      ext = cleanExt.slice(dotIdx + 1).toLowerCase();
    } else if (cleanExt.length <= 5 && !cleanExt.includes('/') && !cleanExt.includes('\\')) {
      ext = cleanExt.toLowerCase();
    }
  }
  if (!ext && url && typeof url === 'string') {
    const cleanUrl = url.trim().split('?')[0];
    const match = cleanUrl.match(/\.([a-z0-9]+)$/i);
    if (match) {
      ext = match[1].toLowerCase();
    }
  }

  // 2. Детекция GIF (GIF - это анимированное изображение (img), а не контейнер HTML5 video)
  const isGif = ext === 'gif' || lowerTags.includes('gif') || (!ext && ((url && url.toLowerCase().includes('.gif')) || (fileExt && fileExt.toLowerCase().includes('.gif'))));

  // 3. Детекция Видео (MP4, WebM, MKV, MOV, M4V, FLV, AVI)
  // ВАЖНО: тег 'animated' ставится как на GIF, так и на видео, поэтому animated сам по себе не делает файл видео если это GIF или статический формат.
  const videoExts = ['mp4', 'webm', 'mkv', 'mov', 'm4v', 'flv', 'avi'];
  const hasVideoExt = videoExts.includes(ext) || videoExts.some(vExt => (url && url.toLowerCase().includes(`.${vExt}`)) || (fileExt && fileExt.toLowerCase().includes(`.${vExt}`)));
  const hasVideoTag = lowerTags.includes('video') || lowerTags.includes('webm') || lowerTags.includes('mp4') || lowerTags.includes('ugoira');
  
  const isVideo = !isGif && (hasVideoExt || (hasVideoTag && ext !== 'jpg' && ext !== 'jpeg' && ext !== 'png' && ext !== 'webp' && ext !== 'bmp' && ext !== 'gif'));

  // 4. Окончательное определение расширения
  if (!ext) {
    if (isVideo) ext = 'mp4';
    else if (isGif) ext = 'gif';
    else ext = 'jpg';
  }

  // 5. Проверка звука
  const hasSound = isVideo && (
    lowerTags.some(t => SOUND_KEYWORDS.includes(t)) || 
    tagsStr.includes('has_audio') || 
    tagsStr.includes('with_sound') || 
    tagsStr.includes('sound_warning')
  );

  return { isVideo, isGif, hasSound, fileExt: ext };
}

export function normalizeDate(rawDate) {
  if (!rawDate) return '';
  try {
    if (typeof rawDate === 'number') {
      const d = rawDate < 10000000000 ? new Date(rawDate * 1000) : new Date(rawDate);
      if (!isNaN(d.getTime())) return d.toISOString();
    } else if (typeof rawDate === 'string') {
      const trimmed = rawDate.trim();
      if (!trimmed) return '';
      if (/^\d{10}$/.test(trimmed)) {
        const d = new Date(parseInt(trimmed, 10) * 1000);
        if (!isNaN(d.getTime())) return d.toISOString();
      } else if (/^\d{13}$/.test(trimmed)) {
        const d = new Date(parseInt(trimmed, 10));
        if (!isNaN(d.getTime())) return d.toISOString();
      }
      const d = new Date(trimmed);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
  } catch {}
  return '';
}

export function extractAuthor(rawTags = [], source = '', itemAuthor = '') {
  const tags = Array.isArray(rawTags) ? rawTags : [];
  
  // 1. Поиск в явных тегах автора
  const explicitArtistTags = tags.filter(t => 
    t.startsWith('artist:') || t.startsWith('creator:') || t.startsWith('author:') || t.startsWith('draw:')
  ).map(t => t.replace(/^(artist|creator|author|draw):/, ''));
  if (explicitArtistTags.length > 0) {
    return explicitArtistTags.join(', ');
  }

  // 2. Поиск тегов со специальными маркерами: name_(artist), name_(creator), by_name, etc.
  const markerArtistTags = tags.filter(t => 
    t.endsWith('_(artist)') || t.endsWith('_(creator)') || t.endsWith('_(circle)') || t.endsWith('_(studio)') || t.startsWith('by_')
  ).map(t => t.replace(/_?\((artist|creator|circle|studio)\)$/i, '').replace(/^by_/, ''));
  if (markerArtistTags.length > 0) {
    return markerArtistTags.join(', ');
  }

  // 3. Извлечение автора из ссылки источника (source)
  if (source && typeof source === 'string') {
    const s = source.trim();
    const twitterMatch = s.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)(?:\/status|\/|$)/i);
    if (twitterMatch && !['intent', 'i', 'home', 'search', 'post', 'status'].includes(twitterMatch[1].toLowerCase())) {
      return `@${twitterMatch[1]}`;
    }
    const pixivUserMatch = s.match(/pixiv\.net\/(?:en\/)?users\/(\d+)/i) || s.match(/pixiv\.me\/([a-zA-Z0-9_-]+)/i);
    if (pixivUserMatch) {
      return `pixiv:${pixivUserMatch[1]}`;
    }
    const artstationMatch = s.match(/artstation\.com\/([a-zA-Z0-9_-]+)/i);
    if (artstationMatch && !['artwork', 'projects', 'artist'].includes(artstationMatch[1].toLowerCase())) {
      return artstationMatch[1];
    }
    const deviantArtMatch = s.match(/deviantart\.com\/([a-zA-Z0-9_-]+)/i);
    if (deviantArtMatch && !['art', 'tag', 'topic', 'view'].includes(deviantArtMatch[1].toLowerCase())) {
      return deviantArtMatch[1];
    }
    const fanboxMatch = s.match(/([a-zA-Z0-9_-]+)\.fanbox\.cc/i);
    if (fanboxMatch) {
      return fanboxMatch[1];
    }
    const fantiaMatch = s.match(/fantia\.jp\/fanclubs\/(\d+)/i);
    if (fantiaMatch) {
      return `fantia:${fantiaMatch[1]}`;
    }
    const patreonMatch = s.match(/patreon\.com\/([a-zA-Z0-9_-]+)/i);
    if (patreonMatch && !['posts', 'join'].includes(patreonMatch[1].toLowerCase())) {
      return `patreon:${patreonMatch[1]}`;
    }
    const skebMatch = s.match(/skeb\.jp\/@([a-zA-Z0-9_-]+)/i);
    if (skebMatch) {
      return `@${skebMatch[1]}`;
    }
  }

  // 4. Использование поля itemAuthor если оно не мусорное
  if (itemAuthor && typeof itemAuthor === 'string') {
    const cleanAuthor = itemAuthor.trim();
    const isBad = !cleanAuthor || cleanAuthor === '0' || cleanAuthor === 'null' || cleanAuthor === 'undefined' || cleanAuthor.toLowerCase() === 'anonymous' || /^\d+$/.test(cleanAuthor);
    if (!isBad) {
      return cleanAuthor;
    }
  }

  return '';
}

export function classifyTags(rawTags = [], author = '') {
  const tags = Array.isArray(rawTags) ? rawTags : [];
  const artist = [];
  const character = [];
  const copyright = [];
  const meta = [];
  const general = [];

  if (author) {
    author.split(',').forEach(a => {
      const clean = a.trim().replace(/^@/, '').replace(/^pixiv:/, '').replace(/\s+/g, '_');
      if (clean && !artist.includes(clean)) artist.push(clean);
    });
  }

  for (const tag of tags) {
    const t = tag.toLowerCase();
    if (t.startsWith('artist:') || t.endsWith('_(artist)') || t.endsWith('_(creator)') || t.startsWith('by_') || t.endsWith('_(circle)') || t.endsWith('_(studio)')) {
      const clean = tag.replace(/^(artist|creator|author|draw):/, '').replace(/_?\((artist|creator|circle|studio)\)$/i, '').replace(/^by_/, '');
      if (!artist.includes(clean)) artist.push(clean);
    } else if (t.startsWith('character:') || t.endsWith('_(character)') || t.endsWith('_(cosplay)')) {
      const clean = tag.replace(/^character:/, '').replace(/_?\((character|cosplay)\)$/i, '');
      if (!character.includes(clean)) character.push(clean);
    } else if (t.startsWith('copyright:') || t.endsWith('_(series)') || t.endsWith('_(game)') || t.endsWith('_(anime)') || t.endsWith('_(manga)') || t.endsWith('_(vtuber)') || t.endsWith('_(novel)')) {
      const clean = tag.replace(/^copyright:/, '').replace(/_?\((series|game|anime|manga|vtuber|novel)\)$/i, '');
      if (!copyright.includes(clean)) copyright.push(clean);
    } else if (t.startsWith('meta:') || ['highres', 'absurdres', '4k', 'sound', 'audio', 'video', 'animated', 'ugoira', 'translated', 'commentary', 'tagme'].includes(t)) {
      const clean = tag.replace(/^meta:/, '');
      if (!meta.includes(clean)) meta.push(clean);
    } else {
      general.push(tag);
    }
  }

  return { artist, character, copyright, general, meta };
}

export function adaptTagsForSite(site, rawTags = '', ageFilter = 'all', typeFilter = 'all') {
  let tags = (rawTags || '').trim();

  // 1. Адаптация тегов: для Rule34Video преобразуем скобки в поисковые фразы
  if (site === 'rule34video' && tags) {
    tags = tags.replace(/([a-zA-Z0-9_-]+)_\(([^)]+)\)/g, '$1 $2');
    tags = tags.replace(/([a-zA-Z0-9_-]+)\s*\(([^)]+)\)/g, '$1 $2');
    tags = tags.replace(/[()]/g, '');
  }

  // 2. Алиасы тегов для совместимости с Danbooru
  if (site === 'gelbooru' || site === 'rule34' || site === 'safebooru' || site === 'yandere' || site === 'konachan' || site === 'rule34video' || site === 'xbooru' || site === 'hypnohub') {
    tags = tags.replace(/\bpetite\b/gi, 'small_breasts');
  }

  // 3. Адаптация директив сортировки (order:* <-> sort:*) между движками
  if (site === 'rule34' || site === 'gelbooru' || site === 'safebooru' || site === 'xbooru' || site === 'hypnohub') {
    tags = tags
      .replace(/\border:score_desc\b/gi, 'sort:score:desc')
      .replace(/\border:score\b/gi, 'sort:score:desc')
      .replace(/\border:rank\b/gi, site === 'gelbooru' ? 'sort:updated:desc' : 'sort:score:desc')
      .replace(/\border:vote\b/gi, 'sort:score:desc')
      .replace(/\border:random\b/gi, 'sort:random')
      .replace(/\border:id_desc\b/gi, 'sort:id:desc')
      .replace(/\border:id_asc\b/gi, 'sort:id:asc')
      .replace(/\border:score_asc\b/gi, 'sort:score:asc');
  } else if (site === 'danbooru' || site === 'yandere' || site === 'konachan') {
    tags = tags
      .replace(/\bsort:score:desc\b/gi, 'order:score')
      .replace(/\bsort:score:asc\b/gi, 'order:score_asc')
      .replace(/\bsort:score\b/gi, 'order:score')
      .replace(/\bsort:random\b/gi, 'order:random')
      .replace(/\bsort:id:desc\b/gi, 'order:id_desc')
      .replace(/\bsort:id:asc\b/gi, 'order:id_asc')
      .replace(/\bsort:updated:desc\b/gi, site === 'danbooru' ? 'order:rank' : 'order:vote');
  }

  const tagList = tags.split(/\s+/).filter(Boolean);

  // 4. Подмешивание тегов телосложения / типажей
  if (ageFilter === 'adult') {
    if (site === 'rule34' || site === 'gelbooru' || site === 'yandere' || site === 'konachan' || site === 'safebooru' || site === 'xbooru' || site === 'hypnohub') {
      if (!tagList.some(t => t.startsWith('-loli'))) tagList.push('-loli');
      if (!tagList.some(t => t.startsWith('-shota'))) tagList.push('-shota');
      if (!tagList.some(t => t.startsWith('-flat_chest'))) tagList.push('-flat_chest');
    }
    if (tagList.length === 0) {
      if (site === 'rule34' || site === 'gelbooru' || site === 'safebooru' || site === 'xbooru' || site === 'hypnohub') {
        tagList.push('mature_female');
      } else if (site === 'yandere' || site === 'konachan') {
        tagList.push('mature');
      }
    }
  } else if (ageFilter === 'young') {
    if (site === 'rule34' || site === 'gelbooru' || site === 'yandere' || site === 'konachan' || site === 'safebooru' || site === 'xbooru' || site === 'hypnohub') {
      if (!tagList.some(t => t.startsWith('-milf'))) tagList.push('-milf');
      if (!tagList.some(t => t.startsWith('-huge_breasts'))) tagList.push('-huge_breasts');
    }
    if (tagList.length === 0) {
      if (site === 'rule34' || site === 'gelbooru' || site === 'safebooru' || site === 'xbooru' || site === 'hypnohub') {
        tagList.push('small_breasts');
      } else if (site === 'yandere' || site === 'konachan') {
        tagList.push('loli');
      }
    }
  }

  return tagList.join(' ');
}
