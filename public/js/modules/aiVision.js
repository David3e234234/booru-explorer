import { state } from '../state.js';
import { 
  fetchAiStatus, 
  fetchServerEmbedding, 
  fetchBatchServerEmbeddings, 
  clearServerAiCache 
} from '../api.js';
import { t } from '../i18n.js';
import { showToast } from './uiUtils.js';

// IndexedDB Database name & version
const DB_NAME = 'booru_ai_vision_db';
const DB_VERSION = 1;
const STORE_NAME = 'embeddings';

// Transformers in browser
let browserTransformers = null;
let browserExtractor = null;
let browserCurrentModel = null;
let isBrowserModelLoading = false;
let browserLoadPromise = null;

// Memory cache for active session
const memoryEmbeddings = new Map();

// Open or get IndexedDB connection
let dbPromise = null;
function getDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return resolve(null);
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => {
      console.warn('[AIVision DB] Failed to open IndexedDB:', e.target.error);
      resolve(null);
    };
  });
  return dbPromise;
}

/**
 * Get cached embedding from IndexedDB
 */
async function getStoredEmbedding(key) {
  if (memoryEmbeddings.has(key)) {
    return memoryEmbeddings.get(key);
  }
  const db = await getDB();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        if (req.result && req.result.vector) {
          memoryEmbeddings.set(key, req.result.vector);
          resolve(req.result.vector);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Save embedding to IndexedDB and memory
 */
async function saveStoredEmbedding(key, vector) {
  memoryEmbeddings.set(key, vector);
  const db = await getDB();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({ key, vector, timestamp: Date.now() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Dynamically import Transformers.js in the browser
 */
async function getBrowserTransformers() {
  if (browserTransformers) return browserTransformers;
  try {
    const mod = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
    mod.env.allowLocalModels = false;
    mod.env.useBrowserCache = true;
    browserTransformers = mod;
    return mod;
  } catch (err) {
    console.error('[AIVision] Failed to load Transformers.js from CDN:', err);
    throw err;
  }
}

/**
 * Initialize model in the browser
 */
export async function initBrowserModel(modelType = 'mobilenet', onProgress = null) {
  if (browserExtractor && browserCurrentModel === modelType) {
    return browserExtractor;
  }

  if (isBrowserModelLoading && browserLoadPromise) {
    return browserLoadPromise;
  }

  isBrowserModelLoading = true;
  browserLoadPromise = (async () => {
    try {
      const { pipeline, AutoProcessor, CLIPVisionModelWithProjection } = await getBrowserTransformers();
      
      const progressCallback = (data) => {
        if (onProgress && typeof onProgress === 'function') {
          onProgress(data);
        }
      };

      if (modelType === 'clip') {
        const modelId = 'Xenova/clip-vit-base-patch32';
        const processor = await AutoProcessor.from_pretrained(modelId, { progress_callback: progressCallback });
        const visionModel = await CLIPVisionModelWithProjection.from_pretrained(modelId, { 
          quantized: true, 
          progress_callback: progressCallback 
        });
        
        browserExtractor = {
          type: 'clip',
          async extract(imageInput) {
            const imageInputs = await processor(imageInput);
            const { image_embeds } = await visionModel(imageInputs);
            const raw = Array.from(image_embeds.data);
            let norm = 0;
            for (let i = 0; i < raw.length; i++) norm += raw[i] * raw[i];
            norm = Math.sqrt(norm) || 1;
            return raw.map(v => v / norm);
          }
        };
      } else {
        const modelId = 'Xenova/mobilenet_v3_small';
        const extractor = await pipeline('image-feature-extraction', modelId, { 
          quantized: true, 
          progress_callback: progressCallback 
        });
        
        browserExtractor = {
          type: 'pipeline',
          async extract(imageInput) {
            const output = await extractor(imageInput, { pooling: 'mean', normalize: true });
            return Array.from(output.data);
          }
        };
      }

      browserCurrentModel = modelType;
      console.log(`[AIVision Browser] Model ${modelType} loaded successfully`);
      return browserExtractor;
    } catch (err) {
      console.error(`[AIVision Browser] Failed to load model ${modelType}:`, err);
      throw err;
    } finally {
      isBrowserModelLoading = false;
      browserLoadPromise = null;
    }
  })();

  return browserLoadPromise;
}

/**
 * Extract embedding from an image URL in the browser
 */
async function extractBrowserEmbedding(imageUrl, modelType = 'mobilenet') {
  const extractor = await initBrowserModel(modelType);
  // Fetch image blob and create object URL or pass to extractor
  // If CORS is restricted, image proxy is used
  let sourceUrl = imageUrl;
  if (!imageUrl.startsWith('blob:') && !imageUrl.startsWith('data:') && !imageUrl.startsWith('/api/proxy/')) {
    sourceUrl = `/api/proxy/thumbnail?url=${encodeURIComponent(imageUrl)}`;
  }

  const { RawImage } = await getBrowserTransformers();
  const rawImage = await RawImage.fromURL(sourceUrl);
  return await extractor.extract(rawImage);
}

/**
 * Fast cosine similarity between two unit-normalized float arrays
 */
export function calculateCosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0;
  const len = vecA.length;
  for (let i = 0; i < len; i++) {
    dot += vecA[i] * vecB[i];
  }
  return Math.max(-1, Math.min(1, dot));
}

/**
 * Get best thumbnail or preview URL from post
 */
export function getPostImageUrl(post) {
  if (!post) return '';
  return post.previewUrl || post.thumb180 || post.sampleUrl || post.thumb360 || post.fileUrl || '';
}

/**
 * Get or compute embedding for a post with caching and engine selection
 */
export async function getPostEmbedding(post, options = {}) {
  if (!post) return null;
  const imageUrl = getPostImageUrl(post);
  if (!imageUrl) return null;

  const modelType = options.modelType || state.settings?.aiVisualModel || 'mobilenet';
  const engine = options.engine || state.settings?.aiVisualEngine || 'browser';
  const key = `${modelType}_${post.id || imageUrl}`;

  // 1. Check local cache (Memory + IndexedDB)
  const cached = await getStoredEmbedding(key);
  if (cached) {
    return cached;
  }

  // 2. Compute via Server or Browser
  let vector = null;

  if (engine === 'server' || engine === 'auto') {
    try {
      const serverRes = await fetchServerEmbedding(imageUrl, post.id, modelType);
      if (serverRes.success && Array.isArray(serverRes.embedding)) {
        vector = serverRes.embedding;
      }
    } catch (err) {
      if (engine === 'server') {
        console.warn('[AIVision] Server embedding failed:', err.message);
      }
    }
  }

  if (!vector && (engine === 'browser' || engine === 'auto')) {
    try {
      vector = await extractBrowserEmbedding(imageUrl, modelType);
    } catch (err) {
      console.warn('[AIVision] Browser embedding failed:', err.message);
    }
  }

  if (vector && Array.isArray(vector)) {
    await saveStoredEmbedding(key, vector);
    return vector;
  }

  return null;
}

/**
 * Find similar posts from candidate list ranked by visual similarity
 */
export async function findSimilarPosts(targetPost, candidatePosts, options = {}) {
  if (!targetPost || !Array.isArray(candidatePosts) || candidatePosts.length === 0) {
    return [];
  }

  const modelType = options.modelType || state.settings?.aiVisualModel || 'mobilenet';
  const engine = options.engine || state.settings?.aiVisualEngine || 'browser';
  const minSimilarity = options.minSimilarity ?? 0.35; // Min 35% similarity

  // 1. Extract target embedding
  const targetVector = await getPostEmbedding(targetPost, { modelType, engine });
  if (!targetVector) {
    throw new Error(t('ai.targetEmbedError', 'Не удалось извлечь визуальные признаки из целевого арта'));
  }

  // 2. Extract embeddings for candidates (with concurrency limiter)
  const results = [];
  const candidatesWithoutTarget = candidatePosts.filter(p => p.id !== targetPost.id);
  
  const CONCURRENCY = 4;
  for (let i = 0; i < candidatesWithoutTarget.length; i += CONCURRENCY) {
    const chunk = candidatesWithoutTarget.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map(async (candidate) => {
      try {
        const vec = await getPostEmbedding(candidate, { modelType, engine });
        if (!vec) return null;
        const similarity = calculateCosineSimilarity(targetVector, vec);
        const matchPercent = Math.round(Math.max(0, similarity) * 100);
        return {
          post: candidate,
          similarity,
          matchPercent
        };
      } catch {
        return null;
      }
    }));

    for (const res of chunkResults) {
      if (res && res.similarity >= minSimilarity) {
        results.push(res);
      }
    }
  }

  // Sort descending by similarity
  results.sort((a, b) => b.similarity - a.similarity);
  return results;
}

/**
 * Compute the average visual taste vector for liked/favorited posts
 */
export async function calculateUserTasteVector(likedPosts, options = {}) {
  if (!Array.isArray(likedPosts) || likedPosts.length === 0) {
    return null;
  }

  const modelType = options.modelType || state.settings?.aiVisualModel || 'mobilenet';
  const engine = options.engine || state.settings?.aiVisualEngine || 'browser';
  
  // Take up to 25 recent liked posts
  const samplePosts = likedPosts.slice(0, 25);
  const vectors = [];

  for (const post of samplePosts) {
    const vec = await getPostEmbedding(post, { modelType, engine });
    if (vec) vectors.push(vec);
  }

  if (vectors.length === 0) return null;

  const dim = vectors[0].length;
  const meanVector = new Float32Array(dim);

  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) {
      meanVector[i] += vec[i];
    }
  }

  // L2 Normalize mean vector
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    meanVector[i] /= vectors.length;
    norm += meanVector[i] * meanVector[i];
  }
  norm = Math.sqrt(norm) || 1;
  const unitVector = Array.from(meanVector).map(v => v / norm);

  return unitVector;
}

