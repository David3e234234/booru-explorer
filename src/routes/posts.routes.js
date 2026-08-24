import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import open from 'open';
import AdmZip from 'adm-zip';
import {
  SITES,
  DEFAULT_AI_TAGS,
  ROOT_DIR
} from '../config/constants.js';
import { apiPostsCache, tagAutocompleteCache } from '../services/cacheService.js';
import { getSettings } from '../services/storageService.js';
import { fetchPosts } from '../parsers/index.js';
import { getCreatorsDirectory, fetchPawchivePostById } from '../parsers/pawchive.js';
import { groupPostsIntoAlbums } from '../utils/albumHelper.js';
import { fetchSafe } from '../utils/network.js';
import { logInfo, logError } from '../utils/logger.js';

const router = express.Router();

// Client settings fields that affect filtering results - they are part of the cache key
const AUTH_CACHE_FIELDS = [
  'blacklist', 'curvyTags', 'petiteTags', 'furryTags', 'pregnantTags', 'lgbtTags',
  'aiTags', 'prioritizeUserTags', 'deepFetchPages', 'hideFurry', 'hidePregnant', 'hideLgbt', 'customSources',
  'rule34ApiKey', 'rule34UserId', 'gelbooruApiKey', 'gelbooruUserId', 'danbooruApiKey', 'danbooruLogin'
];

function parseClientAuth(req) {
  let clientAuth = {};
  if (req.headers['x-booru-auth']) {
    try {
      clientAuth = JSON.parse(decodeURIComponent(req.headers['x-booru-auth']));
    } catch {
      try { clientAuth = JSON.parse(req.headers['x-booru-auth']); } catch {}
    }
  }
  return clientAuth;
}

function buildAuthCacheKey(clientAuth, settings) {
  const parts = AUTH_CACHE_FIELDS.map(f => JSON.stringify(clientAuth[f] ?? settings[f] ?? null));
  return crypto.createHash('md5').update(parts.join('|')).digest('hex').slice(0, 10);
}

// GET /api/sites
router.get('/sites', (req, res) => {
  res.json({ sites: Object.values(SITES) });
});

// GET /api/version
router.get('/version', (req, res) => {
  res.json({
    version: '6.5.0',
    buildTime: '2026-08-19 12:17',
    features: ['space-normalized-autocomplete', 'danbooru-universal-fallback', 'client-auth-forwarding', 'video-1080p-r34video']
  });
});

