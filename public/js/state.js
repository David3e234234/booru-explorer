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
  currentCategory: 'new', // 'new', 'popular', 'top', 'random', 'favorites'
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
  favoritesSubTab: 'posts', // 'posts' | 'authors'
  favoriteAuthors: [],
  favoriteAuthorNames: new Set(),
  settings: {
    theme: 'dark',
    itemsPerPage: 100,
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

export function clearSearchTags() {
  state.searchTags = [];
}

export function setFavorites(favList) {
  state.favorites = favList || [];
  state.favoriteIds = new Set(state.favorites.map(f => f.id));
}

export function isPostFavorite(id) {
  return state.favoriteIds.has(id);
}

export function setFavoriteAuthors(authorsList) {
  state.favoriteAuthors = authorsList || [];
  state.favoriteAuthorNames = new Set(
    state.favoriteAuthors.map(a => (a.name || '').toLowerCase().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_'))
  );
}

export function isAuthorFavorite(name) {
  if (!name) return false;
  const clean = String(name).toLowerCase().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_').trim();
  return state.favoriteAuthorNames.has(clean);
}
