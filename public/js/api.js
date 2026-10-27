import { state, STORAGE_KEYS, SECRET_SETTING_FIELDS } from './state.js';

const DEFAULT_FETCH_TIMEOUT_MS = 30000;

// Long-running endpoints (archive inspection, telegram backups, upstream auth
// probes) get a bigger budget; the search feed gets enough for a deep fetch.
function fetchTimeoutFor(url) {
  const u = String(url);
  if (u.startsWith('/api/posts')) return 45000;
  if (u.includes('/api/archive/') || u.includes('/api/backup/') || u.includes('/api/sync-external') || u.includes('/api/proxy/test') || u.includes('/api/sites/auth-test')) return 120000;
  return DEFAULT_FETCH_TIMEOUT_MS;
}

// Every client request gets a hard timeout: a hung upstream must surface as an
// error toast instead of an endless spinner (and a blocked init chain).
function fetchWithTimeout(url, options = {}) {
  const timeoutSignal = AbortSignal.timeout(fetchTimeoutFor(url));
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;
  return fetch(url, { ...options, signal });
}

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function readJsonOrThrow(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data.message || data.error || `HTTP ${res.status}`, res.status);
  }
  return data;
}

export const ADMIN_TOKEN_STORAGE_KEY = STORAGE_KEYS.ADMIN_TOKEN;

let cachedAdminToken = null;

export function getAdminToken() {
  if (cachedAdminToken !== null) return cachedAdminToken;
  try {
    cachedAdminToken = localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || '';
  } catch (e) {
    cachedAdminToken = '';
  }
  return cachedAdminToken;
}

export function setAdminToken(value) {
  const token = String(value || '').trim();
  cachedAdminToken = token;
  try {
    if (token) localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  } catch (e) {}
}

const AUTH_CACHE_FIELDS = [
  'rule34ApiKey', 'rule34UserId',
  'gelbooruApiKey', 'gelbooruUserId',
  'danbooruApiKey', 'danbooruLogin',
  'konachanLogin', 'konachanPassword',
  'yandereLogin', 'yanderePassword',
  'pawchiveSession', 'kemonoSession', 'kemonoProxy',
  'curvyTags', 'petiteTags', 'furryTags', 'pregnantTags', 'lgbtTags', 'aiTags', 'blacklist',
  'groupAlbums', 'prioritizeUserTags', 'deepFetchPages', 'rule34Provider', 'enablePaheal',
  'customAliases', 'enableAliasDiscovery', 'ignoredAliases', 'siteSortTags', 'pawchiveService', 'kemonoService', 'hideZipPosts',
  ...SECRET_SETTING_FIELDS.filter(f => !['telegramBotToken', 'telegramChatId'].includes(f)),
  'globalProxy', 'danbooruProxy', 'gelbooruProxy', 'rule34Proxy', 'yandereProxy',
  'konachanProxy', 'safebooruProxy', 'rule34videoProxy', 'xbooruProxy', 'hypnohubProxy',
  'tbibProxy', 'pawchiveProxy'
];

let cachedAuthHeader = null;
let cachedAuthToken = null;
let cachedAdminTokenValue = null;
let cachedAuthKey = '';

export function markAuthHeadersDirty() {
  cachedAuthHeader = null;
  cachedAuthKey = '';
}

function buildAuthKey() {
  const s = state.settings || {};
  let key = state.authToken || '';
  for (const field of AUTH_CACHE_FIELDS) {
    const val = s[field];
    if (val === undefined || val === null) continue;
    if (Array.isArray(val)) key += `[${val.join(',')}]`;
    else if (typeof val === 'object') key += JSON.stringify(val);
    else key += String(val);
  }
  key += `|${cachedAdminToken || ''}`;
  return key;
}

export function getAuthHeaders(includeJson = false) {
  const headers = {};
  if (includeJson) {
    headers['Content-Type'] = 'application/json';
  }
  if (state && state.authToken) {
    headers['Authorization'] = `Bearer ${state.authToken}`;
  }
  const adminToken = getAdminToken();
  if (adminToken) {
    headers['x-booru-admin-token'] = adminToken;
  }
  if (state && state.settings) {
    const authKey = buildAuthKey();
    if (cachedAuthHeader && cachedAuthKey === authKey && cachedAuthToken === state.authToken && cachedAdminTokenValue === adminToken) {
      headers['x-booru-auth'] = cachedAuthHeader;
      return headers;
    }
    const authData = {};
    for (const field of AUTH_CACHE_FIELDS) {
      const val = state.settings[field];
      if (val === undefined || val === null) continue;
      if (Array.isArray(val)) {
        if (val.length > 0) authData[field] = val;
      } else if (typeof val === 'object') {
        if (Object.keys(val).length > 0) authData[field] = val;
      } else {
        authData[field] = val;
      }
    }
    const serialized = encodeURIComponent(JSON.stringify(authData));
    cachedAuthHeader = serialized;
    cachedAuthKey = authKey;
    cachedAuthToken = state.authToken;
    cachedAdminTokenValue = adminToken;
    headers['x-booru-auth'] = serialized;
  }
  return headers;
}

