import fs from 'fs';
import { 
  DEFAULT_SETTINGS, 
  SETTINGS_FILE, 
  FAVORITES_FILE, 
  FAVORITE_AUTHORS_FILE, 
  LIKES_FILE, 
  BROWSER_USER_AGENT 
} from '../config/constants.js';
import { logError } from '../utils/logger.js';

export function readJsonFile(filePath, defaultData) {
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
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    logError('Storage', `Ошибка записи ${filePath}`, err);
    return false;
  }
}

const pendingWrites = new Map();
export function writeJsonFileAsync(filePath, data, debounceMs = 150) {
  if (pendingWrites.has(filePath)) {
    clearTimeout(pendingWrites.get(filePath));
  }
  const timer = setTimeout(async () => {
    pendingWrites.delete(filePath);
    try {
      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      logError('Storage', `Ошибка асинхронной записи ${filePath}`, err);
    }
  }, debounceMs);
  pendingWrites.set(filePath, timer);
}

let inMemorySettings = null;
export function getSettings() {
  if (!inMemorySettings) {
    inMemorySettings = readJsonFile(SETTINGS_FILE, DEFAULT_SETTINGS);
  }
  const envOverrides = {};
  if (process.env.RULE34_API_KEY) envOverrides.rule34ApiKey = process.env.RULE34_API_KEY;
  if (process.env.RULE34_USER_ID) envOverrides.rule34UserId = process.env.RULE34_USER_ID;
  if (process.env.GELBOORU_API_KEY) envOverrides.gelbooruApiKey = process.env.GELBOORU_API_KEY;
  if (process.env.GELBOORU_USER_ID) envOverrides.gelbooruUserId = process.env.GELBOORU_USER_ID;
  if (process.env.DANBOORU_API_KEY) envOverrides.danbooruApiKey = process.env.DANBOORU_API_KEY;
  if (process.env.DANBOORU_LOGIN) envOverrides.danbooruLogin = process.env.DANBOORU_LOGIN;

  return { ...inMemorySettings, ...envOverrides };
}

export function updateSettings(partial) {
  const current = getSettings();
  inMemorySettings = { ...current, ...(partial || {}) };
  writeJsonFileAsync(SETTINGS_FILE, inMemorySettings);
  return inMemorySettings;
}

export function getFavorites() {
  return readJsonFile(FAVORITES_FILE, []);
}

export function saveFavorites(favorites) {
  writeJsonFileAsync(FAVORITES_FILE, favorites);
}

export function getFavoriteAuthors() {
  return readJsonFile(FAVORITE_AUTHORS_FILE, []);
}

export function saveFavoriteAuthors(authors) {
  writeJsonFileAsync(FAVORITE_AUTHORS_FILE, authors);
}

export function getLikes() {
  return readJsonFile(LIKES_FILE, []);
}

export function saveLikes(likes) {
  writeJsonFileAsync(LIKES_FILE, likes);
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
