import { safeJsonParse, fetchSafe, resolvePreviewUrl } from '../utils/network.js';
import { checkIsAi, checkMediaTypes, normalizeDate } from '../utils/tagHelpers.js';
import { classifyPostTags } from '../utils/tagClassifier.js';
import { isVideoMediaUrl } from '../../public/js/modules/uiUtils.js';
import { logError } from '../utils/logger.js';

let creatorsCache = null;
let creatorsCacheTime = 0;
const CREATORS_CACHE_TTL = 3600 * 1000; // 1 hour

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
      if (!item || !item.id) return null;

      // Extract main media file or first image/video attachment
      let mainFile = item.file && item.file.path ? item.file : null;
      if (!mainFile && Array.isArray(item.attachments) && item.attachments.length > 0) {
        mainFile = item.attachments.find(a => a && a.path && /\.(jpe?g|png|webp|gif|mp4|webm|mov)$/i.test(a.name || a.path)) || item.attachments[0];
      }

      if (!mainFile || !mainFile.path) {
        return null;
      }

      const rawFileName = mainFile.name || 'file';
      const isMainPreviewOnly = Boolean(mainFile.preview_only || item.has_full === false);
      const fileUrl = isMainPreviewOnly
        ? `https://img.pawchive.pw/thumbnail/data${mainFile.path}`
        : `https://file.pawchive.pw/data${mainFile.path}?f=${encodeURIComponent(rawFileName)}`;
      const previewUrlRaw = `https://img.pawchive.pw/thumbnail/data${mainFile.path}`;
      const sampleUrl = `https://img.pawchive.pw/thumbnail/data${mainFile.path}`;

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

      const STOP_TITLE_WORDS = new Set([
        'psd', 'clip', 'sai', 'c4d', 'blend', 'zip', 'rar', '7z', 'tar', 'r18', 'nsfw', 'sfw', 
        'reward', 'pack', 'tier', 'wip', 'sketch', 'vol', 'part', 'set', 'ver', 'version', 
        'alt', 'the', 'and', 'for', 'with', 'from', 'free', 'fanbox', 'patreon', 'fantia', 'boosty'
      ]);

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

      const { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(fileUrl, '', extractedTags);
      const isPostVideo = isVideo || isVideoMediaUrl(rawFileName);
      const previewUrl = resolvePreviewUrl(previewUrlRaw, fileUrl, sampleUrl, isPostVideo);
      const isAi = checkIsAi(extractedTags, aiTagsList);
      const { tagDetails } = await classifyPostTags(extractedTags, postUrl, authorName);
      tagDetails.artist = [authorName];
      const createdAt = normalizeDate(item.published || item.added);

      // Build albumItems if multiple media items exist in the post
      const albumItems = [];
      if (item.file && item.file.path) {
        const isVid = isVideoMediaUrl(item.file.name);
        const isCoverPreviewOnly = Boolean(item.file.preview_only || item.has_full === false);
        albumItems.push({
          fileUrl: isCoverPreviewOnly
            ? `https://img.pawchive.pw/thumbnail/data${item.file.path}`
            : `https://file.pawchive.pw/data${item.file.path}?f=${encodeURIComponent(item.file.name || 'file')}`,
          previewUrl: `https://img.pawchive.pw/thumbnail/data${item.file.path}`,
          name: item.file.name || 'Cover',
          isVideo: isVid
        });
      }
      if (Array.isArray(item.attachments)) {
        for (const att of item.attachments) {
          if (!att || !att.path) continue;
          const isVid = isVideoMediaUrl(att.name);
          const isAttPreviewOnly = Boolean(att.preview_only || item.has_full === false);
          albumItems.push({
            fileUrl: isAttPreviewOnly
              ? `https://img.pawchive.pw/thumbnail/data${att.path}`
              : `https://file.pawchive.pw/data${att.path}?f=${encodeURIComponent(att.name || 'file')}`,
            previewUrl: `https://img.pawchive.pw/thumbnail/data${att.path}`,
            name: att.name || 'Attachment',
            isVideo: isVid
          });
        }
      }

      return {
        id: `pawchive_${item.id}`,
        originalId: String(item.id),
        site: 'pawchive',
        siteName: 'Pawchive',
        previewUrl,
        sampleUrl,
        fileUrl,
        fileExt,
        isVideo: isPostVideo,
        isGif,
        hasSound: isPostVideo && hasSound,
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
        hasChildren: albumItems.length > 1,
        albumItems: albumItems.length > 1 ? albumItems : undefined,
        createdAt,
        isAi
      };
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