export const inFlightRequests = new Map();

export function dedupedFetch(key, fetchFn) {
  if (inFlightRequests.has(key)) {
    return inFlightRequests.get(key).then(res => (typeof res?.clone === 'function' ? res.clone() : res));
  }
  const promise = fetchFn().finally(() => {
    inFlightRequests.delete(key);
  });
  inFlightRequests.set(key, promise);
  return promise.then(res => (typeof res?.clone === 'function' ? res.clone() : res));
}

export async function apiRegister(username, password, initialData = {}) {
  const res = await fetchWithTimeout('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, initialData })
  });
  return await res.json();
}

export async function apiLogin(username, password, initialData = null) {
  const body = { username, password };
  if (initialData) body.initialData = initialData;
  const res = await fetchWithTimeout('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return await res.json();
}

export async function apiGetMe() {
  const res = await fetchWithTimeout('/api/auth/me', {
    headers: getAuthHeaders()
  });
  if (res.status === 401 || res.status === 403) return null;
  return readJsonOrThrow(res);
}

export async function apiLogout() {
  try {
    await fetchWithTimeout('/api/auth/logout', { method: 'POST', headers: getAuthHeaders() });
  } catch (e) {}
}

export async function apiExportAccount() {
  try {
    const res = await fetchWithTimeout('/api/auth/export', { headers: getAuthHeaders() });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.success ? data.account : null;
  } catch (e) {
    return null;
  }
}

export async function apiRestoreAccount(account, password) {
  const res = await fetchWithTimeout('/api/auth/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password })
  });
  return await res.json();
}

export async function fetchSites() {
  const res = await fetchWithTimeout('/api/sites');
  if (!res.ok) throw new Error('Не удалось загрузить список сайтов');
  return await res.json();
}

export async function fetchPawchiveServices() {
  try {
    const res = await fetchWithTimeout('/api/pawchive-services');
    if (!res.ok) return { success: false, services: [] };
    return await res.json();
  } catch (e) {
    return { success: false, services: [] };
  }
}

export async function fetchKemonoServices() {
  try {
    const res = await fetchWithTimeout('/api/kemono-services');
    if (!res.ok) return { success: false, services: [] };
    return await res.json();
  } catch (e) {
    return { success: false, services: [] };
  }
}

export async function fetchPosts({
  site = 'danbooru',
  tags = '',
  page = 1,
  limit = 40,
  category = 'new',
  aiFilter = 'no-ai',
  ratingFilter = 'all',
  typeFilter = 'all',
  ageFilter = 'all',
  hideFurry = true,
  hidePregnant = true,
  hideLgbt = true,
  customSites = '',
  pawchiveService = '',
  kemonoService = '',
  bustCache = false
}) {
  const params = {
    site,
    tags,
    page: String(page),
    limit: String(limit),
    category,
    aiFilter,
    ratingFilter,
    typeFilter,
    ageFilter,
    hideFurry: hideFurry ? 'true' : 'false',
    hidePregnant: hidePregnant ? 'true' : 'false',
    hideLgbt: hideLgbt ? 'true' : 'false'
  };

  if (customSites) {
    params.customSites = Array.isArray(customSites) ? customSites.join(',') : customSites;
  }

  if (pawchiveService && pawchiveService !== 'all') {
    params.pawchiveService = pawchiveService;
  }

  if (kemonoService && kemonoService !== 'all') {
    params.kemonoService = kemonoService;
  }

  if (bustCache) {
    params._t = String(Date.now());
  }
  const query = new URLSearchParams(params);
  const url = `/api/posts?${query.toString()}`;
  const res = await dedupedFetch(url, () => fetchWithTimeout(url, {
    headers: getAuthHeaders()
  }));
  // Surface HTTP failures: returning a fake empty success used to kill infinite
  // scroll after one transient error and showed "nothing found" instead of the error state
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return await res.json();
}

