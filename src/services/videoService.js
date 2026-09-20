import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { THUMBS_DIR, VIDEOS_DIR, ARCHIVES_DIR } from '../config/constants.js';
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

const activeTranscodes = new Map();

export async function handleTranscodeVideoRequest(req, res) {
  let targetUrl = req.query.url;
  if (Array.isArray(targetUrl)) targetUrl = targetUrl[0];
  const quality = req.query.quality || '480p';

  if (!targetUrl || typeof targetUrl !== 'string') {
    return res.status(400).send('Требуется параметр url');
  }
  if (!targetUrl.startsWith('/') && !isSafeExternalUrl(targetUrl)) {
    return res.status(403).send('URL не разрешён');
  }

  const hash = crypto.createHash('md5').update(`${targetUrl}_${quality}`).digest('hex');
  const cachedVideoPath = path.join(VIDEOS_DIR, `${hash}_${quality}.mp4`);

  try {
    // 1. If already completely cached on disk, serve as static file with Range support
    if (fs.existsSync(cachedVideoPath)) {
      const stats = fs.statSync(cachedVideoPath);
      if (stats.size > 1024) {
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=604800');
        return res.sendFile(cachedVideoPath);
      }
    }

    // Ensure VIDEOS_DIR exists
    if (!fs.existsSync(VIDEOS_DIR)) {
      fs.mkdirSync(VIDEOS_DIR, { recursive: true });
    }

    const currentSettings = getSettings();
    const { input: ffmpegInput, isLocal } = resolveFfmpegInput(targetUrl);
    if (!ffmpegInput) {
      logError('Transcode', `Недопустимый источник для транскодирования: ${targetUrl}`);
      return res.status(400).send('Недопустимый источник видео');
    }

    const headers = isLocal ? null : getFfmpegHeaders(targetUrl, currentSettings);
    const site = isLocal ? null : resolveSiteFromUrl(targetUrl);
    const proxyUrl = site ? getProxyForSite(site, currentSettings) : '';

    // Resolution scale filter based on quality
    let scaleFilter = 'scale=-2:480';
    let targetCrf = '28';
    if (quality === '720p') {
      scaleFilter = 'scale=-2:720';
      targetCrf = '26';
    } else if (quality === '360p') {
      scaleFilter = 'scale=-2:360';
      targetCrf = '30';
    }

    // If another request is already transcoding this video, wait briefly or attach
    if (activeTranscodes.has(hash)) {
      const existing = activeTranscodes.get(hash);
      const finished = await existing.catch(() => false);
      if (finished && fs.existsSync(cachedVideoPath)) {
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=604800');
        return res.sendFile(cachedVideoPath);
      }
    }

    const tempCachedPath = `${cachedVideoPath}.${process.pid}.tmp`;
    const writeStream = fs.createWriteStream(tempCachedPath);

    const httpProxyArg = (proxyUrl && (proxyUrl.startsWith('http://') || proxyUrl.startsWith('https://'))) ? ['-http_proxy', proxyUrl] : [];
    const args = [
      ...httpProxyArg,
      ...(headers ? ['-headers', headers] : []),
      '-i', ffmpegInput,
      '-vf', scaleFilter,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-crf', targetCrf,
      '-c:a', 'aac',
      '-b:a', '96k',
      '-ac', '2',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      '-f', 'mp4',
      'pipe:1'
    ];

    let proc;
    const env = proxyUrl ? { ...process.env, HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, ALL_PROXY: proxyUrl } : process.env;
    try {
      proc = spawn('ffmpeg', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (spawnErr) {
      logError('Transcode', `Не удалось запустить FFmpeg для ${targetUrl}`, spawnErr);
      try { writeStream.close(); fs.unlinkSync(tempCachedPath); } catch {}
      return res.status(500).send('Ошибка запуска транскодера');
    }

    let killTimer = setTimeout(() => {
      try {
        if (proc && !proc.killed) proc.kill('SIGKILL');
      } catch {}
    }, 180000); // 3 minutes timeout for stream

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');

    let completedSuccessfully = false;

    const transcodePromise = new Promise((resolve) => {
      proc.on('close', (code) => {
        if (killTimer) clearTimeout(killTimer);
        writeStream.end(async () => {
          if (code === 0 && fs.existsSync(tempCachedPath) && fs.statSync(tempCachedPath).size > 1024) {
            try {
              await fs.promises.rename(tempCachedPath, cachedVideoPath);
              completedSuccessfully = true;
              resolve(true);
              return;
            } catch (renameErr) {
              logError('Transcode', `Ошибка сохранения кэша ${cachedVideoPath}`, renameErr);
            }
          }
          try { if (fs.existsSync(tempCachedPath)) fs.unlinkSync(tempCachedPath); } catch {}
          resolve(false);
        });
      });
      proc.on('error', () => {
        if (killTimer) clearTimeout(killTimer);
        try { writeStream.end(); if (fs.existsSync(tempCachedPath)) fs.unlinkSync(tempCachedPath); } catch {}
        resolve(false);
      });
    });

    activeTranscodes.set(hash, transcodePromise);
    const cleanupMap = () => {
      if (activeTranscodes.get(hash) === transcodePromise) activeTranscodes.delete(hash);
    };
    transcodePromise.then(cleanupMap, cleanupMap);

    // Pipe stdout both to client response (realtime zero-latency playback) and to writeStream (disk caching)
    proc.stdout.on('data', (chunk) => {
      try { res.write(chunk); } catch {}
      try { writeStream.write(chunk); } catch {}
    });

    proc.stderr.on('data', () => {});

    proc.stdout.on('end', () => {
      try { res.end(); } catch {}
    });

    req.on('close', () => {
      // If client closed connection early, keep ffmpeg running if almost done, or kill if disconnected early
      if (killTimer) clearTimeout(killTimer);
      if (!completedSuccessfully) {
        try {
          if (proc && !proc.killed) proc.kill('SIGKILL');
        } catch {}
      }
    });

  } catch (err) {
    logError('Transcode', `Ошибка обработки транскодирования ${targetUrl}`, err);
    if (!res.headersSent) {
      return res.status(500).send('Ошибка транскодирования');
    }
  }
}
