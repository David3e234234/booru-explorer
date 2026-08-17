// Реактивное состояние приложения

export const DEFAULT_SITES = [
  { id: 'danbooru', name: 'Danbooru', accentColor: '#3b82f6' },
  { id: 'rule34video', name: 'Rule34Video', accentColor: '#ef4444' },
  { id: 'yandere', name: 'Yande.re', accentColor: '#ec4899' },
  { id: 'safebooru', name: 'Safebooru', accentColor: '#10b981' },
  { id: 'konachan', name: 'Konachan', accentColor: '#f97316' },
  { id: 'rule34', name: 'Rule34', accentColor: '#aae5a4' },
  { id: 'gelbooru', name: 'Gelbooru', accentColor: '#6366f1' },
  { id: 'xbooru', name: 'Xbooru', accentColor: '#f43f5e' },
  { id: 'hypnohub', name: 'Hypnohub', accentColor: '#8b5cf6' }
];

export const state = {
  sites: [...DEFAULT_SITES],
  currentSite: 'danbooru',
  currentCategory: 'new', // 'new', 'recommended', 'popular', 'top', 'random', 'favorites'
  aiFilter: 'no-ai', // 'all', 'no-ai', 'only-ai'
  ratingFilter: 'all', // 'all', 'nsfw', 'sfw'
  typeFilter: 'all', // 'all', 'video', 'image'
  ageFilter: 'all', // 'all', 'adult', 'young'
  hideFurry: true,
  hidePregnant: true,
  searchTags: [],
  page: 1,
  limit: 100,
  posts: [],
  favorites: [],
  favoriteIds: new Set(),
  likes: [],
  likedIds: new Set(),
  favoritesSubTab: 'posts', // 'posts' | 'authors'
  favoriteAuthors: [],
  favoriteAuthorNames: new Set(),
  settings: {
    theme: 'dark',
    itemsPerPage: 100,
    proxyThumbnails: true,
    proxyFullImages: true,
    proxyVideos: true,
    proxyDownloads: true,
    proxyVideoDefault: true,
    aiTags: [],
    blacklist: [],
    ratingFilter: 'all',
    typeFilter: 'all',
    ageFilter: 'all',
    hideFurry: true,
    hidePregnant: true,
    videoAutoplayHover: true,
    videoAutoplayMobile: true,
    videoAutoplayViewer: true,
    previewQuality: 'medium',
    rule34ApiKey: '',
    rule34UserId: '',
    gelbooruApiKey: '',
    gelbooruUserId: '',
    danbooruApiKey: '',
    danbooruLogin: '',
    deepFetchPages: 2,
    prioritizeUserTags: false
  },
  currentViewerIndex: -1,
  isLoading: false,
  hasMore: true
};

export function addSearchTag(tag) {
  const clean = tag.trim().toLowerCase().replace(/\s+/g, '_');
  if (clean && !state.searchTags.includes(clean)) {
    state.searchTags.push(clean);
    return true;
  }
  return false;
}

export function removeSearchTag(tag) {
  const idx = state.searchTags.indexOf(tag);
  if (idx !== -1) {
    state.searchTags.splice(idx, 1);
    return true;
  }
  return false;
}

const STORAGE_KEYS = {
  SETTINGS: 'booru_settings_v1',
  FAVORITES: 'booru_favorites_v1',
  FAVORITE_AUTHORS: 'booru_favorite_authors_v1',
  LIKES: 'booru_likes_v1'
};

export function loadLocalSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function saveLocalSettings(settings) {
  try {
    const current = loadLocalSettings() || {};
    const updated = { ...current, ...settings };
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(updated));
  } catch (e) {}
}

export function loadLocalFavorites() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.FAVORITES);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function saveLocalFavorites(favList) {
  try {
    localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(favList || []));
  } catch (e) {}
}

export function loadLocalFavoriteAuthors() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.FAVORITE_AUTHORS);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function saveLocalFavoriteAuthors(authorsList) {
  try {
    localStorage.setItem(STORAGE_KEYS.FAVORITE_AUTHORS, JSON.stringify(authorsList || []));
  } catch (e) {}
}

export function loadLocalLikes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LIKES);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function saveLocalLikes(likesList) {
  try {
    localStorage.setItem(STORAGE_KEYS.LIKES, JSON.stringify(likesList || []));
  } catch (e) {}
}

export function clearSearchTags() {
  state.searchTags = [];
}

export function setFavorites(favList) {
  state.favorites = favList || [];
  state.favoriteIds = new Set(state.favorites.map(f => f.id));
  saveLocalFavorites(state.favorites);
}

export function isPostFavorite(id) {
  return state.favoriteIds.has(id);
}

export function setLikes(likesList) {
  state.likes = likesList || [];
  state.likedIds = new Set(state.likes.map(l => l.id));
  saveLocalLikes(state.likes);
}

export function isPostLiked(id) {
  return state.likedIds.has(id);
}