export async function fetchAlbumPosts({ site = 'danbooru', seriesKey = '', parentId = '', originalId = '', postUrl = '' }, options = {}) {
  const params = new URLSearchParams();
  if (site) params.set('site', site);
  if (seriesKey) params.set('seriesKey', seriesKey);
  if (parentId) params.set('parentId', parentId);
  if (originalId) params.set('originalId', originalId);
  if (postUrl) params.set('postUrl', postUrl);

  const res = await fetchWithTimeout(`/api/posts/album?${params.toString()}`, {
    headers: getAuthHeaders(),
    signal: options.signal
  });
  return readJsonOrThrow(res);
}

// View-history helper: re-fetches a full post from its board by id. Returns
// null on any failure so the caller can fall back to the stored thumbnail.
export async function resolvePostById(site, postId) {
  try {
    const params = new URLSearchParams({ site, id: postId });
    const res = await fetchWithTimeout(`/api/resolve-post?${params.toString()}`, {
      headers: getAuthHeaders()
    });
    const data = await readJsonOrThrow(res);
    return (data && data.success && data.post) ? data.post : null;
  } catch (e) {
    return null;
  }
}

export async function fetchArchiveList(zipUrl, options = {}) {
  const threads = options.threads ?? state.settings?.archiveDownloadThreads ?? 4;
  const res = await fetchWithTimeout(`/api/archive/list?url=${encodeURIComponent(zipUrl)}&threads=${threads}`, {
    headers: getAuthHeaders()
  });
  return readJsonOrThrow(res);
}

export async function fetchArchiveStatus(zipUrl) {
  const res = await fetchWithTimeout(`/api/archive/status?url=${encodeURIComponent(zipUrl)}`, {
    headers: getAuthHeaders()
  });
  // A failed request is not a finished job: throwing lets the poller retry
  // instead of freezing the card at the last known percentage.
  return readJsonOrThrow(res);
}

export async function fetchArchiveInspect(zipUrl, options = {}) {
  try {
    const threads = options.threads ?? state.settings?.archiveDownloadThreads ?? 4;
    const res = await fetchWithTimeout(`/api/archive/inspect?url=${encodeURIComponent(zipUrl)}&threads=${threads}`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return { success: false, error: errData.error || `HTTP ${res.status}` };
    }
    return await res.json();
  } catch (err) {
    return { success: false, error: err.message || 'Сетевая ошибка' };
  }
}

export async function fetchTagAutocomplete(query, site = 'danbooru') {
  if (!query) return { tags: [] };
  const url = `/api/tags/autocomplete?q=${encodeURIComponent(query)}&site=${encodeURIComponent(site)}`;
  const res = await dedupedFetch(url, () => fetchWithTimeout(url, {
    headers: getAuthHeaders()
  }));
  return readJsonOrThrow(res);
}

export async function fetchFavorites() {
  const res = await fetchWithTimeout('/api/favorites', {
    headers: getAuthHeaders()
  });
  return readJsonOrThrow(res);
}

// Strip internal viewer state before a post leaves the browser. The server
// applies the same allowlist, but doing it here keeps a payload carrying a
// similar-posts pool (up to ~120 posts) off the wire, and every such field
// would otherwise count against the express.json body limit.
function cleanPostPayload(post, desiredState = null) {
  if (!post || typeof post !== 'object') return { id: post, desiredState };
  const clean = {};
  for (const [key, value] of Object.entries(post)) {
    if (key.startsWith('_')) continue;
    if (key === 'albumItems' || key === 'allSeriesKeys' || key === 'desiredState') continue;
    clean[key] = value;
  }
  return { ...clean, desiredState };
}

export async function toggleFavoritePost(post, desiredState = null) {
  const res = await fetchWithTimeout('/api/favorites', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify(cleanPostPayload(post, desiredState))
  });
  return await res.json();
}

