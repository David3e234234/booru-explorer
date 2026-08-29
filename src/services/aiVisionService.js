import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AI_EMBEDDINGS_FILE, isServerless } from '../config/constants.js';
import { logInfo, logError, logWarn } from '../utils/logger.js';
import { fetchSafe } from '../utils/network.js';
import { getSettings } from './storageService.js';
import { getOrFetchImageBuffer } from './proxyService.js';

// In-memory embeddings cache
let embeddingsCache = new Map();
let isCacheLoaded = false;
let saveTimeout = null;

// Transformers pipeline & model state
let transformersModule = null;
let currentExtractor = null;
let currentModelName = null;
let isModelLoading = false;

const MODEL_CONFIGS = {
  dinov2: {
    name: 'Xenova/dinov2-small',
    type: 'pipeline',
    dim: 384
  },
  clip: {
    name: 'Xenova/clip-vit-base-patch32',
    type: 'clip',
    dim: 512
  },
  mobilenet: {
    name: 'Xenova/dinov2-small',
    type: 'pipeline',
    dim: 384
  }
};

let lastModelError = null;
let lastModelErrorTime = 0;

/**
 * Load persisted embeddings from JSON file
 */
function loadEmbeddings() {
  if (isCacheLoaded) return;
  try {
    if (fs.existsSync(AI_EMBEDDINGS_FILE)) {
      const raw = fs.readFileSync(AI_EMBEDDINGS_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') {
        for (const [k, v] of Object.entries(data)) {
          embeddingsCache.set(k, v);
        }
      }
    }
  } catch (err) {
    logWarn('AIVision', 'Не удалось прочитать кэш эмбеддингов:', err.message);
  }
  isCacheLoaded = true;
}

/**
 * Debounced persistence of embeddings cache
 */
function scheduleSaveEmbeddings() {
  if (isServerless) return;
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      const obj = {};
      for (const [k, v] of embeddingsCache.entries()) {
        obj[k] = v;
      }
      fs.writeFileSync(AI_EMBEDDINGS_FILE, JSON.stringify(obj), 'utf8');
    } catch (err) {
      logError('AIVision', 'Ошибка записи кэша эмбеддингов:', err);
    }
  }, 1000);
}

/**
 * Get or load Transformers.js module
 */
async function getTransformers() {
  if (!transformersModule) {
    transformersModule = await import('@xenova/transformers');
    // Ensure remote models are permitted and mirror is configured
    transformersModule.env.allowLocalModels = false;
    if (!transformersModule.env.remoteHost) {
      transformersModule.env.remoteHost = 'https://hf-mirror.com';
    }
  }
  return transformersModule;
}

/**
 * Initialize model pipeline
 */
export async function initModel(modelType = 'dinov2') {
  const config = MODEL_CONFIGS[modelType] || MODEL_CONFIGS.dinov2;
  if (currentExtractor && currentModelName === config.name) {
    return { success: true, model: config.name };
  }

  // Prevent spamming repeated downloads if failed recently (30s cooldown)
  const now = Date.now();
  if (lastModelError && (now - lastModelErrorTime < 30000)) {
    return { success: false, error: lastModelError };
  }

  if (isModelLoading) {
    let waited = 0;
    while (isModelLoading && waited < 40) {
      await new Promise(r => setTimeout(r, 250));
      waited++;
    }
    if (currentExtractor && currentModelName === config.name) {
      return { success: true, model: config.name };
    }
  }

  try {
    isModelLoading = true;
    logInfo('AIVision', `Загрузка серверной AI модели ${config.name}...`);
    const { pipeline, AutoProcessor, CLIPVisionModelWithProjection } = await getTransformers();

    if (config.type === 'clip') {
      const processor = await AutoProcessor.from_pretrained(config.name);
      const visionModel = await CLIPVisionModelWithProjection.from_pretrained(config.name, { quantized: true });
      currentExtractor = {
        type: 'clip',
        processor,
        visionModel,
        async extract(imageInput) {
          const imageInputs = await processor(imageInput);
          const { image_embeds } = await visionModel(imageInputs);
          // L2 normalize
          const raw = Array.from(image_embeds.data);
          let norm = 0;
          for (let i = 0; i < raw.length; i++) norm += raw[i] * raw[i];
          norm = Math.sqrt(norm) || 1;
          return raw.map(v => v / norm);
        }
      };
    } else {
      const extractor = await pipeline('image-feature-extraction', config.name, { quantized: true });
      currentExtractor = {
        type: 'pipeline',
        extractor,
        async extract(imageInput) {
          const output = await extractor(imageInput, { pooling: 'mean', normalize: true });
          return Array.from(output.data);
        }
      };
    }

    currentModelName = config.name;
    lastModelError = null;
    logInfo('AIVision', `AI модель ${config.name} успешно инициализирована`);
    return { success: true, model: config.name };
  } catch (err) {
    lastModelError = err.message;
    lastModelErrorTime = Date.now();
    logError('AIVision', `Ошибка инициализации модели ${config.name}:`, err);
    return { success: false, error: err.message };
  } finally {
    isModelLoading = false;
  }
}

