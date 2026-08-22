import fs from 'fs';
import path from 'path';
import { 
  DEFAULT_SETTINGS, 
  SETTINGS_FILE, 
  FAVORITES_FILE, 
  FAVORITE_AUTHORS_FILE, 
  LIKES_FILE, 
  DISLIKES_FILE, 
  BROWSER_USER_AGENT,
  DATA_DIR 
} from '../config/constants.js';
import { logError } from '../utils/logger.js';
import { getUserDataDir } from './userService.js';

const pendingWrites = new Map();
const pendingData = new Map();

export function readJsonFile(filePath, defaultData) {
  if (pendingData.has(filePath)) {
    try {
      return JSON.parse(JSON.stringify(pendingData.get(filePath)));
    } catch {
      return pendingData.get(filePath);
    }
  }
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    logError('Storage', `Ошибка чтения ${filePath}`, err);
  }
  return defaultData;
}

export function writeJsonFile(filePath, data) {
  pendingData.set(filePath, data);
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    if (!pendingWrites.has(filePath)) {
      pendingData.delete(filePath);
    }
    return true;
  } catch (err) {
    logError('Storage', `Ошибка записи ${filePath}`, err);
    return false;
  }
}

export function writeJsonFileAsync(filePath, data, debounceMs = 150) {
  pendingData.set(filePath, data);
  if (pendingWrites.has(filePath)) {
    clearTimeout(pendingWrites.get(filePath));
  }
  const timer = setTimeout(async () => {
    pendingWrites.delete(filePath);
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
      if (!pendingWrites.has(filePath)) {
        pendingData.delete(filePath);
      }
    } catch (err) {
      logError('Storage', `Ошибка асинхронной записи ${filePath}`, err);
    }
  }, debounceMs);
  pendingWrites.set(filePath, timer);
}

function getUserFilePath(userId, defaultFile, filename) {
  if (!userId) return defaultFile;
  const userDir = getUserDataDir(userId);
  return path.join(userDir, filename);
}

// Переменные окружения не меняются в рантайме — считываем один раз,
// а не при каждом вызове getSettings() (он происходит на каждый запрос прокси)
const ENV_OVERRIDES = (() => {
  const envOverrides = {};
  if (process.env.RULE34_API_KEY) envOverrides.rule34ApiKey = process.env.RULE34_API_KEY;
  if (process.env.RULE34_USER_ID) envOverrides.rule34UserId = process.env.RULE34_USER_ID;
  if (process.env.GELBOORU_API_KEY) envOverrides.gelbooruApiKey = process.env.GELBOORU_API_KEY;
  if (process.env.GELBOORU_USER_ID) envOverrides.gelbooruUserId = process.env.GELBOORU_USER_ID;
  if (process.env.DANBOORU_API_KEY) envOverrides.danbooruApiKey = process.env.DANBOORU_API_KEY;
  if (process.env.DANBOORU_LOGIN) envOverrides.danbooruLogin = process.env.DANBOORU_LOGIN;
  return Object.freeze(envOverrides);
})();

let inMemorySettings = null;
export function getSettings(userId = null) {
  const filePath = getUserFilePath(userId, SETTINGS_FILE, 'settings.json');
  let settings;
  if (!userId && inMemorySettings) {
    settings = inMemorySettings;
  } else {
    const raw = readJsonFile(filePath, {});
    settings = { ...DEFAULT_SETTINGS, ...raw };
    if (!userId) inMemorySettings = settings;
  }

  return { ...settings, ...ENV_OVERRIDES };
}

export function updateSettings(partial, userId = null) {
  const current = getSettings(userId);
  const updated = { ...current, ...(partial || {}) };
  const filePath = getUserFilePath(userId, SETTINGS_FILE, 'settings.json');
  if (!userId) inMemorySettings = updated;
  writeJsonFileAsync(filePath, updated);
  return updated;
}

export function getFavorites(userId = null) {
  const filePath = getUserFilePath(userId, FAVORITES_FILE, 'favorites.json');
  return readJsonFile(filePath, []);
}

export function saveFavorites(favorites, userId = null) {
  const filePath = getUserFilePath(userId, FAVORITES_FILE, 'favorites.json');
  writeJsonFileAsync(filePath, favorites);
}

export function getFavoriteAuthors(userId = null) {
  const filePath = getUserFilePath(userId, FAVORITE_AUTHORS_FILE, 'favorite_authors.json');
  return readJsonFile(filePath, []);
}

export function saveFavoriteAuthors(authors, userId = null) {
  const filePath = getUserFilePath(userId, FAVORITE_AUTHORS_FILE, 'favorite_authors.json');
  writeJsonFileAsync(filePath, authors);
}

export function getLikes(userId = null) {
  const filePath = getUserFilePath(userId, LIKES_FILE, 'likes.json');
  return readJsonFile(filePath, []);
}

export function saveLikes(likes, userId = null) {
  const filePath = getUserFilePath(userId, LIKES_FILE, 'likes.json');
  writeJsonFileAsync(filePath, likes);
}

export function getDislikes(userId = null) {
  const filePath = getUserFilePath(userId, DISLIKES_FILE, 'dislikes.json');
  return readJsonFile(filePath, []);
}

export function saveDislikes(dislikes, userId = null) {
  const filePath = getUserFilePath(userId, DISLIKES_FILE, 'dislikes.json');
  writeJsonFileAsync(filePath, dislikes);
}

export function clearDislikes(userId = null) {
  const filePath = getUserFilePath(userId, DISLIKES_FILE, 'dislikes.json');
  writeJsonFileAsync(filePath, []);
}

export async function sendBooruLike(site, postId, isLike, settings) {
  try {
    if (site === 'danbooru' && settings.danbooruLogin && settings.danbooruApiKey) {
      const auth = Buffer.from(`${settings.danbooruLogin}:${settings.danbooruApiKey}`).toString('base64');
      if (isLike) {
        await fetch(`https://danbooru.donmai.us/favorites.json?post_id=${encodeURIComponent(postId)}`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'User-Agent': BROWSER_USER_AGENT
          }
        }).catch(() => {});
        await fetch(`https://danbooru.donmai.us/posts/${encodeURIComponent(postId)}/votes.json`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json',
            'User-Agent': BROWSER_USER_AGENT
          },
          body: JSON.stringify({ score: 1 })
        }).catch(() => {});
      } else {
        await fetch(`https://danbooru.donmai.us/favorites/${encodeURIComponent(postId)}.json`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Basic ${auth}`,
            'User-Agent': BROWSER_USER_AGENT
          }
        }).catch(() => {});
      }
    }
  } catch (err) {
    logError('LikeSync', `Ошибка отправки лайка на ${site}:`, err);
  }
}
