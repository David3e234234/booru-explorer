import { 
  DEFAULT_AI_TAGS, 
  SOUND_KEYWORDS,
  CURVY_INCLUDE_TAGS, 
  CURVY_EXCLUDE_TAGS, 
  PETITE_INCLUDE_TAGS, 
  PETITE_EXCLUDE_TAGS,
  FURRY_TAGS,
  PREGNANT_TAGS,
  LGBT_TAGS
} from '../config/constants.js';

const criteriaSetsCache = new WeakMap();

// O(1) lookups instead of array scans per post
const soundKeywordsSet = new Set(SOUND_KEYWORDS);

// Date-filter windows, hoisted out of the per-post path
const DATE_FILTER_LIMITS_MS = {
  '24h': 24 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '2d': 2 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  'week': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  'month': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
  '3months': 90 * 24 * 60 * 60 * 1000,
  '365d': 365 * 24 * 60 * 60 * 1000,
  'year': 365 * 24 * 60 * 60 * 1000
};

function getCriteriaSets(criteria, activeCurvyTags, activePetiteTags, activeFurryTags, activePregnantTags, activeLgbtTags) {
  let sets = criteriaSetsCache.get(criteria);
  if (sets) return sets;
  sets = {
    blacklist: new Set((Array.isArray(criteria.blacklist) ? criteria.blacklist : [])
      .map(b => (typeof b === 'string' ? b.toLowerCase().trim() : '')).filter(Boolean)),
    curvyInclude: new Set(activeCurvyTags),
    curvyExclude: new Set(CURVY_EXCLUDE_TAGS),
    petiteInclude: new Set(activePetiteTags),
    petiteExclude: new Set(PETITE_EXCLUDE_TAGS),
    furry: Array.isArray(activeFurryTags) && activeFurryTags.length > 0 ? activeFurryTags : FURRY_TAGS,
    pregnant: Array.isArray(activePregnantTags) && activePregnantTags.length > 0 ? activePregnantTags : PREGNANT_TAGS,
    lgbt: Array.isArray(activeLgbtTags) && activeLgbtTags.length > 0 ? activeLgbtTags : LGBT_TAGS
  };
  criteriaSetsCache.set(criteria, sets);
  return sets;
}

