import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { spawn } from 'child_process';
import { THUMBS_DIR, VIDEOS_DIR, ARCHIVES_DIR, BROWSER_USER_AGENT } from '../config/constants.js';
import { resolveSiteFromUrl, isSafeExternalUrl, isSafeExternalUrlResolved, fetchSafe, resolveSiteReferer } from '../utils/network.js';
import { getSettings } from './storageService.js';
import { logInfo, logError } from '../utils/logger.js';
import { runMediaJob, acquireMediaJobSlot } from './mediaJobSupervisor.js';
import { parseRequestAuth, resolveRequestSettings } from '../utils/settingsValidation.js';
import { sanitizeLogUrl, isDanbooruCredentialHost } from '../utils/hostPolicy.js';

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

const MAX_REMOTE_INPUT_BYTES = 512 * 1024 * 1024;
const REMOTE_INPUT_TIMEOUT_MS = 120000;

async function prepareFfmpegInput(targetUrl, currentSettings, externalSignal = null) {
  if (typeof targetUrl === 'string' && targetUrl.startsWith('/')) {
    const localPath = resolveArchiveFilePath(targetUrl);
    return localPath ? { input: localPath, cleanup: () => {} } : null;
  }

  if (!isSafeExternalUrl(targetUrl)) return null;
  const headers = {
    'User-Agent': BROWSER_USER_AGENT,
    'Referer': resolveSiteReferer(targetUrl)
  };
  try {
    const parsed = new URL(targetUrl);
    if (isDanbooruCredentialHost(parsed.hostname) && currentSettings.danbooruLogin && currentSettings.danbooruApiKey) {
      headers.Authorization = `Basic ${Buffer.from(`${currentSettings.danbooruLogin}:${currentSettings.danbooruApiKey}`).toString('base64')}`;
    }
  } catch {
    return null;
  }

  await fs.promises.mkdir(VIDEOS_DIR, { recursive: true });
  const tempPath = path.join(VIDEOS_DIR, `.input-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`);
  const response = await fetchSafe(targetUrl, {
    headers,
    timeout: 25000,
    streamBody: true,
    settings: currentSettings,
    site: resolveSiteFromUrl(targetUrl),
    signal: externalSignal
      ? AbortSignal.any([AbortSignal.timeout(REMOTE_INPUT_TIMEOUT_MS), externalSignal])
      : AbortSignal.timeout(REMOTE_INPUT_TIMEOUT_MS)
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    return null;
  }

  let received = 0;
  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      received += chunk.length;
      if (received > MAX_REMOTE_INPUT_BYTES) {
        callback(new Error('Видеофайл превышает допустимый размер'));
        return;
      }
      callback(null, chunk);
    }
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body),
      limiter,
      fs.createWriteStream(tempPath)
    );
  } catch (err) {
    await fs.promises.unlink(tempPath).catch(() => {});
    throw err;
  }

  return {
    input: tempPath,
    cleanup: () => { fs.promises.unlink(tempPath).catch(() => {}); }
  };
}

// `quality` is interpolated into the cache file name, so it may only take values
// the handlers below have a branch for: `?quality=../../../../tmp/x` used to
// normalize the file path out of the cache directory, for the file `ffmpeg -y`
// writes and for the thumbnail served straight from disk.
const THUMB_QUALITIES = new Set(['low', 'medium', 'high', 'original']);
const TRANSCODE_QUALITIES = new Set(['360p', '480p', '720p']);