export async function deleteFavoritePost(id) {
  const res = await fetchWithTimeout(`/api/favorites/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: getAuthHeaders()
  });
  return await res.json();
}

export async function syncFavorites(favorites) {
  const res = await fetchWithTimeout('/api/favorites/sync', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify({ favorites: Array.isArray(favorites) ? favorites.map(f => cleanPostPayload(f)) : [] })
  });
  return await res.json();
}

export async function fetchLikes() {
  const res = await fetchWithTimeout('/api/likes', {
    headers: getAuthHeaders()
  });
  return readJsonOrThrow(res);
}

export async function toggleLikePost(post, desiredState = null) {
  const res = await fetchWithTimeout('/api/like', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify(cleanPostPayload(post, desiredState))
  });
  return await res.json();
}

export async function syncLikes(likes) {
  const res = await fetchWithTimeout('/api/likes/sync', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify({ likes: Array.isArray(likes) ? likes.map(l => cleanPostPayload(l)) : [] })
  });
  return await res.json();
}

export async function fetchDislikes() {
  const res = await fetchWithTimeout('/api/dislikes', {
    headers: getAuthHeaders()
  });
  return readJsonOrThrow(res);
}

export async function toggleDislikeApi(post, desiredState = null) {
  const res = await fetchWithTimeout('/api/dislike', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify(cleanPostPayload(post, desiredState))
  });
  return await res.json();
}

export async function clearDislikesApi() {
  const res = await fetchWithTimeout('/api/dislikes/clear', {
    method: 'POST',
    headers: getAuthHeaders(true)
  });
  return await res.json();
}

export async function syncDislikes(dislikes) {
  const res = await fetchWithTimeout('/api/dislikes/sync', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify({ dislikes })
  });
  return await res.json();
}

export async function fetchFavoriteAuthors() {
  const res = await fetchWithTimeout('/api/favorite-authors', {
    headers: getAuthHeaders()
  });
  return readJsonOrThrow(res);
}

export async function toggleFavoriteAuthor(authorData) {
  const res = await fetchWithTimeout('/api/favorite-authors', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify(authorData)
  });
  return await res.json();
}

export async function deleteFavoriteAuthor(name) {
  const res = await fetchWithTimeout(`/api/favorite-authors/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: getAuthHeaders()
  });
  return await res.json();
}

export async function updateFavoriteAuthorPreview(name, previewUrl, site = 'danbooru', extra = {}) {
  try {
    const res = await fetchWithTimeout('/api/favorite-authors/preview', {
      method: 'POST',
      headers: getAuthHeaders(true),
      body: JSON.stringify({ name, previewUrl, site, ...extra })
    });
    if (res.ok) {
      return await res.json();
    }
    console.warn(`Сервер вернул статус ${res.status} при обновлении превью, сохраняем локально`);
    return { success: true, fallback: true };
  } catch (err) {
    console.warn('Сервер недоступен при обновлении превью, сохраняем локально:', err);
    return { success: true, fallback: true };
  }
}

export async function syncFavoriteAuthors(authors) {
  const res = await fetchWithTimeout('/api/favorite-authors/sync', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify({ authors })
  });
  return await res.json();
}

export async function fetchSettings() {
  const res = await fetchWithTimeout('/api/settings', {
    headers: getAuthHeaders()
  });
  return readJsonOrThrow(res);
}

export async function saveSettings(settings) {
  const res = await fetchWithTimeout('/api/settings', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify(settings)
  });
  return await res.json();
}

export async function fetchNotifications() {
  const res = await fetchWithTimeout('/api/notifications', {
    headers: getAuthHeaders()
  });
  return await res.json();
}

export async function markNotificationRead(id) {
  const res = await fetchWithTimeout('/api/notifications/read', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify({ id })
  });
  return await res.json();
}

export async function markAllNotificationsRead() {
  const res = await fetchWithTimeout('/api/notifications/read', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify({ all: true })
  });
  return await res.json();
}

