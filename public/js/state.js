export const isMyLiveDemoHost = false;

export const DEFAULT_SITES = [
  { id: 'danbooru', name: 'Danbooru', accentColor: '#3b82f6', rating: 'all', supportsVideo: true, supportsImages: true, supportsTags: true, supportsAiFilter: true, supportsShapesFilter: true, supportsContentHiding: true, supportsSort: true, supportedCategories: ['feed', 'following', 'recommended'] },
  { id: 'gelbooru', name: 'Gelbooru', accentColor: '#6366f1', rating: 'all', supportsVideo: true, supportsImages: true, supportsTags: true, supportsAiFilter: true, supportsShapesFilter: true, supportsContentHiding: true, supportsSort: true, supportedCategories: ['feed', 'following', 'recommended'] },
  { id: 'rule34', name: 'Rule34', accentColor: '#aae5a4', rating: 'nsfw', supportsVideo: true, supportsImages: true, supportsTags: true, supportsAiFilter: true, supportsShapesFilter: true, supportsContentHiding: true, supportsSort: true, supportedCategories: ['feed', 'following', 'recommended'] },
  { id: 'yandere', name: 'Yande.re', accentColor: '#ec4899', rating: 'all', supportsVideo: false, supportsImages: true, supportsTags: true, supportsAiFilter: true, supportsShapesFilter: true, supportsContentHiding: true, supportsSort: true, supportedCategories: ['feed', 'following', 'recommended'] },
  { id: 'konachan', name: 'Konachan', accentColor: '#f97316', rating: 'all', supportsVideo: false, supportsImages: true, supportsTags: true, supportsAiFilter: true, supportsShapesFilter: true, supportsContentHiding: true, supportsSort: true, supportedCategories: ['feed', 'following', 'recommended'] },
  { id: 'safebooru', name: 'Safebooru', accentColor: '#10b981', rating: 'safe', supportsVideo: false, supportsImages: true, supportsTags: true, supportsAiFilter: true, supportsShapesFilter: true, supportsContentHiding: true, supportsSort: true, supportedCategories: ['feed', 'following', 'recommended'] },
  { id: 'rule34video', name: 'Rule34Video', accentColor: '#ef4444', rating: 'nsfw', supportsVideo: true, supportsImages: false, supportsTags: true, supportsAiFilter: true, supportsShapesFilter: true, supportsContentHiding: true, supportsSort: true, supportedCategories: ['feed', 'following', 'recommended'] },
  { id: 'xbooru', name: 'Xbooru', accentColor: '#f43f5e', rating: 'nsfw', supportsVideo: true, supportsImages: true, supportsTags: true, supportsAiFilter: true, supportsShapesFilter: true, supportsContentHiding: true, supportsSort: true, supportedCategories: ['feed', 'following', 'recommended'] },
  { id: 'hypnohub', name: 'Hypnohub', accentColor: '#8b5cf6', rating: 'all', supportsVideo: true, supportsImages: true, supportsTags: true, supportsAiFilter: true, supportsShapesFilter: true, supportsContentHiding: true, supportsSort: true, supportedCategories: ['feed', 'following', 'recommended'] },
  { id: 'tbib', name: 'TBIB', accentColor: '#f59e0b', rating: 'all', supportsVideo: false, supportsImages: true, supportsTags: true, supportsAiFilter: true, supportsShapesFilter: true, supportsContentHiding: true, supportsSort: true, supportedCategories: ['feed', 'following', 'recommended'] },
  { id: 'pawchive', name: 'Pawchive', accentColor: '#f97316', rating: 'nsfw', supportsVideo: true, supportsImages: true, supportsTags: false, supportsAiFilter: false, supportsShapesFilter: false, supportsContentHiding: false, supportsSort: false, supportedCategories: ['feed', 'following', 'recommended'] }
];

