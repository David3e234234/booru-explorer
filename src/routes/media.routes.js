import express from 'express';
import { handleProxyRequest } from '../services/proxyService.js';
import { handleVideoThumbnailRequest, handleTranscodeVideoRequest } from '../services/videoService.js';
import { resolveRule34VideoFullMedia } from '../parsers/rule34video.js';

const router = express.Router();

// GET /api/proxy
router.get('/proxy', handleProxyRequest);

// GET /api/video-thumbnail
router.get('/video-thumbnail', handleVideoThumbnailRequest);

// GET /api/transcode-video
router.get('/transcode-video', handleTranscodeVideoRequest);

// GET /api/resolve-video (Разрешение полных HD видеопотоков Rule34Video и др.)
router.get('/resolve-video', async (req, res) => {
  const { url, id, site } = req.query;
  if (site === 'rule34video' || (url && url.includes('rule34video.com'))) {
    const resolved = await resolveRule34VideoFullMedia(url, id);
    if (resolved && resolved.fullVideoUrl) {
      return res.json(resolved);
    }
  }
  return res.json({ success: false });
});

export default router;