// GET /api/posts
router.get('/posts', async (req, res) => {
  try {
    const site = req.query.site || 'danbooru';
    const tags = req.query.tags || '';
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 100;
    const category = req.query.category || 'new';
    const aiFilter = req.query.aiFilter || 'no-ai';
    const ratingFilter = req.query.ratingFilter || 'all';
    const typeFilter = req.query.typeFilter || 'all';
    const ageFilter = req.query.ageFilter || 'all';
    const dateFilter = req.query.dateFilter || 'all';
    const hideFurry = req.query.hideFurry === 'true' || req.query.hideFurry === '1';
    const hidePregnant = req.query.hidePregnant === 'true' || req.query.hidePregnant === '1';
    const hideLgbt = req.query.hideLgbt === 'true' || req.query.hideLgbt === '1';
    const excludeSites = req.query.excludeSites || '';
    const customSites = req.query.customSites || '';

    // Check the in-memory cache (for everything except random)
    let clientAuth = parseClientAuth(req);
    const baseSettings = getSettings();
    const settings = {
      ...baseSettings,
      ...clientAuth
    };

    // groupAlbums changes the response shape (album collapsing), so it belongs in the key
    const cacheKey = `${site}:${tags}:${page}:${limit}:${category}:${aiFilter}:${ratingFilter}:${typeFilter}:${ageFilter}:${dateFilter}:${hideFurry}:${hidePregnant}:${hideLgbt}:${excludeSites}:${customSites}:albums=${req.query.groupAlbums !== 'false'}:${buildAuthCacheKey(clientAuth, settings)}`;
    if (category !== 'random' && !req.query._t && !req.query._bust && !req.query._reload) {
      const cached = apiPostsCache.get(cacheKey);
      if (cached && Array.isArray(cached.posts) && cached.posts.length > 0) {
        return res.json(cached);
      }
    }

    const aiTagsList = settings.aiTags || DEFAULT_AI_TAGS;

    logInfo('Search', `Запрос: site=${site}, tags="${tags}", page=${page}, category=${category}, date=${dateFilter}, rating=${ratingFilter}, type=${typeFilter}, age=${ageFilter}`);

    // fetchPosts performs the full local filtering itself (isPostMatchingFilters)
    let posts = await fetchPosts(site, {
      tags, 
      page, 
      limit, 
      category, 
      ratingFilter, 
      typeFilter, 
      ageFilter, 
      dateFilter,
      excludeSites,
      customSites,
      hideFurry,
      hidePregnant,
      hideLgbt
    }, aiTagsList, settings);

    // Sort top/views categories (after the multi-site round-robin merge)
    if (category === 'top' && site !== 'all') {
      posts.sort((a, b) => (b.score || 0) - (a.score || 0));
    } else if (category === 'views' && site !== 'all') {
      posts.sort((a, b) => (b.views || b.score || 0) - (a.views || a.score || 0));
    }

    // Automatically group related images into albums
    const shouldGroupAlbums = req.query.groupAlbums !== 'false';
    if (shouldGroupAlbums && posts.length > 0) {
      posts = groupPostsIntoAlbums(posts, { enabled: true });
    }

    if (posts.length > limit) {
      posts = posts.slice(0, limit);
    }

    logInfo('Search', `Успешно: найдено ${posts.length} постов для выдачи (лимит: ${limit}, альбомы: ${shouldGroupAlbums ? 'вкл' : 'выкл'})`);

    const responsePayload = {
      success: true,
      site,
      page,
      count: posts.length,
      posts
    };

    if (category !== 'random' && posts.length > 0) {
      apiPostsCache.set(cacheKey, responsePayload);
    }

    res.json(responsePayload);
  } catch (err) {
    logError('Search', `Ошибка при поиске`, err);
    if (!res.headersSent) {
      res.status(502).json({
        success: false,
        site: req.query.site || 'danbooru',
        page: 1,
        count: 0,
        posts: [],
        error: err.message
      });
    }
  }
});