export function getSiteCapabilities(siteId) {
  const current = siteId || state.currentSite || 'danbooru';
  if (current === 'all' || current === 'custom') {
    return {
      supportsVideo: true,
      supportsImages: true,
      supportsTags: true,
      supportsAiFilter: true,
      supportsShapesFilter: true,
      supportsContentHiding: true,
      supportsSort: true,
      supportedCategories: ['feed', 'following', 'recommended'],
      rating: 'all'
    };
  }
  const siteObj = (state.sites || DEFAULT_SITES).find(s => s.id === current) || DEFAULT_SITES.find(s => s.id === current);
  if (siteObj) {
    return {
      supportsVideo: siteObj.supportsVideo ?? true,
      supportsImages: siteObj.supportsImages ?? true,
      supportsTags: siteObj.supportsTags ?? true,
      supportsAiFilter: siteObj.supportsAiFilter ?? (siteObj.supportsTags ?? true),
      supportsShapesFilter: siteObj.supportsShapesFilter ?? (siteObj.supportsTags ?? true),
      supportsContentHiding: siteObj.supportsContentHiding ?? (siteObj.supportsTags ?? true),
      supportsSort: siteObj.supportsSort ?? true,
      supportedCategories: Array.isArray(siteObj.supportedCategories) ? siteObj.supportedCategories : ['feed', 'following', 'recommended'],
      rating: siteObj.rating || 'all'
    };
  }
  return {
    supportsVideo: true,
    supportsImages: true,
    supportsTags: true,
    supportsAiFilter: true,
    supportsShapesFilter: true,
    supportsContentHiding: true,
    supportsSort: true,
    supportedCategories: ['feed', 'following', 'recommended'],
    rating: 'all'
  };
}

export const DEFAULT_CLIENT_SETTINGS = {
  theme: 'kotobox',
  itemsPerPage: 100,
  proxyThumbnails: true,
  proxyFullImages: true,
  proxyVideos: true,
  proxyDownloads: true,
  proxyVideoDefault: true,
  aiTags: [],
  blacklist: [],
  curvyTags: [],
  petiteTags: [],
  furryTags: [],
  pregnantTags: [],
  lgbtTags: [],
  ratingFilter: 'all',
  typeFilter: 'all',
  ageFilter: 'all',
  pawchiveService: 'all',
  hideFurry: true,
  hidePregnant: true,
  hideLgbt: false,
  hideZipPosts: false,
  unpackArchivesOnDownload: false,
  groupAlbums: true,
  excludedInterestTags: [],
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
  konachanLogin: '',
  konachanPassword: '',
  yandereLogin: '',
  yanderePassword: '',
  pawchiveSession: '',
  deepFetchPages: 2,
  prioritizeUserTags: false,
  enableJsDemuxing: true,
  customSources: ['danbooru', 'gelbooru', 'rule34', 'yandere'],
  maxServerCacheMb: 1500,
  recommendationMode: 'hybrid', // 'hybrid' | 'ai-only' | 'tags-only' | 'off'
  recommendationFocus: 'all', // 'all' | 'artists' | 'characters' | 'discovery'
  recommendationDecayDays: 25, // half-life for temporal interest decay
  enableRecommendations: true,
  aiVisualEngine: 'browser',
  aiVisualModel: 'dinov2',
  aiCandidatePool: 40,
  aiHybridWeight: 0.4,
  aiVisualThreshold: 0.30,
  aiTasteHistorySize: 10,
  aiUseNegativeTaste: true,
  aiBrowserBackend: 'webgpu',
  aiConcurrency: 2,
  aiInputQuality: '360',
  aiMaxCacheVectors: 2000,
  showAiMatchBadge: true,
  aiStatusWidgetMode: 'full',
  aiSimilarSort: 'similarity',
  postSort: 'new',
  siteSortTags: {}
};

export function getInitialSettings() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('booru_settings') : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return { ...DEFAULT_CLIENT_SETTINGS, ...parsed };
      }
    }
  } catch (e) {}
  return { ...DEFAULT_CLIENT_SETTINGS };
}

export const state = {
  sites: [...DEFAULT_SITES],
  currentSite: 'danbooru',
  postSort: 'new', // 'new', 'hot', 'views', 'top'
  currentCategory: 'feed', // 'feed', 'following', 'recommended', 'favorites', 'profile'
  recommendationFocus: 'all', // 'all' | 'artists' | 'characters' | 'discovery'
  aiFilter: 'no-ai', // 'all', 'no-ai', 'only-ai'
  ratingFilter: 'all', // 'all', 'nsfw' (18+), 'questionable' (16+), 'sfw' (safe)
  typeFilter: 'all', // 'all', 'video', 'image'
  ageFilter: 'all', // 'all', 'adult', 'young'
  pawchiveService: 'all', // 'all' or a Pawchive platform id: 'patreon', 'fanbox', ...
  videoDurationSort: 'none', // 'none' | 'longest' | 'shortest'
  hideFurry: true,
  hidePregnant: true,
  hideLgbt: false,
  hideZipPosts: false,
  unpackArchivesOnDownload: false,
  excludedInterestTags: [],
  searchTags: [],
  page: 1,
  limit: 100,
  posts: [],
  displayedPosts: [],
  favorites: [],
  favoriteIds: new Set(),
  likes: [],
  likedIds: new Set(),
  dislikes: [],
  dislikedIds: new Set(),
  viewedIds: new Set(),
  favoritesSubTab: 'posts', // 'posts' | 'authors'
  profileSubTab: 'likes', // 'likes' | 'favorites' | 'authors' | 'analytics'
  currentUser: null, // { id, username, createdAt, ... }
  authToken: null,
  favoriteAuthors: [],
  favoriteAuthorNames: new Set(),
  settings: getInitialSettings(),
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
  LIKES: 'booru_likes_v1',
  DISLIKES: 'booru_dislikes_v1',
  VIEWED: 'booru_viewed_v1',
  AUTH_TOKEN: 'booru_auth_token_v1',
  CURRENT_USER: 'booru_current_user_v1'
};

