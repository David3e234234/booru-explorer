import fs from 'fs';
import path from 'path';
import { safeJsonParse, fetchSafe, resolvePreviewUrl, discardResponse } from '../utils/network.js';
import { checkIsAi, checkMediaTypes, normalizeDate } from '../utils/tagHelpers.js';
import { classifyPostTags } from '../utils/tagClassifier.js';
import { logError } from '../utils/logger.js';

let creatorsCache = null;
let creatorsCacheTime = 0;
const CREATORS_CACHE_TTL = 3600 * 1000; // 1 hour
const DISK_CREATORS_PATH = path.join(process.cwd(), 'data', 'cache', 'pawchive_creators.json');

const PAWCHIVE_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp']);
const PAWCHIVE_VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi', 'wmv', 'flv', 'ts']);
const PAWCHIVE_ARCHIVE_EXTS = new Set([
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz',
  'psd', 'clip', 'blend', 'sai', 'sai2', 'pdf', 'txt', 'doc', 'docx',
  'mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'
]);

function isVideoFile(nameOrPath) {
  if (!nameOrPath) return false;
  const clean = String(nameOrPath).toLowerCase().split('?')[0].split('#')[0];
  const ext = clean.includes('.') ? clean.split('.').pop() : '';
  return PAWCHIVE_VIDEO_EXTS.has(ext);
}

// The global feed (/api/v1/posts) has no server-side service filter, so a
// platform filter is applied by scanning a window of raw pages client-side.
const PAWCHIVE_RAW_PAGE_SIZE = 50;
const PAWCHIVE_SERVICE_SCAN_PAGES = 3;
const PAWCHIVE_FALLBACK_SERVICES = ['patreon', 'fanbox'];

function isPawchiveVisualMedia(nameOrPath) {
  if (!nameOrPath) return false;
  const str = String(nameOrPath).toLowerCase();
  if (str.includes('vimeocdn.com') || str.includes('ytimg.com') || str.includes('twimg.com') || str.includes('imgur.com') || str.includes('thumbnail') || str.includes('preview')) {
    return true;
  }
  const clean = str.split('?')[0].split('#')[0];
  const ext = clean.includes('.') ? clean.split('.').pop() : '';
  if (PAWCHIVE_IMAGE_EXTS.has(ext) || PAWCHIVE_VIDEO_EXTS.has(ext)) {
    return true;
  }
  if (PAWCHIVE_ARCHIVE_EXTS.has(ext)) {
    return false;
  }
  return !ext || ext.length > 5;
}

function isPawchiveArchive(nameOrPath) {
  if (!nameOrPath) return false;
  const clean = String(nameOrPath).toLowerCase().split('?')[0].split('#')[0];
  const ext = clean.includes('.') ? clean.split('.').pop() : '';
  return PAWCHIVE_ARCHIVE_EXTS.has(ext);
}

export function getPawchiveAuthHeaders(settings = {}) {
  const headers = {};
  const rawSession = String(settings.pawchiveSession || '').trim();
  if (rawSession) {
    const token = rawSession.replace(/^session=/i, '').trim();
    if (token) {
      headers['Cookie'] = `session=${token}`;
    }
  }
  return headers;
}