export function toggleLikeLocally(post) {
  if (!post || !post.id) return false;
  if (state.likedIds.has(post.id)) {
    state.likedIds.delete(post.id);
    state.likes = state.likes.filter(l => l.id !== post.id);
    saveLocalLikes(state.likes);
    return false;
  } else {
    state.likedIds.add(post.id);
    state.likes.unshift({
      id: post.id,
      site: post.site || 'danbooru',
      author: post.author || '',
      tags: post.tags || [],
      tagDetails: post.tagDetails || {},
      previewUrl: post.previewUrl || '',
      fileUrl: post.fileUrl || '',
      isVideo: post.isVideo || false,
      likedAt: new Date().toISOString()
    });
    saveLocalLikes(state.likes);
    return true;
  }
}

export function setFavoriteAuthors(authorsList) {
  state.favoriteAuthors = authorsList || [];
  state.favoriteAuthorNames = new Set(
    state.favoriteAuthors.map(a => (a.name || '').toLowerCase().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_'))
  );
  saveLocalFavoriteAuthors(state.favoriteAuthors);
}

export function isAuthorFavorite(name) {
  if (!name) return false;
  const clean = String(name).toLowerCase().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_').trim();
  return state.favoriteAuthorNames.has(clean);
}

// 🧠 Алгоритм извлечения карты интересов пользователя
export function getUserInterestTags() {
  const scores = new Map(); // tag -> weight
  const catMap = new Map(); // tag -> category

  // 1. Анализируем все пролайканные посты (вес × 2.0)
  for (const post of state.likes) {
    extractTagsFromPost(post, scores, catMap, 2.0);
  }

  // 2. Анализируем закладки (вес × 1.5)
  for (const post of state.favorites) {
    extractTagsFromPost(post, scores, catMap, 1.5);
  }

  // 3. Анализируем любимых авторов (вес × 5.0)
  for (const author of state.favoriteAuthors) {
    const raw = (author.name || '').toLowerCase().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_');
    if (raw) {
      scores.set(raw, (scores.get(raw) || 0) + 10.0);
      catMap.set(raw, 'artist');
    }
  }

  const list = [];
  for (const [tag, score] of scores.entries()) {
    list.push({ tag, score, category: catMap.get(tag) || 'general' });
  }

  list.sort((a, b) => b.score - a.score);
  return list;
}

function extractTagsFromPost(post, scores, catMap, multiplier = 1.0) {
  if (!post) return;

  // Авторы (вес 5.0)
  if (post.author) {
    const cleanAuthor = String(post.author).toLowerCase().split(',')[0].replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_').trim();
    if (cleanAuthor) {
      scores.set(cleanAuthor, (scores.get(cleanAuthor) || 0) + 5.0 * multiplier);
      catMap.set(cleanAuthor, 'artist');
    }
  }

  const td = post.tagDetails || {};
  if (td.artist) {
    for (const a of td.artist) {
      const clean = a.toLowerCase().trim();
      scores.set(clean, (scores.get(clean) || 0) + 5.0 * multiplier);
      catMap.set(clean, 'artist');
    }
  }
  if (td.character) {
    for (const c of td.character) {
      const clean = c.toLowerCase().trim();
      scores.set(clean, (scores.get(clean) || 0) + 3.5 * multiplier);
      catMap.set(clean, 'character');
    }
  }
  if (td.copyright) {
    for (const cp of td.copyright) {
      const clean = cp.toLowerCase().trim();
      scores.set(clean, (scores.get(clean) || 0) + 3.0 * multiplier);
      catMap.set(clean, 'copyright');
    }
  }
  if (td.general) {
    for (const g of td.general) {
      const clean = g.toLowerCase().trim();
      scores.set(clean, (scores.get(clean) || 0) + 1.2 * multiplier);
      catMap.set(clean, 'general');
    }
  } else if (Array.isArray(post.tags)) {
    for (const t of post.tags) {
      const clean = String(t).toLowerCase().trim();
      if (!scores.has(clean)) {
        scores.set(clean, (scores.get(clean) || 0) + 1.0 * multiplier);
      }
    }
  }
}

// 🎯 Вычисление процента релевантности поста
export function calculatePostMatchPercent(post, userInterestMap) {
  if (!post || !userInterestMap || userInterestMap.size === 0) {
    return 0;
  }

  let matchPoints = 0;

  const checkTag = (tag, weightMultiplier = 1.0) => {
    if (!tag) return;
    const clean = String(tag).toLowerCase().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_').trim();
    if (!clean) return;
    if (userInterestMap.has(clean)) {
      matchPoints += (userInterestMap.get(clean) || 1) * weightMultiplier;
    }
  };

  if (post.author) checkTag(post.author, 4.0);
  if (post.tagDetails) {
    if (Array.isArray(post.tagDetails.artist)) post.tagDetails.artist.forEach(a => checkTag(a, 4.0));
    if (Array.isArray(post.tagDetails.character)) post.tagDetails.character.forEach(c => checkTag(c, 3.0));
    if (Array.isArray(post.tagDetails.copyright)) post.tagDetails.copyright.forEach(cp => checkTag(cp, 2.5));
    if (Array.isArray(post.tagDetails.general)) post.tagDetails.general.forEach(g => checkTag(g, 1.0));
  } else if (Array.isArray(post.tags)) {
    for (const t of post.tags) checkTag(t, 1.0);
  }

  if (matchPoints === 0) return 0;
  const ratio = matchPoints / (matchPoints + 12);
  const percent = Math.min(99, Math.max(70, Math.round(62 + ratio * 37)));
  return percent;
}