export function loadLocalAuth() {
  try {
    const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    const userRaw = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
    const user = userRaw ? JSON.parse(userRaw) : null;
    if (token && user) {
      state.authToken = token;
      state.currentUser = user;
    }
  } catch (e) {}
}

export function saveLocalAuth(token, user) {
  try {
    if (token && user) {
      state.authToken = token;
      state.currentUser = user;
      localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);
      localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
    } else {
      state.authToken = null;
      state.currentUser = null;
      localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
      localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
    }
  } catch (e) {}
}

export function clearLocalAuth() {
  saveLocalAuth(null, null);
  try {
    localStorage.removeItem(STORAGE_KEYS.FAVORITES);
    localStorage.removeItem(STORAGE_KEYS.LIKES);
    localStorage.removeItem(STORAGE_KEYS.DISLIKES);
    localStorage.removeItem(STORAGE_KEYS.FAVORITE_AUTHORS);
  } catch (e) {}
}

export function loadLocalDislikes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DISLIKES);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function saveLocalDislikes(dislikesList) {
  try {
    localStorage.setItem(STORAGE_KEYS.DISLIKES, JSON.stringify(dislikesList || []));
  } catch (e) {}
}

export function setDislikes(dislikesList) {
  state.dislikes = dislikesList || [];
  state.dislikedIds = new Set(state.dislikes.map(d => d.id));
  saveLocalDislikes(state.dislikes);
}

export function isPostDisliked(id) {
  return state.dislikedIds.has(id);
}

export function toggleDislikeLocally(post) {
  if (!post || !post.id) return false;
  if (state.dislikedIds.has(post.id)) {
    state.dislikedIds.delete(post.id);
    state.dislikes = state.dislikes.filter(d => d.id !== post.id);
    saveLocalDislikes(state.dislikes);
    return false;
  } else {
    state.dislikedIds.add(post.id);
    state.dislikes.unshift({
      id: post.id,
      site: post.site || 'danbooru',
      author: post.author || '',
      tags: post.tags || [],
      tagDetails: post.tagDetails || {},
      previewUrl: post.previewUrl || '',
      fileUrl: post.fileUrl || '',
      isVideo: post.isVideo || false,
      dislikedAt: new Date().toISOString()
    });
    saveLocalDislikes(state.dislikes);
    return true;
  }
}

export function clearDislikesLocally() {
  state.dislikes = [];
  state.dislikedIds.clear();
  saveLocalDislikes([]);
}

export function loadLocalViewed() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.VIEWED);
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) {
      state.viewedIds = new Set(arr);
    }
    return arr;
  } catch (e) {
    return [];
  }
}

// Debounced: viewer navigation (including skip-media re-renders) calls this per
// keypress, and serializing up to 2000 ids on every call stalled typing
let viewedWriteTimer = null;

export function markPostViewed(id) {
  if (!id) return;
  state.viewedIds.add(id);
  if (viewedWriteTimer) clearTimeout(viewedWriteTimer);
  viewedWriteTimer = setTimeout(() => {
    viewedWriteTimer = null;
    try {
      let arr = Array.from(state.viewedIds);
      if (arr.length > 2000) {
        arr = arr.slice(arr.length - 2000);
        state.viewedIds = new Set(arr);
      }
      localStorage.setItem(STORAGE_KEYS.VIEWED, JSON.stringify(arr));
    } catch (e) {}
  }, 500);
}

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

// 📦 Export all user data (settings, favorites, likes, dislikes, authors, account) into a JSON object.
// `account` comes from GET /api/auth/export and is included only when logged in.
export function exportUserData(account = null) {
  const exportObject = {
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: loadLocalSettings() || state.settings || {},
    favorites: loadLocalFavorites() || state.favorites || [],
    favoriteAuthors: loadLocalFavoriteAuthors() || state.favoriteAuthors || [],
    likes: loadLocalLikes() || state.likes || [],
    dislikes: loadLocalDislikes() || state.dislikes || []
  };
  if (account && typeof account === 'object' && account.username && account.passwordHash) {
    exportObject.account = account;
  }
  return exportObject;
}

