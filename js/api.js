// Клиентский API модуль (Standalone версия без бэкенда)
import { SITES, fetchPosts as parserFetchPosts, fetchTagAutocomplete as parserFetchAutocomplete } from './parsers.js';

export async function fetchSites() {
  return Object.values(SITES);
}

export async function fetchPosts(options) {
  // Вызываем функцию-маршрутизатор из parsers.js с 4 аргументами
  try {
    const posts = await parserFetchPosts(options.site || 'danbooru', options, [], {});
    return { success: true, posts: posts || [] };
  } catch (err) {
    console.error('Ошибка в fetchPosts:', err);
    return { success: false, posts: [] };
  }
}

export async function fetchTagAutocomplete(query, site = 'danbooru') {
  return await parserFetchAutocomplete(query, site);
}

// === ЛОКАЛЬНОЕ ХРАНИЛИЩЕ: ИЗБРАННОЕ ===
export async function fetchFavorites() {
  const data = localStorage.getItem('booru_favorites');
  return { favorites: data ? JSON.parse(data) : [] };
}

export async function toggleFavoritePost(post) {
  let { favorites } = await fetchFavorites();
  const idx = favorites.findIndex(f => f.id === post.id && f.site === post.site);
  if (idx !== -1) {
    favorites.splice(idx, 1);
  } else {
    favorites.push(post);
  }
  localStorage.setItem('booru_favorites', JSON.stringify(favorites));
  return { success: true, favorites };
}

export async function deleteFavoritePost(id) {
  let { favorites } = await fetchFavorites();
  favorites = favorites.filter(f => String(f.id) !== String(id));
  localStorage.setItem('booru_favorites', JSON.stringify(favorites));
  return { success: true };
}

export async function syncFavorites(favorites) {
  localStorage.setItem('booru_favorites', JSON.stringify(favorites));
  return { success: true };
}

// === ЛОКАЛЬНОЕ ХРАНИЛИЩЕ: ЛАЙКИ ===
export async function fetchLikes() {
  const data = localStorage.getItem('booru_likes_v1');
  return { likes: data ? JSON.parse(data) : [] };
}

export async function toggleLikePost(post) {
  let { likes } = await fetchLikes();
  const idx = likes.findIndex(l => l.id === post.id && l.site === post.site);
  if (idx !== -1) {
    likes.splice(idx, 1);
  } else {
    likes.push({ ...post, likedAt: Date.now() });
  }
  localStorage.setItem('booru_likes_v1', JSON.stringify(likes));
  return { success: true, likes };
}

export async function syncLikes(likes) {
  localStorage.setItem('booru_likes_v1', JSON.stringify(likes));
  return { success: true };
}

// === ЛОКАЛЬНОЕ ХРАНИЛИЩЕ: АВТОРЫ ===
export async function fetchFavoriteAuthors() {
  const data = localStorage.getItem('booru_favorite_authors');
  return { authors: data ? JSON.parse(data) : [] };
}

export async function toggleFavoriteAuthor(authorData) {
  let { authors } = await fetchFavoriteAuthors();
  const idx = authors.findIndex(a => a.name === authorData.name);
  if (idx !== -1) {
    authors.splice(idx, 1);
  } else {
    authors.push({ ...authorData, addedAt: Date.now() });
  }
  localStorage.setItem('booru_favorite_authors', JSON.stringify(authors));
  return { success: true, authors };
}

export async function deleteFavoriteAuthor(name) {
  let { authors } = await fetchFavoriteAuthors();
  authors = authors.filter(a => a.name !== name);
  localStorage.setItem('booru_favorite_authors', JSON.stringify(authors));
  return { success: true };
}

export async function syncFavoriteAuthors(authors) {
  localStorage.setItem('booru_favorite_authors', JSON.stringify(authors));
  return { success: true };
}

// === ЛОКАЛЬНОЕ ХРАНИЛИЩЕ: НАСТРОЙКИ ===
export async function fetchSettings() {
  const data = localStorage.getItem('booru_settings');
  return { settings: data ? JSON.parse(data) : {} };
}

export async function saveSettings(settings) {
  localStorage.setItem('booru_settings', JSON.stringify(settings));
  return { success: true };
}

export function getProxiedUrl(targetUrl) {
  if (!targetUrl) return '';
  if (targetUrl.startsWith('blob:')) return targetUrl;
  return `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
}

export async function fetchCacheInfo() {
  // Дисковый кэш недоступен в Standalone версии
  return { diskCacheMB: '0.0', thumbsCount: 0, videosCount: 0, ramCacheEntries: 0 };
}

export async function clearCache() {
  return { success: true };
}
