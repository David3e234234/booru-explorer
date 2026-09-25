import express from 'express';
import { handleProxyRequest } from '../services/proxyService.js';
import { handleVideoThumbnailRequest, handleTranscodeVideoRequest } from '../services/videoService.js';
import { resolveRule34VideoFullMedia } from '../parsers/rule34video.js';
import { getSettings } from '../services/storageService.js';
import { parseRequestAuth, resolveRequestSettings } from '../utils/settingsValidation.js';
import { createRateLimiter } from '../middleware/rateLimit.js';

function getRule34VideoId(rawId, rawUrl) {
  if (typeof rawId === 'string' && /^\d+$/.test(rawId.trim())) return rawId.trim();
  if (typeof rawUrl !== 'string') return '';
  try {
    const parsed = new URL(rawUrl, 'https://rule34video.com');
    if (parsed.hostname !== 'rule34video.com' && parsed.hostname !== 'www.rule34video.com') return '';
    const match = parsed.pathname.match(/\/(?:video|videos)\/(\d+)/i);
    return match ? match[1] : '';
  } catch {
    return '';
  }
}

const router = express.Router();
const proxyLimiter = createRateLimiter({ windowMs: 60000, max: 600 });
const thumbnailLimiter = createRateLimiter({ windowMs: 60000, max: 240 });
const transcodeLimiter = createRateLimiter({ windowMs: 60000, max: 30 });
const resolveLimiter = createRateLimiter({ windowMs: 60000, max: 60 });

// GET /api/proxy and aliases
router.get('/proxy', proxyLimiter, handleProxyRequest);
router.get('/proxy/thumbnail', proxyLimiter, handleProxyRequest);
router.get('/proxy/image', proxyLimiter, handleProxyRequest);

// GET /api/video-thumbnail
router.get('/video-thumbnail', thumbnailLimiter, handleVideoThumbnailRequest);

// GET /api/transcode-video
router.get('/transcode-video', transcodeLimiter, handleTranscodeVideoRequest);

// GET /api/resolve-video (resolves full HD video streams from Rule34Video etc.)
router.get('/resolve-video', resolveLimiter, async (req, res) => {
  const { url, id, site, author, quality } = req.query;
  const videoId = getRule34VideoId(
    Array.isArray(id) ? id[0] : id,
    Array.isArray(url) ? url[0] : url
  );
  const isRule34Video = site === 'rule34video' || String(url || '').includes('rule34video.com');
  if (isRule34Video && videoId) {
    try {
      const settings = resolveRequestSettings(getSettings(), parseRequestAuth(req));
      if (typeof quality === 'string') settings.videoDefaultQuality = quality;
      const resolved = await resolveRule34VideoFullMedia('', videoId, settings, typeof author === 'string' ? author : '');
      if (resolved) {
        return res.json(resolved);
      }
    } catch {
      return res.status(502).json({ success: false, message: 'Не удалось получить данные видео' });
    }
  }
  return res.json({ success: false });
});

export default router;