// Accept both flat v1/v2 files and nested Telegram backups ({ data: {...} })
function normalizeImportPayload(data) {
  const nested = data && typeof data.data === 'object' && !Array.isArray(data.data)
    ? data.data
    : null;
  if (!nested) return { ...data, account: data.account || null };
  if (data.settings || Array.isArray(data.favorites)) return { ...data, account: data.account || null };
  return {
    ...nested,
    version: data.version,
    exportedAt: data.exportedAt,
    account: data.account || nested.account || null
  };
}

// 📥 Import user data from JSON.
// With `replace` the imported lists overwrite local ones instead of merging —
// used after switching to the account from the file, so no stale local items leak into it.
export function importUserData(data, { replace = false } = {}) {
  if (!data || typeof data !== 'object') {
    throw new Error('Некорректный формат файла данных');
  }

  const normalized = normalizeImportPayload(data);
  const importedCounts = { settings: false, favorites: 0, favoriteAuthors: 0, likes: 0, dislikes: 0, account: normalized.account };

  // 1. Settings
  if (normalized.settings && typeof normalized.settings === 'object') {
    saveLocalSettings(normalized.settings);
    state.settings = { ...state.settings, ...normalized.settings };
    importedCounts.settings = true;
  }

  // 2. Favorites
  if (Array.isArray(normalized.favorites)) {
    const existing = replace ? [] : (loadLocalFavorites() || []);
    const mergedMap = new Map();
    existing.forEach(p => mergedMap.set(p.id, p));
    normalized.favorites.forEach(p => { if (p && p.id) mergedMap.set(p.id, p); });
    const mergedList = Array.from(mergedMap.values());
    setFavorites(mergedList);
    importedCounts.favorites = mergedList.length;
  }

  // 3. Favorite authors
  if (Array.isArray(normalized.favoriteAuthors)) {
    const existing = replace ? [] : (loadLocalFavoriteAuthors() || []);
    const mergedMap = new Map();
    existing.forEach(a => mergedMap.set((a.name || '').toLowerCase(), a));
    normalized.favoriteAuthors.forEach(a => {
      if (a && a.name) mergedMap.set((a.name || '').toLowerCase(), a);
    });
    const mergedList = Array.from(mergedMap.values());
    setFavoriteAuthors(mergedList);
    importedCounts.favoriteAuthors = mergedList.length;
  }

  // 4. Likes
  if (Array.isArray(normalized.likes)) {
    const existing = replace ? [] : (loadLocalLikes() || []);
    const mergedMap = new Map();
    existing.forEach(l => mergedMap.set(l.id, l));
    normalized.likes.forEach(l => { if (l && l.id) mergedMap.set(l.id, l); });
    const mergedList = Array.from(mergedMap.values());
    setLikes(mergedList);
    importedCounts.likes = mergedList.length;
  }

  // 5. Dislikes
  if (Array.isArray(normalized.dislikes)) {
    const existing = replace ? [] : (loadLocalDislikes() || []);
    const mergedMap = new Map();
    existing.forEach(d => mergedMap.set(d.id, d));
    normalized.dislikes.forEach(d => { if (d && d.id) mergedMap.set(d.id, d); });
    const mergedList = Array.from(mergedMap.values());
    setDislikes(mergedList);
    importedCounts.dislikes = mergedList.length;
  }

  return importedCounts;
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
  const names = new Set();
  for (const a of state.favoriteAuthors) {
    if (!a) continue;
    if (a.name) {
      const clean = String(a.name).toLowerCase().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_').trim();
      if (clean) {
        names.add(clean);
        names.add(clean.replace(/_\(artist\)$/i, '').replace(/_\(circle\)$/i, ''));
      }
    }
    if (a.displayName) {
      const cleanDisplay = String(a.displayName).toLowerCase().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_').trim();
      if (cleanDisplay) {
        names.add(cleanDisplay);
        names.add(cleanDisplay.replace(/_\(artist\)$/i, '').replace(/_\(circle\)$/i, ''));
      }
    }
  }
  state.favoriteAuthorNames = names;
  saveLocalFavoriteAuthors(state.favoriteAuthors);
}

export function isAuthorFavorite(name) {
  if (!name) return false;
  const clean = String(name).toLowerCase().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_').trim();
  if (state.favoriteAuthorNames.has(clean)) return true;
  const base = clean.replace(/_\(artist\)$/i, '').replace(/_\(circle\)$/i, '');
  return state.favoriteAuthorNames.has(base);
}