// GET /api/posts/album - find all parts of a series/album by parentId or Pixiv ID
router.get('/posts/album', async (req, res) => {
  try {
    const site = req.query.site || 'danbooru';
    const seriesKey = req.query.seriesKey || '';
    const parentId = req.query.parentId || '';
    const originalId = req.query.originalId || '';

    const settings = {
      ...getSettings(),
      ...parseClientAuth(req)
    };
    const aiTagsList = settings.aiTags || DEFAULT_AI_TAGS;

    let foundPostsMap = new Map();

    const fetchAndCollect = async (tagQuery) => {
      if (!tagQuery) return;
      try {
        const list = await fetchPosts(site, { tags: tagQuery, page: 1, limit: 100, ratingFilter: 'all', typeFilter: 'all' }, aiTagsList, settings);
        list.forEach(p => {
          if (p && p.id && !foundPostsMap.has(p.id)) {
            const clean = { ...p };
            delete clean.albumItems;
            foundPostsMap.set(p.id, clean);
          }
        });
      } catch (err) {
        logError('AlbumSearch', `Ошибка при запросе tags="${tagQuery}"`, err);
      }
    };

    // Run independent requests in parallel
    const pendingQueries = [];
    if (parentId && String(parentId) !== '0') {
      pendingQueries.push(fetchAndCollect(`parent:${parentId}`));
    }
    if (originalId && String(originalId) !== '0') {
      pendingQueries.push(fetchAndCollect(`parent:${originalId}`));
    }
    if (seriesKey.startsWith('pixiv:')) {
      pendingQueries.push(fetchAndCollect(seriesKey));
    }
    if (seriesKey.startsWith('twitter:')) {
      pendingQueries.push(fetchAndCollect(`source:*${seriesKey.replace('twitter:', '')}*`));
    }
    if (pendingQueries.length > 0) {
      await Promise.all(pendingQueries);
    }

    // Fallback requests that depend on the first results (sequential)
    if (seriesKey.startsWith('pixiv:') && foundPostsMap.size === 0) {
      const pixivId = seriesKey.replace('pixiv:', '');
      await fetchAndCollect(`pixiv_id:${pixivId}`);
    }

    if ((site === 'pawchive' || seriesKey.startsWith('pawchive:')) && foundPostsMap.size === 0) {
      const pawchiveMatch = seriesKey.match(/^pawchive:([^:]+):([^:]+):(\d+)$/) ||
        (req.query.postUrl || '').match(/pawchive\.pw\/([^/]+)\/user\/([^/]+)\/post\/(\d+)/);
      const targetPostId = pawchiveMatch ? pawchiveMatch[3] : (originalId || parentId || '').replace(/^pawchive_/, '').split('_')[0];
      const targetService = pawchiveMatch ? pawchiveMatch[1] : null;
      const targetUser = pawchiveMatch ? pawchiveMatch[2] : null;

      const pPost = await fetchPawchivePostById(targetPostId, targetService, targetUser, aiTagsList, settings);
      if (pPost && Array.isArray(pPost.albumItems) && pPost.albumItems.length > 0) {
        pPost.albumItems.forEach(item => {
          if (item && item.id && !foundPostsMap.has(item.id)) {
            const clean = { ...item };
            delete clean.albumItems;
            foundPostsMap.set(item.id, clean);
          }
        });
      }
    }

    let items = Array.from(foundPostsMap.values());

    // If the parent post did not come back under parent:ID (on some Boorus), query the parentId itself
    if (parentId && !foundPostsMap.has(`${site}_${parentId}`) && !foundPostsMap.has(parentId)) {
      try {
        const rootPost = await fetchPosts(site, { tags: `id:${parentId}`, page: 1, limit: 1, ratingFilter: 'all', typeFilter: 'all' }, aiTagsList, settings);
        if (rootPost && rootPost[0]) {
          const cleanRoot = { ...rootPost[0] };
          delete cleanRoot.albumItems;
          items.unshift(cleanRoot);
        }
      } catch {}
    }

    // Sort the set pages
    items.sort((a, b) => {
      const aIsParent = Boolean(a.hasChildren && !a.parentId);
      const bIsParent = Boolean(b.hasChildren && !b.parentId);
      if (aIsParent && !bIsParent) return -1;
      if (!aIsParent && bIsParent) return 1;

      const getPageNum = (item) => {
        const target = item.fileUrl || item.sampleUrl || item.previewUrl || item.source || '';
        const pMatch = target.match(/_p(\d+)\./i) || target.match(/page_?(\d+)/i);
        if (pMatch) return parseInt(pMatch[1], 10);
        return null;
      };

      const pageA = getPageNum(a);
      const pageB = getPageNum(b);
      if (pageA !== null && pageB !== null) return pageA - pageB;

      const idA = parseInt(String(a.originalId || a.id).replace(/\D/g, ''), 10) || 0;
      const idB = parseInt(String(b.originalId || b.id).replace(/\D/g, ''), 10) || 0;
      return idA - idB;
    });

    logInfo('AlbumSearch', `Успешно найдено ${items.length} частей серии для site=${site}`);

    res.json({
      success: true,
      site,
      seriesKey,
      parentId,
      albumCount: items.length,
      albumItems: items
    });
  } catch (err) {
    logError('AlbumSearch', `Ошибка при поиске альбома`, err);
    res.json({
      success: false,
      albumItems: [],
      albumCount: 0
    });
  }
});