/**
 * Generate a cache key for an image URL and model
 */
function getCacheKey(modelType, urlOrId) {
  const hash = crypto.createHash('md5').update(String(urlOrId)).digest('hex');
  return `${modelType}_${hash}`;
}

let inferenceQueue = Promise.resolve();

function enqueueInference(taskFn) {
  const resultPromise = inferenceQueue.then(() => taskFn());
  inferenceQueue = resultPromise.catch(() => {});
  return resultPromise;
}

/**
 * Extract image embedding vector (Float array)
 */
export async function getEmbedding(imageUrl, postId = '', modelType = 'dinov2') {
  loadEmbeddings();
  const cacheKey = getCacheKey(modelType, postId || imageUrl);
  if (embeddingsCache.has(cacheKey)) {
    return { success: true, embedding: embeddingsCache.get(cacheKey), cached: true };
  }

  const modelInit = await initModel(modelType);
  if (!modelInit.success) {
    return { success: false, error: modelInit.error };
  }

  try {
    const { RawImage } = await getTransformers();
    const settings = getSettings();
    const imgData = await getOrFetchImageBuffer(imageUrl, settings);
    if (!imgData || !imgData.buffer) {
      throw new Error('Не удалось загрузить изображение или получен некорректный формат (HTML/Cloudflare)');
    }

    const rawImage = await RawImage.fromBlob(new Blob([imgData.buffer]));

    const vector = await enqueueInference(() => currentExtractor.extract(rawImage));
    embeddingsCache.set(cacheKey, vector);
    scheduleSaveEmbeddings();

    return { success: true, embedding: vector, cached: false };
  } catch (err) {
    logWarn('AIVision', `Пропуск эмбеддинга для ${imageUrl}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Calculate cosine similarity between two unit vectors
 */
export function calculateCosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
  }
  return Math.max(-1, Math.min(1, dot));
}

/**
 * Rank candidate posts by similarity against a target embedding
 */
export function rankCandidatesBySimilarity(targetVector, candidateEmbeddings) {
  return candidateEmbeddings.map(({ id, vector }) => {
    const similarity = calculateCosineSimilarity(targetVector, vector);
    const scorePercent = Math.round(Math.max(0, similarity) * 100);
    return { id, similarity, scorePercent };
  }).sort((a, b) => b.similarity - a.similarity);
}

/**
 * Clear server-side embeddings cache
 */
export function clearEmbeddingsCache() {
  embeddingsCache.clear();
  try {
    if (fs.existsSync(AI_EMBEDDINGS_FILE)) {
      fs.unlinkSync(AI_EMBEDDINGS_FILE);
    }
  } catch (err) {
    logWarn('AIVision', 'Не удалось удалить файл кэша:', err.message);
  }
  return { success: true };
}

/**
 * Get AI Vision status
 */
export function getStatus() {
  loadEmbeddings();
  return {
    success: true,
    isServerless,
    isModelLoaded: Boolean(currentExtractor),
    currentModel: currentModelName,
    cachedEmbeddingsCount: embeddingsCache.size,
    supportedModels: Object.keys(MODEL_CONFIGS)
  };
}
