import express from 'express';
import { 
  getStatus, 
  getEmbedding, 
  rankCandidatesBySimilarity, 
  clearEmbeddingsCache 
} from '../services/aiVisionService.js';
import { logError } from '../utils/logger.js';

const router = express.Router();

// GET /api/ai/status
router.get('/status', (req, res) => {
  try {
    const status = getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/ai/embedding
router.post('/embedding', async (req, res) => {
  try {
    const { url, postId, model } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: 'Параметр url обязателен' });
    }
    const result = await getEmbedding(url, postId, model || 'mobilenet');
    if (!result.success) {
      return res.status(500).json(result);
    }
    res.json(result);
  } catch (err) {
    logError('AIRoutes', 'Ошибка в /api/ai/embedding:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/ai/batch-embeddings
router.post('/batch-embeddings', async (req, res) => {
  try {
    const { items, model } = req.body; // items: Array<{ id, url }>
    if (!Array.isArray(items)) {
      return res.status(400).json({ success: false, error: 'Параметр items должен быть массивом' });
    }

    const modelType = model || 'mobilenet';
    const results = [];

    // Process concurrently with a limit of 4 to prevent server saturation
    const CONCURRENCY = 4;
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      const chunk = items.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(chunk.map(async (item) => {
        try {
          const res = await getEmbedding(item.url, item.id, modelType);
          return { id: item.id, success: res.success, embedding: res.embedding || null, error: res.error || null };
        } catch (e) {
          return { id: item.id, success: false, embedding: null, error: e.message };
        }
      }));
      results.push(...chunkResults);
    }

    res.json({ success: true, results });
  } catch (err) {
    logError('AIRoutes', 'Ошибка в /api/ai/batch-embeddings:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/ai/similar
router.post('/similar', async (req, res) => {
  try {
    const { targetEmbedding, candidates } = req.body; // candidates: Array<{ id, vector }>
    if (!targetEmbedding || !Array.isArray(candidates)) {
      return res.status(400).json({ success: false, error: 'Неверные параметры targetEmbedding или candidates' });
    }
    const ranked = rankCandidatesBySimilarity(targetEmbedding, candidates);
    res.json({ success: true, results: ranked });
  } catch (err) {
    logError('AIRoutes', 'Ошибка в /api/ai/similar:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/ai/clear-cache
router.post('/clear-cache', (req, res) => {
  try {
    const result = clearEmbeddingsCache();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
