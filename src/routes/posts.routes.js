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
import { fetchSafe } from '../utils/network.js';
import { logInfo, logError } from '../utils/logger.js';

const router = express.Router();

// GET /api/sites
router.get('/sites', (req, res) => {
  res.json({ sites: Object.values(SITES) });
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
    const excludeSites = req.query.excludeSites || '';

    // Проверка кэша в оперативной памяти (для всего кроме random)
    const cacheKey = `${site}:${tags}:${page}:${limit}:${category}:${aiFilter}:${ratingFilter}:${typeFilter}:${ageFilter}:${hideFurry}:${hidePregnant}:${excludeSites}`;
    if (category !== 'random') {
      const cached = apiPostsCache.get(cacheKey);
      if (cached) {
        return res.json(cached);
      }
    }

    const settings = getSettings();
    const aiTagsList = settings.aiTags || DEFAULT_AI_TAGS;
    const blacklist = settings.blacklist || [];

    logInfo('Search', `Запрос: site=${site}, tags="${tags}", page=${page}, rating=${ratingFilter}, type=${typeFilter}, age=${ageFilter}, exclude=${excludeSites}`);

    let posts = await fetchPosts(site, { tags, page, limit, category, ratingFilter, typeFilter, ageFilter, excludeSites }, aiTagsList, settings);

    // Фильтр типа контента (Видео / Со звуком / Фото)
    if (typeFilter === 'audio' || typeFilter === 'sound') {
      posts = posts.filter(p => p.isVideo && p.hasSound);
    } else if (typeFilter === 'video') {
      posts = posts.filter(p => p.isVideo || p.isGif);
    } else if (typeFilter === 'image') {
      posts = posts.filter(p => !p.isVideo && !p.isGif);
    }

    // Фильтр телосложения и типажей (Мамочки/Пышные vs Лоли/Мини)
    const userSettings = getSettings();
    const activeCurvyTags = (Array.isArray(userSettings.curvyTags) && userSettings.curvyTags.length > 0) ? userSettings.curvyTags : CURVY_INCLUDE_TAGS;
    const activePetiteTags = (Array.isArray(userSettings.petiteTags) && userSettings.petiteTags.length > 0) ? userSettings.petiteTags : PETITE_INCLUDE_TAGS;

    if (ageFilter === 'adult') {
      posts = posts.filter(post => {
        const postTags = Array.isArray(post.tags) ? post.tags.map(t => t.toLowerCase()) : [];
        if (CURVY_EXCLUDE_TAGS.some(tag => postTags.includes(tag))) return false;
        if (!tags && !activeCurvyTags.some(tag => postTags.includes(tag))) return false;
        return true;
      });
    } else if (ageFilter === 'young') {
      posts = posts.filter(post => {
        const postTags = Array.isArray(post.tags) ? post.tags.map(t => t.toLowerCase()) : [];
        if (PETITE_EXCLUDE_TAGS.some(tag => postTags.includes(tag))) return false;
        if (!tags && !activePetiteTags.some(tag => postTags.includes(tag))) return false;
        return true;
      });
    }

    // Локальная фильтрация по запрошенным тегам
    if (tags && site !== 'rule34video') {
      const searchTokens = tags
        .toLowerCase()
        .replace(/([a-zA-Z0-9_-]+)_\(([^)]+)\)/g, '$1 $2')
        .replace(/([a-zA-Z0-9_-]+)\s*\(([^)]+)\)/g, '$1 $2')
        .replace(/[()]/g, '')
        .split(/\s+/)
        .map(t => t.trim())
        .filter(Boolean);

      if (searchTokens.length > 0) {
        posts = posts.filter(post => {
          const postTags = Array.isArray(post.tags) ? post.tags.map(t => (typeof t === 'string' ? t.toLowerCase() : String(t || '').toLowerCase())) : [];
          const postTagsFlat = postTags.join(' ');
          const titleLower = String(post.title || '').toLowerCase();
          const authorLower = String(post.author || '').toLowerCase();

          return searchTokens.every(token => {
            if (token.startsWith('-')) {
              const neg = token.substring(1).replace(/_/g, ' ');
              const negUnderscore = token.substring(1);
              return !postTags.includes(negUnderscore) && !postTagsFlat.includes(neg) && !titleLower.includes(neg);
            }
            if (token.includes(':')) return true;

            const tokenNorm = token.replace(/_/g, ' ');
            const inTags = postTags.some(t => t === token || t === tokenNorm || t.includes(token) || t.includes(tokenNorm)) || 
                           postTagsFlat.includes(token) || 
                           postTagsFlat.includes(tokenNorm);
            const inTitle = titleLower.includes(tokenNorm) || titleLower.includes(token);
            const inAuthor = authorLower.includes(tokenNorm) || authorLower.includes(token);

            return inTags || inTitle || inAuthor;
          });
        });
      }
    }

    // AI Фильтр
    if (aiFilter === 'no-ai') {
      posts = posts.filter(p => !p.isAi);
    } else if (aiFilter === 'only-ai') {
      posts = posts.filter(p => p.isAi);
    }

    // Возрастной рейтинг
    if (ratingFilter === 'nsfw') {
      posts = posts.filter(p => {
        const r = (p.rating || '').toLowerCase();
        return r === 'e' || r === 'q' || r === 'explicit' || r === 'questionable' || r === 'sensitive' || r === '?';
      });
    } else if (ratingFilter === 'sfw') {
      posts = posts.filter(p => {
        const r = (p.rating || '').toLowerCase();
        return r === 's' || r === 'g' || r === 'safe' || r === 'general';
      });
    }

    // Фильтр фурри
    if (hideFurry || settings.hideFurry) {
      posts = posts.filter(post => {
        const postTags = Array.isArray(post.tags) ? post.tags.map(t => t.toLowerCase()) : [];
        return !FURRY_TAGS.some(fTag => postTags.some(t => t === fTag || t.startsWith(fTag + '_') || t.endsWith('_' + fTag)));
      });
    }

    // Фильтр беременности
    if (hidePregnant || settings.hidePregnant) {
      posts = posts.filter(post => {
        const postTags = Array.isArray(post.tags) ? post.tags.map(t => t.toLowerCase()) : [];
        return !PREGNANT_TAGS.some(pTag => postTags.some(t => t === pTag || t.includes(pTag)));
      });
    }

    // Черный список
    if (blacklist.length > 0) {
      const lowerBlacklist = blacklist.map(b => b.toLowerCase().trim()).filter(Boolean);
      posts = posts.filter(post => {
        const postTags = Array.isArray(post.tags) ? post.tags.map(t => t.toLowerCase()) : [];
        return !lowerBlacklist.some(blackTag => postTags.includes(blackTag));
      });
    }

    // Локальная сортировка
    if (category === 'top' && site !== 'all') {
      posts.sort((a, b) => (b.score || 0) - (a.score || 0));
    }

    // Фильтрация невалидных/пустых постов
    posts = posts.filter(post => post && (post.fileUrl || post.sampleUrl || post.previewUrl));

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
  const query = (req.query.q || '').trim();
  const site = req.query.site || 'danbooru';
  if (!query) return res.json({ tags: [] });

  const cacheKey = `${site}:${query.toLowerCase()}`;
  const cached = tagAutocompleteCache.get(cacheKey);
  if (cached) {
    return res.json({ tags: cached });
  }

  try {
    let tagsResult = [];

    if (site === 'danbooru' || site === 'all' || site === 'rule34') {
      try {
        const url = `https://danbooru.donmai.us/tags.json?search[name_matches]=${encodeURIComponent(query)}*&limit=15&search[order]=count`;
        const resp = await fetchSafe(url, { timeout: 4000 });
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data)) {
            tagsResult = data.map(item => ({
              value: item.name,
              label: item.name.replace(/_/g, ' '),
              count: item.post_count || 0,
              category: item.category === 1 ? 'artist' : item.category === 3 ? 'copyright' : item.category === 4 ? 'character' : item.category === 5 ? 'meta' : 'general'
            }));
          }
        }
      } catch {}
      
      if (tagsResult.length === 0) {
        try {
          const fallbackUrl = `https://safebooru.org/autocomplete.php?q=${encodeURIComponent(query.toLowerCase())}`;
          const resp = await fetchSafe(fallbackUrl, { timeout: 3500 });
          if (resp.ok) {
            const data = await resp.json();
            if (Array.isArray(data)) {
              tagsResult = data.map(item => ({
                value: item.value,
                label: item.label || item.value.replace(/_/g, ' '),
                count: parseInt(item.total, 10) || 0,
                category: 'general'
              }));
            }
          }
        } catch {}
      }
    } else if (site === 'yandere' || site === 'konachan') {
      const base = site === 'yandere' ? 'https://yande.re' : 'https://konachan.net';
      const url = `${base}/tag.json?name=${encodeURIComponent(query)}&limit=15`;
      const resp = await fetchSafe(url, { timeout: 4000 });
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data)) {
          tagsResult = data.map(item => ({
            value: item.name,
            label: item.name.replace(/_/g, ' '),
            count: item.count || 0,
            category: item.type === 1 ? 'artist' : item.type === 3 ? 'copyright' : item.type === 4 ? 'character' : 'general'
          }));
        }
      }
    } else {
      const url = `https://safebooru.org/autocomplete.php?q=${encodeURIComponent(query.toLowerCase())}`;
      const resp = await fetchSafe(url, { timeout: 4000 });
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data)) {
          tagsResult = data.map(item => ({
            value: item.value,
            label: item.label || item.value.replace(/_/g, ' '),
            count: parseInt(item.total, 10) || 0,
            category: 'general'
          }));
        }
      }
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
