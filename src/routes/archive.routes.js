import express from 'express';
import fs from 'fs';
import path from 'path';
import { ARCHIVES_DIR } from '../config/constants.js';
import { getArchiveManifest, buildArchiveAlbumItems, isAllowedArchiveUrl, getArchiveJobStatus, inspectArchive, getArchiveKey, readManifest } from '../services/archiveService.js';
import { logError } from '../utils/logger.js';

const router = express.Router();

// GET /api/archive/inspect?url=<zip-url> - inspect zip file structure, list all files, and scan for cloud links/passwords
router.get('/inspect', async (req, res) => {
  const zipUrl = req.query.url;
  if (!zipUrl) return res.json({ success: false, error: 'URL не указан' });
  if (!isAllowedArchiveUrl(zipUrl)) {
    return res.json({ success: false, error: 'Недопустимый источник архива' });
  }

  try {
    const inspection = await inspectArchive(zipUrl);
    res.json(inspection);
  } catch (err) {
    logError('Archive', 'Ошибка инспекции архива', err);
    res.json({ success: false, error: err.message || 'Не удалось проверить архив' });
  }
});

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

// GET /api/archive/status?url=<zip-url> - download/extract progress for the loading indicator
router.get('/status', (req, res) => {
  const zipUrl = req.query.url;
  if (!zipUrl || !isAllowedArchiveUrl(zipUrl)) {
    return res.json({ active: false });
  }
  const status = getArchiveJobStatus(zipUrl);
  if (!status) {
    const key = getArchiveKey(zipUrl);
    const hasManifest = Boolean(readManifest(key));
    const hasInspect = fs.existsSync(path.join(ARCHIVES_DIR, `${key}.inspect.json`));
    if (hasManifest || hasInspect) {
      return res.json({ active: false, completed: true, cached: true, percent: 100 });
    }
    return res.json({ active: false });
  }

  const percent = status.percent !== undefined
    ? status.percent
    : (status.total > 0 ? Math.min(100, Math.round((status.received / status.total) * 100)) : 0);

  res.json({
    active: status.phase !== 'completed',
    completed: status.phase === 'completed',
    phase: status.phase,
    received: status.received || 0,
    total: status.total || 0,
    percent,
    extractedFiles: status.extractedFiles || 0,
    scannedFiles: status.scannedFiles || 0,
    totalFiles: status.totalFiles || 0,
    currentFile: status.currentFile || ''
  });
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
    const isDownload = req.query.download === '1' || req.query.download === 'true';
    if (isDownload) {
      const downloadName = item.name || `file_${item.n}.${item.ext}`;
      return res.download(filePath, downloadName);
    }
    res.sendFile(filePath, { acceptRanges: true });
  } catch (err) {
    res.status(404).send('Архив не найден в кэше');
  }
});

export default router;