export async function getPawchiveCreatorProfile(service, userId, settings = {}) {
  if (!service || !userId) return null;
  try {
    const authHeaders = getPawchiveAuthHeaders(settings);
    const res = await fetchSafe(`https://pawchive.pw/api/v1/${service}/user/${userId}/profile`, {
      timeout: 8000,
      headers: authHeaders,
      settings,
      site: 'pawchive'
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.name) return data;
    } else {
      await discardResponse(res);
    }
  } catch {}
  return null;
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

/**
 * Fetches and caches creator directory from Pawchive.
 * Uses persistent disk cache in data/cache/pawchive_creators.json to avoid repeating 12MB downloads.
 */
export async function getCreatorsDirectory(settings = {}) {
  const now = Date.now();
  if (creatorsCache && (now - creatorsCacheTime) < CREATORS_CACHE_TTL) {
    return creatorsCache;
  }

  // 1. Check local disk cache first (fast, ~50ms instead of 10s network transfer)
  if (!creatorsCache && fs.existsSync(DISK_CREATORS_PATH)) {
    try {
      const stat = fs.statSync(DISK_CREATORS_PATH);
      if (now - stat.mtimeMs < 24 * 3600 * 1000) {
        const text = fs.readFileSync(DISK_CREATORS_PATH, 'utf8');
        const data = safeJsonParse(text, null);
        if (Array.isArray(data) && data.length > 0) {
          const creatorMap = new Map();
          for (const c of data) {
            if (c && c.service && c.id) {
              creatorMap.set(`${c.service}:${c.id}`, c);
            }
          }
          creatorsCache = { list: data, map: creatorMap };
          creatorsCacheTime = stat.mtimeMs;
          return creatorsCache;
        }
      }
    } catch {}
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

          // Persist to disk in background
          try {
            const dir = path.dirname(DISK_CREATORS_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.promises.writeFile(DISK_CREATORS_PATH, JSON.stringify(data)).catch(() => {});
          } catch {}

          return creatorsCache;
        }
      }
      await discardResponse(res);
      break;
    } catch (err) {
      if (attempt === 0) continue;
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
 * Resolves an author name or query to one or more Pawchive creators [{ service, user, name }, ...].
 * When preferredService is given, matching is restricted to that platform.
 * When preferredService is null/all, matching looks across all platforms.
 */
export async function resolvePawchiveCreators(authorQuery, preferredService = null, settings = {}) {
  if (!authorQuery) return [];
  const clean = authorQuery
    .replace(/^(?:creator|artist|author|user|uploader):\s*/i, '')
    .replace(/[_+]+/g, ' ')
    .trim();
  if (!clean) return [];

  const { list } = await getCreatorsDirectory(settings);
  if (!list || list.length === 0) return [];

  const cleanLower = clean.toLowerCase();
  const cleanNoSpace = cleanLower.replace(/[\s_.-]+/g, '');
  const targetService = (preferredService && preferredService !== 'all')
    ? String(preferredService).toLowerCase()
    : null;

  const candidates = targetService
    ? list.filter(c => (c.service || '').toLowerCase() === targetService)
    : list;

  if (candidates.length === 0) return [];

  // 1. Exact name match first (across all candidate platforms)
  let matches = candidates.filter(c => (c.name || '').toLowerCase() === cleanLower);

  // 2. Normalized no-space match
  if (matches.length === 0) {
    matches = candidates.filter(c => (c.name || '').toLowerCase().replace(/[\s_.-]+/g, '') === cleanNoSpace);
  }

  // 3. ID match or substring match
  if (matches.length === 0) {
    const idMatches = candidates.filter(c => String(c.id) === clean);
    if (idMatches.length > 0) {
      matches = idMatches;
    } else if (cleanLower.length >= 3) {
      matches = candidates.filter(c => (c.name || '').toLowerCase().includes(cleanLower));
    }
  }

  // Sort matches by favorited count descending
  matches.sort((a, b) => (b.favorited || 0) - (a.favorited || 0));

  return matches.map(m => ({
    service: m.service,
    user: m.id,
    name: m.name
  }));
}

/**
 * Resolves an author query to the top matching Pawchive creator { service, user, name }.
 */
export async function resolvePawchiveAuthor(authorQuery, preferredService = null, settings = {}) {
  const creators = await resolvePawchiveCreators(authorQuery, preferredService, settings);
  return creators[0] || null;
}

/**
 * Normalizes a single Pawchive post item into standard BooruExp post structure
 */
export async function normalizePawchivePost(item, creatorMap, resolvedCreator, aiTagsList = [], settings = {}) {
  if (!item || !item.id) return null;

  // Filter attachments to valid visual media (exclude real archives)
  const validAttachments = Array.isArray(item.attachments)
    ? item.attachments.filter(a => a && a.path && (isPawchiveVisualMedia(a.name || a.path) || !isPawchiveArchive(a.name || a.path)))
    : [];

  // Collect all non-visual downloadable attachments (zips, clips, psds, blends, etc.)
  const allRawAttachments = Array.isArray(item.attachments) ? [...item.attachments] : [];
  if (item.file && item.file.path && isPawchiveArchive(item.file.name || item.file.path)) {
    if (!allRawAttachments.some(a => a.path === item.file.path)) {
      allRawAttachments.unshift(item.file);
    }
  }

  // Non-visual downloadable attachments (strictly matching archive formats)
  const archiveAttachments = allRawAttachments.filter(a => a && a.path && isPawchiveArchive(a.name || a.path));

  const mediaFiles = [];
  if (item.file && item.file.path && !isPawchiveArchive(item.file.name || item.file.path)) {
    mediaFiles.push(item.file);
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

  // Clean tags: primary author signal + platform meta tag
  const extractedTags = [
    `artist:${authorTag}`
  ];
  if (item.service) {
    extractedTags.push(`service:${item.service.toLowerCase()}`);
  }

  const isAi = checkIsAi(extractedTags, aiTagsList);
  const { tagDetails } = await classifyPostTags(extractedTags, postUrl, authorName, settings);
  tagDetails.artist = [authorName];
  if (item.service && !tagDetails.meta.includes(item.service.toLowerCase())) {
    tagDetails.meta.push(item.service.toLowerCase());
  }
  const createdAt = normalizeDate(item.published || item.added);

  const hasValidService = Boolean(item.service && String(item.service).trim() && item.service !== 'undefined' && item.service !== 'null');
  const hasValidUser = Boolean(item.user && String(item.user).trim() && item.user !== 'undefined' && item.user !== 'null');
  const hasValidId = Boolean(item.id && String(item.id).trim() && item.id !== 'undefined' && item.id !== 'null');

  const seriesKey = (hasValidService && hasValidUser && hasValidId) ? `pawchive:${item.service}:${item.user}:${item.id}` : null;
  const allSeriesKeys = [];
  if (seriesKey) allSeriesKeys.push(seriesKey);
  if (hasValidService && hasValidId) allSeriesKeys.push(`${item.service}:${item.id}`);

  // Posts with zip/rar attachments carry archive fields in both branches:
  // the viewer unpacks archiveUrls on open, whether or not the post also
  // has a cover image / playable slides.
  const archiveFields = buildArchiveFields(archiveAttachments);

  let rawContent = item.content || item.body || item.text || item.description || item.caption ||
                   item.post?.content || item.post?.body || item.post?.text || item.post?.description ||
                   item.substring || item.post?.substring || '';

  // Extract external embeds and download links (e.g. MEGA, Google Drive, Vimeo, YouTube, Patreon links)
  const rawEmbed = item.embed || item.post?.embed || null;
  let embedUrl = (rawEmbed && typeof rawEmbed === 'object' && rawEmbed.url) ? String(rawEmbed.url).trim() : '';
  let embedSubject = (rawEmbed && typeof rawEmbed === 'object' && rawEmbed.subject) ? String(rawEmbed.subject).trim() : '';
  let embedDescription = (rawEmbed && typeof rawEmbed === 'object' && rawEmbed.description) ? String(rawEmbed.description).trim() : '';

  const rawEmbeds = Array.isArray(item.embeds) ? item.embeds : (Array.isArray(item.post?.embeds) ? item.post.embeds : []);
  const extraEmbedLinks = [];
  if (embedUrl) {
    extraEmbedLinks.push({ url: embedUrl, subject: embedSubject || embedUrl });
  }
  for (const emb of rawEmbeds) {
    if (emb && emb.url && !extraEmbedLinks.some(e => e.url === emb.url)) {
      extraEmbedLinks.push({ url: String(emb.url).trim(), subject: emb.subject ? String(emb.subject).trim() : String(emb.url).trim() });
    }
  }

  if (extraEmbedLinks.length > 0) {
    const embedLines = extraEmbedLinks
      .filter(e => e.url && !rawContent.includes(e.url))
      .map(e => `<p><a href="${e.url}" target="_blank" rel="noopener noreferrer">🔗 ${e.subject || e.url}</a></p>`);
    if (embedLines.length > 0) {
      rawContent = rawContent ? `${rawContent}\n${embedLines.join('\n')}` : embedLines.join('\n');
    }
  }

  // Archive-only post: no playable slides, the viewer unpacks archiveUrls on open
  if (mediaFiles.length === 0) {
    return {
      id: `pawchive_${item.id}`,
      originalId: String(item.id),
      service: item.service || '',
      user: item.user || '',
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
      content: rawContent,
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
      embedUrl: embedUrl || '',
      embedSubject: embedSubject || '',
      embedDescription: embedDescription || '',
      embed: rawEmbed || null,
      ...archiveFields
    };
  }

  // Build complete albumItems array for all visual slides
  const albumItems = mediaFiles.map((m, idx) => {
    const rawFileName = m.name || `file_${idx + 1}`;
    const isVid = isVideoFile(rawFileName) || isVideoFile(m.path) || /\.(mp4|webm|mov|m4v|mkv|avi)$/i.test(rawFileName || m.path);
    const isGif = (rawFileName || m.path || '').toLowerCase().endsWith('.gif');
    const isPrevOnly = Boolean(m.preview_only || item.has_full === false);
    let fileExt = (rawFileName || m.path || '').split('?')[0].split('.').pop()?.toLowerCase() || '';
    if (!fileExt || fileExt.length > 5 || fileExt.includes('/') || fileExt.includes(':')) {
      fileExt = isVid ? 'mp4' : 'jpg';
    }
    const fileUrl = (isPrevOnly && !isVid)
      ? `https://img.pawchive.pw/thumbnail/data${m.path}`
      : `https://file.pawchive.pw/data${m.path}?f=${encodeURIComponent(rawFileName)}`;
    const previewUrlRaw = isVid
      ? `/api/video-thumbnail?url=${encodeURIComponent(fileUrl)}&quality=medium`
      : `https://img.pawchive.pw/thumbnail/data${m.path}`;
    const sampleUrl = (isPrevOnly && !isVid) ? previewUrlRaw : fileUrl;
    const previewUrl = resolvePreviewUrl(previewUrlRaw, fileUrl, sampleUrl, isVid);
    const thumb180 = isVid ? `/api/video-thumbnail?url=${encodeURIComponent(fileUrl)}&quality=low` : previewUrl;
    const thumb360 = isVid ? `/api/video-thumbnail?url=${encodeURIComponent(fileUrl)}&quality=medium` : previewUrl;
    const thumb720 = isVid ? `/api/video-thumbnail?url=${encodeURIComponent(fileUrl)}&quality=high` : previewUrl;

    return {
      id: `pawchive_${item.id}_${idx + 1}`,
      originalId: `${item.id}_${idx + 1}`,
      service: item.service || '',
      user: item.user || '',
      site: 'pawchive',
      siteName: 'Pawchive',
      previewUrl,
      sampleUrl,
      fileUrl,
      thumb180,
      thumb360,
      thumb720,
      fileExt,
      isVideo: isVid,
      isGif,
      hasSound: false,
      author: authorName,
      title: item.title || '',
      content: rawContent,
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
    service: item.service || '',
    user: item.user || '',
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
    content: rawContent,
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
    embedUrl: embedUrl || '',
    embedSubject: embedSubject || '',
    embedDescription: embedDescription || '',
    embed: rawEmbed || null,
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
    const authHeaders = getPawchiveAuthHeaders(settings);

    if (!targetService || !targetUser) {
      // If service or user missing, try searching by post ID in posts search
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const resSearch = await fetchSafe(`https://pawchive.pw/api/v1/posts?q=${encodeURIComponent(postId)}`, {
            timeout: 20000,
            headers: authHeaders,
            settings,
            site: 'pawchive'
          });
          if (resSearch.ok) {
            const found = await resSearch.json();
            const p = Array.isArray(found) ? found.find(x => String(x.id) === String(postId)) : null;
            if (p) {
              targetService = p.service;
              targetUser = p.user;
              break;
            }
          } else {
            await discardResponse(resSearch);
          }
        } catch (err) {
          if (attempt === 0) continue;
        }
      }
    }

    if (!targetService || !targetUser) return null;

    const url = `https://pawchive.pw/api/v1/${targetService}/user/${targetUser}/post/${postId}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchSafe(url, {
          timeout: 25000,
          headers: authHeaders,
          settings,
          site: 'pawchive'
        });
        if (!res.ok) {
          await discardResponse(res);
          if (attempt === 0) continue;
          return null;
        }
        const item = await res.json();
        if (!item || !item.id) return null;

        // Use cached creatorMap if already loaded; otherwise fetch single creator profile quickly
        let creatorMap = creatorsCache?.map || null;
        let resolvedCreator = null;

        if (!creatorMap || !creatorMap.has(`${item.service}:${item.user}`)) {
          const profile = await getPawchiveCreatorProfile(item.service, item.user, settings);
          if (profile) {
            resolvedCreator = profile;
          }
        }

        return await normalizePawchivePost(item, creatorMap, resolvedCreator, aiTagsList, settings);
      } catch (err) {
        if (attempt === 0) continue;
        throw err;
      }
    }
    return null;
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

  let offset = Math.max(0, (page - 1) * 50);
  if (params.category === 'random' && !tags) {
    offset = Math.floor(Math.random() * 200) * 50;
  }

  // Parse query tags for creator or service filters
  const tokens = (tags || '').split(/\s+/).filter(Boolean);
  let idFilter = null;
  let serviceFilter = null;
  let userFilter = null;
  let authorQuery = null;
  const searchKeywords = [];

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower.startsWith('id:') || lower.startsWith('post:')) {
      idFilter = token.replace(/^(?:id|post):/i, '').trim();
    } else if (lower.startsWith('service:')) {
      const svc = token.substring(8).trim().toLowerCase();
      if (svc && svc !== 'all') {
        serviceFilter = svc;
      }
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
    serviceFilter = dropdownService === 'all' ? null : dropdownService;
  }

  // If a direct post ID was queried (e.g. id:12499927), fetch and return the post directly
  if (idFilter) {
    const singlePost = await fetchPawchivePostById(idFilter, serviceFilter, userFilter, aiTagsList, settings);
    return singlePost ? [singlePost] : [];
  }

  // Attempt author resolution across all platforms (or within selected platform).
  let resolvedCreators = [];
  if (authorQuery) {
    resolvedCreators = await resolvePawchiveCreators(authorQuery, serviceFilter, settings);
  } else if (searchKeywords.length === 1 && !userFilter) {
    const candidates = await resolvePawchiveCreators(searchKeywords[0], serviceFilter, settings);
    const kwNoSpace = searchKeywords[0].toLowerCase().replace(/[\s_.-]+/g, '');
    const exactOrNormalized = candidates.filter(c => c.name.toLowerCase().replace(/[\s_.-]+/g, '') === kwNoSpace);
    if (exactOrNormalized.length > 0) {
      resolvedCreators = exactOrNormalized;
    }
  }

  const effectiveKeywords = [...searchKeywords];
  if (authorQuery && resolvedCreators.length === 0 && !effectiveKeywords.includes(authorQuery)) {
    effectiveKeywords.push(authorQuery);
  }
  const qPart = effectiveKeywords.length > 0 ? `q=${encodeURIComponent(effectiveKeywords.join(' '))}&` : '';
  const authHeaders = getPawchiveAuthHeaders(settings);

  // First connect attempt after idle often times out on flaky links, so retry once
  const fetchJsonPage = async (apiUrl) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchSafe(apiUrl, { timeout: 20000, headers: authHeaders, settings, site: 'pawchive' });
        if (!res.ok) {
          await discardResponse(res);
          return null;
        }
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
    if (resolvedCreators.length > 0) {
      // Fetch posts for all matching creators across platforms in parallel
      const creatorFetches = resolvedCreators.map(async (creator) => {
        const pageData = await fetchJsonPage(`https://pawchive.pw/api/v1/${creator.service}/user/${creator.user}/posts?o=${offset}`);
        return Array.isArray(pageData) ? pageData : [];
      });
      const settled = await Promise.allSettled(creatorFetches);
      const rawItems = [];
      for (const res of settled) {
        if (res.status === 'fulfilled' && Array.isArray(res.value)) {
          rawItems.push(...res.value);
        }
      }
      // Sort all combined posts chronologically by publish / addition date descending
      rawItems.sort((a, b) => {
        const timeA = new Date(a.published || a.added || 0).getTime() || 0;
        const timeB = new Date(b.published || b.added || 0).getTime() || 0;
        return timeB - timeA;
      });
      items = rawItems;
    } else if (serviceFilter && userFilter) {
      items = (await fetchJsonPage(`https://pawchive.pw/api/v1/${serviceFilter}/user/${userFilter}/posts?o=${offset}`)) || [];
    } else if (serviceFilter) {
      // Platform filter without a specific author: the feed has no server-side
      // service filter, so scan a fixed window of raw pages per app page and
      // keep only matching posts. Page N maps to raw pages [N*K, N*K+K).
      const windowStart = Math.max(0, (page - 1) * PAWCHIVE_RAW_PAGE_SIZE * PAWCHIVE_SERVICE_SCAN_PAGES);
      const scanPromises = Array.from({ length: PAWCHIVE_SERVICE_SCAN_PAGES }, (_, i) =>
        fetchJsonPage(`https://pawchive.pw/api/v1/posts?${qPart}o=${windowStart + i * PAWCHIVE_RAW_PAGE_SIZE}`)
      );
      const scanSettled = await Promise.allSettled(scanPromises);
      for (const res of scanSettled) {
        if (res.status === 'fulfilled' && Array.isArray(res.value)) {
          for (const it of res.value) {
            if (it && (it.service || '').toLowerCase() === serviceFilter) items.push(it);
          }
        }
      }
    } else if (authorQuery && !qPart) {
      // Author query was requested but not found: return empty array instead of random general posts
      items = [];
    } else {
      items = (await fetchJsonPage(`https://pawchive.pw/api/v1/posts?${qPart}o=${offset}`)) || [];
    }

    if (items.length === 0) return [];

    const { map: creatorMap } = await getCreatorsDirectory(settings);

    const results = await Promise.all(items.map(async item => {
      const creatorForPost = resolvedCreators.find(c => c.service === item.service && String(c.user) === String(item.user)) || null;
      return await normalizePawchivePost(item, creatorMap, creatorForPost, aiTagsList, settings);
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
