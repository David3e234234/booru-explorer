import fs from 'fs';
import path from 'path';
import { safeJsonParse, fetchSafe, resolvePreviewUrl, discardResponse } from '../utils/network.js';
import { checkIsAi, normalizeDate } from '../utils/tagHelpers.js';
import { classifyPostTags } from '../utils/tagClassifier.js';
import { logError } from '../utils/logger.js';

let creatorsCache = null;
let creatorsCacheTime = 0;
const CREATORS_CACHE_TTL = 3600 * 1000; // 1 hour
const DISK_CREATORS_PATH = path.join(process.cwd(), 'data', 'cache', 'kemono_creators.json');

const KEMONO_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp']);
const KEMONO_VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi', 'wmv', 'flv', 'ts']);
const KEMONO_ARCHIVE_EXTS = new Set([
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz',
  'psd', 'clip', 'blend', 'sai', 'sai2', 'pdf', 'txt', 'doc', 'docx',
  'mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'
]);

const KEMONO_STORAGE_SERVERS = [
  'https://n1.kemono.cr',
  'https://n2.kemono.cr',
  'https://n3.kemono.cr',
  'https://n4.kemono.cr'
];

function isVideoFile(nameOrPath) {
  if (!nameOrPath) return false;
  const clean = String(nameOrPath).toLowerCase().split('?')[0].split('#')[0];
  const ext = clean.includes('.') ? clean.split('.').pop() : '';
  return KEMONO_VIDEO_EXTS.has(ext);
}

const KEMONO_RAW_PAGE_SIZE = 50;
const KEMONO_SERVICE_SCAN_PAGES = 3;
const KEMONO_FALLBACK_SERVICES = ['patreon', 'fanbox', 'fantia', 'boosty', 'gumroad', 'subscribestar', 'discord', 'afdian', 'dlsite'];

function isKemonoVisualMedia(nameOrPath) {
  if (!nameOrPath) return false;
  const str = String(nameOrPath).toLowerCase();
  if (str.includes('vimeocdn.com') || str.includes('ytimg.com') || str.includes('twimg.com') || str.includes('imgur.com') || str.includes('thumbnail') || str.includes('preview')) {
    return true;
  }
  const clean = str.split('?')[0].split('#')[0];
  const ext = clean.includes('.') ? clean.split('.').pop() : '';
  if (KEMONO_IMAGE_EXTS.has(ext) || KEMONO_VIDEO_EXTS.has(ext)) {
    return true;
  }
  if (KEMONO_ARCHIVE_EXTS.has(ext)) {
    return false;
  }
  return !ext || ext.length > 5;
}

function isKemonoArchive(nameOrPath) {
  if (!nameOrPath) return false;
  const clean = String(nameOrPath).toLowerCase().split('?')[0].split('#')[0];
  const ext = clean.includes('.') ? clean.split('.').pop() : '';
  return KEMONO_ARCHIVE_EXTS.has(ext);
}

