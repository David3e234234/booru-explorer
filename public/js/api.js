import { state } from './state.js';

export const isMyLiveDemoHost = false;

function getAuthHeaders(includeJson = false) {
  const headers = {};
  if (includeJson) {
    headers['Content-Type'] = 'application/json';
  }
  if (state && state.authToken) {
    headers['Authorization'] = `Bearer ${state.authToken}`;
  }
  if (state && state.settings) {
    const authData = {
      rule34ApiKey: state.settings.rule34ApiKey || '',
      rule34UserId: state.settings.rule34UserId || '',
      gelbooruApiKey: state.settings.gelbooruApiKey || '',
      gelbooruUserId: state.settings.gelbooruUserId || '',
      danbooruApiKey: state.settings.danbooruApiKey || '',
      danbooruLogin: state.settings.danbooruLogin || '',
      konachanLogin: state.settings.konachanLogin || '',
      konachanPassword: state.settings.konachanPassword || '',
      yandereLogin: state.settings.yandereLogin || '',
      yanderePassword: state.settings.yanderePassword || '',
      curvyTags: state.settings.curvyTags || [],
      petiteTags: state.settings.petiteTags || [],
      furryTags: state.settings.furryTags || [],
      pregnantTags: state.settings.pregnantTags || [],
      lgbtTags: state.settings.lgbtTags || [],
      aiTags: state.settings.aiTags || [],
      blacklist: state.settings.blacklist || []
    };
    headers['x-booru-auth'] = encodeURIComponent(JSON.stringify(authData));
  }
  return headers;
}

export async function apiRegister(username, password, initialData = {}) {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, initialData })
  });
  return await res.json();
}

export async function apiLogin(username, password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return await res.json();
}

export async function apiGetMe() {
  const res = await fetch('/api/auth/me', {
    headers: getAuthHeaders()
  });
  if (!res.ok) return null;
  return await res.json();
}

export async function apiLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', headers: getAuthHeaders() });
  } catch (e) {}
}

export async function apiExportAccount() {
  try {
    const res = await fetch('/api/auth/export', { headers: getAuthHeaders() });
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.success ? data.account : null;
  } catch (e) {
    return null;
  }
}

export async function apiRestoreAccount(account) {
  const res = await fetch('/api/auth/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account })
  });
  return await res.json();
}

export async function fetchSites() {
  const res = await fetch('/api/sites');
  if (!res.ok) throw new Error('Не удалось загрузить список сайтов');
  return await res.json();
}

export async function fetchPawchiveServices() {
  try {
    const res = await fetch('/api/pawchive-services');
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
  dateFilter = 'all',
  hideFurry = true,
  hidePregnant = true,
  hideLgbt = false,
  customSites = '',
  pawchiveService = '',
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
    dateFilter,
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

  if (bustCache) {
    params._t = String(Date.now());
  }
  const query = new URLSearchParams(params);
  const res = await fetch(`/api/posts?${query.toString()}`, {
    headers: getAuthHeaders()
  });
  // Surface HTTP failures: returning a fake empty success used to kill infinite
  // scroll after one transient error and showed "nothing found" instead of the error state
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return await res.json();
}

export async function fetchAlbumPosts({ site = 'danbooru', seriesKey = '', parentId = '', originalId = '' }) {
  const params = new URLSearchParams();
  if (site) params.set('site', site);
  if (seriesKey) params.set('seriesKey', seriesKey);
  if (parentId) params.set('parentId', parentId);
  if (originalId) params.set('originalId', originalId);

  const res = await fetch(`/api/posts/album?${params.toString()}`, {
    headers: getAuthHeaders()
  });
  if (!res.ok) return { success: false, albumItems: [], albumCount: 0 };
  return await res.json();
}

export async function fetchArchiveList(zipUrl) {
  const res = await fetch(`/api/archive/list?url=${encodeURIComponent(zipUrl)}`, {
    headers: getAuthHeaders()
  });
  if (!res.ok) return { success: false, albumItems: [], albumCount: 0 };
  return await res.json();
}

export async function fetchTagAutocomplete(query, site = 'danbooru') {
  if (!query) return { tags: [] };
  const res = await fetch(`/api/tags/autocomplete?q=${encodeURIComponent(query)}&site=${encodeURIComponent(site)}`, {
    headers: getAuthHeaders()
  });
  if (!res.ok) return { tags: [] };
  return await res.json();
}

export async function fetchFavorites() {
  const res = await fetch('/api/favorites', {
    headers: getAuthHeaders()
  });
  if (!res.ok) return { favorites: [] };
  return await res.json();
}

export async function toggleFavoritePost(post) {
  const res = await fetch('/api/favorites', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify(post)
  });
  return await res.json();
}

