import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { THUMBS_DIR, ARCHIVES_DIR } from '../config/constants.js';
import { getFfmpegHeaders, getProxyForSite, resolveSiteFromUrl } from '../utils/network.js';
import { getSettings } from './storageService.js';
import { logInfo, logError } from '../utils/logger.js';

const activeThumbnails = new Map();

// Unpacked archive media lives on this server's disk: /api/archive/file?key=<md5>&n=<idx>
// resolves straight to the extracted file so FFmpeg reads it locally instead of
// treating the relative URL as a missing file path
function resolveArchiveFilePath(relativeUrl) {
  try {
    const parsed = new URL(relativeUrl, 'http://localhost');
    if (parsed.pathname !== '/api/archive/file') return null;
    const key = parsed.searchParams.get('key') || '';
    const n = parseInt(parsed.searchParams.get('n'), 10);
    if (!/^[a-f0-9]{32}$/.test(key) || !Number.isInteger(n) || n < 1 || n > 9999) return null;
    const manifestPath = path.join(ARCHIVES_DIR, `${key}.manifest.json`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const item = Array.isArray(manifest?.items) ? manifest.items.find(it => it.n === n) : null;
    if (!item) return null;
    const filePath = path.join(ARCHIVES_DIR, `${key}_${item.n}.${item.ext}`);
    return fs.existsSync(filePath) ? filePath : null;
  } catch {
    return null;
  }
}

// FFmpeg input for a media URL: same-origin relative URLs are resolved locally
// (archive files -> disk path, anything else -> absolute URL against this host)
function resolveFfmpegInput(req, targetUrl) {
  if (typeof targetUrl === 'string' && targetUrl.startsWith('/')) {
    const localPath = resolveArchiveFilePath(targetUrl);
    if (localPath) return { input: localPath, isLocal: true };
    try {
      return { input: new URL(targetUrl, `${req.protocol}://${req.get('host')}`).href, isLocal: false };
    } catch {}
  }
  return { input: targetUrl, isLocal: false };
}

export async function handleVideoThumbnailRequest(req, res) {
  const targetUrl = req.query.url;
  const quality = req.query.quality || 'medium';
  if (!targetUrl) return res.status(400).send('Требуется параметр url');

  const hash = crypto.createHash('md5').update(`${targetUrl}_${quality}`).digest('hex');
  const thumbPath = path.join(THUMBS_DIR, `${hash}_${quality}.jpg`);

  try {
    if (fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 0) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=604800');
      return res.sendFile(thumbPath);
    }

    // Dedupe: the gallery requests one thumbnail via several parallel requests.
    // Without this, every video card spawns its own FFmpeg process.
    if (activeThumbnails.has(hash)) {
      const ok = await activeThumbnails.get(hash).catch(() => false);
      if (ok && fs.existsSync(thumbPath)) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=604800');
        return res.sendFile(thumbPath);
      }
      return sendVideoPlaceholder(res);
    }

    const generation = generateThumbnail(req, targetUrl, quality, thumbPath);
    activeThumbnails.set(hash, generation);
    const cleanup = () => {
      if (activeThumbnails.get(hash) === generation) activeThumbnails.delete(hash);
    };
    generation.then(cleanup, cleanup);

    const success = await generation;
    if (success && fs.existsSync(thumbPath)) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=604800');
      return res.sendFile(thumbPath);
    }
    return sendVideoPlaceholder(res);
  } catch (err) {
    logError('Thumbnail', `Ошибка генерации превью для ${targetUrl}`, err);
    return sendVideoPlaceholder(res);
  }
}

function sendVideoPlaceholder(res) {
  res.setHeader('Content-Type', 'image/svg+xml');
  return res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" fill="#1e293b"><rect width="100%" height="100%"/><text x="50%" y="50%" fill="#94a3b8" dominant-baseline="middle" text-anchor="middle" font-size="14" font-family="sans-serif">🎬 Видео</text></svg>`);
}

function generateThumbnail(req, targetUrl, quality, thumbPath) {
  const currentSettings = getSettings();
  const { input: ffmpegInput, isLocal } = resolveFfmpegInput(req, targetUrl);
  const headers = isLocal ? null : getFfmpegHeaders(targetUrl, currentSettings);
  const site = isLocal ? null : resolveSiteFromUrl(targetUrl);
  const proxyUrl = site ? getProxyForSite(site, currentSettings) : '';

  let scaleFilter = 'scale=480:-1';
  let qScale = '2';
  if (quality === 'low') {
    scaleFilter = 'scale=280:-1';
    qScale = '4';
  } else if (quality === 'high') {
    scaleFilter = 'scale=854:-1';
    qScale = '2';
  } else if (quality === 'original') {
    scaleFilter = 'scale=1280:-1';
    qScale = '1';
  }

  const extractFrame = (ssTime) => {
    return new Promise((resolve) => {
      const httpProxyArg = (proxyUrl && (proxyUrl.startsWith('http://') || proxyUrl.startsWith('https://'))) ? ['-http_proxy', proxyUrl] : [];
      const args = [
        ...httpProxyArg,
        ...(headers ? ['-headers', headers] : []),
        '-ss', ssTime,
        '-i', ffmpegInput,
        '-vframes', '1',
        '-vf', scaleFilter,
        '-q:v', qScale,
        '-y',
        thumbPath
      ];
      let proc;
      try {
        const env = proxyUrl ? { ...process.env, HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, ALL_PROXY: proxyUrl } : process.env;
        proc = spawn('ffmpeg', args, { env });
      } catch {
        resolve(false);
        return;
      }

      req.on('close', () => {
        try {
          if (proc && !proc.killed) proc.kill('SIGKILL');
        } catch {}
      });

      proc.on('close', (code) => {
        resolve(code === 0 && fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 0);
      });
      proc.on('error', () => resolve(false));
    });
  };

  return (async () => {
    let success = await extractFrame('00:00:01');
    if (!success) {
      success = await extractFrame('00:00:00');
    }
    return success;
  })();
}

export async function handleTranscodeVideoRequest(req, res) {
  return res.status(410).json({
    error: 'Серверное транскодирование видео отключено. Скачайте файл для просмотра.'
  });
}
