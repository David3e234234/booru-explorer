import express from 'express';
import fs from 'fs';
import path from 'path';
import { spawn, exec } from 'child_process';
import { THUMBS_DIR, VIDEOS_DIR, PORT, ROOT_DIR } from '../config/constants.js';
import { 
  getSettings, 
  updateSettings, 
  getFavorites, 
  saveFavorites, 
  getFavoriteAuthors, 
  saveFavoriteAuthors, 
  getLikes, 
  saveLikes, 
  getDislikes, 
  saveDislikes, 
  clearDislikes, 
  sendBooruLike,
  sendBooruFavorite,
  sendBooruAuthorFollow
} from '../services/storageService.js';
import { 
  apiPostsCache, 
  tagAutocompleteCache, 
  getDirectoryStats,
  cleanDiskCacheIfNeeded
} from '../services/cacheService.js';
import { getLocalIpAddress } from '../utils/network.js';
import { logInfo, logError } from '../utils/logger.js';
import { authMiddleware } from '../services/userService.js';
import { testTelegramBot, performTelegramBackup } from '../services/backupService.js';

const router = express.Router();

// Authentication middleware for all user routes
router.use(authMiddleware);

// Store the minimum: album items are full post copies (huge JSON bloat),
// and duplicate series keys are recomputed at render time
function sanitizeStoredPost(post) {
  if (!post || typeof post !== 'object') return post;
  const clean = { ...post };
  delete clean.albumItems;
  delete clean.allSeriesKeys;
  delete clean._archiveUnpacked;
  delete clean._archivePromise;
  delete clean._unpackedZips;
  return clean;
}

// GET & POST /api/git-pull (deploy hook for Alwaysdata / servers)
router.all('/git-pull', (req, res) => {
  exec('git reset --hard origin/main && git pull origin main', { cwd: ROOT_DIR }, (err, stdout, stderr) => {
    if (err) {
      return res.status(500).json({ success: false, error: err.message, stderr });
    }
    try {
      const restartFile = path.join(ROOT_DIR, 'tmp', 'restart.txt');
      if (!fs.existsSync(path.dirname(restartFile))) fs.mkdirSync(path.dirname(restartFile), { recursive: true });
      fs.writeFileSync(restartFile, 'reloaded at ' + new Date().toISOString());
    } catch {}
    res.json({ success: true, stdout, stderr, time: new Date().toISOString() });

    // Restart the process to load the new code into memory immediately
    setTimeout(() => {
      process.exit(0);
    }, 500);
  });
});

// GET /api/settings
router.get('/settings', (req, res) => {
  const userId = req.user?.id || null;
  res.json({ success: true, settings: getSettings(userId) });
});

// POST /api/settings
router.post('/settings', (req, res) => {
  const userId = req.user?.id || null;
  const updated = updateSettings(req.body || {}, userId);
  if (req.body && req.body.maxServerCacheMb !== undefined) {
    cleanDiskCacheIfNeeded();
  }
  res.json({ success: true, settings: updated });
});

// GET /api/favorites
router.get('/favorites', (req, res) => {
  const userId = req.user?.id || null;
  const favorites = getFavorites(userId);
  res.json({ success: true, favorites });
});

// POST /api/favorites
router.post('/favorites', (req, res) => {
  const post = req.body;
  if (!post || !post.id) return res.status(400).json({ success: false, message: 'Некорректные данные' });

  const userId = req.user?.id || null;
  const favorites = getFavorites(userId);
  const existsIndex = favorites.findIndex(f => f.id === post.id);
  const clientAuth = parseClientAuth(req);
  const settings = { ...getSettings(userId), ...clientAuth, ...(req.body?.settings || {}) };
  let isFavorite = false;

  if (existsIndex >= 0) {
    favorites.splice(existsIndex, 1);
    saveFavorites(favorites, userId);
    isFavorite = false;
  } else {
    favorites.unshift({ ...sanitizeStoredPost(post), savedAt: new Date().toISOString() });
    saveFavorites(favorites, userId);
    isFavorite = true;
  }

  // Background push to the Booru API
  sendBooruFavorite(post.site || 'danbooru', post, isFavorite, settings).catch(() => {});

  return res.json({ success: true, isFavorite, count: favorites.length });
});

