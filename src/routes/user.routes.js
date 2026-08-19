import express from 'express';
import fs from 'fs';
import { spawn } from 'child_process';
import { THUMBS_DIR, VIDEOS_DIR, PORT } from '../config/constants.js';
import { 
  getSettings, 
  updateSettings, 
  getFavorites, 
  saveFavorites, 
  getFavoriteAuthors, 
  saveFavoriteAuthors, 
  getLikes, 
  saveLikes, 
  sendBooruLike 
} from '../services/storageService.js';
import { 
  apiPostsCache, 
  tagAutocompleteCache, 
  getDirectoryStats 
} from '../services/cacheService.js';
import { getLocalIpAddress } from '../utils/network.js';
import { logInfo, logError } from '../utils/logger.js';

const router = express.Router();

// GET /api/settings
router.get('/settings', (req, res) => {
  res.json({ success: true, settings: getSettings() });
});

// POST /api/settings
router.post('/settings', (req, res) => {
  const updated = updateSettings(req.body || {});
  res.json({ success: true, settings: updated });
});

// GET /api/favorites
router.get('/favorites', (req, res) => {
  const favorites = getFavorites();
  res.json({ success: true, favorites });
});

// POST /api/favorites
router.post('/favorites', (req, res) => {
  const post = req.body;
  if (!post || !post.id) return res.status(400).json({ success: false, message: 'Некорректные данные' });

  const favorites = getFavorites();
  const existsIndex = favorites.findIndex(f => f.id === post.id);

  if (existsIndex >= 0) {
    favorites.splice(existsIndex, 1);
    saveFavorites(favorites);
    return res.json({ success: true, isFavorite: false, count: favorites.length });
  } else {
    favorites.unshift({ ...post, savedAt: new Date().toISOString() });
    saveFavorites(favorites);
    return res.json({ success: true, isFavorite: true, count: favorites.length });
  }
});

// POST /api/favorites/sync
router.post('/favorites/sync', (req, res) => {
  const { favorites } = req.body || {};
  if (!Array.isArray(favorites)) {
    return res.status(400).json({ success: false, message: 'Ожидается массив избранного' });
  }
  const current = getFavorites();
  const map = new Map();
  current.forEach(f => { if (f && f.id) map.set(f.id, f); });
  favorites.forEach(f => { if (f && f.id) map.set(f.id, f); });
  const merged = Array.from(map.values());

  saveFavorites(merged);
  res.json({ success: true, count: merged.length, favorites: merged });
});

// DELETE /api/favorites/:id
router.delete('/favorites/:id', (req, res) => {
  const id = req.params.id;
  const favorites = getFavorites();
  const filtered = favorites.filter(f => f.id !== id);
  saveFavorites(filtered);
  res.json({ success: true, count: filtered.length });
});

// GET /api/favorite-authors
router.get('/favorite-authors', (req, res) => {
  const authors = getFavoriteAuthors();
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

  const authors = getFavoriteAuthors();
  const existsIndex = authors.findIndex(a => (a.name || '').toLowerCase() === cleanName);

  if (existsIndex >= 0) {
    authors.splice(existsIndex, 1);
    saveFavoriteAuthors(authors);
    return res.json({ success: true, isFavorite: false, count: authors.length, authors });
  } else {
    const newAuthor = {
      id: cleanName,
      name: cleanName,
      displayName: displayName,
      previewUrl: previewUrl,
      site: site,
      createdAt: new Date().toISOString()
    };
    authors.unshift(newAuthor);
    saveFavoriteAuthors(authors);
    return res.json({ success: true, isFavorite: true, count: authors.length, authors, author: newAuthor });
  }
});

// POST /api/favorite-authors/sync
router.post('/favorite-authors/sync', (req, res) => {
  const { authors } = req.body || {};
  if (!Array.isArray(authors)) {
    return res.status(400).json({ success: false, message: 'Ожидается массив авторов' });
  }
  const current = getFavoriteAuthors();
  const map = new Map();
  current.forEach(a => { if (a && a.name) map.set((a.name || '').toLowerCase(), a); });
  authors.forEach(a => { if (a && a.name) map.set((a.name || '').toLowerCase(), a); });
  const merged = Array.from(map.values());

  saveFavoriteAuthors(merged);
  res.json({ success: true, count: merged.length, authors: merged });
});

// DELETE /api/favorite-authors/:name
router.delete('/favorite-authors/:name', (req, res) => {
  const rawName = (req.params.name || '').trim().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_').toLowerCase();
  const authors = getFavoriteAuthors();
  const filtered = authors.filter(a => (a.name || '').toLowerCase() !== rawName);
  saveFavoriteAuthors(filtered);
  res.json({ success: true, count: filtered.length, authors: filtered });
});

// GET /api/likes
router.get('/likes', (req, res) => {
  const likes = getLikes();
  res.json({ success: true, likes });
});

// POST /api/like
router.post('/like', async (req, res) => {
  const post = req.body;
  if (!post || !post.id) return res.status(400).json({ success: false, message: 'Некорректные данные' });

  const likes = getLikes();
  const existsIndex = likes.findIndex(l => l.id === post.id);
  const settings = getSettings();
  let isLiked = false;

  if (existsIndex >= 0) {
    likes.splice(existsIndex, 1);
    saveLikes(likes);
    isLiked = false;
  } else {
    likes.unshift({ ...post, likedAt: new Date().toISOString() });
    saveLikes(likes);
    isLiked = true;
  }

  // Фоновая отправка в Booru API
  sendBooruLike(post.site || 'danbooru', post.id, isLiked, settings).catch(() => {});

  return res.json({ success: true, isLiked, count: likes.length });
});

// POST /api/likes/sync
router.post('/likes/sync', (req, res) => {
  const { likes } = req.body || {};
  if (!Array.isArray(likes)) {
    return res.status(400).json({ success: false, message: 'Ожидается массив лайков' });
  }
  const current = getLikes();
  const map = new Map();
  current.forEach(l => { if (l && l.id) map.set(l.id, l); });
  likes.forEach(l => { if (l && l.id) map.set(l.id, l); });
  const merged = Array.from(map.values());

  saveLikes(merged);
  res.json({ success: true, count: merged.length, likes: merged });
});

// GET /api/cache-info
router.get('/cache-info', (req, res) => {
  const thumbs = getDirectoryStats(THUMBS_DIR);
  const videos = getDirectoryStats(VIDEOS_DIR);
  const totalDiskBytes = thumbs.totalBytes + videos.totalBytes;
  
  res.json({
    success: true,
    diskCacheBytes: totalDiskBytes,
    diskCacheMB: (totalDiskBytes / (1024 * 1024)).toFixed(1),
    thumbsCount: thumbs.fileList.length,
    videosCount: videos.fileList.length,
    ramCacheEntries: apiPostsCache.size() + tagAutocompleteCache.size()
  });
});

// POST /api/cache-clear
router.post('/cache-clear', (req, res) => {
  try {
    apiPostsCache.clear();
    tagAutocompleteCache.clear();

    const thumbs = getDirectoryStats(THUMBS_DIR);
    const videos = getDirectoryStats(VIDEOS_DIR);

    for (const f of [...thumbs.fileList, ...videos.fileList]) {
      try { fs.unlinkSync(f.path); } catch {}
    }

    logInfo('Cache', 'Кэш полностью очищен по запросу пользователя');
    res.json({ success: true, message: 'Кэш успешно очищен' });
  } catch (err) {
    logError('Cache', 'Ошибка очистки кэша', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Туннель Localtunnel
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

export default router;
