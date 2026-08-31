import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { 
  DEFAULT_SETTINGS, 
  SETTINGS_FILE, 
  FAVORITES_FILE, 
  FAVORITE_AUTHORS_FILE, 
  LIKES_FILE,
  DISLIKES_FILE,
  AUTHOR_FEED_STATE_FILE,
  BROWSER_USER_AGENT,
  DATA_DIR,
  SECRET_SETTING_FIELDS
} from '../config/constants.js';
import { logInfo, logError } from '../utils/logger.js';
import { fetchSafe, discardResponse } from '../utils/network.js';
import { getUserDataDir } from './userService.js';

const pendingWrites = new Map();
const pendingData = new Map();

function cloneData(value) {
  if (value === null || typeof value !== 'object') return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

// A half-written or hand-edited file used to fall through to defaultData silently,
// and the next save then overwrote it - favourites and settings were gone for good.
// Move the damaged file aside instead so the data stays recoverable
function quarantineCorruptFile(filePath, err) {
  try {
    if (!fs.existsSync(filePath)) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${filePath}.corrupt-${stamp}`;
    fs.renameSync(filePath, backupPath);
    logError('Storage', `Файл ${filePath} повреждён и не читается как JSON. Копия сохранена как ${backupPath}`, err);
  } catch (renameErr) {
    logError('Storage', `Не удалось сохранить копию повреждённого файла ${filePath}`, renameErr);
  }
}

// Write through a temp file + rename: the target is never open in a truncated
// state, so a crash or a kill mid-write cannot leave a half-written JSON behind
function tmpPathFor(filePath) {
  return `${filePath}.${process.pid}.tmp`;
}

function writeFileAtomicSync(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpPath = tmpPathFor(filePath);
  try {
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch {}
    throw err;
  }
}

async function writeFileAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) await fs.promises.mkdir(dir, { recursive: true });
  const tmpPath = tmpPathFor(filePath);
  try {
    await fs.promises.writeFile(tmpPath, content, 'utf-8');
    await fs.promises.rename(tmpPath, filePath);
  } catch (err) {
    await fs.promises.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

function cancelPendingWrite(filePath) {
  const timer = pendingWrites.get(filePath);
  if (timer) {
    clearTimeout(timer);
    pendingWrites.delete(filePath);
  }
}

export function readJsonFile(filePath, defaultData) {
  if (pendingData.has(filePath)) {
    return cloneData(pendingData.get(filePath));
  }
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      try {
        return JSON.parse(content);
      } catch (parseErr) {
        quarantineCorruptFile(filePath, parseErr);
        return cloneData(defaultData);
      }
    }
  } catch (err) {
    logError('Storage', `Ошибка чтения ${filePath}`, err);
  }
  return cloneData(defaultData);
}

export function writeJsonFile(filePath, data) {
  pendingData.set(filePath, data);
  // A debounced write already queued for this file carries older data and would
  // land on top of this one
  cancelPendingWrite(filePath);
  try {
    writeFileAtomicSync(filePath, JSON.stringify(data, null, 2));
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
  cancelPendingWrite(filePath);
  const timer = setTimeout(async () => {
    pendingWrites.delete(filePath);
    try {
      await writeFileAtomic(filePath, JSON.stringify(data, null, 2));
      // A newer write may have been queued while we were awaiting - its data wins
      if (!pendingWrites.has(filePath)) {
        pendingData.delete(filePath);
      }
    } catch (err) {
      logError('Storage', `Ошибка асинхронной записи ${filePath}`, err);
    }
  }, debounceMs);
  pendingWrites.set(filePath, timer);
}

// Debounced writes are lost when the process goes down before the timer fires.
// Called from the shutdown handlers in server.js
export function flushPendingWrites() {
  const entries = [...pendingWrites.entries()];
  pendingWrites.clear();
  for (const [filePath] of entries) {
    const data = pendingData.get(filePath);
    if (data === undefined) continue;
    try {
      writeFileAtomicSync(filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      logError('Storage', `Не удалось сбросить отложенную запись ${filePath}`, err);
    }
  }
  pendingData.clear();
}

function getUserFilePath(userId, defaultFile, filename) {
  if (!userId) return defaultFile;
  const userDir = getUserDataDir(userId);
  return path.join(userDir, filename);
}

// Environment variables never change at runtime - read them once,
// not on every getSettings() call (it runs on every proxy request)
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

// On-disk settings, without the environment overlay
function readSettingsRaw(userId) {
  const filePath = getUserFilePath(userId, SETTINGS_FILE, 'settings.json');
  if (!userId && inMemorySettings) return inMemorySettings;
  const raw = readJsonFile(filePath, {});
  const settings = { ...DEFAULT_SETTINGS, ...raw };
  if (!userId) inMemorySettings = settings;
  return settings;
}

export function getSettings(userId = null) {
  return { ...readSettingsRaw(userId), ...ENV_OVERRIDES };
}

export function updateSettings(partial, userId = null) {
  // Merge over the persisted values only. Overlaying ENV_OVERRIDES here used to
  // write env-provided secrets straight into settings.json on the first save,
  // from where they leaked into Telegram backups and account exports.
  const updated = { ...readSettingsRaw(userId), ...(partial || {}) };
  const filePath = getUserFilePath(userId, SETTINGS_FILE, 'settings.json');
  if (!userId) inMemorySettings = updated;
  writeJsonFileAsync(filePath, updated);
  return { ...updated, ...ENV_OVERRIDES };
}

// Returns a copy of settings with every credential removed. Used for anonymous
// API responses and for backups, both of which can end up somewhere we do not
// control. A logged-out browser does not need this half: it keeps its own copy
// and sends the keys per request in the x-booru-auth header.
export function stripSecretSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return settings;
  const safe = { ...settings };
  for (const field of SECRET_SETTING_FIELDS) delete safe[field];
  return safe;
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

// Author-check state: { "site:name": { lastCheckedAt, knownIds, newIds } }
export function getAuthorFeedState(userId = null) {
  const filePath = getUserFilePath(userId, AUTHOR_FEED_STATE_FILE, 'author_feed_state.json');
  const data = readJsonFile(filePath, {});
  return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
}

export function saveAuthorFeedState(state, userId = null) {
  const filePath = getUserFilePath(userId, AUTHOR_FEED_STATE_FILE, 'author_feed_state.json');
  writeJsonFileAsync(filePath, state);
}

const MOEBOORU_PASSWORD_SALT = 'So-I-Heard-You-Like-Mupkids-?--';

export async function sendBooruLike(site, postOrId, isLike, settings) {
  try {
    const postObj = (postOrId && typeof postOrId === 'object') ? postOrId : { id: postOrId };
    const rawId = postObj.originalId || postObj.id || '';
    const cleanId = String(rawId).replace(/^[a-z0-9]+_/i, '').trim();
    const effectiveSite = postObj.site || site || 'danbooru';

    // 1. Danbooru
    if (effectiveSite === 'danbooru') {
      if (!settings.danbooruLogin || !settings.danbooruApiKey) {
        return { success: false, site: 'danbooru', message: 'Не указаны логин или API ключ Danbooru' };
      }
      if (!cleanId) {
        return { success: false, site: 'danbooru', message: 'Не указан ID поста Danbooru' };
      }
      const login = encodeURIComponent(settings.danbooruLogin);
      const apiKey = encodeURIComponent(settings.danbooruApiKey);
      const auth = Buffer.from(`${settings.danbooruLogin}:${settings.danbooruApiKey}`).toString('base64');
      const authHeaders = {
        'Authorization': `Basic ${auth}`,
        'User-Agent': BROWSER_USER_AGENT
      };

      if (isLike) {
        const favUrl = `https://danbooru.donmai.us/favorites.json?post_id=${encodeURIComponent(cleanId)}&login=${login}&api_key=${apiKey}`;
        const favRes = await fetchSafe(favUrl, {
          method: 'POST',
          headers: authHeaders,
          settings,
          site: 'danbooru'
        }).catch(err => ({ ok: false, status: 'network_error', error: err.message }));

        const voteUrl = `https://danbooru.donmai.us/posts/${encodeURIComponent(cleanId)}/votes.json?score=1&login=${login}&api_key=${apiKey}`;
        const voteRes = await fetchSafe(voteUrl, {
          method: 'POST',
          headers: {
            ...authHeaders,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ score: 1 }),
          settings,
          site: 'danbooru'
        }).catch(err => ({ ok: false, status: 'network_error', error: err.message }));

        // Nothing here needs the response body, but leaving it unread keeps the
        // undici socket checked out - likes fire in bursts from the gallery
        await discardResponse(favRes);
        await discardResponse(voteRes);

        const isFavOk = favRes?.ok || favRes?.status === 200 || favRes?.status === 201 || favRes?.status === 422;
        const isVoteOk = voteRes?.ok || voteRes?.status === 200 || voteRes?.status === 201 || voteRes?.status === 422;

        logInfo('Sync', `Danbooru like [${cleanId}]: fav status=${favRes?.status || 'err'}, vote status=${voteRes?.status || 'err'}`);

        if (isFavOk || isVoteOk) {
          return { success: true, site: 'danbooru', id: cleanId, status: favRes?.status || voteRes?.status };
        }
        return { 
          success: false, 
          site: 'danbooru', 
          id: cleanId, 
          status: favRes?.status || voteRes?.status, 
          message: `Danbooru вернул статус ${favRes?.status || voteRes?.status || 'network_error'}` 
        };
      } else {
        const delUrl = `https://danbooru.donmai.us/favorites/${encodeURIComponent(cleanId)}.json?login=${login}&api_key=${apiKey}`;
        const delRes = await fetchSafe(delUrl, {
          method: 'DELETE',
          headers: authHeaders,
          settings,
          site: 'danbooru'
        }).catch(err => ({ ok: false, error: err.message }));
        await discardResponse(delRes);
        return { success: delRes?.ok || delRes?.status === 200 || delRes?.status === 204, site: 'danbooru', id: cleanId };
      }
    } 
    // 2. Yande.re & Konachan (Moebooru)
    else if (effectiveSite === 'yandere' || effectiveSite === 'konachan') {
      const isYandere = effectiveSite === 'yandere';
      const baseUrl = isYandere ? 'https://yande.re' : 'https://konachan.com';
      const login = String(isYandere ? (settings.yandereLogin || '') : (settings.konachanLogin || '')).trim();
      const pass = String(isYandere ? (settings.yanderePassword || '') : (settings.konachanPassword || '')).trim();

      if (!login || !pass) {
        return { success: false, site: effectiveSite, message: `Не указан логин или пароль ${effectiveSite}` };
      }
      if (!cleanId) {
        return { success: false, site: effectiveSite, message: `Не указан ID поста ${effectiveSite}` };
      }

      const passHash = crypto.createHash('sha1').update(`${MOEBOORU_PASSWORD_SALT}${pass}--`).digest('hex');
      const score = isLike ? 3 : 0;
      const voteUrl = `${baseUrl}/post/vote.json?id=${encodeURIComponent(cleanId)}&score=${score}&login=${encodeURIComponent(login)}&password_hash=${passHash}`;
      const voteRes = await fetchSafe(voteUrl, {
        method: 'POST',
        headers: { 'User-Agent': BROWSER_USER_AGENT },
        settings,
        site: effectiveSite
      }).catch(err => ({ ok: false, error: err.message }));

      logInfo('Sync', `${effectiveSite} vote [${cleanId}]: status=${voteRes?.status || (voteRes?.ok ? 200 : 'err')}`);
      await discardResponse(voteRes);
      const isOk = voteRes?.ok || voteRes?.status === 200;
      return { success: isOk, site: effectiveSite, id: cleanId, status: voteRes?.status };
    }
    // 3. Pawchive
    else if (effectiveSite === 'pawchive') {
      if (!settings.pawchiveSession) {
        return { success: false, site: 'pawchive', message: 'Не указан Session Token Pawchive' };
      }
      const token = String(settings.pawchiveSession).replace(/^session=/i, '').trim();
      let service = postObj.service || null;
      let creatorId = postObj.user || null;
      let realPostId = cleanId.split('_')[0];

      if (String(rawId).includes(':')) {
        const parts = String(rawId).split(':');
        if (parts.length === 4 && parts[0] === 'pawchive') {
          service = parts[1];
          creatorId = parts[2];
          realPostId = parts[3];
        }
      }
      if (service && creatorId && realPostId) {
        const method = isLike ? 'POST' : 'DELETE';
        const pawRes = await fetchSafe(`https://pawchive.pw/api/v1/favorites/post/${service}/${creatorId}/${realPostId}`, {
          method,
          headers: {
            'Cookie': `session=${token}`,
            'User-Agent': BROWSER_USER_AGENT
          },
          settings,
          site: 'pawchive'
        }).catch(err => ({ ok: false, error: err.message }));
        logInfo('Sync', `Pawchive like [${realPostId}]: status=${pawRes?.status || (pawRes?.ok ? 200 : 'err')}`);
        await discardResponse(pawRes);
        const isOk = pawRes?.ok || pawRes?.status === 200 || pawRes?.status === 201;
        return { success: isOk, site: 'pawchive', id: realPostId, status: pawRes?.status };
      }
      return { success: false, site: 'pawchive', message: 'Недостаточно данных поста Pawchive' };
    }

    return { success: false, site: effectiveSite, message: `Сайт ${effectiveSite} не поддерживает синхронизацию` };
  } catch (err) {
    logError('LikeSync', `Ошибка отправки лайка на ${site}:`, err);
    return { success: false, site, error: err.message };
  }
}