export function isPostMatchingFilters(post, criteria = {}) {
  // Archive-only posts (zip packs) carry no direct media URLs until unpacked
  if (!post || (!post.isArchive && !post.previewUrl && !post.fileUrl && !post.sampleUrl)) return false;

  const {
    typeFilter = 'all',
    ageFilter = 'all',
    aiFilter = 'no-ai',
    ratingFilter = 'all',
    dateFilter = 'all',
    hideFurry = false,
    hidePregnant = false,
    hideLgbt = false,
    negativeTokens = [],
    activeCurvyTags = CURVY_INCLUDE_TAGS,
    activePetiteTags = PETITE_INCLUDE_TAGS,
    activeFurryTags = FURRY_TAGS,
    activePregnantTags = PREGNANT_TAGS,
    activeLgbtTags = LGBT_TAGS,
    hasUserPositiveTags = false
  } = criteria;

  const sets = getCriteriaSets(criteria, activeCurvyTags, activePetiteTags, activeFurryTags, activePregnantTags, activeLgbtTags);

  // 1. Content type filter
  if (typeFilter === 'audio' || typeFilter === 'sound') {
    if (!post.isVideo || !post.hasSound) return false;
  } else if (typeFilter === 'video') {
    if (!post.isVideo && !post.isGif) return false;
  } else if (typeFilter === 'image') {
    if (post.isVideo || post.isGif) return false;
    const fileUrl = (post.fileUrl || '').toLowerCase();
    const sampleUrl = (post.sampleUrl || '').toLowerCase();
    if (/\.(mp4|webm|gif|mov|m4v|flv|avi|mkv)(\?.*)?$/i.test(fileUrl) ||
        /\.(mp4|webm|gif|mov|m4v|flv|avi|mkv)(\?.*)?$/i.test(sampleUrl)) {
      return false;
    }
  }

  const postTagSet = new Set(Array.isArray(post.tags)
    ? post.tags.map(t => (typeof t === 'string' ? t.toLowerCase().trim() : '')).filter(Boolean)
    : []);

  // 2. Local filtering by excluded (-tag) tags
  // Exact match against both spellings: negative tokens arrive space-separated
  // ("long blonde hair") while tags are stored underscored. Substring matching
  // used to hide unrelated posts (e.g. -blonde_hair also hid long_blonde_haired_girl).
  if (negativeTokens && negativeTokens.length > 0) {
    let hidden = false;
    for (const neg of negativeTokens) {
      if (postTagSet.has(neg)) { hidden = true; break; }
      if (neg.indexOf(' ') !== -1 && postTagSet.has(neg.replace(/ /g, '_'))) { hidden = true; break; }
    }
    if (hidden) return false;
  }

  // 3. Body type and archetype filter (milfs vs lolis)
  if (ageFilter === 'adult') {
    let excluded = false;
    for (const t of postTagSet) { if (sets.curvyExclude.has(t)) { excluded = true; break; } }
    if (excluded) return false;
    if (!hasUserPositiveTags) {
      let included = false;
      for (const t of postTagSet) { if (sets.curvyInclude.has(t)) { included = true; break; } }
      if (!included) return false;
    }
  } else if (ageFilter === 'young') {
    let excluded = false;
    for (const t of postTagSet) { if (sets.petiteExclude.has(t)) { excluded = true; break; } }
    if (excluded) return false;
    if (!hasUserPositiveTags) {
      let included = false;
      for (const t of postTagSet) { if (sets.petiteInclude.has(t)) { included = true; break; } }
      if (!included) return false;
    }
  }

  // 4. AI filter
  if (aiFilter === 'no-ai') {
    if (post.isAi) return false;
  } else if (aiFilter === 'only-ai') {
    if (!post.isAi) return false;
  }

  // 5. Age rating
  if (ratingFilter === 'nsfw') {
    const r = (post.rating || '').toLowerCase();
    if (r !== 'e' && r !== 'explicit' && r !== '?') return false;
  } else if (ratingFilter === 'questionable' || ratingFilter === '16+') {
    const r = (post.rating || '').toLowerCase();
    if (post.site === 'danbooru' || post.site === 'gelbooru') {
      if (r !== 'q' && r !== 'questionable' && r !== 'sensitive' && r !== 's') return false;
    } else {
      if (r !== 'q' && r !== 'questionable' && r !== 'sensitive') return false;
    }
  } else if (ratingFilter === 'sfw') {
    const r = (post.rating || '').toLowerCase();
    // Danbooru and Gelbooru use a 4-level scale: 's' = sensitive (16+), only 'g' is safe there.
    // Other sites use the legacy scale where 's' = safe.
    if (post.site === 'danbooru' || post.site === 'gelbooru') {
      if (r !== 'g' && r !== 'general') return false;
    } else {
      if (r !== 's' && r !== 'g' && r !== 'safe' && r !== 'general') return false;
    }
  }

  // 6-8. Content filters (furry / pregnancy / LGBT)
  if (hideFurry || hidePregnant || hideLgbt) {
    const tagList = Array.from(postTagSet);
    if (hideFurry && sets.furry.some(fTag => tagList.some(t => t === fTag || t.startsWith(fTag + '_') || t.endsWith('_' + fTag)))) return false;
    if (hidePregnant && sets.pregnant.some(pTag => tagList.some(t => t === pTag || t.includes(pTag)))) return false;
    if (hideLgbt && sets.lgbt.some(lTag => tagList.some(t => t === lTag || t.startsWith(lTag + '_') || t.endsWith('_' + lTag) || t.includes('_' + lTag + '_')))) return false;
  }

  // 8. Blacklist (Set - O(1) per tag)
  if (sets.blacklist.size > 0) {
    for (const t of postTagSet) {
      if (sets.blacklist.has(t)) return false;
    }
  }

  // 9. Creation/upload date filter
  if (dateFilter && dateFilter !== 'all' && post.createdAt) {
    const postTime = new Date(post.createdAt).getTime();
    if (!isNaN(postTime) && postTime > 0) {
      const diffMs = Date.now() - postTime;
      const allowedMaxMs = DATE_FILTER_LIMITS_MS[dateFilter];
      if (allowedMaxMs && diffMs > allowedMaxMs) {
        return false;
      }
    }
  }

  return true;
}