function isValidJpegFile(filePath) {
  try {
    const handle = fs.openSync(filePath, 'r');
    try {
      const head = Buffer.alloc(3);
      fs.readSync(handle, head, 0, 3, 0);
      return head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF;
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return false;
  }
}

function normalizeQuality(rawValue, allowed, fallback) {
  // Repeated query parameters arrive as an array, and qs can hand over an object
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  if (typeof value !== 'string') return fallback;
  const clean = value.trim().toLowerCase();
  return allowed.has(clean) ? clean : fallback;
}

export async function handleVideoThumbnailRequest(req, res) {
  let targetUrl = req.query.url;
  if (Array.isArray(targetUrl)) targetUrl = targetUrl[0];
  const quality = normalizeQuality(req.query.quality, THUMB_QUALITIES, 'medium');
  if (!targetUrl || typeof targetUrl !== 'string') return res.status(400).send('Требуется параметр url');
  if (!targetUrl.startsWith('/') && !(await isSafeExternalUrlResolved(targetUrl))) {
    return res.status(403).send('URL не разрешён');
  }

  const hash = crypto.createHash('md5').update(`${targetUrl}_${quality}`).digest('hex');
  const thumbPath = path.join(THUMBS_DIR, `${hash}_${quality}.jpg`);

  try {
    if (isValidJpegFile(thumbPath)) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=604800');
      return res.sendFile(thumbPath);
    }

    // Dedupe: the gallery requests one thumbnail via several parallel requests.
    // Without this, every video card spawns its own FFmpeg process.
    if (activeThumbnails.has(hash)) {
      const ok = await activeThumbnails.get(hash).catch(() => false);
      if (ok && isValidJpegFile(thumbPath)) {
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
    if (success && isValidJpegFile(thumbPath)) {
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
  return res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" fill="#1e293b"><rect width="100%" height="100%"/><text x="50%" y="50%" fill="#94a3b8" dominant-baseline="middle" text-anchor="middle" font-size="14" font-family="sans-serif">Видео</text></svg>`);
}

function generateThumbnail(req, targetUrl, quality, thumbPath) {
  const currentSettings = resolveRequestSettings(getSettings(), parseRequestAuth(req));

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

  return runMediaJob(async () => {
    const downloadController = new AbortController();
    req.on('close', () => {
      try { downloadController.abort(); } catch {}
    });

    let prepared;
    try {
      prepared = await prepareFfmpegInput(targetUrl, currentSettings, downloadController.signal);
    } catch (err) {
      logError('Thumbnail', `Не удалось загрузить видео для превью ${sanitizeLogUrl(targetUrl)}`, err);
      return false;
    }
    if (!prepared) {
      logError('Thumbnail', `Недопустимый источник для превью: ${sanitizeLogUrl(targetUrl)}`);
      return false;
    }

    const extractFrame = (ssTime) => {
      return new Promise((resolve) => {
        const tempThumbPath = `${thumbPath}.${process.pid}.${Date.now()}_${Math.random().toString(36).slice(2, 8)}.tmp`;
        const args = [
          '-ss', ssTime,
          '-i', prepared.input,
          '-vframes', '1',
          '-vf', scaleFilter,
          '-q:v', qScale,
          '-y',
          tempThumbPath
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
          proc = spawn('ffmpeg', args);
        } catch {
          finish(false);
          return;
        }

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
          let success = false;
          if (code === 0 && isValidJpegFile(tempThumbPath)) {
            try {
              fs.renameSync(tempThumbPath, thumbPath);
              success = true;
            } catch (err) {
              logError('Thumbnail', `Ошибка сохранения превью ${sanitizeLogUrl(targetUrl)}`, err);
            }
          }
          if (!success) {
            try { fs.unlinkSync(tempThumbPath); } catch {}
          }
          finish(success);
        });
        proc.on('error', () => {
          try { fs.unlinkSync(tempThumbPath); } catch {}
          finish(false);
        });
      });
    };

    try {
      let success = await extractFrame('00:00:01');
      if (!success) {
        success = await extractFrame('00:00:00');
      }
      return success;
    } finally {
      prepared.cleanup();
    }
  });
}

const activeTranscodes = new Map();

export async function handleTranscodeVideoRequest(req, res) {
  let targetUrl = req.query.url;
  if (Array.isArray(targetUrl)) targetUrl = targetUrl[0];
  const quality = normalizeQuality(req.query.quality, TRANSCODE_QUALITIES, '480p');

  if (!targetUrl || typeof targetUrl !== 'string') {
    return res.status(400).send('Требуется параметр url');
  }
  if (!targetUrl.startsWith('/') && !(await isSafeExternalUrlResolved(targetUrl))) {
    return res.status(403).send('URL не разрешён');
  }

  const hash = crypto.createHash('md5').update(`${targetUrl}_${quality}`).digest('hex');
  const cachedVideoPath = path.join(VIDEOS_DIR, `${hash}_${quality}.mp4`);

  try {
    if (activeTranscodes.has(hash)) {
      const finished = await activeTranscodes.get(hash).catch(() => false);
      if (finished && fs.existsSync(cachedVideoPath) && fs.statSync(cachedVideoPath).size > 1024) {
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'public, max-age=604800');
        return res.sendFile(cachedVideoPath);
      }
    }

    if (fs.existsSync(cachedVideoPath)) {
      const stats = fs.statSync(cachedVideoPath);
      if (stats.size > 1024) {
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'public, max-age=604800');
        return res.sendFile(cachedVideoPath);
      }
    }

    // Ensure VIDEOS_DIR exists
    if (!fs.existsSync(VIDEOS_DIR)) {
      fs.mkdirSync(VIDEOS_DIR, { recursive: true });
    }

    const currentSettings = resolveRequestSettings(getSettings(), parseRequestAuth(req));

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

    let slotReleased = false;
    let releaseMediaSlot;
    try {
      const releaseSlot = await acquireMediaJobSlot();
      releaseMediaSlot = () => {
        if (slotReleased) return;
        slotReleased = true;
        releaseSlot();
      };
    } catch (err) {
      return res.status(err.statusCode || 503).send(err.message);
    }

    let preparedInput;
    try {
      preparedInput = await prepareFfmpegInput(targetUrl, currentSettings);
    } catch (err) {
      releaseMediaSlot();
      logError('Transcode', `Не удалось загрузить источник ${sanitizeLogUrl(targetUrl)}`, err);
      return res.status(502).send('Не удалось загрузить видео');
    }
    if (!preparedInput) {
      releaseMediaSlot();
      logError('Transcode', `Недопустимый источник для транскодирования: ${sanitizeLogUrl(targetUrl)}`);
      return res.status(400).send('Недопустимый источник видео');
    }
    let inputCleaned = false;
    const cleanupInput = () => {
      if (inputCleaned) return;
      inputCleaned = true;
      preparedInput.cleanup();
    };

    const tempCachedPath = `${cachedVideoPath}.${process.pid}.${Date.now()}_${Math.random().toString(36).slice(2, 6)}.tmp`;
    const writeStream = fs.createWriteStream(tempCachedPath);

    const args = [
      '-i', preparedInput.input,
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
    try {
      proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (spawnErr) {
      logError('Transcode', `Не удалось запустить FFmpeg для ${sanitizeLogUrl(targetUrl)}`, spawnErr);
      try { writeStream.close(); fs.unlinkSync(tempCachedPath); } catch {}
      cleanupInput();
      releaseMediaSlot();
      return res.status(503).send('FFmpeg недоступен на сервере');
    }

    let killTimer = setTimeout(() => {
      try {
        if (proc && !proc.killed) proc.kill('SIGKILL');
      } catch {}
    }, 180000); // 3 minutes timeout for stream

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache');

    let stderrChunks = [];

    const transcodePromise = new Promise((resolve) => {
      proc.on('close', (code) => {
        cleanupInput();
        if (killTimer) clearTimeout(killTimer);
        writeStream.end(async () => {
          if (code === 0 && fs.existsSync(tempCachedPath) && fs.statSync(tempCachedPath).size > 1024) {
            const remuxPath = `${cachedVideoPath}.${process.pid}.${Date.now()}.remux.tmp`;
            try {
              const remuxProc = spawn('ffmpeg', ['-y', '-i', tempCachedPath, '-c', 'copy', '-movflags', '+faststart', remuxPath]);
              const remuxCode = await new Promise((resolveRemux) => {
                const timer = setTimeout(() => {
                  try { remuxProc.kill('SIGKILL'); } catch {}
                }, 60000);
                remuxProc.on('error', () => {
                  clearTimeout(timer);
                  resolveRemux(-1);
                });
                remuxProc.on('close', (remuxExitCode) => {
                  clearTimeout(timer);
                  resolveRemux(remuxExitCode);
                });
              });
              const outputPath = remuxCode === 0 ? remuxPath : tempCachedPath;
              await fs.promises.rename(outputPath, cachedVideoPath);
              if (remuxCode === 0) await fs.promises.unlink(tempCachedPath).catch(() => {});
              releaseMediaSlot();
              resolve(true);
              return;
            } catch (renameErr) {
              logError('Transcode', `Ошибка сохранения кэша ${sanitizeLogUrl(cachedVideoPath)}`, renameErr);
              try { if (fs.existsSync(remuxPath)) fs.unlinkSync(remuxPath); } catch {}
            }
          }
          if (code !== 0) {
            const stderrMsg = Buffer.concat(stderrChunks).toString('utf8').slice(-1000);
            logError('Transcode', `FFmpeg завершился с кодом ${code} для ${sanitizeLogUrl(targetUrl)}: ${stderrMsg}`);
          }
          try { if (fs.existsSync(tempCachedPath)) fs.unlinkSync(tempCachedPath); } catch {}
          releaseMediaSlot();
          resolve(false);
        });
      });
      proc.on('error', (err) => {
        cleanupInput();
        releaseMediaSlot();
        if (killTimer) clearTimeout(killTimer);
        logError('Transcode', `Ошибка процесса FFmpeg для ${sanitizeLogUrl(targetUrl)}`, err);
        try { writeStream.end(); if (fs.existsSync(tempCachedPath)) fs.unlinkSync(tempCachedPath); } catch {}
        if (!res.headersSent) res.status(503).send('FFmpeg недоступен на сервере');
        else res.end();
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

    proc.stderr.on('data', (chunk) => {
      if (stderrChunks.length < 20) stderrChunks.push(chunk);
    });

    proc.stdout.on('end', () => {
      try { res.end(); } catch {}
    });

  } catch (err) {
    logError('Transcode', `Ошибка обработки транскодирования ${sanitizeLogUrl(targetUrl)}`, err);
    if (!res.headersSent) {
      return res.status(500).send('Ошибка транскодирования');
    }
  }
}
