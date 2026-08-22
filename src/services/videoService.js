import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { THUMBS_DIR, VIDEOS_DIR } from '../config/constants.js';
import { getFfmpegHeaders } from '../utils/network.js';
import { getSettings } from './storageService.js';
import { logInfo, logError } from '../utils/logger.js';

const activeTranscodes = new Map();
const activeThumbnails = new Map();

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

    // Дедупликация: галерея запрашивает одно превью несколькими параллельными запросами.
    // Без этого на каждую карточку видео spawn'ится отдельный FFmpeg-процесс.
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
  const headers = getFfmpegHeaders(targetUrl, currentSettings);

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
      const args = [
        '-headers', headers,
        '-ss', ssTime,
        '-i', targetUrl,
        '-vframes', '1',
        '-vf', scaleFilter,
        '-q:v', qScale,
        '-y',
        thumbPath
      ];
      let proc;
      try {
        proc = spawn('ffmpeg', args);
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
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Требуется параметр url');

  try {
    const hash = crypto.createHash('md5').update(targetUrl).digest('hex');
    const videoPath = path.join(VIDEOS_DIR, `${hash}.mp4`);
    const tempPath = path.join(VIDEOS_DIR, `${hash}_temp.mp4`);

    if (fs.existsSync(videoPath) && fs.statSync(videoPath).size > 0) {
      return res.sendFile(videoPath, { acceptRanges: true });
    }

    if (activeTranscodes.has(hash)) {
      try {
        await activeTranscodes.get(hash);
        if (fs.existsSync(videoPath)) {
          return res.sendFile(videoPath, { acceptRanges: true });
        }
      } catch {}
    }

    logInfo('FFmpeg', `Начало транскодирования видео в H.264/AAC: ${targetUrl}`);

    const currentSettings = getSettings();
    const headers = getFfmpegHeaders(targetUrl, currentSettings);
    const transcodePromise = new Promise((resolve, reject) => {
      const args = [
        '-headers', headers,
        '-i', targetUrl,
        '-map', '0:v:0',
        '-map', '0:a?',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset', 'ultrafast',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        '-y',
        tempPath
      ];

      const proc = spawn('ffmpeg', args);
      
      req.on('close', () => {
        try {
          if (proc && !proc.killed) proc.kill('SIGKILL');
        } catch {}
      });

      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(tempPath) && fs.statSync(tempPath).size > 0) {
          try {
            fs.renameSync(tempPath, videoPath);
            logInfo('FFmpeg', `Транскодирование успешно завершено: ${hash}.mp4 (${(fs.statSync(videoPath).size / 1024 / 1024).toFixed(2)} MB)`);
            resolve(true);
          } catch (err) {
            reject(err);
          }
        } else {
          if (fs.existsSync(tempPath)) {
            try { fs.unlinkSync(tempPath); } catch {}
          }
          reject(new Error(`FFmpeg вернул код ошибки ${code}`));
        }
      });

      proc.on('error', (err) => {
        if (fs.existsSync(tempPath)) {
          try { fs.unlinkSync(tempPath); } catch {}
        }
        reject(err);
      });
    });

    activeTranscodes.set(hash, transcodePromise);

    try {
      await transcodePromise;
      return res.sendFile(videoPath, { acceptRanges: true });
    } finally {
      // Раньше при ошибке запись оставалась в Map навсегда (утечка отклонённых промисов)
      if (activeTranscodes.get(hash) === transcodePromise) {
        activeTranscodes.delete(hash);
      }
    }
  } catch (err) {
    logError('FFmpeg', `Ошибка транскодирования ${targetUrl}`, err);
    if (!res.headersSent) {
      return res.status(500).send('Ошибка транскодирования видео: ' + err.message);
    }
  }
}