// 🛡️ Broad composition/generic tags that should NOT be wiped out by single dislikes
const GENERIC_DISLIKE_PROTECTED_TAGS = new Set([
  'solo', '1girl', '1boy', '2girls', '2boys', 'multiple_girls', 'multiple_boys',
  'looking_at_viewer', 'smile', 'open_mouth', 'closed_eyes', 'blush', 'sitting', 'standing', 'lying',
  'long_hair', 'short_hair', 'medium_hair', 'blonde_hair', 'black_hair', 'brown_hair', 'blue_hair', 'white_hair', 'pink_hair', 'red_hair', 'green_hair', 'purple_hair',
  'blue_eyes', 'red_eyes', 'brown_eyes', 'green_eyes', 'purple_eyes', 'yellow_eyes', 'black_eyes',
  'breasts', 'large_breasts', 'medium_breasts', 'small_breasts',
  'simple_background', 'white_background', 'transparent_background', 'full_body', 'upper_body', 'portrait', 'cowboy_shot',
  'highres', 'absurdres', 'superabsurdres', 'comic', 'monochrome', 'greyscale'
]);

// ⏳ Calculate exponential half-life decay for timestamps
function getTemporalDecayFactor(dateString, halfLifeDays = 25) {
  if (!dateString) return 0.65;
  try {
    const itemDate = new Date(dateString).getTime();
    if (isNaN(itemDate)) return 0.65;
    const now = Date.now();
    const daysDiff = Math.max(0, (now - itemDate) / (1000 * 60 * 60 * 24));
    // Half-life formula: 2^(-t / halfLife) with 0.20 floor so historical preferences persist as a subtle base
    return Math.max(0.20, Math.pow(2, -daysDiff / Math.max(1, halfLifeDays)));
  } catch (e) {
    return 0.65;
  }
}

// ⏱️ Short-term in-session interaction tracking
const sessionInterests = new Map(); // tag -> { score, category, lastSeen }

export function recordSessionInteraction(post, interactionType = 'view') {
  if (!post) return;
  const now = Date.now();
  const baseWeight = interactionType === 'similar' ? 1.2 : interactionType === 'zoom' ? 0.8 : 0.4;

  const addSessionTag = (rawTag, cat, mult = 1.0) => {
    const clean = cleanTagString(rawTag);
    if (!clean || GENERIC_DISLIKE_PROTECTED_TAGS.has(clean)) return;
    const prev = sessionInterests.get(clean) || { score: 0, category: cat, lastSeen: now };
    prev.score = Math.min(5.0, prev.score + baseWeight * mult);
    prev.lastSeen = now;
    sessionInterests.set(clean, prev);
  };

  if (post.author) addSessionTag(post.author, 'artist', 2.0);
  const td = post.tagDetails || {};
  if (Array.isArray(td.artist)) td.artist.forEach(a => addSessionTag(a, 'artist', 2.0));
  if (Array.isArray(td.character)) td.character.forEach(c => addSessionTag(c, 'character', 1.6));
  if (Array.isArray(td.copyright)) td.copyright.forEach(cp => addSessionTag(cp, 'copyright', 1.3));
  if (Array.isArray(td.general)) td.general.slice(0, 4).forEach(g => addSessionTag(g, 'general', 0.6));
}

export function getSessionInterests() {
  const now = Date.now();
  const ONE_HOUR = 3600 * 1000;
  const valid = [];
  for (const [tag, data] of sessionInterests.entries()) {
    if (now - data.lastSeen < ONE_HOUR) {
      valid.push({ tag, score: data.score, category: data.category });
    } else {
      sessionInterests.delete(tag);
    }
  }
  return valid;
}

export function clearSessionInterests() {
  sessionInterests.clear();
}

