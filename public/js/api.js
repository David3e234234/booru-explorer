// Клиентский API модуль

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
  const res = await fetch(`/api/posts?${query.toString()}`);
  if (!res.ok) return { success: true, posts: [] };
  return await res.json();
}

export async function fetchTagAutocomplete(query, site = 'danbooru') {
  if (!query) return { tags: [] };
  const res = await fetch(`/api/tags/autocomplete?q=${encodeURIComponent(query)}&site=${encodeURIComponent(site)}`);
  if (!res.ok) return { tags: [] };
  return await res.json();
}

export async function fetchFavorites() {
  const res = await fetch('/api/favorites');
  if (!res.ok) return { favorites: [] };
  return await res.json();
}

export async function toggleFavoritePost(post) {
  const res = await fetch('/api/favorites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(post)
  });
  return await res.json();
}

export async function deleteFavoritePost(id) {
  const res = await fetch(`/api/favorites/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
  return await res.json();
}

export async function fetchSettings() {
  const res = await fetch('/api/settings');
  if (!res.ok) return { settings: {} };
  return await res.json();
}

export async function saveSettings(settings) {
  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