export function getKemonoAuthHeaders(settings = {}) {
  const headers = {
    'Accept': 'text/css'
  };
  const rawSession = String(settings.kemonoSession || '').trim();
  if (rawSession) {
    let token = rawSession;
    const sessionMatch = token.match(/(?:^|;\s*)session=([^;]+)/i);
    if (sessionMatch) {
      token = sessionMatch[1];
    } else {
      token = token.replace(/^session=/i, '');
    }
    token = token.trim().replace(/^["']|["']$/g, '');
    if (token) {
      headers['Cookie'] = `session=${token}`;
    }
  }
  return headers;
}

export async function getKemonoCreatorProfile(service, userId, settings = {}) {
  if (!service || !userId) return null;
  try {
    const authHeaders = getKemonoAuthHeaders(settings);
    const res = await fetchSafe(`https://kemono.cr/api/v1/${service}/user/${userId}/profile`, {
      timeout: 8000,
      headers: authHeaders,
      settings,
      site: 'kemono'
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
    archiveUrls: archiveAttachments.map((a, idx) => {
      const rawName = a.name || (a.path ? a.path.split('/').pop() : 'file');
      const baseServer = a.server || KEMONO_STORAGE_SERVERS[idx % KEMONO_STORAGE_SERVERS.length];
      return `${baseServer}/data${a.path}?f=${encodeURIComponent(rawName)}`;
    }),
    archiveNames: archiveAttachments.map(a => a.name || (a.path ? a.path.split('/').pop() : 'file')),
    archiveSizes: archiveAttachments.map(a => a.size || 0)
  };
}

export async function getCreatorsDirectory(settings = {}) {
  const now = Date.now();
  if (creatorsCache && (now - creatorsCacheTime) < CREATORS_CACHE_TTL) {
    return creatorsCache;
  }

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

  const authHeaders = getKemonoAuthHeaders(settings);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchSafe('https://kemono.cr/api/v1/creators', {
        timeout: 30000,
        headers: authHeaders,
        settings,
        site: 'kemono'
      });
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
      logError('Kemono', 'Failed to load creators list', err);
    }
  }
  return creatorsCache || { list: [], map: new Map() };
}

export async function getKemonoServices() {
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
    logError('Kemono', 'Failed to load services list', err);
  }
  return [...KEMONO_FALLBACK_SERVICES];
}

export async function resolveKemonoCreators(authorQuery, preferredService = null, settings = {}) {
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
  const baseClean = clean.replace(/\s*\([^)]*\)/g, '').trim();

  const exactVariants = new Set([cleanLower]);
  const noSpaceVariants = new Set([cleanNoSpace]);

  // Strip parenthetical disambiguations (circle, alias, group, platform)
  if (baseClean && baseClean !== clean) {
    exactVariants.add(baseClean.toLowerCase());
    noSpaceVariants.add(baseClean.toLowerCase().replace(/[\s_.-]+/g, ''));
  }

  // Strip leading 'the '
  const withoutThe = cleanLower.replace(/^the\s+/i, '');
  if (withoutThe !== cleanLower) {
    exactVariants.add(withoutThe);
    noSpaceVariants.add(withoutThe.replace(/[\s_.-]+/g, ''));
  }

  // Strip trailing/intermediate digits when name is long enough (e.g. delights2s -> delightss)
  const withoutDigits = cleanNoSpace.replace(/\d+/g, '');
  if (withoutDigits !== cleanNoSpace && withoutDigits.length >= 4) {
    exactVariants.add(withoutDigits);
    noSpaceVariants.add(withoutDigits);
  }

  const targetService = (preferredService && preferredService !== 'all')
    ? String(preferredService).toLowerCase()
    : null;

  const candidates = targetService
    ? list.filter(c => (c.service || '').toLowerCase() === targetService)
    : list;

  if (candidates.length === 0) return [];

  // 1. Exact string match across variants
  let matches = candidates.filter(c => exactVariants.has((c.name || '').toLowerCase()));

  // 2. Normalized no-space match across variants
  if (matches.length === 0) {
    matches = candidates.filter(c => noSpaceVariants.has((c.name || '').toLowerCase().replace(/[\s_.-]+/g, '')));
  }

  // 3. ID match or prefix match
  if (matches.length === 0) {
    const idMatches = candidates.filter(c => String(c.id) === clean || String(c.id) === baseClean);
    if (idMatches.length > 0) {
      matches = idMatches;
    } else {
      for (const v of noSpaceVariants) {
        if (v.length >= 4 && !v.startsWith('the')) {
          const inc = candidates.filter(c => {
            const cn = (c.name || '').toLowerCase().replace(/[\s_.-]+/g, '');
            return cn.length >= 3 && cn.startsWith(v);
          });
          if (inc.length > 0) {
            matches = inc;
            break;
          }
        }
      }
    }
  }

  matches.sort((a, b) => (b.favorited || 0) - (a.favorited || 0));

  return matches.map(m => ({
    service: m.service,
    user: m.id,
    id: m.id,
    name: m.name
  }));
}

export async function resolveKemonoAuthor(authorQuery, preferredService = null, settings = {}) {
  const creators = await resolveKemonoCreators(authorQuery, preferredService, settings);
  return creators[0] || null;
}

