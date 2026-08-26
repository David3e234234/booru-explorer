import express from 'express';
import fs from 'fs';
import path from 'path';
import { ARCHIVES_DIR } from '../config/constants.js';
import { getArchiveManifest, buildArchiveAlbumItems, isAllowedArchiveUrl } from '../services/archiveService.js';
import { logError } from '../utils/logger.js';

const router = express.Router();

// GET /api/archive/list?url=<zip-url> - download, unpack (cached) and list media inside
router.get('/list', async (req, res) => {
  const zipUrl = req.query.url;
  if (!zipUrl) return res.json({ success: false, error: 'URL не указан' });
  if (!isAllowedArchiveUrl(zipUrl)) {
    return res.json({ success: false, error: 'Недопустимый источник архива' });
  }

  try {
    const manifest = await getArchiveManifest(zipUrl);
    const albumItems = buildArchiveAlbumItems(manifest);
    res.json({ success: true, albumItems, albumCount: albumItems.length });
  } catch (err) {
    logError('Archive', 'Ошибка обработки архива', err);
    res.json({ success: false, error: err.message || 'Не удалось распаковать архив' });
  }
});

// GET /api/archive/file?key=<md5>&n=<idx> - serve one extracted file from cache
router.get('/file', async (req, res) => {
  const key = String(req.query.key || '');
  const n = parseInt(req.query.n, 10);

  if (!/^[a-f0-9]{32}$/.test(key) || !Number.isInteger(n) || n < 1 || n > 9999) {
    return res.status(400).send('Неверные параметры');
  }

  try {
    const manifestPath = path.join(ARCHIVES_DIR, `${key}.manifest.json`);
    const raw = await fs.promises.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(raw);
    const item = Array.isArray(manifest?.items) ? manifest.items.find(it => it.n === n) : null;
    if (!item) return res.status(404).send('Файл не найден в манифесте');

    // Key and extension come from the manifest entry, never from user input
    const filePath = path.join(ARCHIVES_DIR, `${key}_${item.n}.${item.ext}`);
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.sendFile(filePath);
  } catch (err) {
    res.status(404).send('Архив не найден в кэше');
  }
});

export default router;
