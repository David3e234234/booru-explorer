import { safeJsonParse, fetchSafe, resolvePreviewUrl } from '../utils/network.js';
import { checkIsAi, checkMediaTypes, normalizeDate } from '../utils/tagHelpers.js';
import { classifyPostTags } from '../utils/tagClassifier.js';
import { isVideoMediaUrl } from '../../public/js/modules/uiUtils.js';
import { logError } from '../utils/logger.js';

let creatorsCache = null;
let creatorsCacheTime = 0;
const CREATORS_CACHE_TTL = 3600 * 1000; // 1 hour

const PAWCHIVE_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp']);
const PAWCHIVE_VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi', 'wmv', 'flv', 'ts']);
const PAWCHIVE_ARCHIVE_EXTS = new Set(['zip', 'rar', '7z']);

// The global feed (/api/v1/posts) has no server-side service filter, so a
// platform filter is applied by scanning a window of raw pages client-side.
const PAWCHIVE_RAW_PAGE_SIZE = 50;
const PAWCHIVE_SERVICE_SCAN_PAGES = 3;
// The API starts returning 429 after ~4-5 rapid requests, so pace the scan
const PAWCHIVE_SERVICE_SCAN_DELAY_MS = 400;
const PAWCHIVE_FALLBACK_SERVICES = ['patreon', 'fanbox'];

function isPawchiveVisualMedia(nameOrPath) {
  if (!nameOrPath) return false;
  const ext = nameOrPath.split('?')[0].split('.').pop()?.toLowerCase();
  return PAWCHIVE_IMAGE_EXTS.has(ext) || PAWCHIVE_VIDEO_EXTS.has(ext);
}

function isPawchiveArchive(nameOrPath) {
  if (!nameOrPath) return false;
  const ext = nameOrPath.split('?')[0].split('.').pop()?.toLowerCase();
  return PAWCHIVE_ARCHIVE_EXTS.has(ext);
}

function buildArchiveFields(archiveAttachments) {
  if (!archiveAttachments || archiveAttachments.length === 0) return {};
  return {
    isArchive: true,
    archiveUrls: archiveAttachments.map(a => `https://file.pawchive.pw/data${a.path}?f=${encodeURIComponent(a.name || (a.path ? a.path.split('/').pop() : 'file'))}`),
    archiveNames: archiveAttachments.map(a => a.name || (a.path ? a.path.split('/').pop() : 'file')),
    archiveSizes: archiveAttachments.map(a => a.size || 0)
  };
}

const STOP_TITLE_WORDS = new Set([
  'psd', 'clip', 'sai', 'c4d', 'blend', 'zip', 'rar', '7z', 'tar', 'r18', 'nsfw', 'sfw', 
  'reward', 'pack', 'tier', 'wip', 'sketch', 'vol', 'part', 'set', 'ver', 'version', 
  'alt', 'the', 'and', 'for', 'with', 'from', 'free', 'fanbox', 'patreon', 'fantia', 'boosty'
]);

/**
 * Fetches and caches creator directory from Pawchive.
 * The payload is ~12 MB, so on flaky links the first connect attempt often
 * times out - retry once with a generous timeout instead of silently
 * degrading author resolution to an empty directory.
 */
export async function getCreatorsDirectory(settings = {}) {
  const now = Date.now();
  if (creatorsCache && (now - creatorsCacheTime) < CREATORS_CACHE_TTL) {
    return creatorsCache;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchSafe('https://pawchive.pw/api/v1/creators', { timeout: 30000, settings, site: 'pawchive' });
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
          creatorsCacheTime = Date.now();
          return creatorsCache;
        }
      }
      break; // got a response (non-ok / bad shape): retrying won't help
    } catch (err) {
      if (attempt === 0) continue; // transient connect failure: retry once
      logError('Pawchive', 'Failed to load creators list', err);
    }
  }
  return creatorsCache || { list: [], map: new Map() };
}

/**
 * Returns Pawchive platforms (services) that currently have creators,
 * sorted by creator count desc. Feeds the client-side platform dropdown.
 */
export async function getPawchiveServices() {
  try {
    const { list } = await getCreatorsDirectory();
    if (Array.isArray(list) && list.length > 0) {
      const counts = new Map();
      for (const c of list) {
        const svc = (c && c.service ? String(c.service) : '').toLowerCase();
        if (svc) counts.set(svc, (counts.get(svc) || 0) + 1);
      }
      if (counts.size > 0) {
        return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([svc]) => svc);
      }
    }
  } catch (err) {
    logError('Pawchive', 'Failed to load services list', err);
  }
  return [...PAWCHIVE_FALLBACK_SERVICES];
}