const aiTagsSetCache = new WeakMap();

export function checkIsAi(tagsArray, aiTagsList) {
  if (!Array.isArray(tagsArray)) return false;
  const source = (aiTagsList && aiTagsList.length > 0 ? aiTagsList : DEFAULT_AI_TAGS);
  let checkSet = aiTagsSetCache.get(source);
  if (!checkSet) {
    checkSet = new Set(source.map(t => (typeof t === 'string' ? t.toLowerCase().trim() : '')));
    aiTagsSetCache.set(source, checkSet);
  }
  return tagsArray.some(rawTag => {
    if (typeof rawTag !== 'string') return false;
    const tag = rawTag.toLowerCase().trim();
    return checkSet.has(tag) || tag.includes('ai_gen') || tag.includes('novelai') || tag.includes('stable_diffusion') || tag.includes('midjourney');
  });
}

export function checkMediaTypes(url = '', fileExt = '', rawTags = []) {
  const lowerTags = Array.isArray(rawTags) ? rawTags.map(t => (typeof t === 'string' ? t.toLowerCase().trim() : '')) : [];
  const tagsStr = lowerTags.join(' ');
  const lowerUrl = typeof url === 'string' ? url.toLowerCase() : '';
  const lowerFileExt = typeof fileExt === 'string' ? fileExt.toLowerCase() : '';
  
  // 1. Extract the clean extension (no path, params, or stray dots)
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

  // 2. GIF detection (a GIF is an animated image (img), not an HTML5 video container)
  const isGif = ext === 'gif' || lowerTags.includes('gif') || (!ext && (lowerUrl.includes('.gif') || lowerFileExt.includes('.gif')));

  // 3. Video detection (MP4, WebM, MKV, MOV, M4V, FLV, AVI)
  // IMPORTANT: the 'animated' tag is applied to both GIFs and videos, so animated alone does not make a file a video when it is a GIF or a static format.
  const videoExts = ['mp4', 'webm', 'mkv', 'mov', 'm4v', 'flv', 'avi'];
  let hasVideoExtByUrl = false;
  for (const vExt of videoExts) {
    if (lowerUrl.includes(`.${vExt}`) || lowerFileExt.includes(`.${vExt}`)) {
      hasVideoExtByUrl = true;
      break;
    }
  }
  const hasVideoExt = videoExts.includes(ext) || hasVideoExtByUrl;
  const hasVideoTag = lowerTags.includes('video') || lowerTags.includes('webm') || lowerTags.includes('mp4') || lowerTags.includes('ugoira');
  
  const isVideo = !isGif && (hasVideoExt || (hasVideoTag && ext !== 'jpg' && ext !== 'jpeg' && ext !== 'png' && ext !== 'webp' && ext !== 'bmp' && ext !== 'gif'));

  // 4. Final extension determination
  if (!ext) {
    if (isVideo) ext = 'mp4';
    else if (isGif) ext = 'gif';
    else ext = 'jpg';
  }

  // 5. Sound check
  const hasSound = isVideo && (
    lowerTags.some(t => soundKeywordsSet.has(t)) || 
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
  
  // 1. Look in explicit artist tags
  const explicitArtistTags = tags.filter(t => 
    t.startsWith('artist:') || t.startsWith('creator:') || t.startsWith('author:') || t.startsWith('draw:')
  ).map(t => t.replace(/^(artist|creator|author|draw):/, ''));
  if (explicitArtistTags.length > 0) {
    return explicitArtistTags.join(', ');
  }

  // 2. Look for tags with special markers: name_(artist), name_(creator), by_name, etc.
  const markerArtistTags = tags.filter(t => 
    t.endsWith('_(artist)') || t.endsWith('_(creator)') || t.endsWith('_(circle)') || t.endsWith('_(studio)') || t.startsWith('by_')
  ).map(t => t.replace(/_?\((artist|creator|circle|studio)\)$/i, '').replace(/^by_/, ''));
  if (markerArtistTags.length > 0) {
    return markerArtistTags.join(', ');
  }

  // 3. Extract the author from the source URL
  if (source && typeof source === 'string') {
    const s = source.trim();
    const twitterMatch = s.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)(?:\/status|\/|$)/i);
    if (twitterMatch && !['intent', 'i', 'home', 'search', 'post', 'status'].includes(twitterMatch[1].toLowerCase())) {
      return `@${twitterMatch[1]}`;
    }
    const bskyMatch = s.match(/bsky\.app\/profile\/([a-zA-Z0-9_.-]+)/i);
    if (bskyMatch) {
      return `@${bskyMatch[1]}`;
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
    const boostyMatch = s.match(/boosty\.to\/([a-zA-Z0-9_-]+)/i);
    if (boostyMatch) {
      return boostyMatch[1];
    }
    const gumroadMatch = s.match(/([a-zA-Z0-9_-]+)\.gumroad\.com/i) || s.match(/gumroad\.com\/([a-zA-Z0-9_-]+)/i);
    if (gumroadMatch) {
      return gumroadMatch[1];
    }
    const skebMatch = s.match(/skeb\.jp\/@([a-zA-Z0-9_-]+)/i);
    if (skebMatch) {
      return `@${skebMatch[1]}`;
    }
    const newgroundsViewMatch = s.match(/newgrounds\.com\/art\/view\/([a-zA-Z0-9_-]+)/i);
    if (newgroundsViewMatch) {
      return newgroundsViewMatch[1];
    }
    const newgroundsSubMatch = s.match(/([a-zA-Z0-9_-]+)\.newgrounds\.com/i);
    if (newgroundsSubMatch && !['www', 'art', 'portal', 'wiki', 'bbs', 'ngfiles', 'uploads'].includes(newgroundsSubMatch[1].toLowerCase())) {
      return newgroundsSubMatch[1];
    }
    const nijieMatch = s.match(/nijie\.info\/members\.php\?id=(\d+)/i);
    if (nijieMatch) {
      return `nijie:${nijieMatch[1]}`;
    }
  }

  // 4. Use the itemAuthor field when it is not junk
  if (itemAuthor && typeof itemAuthor === 'string') {
    const cleanAuthor = itemAuthor.trim();
    const isBad = !cleanAuthor || cleanAuthor === '0' || cleanAuthor === 'null' || cleanAuthor === 'undefined' || cleanAuthor.toLowerCase() === 'anonymous' || /^\d+$/.test(cleanAuthor);
    if (!isBad) {
      return cleanAuthor;
    }
  }

  return '';
}