// 🧠 Advanced algorithm for extracting the user's interest map with temporal decay and category balancing
export function getUserInterestTags(limit = null, options = {}) {
  const counts = new Map(); // tag -> positive weight sum
  const dislikeCounts = new Map(); // tag -> negative penalty sum
  const weights = new Map(); // tag -> baseWeight
  const catMap = new Map(); // tag -> category

  const halfLife = state.settings?.recommendationDecayDays || 25;
  const focusMode = options.focusMode || state.recommendationFocus || state.settings?.recommendationFocus || 'all';

  // 1. Analyze all liked posts (weight 2.2 × temporal decay)
  for (const post of state.likes) {
    const decay = getTemporalDecayFactor(post.likedAt, halfLife);
    extractTagsFromPost(post, counts, weights, catMap, 2.2 * decay);
  }

  // 2. Analyze favorites (weight 1.8 × temporal decay with slightly longer half-life)
  for (const post of state.favorites) {
    const decay = getTemporalDecayFactor(post.favoritedAt || post.likedAt, halfLife * 1.4);
    extractTagsFromPost(post, counts, weights, catMap, 1.8 * decay);
  }

  // 3. Analyze hidden / disliked posts (penalty 2.0 × temporal decay with generic protection)
  for (const post of (state.dislikes || [])) {
    const decay = getTemporalDecayFactor(post.dislikedAt, halfLife * 1.5);
    extractTagsFromPost(post, dislikeCounts, weights, catMap, 2.0 * decay, true);
  }

  // 4. Inject short-term session signals (boost up to +0.8)
  const sessionList = getSessionInterests();
  for (const item of sessionList) {
    counts.set(item.tag, (counts.get(item.tag) || 0) + item.score * 0.8);
    if (!catMap.has(item.tag)) catMap.set(item.tag, item.category);
    if (!weights.has(item.tag)) weights.set(item.tag, 1.2);
  }

  const scores = new Map();

  // Apply sublinear smoothing with penalty subtraction: baseWeight * log2(1 + netCount)
  for (const [tag, count] of counts.entries()) {
    const penalty = dislikeCounts.get(tag) || 0;
    const netCount = count - penalty;
    if (netCount <= 0.08) continue; // Tag suppressed by dislikes

    let baseWeight = weights.get(tag) || 1.0;
    const category = catMap.get(tag) || 'general';

    // Focus mode multipliers
    if (focusMode === 'artists' && category === 'artist') {
      baseWeight *= 2.2;
    } else if (focusMode === 'characters' && (category === 'character' || category === 'copyright')) {
      baseWeight *= 2.0;
    } else if (focusMode === 'discovery' && category === 'general') {
      baseWeight *= 1.4;
    }

    const score = baseWeight * Math.log2(1 + netCount);
    scores.set(tag, score);
  }

  // 5. Favorite authors bonus
  for (const author of state.favoriteAuthors) {
    const raw = (author.name || '').toLowerCase().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_');
    if (raw) {
      const bonus = (focusMode === 'artists' ? 16.0 : 10.0);
      scores.set(raw, (scores.get(raw) || 0) + bonus);
      catMap.set(raw, 'artist');
    }
  }

  const excludedSet = new Set((state.settings.excludedInterestTags || []).map(t => String(t).toLowerCase().trim()));

  const list = [];
  for (const [tag, score] of scores.entries()) {
    if (excludedSet.has(tag)) continue;
    list.push({ tag, score, category: catMap.get(tag) || 'general' });
  }

  list.sort((a, b) => b.score - a.score);
  return (typeof limit === 'number' && limit > 0) ? list.slice(0, limit) : list;
}