/**
 * Resolves an author name or query to Pawchive creator { service, user, name }.
 * When preferredService is given, each match stage first looks on that platform
 * (the same name can exist on several services with different content), then
 * falls back to any service.
 */
export async function resolvePawchiveAuthor(authorQuery, preferredService = null) {
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
  const preferred = preferredService ? String(preferredService).toLowerCase() : null;

  const findBy = (pred) => {
    if (preferred) {
      const inPreferred = list.find(c => (c.service || '').toLowerCase() === preferred && pred(c));
      if (inPreferred) return inPreferred;
    }
    return list.find(pred);
  };

  // Exact name match first
  let match = findBy(c => (c.name || '').toLowerCase() === cleanLower);
  if (!match) {
    // Normalized no-space match
    match = findBy(c => (c.name || '').toLowerCase().replace(/[\s_.-]+/g, '') === cleanNoSpace);
  }
  if (!match) {
    // ID match or contains match
    match = findBy(c => String(c.id) === clean || (c.name || '').toLowerCase().includes(cleanLower));
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

  // Collect all non-visual downloadable attachments (zips, clips, psds, blends, etc.)
  const allRawAttachments = Array.isArray(item.attachments) ? [...item.attachments] : [];
  if (item.file && item.file.path && !isPawchiveVisualMedia(item.file.name || item.file.path)) {
    if (!allRawAttachments.some(a => a.path === item.file.path)) {
      allRawAttachments.unshift(item.file);
    }
  }

  // Non-visual downloadable attachments
  const archiveAttachments = allRawAttachments.filter(a => a && a.path && !isPawchiveVisualMedia(a.name || a.path));

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

  if (mediaFiles.length === 0 && archiveAttachments.length === 0) return null;

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
  const { tagDetails } = await classifyPostTags(extractedTags, postUrl, authorName, settings);
  tagDetails.artist = [authorName];
  const createdAt = normalizeDate(item.published || item.added);

  const seriesKey = `pawchive:${item.service}:${item.user}:${item.id}`;
  const allSeriesKeys = [seriesKey, `${item.service}:${item.id}`];

  // Posts with zip/rar attachments carry archive fields in both branches:
  // the viewer unpacks archiveUrls on open, whether or not the post also
  // has a cover image / playable slides.
  const archiveFields = buildArchiveFields(archiveAttachments);

  // Archive-only post: no playable slides, the viewer unpacks archiveUrls on open
  if (mediaFiles.length === 0) {
    return {
      id: `pawchive_${item.id}`,
      originalId: String(item.id),
      site: 'pawchive',
      siteName: 'Pawchive',
      previewUrl: '',
      sampleUrl: '',
      fileUrl: '',
      thumb180: '',
      thumb360: '',
      thumb720: '',
      fileExt: 'zip',
      isVideo: false,
      isGif: false,
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
      parentId: null,
      hasChildren: false,
      isAlbum: false,
      albumCount: 0,
      seriesKey,
      allSeriesKeys,
      canFetchAlbum: false,
      createdAt,
      isAi,
      ...archiveFields
    };
  }

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

  // Video-first cover: if the post contains a video, promote the first video slide
  // to the cover so card badges, hover preview, duration probing, the "video" type
  // filter and duration sort all treat the post as a video. Reordering the built
  // items keeps each slide's own id/originalId stable.
  const firstVideoIdx = albumItems.findIndex(i => i.isVideo);
  if (firstVideoIdx > 0) {
    const [videoItem] = albumItems.splice(firstVideoIdx, 1);
    albumItems.unshift(videoItem);
  }

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
    isAi,
    ...archiveFields
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
      const { list } = await getCreatorsDirectory(settings);
      // If service or user missing, try searching
      const resSearch = await fetchSafe(`https://pawchive.pw/api/v1/posts?q=${encodeURIComponent(postId)}`, { timeout: 10000, settings, site: 'pawchive' });
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
    const res = await fetchSafe(url, { timeout: 10000, settings, site: 'pawchive' });
    if (!res.ok) return null;
    const item = await res.json();
    if (!item || !item.id) return null;

    const { map: creatorMap } = await getCreatorsDirectory(settings);
    return await normalizePawchivePost(item, creatorMap, null, aiTagsList, settings);
  } catch (err) {
    logError('Pawchive', `Failed to fetch post ${postId}`, err);
    return null;
  }
}

