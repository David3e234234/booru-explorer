import { fetchSafe } from './network.js';
import { logError } from './logger.js';

// Кеш карты тегов Moebooru для konachan и yandere
// 1 = artist, 3 = copyright, 4 = character, 0 = general, 6 = meta
const moebooruCache = {
  konachan: { map: null, loading: null, lastFetched: 0 },
  yandere: { map: null, loading: null, lastFetched: 0 }
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 часа

async function loadMoebooruSummary(siteId) {
  const siteKey = siteId === 'yandere' ? 'yandere' : 'konachan';
  const entry = moebooruCache[siteKey];

  if (entry.map && Date.now() - entry.lastFetched < CACHE_TTL_MS) {
    return entry.map;
  }

  if (entry.loading) {
    return await entry.loading;
  }

  const baseUrl = siteKey === 'yandere' ? 'https://yande.re' : 'https://konachan.com';
  entry.loading = (async () => {
    try {
      const res = await fetchSafe(`${baseUrl}/tag/summary.json`, { timeout: 15000 });
      if (!res.ok) {
        // Fallback for konachan to .net if .com fails
        if (siteKey === 'konachan') {
          const altRes = await fetchSafe('https://konachan.net/tag/summary.json', { timeout: 15000 });
          if (altRes.ok) {
            return processSummaryResponse(altRes, siteKey);
          }
        }
        return entry.map || new Map();
      }
      return processSummaryResponse(res, siteKey);
    } catch (err) {
      logError(`MoebooruTags (${siteKey})`, 'Не удалось загрузить tag summary', err);
      return entry.map || new Map();
    } finally {
      entry.loading = null;
    }
  })();

  return await entry.loading;
}

async function processSummaryResponse(res, siteKey) {
  try {
    const json = await res.json();
    if (!json || typeof json.data !== 'string') return new Map();
    
    const entries = json.data.split(' ');
    const tagMap = new Map();
    for (const entryStr of entries) {
      if (!entryStr) continue;
      const parts = entryStr.split('`');
      const type = parseInt(parts[0], 10);
      for (let i = 1; i < parts.length; i++) {
        const tName = parts[i];
        if (tName) {
          tagMap.set(tName, type);
        }
      }
    }
    moebooruCache[siteKey].map = tagMap;
    moebooruCache[siteKey].lastFetched = Date.now();
    return tagMap;
  } catch (err) {
    logError(`MoebooruTags (${siteKey})`, 'Ошибка парсинга summary', err);
    return new Map();
  }
}

/**
 * Классификация тегов Moebooru по базе tag/summary.json
 * @param {string} siteId - 'konachan' или 'yandere'
 * @param {string[]} rawTags - массив тегов поста
 * @returns {Promise<{ tagDetails: { artist: string[], copyright: string[], character: string[], general: string[], meta: string[] }, detectedAuthor: string }>}
 */
export async function getMoebooruTagDetails(siteId, rawTags = []) {
  const tags = Array.isArray(rawTags) ? rawTags : [];
  const tagMap = await loadMoebooruSummary(siteId);

  const artist = [];
  const copyright = [];
  const character = [];
  const meta = [];
  const general = [];

  for (const tag of tags) {
    if (!tag) continue;
    const cleanTag = String(tag).trim();
    const type = tagMap.get(cleanTag);

    if (type === 1) {
      artist.push(cleanTag);
    } else if (type === 3) {
      copyright.push(cleanTag);
    } else if (type === 4) {
      character.push(cleanTag);
    } else if (type === 6) {
      meta.push(cleanTag);
    } else {
      general.push(cleanTag);
    }
  }

  const detectedAuthor = artist.join(', ');

  return {
    tagDetails: { artist, copyright, character, general, meta },
    detectedAuthor
  };
}