// 🔗 Extract stable tag pair combinations for seed queries
export function getUserInterestSeedPairs(limit = 12) {
  const userInterests = getUserInterestTags();
  if (userInterests.length === 0) return [];

  const interestMap = new Map(userInterests.map(i => [i.tag, i.score]));
  const excludedSet = new Set((state.settings.excludedInterestTags || []).map(t => String(t).toLowerCase().trim()));
  const pairScores = new Map();

  const postsPool = [...state.likes, ...state.favorites];
  for (const post of postsPool) {
    if (!post) continue;
    const td = post.tagDetails || {};
    const artists = (td.artist || (post.author ? [post.author] : []))
      .map(cleanTagString).filter(t => t && !excludedSet.has(t) && interestMap.has(t));
    const characters = (td.character || [])
      .map(cleanTagString).filter(t => t && !excludedSet.has(t) && interestMap.has(t));
    const copyrights = (td.copyright || [])
      .map(cleanTagString).filter(t => t && !excludedSet.has(t) && interestMap.has(t));
    const generals = (td.general || (Array.isArray(post.tags) ? post.tags : []))
      .map(cleanTagString).filter(t => t && !excludedSet.has(t) && interestMap.has(t));

    const addPair = (t1, t2, boost = 1.0) => {
      if (!t1 || !t2 || t1 === t2) return;
      const sortedPair = [t1, t2].sort().join(' ');
      const s1 = interestMap.get(t1) || 1;
      const s2 = interestMap.get(t2) || 1;
      const pairScore = (s1 + s2) * boost;
      pairScores.set(sortedPair, (pairScores.get(sortedPair) || 0) + pairScore);
    };

    for (const a of artists) {
      for (const c of characters) addPair(a, c, 2.6);
      for (const cp of copyrights) addPair(a, cp, 2.0);
    }
    for (const c of characters) {
      for (const cp of copyrights) addPair(c, cp, 2.0);
      for (const g of generals.slice(0, 3)) addPair(c, g, 1.2);
    }
  }

  const sortedPairs = Array.from(pairScores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(entry => entry[0]);

  return sortedPairs.slice(0, limit);
}

// 🎲 Smart Multi-Tier Seed Generation with Page Rotation and Exploration
export function getRecommendationSeeds({ limit = 5, page = 1, focusMode = 'all' } = {}) {
  const userInterests = getUserInterestTags(40, { focusMode });
  if (userInterests.length === 0) return [];

  const seedPairs = getUserInterestSeedPairs(20);
  const selectedSeeds = [];

  if (focusMode === 'artists') {
    const artistInterests = userInterests.filter(i => i.category === 'artist' || i.score >= 5.0);
    if (artistInterests.length > 0) {
      const offset = ((page - 1) * 3) % artistInterests.length;
      for (let i = 0; i < Math.min(limit, artistInterests.length); i++) {
        selectedSeeds.push(artistInterests[(offset + i) % artistInterests.length].tag);
      }
    }
  } else if (focusMode === 'characters') {
    const charInterests = userInterests.filter(i => i.category === 'character' || i.category === 'copyright');
    if (charInterests.length > 0) {
      const offset = ((page - 1) * 3) % charInterests.length;
      for (let i = 0; i < Math.min(limit, charInterests.length); i++) {
        selectedSeeds.push(charInterests[(offset + i) % charInterests.length].tag);
      }
    }
  } else if (focusMode === 'discovery') {
    // Discovery mode: mix top pair with second-tier interests and broad seeds
    if (seedPairs.length > 0) {
      const pairIdx = (page - 1) % seedPairs.length;
      selectedSeeds.push(seedPairs[pairIdx]);
    }
    const midInterests = userInterests.slice(5, 30);
    if (midInterests.length > 0) {
      const shuffled = [...midInterests].sort(() => Math.random() - 0.5);
      for (const item of shuffled) {
        if (selectedSeeds.length >= limit) break;
        if (!selectedSeeds.includes(item.tag)) selectedSeeds.push(item.tag);
      }
    }
  } else {
    // Balanced "all" mode: Page-aware rotation of top pairs + single tags
    if (seedPairs.length > 0) {
      const pairOffset = ((page - 1) * 2) % seedPairs.length;
      selectedSeeds.push(seedPairs[pairOffset]);
      if (seedPairs.length > 1) {
        selectedSeeds.push(seedPairs[(pairOffset + 1) % seedPairs.length]);
      }
    }

    const singleOffset = ((page - 1) * 3) % Math.min(userInterests.length, 25);
    for (let i = 0; i < userInterests.length; i++) {
      if (selectedSeeds.length >= limit) break;
      const candidate = userInterests[(singleOffset + i) % userInterests.length];
      if (!selectedSeeds.includes(candidate.tag) && !selectedSeeds.some(s => s.includes(candidate.tag))) {
        selectedSeeds.push(candidate.tag);
      }
    }
  }

  return selectedSeeds;
}

const IGNORED_INTEREST_TAGS = new Set([
  'fanbox', 'patreon', 'fantia', 'boosty', 'subscribestar', 'gumroad', 'afdian', 'discord', 'pawchive',
  'rule34video', 'danbooru', 'gelbooru', 'safebooru', 'yande.re', 'konachan', 'rule34', 'xbooru', 'hypnohub', 'tbib',
  'highres', 'absurdres', 'superabsurdres', 'translation_request', 'translated',
  'tagme', 'bad_id', 'duplicate', 'watermark', 'sample', 'thumbnail', 'reward', 'psd', 'clip', 'zip', 'rar'
]);

function cleanTagString(str) {
  if (!str) return '';
  const clean = String(str).toLowerCase().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/^(?:artist|creator|author|service|meta):/i, '').replace(/\s+/g, '_').trim();
  if (IGNORED_INTEREST_TAGS.has(clean) || /^user_\d+$/i.test(clean) || clean.startsWith('service_') || clean.startsWith('service:')) {
    return '';
  }
  return clean;
}

export function excludeInterestTag(tag) {
  if (!tag) return;
  const clean = String(tag).toLowerCase().trim();
  if (!clean) return;
  if (!Array.isArray(state.settings.excludedInterestTags)) {
    state.settings.excludedInterestTags = [];
  }
  if (!state.settings.excludedInterestTags.includes(clean)) {
    state.settings.excludedInterestTags.push(clean);
  }
}

export function restoreInterestTag(tag) {
  if (!tag || !Array.isArray(state.settings.excludedInterestTags)) return;
  const clean = String(tag).toLowerCase().trim();
  state.settings.excludedInterestTags = state.settings.excludedInterestTags.filter(t => t !== clean);
}