/**
 * Fetches posts from Pawchive API
 */
export async function fetchPawchive(params, aiTagsList, settings = {}) {
  const { tags = '', page = 1, limit = 40, ratingFilter = 'all', typeFilter = 'all', pawchiveService = '' } = params;

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

  // Platform dropdown value (explicit UI choice) overrides the service: token
  const dropdownService = String(pawchiveService || '').trim().toLowerCase();
  if (/^[a-z0-9_-]+$/.test(dropdownService)) {
    serviceFilter = dropdownService;
  }

  // Attempt author resolution if authorQuery is given or if single keyword might match a creator.
  // The selected platform is passed as a preference: the same author name can exist
  // on several services with different content.
  let resolvedCreator = null;
  if (authorQuery) {
    resolvedCreator = await resolvePawchiveAuthor(authorQuery, serviceFilter);
  } else if (searchKeywords.length === 1 && !userFilter) {
    const candidate = await resolvePawchiveAuthor(searchKeywords[0], serviceFilter);
    if (candidate && candidate.name.toLowerCase().replace(/[\s_.-]+/g, '') === searchKeywords[0].toLowerCase().replace(/[\s_.-]+/g, '')) {
      resolvedCreator = candidate;
    }
  }

  const qPart = searchKeywords.length > 0 ? `q=${encodeURIComponent(searchKeywords.join(' '))}&` : '';

  // First connect attempt after idle often times out on flaky links, so retry once
  const fetchJsonPage = async (apiUrl) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchSafe(apiUrl, { timeout: 15000, settings, site: 'pawchive' });
        if (!res.ok) return null;
        const data = safeJsonParse(await res.text(), []);
        return Array.isArray(data) ? data : [];
      } catch (err) {
        if (attempt === 0) continue;
        throw err;
      }
    }
    return null;
  };

  let items = [];

  try {
    if (resolvedCreator) {
      items = (await fetchJsonPage(`https://pawchive.pw/api/v1/${resolvedCreator.service}/user/${resolvedCreator.user}/posts?o=${offset}`)) || [];
    } else if (serviceFilter && userFilter) {
      items = (await fetchJsonPage(`https://pawchive.pw/api/v1/${serviceFilter}/user/${userFilter}/posts?o=${offset}`)) || [];
    } else if (serviceFilter) {
      // Platform filter without a specific author: the feed has no server-side
      // service filter, so scan a fixed window of raw pages per app page and
      // keep only matching posts. Page N maps to raw pages [N*K, N*K+K).
      const windowStart = Math.max(0, (page - 1) * PAWCHIVE_RAW_PAGE_SIZE * PAWCHIVE_SERVICE_SCAN_PAGES);
      for (let i = 0; i < PAWCHIVE_SERVICE_SCAN_PAGES; i++) {
        const pageItems = await fetchJsonPage(`https://pawchive.pw/api/v1/posts?${qPart}o=${windowStart + i * PAWCHIVE_RAW_PAGE_SIZE}`);
        if (pageItems === null) break; // 429 or repeated failure: return what we have
        for (const it of pageItems) {
          if (it && (it.service || '').toLowerCase() === serviceFilter) items.push(it);
        }
        if (pageItems.length < PAWCHIVE_RAW_PAGE_SIZE) break; // feed exhausted
        if (i < PAWCHIVE_SERVICE_SCAN_PAGES - 1) {
          await new Promise(r => setTimeout(r, PAWCHIVE_SERVICE_SCAN_DELAY_MS));
        }
      }
    } else {
      items = (await fetchJsonPage(`https://pawchive.pw/api/v1/posts?${qPart}o=${offset}`)) || [];
    }

    if (items.length === 0) return [];

    const { map: creatorMap } = await getCreatorsDirectory(settings);

    const results = await Promise.all(items.map(async item => {
      return await normalizePawchivePost(item, creatorMap, resolvedCreator, aiTagsList, settings);
    }));

    let validPosts = results.filter(Boolean);

    if (settings?.hideZipPosts) {
      // Hide only archive-only posts; mixed posts (cover media + zips) stay visible
      validPosts = validPosts.filter(p => !(p.isArchive && !p.fileUrl));
    }

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
