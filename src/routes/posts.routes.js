import express from 'express';
import fs from 'fs';
import path from 'path';
import open from 'open';
import AdmZip from 'adm-zip';
import { 
  SITES, 
  DEFAULT_AI_TAGS, 
  FURRY_TAGS, 
  PREGNANT_TAGS, 
  CURVY_INCLUDE_TAGS, 
  CURVY_EXCLUDE_TAGS, 
  PETITE_INCLUDE_TAGS, 
  PETITE_EXCLUDE_TAGS,
  ROOT_DIR
} from '../config/constants.js';
import { apiPostsCache, tagAutocompleteCache } from '../services/cacheService.js';
import { getSettings } from '../services/storageService.js';
import { fetchPosts } from '../parsers/index.js';
import { isPostMatchingFilters } from '../utils/tagHelpers.js';
import { fetchSafe } from '../utils/network.js';
import { logInfo, logError } from '../utils/logger.js';

const router = express.Router();

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
    const hideFurry = req.query.hideFurry === 'true' || req.query.hideFurry === '1';
    const hidePregnant = req.query.hidePregnant === 'true' || req.query.hidePregnant === '1';
    const hideLgbt = req.query.hideLgbt === 'true' || req.query.hideLgbt === '1';
    const excludeSites = req.query.excludeSites || '';
    const customSites = req.query.customSites || '';

    // Проверка кэша в оперативной памяти (для всего кроме random)
    const cacheKey = `${site}:${tags}:${page}:${limit}:${category}:${aiFilter}:${ratingFilter}:${typeFilter}:${ageFilter}:${hideFurry}:${hidePregnant}:${hideLgbt}:${excludeSites}:${customSites}`;
    if (category !== 'random' && !req.query._t && !req.query._bust && !req.query._reload) {
      const cached = apiPostsCache.get(cacheKey);
      if (cached && Array.isArray(cached.posts) && cached.posts.length > 0) {
        return res.json(cached);
      }
    }

    let clientAuth = {};
    if (req.headers['x-booru-auth']) {
      try {
        clientAuth = JSON.parse(decodeURIComponent(req.headers['x-booru-auth']));
      } catch {
        try { clientAuth = JSON.parse(req.headers['x-booru-auth']); } catch {}
      }
    }

    const baseSettings = getSettings();
    const settings = {
      ...baseSettings,
      ...clientAuth
    };

    const aiTagsList = settings.aiTags || DEFAULT_AI_TAGS;
    const blacklist = settings.blacklist || [];

    logInfo('Search', `Запрос: site=${site}, tags="${tags}", page=${page}, rating=${ratingFilter}, type=${typeFilter}, age=${ageFilter}, exclude=${excludeSites}, customSites=${customSites}`);

    let posts = await fetchPosts(site, { 
      tags, 
      page, 
      limit, 
      category, 
      ratingFilter, 
      typeFilter, 
      ageFilter, 
      excludeSites,
      customSites,
      hideFurry,
      hidePregnant,
      hideLgbt
    }, aiTagsList, settings);

    // Дополнительная валидация и сортировка
    const activeCurvyTags = (Array.isArray(settings.curvyTags) && settings.curvyTags.length > 0) ? settings.curvyTags : CURVY_INCLUDE_TAGS;
    const activePetiteTags = (Array.isArray(settings.petiteTags) && settings.petiteTags.length > 0) ? settings.petiteTags : PETITE_INCLUDE_TAGS;
    const negativeTokens = tags
      ? tags.split(/\s+/).filter(t => t.startsWith('-') && t.length > 1).map(t => t.substring(1).toLowerCase().replace(/_/g, ' '))
      : [];
    const hasUserPositiveTags = Boolean(tags && tags.split(/\s+/).some(t => t && !t.startsWith('-') && !t.includes(':')));

    posts = posts.filter(post => isPostMatchingFilters(post, {
      typeFilter,
      ageFilter,
      aiFilter,
      ratingFilter,
      hideFurry: hideFurry || settings.hideFurry,
      hidePregnant: hidePregnant || settings.hidePregnant,
      hideLgbt: hideLgbt || settings.hideLgbt,
      blacklist,
      negativeTokens,
      activeCurvyTags,
      activePetiteTags,
      hasUserPositiveTags
    }));

    if (category === 'top' && site !== 'all') {
      posts.sort((a, b) => (b.score || 0) - (a.score || 0));
    }

    logInfo('Search', `Успешно: найдено ${posts.length} постов для выдачи`);

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
    res.json({
      success: true,
      site: req.query.site || 'danbooru',
      page: 1,
      count: 0,
      posts: []
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

    const buffer = await response.arrayBuffer();
    fs.writeFileSync(filePath, Buffer.from(buffer));

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

  // Нормализация: заменяем пробелы на подчеркивания (hu ta -> hu_ta)
  const query = rawQuery.replace(/\s+/g, '_');
  const site = req.query.site || 'danbooru';

  let clientAuth = {};
  if (req.headers['x-booru-auth']) {
    try {
      clientAuth = JSON.parse(decodeURIComponent(req.headers['x-booru-auth']));
    } catch {
      try { clientAuth = JSON.parse(req.headers['x-booru-auth']); } catch {}
    }
  }

  const settings = { ...getSettings(), ...clientAuth };

  const cacheKey = `${site}:${query.toLowerCase()}`;
  const cached = tagAutocompleteCache.get(cacheKey);
  if (cached && Array.isArray(cached) && cached.length > 0) {
    return res.json({ tags: cached });
  }

  // Универсальный запрос к Danbooru как эталону тегов
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
      const base = site === 'yandere' ? 'https://yande.re' : 'https://konachan.net';
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