const META_HELPER_KEYWORDS = new Set([
  'highres', 'absurdres', 'superabsurdres', 'lowres', 'downscaled', 'lossless', '4k', '8k', 'hd', '60fps', 
  'ultra_high_res', 'bad_quality', 'poor_quality', 'huge_filesize', 'webp_artifacts', 'jpeg_artifacts',
  'sound', 'audio', 'video', 'animated', 'animation', 'ugoira', 'web_audio', 'has_sound', 'with_sound', 
  'muted', 'loop', 'silent', 'mp4', 'webm', 'gif', 'flash', 'swf', 'apng', 'interactive',
  'translated', 'partially_translated', 'translation_request', 'commentary', 'commentary_request', 
  'check_commentary', 'check_my_note', 'annotated', 'hard_translated', 'text', 'subtitles', 'rus_sub', 'eng_sub', 
  'speech_bubble', 'watermark', 'sample', 'thumbnail', 'signature', 'username', 'artist_name', 'url', 'web_address', 
  'timestamp', 'twitter_username', 'pixiv_id', 'bad_pixiv_id', 'bad_id', 'bad_link', 'bad_source', 
  'source_request', 'source request', 'tagme', 'duplicate', 'third-party_edit', 'edit', 'official_art', 
  'scan', 'magazine_scan', 'wallpaper', 'artbook', 'cover', 'doujinshi_cover', 'comic', 'manga', 'multi-panel', 
  'column_layout', 'page_number', 'omake', 'monochrome', 'greyscale', 'sketch', 'lineart', 'traditional_media', 'digital_media',
  'patreon', 'patreon_reward', 'patreon_logo', 'patreon_username', 'fanbox', 'fanbox_reward', 
  'fantia', 'fantia_reward', 'boosty', 'gumroad', 'subscribestar', 'skeb', 'ci-en', 'afdian', 'ko-fi',
  'psd', 'clip', 'zip', 'rar', '7z', 'pack', 'reward', 'tier',
  'ai_generated', 'ai_assisted', 'created_by_ai', 'stable_diffusion', 'novelai', 'midjourney', 'dall-e', 'dall-e_3', 'synthetic',
  'artist_request', 'artist request', 'character_request', 'character request', 'copyright_request', 'copyright request', 'meta_request', 'source_needed'
]);