// POST /api/favorites/sync
router.post('/favorites/sync', (req, res) => {
  const { favorites } = req.body || {};
  if (!Array.isArray(favorites)) {
    return res.status(400).json({ success: false, message: 'Ожидается массив избранного' });
  }
  const userId = req.user?.id || null;
  const current = getFavorites(userId);
  const map = new Map();
  current.forEach(f => { if (f && f.id) map.set(f.id, f); });
  favorites.forEach(f => { if (f && f.id) map.set(f.id, sanitizeStoredPost(f)); });
  const merged = Array.from(map.values());

  saveFavorites(merged, userId);
  res.json({ success: true, count: merged.length, favorites: merged });
});

// DELETE /api/favorites/:id
router.delete('/favorites/:id', (req, res) => {
  const id = req.params.id;
  const userId = req.user?.id || null;
  const favorites = getFavorites(userId);
  const target = favorites.find(f => f.id === id);
  const filtered = favorites.filter(f => f.id !== id);
  saveFavorites(filtered, userId);

  if (target) {
    const clientAuth = parseClientAuth(req);
    const settings = { ...getSettings(userId), ...clientAuth };
    sendBooruFavorite(target.site || 'danbooru', target, false, settings).catch(() => {});
  }

  res.json({ success: true, count: filtered.length });
});

// GET /api/favorite-authors
router.get('/favorite-authors', (req, res) => {
  const userId = req.user?.id || null;
  const authors = getFavoriteAuthors(userId);
  res.json({ success: true, authors });
});

// POST /api/favorite-authors
router.post('/favorite-authors', (req, res) => {
  const body = req.body;
  if (!body || !body.name || !body.name.trim()) {
    return res.status(400).json({ success: false, message: 'Имя автора не указано' });
  }

  const rawName = body.name.trim();
  const cleanName = rawName.replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_').toLowerCase();
  const displayName = body.displayName ? body.displayName.trim() : rawName;
  const previewUrl = body.previewUrl || '';
  const site = body.site || 'danbooru';
  const service = body.service || '';

  const userId = req.user?.id || null;
  const authors = getFavoriteAuthors(userId);
  const existsIndex = authors.findIndex(a => (a.name || '').toLowerCase() === cleanName);
  const clientAuth = parseClientAuth(req);
  const settings = { ...getSettings(userId), ...clientAuth, ...(req.body?.settings || {}) };

  if (existsIndex >= 0) {
    const removedAuthor = authors[existsIndex];
    authors.splice(existsIndex, 1);
    saveFavoriteAuthors(authors, userId);
    sendBooruAuthorFollow(site, removedAuthor || cleanName, false, settings).catch(() => {});
    return res.json({ success: true, isFavorite: false, count: authors.length, authors });
  } else {
    const newAuthor = {
      id: cleanName,
      name: cleanName,
      displayName: displayName,
      previewUrl: previewUrl,
      site: site,
      service: service,
      createdAt: new Date().toISOString()
    };
    authors.unshift(newAuthor);
    saveFavoriteAuthors(authors, userId);
    sendBooruAuthorFollow(site, newAuthor, true, settings).catch(() => {});
    return res.json({ success: true, isFavorite: true, count: authors.length, authors, author: newAuthor });
  }
});

// POST /api/favorite-authors/sync
router.post('/favorite-authors/sync', (req, res) => {
  const { authors } = req.body || {};
  if (!Array.isArray(authors)) {
    return res.status(400).json({ success: false, message: 'Ожидается массив авторов' });
  }
  const userId = req.user?.id || null;
  const current = getFavoriteAuthors(userId);
  const map = new Map();
  current.forEach(a => { if (a && a.name) map.set((a.name || '').toLowerCase(), a); });
  authors.forEach(a => { if (a && a.name) map.set((a.name || '').toLowerCase(), a); });
  const merged = Array.from(map.values());

  saveFavoriteAuthors(merged, userId);
  res.json({ success: true, count: merged.length, authors: merged });
});