// POST /api/download
router.post('/download', async (req, res) => {
  try {
    const { url, isZip, site, id, ext } = req.body;
    if (!url) return res.json({ success: false, error: 'URL не указан' });

    const downloadsDir = path.join(ROOT_DIR, 'downloads');
    if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });

    const filename = `${site}_${id}.${ext || (isZip ? 'zip' : 'jpg')}`;
    const filePath = path.join(downloadsDir, filename);

    logInfo('Download', `Скачивание: ${url}`);
    const response = await fetchSafe(url, { timeout: 60000 });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!response.body) throw new Error('Пустой ответ от источника');

    // Stream straight to disk - buffering the whole file in RAM and writing it
    // synchronously used to stall the entire event loop on big archives
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(filePath));

    if (isZip) {
      logInfo('Download', `Распаковка ZIP: ${filePath}`);
      const zip = new AdmZip(filePath);
      const extractPath = path.join(downloadsDir, `${site}_${id}_unzipped`);
      zip.extractAllTo(extractPath, true);
      open(extractPath);
    } else {
      open(downloadsDir);
    }

    res.json({ success: true });
  } catch (err) {
    logError('Download', 'Ошибка скачивания', err);
    res.json({ success: false, error: err.message });
  }
});

// GET /api/tags/autocomplete
router.get('/tags/autocomplete', async (req, res) => {
  const rawQuery = (req.query.q || req.query.query || '').trim();
  if (!rawQuery) return res.json({ tags: [] });

  // Normalize: replace spaces with underscores (hu ta -> hu_ta)
  const query = rawQuery.replace(/\s+/g, '_');
  const site = req.query.site || 'danbooru';

  const settings = { ...getSettings(), ...parseClientAuth(req) };

  const cacheKey = `${site}:${query.toLowerCase()}`;
  const cached = tagAutocompleteCache.get(cacheKey);
  if (cached && Array.isArray(cached) && cached.length > 0) {
    return res.json({ tags: cached });
  }

  // Universal query against Danbooru as the tag reference
  const fetchDanbooruTags = async (q) => {
    try {
      const url = `https://danbooru.donmai.us/tags.json?search[name_matches]=*${encodeURIComponent(q)}*&limit=15&search[order]=count`;
      const resp = await fetchSafe(url, { timeout: 3500 });
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data)) {
          return data.map(item => ({
            value: item.name,
            label: item.name.replace(/_/g, ' '),
            count: item.post_count || 0,
            category: item.category === 1 ? 'artist' : item.category === 3 ? 'copyright' : item.category === 4 ? 'character' : item.category === 5 ? 'meta' : 'general'
          }));
        }
      }
    } catch {}
    return [];
  };

  try {
    let tagsResult = [];

    if (site === 'danbooru') {
      tagsResult = await fetchDanbooruTags(query);
    } else if (site === 'rule34') {
      const authQuery = (settings?.rule34ApiKey && settings?.rule34UserId)
        ? `&api_key=${encodeURIComponent(settings.rule34ApiKey)}&user_id=${encodeURIComponent(settings.rule34UserId)}`
        : '';
      try {
        const url = `https://api.rule34.xxx/autocomplete.php?q=${encodeURIComponent(query.toLowerCase())}${authQuery}`;
        const resp = await fetchSafe(url, { 
          headers: { 'Referer': 'https://rule34.xxx/' },
          timeout: 3000 
        });
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data) && data.length > 0) {
            tagsResult = data.map(item => {
              const val = typeof item === 'string' ? item : (item.value || item.label || '');
              const total = typeof item === 'object' ? (parseInt(item.total || item.count, 10) || 0) : 0;
              const type = typeof item === 'object' ? (item.type || 'general') : 'general';
              return {
                value: val,
                label: val.replace(/_/g, ' '),
                count: total,
                category: type
              };
            });
          }
        }
      } catch {}

      if (tagsResult.length === 0) {
        tagsResult = await fetchDanbooruTags(query);
      }
    } else if (site === 'gelbooru') {
      try {
        const url = `https://gelbooru.com/index.php?page=autocomplete2&term=${encodeURIComponent(query.toLowerCase())}&type=tag_query&limit=15`;
        const resp = await fetchSafe(url, {
          headers: { 'Referer': 'https://gelbooru.com/' },
          timeout: 3000
        });
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data) && data.length > 0) {
            tagsResult = data.map(item => ({
              value: item.value || item.label,
              label: (item.label || item.value || '').replace(/_/g, ' '),
              count: parseInt(item.post_count || item.count, 10) || 0,
              category: item.category || 'general'
            }));
          }
        }
      } catch {}

      if (tagsResult.length === 0) {
        tagsResult = await fetchDanbooruTags(query);
      }
    } else if (site === 'yandere' || site === 'konachan') {
      const base = site === 'yandere' ? 'https://yande.re' : 'https://konachan.com';
      try {
        const url = `${base}/tag.json?name=${encodeURIComponent(query)}&limit=15&order=count`;
        const resp = await fetchSafe(url, { timeout: 3000 });
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data) && data.length > 0) {
            tagsResult = data.map(item => ({
              value: item.name,
              label: item.name.replace(/_/g, ' '),
              count: item.count || 0,
              category: item.type === 1 ? 'artist' : item.type === 3 ? 'copyright' : item.type === 4 ? 'character' : 'general'
            }));
          }
        }
      } catch {}

      if (tagsResult.length === 0) {
        tagsResult = await fetchDanbooruTags(query);
      }
    } else if (site === 'rule34video') {
      try {
        const modelJsonUrl = `https://rule34video.com/models_json.php?advanced_search=true&q=${encodeURIComponent(query)}`;
        const resModels = await fetchSafe(modelJsonUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'X-Requested-With': 'XMLHttpRequest'
          },
          timeout: 4000
        });
        if (resModels.ok) {
          const data = await resModels.json();
          if (data && Array.isArray(data.items) && data.items.length > 0) {
            const seen = new Set();
            for (const item of data.items) {
              const name = (item.title || '').trim();
              if (name && !seen.has(name.toLowerCase())) {
                seen.add(name.toLowerCase());
                const totalCount = parseInt(item.total, 10) || 0;
                tagsResult.push({
                  value: `artist:${name.toLowerCase().replace(/\s+/g, '_')}`,
                  label: `🎨 ${name} (${totalCount} видео)`,
                  count: totalCount,
                  category: 'artist'
                });
              }
            }
          }
        }
      } catch {}
      const danbooruTags = await fetchDanbooruTags(query);
      tagsResult = [...tagsResult, ...danbooruTags];
    } else if (site === 'safebooru') {
      try {
        const url = `https://safebooru.org/autocomplete.php?q=${encodeURIComponent(query.toLowerCase())}`;
        const resp = await fetchSafe(url, { timeout: 3000 });
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data) && data.length > 0) {
            tagsResult = data.map(item => ({
              value: item.value || item.label,
              label: (item.label || item.value || '').replace(/_/g, ' '),
              count: parseInt(item.total || item.count, 10) || 0,
              category: 'general'
            }));
          }
        }
      } catch {}

      if (tagsResult.length === 0) {
        tagsResult = await fetchDanbooruTags(query);
      }
    } else if (site === 'pawchive') {
      try {
        const { list } = await getCreatorsDirectory();
        if (Array.isArray(list) && list.length > 0) {
          const cleanQ = query.toLowerCase().replace(/[\s_.-]+/g, '');
          const matches = list.filter(c => {
            const nameClean = (c.name || '').toLowerCase().replace(/[\s_.-]+/g, '');
            return nameClean.includes(cleanQ) || (c.service && c.service.toLowerCase().includes(cleanQ));
          }).slice(0, 15);

          tagsResult = matches.map(c => ({
            value: `artist:${(c.name || '').toLowerCase().replace(/[\s_.-]+/g, '_')}`,
            label: `🎨 ${c.name} (${c.service})`,
            count: 0,
            category: 'artist'
          }));
        }
      } catch {}
    } else {
      tagsResult = await fetchDanbooruTags(query);
    }

    if (tagsResult.length > 0) {
      tagAutocompleteCache.set(cacheKey, tagsResult);
    }

    res.json({ tags: tagsResult });
  } catch (err) {
    res.json({ tags: [] });
  }
});

export default router;
