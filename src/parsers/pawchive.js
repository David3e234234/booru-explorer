import { safeJsonParse, fetchSafe, resolvePreviewUrl } from '../utils/network.js';
import { checkIsAi, checkMediaTypes, normalizeDate } from '../utils/tagHelpers.js';
import { classifyPostTags } from '../utils/tagClassifier.js';
import { isVideoMediaUrl } from '../../public/js/modules/uiUtils.js';
import { logError } from '../utils/logger.js';

let creatorsCache = null;
let creatorsCacheTime = 0;
const CREATORS_CACHE_TTL = 3600 * 1000; // 1 hour

const PAWCHIVE_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']);
const PAWCHIVE_VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v']);

function isPawchiveVisualMedia(nameOrPath) {
  if (!nameOrPath) return false;
  const ext = nameOrPath.split('?')[0].split('.').pop()?.toLowerCase();
  return PAWCHIVE_IMAGE_EXTS.has(ext) || PAWCHIVE_VIDEO_EXTS.has(ext);
}

const STOP_TITLE_WORDS = new Set([
  'psd', 'clip', 'sai', 'c4d', 'blend', 'zip', 'rar', '7z', 'tar', 'r18', 'nsfw', 'sfw', 
  'reward', 'pack', 'tier', 'wip', 'sketch', 'vol', 'part', 'set', 'ver', 'version', 
  'alt', 'the', 'and', 'for', 'with', 'from', 'free', 'fanbox', 'patreon', 'fantia', 'boosty'
]);

/**
 * Fetches and caches creator directory from Pawchive
 */
export async function getCreatorsDirectory() {
  const now = Date.now();
  if (creatorsCache && (now - creatorsCacheTime) < CREATORS_CACHE_TTL) {
    return creatorsCache;
  }
  try {
    const res = await fetchSafe('https://pawchive.pw/api/v1/creators', { timeout: 10000 });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        const creatorMap = new Map();
        for (const c of data) {
          if (c && c.service && c.id) {
            creatorMap.set(`${c.service}:${c.id}`, c);
          }
        }
        creatorsCache = { list: data, map: creatorMap };
        creatorsCacheTime = now;
        return creatorsCache;
      }
    }
  } catch (err) {
    logError('Pawchive', 'Failed to load creators list', err);
  }
  return creatorsCache || { list: [], map: new Map() };
}

/**
 * Resolves an author name or query to Pawchive creator { service, user, name }
 */
export async function resolvePawchiveAuthor(authorQuery) {
  if (!authorQuery) return null;
  const clean = authorQuery
    .replace(/^(?:creator|artist|author|user|uploader):\s*/i, '')
    .replace(/[_+]+/g, ' ')
    .trim();
  if (!clean) return null;

  const { list } = await getCreatorsDirectory();
  if (!list || list.length === 0) return null;

  const cleanLower = clean.toLowerCase();
  const cleanNoSpace = cleanLower.replace(/[\s_.-]+/g, '');

  // Exact name match first
  let match = list.find(c => (c.name || '').toLowerCase() === cleanLower);
  if (!match) {
    // Normalized no-space match
    match = list.find(c => (c.name || '').toLowerCase().replace(/[\s_.-]+/g, '') === cleanNoSpace);
  }
  if (!match) {
    // ID match or contains match
    match = list.find(c => String(c.id) === clean || (c.name || '').toLowerCase().includes(cleanLower));
  }

  if (match) {
    return {
      service: match.service,
      user: match.id,
      name: match.name
    };
  }
  return null;
}

/**
 * Normalizes a single Pawchive post item into standard BooruExp post structure
 */