/**
 * Score candidate posts against user's visual taste vector
 */
export async function scoreCandidatesByVisualTaste(candidates, tasteVector, options = {}) {
  if (!tasteVector || !Array.isArray(candidates) || candidates.length === 0) {
    return candidates;
  }

  const modelType = options.modelType || state.settings?.aiVisualModel || 'mobilenet';
  const engine = options.engine || state.settings?.aiVisualEngine || 'browser';

  const scored = await Promise.all(candidates.map(async (p) => {
    try {
      const vec = await getPostEmbedding(p, { modelType, engine });
      if (!vec) return { ...p, visualMatchPercent: 0 };
      const sim = calculateCosineSimilarity(tasteVector, vec);
      const visualMatchPercent = Math.round(Math.max(0, sim) * 100);
      return {
        ...p,
        visualMatchPercent
      };
    } catch {
      return { ...p, visualMatchPercent: 0 };
    }
  }));

  return scored;
}

/**
 * Clear all embeddings from IndexedDB and server
 */
export async function clearAllEmbeddingsCache() {
  memoryEmbeddings.clear();
  const db = await getDB();
  if (db) {
    try {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      tx.objectStore(STORE_NAME).clear();
    } catch (e) {
      console.warn('[AIVision] Failed to clear IndexedDB:', e);
    }
  }
  try {
    await clearServerAiCache();
  } catch {}
  return true;
}

/**
 * Count items in IndexedDB embeddings cache
 */
export async function getLocalCacheCount() {
  const db = await getDB();
  if (!db) return memoryEmbeddings.size;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction([STORE_NAME], 'readonly');
      const req = tx.objectStore(STORE_NAME).count();
      req.onsuccess = () => resolve(req.result || memoryEmbeddings.size);
      req.onerror = () => resolve(memoryEmbeddings.size);
    } catch {
      resolve(memoryEmbeddings.size);
    }
  });
}