// DELETE /api/favorite-authors/:name
router.delete('/favorite-authors/:name', (req, res) => {
  const rawName = (req.params.name || '').trim().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_').toLowerCase();
  const userId = req.user?.id || null;
  const authors = getFavoriteAuthors(userId);
  const target = authors.find(a => (a.name || '').toLowerCase() === rawName);
  const filtered = authors.filter(a => (a.name || '').toLowerCase() !== rawName);
  saveFavoriteAuthors(filtered, userId);

  const clientAuth = parseClientAuth(req);
  const settings = { ...getSettings(userId), ...clientAuth };
  sendBooruAuthorFollow(target?.site || 'danbooru', target || rawName, false, settings).catch(() => {});

  res.json({ success: true, count: filtered.length, authors: filtered });
});

// POST /api/favorite-authors/preview
router.post('/favorite-authors/preview', (req, res) => {
  const { name, previewUrl, sampleUrl, fileUrl, thumb180, thumb360, thumb720, site } = req.body || {};
  if (!name || !previewUrl) {
    return res.status(400).json({ success: false, message: 'Не указано имя автора или ссылка на превью' });
  }

  const rawName = String(name).trim();
  const cleanName = rawName.replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_').toLowerCase();
  const userId = req.user?.id || null;
  const authors = getFavoriteAuthors(userId);

  // Match by name, id, or displayName
  let target = authors.find(a => 
    (a.name || '').toLowerCase() === cleanName ||
    (a.id || '').toLowerCase() === cleanName ||
    (a.displayName || '').toLowerCase() === rawName.toLowerCase()
  );

  if (target) {
    target.previewUrl = previewUrl;
    if (sampleUrl !== undefined) target.sampleUrl = sampleUrl;
    if (fileUrl !== undefined) target.fileUrl = fileUrl;
    if (thumb180 !== undefined) target.thumb180 = thumb180;
    if (thumb360 !== undefined) target.thumb360 = thumb360;
    if (thumb720 !== undefined) target.thumb720 = thumb720;
    if (site) target.site = site;
  } else {
    target = {
      id: cleanName,
      name: cleanName,
      displayName: rawName,
      previewUrl: previewUrl,
      sampleUrl: sampleUrl || '',
      fileUrl: fileUrl || '',
      thumb180: thumb180 || '',
      thumb360: thumb360 || '',
      thumb720: thumb720 || '',
      site: site || 'danbooru',
      createdAt: new Date().toISOString()
    };
    authors.unshift(target);
  }

  saveFavoriteAuthors(authors, userId);
  res.json({ success: true, author: target, authors });
});

// GET /api/likes
router.get('/likes', (req, res) => {
  const userId = req.user?.id || null;
  const likes = getLikes(userId);
  res.json({ success: true, likes });
});

// POST /api/like
router.post('/like', async (req, res) => {
  const post = req.body;
  if (!post || !post.id) return res.status(400).json({ success: false, message: 'Некорректные данные' });

  const userId = req.user?.id || null;
  const likes = getLikes(userId);
  const existsIndex = likes.findIndex(l => l.id === post.id);
  const clientAuth = parseClientAuth(req);
  const settings = { ...getSettings(userId), ...clientAuth, ...(req.body?.settings || {}) };
  let isLiked = false;

  if (existsIndex >= 0) {
    likes.splice(existsIndex, 1);
    saveLikes(likes, userId);
    isLiked = false;
  } else {
    likes.unshift({ ...sanitizeStoredPost(post), likedAt: new Date().toISOString() });
    saveLikes(likes, userId);
    isLiked = true;
  }

  // Background push to the Booru API
  sendBooruLike(post.site || 'danbooru', post, isLiked, settings).catch(() => {});

  return res.json({ success: true, isLiked, count: likes.length });
});