export async function deleteNotificationApi(id) {
  const res = await fetchWithTimeout(`/api/notifications/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: getAuthHeaders()
  });
  return await res.json();
}

export async function clearNotificationsApi() {
  const res = await fetchWithTimeout('/api/notifications', {
    method: 'DELETE',
    headers: getAuthHeaders()
  });
  return await res.json();
}

export async function checkNotificationsApi(authors = null) {
  const res = await fetchWithTimeout('/api/notifications/check', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify({ authors: Array.isArray(authors) ? authors : undefined })
  });
  return await res.json();
}

export function shouldProxyMedia({ site = '', url = '', type = 'thumbnail', settings = null } = {}) {
  if (!url || typeof url !== 'string') return false;
  if (url.startsWith('/api/')) return false;

  const effSettings = settings || state.settings || {};
  const cleanSite = (site || '').trim().toLowerCase();
  const siteMode = effSettings.siteMediaProxy?.[cleanSite];

  if (siteMode === 'server') {
    return true;
  }
  if (siteMode === 'direct') {
    return false;
  }

  const isDanbooruMedia = cleanSite === 'danbooru' || url.includes('donmai.us');
  if (isDanbooruMedia) {
    return true;
  }

  if (type === 'video') {
    const isR34Video = cleanSite === 'rule34video' || url.includes('rule34video.com') || url.includes('boomio-cdn.com');
    if (isR34Video) return true;
    return effSettings.proxyVideos !== false && effSettings.proxyVideoDefault !== false;
  }

  if (type === 'image') {
    return effSettings.proxyFullImages !== false;
  }

  if (type === 'download') {
    return effSettings.proxyDownloads !== false;
  }

  return effSettings.proxyThumbnails !== false;
}

export function getMediaUrl(targetUrl, { site = '', type = 'thumbnail', settings = null } = {}) {
  if (!targetUrl || typeof targetUrl !== 'string') return '';
  if (targetUrl.startsWith('/api/')) return targetUrl;
  return shouldProxyMedia({ site, url: targetUrl, type, settings }) ? getProxiedUrl(targetUrl) : targetUrl;
}

export function getProxiedUrl(targetUrl) {
  if (!targetUrl) return '';
  // Same-origin endpoints (unpacked archive files) must not loop through the proxy
  if (targetUrl.startsWith('/api/')) return targetUrl;
  return `/api/proxy?url=${encodeURIComponent(targetUrl)}`;
}

export async function fetchCacheInfo() {
  const res = await fetchWithTimeout('/api/cache-info', {
    headers: getAuthHeaders()
  });
  if (!res.ok) return { diskCacheMB: '0.0', thumbsCount: 0, videosCount: 0, archivesCount: 0, ramCacheEntries: 0 };
  return await res.json();
}

export async function clearCache() {
  const res = await fetchWithTimeout('/api/cache-clear', {
    method: 'POST',
    headers: getAuthHeaders(true)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.message || data.error || `HTTP ${res.status}`);
  }
  return data;
}

export async function testTelegramConnection(token, chatId) {
  const res = await fetchWithTimeout('/api/backup/telegram/test', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify({ token, chatId })
  });
  return await res.json();
}

export async function testSiteAuth(payload) {
  const res = await fetchWithTimeout('/api/sites/auth-test', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify(payload)
  });
  return await res.json();
}

export async function testProxyConnection(site, proxyUrl) {
  const res = await fetchWithTimeout('/api/proxy/test', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify({ site, proxyUrl })
  });
  return await res.json();
}

export async function sendTelegramBackupNow() {
  const res = await fetchWithTimeout('/api/backup/telegram/send', {
    method: 'POST',
    headers: getAuthHeaders(true)
  });
  return await res.json();
}

export async function fetchTelegramBackupStatus() {
  const res = await fetchWithTimeout('/api/backup/telegram/status', {
    headers: getAuthHeaders()
  });
  if (!res.ok) return { enabled: false, lastBackupAt: null };
  return await res.json();
}

export async function syncExternalAccounts(options = {}) {
  const res = await fetchWithTimeout('/api/sync-external', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify(options)
  });
  return await res.json();
}

export async function fetchAliasesInfo() {
  try {
    const res = await fetchWithTimeout('/api/aliases/info', { headers: getAuthHeaders() });
    if (!res.ok) return { builtinCount: 0, discoveredCount: 0 };
    return await res.json();
  } catch {
    return { builtinCount: 0, discoveredCount: 0 };
  }
}

export async function fetchAliasesMap() {
  try {
    const res = await fetchWithTimeout('/api/aliases/map', { headers: getAuthHeaders() });
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

export async function clearDiscoveredAliasesApi() {
  try {
    const res = await fetchWithTimeout('/api/aliases/clear-discovered', {
      method: 'POST',
      headers: getAuthHeaders(true)
    });
    return await res.json();
  } catch {
    return { success: false };
  }
}

export async function fetchDiscoveredAliasesList() {
  try {
    const res = await fetchWithTimeout('/api/aliases/discovered', { headers: getAuthHeaders() });
    if (!res.ok) return { success: false, list: [] };
    return await res.json();
  } catch {
    return { success: false, list: [] };
  }
}

export async function updateDiscoveredAliasApi(id, payload) {
  try {
    const res = await fetchWithTimeout(`/api/aliases/discovered/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: getAuthHeaders(true),
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function deleteDiscoveredAliasApi(id) {
  try {
    const res = await fetchWithTimeout(`/api/aliases/discovered/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(true)
    });
    return await res.json();
  } catch (err) {
    return { success: false, error: err.message };
  }
}



