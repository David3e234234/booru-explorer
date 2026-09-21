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
import { resolveQueryTagsForSite } from '../services/aliasService.js';


const criteriaSetsCache = new WeakMap();

// O(1) lookups instead of array scans per post
const soundKeywordsSet = new Set(SOUND_KEYWORDS);

/**
 * Normalizes an array of tags (or comma/space-delimited string) into an array of unique,
 * trimmed, lowercase tags with bidirectional space and underscore expansion.
 */
export function normalizeTagList(list) {
  if (!Array.isArray(list)) {
    if (typeof list === 'string') {
      const trimmed = list.trim();
      if (!trimmed) return [];
      list = trimmed.includes(',') || trimmed.includes(';') || trimmed.includes('\n')
        ? trimmed.split(/[,;\n]+/)
        : trimmed.split(/\s+/);
    } else {
      return [];
    }
  }
  const result = [];
  const seen = new Set();
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const tag = item.toLowerCase().trim();
    if (!tag) continue;
    if (!seen.has(tag)) {
      seen.add(tag);
      result.push(tag);
    }
    // Bidirectional space and underscore expansion:
    // e.g., 'scat art' -> also adds 'scat_art'
    if (tag.includes(' ')) {
      const underscored = tag.replace(/\s+/g, '_');
      if (!seen.has(underscored)) {
        seen.add(underscored);
        result.push(underscored);
      }
    }
    // e.g., 'scat_art' -> also adds 'scat art'
    if (tag.includes('_')) {
      const spaced = tag.replace(/_+/g, ' ');
      if (!seen.has(spaced)) {
        seen.add(spaced);
        result.push(spaced);
      }
    }
  }
  return result;
}

/**
 * Safely converts an array of tags, delimited string, or fallback into a normalized Set.
 */
export function toNormalizedTagSet(tags, fallback = []) {
  let list = fallback;
  if (Array.isArray(tags) && tags.length > 0) {
    list = tags;
  } else if (typeof tags === 'string' && tags.trim().length > 0) {
    list = tags;
  }
  const norm = normalizeTagList(list);
  return new Set(norm);
}

/**
 * Matches a tag against a pattern using booru underscore/space word boundaries:
 * exact match, prefix (`pattern_`), suffix (`_pattern`), or infix (`_pattern_`).
 */
export function matchesTagBoundary(tag, pattern) {
  if (typeof tag !== 'string' || typeof pattern !== 'string' || !tag || !pattern) return false;
  if (tag === pattern) return true;
  const t = tag.includes(' ') ? tag.replace(/\s+/g, '_') : tag;
  const p = pattern.includes(' ') ? pattern.replace(/\s+/g, '_') : pattern;
  return (
    t === p ||
    t.startsWith(p + '_') ||
    t.endsWith('_' + p) ||
    t.includes('_' + p + '_')
  );
}

const ARCHIVE_EXTENSIONS = new Set([
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz',
  'cbz', 'cbr', 'cb7', 'cbt', 'zst'
]);

const ARCHIVE_REGEX = /\.(zip|rar|7z|tar|gz|bz2|xz|cbz|cbr|cb7|cbt|zst)$/i;

const NON_IMAGE_REGEX = /\.(mp4|webm|gif|mov|m4v|flv|avi|mkv|mp3|ogg|flac|wav|m4a|aac|opus|wma|zip|rar|7z|tar|gz|bz2|xz|cbz|cbr|cb7|cbt|zst)$/i;

/**
 * Determines whether a post represents a compressed archive (zip/rar/7z/tar/gz/cbz/cbr/etc.).
 */