// POST /api/likes/sync
router.post('/likes/sync', (req, res) => {
  const { likes } = req.body || {};
  if (!Array.isArray(likes)) {
    return res.status(400).json({ success: false, message: 'Ожидается массив лайков' });
  }
  const userId = req.user?.id || null;
  const current = getLikes(userId);
  const map = new Map();
  current.forEach(l => { if (l && l.id) map.set(l.id, l); });
  likes.forEach(l => { if (l && l.id) map.set(l.id, sanitizeStoredPost(l)); });
  const merged = Array.from(map.values());

  saveLikes(merged, userId);
  res.json({ success: true, count: merged.length, likes: merged });
});

// GET /api/dislikes
router.get('/dislikes', (req, res) => {
  const userId = req.user?.id || null;
  const dislikes = getDislikes(userId);
  res.json({ success: true, dislikes });
});

// POST /api/dislike
router.post('/dislike', async (req, res) => {
  const post = req.body;
  if (!post || !post.id) return res.status(400).json({ success: false, message: 'Некорректные данные' });

  const userId = req.user?.id || null;
  const dislikes = getDislikes(userId);
  const existsIndex = dislikes.findIndex(d => d.id === post.id);
  let isDisliked = false;

  if (existsIndex >= 0) {
    dislikes.splice(existsIndex, 1);
    saveDislikes(dislikes, userId);
    isDisliked = false;
  } else {
    dislikes.unshift({ ...sanitizeStoredPost(post), dislikedAt: new Date().toISOString() });
    saveDislikes(dislikes, userId);
    isDisliked = true;
  }

  return res.json({ success: true, isDisliked, count: dislikes.length });
});

// POST /api/dislikes/clear
router.post('/dislikes/clear', (req, res) => {
  const userId = req.user?.id || null;
  clearDislikes(userId);
  res.json({ success: true, count: 0, dislikes: [] });
});

// POST /api/dislikes/sync
router.post('/dislikes/sync', (req, res) => {
  const { dislikes } = req.body || {};
  if (!Array.isArray(dislikes)) {
    return res.status(400).json({ success: false, message: 'Ожидается массив скрытых постов' });
  }
  const userId = req.user?.id || null;
  const current = getDislikes(userId);
  const map = new Map();
  current.forEach(d => { if (d && d.id) map.set(d.id, d); });
  dislikes.forEach(d => { if (d && d.id) map.set(d.id, sanitizeStoredPost(d)); });
  const merged = Array.from(map.values());

  saveDislikes(merged, userId);
  res.json({ success: true, count: merged.length, dislikes: merged });
});

// GET /api/cache-info
router.get('/cache-info', async (req, res) => {
  const userId = req.user?.id || null;
  const settings = getSettings(userId);
  const [thumbs, videos] = await Promise.all([
    getDirectoryStats(THUMBS_DIR),
    getDirectoryStats(VIDEOS_DIR)
  ]);
  const totalDiskBytes = thumbs.totalBytes + videos.totalBytes;

  res.json({
    success: true,
    diskCacheBytes: totalDiskBytes,
    diskCacheMB: (totalDiskBytes / (1024 * 1024)).toFixed(1),
    maxServerCacheMb: settings?.maxServerCacheMb !== undefined ? Number(settings.maxServerCacheMb) : 1500,
    thumbsCount: thumbs.fileList.length,
    videosCount: videos.fileList.length,
    ramCacheEntries: apiPostsCache.size() + tagAutocompleteCache.size()
  });
});