export async function normalizePawchivePost(item, creatorMap, resolvedCreator, aiTagsList = []) {
  if (!item || !item.id) return null;

  // Filter attachments to valid visual media (exclude zips, psds, etc.)
  const validAttachments = Array.isArray(item.attachments)
    ? item.attachments.filter(a => a && a.path && isPawchiveVisualMedia(a.name || a.path))
    : [];

  const mediaFiles = [];
  if (item.file && item.file.path) {
    const isCoverMedia = isPawchiveVisualMedia(item.file.name || item.file.path) || Boolean(item.file.preview_only || item.has_full === false);
    if (isCoverMedia) {
      mediaFiles.push(item.file);
    }
  }

  for (const att of validAttachments) {
    if (!mediaFiles.some(m => m.path === att.path)) {
      mediaFiles.push(att);
    }
  }

  // Fallback if no media matched regex but file/attachments exist
  if (mediaFiles.length === 0) {
    if (item.file && item.file.path) {
      mediaFiles.push(item.file);
    } else if (validAttachments.length > 0) {
      mediaFiles.push(...validAttachments);
    } else if (Array.isArray(item.attachments) && item.attachments.length > 0 && item.attachments[0]?.path) {
      mediaFiles.push(item.attachments[0]);
    } else {
      return null;
    }
  }

  const creatorInfo = creatorMap ? creatorMap.get(`${item.service}:${item.user}`) : null;
  const authorName = creatorInfo ? creatorInfo.name : (resolvedCreator?.name || `user_${item.user}`);
  const authorTag = authorName.toLowerCase().replace(/[\s_.-]+/g, '_');
  const postUrl = `https://pawchive.pw/${item.service}/user/${item.user}/post/${item.id}`;

  // Extract tags from service, creator name, and words in title
  const extractedTags = [
    item.service || 'pawchive',
    `user_${item.user}`,
    `artist:${authorTag}`
  ];
  if (authorTag && !extractedTags.includes(authorTag)) {
    extractedTags.push(authorTag);
  }

  if (item.title) {
    const titleWords = item.title
      .replace(/[^\p{L}\p{N}_]+/gu, ' ')
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_TITLE_WORDS.has(w));
    for (const w of titleWords.slice(0, 10)) {
      if (!extractedTags.includes(w)) extractedTags.push(w);
    }
  }

  const isAi = checkIsAi(extractedTags, aiTagsList);
  const { tagDetails } = await classifyPostTags(extractedTags, postUrl, authorName);
  tagDetails.artist = [authorName];
  const createdAt = normalizeDate(item.published || item.added);

  const seriesKey = `pawchive:${item.service}:${item.user}:${item.id}`;
  const allSeriesKeys = [seriesKey, `${item.service}:${item.id}`];

  // Build complete albumItems array for all visual slides
  const albumItems = mediaFiles.map((m, idx) => {
    const rawFileName = m.name || `file_${idx + 1}`;
    const isVid = isVideoMediaUrl(rawFileName) || /\.(mp4|webm|mov|m4v)$/i.test(rawFileName || m.path);
    const isGif = (rawFileName || m.path || '').toLowerCase().endsWith('.gif');
    const isPrevOnly = Boolean(m.preview_only || item.has_full === false);
    const fileExt = (rawFileName || m.path || '').split('.').pop()?.toLowerCase() || (isVid ? 'mp4' : 'jpg');
    const fileUrl = isPrevOnly
      ? `https://img.pawchive.pw/thumbnail/data${m.path}`
      : `https://file.pawchive.pw/data${m.path}?f=${encodeURIComponent(rawFileName)}`;
    const previewUrlRaw = `https://img.pawchive.pw/thumbnail/data${m.path}`;
    const sampleUrl = isPrevOnly ? previewUrlRaw : fileUrl;
    const previewUrl = resolvePreviewUrl(previewUrlRaw, fileUrl, sampleUrl, isVid);

    return {
      id: `pawchive_${item.id}_${idx + 1}`,
      originalId: `${item.id}_${idx + 1}`,
      site: 'pawchive',
      siteName: 'Pawchive',
      previewUrl,
      sampleUrl,
      fileUrl,
      thumb180: previewUrl,
      thumb360: previewUrl,
      thumb720: previewUrl,
      fileExt,
      isVideo: isVid,
      isGif,
      hasSound: false,
      author: authorName,
      title: item.title || '',
      tags: extractedTags,
      tagDetails,
      score: 0,
      rating: 'e',
      width: 0,
      height: 0,
      source: postUrl,
      postUrl,
      parentId: `pawchive_${item.id}`,
      createdAt,
      isAi
    };
  });

  const mainMedia = albumItems[0];
  const hasMultiple = albumItems.length > 1;

  return {
    id: `pawchive_${item.id}`,
    originalId: String(item.id),
    site: 'pawchive',
    siteName: 'Pawchive',
    previewUrl: mainMedia.previewUrl,
    sampleUrl: mainMedia.sampleUrl,
    fileUrl: mainMedia.fileUrl,
    thumb180: mainMedia.thumb180,
    thumb360: mainMedia.thumb360,
    thumb720: mainMedia.thumb720,
    fileExt: mainMedia.fileExt,
    isVideo: mainMedia.isVideo,
    isGif: mainMedia.isGif,
    hasSound: mainMedia.hasSound,
    author: authorName,
    title: item.title || '',
    tags: extractedTags,
    tagDetails,
    score: 0,
    rating: 'e',
    width: 0,
    height: 0,
    source: postUrl,
    postUrl,
    parentId: null,
    hasChildren: hasMultiple,
    isAlbum: hasMultiple,
    albumCount: albumItems.length,
    albumItems: hasMultiple ? albumItems : undefined,
    seriesKey: hasMultiple ? seriesKey : (allSeriesKeys[0] || null),
    allSeriesKeys,
    canFetchAlbum: hasMultiple,
    createdAt,
    isAi
  };
}

