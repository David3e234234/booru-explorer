import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { THUMBS_DIR, ARCHIVES_DIR } from '../config/constants.js';
import { getFfmpegHeaders, getProxyForSite, resolveSiteFromUrl, isSafeExternalUrl } from '../utils/network.js';
import { getSettings } from './storageService.js';
import { logInfo, logError } from '../utils/logger.js';

const activeThumbnails = new Map();

// A stalled or hostile source used to leave FFmpeg running forever, which pinned
// the entry in activeThumbnails and made every later request for that hash hang
// behind a promise that could never settle
const FFMPEG_TIMEOUT_MS = 30000;

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

// FFmpeg input for a media URL. Relative URLs must be unpacked archive files
// (they map to a path on this server's disk); anything else has to be a safe
// external http(s) URL. Without that check FFmpeg would happily read file:// URLs
// or the cloud metadata endpoint handed to it in the url parameter.
// Returns { input: null } when the target is not acceptable.
function resolveFfmpegInput(targetUrl) {
  if (typeof targetUrl !== 'string' || !targetUrl) return { input: null, isLocal: false };

  if (targetUrl.startsWith('/')) {
    const localPath = resolveArchiveFilePath(targetUrl);
    return localPath ? { input: localPath, isLocal: true } : { input: null, isLocal: false };
  }

  return isSafeExternalUrl(targetUrl) ? { input: targetUrl, isLocal: false } : { input: null, isLocal: false };
}

export async function handleVideoThumbnailRequest(req, res) {
  let targetUrl = req.query.url;
  if (Array.isArray(targetUrl)) targetUrl = targetUrl[0];
  const quality = req.query.quality || 'medium';
  if (!targetUrl || typeof targetUrl !== 'string') return res.status(400).send('Требуется параметр url');
  if (!targetUrl.startsWith('/') && !isSafeExternalUrl(targetUrl)) {
    return res.status(403).send('URL не разрешён');
  }

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
  const { input: ffmpegInput, isLocal } = resolveFfmpegInput(targetUrl);
  if (!ffmpegInput) {
    logError('Thumbnail', `Недопустимый источник для превью: ${targetUrl}`);
    return Promise.resolve(false);
  }
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
      let settled = false;
      let killTimer = null;

      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (killTimer) clearTimeout(killTimer);
        resolve(result);
      };

      try {
        const env = proxyUrl ? { ...process.env, HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, ALL_PROXY: proxyUrl } : process.env;
        proc = spawn('ffmpeg', args, { env });
      } catch {
        finish(false);
        return;
      }

      // FFmpeg has no default timeout: a source that accepts the connection and
      // then dribbles bytes would keep the process - and this promise - alive
      // indefinitely
      killTimer = setTimeout(() => {
        try {
          if (proc && !proc.killed) proc.kill('SIGKILL');
        } catch {}
        finish(false);
      }, FFMPEG_TIMEOUT_MS);

      req.on('close', () => {
        try {
          if (proc && !proc.killed) proc.kill('SIGKILL');
        } catch {}
      });

      proc.on('close', (code) => {
        finish(code === 0 && fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 0);
      });
      proc.on('error', () => finish(false));
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