export function classifyTags(rawTags = [], author = '') {
  const tags = Array.isArray(rawTags) ? rawTags : [];
  const artist = [];
  const character = [];
  const copyright = [];
  const meta = [];
  const general = [];

  const addUnique = (arr, val) => {
    if (val && !arr.includes(val)) arr.push(val);
  };

  if (author) {
    author.split(',').forEach(a => {
      const clean = a.trim().replace(/^[@pixiv:]+/, '').replace(/\s+/g, '_');
      if (clean) addUnique(artist, clean);
    });
  }

  for (const tag of tags) {
    if (!tag) continue;
    const originalTag = String(tag).trim();
    const lower = originalTag.toLowerCase();

    if (lower.startsWith('artist:') || lower.startsWith('creator:') || lower.startsWith('author:') || lower.startsWith('draw:') || lower.startsWith('by_') || lower.startsWith('channel:') || lower.startsWith('uploader:')) {
      const clean = originalTag.replace(/^(artist|creator|author|draw|channel|uploader):/i, '').replace(/^by_/i, '').trim();
      addUnique(artist, clean || originalTag);
      continue;
    }

    if (lower.startsWith('copyright:') || lower.startsWith('series:')) {
      const clean = originalTag.replace(/^(copyright|series):/i, '').trim();
      addUnique(copyright, clean || originalTag);
      continue;
    }

    if (lower.startsWith('character:')) {
      const clean = originalTag.replace(/^character:/i, '').trim();
      addUnique(character, clean || originalTag);
      continue;
    }

    if (lower.startsWith('meta:')) {
      const clean = originalTag.replace(/^meta:/i, '').trim();
      addUnique(meta, clean || originalTag);
      continue;
    }

    if (lower.endsWith('_(artist)') || lower.endsWith('_(creator)') || lower.endsWith('_(circle)') || lower.endsWith('_(studio)') || lower.endsWith('_(animator)') || lower.endsWith('_(mangaka)')) {
      addUnique(artist, originalTag);
      continue;
    }

    if (lower.endsWith('_(series)') || lower.endsWith('_(game)') || lower.endsWith('_(anime)') || lower.endsWith('_(manga)') || lower.endsWith('_(vtuber)') || lower.endsWith('_(novel)') || lower.endsWith('_(comic)') || lower.endsWith('_(franchise)') || lower.endsWith('_(project)')) {
      addUnique(copyright, originalTag);
      continue;
    }

    if (META_HELPER_KEYWORDS.has(lower) || lower.endsWith('_(medium)') || lower.endsWith('_(style)') || lower.endsWith('_(artwork)')) {
      addUnique(meta, originalTag);
      continue;
    }

    if (lower.endsWith('_(character)') || lower.endsWith('_(cosplay)') || lower.endsWith('_(person)')) {
      addUnique(character, originalTag);
      continue;
    }

    const parenMatch = lower.match(/^(.+?)_\(([^)]+)\)$/);
    if (parenMatch) {
      const seriesPart = parenMatch[2].trim();
      const reserved = ['artist', 'creator', 'circle', 'studio', 'series', 'game', 'anime', 'manga', 'vtuber', 'novel', 'comic', 'franchise', 'project', 'medium', 'style', 'artwork', 'character', 'cosplay', 'person'];
      if (!reserved.includes(seriesPart)) {
        addUnique(character, originalTag);
        continue;
      }
    }

    general.push(originalTag);
  }

  return { artist, copyright, character, general, meta };
}