// POST /api/cache-clear
router.post('/cache-clear', async (req, res) => {
  try {
    apiPostsCache.clear();
    tagAutocompleteCache.clear();

    const [thumbs, videos] = await Promise.all([
      getDirectoryStats(THUMBS_DIR),
      getDirectoryStats(VIDEOS_DIR)
    ]);

    for (const f of [...thumbs.fileList, ...videos.fileList]) {
      try { await fs.promises.unlink(f.path); } catch {}
    }

    logInfo('Cache', 'Кэш полностью очищен по запросу пользователя');
    res.json({ success: true, message: 'Кэш успешно очищен' });
  } catch (err) {
    logError('Cache', 'Ошибка очистки кэша', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Localtunnel tunnel
let tunnelProcess = null;
let tunnelUrl = '';

router.get('/tunnel', (req, res) => {
  const port = Number(PORT);
  const localIp = getLocalIpAddress();
  const localUrl = `http://${localIp}:${port}`;

  if (req.query.action === 'start' && !tunnelProcess && !tunnelUrl) {
    logInfo('Tunnel', `Запуск Localtunnel для http://localhost:${port}...`);
    try {
      tunnelProcess = spawn(/^win/.test(process.platform) ? 'npx.cmd' : 'npx', ['-y', 'localtunnel', '--port', port.toString()], { shell: true });

      tunnelProcess.stdout.on('data', (data) => {
        const text = data.toString();
        const match = text.match(/your url is: (https:\/\/[a-z0-9-]+\.loca\.lt)/i);
        if (match && !tunnelUrl) {
          tunnelUrl = match[1];
          logInfo('Tunnel', `Туннель запущен: ${tunnelUrl}`);
        }
      });

      tunnelProcess.stderr.on('data', (data) => {
        console.error('[Tunnel Error]', data.toString());
      });

      tunnelProcess.on('close', () => {
        logInfo('Tunnel', 'Туннель закрыт.');
        tunnelProcess = null;
        tunnelUrl = '';
      });
      
      tunnelProcess.on('error', (err) => {
        logError('Tunnel', 'Ошибка туннеля', err);
        tunnelProcess = null;
        tunnelUrl = '';
      });
    } catch (err) {
      logError('Tunnel', 'Сбой запуска туннеля', err);
    }
  }

  res.json({
    success: true,
    localUrl,
    tunnelUrl: tunnelUrl || null,
    isStartingTunnel: !!tunnelProcess && !tunnelUrl
  });
});

// POST /api/backup/telegram/test - check bot connectivity
router.post('/backup/telegram/test', async (req, res) => {
  try {
    const { token, chatId } = req.body || {};
    const userId = req.user?.id || null;
    const settings = getSettings(userId);
    
    const botToken = token || settings.telegramBotToken;
    const targetChatId = chatId || settings.telegramChatId;

    if (!botToken || !targetChatId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Укажите токен бота и Chat ID' 
      });
    }

    const result = await testTelegramBot(botToken, targetChatId);
    res.json({ success: true, message: `Связь установлена! Бот: ${result.botName}`, result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /api/backup/telegram/send - send a backup to Telegram
router.post('/backup/telegram/send', async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const result = await performTelegramBackup(userId, true);
    res.json({ 
      success: true, 
      message: 'Резервная копия успешно отправлена в Telegram!', 
      result 
    });
  } catch (err) {
    logError('Backup', 'Ошибка при ручной отправке бэкапа:', err);
    res.status(400).json({ success: false, message: err.message });
  }
});

// GET /api/backup/telegram/status - status of the last backup
router.get('/backup/telegram/status', (req, res) => {
  const userId = req.user?.id || null;
  const settings = getSettings(userId);
  res.json({
    success: true,
    enabled: !!settings.telegramBackupEnabled,
    hasToken: !!settings.telegramBotToken,
    hasChatId: !!settings.telegramChatId,
    interval: settings.telegramBackupInterval || 'daily',
    lastBackupAt: settings.telegramLastBackupAt || null
  });
});

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

// POST /api/sync-external - Batch sync existing likes, favorites, and favorite authors to remote services
router.post('/sync-external', async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const clientAuth = parseClientAuth(req);
    const bodySettings = (req.body && typeof req.body.settings === 'object') ? req.body.settings : {};
    const settings = { ...getSettings(userId), ...clientAuth, ...bodySettings };
    const { targetSite = 'all', syncLikes = true, syncFavorites = true, syncAuthors = true } = req.body || {};

    const likes = syncLikes ? getLikes(userId) : [];
    const favorites = syncFavorites ? getFavorites(userId) : [];
    const authors = syncAuthors ? getFavoriteAuthors(userId) : [];

    let syncedLikesCount = 0;
    let syncedFavoritesCount = 0;
    let syncedAuthorsCount = 0;
    let skippedCount = 0;
    const errorsList = [];

    logInfo('SyncExternal', `Запуск батч-синхронизации: likes=${likes.length}, favorites=${favorites.length}, authors=${authors.length}, targetSite=${targetSite}`);

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // 1. Sync Likes
    for (const item of likes) {
      if (!item || !item.id) continue;
      const site = item.site || 'danbooru';
      if (targetSite !== 'all' && site !== targetSite) {
        skippedCount++;
        continue;
      }
      try {
        const result = await sendBooruLike(site, item, true, settings);
        if (result && result.success) {
          syncedLikesCount++;
        } else {
          skippedCount++;
          if (result && result.message && !errorsList.includes(result.message)) {
            errorsList.push(`${site}: ${result.message}`);
          }
        }
        await delay(120); // rate-limit throttle
      } catch (err) {
        logError('SyncExternal', `Ошибка при синхронизации лайка [${item.id}]:`, err);
        skippedCount++;
      }
    }

    // 2. Sync Favorites
    for (const item of favorites) {
      if (!item || !item.id) continue;
      const site = item.site || 'danbooru';
      if (targetSite !== 'all' && site !== targetSite) {
        skippedCount++;
        continue;
      }
      try {
        const result = await sendBooruFavorite(site, item, true, settings);
        if (result && result.success) {
          syncedFavoritesCount++;
        } else {
          skippedCount++;
          if (result && result.message && !errorsList.includes(result.message)) {
            errorsList.push(`${site}: ${result.message}`);
          }
        }
        await delay(120);
      } catch (err) {
        logError('SyncExternal', `Ошибка при синхронизации закладки [${item.id}]:`, err);
        skippedCount++;
      }
    }

    // 3. Sync Authors
    for (const author of authors) {
      if (!author || (!author.name && !author.id)) continue;
      const site = author.site || 'danbooru';
      if (targetSite !== 'all' && site !== targetSite) {
        skippedCount++;
        continue;
      }
      try {
        const result = await sendBooruAuthorFollow(site, author, true, settings);
        if (result && result.success) {
          syncedAuthorsCount++;
        } else {
          skippedCount++;
          if (result && result.message && !errorsList.includes(result.message)) {
            errorsList.push(`${site}: ${result.message}`);
          }
        }
        await delay(120);
      } catch (err) {
        logError('SyncExternal', `Ошибка при синхронизации автора [${author.name || author.id}]:`, err);
        skippedCount++;
      }
    }

    logInfo('SyncExternal', `Итог синхронизации: likes=${syncedLikesCount}, favs=${syncedFavoritesCount}, authors=${syncedAuthorsCount}, skipped=${skippedCount}`);

    let summary = `Выгружено: ${syncedLikesCount} лайков, ${syncedFavoritesCount} закладок, ${syncedAuthorsCount} авторов`;
    if (errorsList.length > 0 && (syncedLikesCount + syncedFavoritesCount + syncedAuthorsCount === 0)) {
      summary = `Синхронизация не выполнена. ${errorsList.join('; ')}`;
    }

    res.json({
      success: (syncedLikesCount + syncedFavoritesCount + syncedAuthorsCount > 0) || skippedCount === 0,
      message: summary,
      stats: {
        syncedLikesCount,
        syncedFavoritesCount,
        syncedAuthorsCount,
        skippedCount,
        errors: errorsList,
        totalChecked: likes.length + favorites.length + authors.length
      }
    });
  } catch (err) {
    logError('SyncExternal', 'Ошибка ретроактивной синхронизации:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;

