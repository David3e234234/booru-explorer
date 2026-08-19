import express from 'express';
import { handleProxyRequest } from '../services/proxyService.js';
import { handleVideoThumbnailRequest, handleTranscodeVideoRequest } from '../services/videoService.js';

const router = express.Router();

// GET /api/proxy
router.get('/proxy', handleProxyRequest);

// GET /api/video-thumbnail
router.get('/video-thumbnail', handleVideoThumbnailRequest);

// GET /api/transcode-video
router.get('/transcode-video', handleTranscodeVideoRequest);

export default router;