/**
 * Fetches single Pawchive post by ID and service/user
 */
export async function fetchPawchivePostById(postId, service, user, aiTagsList = [], settings = {}) {
  if (!postId) return null;
  try {
    let targetService = service;
    let targetUser = user;

    if (!targetService || !targetUser) {
      const { list } = await getCreatorsDirectory();
      // If service or user missing, try searching
      const resSearch = await fetchSafe(`https://pawchive.pw/api/v1/posts?q=${encodeURIComponent(postId)}`, { timeout: 10000 });
      if (resSearch.ok) {
        const found = await resSearch.json();
        const p = Array.isArray(found) ? found.find(x => String(x.id) === String(postId)) : null;
        if (p) {
          targetService = p.service;
          targetUser = p.user;
        }
      }
    }

    if (!targetService || !targetUser) return null;

    const url = `https://pawchive.pw/api/v1/${targetService}/user/${targetUser}/post/${postId}`;
    const res = await fetchSafe(url, { timeout: 10000 });
    if (!res.ok) return null;
    const item = await res.json();
    if (!item || !item.id) return null;

    const { map: creatorMap } = await getCreatorsDirectory();
    return await normalizePawchivePost(item, creatorMap, null, aiTagsList);
  } catch (err) {
    logError('Pawchive', `Failed to fetch post ${postId}`, err);
    return null;
  }
}

/**
 * Fetches posts from Pawchive API
 */
export async function fetchPawchive(params, aiTagsList, settings) {
  const { tags = '', page = 1, limit = 40, ratingFilter = 'all', typeFilter = 'all' } = params;

  if (ratingFilter === 'sfw') {
    return [];
  }

  const offset = Math.max(0, (page - 1) * 50);

  // Parse query tags for creator or service filters
  const tokens = (tags || '').split(/\s+/).filter(Boolean);
  let serviceFilter = null;
  let userFilter = null;
  let authorQuery = null;
  const searchKeywords = [];

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower.startsWith('service:')) {
      serviceFilter = token.substring(8).trim().toLowerCase();
    } else if (lower.startsWith('user:')) {
      userFilter = token.substring(5).trim();
    } else if (lower.startsWith('artist:') || lower.startsWith('author:') || lower.startsWith('creator:')) {
      authorQuery = token.replace(/^(?:artist|author|creator):/i, '').trim();
    } else if (!token.startsWith('-') && !token.includes(':')) {
      searchKeywords.push(token);
    }
  }

  // Attempt author resolution if authorQuery is given or if single keyword might match a creator
  let resolvedCreator = null;
  if (authorQuery) {
    resolvedCreator = await resolvePawchiveAuthor(authorQuery);
  } else if (searchKeywords.length === 1 && !serviceFilter && !userFilter) {
    const candidate = await resolvePawchiveAuthor(searchKeywords[0]);
    if (candidate && candidate.name.toLowerCase().replace(/[\s_.-]+/g, '') === searchKeywords[0].toLowerCase().replace(/[\s_.-]+/g, '')) {
      resolvedCreator = candidate;
    }
  }

  let apiUrl = '';
  if (resolvedCreator) {
    apiUrl = `https://pawchive.pw/api/v1/${resolvedCreator.service}/user/${resolvedCreator.user}/posts?o=${offset}`;
  } else if (serviceFilter && userFilter) {
    apiUrl = `https://pawchive.pw/api/v1/${serviceFilter}/user/${userFilter}/posts?o=${offset}`;
  } else if (searchKeywords.length > 0) {
    const qStr = searchKeywords.join(' ');
    apiUrl = `https://pawchive.pw/api/v1/posts?q=${encodeURIComponent(qStr)}&o=${offset}`;
  } else {
    apiUrl = `https://pawchive.pw/api/v1/posts?o=${offset}`;
  }

  try {
    const res = await fetchSafe(apiUrl, { timeout: 15000 });
    if (!res.ok) return [];
    const text = await res.text();
    const data = safeJsonParse(text, []);
    const items = Array.isArray(data) ? data : [];

    if (items.length === 0) return [];

    const { map: creatorMap } = await getCreatorsDirectory();

    const results = await Promise.all(items.map(async item => {
      return await normalizePawchivePost(item, creatorMap, resolvedCreator, aiTagsList);
    }));

    let validPosts = results.filter(Boolean);

    if (typeFilter === 'video') {
      validPosts = validPosts.filter(p => p.isVideo);
    } else if (typeFilter === 'image') {
      validPosts = validPosts.filter(p => !p.isVideo);
    }

    return validPosts;
  } catch (err) {
    logError('Pawchive', 'Error fetching posts from Pawchive', err);
    return [];
  }
}