export async function normalizeKemonoPost(item, creatorMap, resolvedCreator, aiTagsList = [], settings = {}) {
  if (!item || !item.id) return null;

  const validAttachments = Array.isArray(item.attachments)
    ? item.attachments.filter(a => a && a.path && (isKemonoVisualMedia(a.name || a.path) || !isKemonoArchive(a.name || a.path)))
    : [];

  const allRawAttachments = Array.isArray(item.attachments) ? [...item.attachments] : [];
  if (item.file && item.file.path && isKemonoArchive(item.file.name || item.file.path)) {
    if (!allRawAttachments.some(a => a.path === item.file.path)) {
      allRawAttachments.unshift(item.file);
    }
  }

  const archiveAttachments = allRawAttachments.filter(a => a && a.path && isKemonoArchive(a.name || a.path));

  const mediaFiles = [];
  if (item.file && item.file.path && !isKemonoArchive(item.file.name || item.file.path)) {
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
  const postUrl = `https://kemono.cr/${item.service}/user/${item.user}/post/${item.id}`;

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

  const seriesKey = (hasValidService && hasValidUser && hasValidId) ? `kemono:${item.service}:${item.user}:${item.id}` : null;
  const allSeriesKeys = [];
  if (seriesKey) allSeriesKeys.push(seriesKey);
  if (hasValidService && hasValidId) allSeriesKeys.push(`${item.service}:${item.id}`);

  const archiveFields = buildArchiveFields(archiveAttachments);

  let rawContent = item.content || item.body || item.text || item.description || item.caption ||
                   item.post?.content || item.post?.body || item.post?.text || item.post?.description ||
                   item.substring || item.post?.substring || '';

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

  if (mediaFiles.length === 0) {
    return {
      id: `kemono_${item.id}`,
      originalId: String(item.id),
      service: item.service || '',
      user: item.user || '',
      site: 'kemono',
      siteName: 'Kemono',
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
      assistants: [],
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

  const albumItems = mediaFiles.map((m, idx) => {
    const rawFileName = m.name || `file_${idx + 1}`;
    const isVid = isVideoFile(rawFileName) || isVideoFile(m.path) || /\.(mp4|webm|mov|m4v|mkv|avi)$/i.test(rawFileName || m.path);
    const isGif = (rawFileName || m.path || '').toLowerCase().endsWith('.gif');
    const isPrevOnly = Boolean(m.preview_only || item.has_full === false);
    let fileExt = (rawFileName || m.path || '').split('?')[0].split('.').pop()?.toLowerCase() || '';
    if (!fileExt || fileExt.length > 5 || fileExt.includes('/') || fileExt.includes(':')) {
      fileExt = isVid ? 'mp4' : 'jpg';
    }

    const baseServer = m.server || KEMONO_STORAGE_SERVERS[idx % KEMONO_STORAGE_SERVERS.length];
    const fileUrl = (isPrevOnly && !isVid)
      ? `https://img.kemono.cr/thumbnail/data${m.path}`
      : `${baseServer}/data${m.path}?f=${encodeURIComponent(rawFileName)}`;
    const previewUrlRaw = isVid
      ? `/api/video-thumbnail?url=${encodeURIComponent(fileUrl)}&quality=medium`
      : `https://img.kemono.cr/thumbnail/data${m.path}`;
    const sampleUrl = !isVid ? previewUrlRaw : fileUrl;
    const previewUrl = resolvePreviewUrl(previewUrlRaw, fileUrl, sampleUrl, isVid);
    const thumb180 = isVid ? `/api/video-thumbnail?url=${encodeURIComponent(fileUrl)}&quality=low` : previewUrl;
    const thumb360 = isVid ? `/api/video-thumbnail?url=${encodeURIComponent(fileUrl)}&quality=medium` : previewUrl;
    const thumb720 = isVid ? `/api/video-thumbnail?url=${encodeURIComponent(fileUrl)}&quality=high` : previewUrl;

    return {
      id: `kemono_${item.id}_${idx + 1}`,
      originalId: `${item.id}_${idx + 1}`,
      service: item.service || '',
      user: item.user || '',
      site: 'kemono',
      siteName: 'Kemono',
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
      assistants: [],
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
      parentId: `kemono_${item.id}`,
      createdAt,
      isAi
    };
  });

  const firstVideoIdx = albumItems.findIndex(i => i.isVideo);
  if (firstVideoIdx > 0) {
    const [videoItem] = albumItems.splice(firstVideoIdx, 1);
    albumItems.unshift(videoItem);
  }

  const mainMedia = albumItems[0];
  const hasMultiple = albumItems.length > 1;

  return {
    id: `kemono_${item.id}`,
    originalId: String(item.id),
    service: item.service || '',
    user: item.user || '',
    site: 'kemono',
    siteName: 'Kemono',
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
    assistants: [],
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

export async function fetchKemonoPostById(postIdOrOptions, service, user, aiTagsList = [], settings = {}) {
  let postId = postIdOrOptions;
  if (postIdOrOptions && typeof postIdOrOptions === 'object') {
    postId = postIdOrOptions.postId || postIdOrOptions.id || postIdOrOptions.originalId;
    service = postIdOrOptions.service;
    user = postIdOrOptions.user;
    aiTagsList = postIdOrOptions.aiTagsList || aiTagsList;
    settings = postIdOrOptions.settings || settings;
  }
  if (!postId) return null;
  try {
    let targetService = service;
    let targetUser = user;
    const authHeaders = getKemonoAuthHeaders(settings);

    if (!targetService || !targetUser) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const resSearch = await fetchSafe(`https://kemono.cr/api/v1/posts?q=${encodeURIComponent(postId)}`, {
            timeout: 20000,
            headers: authHeaders,
            settings,
            site: 'kemono'
          });
          if (resSearch.ok) {
            const rawData = await resSearch.json();
            const found = Array.isArray(rawData) ? rawData : (Array.isArray(rawData?.posts) ? rawData.posts : []);
            const p = found.find(x => String(x.id) === String(postId));
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

    const url = `https://kemono.cr/api/v1/${targetService}/user/${targetUser}/post/${postId}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchSafe(url, {
          timeout: 25000,
          headers: authHeaders,
          settings,
          site: 'kemono'
        });
        if (!res.ok) {
          await discardResponse(res);
          if (attempt === 0) continue;
          return null;
        }
        const rawJson = await res.json();
        if (!rawJson) return null;

        // Kemono post endpoints may return { post, attachments, previews } or post directly
        const postObj = rawJson.post || rawJson;
        if (!postObj || !postObj.id) return null;

        if (Array.isArray(rawJson.attachments) && rawJson.attachments.length > 0) {
          postObj.attachments = rawJson.attachments;
        }

        let creatorMap = creatorsCache?.map || null;
        let resolvedCreator = null;

        if (!creatorMap || !creatorMap.has(`${postObj.service}:${postObj.user}`)) {
          const profile = await getKemonoCreatorProfile(postObj.service, postObj.user, settings);
          if (profile) {
            resolvedCreator = profile;
          }
        }

        return await normalizeKemonoPost(postObj, creatorMap, resolvedCreator, aiTagsList, settings);
      } catch (err) {
        if (attempt === 0) continue;
        throw err;
      }
    }
    return null;
  } catch (err) {
    logError('Kemono', `Failed to fetch post ${postId}`, err);
    return null;
  }
}

export async function fetchKemono(params, aiTagsList, settings = {}) {
  const { tags = '', page = 1, limit = 40, ratingFilter = 'all', typeFilter = 'all', kemonoService = '' } = params;

  if (ratingFilter === 'sfw') {
    return [];
  }

  let offset = Math.max(0, (page - 1) * 50);
  if (params.category === 'random' && !tags) {
    offset = Math.floor(Math.random() * 200) * 50;
  }

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

  const dropdownService = String(kemonoService || '').trim().toLowerCase();
  if (/^[a-z0-9_-]+$/.test(dropdownService)) {
    serviceFilter = dropdownService === 'all' ? null : dropdownService;
  }

  if (idFilter) {
    const singlePost = await fetchKemonoPostById(idFilter, serviceFilter, userFilter, aiTagsList, settings);
    return singlePost ? [singlePost] : [];
  }

  let resolvedCreators = [];
  if (authorQuery) {
    resolvedCreators = await resolveKemonoCreators(authorQuery, serviceFilter, settings);
  } else if (searchKeywords.length === 1 && !userFilter) {
    const candidates = await resolveKemonoCreators(searchKeywords[0], serviceFilter, settings);
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
  const authHeaders = getKemonoAuthHeaders(settings);

  const fetchJsonPage = async (apiUrl) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchSafe(apiUrl, { timeout: 20000, headers: authHeaders, settings, site: 'kemono' });
        if (!res.ok) {
          if (res.status === 429 && attempt === 0) {
            await discardResponse(res);
            await new Promise(r => setTimeout(r, 1200));
            continue;
          }
          await discardResponse(res);
          return null;
        }
        const data = safeJsonParse(await res.text(), null);
        if (Array.isArray(data)) return data;
        if (Array.isArray(data?.posts)) return data.posts;
        return [];
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
      const creatorFetches = resolvedCreators.map(async (creator) => {
        const pageData = await fetchJsonPage(`https://kemono.cr/api/v1/${creator.service}/user/${creator.user}/posts?o=${offset}`);
        return Array.isArray(pageData) ? pageData : [];
      });
      const settled = await Promise.allSettled(creatorFetches);
      const rawItems = [];
      for (const res of settled) {
        if (res.status === 'fulfilled' && Array.isArray(res.value)) {
          rawItems.push(...res.value);
        }
      }
      rawItems.sort((a, b) => {
        const timeA = new Date(a.published || a.added || 0).getTime() || 0;
        const timeB = new Date(b.published || b.added || 0).getTime() || 0;
        return timeB - timeA;
      });
      items = rawItems;
    } else if (serviceFilter && userFilter) {
      items = (await fetchJsonPage(`https://kemono.cr/api/v1/${serviceFilter}/user/${userFilter}/posts?o=${offset}`)) || [];
    } else if (serviceFilter) {
      const windowStart = Math.max(0, (page - 1) * KEMONO_RAW_PAGE_SIZE * KEMONO_SERVICE_SCAN_PAGES);
      const scanPromises = Array.from({ length: KEMONO_SERVICE_SCAN_PAGES }, (_, i) =>
        fetchJsonPage(`https://kemono.cr/api/v1/posts?${qPart}o=${windowStart + i * KEMONO_RAW_PAGE_SIZE}`)
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
      items = [];
    } else {
      items = (await fetchJsonPage(`https://kemono.cr/api/v1/posts?${qPart}o=${offset}`)) || [];
    }

    if (items.length === 0) return [];

    const { map: creatorMap } = await getCreatorsDirectory(settings);

    const results = await Promise.all(items.map(async item => {
      const creatorForPost = resolvedCreators.find(c => c.service === item.service && String(c.user) === String(item.user)) || null;
      return await normalizeKemonoPost(item, creatorMap, creatorForPost, aiTagsList, settings);
    }));

    let validPosts = results.filter(Boolean);

    if (settings?.hideZipPosts) {
      validPosts = validPosts.filter(p => !(p.isArchive && !p.fileUrl));
    }

    if (typeFilter === 'video') {
      validPosts = validPosts.filter(p => p.isVideo);
    } else if (typeFilter === 'image') {
      validPosts = validPosts.filter(p => !p.isVideo);
    } else if (typeFilter === 'zip' || typeFilter === 'archive') {
      validPosts = validPosts.filter(p => p.isArchive || p.fileExt === 'zip' || (Array.isArray(p.archiveUrls) && p.archiveUrls.length > 0));
    }

    return validPosts;
  } catch (err) {
    logError('Kemono', 'Error fetching posts from Kemono', err);
    return [];
  }
}