export function resetExcludedInterestTags() {
  state.settings.excludedInterestTags = [];
}

function extractTagsFromPost(post, counts, weights, catMap, multiplier = 1.0, isDislike = false) {
  if (!post) return;

  const addTag = (rawTag, category, baseWeight) => {
    if (!rawTag) return;
    const clean = cleanTagString(String(rawTag).split(',')[0]);
    if (!clean) return;

    // Apply generic tag protection for dislikes to avoid killing common composition tags
    let effMult = multiplier;
    if (isDislike && GENERIC_DISLIKE_PROTECTED_TAGS.has(clean)) {
      effMult = multiplier * 0.10;
    }

    counts.set(clean, (counts.get(clean) || 0) + effMult);

    const currentWeight = weights.get(clean) || 0;
    if (baseWeight > currentWeight) {
      weights.set(clean, baseWeight);
      catMap.set(clean, category);
    }
  };

  // Authors (weight 5.0)
  if (post.author) {
    addTag(post.author, 'artist', 5.0);
  }

  const td = post.tagDetails || {};
  if (td.artist) {
    for (const a of td.artist) addTag(a, 'artist', 5.0);
  }
  if (td.character) {
    for (const c of td.character) addTag(c, 'character', 3.5);
  }
  if (td.copyright) {
    for (const cp of td.copyright) addTag(cp, 'copyright', 3.0);
  }
  if (td.general) {
    for (const g of td.general) addTag(g, 'general', 1.2);
  } else if (Array.isArray(post.tags)) {
    for (const t of post.tags) addTag(t, 'general', 1.0);
  }
}

// 🎯 Compute a post's relevance percentage and rich matched tags breakdown with explanation
export function calculatePostMatchPercent(post, userInterestMap) {
  if (!post || !userInterestMap || userInterestMap.size === 0) {
    return {
      percent: 0,
      matchedTags: [],
      matchExplanation: '',
      valueOf() { return 0; },
      toString() { return '0'; }
    };
  }

  let matchPoints = 0;
  const matchedTags = [];
  const addedSet = new Set();

  const checkTag = (tag, weightMultiplier = 1.0, displayPrefix = '', category = 'general') => {
    if (!tag) return;
    const clean = cleanTagString(tag);
    if (!clean) return;
    if (userInterestMap.has(clean)) {
      const score = userInterestMap.get(clean) || 1;
      matchPoints += score * weightMultiplier;
      if (!addedSet.has(clean)) {
        addedSet.add(clean);
        matchedTags.push({
          tag: clean,
          display: displayPrefix ? `${displayPrefix}${clean}` : clean,
          category,
          score
        });
      }
    }
  };

  if (post.author) checkTag(post.author, 4.5, '@', 'artist');
  if (post.tagDetails) {
    if (Array.isArray(post.tagDetails.artist)) post.tagDetails.artist.forEach(a => checkTag(a, 4.5, '@', 'artist'));
    if (Array.isArray(post.tagDetails.character)) post.tagDetails.character.forEach(c => checkTag(c, 3.5, '', 'character'));
    if (Array.isArray(post.tagDetails.copyright)) post.tagDetails.copyright.forEach(cp => checkTag(cp, 2.8, '', 'copyright'));
    if (Array.isArray(post.tagDetails.general)) post.tagDetails.general.forEach(g => checkTag(g, 1.0, '', 'general'));
  } else if (Array.isArray(post.tags)) {
    for (const t of post.tags) checkTag(t, 1.0, '', 'general');
  }

  if (matchPoints === 0) {
    return {
      percent: 0,
      matchedTags: [],
      matchExplanation: '',
      valueOf() { return 0; },
      toString() { return '0'; }
    };
  }

  // Sort matched tags by significance
  matchedTags.sort((a, b) => b.score - a.score);

  const hasArtist = matchedTags.some(m => m.category === 'artist');
  const hasChar = matchedTags.some(m => m.category === 'character');
  const isKeyMatch = hasArtist || hasChar;

  const ratio = matchPoints / (matchPoints + (isKeyMatch ? 7 : 14));
  const percent = Math.min(99, Math.max(55, Math.round((isKeyMatch ? 72 : 55) + ratio * (isKeyMatch ? 27 : 38))));

  // Build human-friendly explanation
  const displayTags = matchedTags.map(m => m.display).slice(0, 4);
  const matchExplanation = displayTags.join(', ');

  return {
    percent,
    matchedTags: displayTags,
    matchExplanation,
    valueOf() { return this.percent; },
    toString() { return String(this.percent); }
  };
}