export function isArchivePost(post) {
  if (!post || typeof post !== 'object') return false;
  if (post.isArchive) return true;
  if (Array.isArray(post.archiveUrls) && post.archiveUrls.length > 0) return true;

  if (typeof post.fileExt === 'string') {
    const ext = post.fileExt.trim().split(/[?#]/)[0].toLowerCase().replace(/^\.+/, '');
    if (ARCHIVE_EXTENSIONS.has(ext)) return true;
  }

  const fileUrl = typeof post.fileUrl === 'string' ? post.fileUrl.trim().split(/[?#]/)[0] : '';
  if (fileUrl && ARCHIVE_REGEX.test(fileUrl)) return true;

  const sampleUrl = typeof post.sampleUrl === 'string' ? post.sampleUrl.trim().split(/[?#]/)[0] : '';
  if (sampleUrl && ARCHIVE_REGEX.test(sampleUrl)) return true;

  return false;
}

export function getCriteriaSets(
  criteria,
  activeCurvyTags,
  activePetiteTags,
  activeFurryTags,
  activePregnantTags,
  activeLgbtTags,
  activeCurvyExcludeTags,
  activePetiteExcludeTags
) {
  const isObj = criteria !== null && typeof criteria === 'object';
  if (isObj) {
    const cached = criteriaSetsCache.get(criteria);
    if (cached) return cached;
  }

  const c = isObj ? criteria : {};

  // Dual-canonical normalization for blacklist: store both space and underscore forms
  const blacklistSet = new Set();
  const rawBlacklist = Array.isArray(c.blacklist)
    ? c.blacklist
    : (typeof c.blacklist === 'string' ? c.blacklist.split(/[,;\n]+/) : []);
  for (const b of rawBlacklist) {
    if (typeof b !== 'string') continue;
    const clean = b.toLowerCase().trim();
    if (!clean) continue;
    blacklistSet.add(clean);
    blacklistSet.add(clean.replace(/[\s_]+/g, ' '));
    blacklistSet.add(clean.replace(/[\s_]+/g, '_'));
  }

  // Resolve sources with fallbacks
  const rawCurvyInclude = activeCurvyTags ?? c.activeCurvyTags ?? c.curvyInclude ?? c.curvyTags ?? CURVY_INCLUDE_TAGS;
  const rawCurvyExclude = activeCurvyExcludeTags ?? c.activeCurvyExcludeTags ?? c.curvyExclude ?? c.curvyExcludeTags ?? CURVY_EXCLUDE_TAGS;
  const rawPetiteInclude = activePetiteTags ?? c.activePetiteTags ?? c.petiteInclude ?? c.petiteTags ?? PETITE_INCLUDE_TAGS;
  const rawPetiteExclude = activePetiteExcludeTags ?? c.activePetiteExcludeTags ?? c.petiteExclude ?? c.petiteExcludeTags ?? PETITE_EXCLUDE_TAGS;

  const rawFurry = activeFurryTags ?? c.activeFurryTags ?? c.furry ?? c.furryTags ?? FURRY_TAGS;
  const rawPregnant = activePregnantTags ?? c.activePregnantTags ?? c.pregnant ?? c.pregnantTags ?? PREGNANT_TAGS;
  const rawLgbt = activeLgbtTags ?? c.activeLgbtTags ?? c.lgbt ?? c.lgbtTags ?? LGBT_TAGS;

  const sets = {
    blacklist: blacklistSet,
    curvyInclude: toNormalizedTagSet(rawCurvyInclude, CURVY_INCLUDE_TAGS),
    curvyExclude: toNormalizedTagSet(rawCurvyExclude, CURVY_EXCLUDE_TAGS),
    petiteInclude: toNormalizedTagSet(rawPetiteInclude, PETITE_INCLUDE_TAGS),
    petiteExclude: toNormalizedTagSet(rawPetiteExclude, PETITE_EXCLUDE_TAGS),
    furry: normalizeTagList((Array.isArray(rawFurry) && rawFurry.length > 0) || (typeof rawFurry === 'string' && rawFurry.trim()) ? rawFurry : FURRY_TAGS),
    pregnant: normalizeTagList((Array.isArray(rawPregnant) && rawPregnant.length > 0) || (typeof rawPregnant === 'string' && rawPregnant.trim()) ? rawPregnant : PREGNANT_TAGS),
    lgbt: normalizeTagList((Array.isArray(rawLgbt) && rawLgbt.length > 0) || (typeof rawLgbt === 'string' && rawLgbt.trim()) ? rawLgbt : LGBT_TAGS)
  };

  if (isObj) {
    criteriaSetsCache.set(criteria, sets);
  }
  return sets;
}

export function isPostMatchingFilters(post, criteria = {}) {
  const safeCriteria = (criteria && typeof criteria === 'object') ? criteria : {};

  // Archive-only posts (zip packs) carry no direct media URLs until unpacked
  if (!post || (!isArchivePost(post) && !post.previewUrl && !post.fileUrl && !post.sampleUrl)) return false;

  const {
    typeFilter = 'all',
    ageFilter = 'all',
    aiFilter = 'no-ai',
    ratingFilter = 'all',
    hideFurry = false,
    hidePregnant = false,
    hideLgbt = false,
    negativeTokens = [],
    activeCurvyTags,
    activePetiteTags,
    activeFurryTags,
    activePregnantTags,
    activeLgbtTags,
    activeCurvyExcludeTags,
    activePetiteExcludeTags,
    hasUserPositiveTags = false
  } = safeCriteria;

  const sets = getCriteriaSets(
    safeCriteria,
    activeCurvyTags,
    activePetiteTags,
    activeFurryTags,
    activePregnantTags,
    activeLgbtTags,
    activeCurvyExcludeTags,
    activePetiteExcludeTags
  );

  // 1. Content type filter
  if (typeFilter === 'audio' || typeFilter === 'sound') {
    if (isArchivePost(post)) return false;
    if (!post.isVideo || !post.hasSound) return false;
  } else if (typeFilter === 'video') {
    if (isArchivePost(post)) return false;
    if (!post.isVideo && !post.isGif) return false;
  } else if (typeFilter === 'image') {
    if (post.isVideo || post.isGif || post.hasSound) return false;
    // Archive-flagged posts may still carry a cover image (mixed posts from
    // pawchive.js/kemono.js); only archive-only posts, which have nothing to
    // render, are dropped here.
    if (isArchivePost(post) && !post.previewUrl && !post.fileUrl && !post.sampleUrl) return false;
    const cleanFileUrl = typeof post.fileUrl === 'string' ? post.fileUrl.trim().split(/[?#]/)[0].toLowerCase() : '';
    const cleanSampleUrl = typeof post.sampleUrl === 'string' ? post.sampleUrl.trim().split(/[?#]/)[0].toLowerCase() : '';
    if (NON_IMAGE_REGEX.test(cleanFileUrl) || NON_IMAGE_REGEX.test(cleanSampleUrl)) {
      return false;
    }
    if (!post.fileUrl && !post.sampleUrl && !post.previewUrl) return false;
  } else if (typeFilter === 'zip' || typeFilter === 'archive') {
    if (!isArchivePost(post)) return false;
  }

  const rawPostTags = Array.isArray(post.tags)
    ? post.tags
    : (typeof post.tags === 'string' ? post.tags.split(/[\s,;\n]+/) : []);
  const postTagSet = new Set(
    rawPostTags
      .map(t => (typeof t === 'string' ? t.toLowerCase().trim() : ''))
      .filter(Boolean)
  );

  // 2. Local filtering by excluded (-tag) tags
  // Exact match against both spellings: negative tokens arrive space-separated
  // ("long blonde hair") while tags are stored underscored. Also handles leading '-'
  // and prefix wildcards ("bad*").
  if (negativeTokens && negativeTokens.length > 0) {
    let hidden = false;
    for (const rawNeg of negativeTokens) {
      if (!rawNeg || typeof rawNeg !== 'string') continue;
      let neg = rawNeg.toLowerCase().trim();
      if (neg.startsWith('-')) neg = neg.slice(1).trim();
      if (!neg) continue;

      if (neg.endsWith('*')) {
        const prefix = neg.slice(0, -1);
        if (prefix) {
          const prefixSpace = prefix.includes('_') ? prefix.replace(/_/g, ' ') : prefix;
          const prefixUnder = prefix.includes(' ') ? prefix.replace(/\s+/g, '_') : prefix;
          for (const t of postTagSet) {
            if (t.startsWith(prefix) || t.startsWith(prefixSpace) || t.startsWith(prefixUnder)) {
              hidden = true;
              break;
            }
          }
        }
      } else {
        if (postTagSet.has(neg)) { hidden = true; break; }
        if (neg.includes(' ') && postTagSet.has(neg.replace(/\s+/g, '_'))) { hidden = true; break; }
        if (neg.includes('_') && postTagSet.has(neg.replace(/_+/g, ' '))) { hidden = true; break; }
      }
      if (hidden) break;
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
  const r = (typeof post.rating === 'string' || typeof post.rating === 'number')
    ? String(post.rating).toLowerCase().trim()
    : '';
  const site = typeof post.site === 'string' ? post.site.toLowerCase().trim() : '';
  const isDanbooruOrGelbooru = site === 'danbooru' || site === 'gelbooru';

  if (ratingFilter === 'nsfw') {
    if (r !== 'e' && r !== 'explicit' && r !== '?') return false;
  } else if (ratingFilter === 'questionable' || ratingFilter === '16+') {
    if (isDanbooruOrGelbooru) {
      if (r !== 'q' && r !== 'questionable' && r !== 'sensitive' && r !== 's') return false;
    } else {
      if (r !== 'q' && r !== 'questionable' && r !== 'sensitive') return false;
    }
  } else if (ratingFilter === 'sfw') {
    // Danbooru and Gelbooru use a 4-level scale: 's' = sensitive (16+), only 'g' is safe there.
    // Other sites use the legacy scale where 's' = safe.
    if (isDanbooruOrGelbooru) {
      if (r !== 'g' && r !== 'general') return false;
    } else {
      if (r !== 's' && r !== 'g' && r !== 'safe' && r !== 'general') return false;
    }
  }

  // 6-8. Content filters (furry / pregnancy / LGBT)
  if (hideFurry || hidePregnant || hideLgbt) {
    const tagList = Array.from(postTagSet);
    if (hideFurry && sets.furry.some(fTag => tagList.some(t => matchesTagBoundary(t, fTag)))) return false;
    if (hidePregnant && sets.pregnant.some(pTag => tagList.some(t => matchesTagBoundary(t, pTag)))) return false;
    if (hideLgbt && sets.lgbt.some(lTag => tagList.some(t => matchesTagBoundary(t, lTag)))) return false;
  }

  // 8. Blacklist (Set - O(1) per tag)
  if (sets.blacklist.size > 0) {
    for (const t of postTagSet) {
      if (sets.blacklist.has(t)) return false;
      if (t.includes(' ') && sets.blacklist.has(t.replace(/\s+/g, '_'))) return false;
      if (t.includes('_') && sets.blacklist.has(t.replace(/_+/g, ' '))) return false;
    }
  }

  return true;
}

const aiTagsSetCache = new WeakMap();

export function checkIsAi(tagsArray, aiTagsList) {
  if (!Array.isArray(tagsArray)) return false;
  const source = (Array.isArray(aiTagsList) && aiTagsList.length > 0 ? aiTagsList : DEFAULT_AI_TAGS);
  let checkSet = aiTagsSetCache.get(source);
  if (!checkSet) {
    checkSet = new Set(source.map(t => (typeof t === 'string' ? t.toLowerCase().trim() : '')).filter(Boolean));
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
  const cleanUrl = typeof url === 'string' ? url.trim().split(/[?#]/)[0] : '';
  const cleanFileExt = typeof fileExt === 'string' ? fileExt.trim().split(/[?#]/)[0] : '';
  const lowerUrl = cleanUrl.toLowerCase();
  const lowerFileExt = cleanFileExt.toLowerCase();
  
  // 1. Extract the clean extension (no path, params, or stray dots)
  let ext = '';
  if (cleanFileExt) {
    const dotIdx = cleanFileExt.lastIndexOf('.');
    if (dotIdx !== -1) {
      ext = cleanFileExt.slice(dotIdx + 1).toLowerCase();
    } else if (cleanFileExt.length <= 5 && !cleanFileExt.includes('/') && !cleanFileExt.includes('\\')) {
      ext = cleanFileExt.toLowerCase();
    }
  }
  if (!ext && cleanUrl) {
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

const LOCATION_NOUNS = new Set([
  'window', 'bed', 'door', 'river', 'sea', 'ocean', 'water', 'pool', 'tree', 'trees',
  'wall', 'mirror', 'table', 'chair', 'couch', 'sofa', 'fireplace', 'fence', 'stairs',
  'beach', 'lake', 'road', 'car', 'counter', 'railing', 'pole', 'curtain', 'pillar',
  'bridge', 'balcony', 'desk', 'bookshelf', 'shelf', 'sink', 'bathtub', 'shower',
  'cliff', 'rock', 'forest', 'field', 'grass', 'bench', 'steps', 'gate', 'street'
]);

export function extractAuthor(rawTags = [], source = '', itemAuthor = '') {
  let tags = [];
  if (Array.isArray(rawTags)) {
    tags = rawTags.filter(t => typeof t === 'string' && t.length > 0);
  } else if (typeof rawTags === 'string' && rawTags.trim()) {
    tags = rawTags.split(/[,;\s]+/).filter(Boolean);
  }
  
  // 1. Look in explicit artist tags
  const explicitArtistTags = tags.filter(t => 
    t.startsWith('artist:') || t.startsWith('creator:') || t.startsWith('author:') || t.startsWith('draw:')
  ).map(t => t.replace(/^(artist|creator|author|draw):/, ''));
  if (explicitArtistTags.length > 0) {
    return explicitArtistTags.join(', ');
  }

  // 2. Look for tags with special markers: name_(artist), name_(creator), by_name, etc.
  const markerArtistTags = tags.filter(t => {
    const low = t.toLowerCase();
    if (low.endsWith('_(artist)') || low.endsWith('_(creator)') || low.endsWith('_(circle)') || low.endsWith('_(studio)') || low.endsWith('_(animator)') || low.endsWith('_(voice_actor)') || low.endsWith('_(voice)') || low.endsWith('_(va)')) return true;
    if (low.startsWith('by_')) {
      const cand = low.slice(3).trim();
      return !LOCATION_NOUNS.has(cand) && cand.length > 2;
    }
    return false;
  }).map(t => t.replace(/_?\((artist|creator|circle|studio|animator|voice_actor|voice|va)\)$/i, '').replace(/^by_/, ''));
  if (markerArtistTags.length > 0) {
    return markerArtistTags.join(', ');
  }

  // 3. Extract the author from the source URL or source text
  if (source && typeof source === 'string') {
    const s = source.trim()
      .replace(/\s*\(\.\)\s*/g, '.')
      .replace(/\s*\[\.\]\s*/g, '.');
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
    const pixivLegacyMatch = s.match(/pixiv\.net\/member\.php\?id=(\d+)/i);
    if (pixivLegacyMatch) {
      return `pixiv:${pixivLegacyMatch[1]}`;
    }
    const fediverseMatch = s.match(/(?:pawoo\.net|misskey\.io|baraag\.net)\/@([a-zA-Z0-9_.-]+)/i);
    if (fediverseMatch) {
      return `@${fediverseMatch[1]}`;
    }
    const artstationMatch = s.match(/artstation\.com\/([a-zA-Z0-9_-]+)/i);
    if (artstationMatch && !['artwork', 'projects', 'artist'].includes(artstationMatch[1].toLowerCase())) {
      return artstationMatch[1];
    }
    const deviantArtMatch = s.match(/deviantart\.com\/([a-zA-Z0-9_-]+)/i) || s.match(/([a-zA-Z0-9_-]+)\.deviantart\.com/i);
    if (deviantArtMatch && !['art', 'tag', 'topic', 'view', 'www'].includes(deviantArtMatch[1].toLowerCase())) {
      return deviantArtMatch[1];
    }
    const furAffinityMatch = s.match(/furaffinity\.net\/user\/([a-zA-Z0-9_-]+)/i);
    if (furAffinityMatch) {
      return furAffinityMatch[1];
    }
    const inkbunnyMatch = s.match(/inkbunny\.net\/([a-zA-Z0-9_-]+)/i);
    if (inkbunnyMatch && !['submissions', 'gallery', 'pool', 'search'].includes(inkbunnyMatch[1].toLowerCase())) {
      return inkbunnyMatch[1];
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
    const subStarMatch = s.match(/subscribestar\.(?:adult|com)\/([a-zA-Z0-9_-]+)/i);
    if (subStarMatch) {
      return subStarMatch[1];
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
    const redditUserMatch = s.match(/reddit\.com\/user\/([a-zA-Z0-9_-]+)/i);
    if (redditUserMatch) {
      return `reddit:${redditUserMatch[1]}`;
    }
    const civitaiMatch = s.match(/civitai\.com\/user\/([a-zA-Z0-9_-]+)/i);
    if (civitaiMatch) {
      return civitaiMatch[1];
    }
    const weiboMatch = s.match(/weibo\.(?:com|cn)\/(?:u\/)?([a-zA-Z0-9_]+)/i);
    if (weiboMatch && !['p', 'status', 'u', 'home'].includes(weiboMatch[1].toLowerCase())) {
      return weiboMatch[1];
    }

    // Text source with circle / artist in brackets: e.g. (C82) [T2 ART WORKS (Tony)] Title
    const bracketMatch = s.match(/\[([^\]]+)\]/);
    if (bracketMatch) {
      const candidate = bracketMatch[1].trim();
      const parenArtist = candidate.match(/\(([^)]+)\)$/);
      if (parenArtist && parenArtist[1].length >= 2) {
        return parenArtist[1].trim();
      }
      if (candidate.length >= 2 && candidate.length <= 35) {
        return candidate;
      }
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
  let tags = [];
  if (Array.isArray(rawTags)) {
    tags = rawTags.filter(t => typeof t === 'string' && t.length > 0);
  } else if (typeof rawTags === 'string' && rawTags.trim()) {
    tags = rawTags.split(/[,;\s]+/).filter(Boolean);
  }
  const artist = [];
  const character = [];
  const copyright = [];
  const meta = [];
  const general = [];

  const addUnique = (arr, val) => {
    if (val && !arr.includes(val)) arr.push(val);
  };

  if (typeof author === 'string' && author.trim()) {
    author.split(',').forEach(a => {
      const clean = a.trim().replace(/^(?:@|pixiv:)+/i, '').replace(/\s+/g, '_');
      if (clean && !LOCATION_NOUNS.has(clean.toLowerCase())) addUnique(artist, clean);
    });
  }

  for (const tag of tags) {
    if (!tag) continue;
    const originalTag = String(tag).trim();
    const lower = originalTag.toLowerCase();

    if (lower.startsWith('artist:') || lower.startsWith('creator:') || lower.startsWith('author:') || lower.startsWith('draw:') || lower.startsWith('channel:') || lower.startsWith('uploader:')) {
      const clean = originalTag.replace(/^(artist|creator|author|draw|channel|uploader):/i, '').trim();
      addUnique(artist, clean || originalTag);
      continue;
    }

    if (lower.startsWith('by_')) {
      const candidate = lower.slice(3).trim();
      if (!LOCATION_NOUNS.has(candidate) && candidate.length > 2) {
        addUnique(artist, originalTag.slice(3).trim());
        continue;
      }
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

export function adaptTagsForSite(site, rawTags = '', ageFilter = 'all', typeFilter = 'all', settings = null) {
  let tags = '';
  if (typeof rawTags === 'string') {
    tags = rawTags.trim();
  } else if (Array.isArray(rawTags)) {
    tags = rawTags
      .filter(t => typeof t === 'string')
      .map(t => t.trim())
      .filter(Boolean)
      .join(' ');
  } else if (rawTags != null && typeof rawTags !== 'symbol') {
    tags = String(rawTags).trim();
  }

  const normalizedSite = typeof site === 'string' ? site.toLowerCase() : '';

  // 0. Resolve author and tag aliases specific to the target booru engine
  if (tags) {
    tags = resolveQueryTagsForSite(tags, normalizedSite, settings);
  }

  // 1. Tag adaptation: convert parentheses into search phrases for Rule34Video
  if (normalizedSite === 'rule34video' && tags) {
    tags = tags.replace(/([a-zA-Z0-9_-]+)_\(([^)]+)\)/g, '$1 $2');
    tags = tags.replace(/([a-zA-Z0-9_-]+)\s*\(([^)]+)\)/g, '$1 $2');
    tags = tags.replace(/[()]/g, '');
  }

  // 2. Tag aliases for Danbooru compatibility
  if (normalizedSite === 'gelbooru' || normalizedSite === 'rule34' || normalizedSite === 'safebooru' || normalizedSite === 'yandere' || normalizedSite === 'konachan' || normalizedSite === 'rule34video' || normalizedSite === 'xbooru' || normalizedSite === 'hypnohub' || normalizedSite === 'tbib') {
    tags = tags.replace(/\bpetite\b/gi, 'small_breasts');
  }

  // 2.5 Strip category prefixes for DAPI engines that do not support them (e.g. artist:tag -> tag)
  if (normalizedSite === 'xbooru' || normalizedSite === 'hypnohub' || normalizedSite === 'tbib' || normalizedSite === 'safebooru') {
    tags = tags.replace(/(?:^|\s)(?:artist|character|copyright|meta):\s*/gi, m => m.startsWith(' ') ? ' ' : '');
  }

  // 3. Adapt sort directives (order:* <-> sort:*) between engines
  if (normalizedSite === 'rule34' || normalizedSite === 'gelbooru' || normalizedSite === 'safebooru' || normalizedSite === 'xbooru' || normalizedSite === 'hypnohub' || normalizedSite === 'tbib') {
    tags = tags
      .replace(/\border:score_desc\b/gi, 'sort:score:desc')
      .replace(/\border:score\b/gi, 'sort:score:desc')
      .replace(/\border:rank\b/gi, normalizedSite === 'gelbooru' ? 'sort:updated:desc' : 'sort:score:desc')
      .replace(/\border:vote\b/gi, 'sort:score:desc')
      .replace(/\border:random\b/gi, 'sort:random')
      .replace(/\border:id_desc\b/gi, 'sort:id:desc')
      .replace(/\border:id_asc\b/gi, 'sort:id:asc')
      .replace(/\border:score_asc\b/gi, 'sort:score:asc');
  } else if (normalizedSite === 'danbooru' || normalizedSite === 'yandere' || normalizedSite === 'konachan') {
    tags = tags
      .replace(/\bsort:score:desc\b/gi, 'order:score')
      .replace(/\bsort:score:asc\b/gi, 'order:score_asc')
      .replace(/\bsort:score\b/gi, 'order:score')
      .replace(/\bsort:random\b/gi, 'order:random')
      .replace(/\bsort:id:desc\b/gi, 'order:id_desc')
      .replace(/\bsort:id_asc\b/gi, 'order:id_asc')
      .replace(/\bsort:updated:desc\b/gi, normalizedSite === 'danbooru' ? 'order:rank' : 'order:vote');
  }

  const tagList = tags.split(/\s+/).filter(Boolean);

  // 4. Mix in body type / archetype tags
  if (ageFilter === 'adult') {
    if (normalizedSite === 'rule34' || normalizedSite === 'gelbooru' || normalizedSite === 'yandere' || normalizedSite === 'konachan' || normalizedSite === 'safebooru' || normalizedSite === 'xbooru' || normalizedSite === 'hypnohub' || normalizedSite === 'tbib') {
      if (!tagList.some(t => t.startsWith('-loli'))) tagList.push('-loli');
      if (!tagList.some(t => t.startsWith('-shota'))) tagList.push('-shota');
      if (!tagList.some(t => t.startsWith('-flat_chest'))) tagList.push('-flat_chest');
    }
    if (tagList.length === 0) {
      if (normalizedSite === 'rule34' || normalizedSite === 'gelbooru' || normalizedSite === 'safebooru' || normalizedSite === 'xbooru' || normalizedSite === 'hypnohub' || normalizedSite === 'tbib') {
        tagList.push('mature_female');
      } else if (normalizedSite === 'yandere' || normalizedSite === 'konachan') {
        tagList.push('mature');
      }
    }
  } else if (ageFilter === 'young') {
    if (normalizedSite === 'rule34' || normalizedSite === 'gelbooru' || normalizedSite === 'yandere' || normalizedSite === 'konachan' || normalizedSite === 'safebooru' || normalizedSite === 'xbooru' || normalizedSite === 'hypnohub' || normalizedSite === 'tbib') {
      if (!tagList.some(t => t.startsWith('-milf'))) tagList.push('-milf');
      if (!tagList.some(t => t.startsWith('-huge_breasts'))) tagList.push('-huge_breasts');
    }
    if (tagList.length === 0) {
      if (normalizedSite === 'rule34' || normalizedSite === 'gelbooru' || normalizedSite === 'safebooru' || normalizedSite === 'xbooru' || normalizedSite === 'hypnohub' || normalizedSite === 'tbib') {
        tagList.push('small_breasts');
      } else if (normalizedSite === 'yandere' || normalizedSite === 'konachan') {
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