export function adaptTagsForSite(site, rawTags = '', ageFilter = 'all', typeFilter = 'all') {
  let tags = (rawTags || '').trim();

  // 1. Tag adaptation: convert parentheses into search phrases for Rule34Video
  if (site === 'rule34video' && tags) {
    tags = tags.replace(/([a-zA-Z0-9_-]+)_\(([^)]+)\)/g, '$1 $2');
    tags = tags.replace(/([a-zA-Z0-9_-]+)\s*\(([^)]+)\)/g, '$1 $2');
    tags = tags.replace(/[()]/g, '');
  }

  // 2. Tag aliases for Danbooru compatibility
  if (site === 'gelbooru' || site === 'rule34' || site === 'safebooru' || site === 'yandere' || site === 'konachan' || site === 'rule34video' || site === 'xbooru' || site === 'hypnohub' || site === 'tbib') {
    tags = tags.replace(/\bpetite\b/gi, 'small_breasts');
  }

  // 3. Adapt sort directives (order:* <-> sort:*) between engines
  if (site === 'rule34' || site === 'gelbooru' || site === 'safebooru' || site === 'xbooru' || site === 'hypnohub' || site === 'tbib') {
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

  // 4. Mix in body type / archetype tags
  if (ageFilter === 'adult') {
    if (site === 'rule34' || site === 'gelbooru' || site === 'yandere' || site === 'konachan' || site === 'safebooru' || site === 'xbooru' || site === 'hypnohub' || site === 'tbib') {
      if (!tagList.some(t => t.startsWith('-loli'))) tagList.push('-loli');
      if (!tagList.some(t => t.startsWith('-shota'))) tagList.push('-shota');
      if (!tagList.some(t => t.startsWith('-flat_chest'))) tagList.push('-flat_chest');
    }
    if (tagList.length === 0) {
      if (site === 'rule34' || site === 'gelbooru' || site === 'safebooru' || site === 'xbooru' || site === 'hypnohub' || site === 'tbib') {
        tagList.push('mature_female');
      } else if (site === 'yandere' || site === 'konachan') {
        tagList.push('mature');
      }
    }
  } else if (ageFilter === 'young') {
    if (site === 'rule34' || site === 'gelbooru' || site === 'yandere' || site === 'konachan' || site === 'safebooru' || site === 'xbooru' || site === 'hypnohub' || site === 'tbib') {
      if (!tagList.some(t => t.startsWith('-milf'))) tagList.push('-milf');
      if (!tagList.some(t => t.startsWith('-huge_breasts'))) tagList.push('-huge_breasts');
    }
    if (tagList.length === 0) {
      if (site === 'rule34' || site === 'gelbooru' || site === 'safebooru' || site === 'xbooru' || site === 'hypnohub' || site === 'tbib') {
        tagList.push('small_breasts');
      } else if (site === 'yandere' || site === 'konachan') {
        tagList.push('loli');
      }
    }
  }

  return tagList.join(' ');
}

export function decodeHtmlEntities(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}