export async function deleteFavoritePost(id) {
  const res = await fetch(`/api/favorites/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: getAuthHeaders()
  });
  return await res.json();
}

export async function syncFavorites(favorites) {
  const res = await fetch('/api/favorites/sync', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify({ favorites })
  });
  return await res.json();
}

export async function fetchLikes() {
  const res = await fetch('/api/likes', {
    headers: getAuthHeaders()
  });
  if (!res.ok) return { likes: [] };
  return await res.json();
}

export async function toggleLikePost(post) {
  const res = await fetch('/api/like', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify(post)
  });
  return await res.json();
}

export async function syncLikes(likes) {
  const res = await fetch('/api/likes/sync', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify({ likes })
  });
  return await res.json();
}

export async function fetchDislikes() {
  const res = await fetch('/api/dislikes', {
    headers: getAuthHeaders()
  });
  if (!res.ok) return { dislikes: [] };
  return await res.json();
}

export async function toggleDislikeApi(post) {
  const res = await fetch('/api/dislike', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify(post)
  });
  return await res.json();
}

export async function clearDislikesApi() {
  const res = await fetch('/api/dislikes/clear', {
    method: 'POST',
    headers: getAuthHeaders(true)
  });
  return await res.json();
}

export async function syncDislikes(dislikes) {
  const res = await fetch('/api/dislikes/sync', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify({ dislikes })
  });
  return await res.json();
}

export async function fetchFavoriteAuthors() {
  const res = await fetch('/api/favorite-authors', {
    headers: getAuthHeaders()
  });
  if (!res.ok) return { authors: [] };
  return await res.json();
}

export async function toggleFavoriteAuthor(authorData) {
  const res = await fetch('/api/favorite-authors', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify(authorData)
  });
  return await res.json();
}

export async function deleteFavoriteAuthor(name) {
  const res = await fetch(`/api/favorite-authors/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: getAuthHeaders()
  });
  return await res.json();
}

export async function updateFavoriteAuthorPreview(name, previewUrl, site = 'danbooru', extra = {}) {
  try {
    const res = await fetch('/api/favorite-authors/preview', {
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
  const res = await fetch('/api/favorite-authors/sync', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify({ authors })
  });
  return await res.json();
}

export async function fetchSettings() {
  const res = await fetch('/api/settings', {
    headers: getAuthHeaders()
  });
  if (!res.ok) return { settings: {} };
  return await res.json();
}

export async function saveSettings(settings) {
  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify(settings)
  });
  return await res.json();
}

export function getProxiedUrl(targetUrl) {
  if (!targetUrl) return '';
  // Same-origin endpoints (unpacked archive files) must not loop through the proxy
  if (targetUrl.startsWith('/api/')) return targetUrl;
  return `/api/proxy?url=${encodeURIComponent(targetUrl)}`;
}

export async function fetchCacheInfo() {
  const res = await fetch('/api/cache-info');
  if (!res.ok) return { diskCacheMB: '0.0', thumbsCount: 0, videosCount: 0, ramCacheEntries: 0 };
  return await res.json();
}

export async function clearCache() {
  const res = await fetch('/api/cache-clear', { method: 'POST' });
  return await res.json();
}

export async function testTelegramConnection(token, chatId) {
  const res = await fetch('/api/backup/telegram/test', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify({ token, chatId })
  });
  return await res.json();
}

export async function testSiteAuth(payload) {
  const res = await fetch('/api/sites/auth-test', {
    method: 'POST',
    headers: getAuthHeaders(true),
    body: JSON.stringify(payload)
  });
  return await res.json();
}

export async function sendTelegramBackupNow() {
  const res = await fetch('/api/backup/telegram/send', {
    method: 'POST',
    headers: getAuthHeaders(true)
  });
  return await res.json();
}

export async function fetchTelegramBackupStatus() {
  const res = await fetch('/api/backup/telegram/status', {
    headers: getAuthHeaders()
  });
  if (!res.ok) return { enabled: false, lastBackupAt: null };
  return await res.json();
}