export async function sendBooruFavorite(site, postOrId, isFavorite, settings) {
  // Synchronize favorites with remote boorus that support favorites
  return sendBooruLike(site, postOrId, isFavorite, settings);
}

export async function sendBooruAuthorFollow(site, authorOrName, isFollow, settings) {
  try {
    const rawName = typeof authorOrName === 'object' ? (authorOrName.name || authorOrName.id || '') : String(authorOrName || '');
    const cleanName = rawName.replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_').trim();
    if (!cleanName) return { success: false, message: 'Пустое имя автора' };

    const targetSite = (typeof authorOrName === 'object' && authorOrName.site) ? authorOrName.site : (site || 'danbooru');

    if (targetSite === 'pawchive') {
      if (!settings.pawchiveSession) {
        return { success: false, site: 'pawchive', message: 'Не указан Session Token Pawchive' };
      }
      const token = String(settings.pawchiveSession).replace(/^session=/i, '').trim();
      let service = (typeof authorOrName === 'object' && authorOrName.service) || '';
      let creatorId = cleanName;
      if (cleanName.includes(':')) {
        const parts = cleanName.split(':');
        if (parts.length >= 2) {
          service = parts[0];
          creatorId = parts[1];
        }
      }
      if (service && creatorId) {
        const method = isFollow ? 'POST' : 'DELETE';
        const res = await fetchSafe(`https://pawchive.pw/api/v1/favorites/creator/${encodeURIComponent(service)}/${encodeURIComponent(creatorId)}`, {
          method,
          headers: {
            'Cookie': `session=${token}`,
            'User-Agent': BROWSER_USER_AGENT
          },
          settings,
          site: 'pawchive'
        }).catch(err => ({ ok: false, error: err.message }));
        logInfo('Sync', `Pawchive follow [${service}:${creatorId}]: status=${res?.status || (res?.ok ? 200 : 'err')}`);
        const isOk = res?.ok || res?.status === 200 || res?.status === 201;
        // Follow requests are fire-and-forget, but undici holds the socket until the body is released
        await discardResponse(res);
        return { success: isOk, site: 'pawchive', service, creatorId, status: res?.status };
      }
      return { success: false, site: 'pawchive', message: 'Не указан сервис и автор Pawchive' };
    }

    return { success: false, site: targetSite, message: `Сайт ${targetSite} не поддерживает отслеживание авторов через API` };
  } catch (err) {
    logError('AuthorFollowSync', `Ошибка синхронизации автора на ${site}:`, err);
    return { success: false, site, error: err.message };
  }
}

