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
  ROOT_DIR,
  BROWSER_USER_AGENT
} from '../config/constants.js';
import { apiPostsCache, tagAutocompleteCache } from '../services/cacheService.js';
import { getSettings } from '../services/storageService.js';
import { fetchPosts } from '../parsers/index.js';
import { getCreatorsDirectory, fetchPawchivePostById, getPawchiveServices } from '../parsers/pawchive.js';
import { groupPostsIntoAlbums } from '../utils/albumHelper.js';
import { fetchSafe, safeJsonParse } from '../utils/network.js';
import { logInfo, logError } from '../utils/logger.js';

const router = express.Router();

// Client settings fields that affect filtering results - they are part of the cache key
const AUTH_CACHE_FIELDS = [
  'blacklist', 'curvyTags', 'petiteTags', 'furryTags', 'pregnantTags', 'lgbtTags',
  'aiTags', 'prioritizeUserTags', 'deepFetchPages', 'hideFurry', 'hidePregnant', 'hideLgbt', 'hideZipPosts', 'customSources',
  'rule34ApiKey', 'rule34UserId', 'gelbooruApiKey', 'gelbooruUserId', 'danbooruApiKey', 'danbooruLogin',
  'konachanLogin', 'konachanPassword', 'yandereLogin', 'yanderePassword',
  'globalProxy', 'danbooruProxy', 'gelbooruProxy', 'rule34Proxy', 'yandereProxy', 'konachanProxy',
  'safebooruProxy', 'rule34videoProxy', 'xbooruProxy', 'hypnohubProxy', 'tbibProxy', 'pawchiveProxy'
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

// POST /api/sites/auth-test - validate board credentials typed in the settings modal
const AUTH_TEST_TIMEOUT_MS = 8000;
const MOEBOORU_PASSWORD_SALT = 'So-I-Heard-You-Like-Mupkids-?--';

async function readJsonSafe(res) {
  try {
    return safeJsonParse(await res.text(), null);
  } catch {
    return null;
  }
}

async function runAuthTest(site, creds, settings = {}) {
  const login = String(creds.login || '').trim();
  const apiKey = String(creds.apiKey || '').trim();
  const userId = String(creds.userId || '').trim();
  const password = String(creds.password || '').trim();

  if (site === 'danbooru') {
    if (!login || !apiKey) return { success: false, message: 'Введите логин и API ключ Danbooru' };
    let res;
    try {
      res = await fetchSafe(`https://danbooru.donmai.us/profile.json?login=${encodeURIComponent(login)}&api_key=${encodeURIComponent(apiKey)}`, { 
        timeout: AUTH_TEST_TIMEOUT_MS, 
        settings, 
        site: 'danbooru' 
      });
    } catch {
      return { success: false, message: 'Danbooru недоступен' };
    }
    // 401/403 is the site's explicit rejection of bad credentials
    if (res.status === 401 || res.status === 403) return { success: false, message: 'Danbooru: неверный логин или API ключ' };
    if (res.ok) {
      const data = await readJsonSafe(res);
      if (data && data.name) return { success: true, message: `Danbooru: вход выполнен как ${data.name}` };
      return { success: false, message: 'Danbooru: неожиданный ответ сервера' };
    }
    return { success: false, message: `Danbooru: ошибка сайта (HTTP ${res.status})` };
  }

  if (site === 'konachan' || site === 'yandere') {
    const siteName = site === 'yandere' ? 'Yande.re' : 'Konachan';
    const base = site === 'yandere' ? 'https://yande.re' : 'https://konachan.com';
    if (!login || !password) return { success: false, message: `Введите логин и пароль ${siteName}` };
    const hash = crypto.createHash('sha1').update(`${MOEBOORU_PASSWORD_SALT}${password}--`).digest('hex');
    let res;
    try {
      // user/show.json denies anonymous access, so bad credentials fall back to the anonymous 403
      res = await fetchSafe(`${base}/user/show.json?name=${encodeURIComponent(login)}&login=${encodeURIComponent(login)}&password_hash=${hash}`, { 
        timeout: AUTH_TEST_TIMEOUT_MS, 
        settings, 
        site 
      });
    } catch {
      return { success: false, message: `${siteName} недоступен` };
    }
    if (res.status === 401 || res.status === 403) return { success: false, message: `${siteName}: неверный логин или пароль` };
    if (res.ok) {
      const data = await readJsonSafe(res);
      if (data && data.name) return { success: true, message: `${siteName}: вход выполнен как ${data.name}` };
    }
    // The show action only responds in HTML, so valid credentials that pass the auth filter
    // end up as 406 (or 404 when the profile name lookup redirects). Both mean "authenticated".
    if (res.status === 406 || res.status === 404) return { success: true, message: `${siteName}: вход выполнен как ${login}` };
    return { success: false, message: `${siteName}: ошибка сайта (HTTP ${res.status})` };
  }

  if (site === 'gelbooru') {
    if (!apiKey || !userId) return { success: false, message: 'Введите API ключ и User ID Gelbooru' };
    let res;
    try {
      res = await fetchSafe(`https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&limit=1&tags=1girl&api_key=${encodeURIComponent(apiKey)}&user_id=${encodeURIComponent(userId)}`, { 
        timeout: AUTH_TEST_TIMEOUT_MS, 
        headers: { 'Referer': 'https://gelbooru.com/' },
        settings, 
        site: 'gelbooru' 
      });
    } catch {
      return { success: false, message: 'Gelbooru недоступен' };
    }
    if (res.ok) {
      const data = await readJsonSafe(res);
      if (data && (data['@attributes'] || Array.isArray(data.posts))) return { success: true, message: 'Gelbooru: ключ принят' };
      return { success: false, message: 'Gelbooru: неверный API ключ или User ID' };
    }
    if (res.status === 401 || res.status === 403) return { success: false, message: 'Gelbooru: неверный API ключ или User ID' };
    return { success: false, message: `Gelbooru: ошибка сайта (HTTP ${res.status})` };
  }

  if (site === 'rule34') {
    if (!apiKey || !userId) return { success: false, message: 'Введите API ключ и User ID Rule34' };
    let res;
    try {
      res = await fetchSafe(`https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&json=1&limit=1&tags=1girl&api_key=${encodeURIComponent(apiKey)}&user_id=${encodeURIComponent(userId)}`, { 
        timeout: AUTH_TEST_TIMEOUT_MS, 
        headers: { 'Referer': 'https://rule34.xxx/' },
        settings, 
        site: 'rule34' 
      });
    } catch {
      return { success: false, message: 'Rule34 недоступен' };
    }
    if (res.ok) {
      // Bad credentials get HTTP 200 with a "Missing authentication" string instead of a posts array
      const data = await readJsonSafe(res);
      if (Array.isArray(data)) return { success: true, message: 'Rule34: ключ принят' };
      return { success: false, message: 'Rule34: неверный API ключ или User ID' };
    }
    if (res.status === 401 || res.status === 403) return { success: false, message: 'Rule34: неверный API ключ или User ID' };
    return { success: false, message: `Rule34: ошибка сайта (HTTP ${res.status})` };
  }

  return { success: false, message: 'Для этого сайта нет данных для проверки' };
}

router.post('/sites/auth-test', async (req, res) => {
  try {
    const { site } = req.body || {};
    if (!site || !SITES[site]) {
      return res.status(400).json({ success: false, message: 'Неизвестный сайт' });
    }
    const settings = { ...getSettings(), ...parseClientAuth(req) };
    const result = await runAuthTest(site, req.body || {}, settings);
    res.json(result);
  } catch (err) {
    logError('AuthTest', 'Ошибка проверки авторизации', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/proxy/test - test a proxy connection for a specific board or globally
router.post('/proxy/test', async (req, res) => {
  try {
    const { site, proxyUrl } = req.body || {};
    if (!proxyUrl || typeof proxyUrl !== 'string' || !proxyUrl.trim()) {
      return res.status(400).json({ success: false, message: 'Укажите URL прокси (например: http://127.0.0.1:8080 или socks5://127.0.0.1:1080)' });
    }

    const cleanProxy = proxyUrl.trim();
    const siteConfig = site && SITES[site] ? SITES[site] : null;
    const testTargetUrl = siteConfig ? `${siteConfig.baseUrl}/` : 'https://danbooru.donmai.us/';
    const targetName = siteConfig ? siteConfig.name : 'интернет';

    logInfo('ProxyTest', `Проверка прокси ${cleanProxy} для ${site || 'общий'}: ${testTargetUrl}`);

    const response = await fetchSafe(testTargetUrl, {
      proxy: cleanProxy,
      timeout: 10000,
      headers: {
        'User-Agent': BROWSER_USER_AGENT
      }
    });

    if (response.ok || response.status === 403 || response.status === 401 || response.status === 406 || response.status === 302 || response.status === 301) {
      const note = response.status === 403 ? ' (Cloudflare)' : '';
      return res.json({
        success: true,
        status: response.status,
        message: `Прокси работает: получен ответ от ${targetName} (HTTP ${response.status}${note})`
      });
    }

    return res.json({
      success: false,
      status: response.status,
      message: `Сервер ${targetName} ответил кодом HTTP ${response.status}`
    });
  } catch (err) {
    logError('ProxyTest', 'Ошибка проверки прокси', err);
    let detail = err.cause ? (err.cause.message || String(err.cause)) : (err.message || 'Таймаут или сбой соединения');
    if (err.name === 'AbortError' || String(detail).includes('aborted')) {
      detail = 'Превышено время ожидания ответа (таймаут)';
    } else if (String(detail).includes('authentication timeout')) {
      detail = 'Таймаут авторизации SOCKS5 (прокси не отвечает)';
    } else if (String(detail).includes('ECONNREFUSED')) {
      detail = 'Соединение отклонено (прокси выключен или неверный порт)';
    } else if (String(detail).includes('ENOTFOUND')) {
      detail = 'Хост прокси не найден (неверный адрес)';
    }
    return res.json({
      success: false,
      message: `Ошибка подключения через прокси: ${detail}`
    });
  }
});

// GET /api/sites
router.get('/sites', (req, res) => {
  res.json({ sites: Object.values(SITES) });
});

// GET /api/pawchive-services - active Pawchive platforms (patreon, fanbox, ...) for the dropdown
router.get('/pawchive-services', async (req, res) => {
  try {
    const services = await getPawchiveServices();
    res.json({ success: true, services });
  } catch (err) {
    logError('Search', 'Ошибка получения списка платформ Pawchive', err);
    res.json({ success: false, services: [] });
  }
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
    const pawchiveServiceRaw = String(req.query.pawchiveService || '').trim().toLowerCase();
    const pawchiveService = /^[a-z0-9_-]+$/.test(pawchiveServiceRaw) ? pawchiveServiceRaw : '';

    // Check the in-memory cache (for everything except random)
    let clientAuth = parseClientAuth(req);
    const baseSettings = getSettings();
    const settings = {
      ...baseSettings,
      ...clientAuth
    };

    // groupAlbums changes the response shape (album collapsing), so it belongs in the key
    const cacheKey = `${site}:${tags}:${page}:${limit}:${category}:${aiFilter}:${ratingFilter}:${typeFilter}:${ageFilter}:${dateFilter}:${hideFurry}:${hidePregnant}:${hideLgbt}:${excludeSites}:${customSites}:${pawchiveService}:albums=${req.query.groupAlbums !== 'false'}:${buildAuthCacheKey(clientAuth, settings)}`;
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
      pawchiveService,
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
    const currentSettings = getSettings();
    const response = await fetchSafe(url, { timeout: 60000, settings: currentSettings, site });
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
      const resp = await fetchSafe(url, { timeout: 3500, settings, site: 'danbooru' });
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
          timeout: 3000,
          settings,
          site: 'rule34'
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
                category: type === 'tag' ? 'general' : type
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
          timeout: 3000,
          settings,
          site: 'gelbooru'
        });
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data) && data.length > 0) {
            tagsResult = data.map(item => {
              let cat = 'general';
              const rawCat = String(item.category || '').toLowerCase();
              if (rawCat === '1' || rawCat === 'artist') cat = 'artist';
              else if (rawCat === '3' || rawCat === 'copyright') cat = 'copyright';
              else if (rawCat === '4' || rawCat === 'character') cat = 'character';
              else if (rawCat === '5' || rawCat === '6' || rawCat === 'metadata' || rawCat === 'meta') cat = 'meta';

              return {
                value: item.value || item.label,
                label: (item.label || item.value || '').replace(/_/g, ' '),
                count: parseInt(item.post_count || item.count, 10) || 0,
                category: cat
              };
            });
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
        const resp = await fetchSafe(url, { timeout: 3000, settings, site });
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data) && data.length > 0) {
            tagsResult = data.map(item => ({
              value: item.name,
              label: item.name.replace(/_/g, ' '),
              count: item.count || 0,
              category: item.type === 1 ? 'artist' : item.type === 3 ? 'copyright' : item.type === 4 ? 'character' : item.type === 6 ? 'meta' : 'general'
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
          timeout: 4000,
          settings,
          site: 'rule34video'
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
        const resp = await fetchSafe(url, { timeout: 3000, settings, site: 'safebooru' });
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
        const { list } = await getCreatorsDirectory(settings);
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
