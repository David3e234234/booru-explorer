import express from 'express';
import { handleProxyRequest } from '../services/proxyService.js';
import { handleVideoThumbnailRequest, handleTranscodeVideoRequest } from '../services/videoService.js';
import { resolveRule34VideoFullMedia } from '../parsers/rule34video.js';
import { getSettings } from '../services/storageService.js';

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

const router = express.Router();

// GET /api/proxy and aliases
router.get('/proxy', handleProxyRequest);
router.get('/proxy/thumbnail', handleProxyRequest);
router.get('/proxy/image', handleProxyRequest);

// GET /api/video-thumbnail
router.get('/video-thumbnail', handleVideoThumbnailRequest);

// GET /api/transcode-video
router.get('/transcode-video', handleTranscodeVideoRequest);

// GET /api/resolve-video (resolves full HD video streams from Rule34Video etc.)
router.get('/resolve-video', async (req, res) => {
  const { url, id, site } = req.query;
  if (site === 'rule34video' || (url && url.includes('rule34video.com'))) {
    const clientAuth = parseClientAuth(req);
    const settings = { ...getSettings(), ...clientAuth };
    const resolved = await resolveRule34VideoFullMedia(url, id, settings);
    if (resolved) {
      return res.json(resolved);
    }
  }
  return res.json({ success: false });
});

export default router;

