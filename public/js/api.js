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
      curvyTags: state.settings.curvyTags || [],
      petiteTags: state.settings.petiteTags || []
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

export async function fetchSites() {
  const res = await fetch('/api/sites');
  if (!res.ok) throw new Error('Не удалось загрузить список сайтов');
  return await res.json();
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
    hidePregnant: hidePregnant ? 'true' : 'false'
  };

  if (bustCache) {
    params._t = String(Date.now());
  }
  const query = new URLSearchParams(params);
  const res = await fetch(`/api/posts?${query.toString()}`, {
    headers: getAuthHeaders()
  });
  if (!res.ok) return { success: true, posts: [] };
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
