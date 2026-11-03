import { clearViewedState, clearViewHistory } from './modules/viewHistory.js';
import { invalidateInterestCache, clearSessionInterests, invalidateMediaPrefsCache } from './modules/recommendationEngine.js';

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
  { id: 'pawchive', name: 'Pawchive', accentColor: '#f97316', rating: 'nsfw', supportsVideo: true, supportsImages: true, supportsArchives: true, supportsTags: false, supportsAiFilter: false, supportsShapesFilter: false, supportsContentHiding: false, supportsSort: false, supportedCategories: ['feed', 'following', 'recommended'] },
  { id: 'kemono', name: 'Kemono', accentColor: '#3b82f6', rating: 'nsfw', supportsVideo: true, supportsImages: true, supportsArchives: true, supportsTags: false, supportsAiFilter: false, supportsShapesFilter: false, supportsContentHiding: false, supportsSort: false, supportedCategories: ['feed', 'following', 'recommended'] }
];

export function getSiteCapabilities(siteId) {
  const current = siteId || state.currentSite || 'danbooru';
  if (current === 'all' || current === 'custom') {
    return {
      supportsVideo: true,
      supportsImages: true,
      supportsArchives: true,
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
      supportsArchives: Boolean(siteObj.supportsArchives),
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
    supportsArchives: false,
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
  itemsPerPage: 40,
  proxyThumbnails: true,
  proxyFullImages: true,
  proxyVideos: true,
  proxyDownloads: true,
  proxyVideoDefault: true,
  siteMediaProxy: {},
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
  kemonoService: 'all',
  hideFurry: true,
  hidePregnant: true,
  hideLgbt: true,
  hideZipPosts: false,
  unpackArchivesOnDownload: false,
  archiveDownloadThreads: 4,
  groupAlbums: true,
  excludedInterestTags: [],
  videoAutoplayHover: true,
  videoAutoplayMobile: true,
  videoAutoplayViewer: true,
  enableSimilarPosts: true,
  previewQuality: 'medium',
  videoDefaultQuality: 'original',
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
  kemonoSession: '',
  kemonoProxy: '',
  deepFetchPages: 1,
  prioritizeUserTags: false,
  enableJsDemuxing: true,
  rule34Provider: 'rule34xxx',
  enablePaheal: true,
  customSources: ['danbooru', 'gelbooru', 'rule34', 'yandere'],
  searchPresets: [],
  maxServerCacheMb: 1500,
  enableAliasDiscovery: true,
  ignoredAliases: [],
  recommendationMode: 'tags-only', // 'tags-only' | 'off'
  recommendationFocus: 'all', // 'all' | 'artists' | 'characters' | 'discovery'
  recommendationDecayDays: 25, // half-life for temporal interest decay
  recommendationEnableSkipPenalty: true,
  enableRecommendations: true,
  notificationsEnabled: true,
  notificationsInterval: 15,
  postSort: 'new',
  siteSortTags: {}
};

export const SECRET_SETTING_FIELDS = [
  'rule34ApiKey', 'rule34UserId',
  'gelbooruApiKey', 'gelbooruUserId',
  'danbooruApiKey', 'danbooruLogin',
  'konachanLogin', 'konachanPassword',
  'yandereLogin', 'yanderePassword',
  'pawchiveSession',
  'kemonoSession',
  'globalProxy', 'danbooruProxy', 'gelbooruProxy', 'rule34Proxy', 'yandereProxy',
  'konachanProxy', 'safebooruProxy', 'rule34videoProxy', 'xbooruProxy', 'hypnohubProxy',
  'tbibProxy', 'pawchiveProxy', 'kemonoProxy',
  'telegramBotToken', 'telegramChatId'
];

export const STORAGE_KEYS = {
  SETTINGS: 'booru_settings_v1',
  PRESETS: 'booru_presets_v1',
  FAVORITES: 'booru_favorites_v1',
  FAVORITE_AUTHORS: 'booru_favorite_authors_v1',
  LIKES: 'booru_likes_v1',
  DISLIKES: 'booru_dislikes_v1',
  VIEWED: 'booru_viewed_v1',
  HISTORY: 'booru_view_history_v1',
  AUTH_TOKEN: 'booru_auth_token_v1',
  ADMIN_TOKEN: 'booru_admin_token_v1',
  CURRENT_USER: 'booru_current_user_v1',
  SIDEBAR_COLLAPSED: 'booru_sidebar_collapsed_v1',
  NOTIFICATIONS: 'booru_notifications_v1'
};

export function getInitialSettings() {
  try {
    const raw = typeof localStorage !== 'undefined'
      ? (localStorage.getItem(STORAGE_KEYS.SETTINGS) || localStorage.getItem('booru_settings'))
      : null;
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
  typeFilter: 'all', // 'all', 'video', 'audio', 'image', 'zip'
  ageFilter: 'all', // 'all', 'adult', 'young'
  pawchiveService: 'all', // 'all' or a Pawchive platform id: 'patreon', 'fanbox', ...
  kemonoService: 'all', // 'all' or a Kemono platform id: 'patreon', 'fanbox', ...
  videoDurationSort: 'none', // 'none' | 'longest' | 'shortest'
  hideFurry: true,
  hidePregnant: true,
  hideLgbt: true,
  hideZipPosts: false,
  unpackArchivesOnDownload: false,
  archiveDownloadThreads: 4,
  excludedInterestTags: [],
  searchTags: [],
  searchPresets: [],
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
  viewHistory: [], // compact { i, s, t, v, ts } entries, client-side only, capped
  favoritesSubTab: 'posts', // 'posts' | 'authors'
  profileSubTab: 'likes', // 'likes' | 'favorites' | 'authors' | 'analytics'
  currentUser: null, // { id, username, createdAt, ... }
  authToken: null,
  favoriteAuthors: [],
  favoriteAuthorNames: new Set(),
  authorAliases: {}, // lowercased alias/name -> Array of lowercased alias variants
  notifications: [],
  unreadNotificationsCount: 0,
  settings: getInitialSettings(),
  currentViewerIndex: -1,
  isLoading: false,
  hasMore: true
};

export function setAuthorAliases(map) {
  state.authorAliases = (map && typeof map === 'object') ? map : {};
  _favAuthorsNamesCache = null;
  _favAuthorsCacheKey = '';
  invalidateInterestCache();
  if (state.favoriteAuthors && state.favoriteAuthors.length > 0) {
    setFavoriteAuthors(state.favoriteAuthors);
  }
}

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
  // The operator token grants server-wide rights, so it must not survive a logout
  // on a shared machine.
  try { localStorage.removeItem(STORAGE_KEYS.ADMIN_TOKEN); } catch (e) {}
  clearViewedState();
  clearViewHistory();
  state.favorites = [];
  state.favoriteIds = new Set();
  state.likes = [];
  state.likedIds = new Set();
  state.dislikes = [];
  state.dislikedIds = new Set();
  state.favoriteAuthors = [];
  state.favoriteAuthorNames = new Set();
  state.viewedIds = new Set();
  state.viewHistory = [];
  clearSessionInterests();
  invalidateInterestCache();
  try {
    localStorage.removeItem(STORAGE_KEYS.VIEWED);
    localStorage.removeItem(STORAGE_KEYS.HISTORY);
    localStorage.removeItem(STORAGE_KEYS.FAVORITES);
    localStorage.removeItem(STORAGE_KEYS.LIKES);
    localStorage.removeItem(STORAGE_KEYS.DISLIKES);
    localStorage.removeItem(STORAGE_KEYS.FAVORITE_AUTHORS);
    localStorage.removeItem(STORAGE_KEYS.PRESETS);
    state.searchPresets = [];
    if (state.settings) {
      state.settings.searchPresets = [];
    }
    const current = loadLocalSettings() || {};
    let changed = false;
    for (const field of SECRET_SETTING_FIELDS) {
      if (current[field]) {
        delete current[field];
        changed = true;
      }
      if (state.settings && state.settings[field]) {
        state.settings[field] = '';
      }
    }
    if (current.searchPresets) {
      current.searchPresets = [];
      changed = true;
    }
    if (changed) {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(current));
    }
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
  invalidateInterestCache();
}

export function addDislikedId(id) {
  if (id && !state.dislikedIds.has(id)) {
    state.dislikedIds.add(id);
    invalidateInterestCache();
  }
}

export function removeDislikedId(id) {
  if (id && state.dislikedIds.has(id)) {
    state.dislikedIds.delete(id);
    invalidateInterestCache();
  }
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

export function loadLocalPresets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PRESETS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {}
  if (Array.isArray(state.searchPresets) && state.searchPresets.length > 0) {
    return state.searchPresets;
  }
  if (Array.isArray(state.settings?.searchPresets) && state.settings.searchPresets.length > 0) {
    return state.settings.searchPresets;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PRESETS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {}
  return [];
}

export function saveLocalPresets(presetsList) {
  try {
    const cleanList = Array.isArray(presetsList) ? presetsList : [];
    state.searchPresets = cleanList;
    localStorage.setItem(STORAGE_KEYS.PRESETS, JSON.stringify(cleanList));
    if (state.settings) {
      state.settings.searchPresets = cleanList;
    }
    saveLocalSettings({ searchPresets: cleanList });
  } catch (e) {}
}

export function setPresets(presetsList) {
  state.searchPresets = Array.isArray(presetsList) ? presetsList : [];
  saveLocalPresets(state.searchPresets);
}

// Desktop sidebar collapse is a local view preference, not a synced setting:
// it must not travel to the server or into an account export.
export function loadSidebarCollapsed() {
  try {
    return localStorage.getItem(STORAGE_KEYS.SIDEBAR_COLLAPSED) === '1';
  } catch (e) {
    return false;
  }
}

export function saveSidebarCollapsed(collapsed) {
  try {
    localStorage.setItem(STORAGE_KEYS.SIDEBAR_COLLAPSED, collapsed ? '1' : '0');
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
  invalidateInterestCache();
  invalidateMediaPrefsCache();
}

export function addFavoriteId(id) {
  if (id && !state.favoriteIds.has(id)) {
    state.favoriteIds.add(id);
    invalidateInterestCache();
    invalidateMediaPrefsCache();
  }
}

export function toggleFavoriteLocally(post) {
  if (!post || !post.id) return false;
  if (state.favoriteIds.has(post.id)) {
    state.favoriteIds.delete(post.id);
    state.favorites = state.favorites.filter(f => f.id !== post.id);
    saveLocalFavorites(state.favorites);
    invalidateInterestCache();
    invalidateMediaPrefsCache();
    return false;
  }
  state.favoriteIds.add(post.id);
  state.favorites.unshift({ ...post, favoritedAt: new Date().toISOString() });
  saveLocalFavorites(state.favorites);
  invalidateInterestCache();
  invalidateMediaPrefsCache();
  return true;
}

export function removeFavoriteId(id) {
  if (id && state.favoriteIds.has(id)) {
    state.favoriteIds.delete(id);
    invalidateInterestCache();
    invalidateMediaPrefsCache();
  }
}

export function isPostFavorite(id) {
  return state.favoriteIds.has(id);
}

export function setLikes(likesList) {
  state.likes = likesList || [];
  state.likedIds = new Set(state.likes.map(l => l.id));
  saveLocalLikes(state.likes);
  invalidateInterestCache();
  invalidateMediaPrefsCache();
}

export function addLikedId(id) {
  if (id && !state.likedIds.has(id)) {
    state.likedIds.add(id);
    invalidateInterestCache();
    invalidateMediaPrefsCache();
  }
}

export function removeLikedId(id) {
  if (id && state.likedIds.has(id)) {
    state.likedIds.delete(id);
    invalidateInterestCache();
    invalidateMediaPrefsCache();
  }
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

let _favAuthorsNamesCache = null;
let _favAuthorsCacheKey = '';

export function setFavoriteAuthors(authorsList) {
  state.favoriteAuthors = authorsList || [];
  invalidateInterestCache();

  const aliasMap = state.authorAliases || {};
  const cacheKey = `${state.favoriteAuthors.length}|${Object.keys(aliasMap).length}`;

  if (_favAuthorsNamesCache && _favAuthorsCacheKey === cacheKey) {
    state.favoriteAuthorNames = _favAuthorsNamesCache;
    saveLocalFavoriteAuthors(state.favoriteAuthors);
    return;
  }

  const names = new Set();

  const registerName = (rawStr) => {
    if (!rawStr) return;
    const clean = String(rawStr).toLowerCase().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/^(artist|creator|author):/i, '').replace(/\s+/g, '_').trim();
    if (!clean) return;

    const variants = [clean, clean.replace(/_\(artist\)$/i, '').replace(/_\(circle\)$/i, ''), clean.replace(/[\s_.-]+/g, '')];
    for (const v of variants) {
      if (!v) continue;
      names.add(v);
      if (aliasMap[v]) {
        for (const al of aliasMap[v]) {
          const cleanAl = String(al).toLowerCase().replace(/^(artist|creator|author):/i, '').replace(/\s+/g, '_').trim();
          if (cleanAl) {
            names.add(cleanAl);
            names.add(cleanAl.replace(/_\(artist\)$/i, '').replace(/_\(circle\)$/i, ''));
            const noD = cleanAl.replace(/[\s_.-]+/g, '');
            if (noD) names.add(noD);
          }
        }
      }
    }
  };

  for (const a of state.favoriteAuthors) {
    if (!a) continue;
    if (a.name) registerName(a.name);
    if (a.displayName) {
      const parts = String(a.displayName).split(',');
      for (const part of parts) registerName(part);
    }
  }
  state.favoriteAuthorNames = names;
  _favAuthorsNamesCache = names;
  _favAuthorsCacheKey = cacheKey;
  saveLocalFavoriteAuthors(state.favoriteAuthors);
}

export function isAuthorFavorite(name) {
  if (!name) return false;
  const clean = String(name).toLowerCase().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/^(artist|creator|author):/i, '').replace(/\s+/g, '_').trim();
  if (state.favoriteAuthorNames.has(clean)) return true;
  const base = clean.replace(/_\(artist\)$/i, '').replace(/_\(circle\)$/i, '');
  if (state.favoriteAuthorNames.has(base)) return true;
  const noDelim = clean.replace(/[\s_.-]+/g, '');
  if (state.favoriteAuthorNames.has(noDelim)) return true;

  // Check if any alias of this name is in favoriteAuthorNames
  const aliasMap = state.authorAliases || {};
  const aliases = aliasMap[clean] || aliasMap[base] || aliasMap[noDelim];
  if (Array.isArray(aliases)) {
    for (const al of aliases) {
      const cAl = String(al).toLowerCase().replace(/[\s_.-]+/g, '');
      if (state.favoriteAuthorNames.has(cAl) || state.favoriteAuthorNames.has(al.toLowerCase())) return true;
    }
  }
  return false;
}



// Subsystems split out of this file; re-exported so existing importers of
// state.js keep working unchanged.
export {
  loadLocalViewed,
  markPostViewed,
  recordPostHistory,
  loadViewHistory,
  clearViewHistory,
  clearViewedState
} from './modules/viewHistory.js';
export { exportUserData, importUserData } from './modules/importExport.js';
export {
  recordSessionInteraction,
  getSessionInterests,
  clearSessionInterests,
  recordPostImpressionSkip,
  getSessionSkipPenalties,
  getUserMediaPreferences,
  getUserNegativeSeedTokens,
  getUserInterestTags,
  getUserInterestSeedPairs,
  getUserTasteClusters,
  getRecommendationSeeds,
  excludeInterestTag,
  restoreInterestTag,
  resetExcludedInterestTags,
  calculatePostMatchPercent,
  getSimilarPostPlan,
  calculatePostSimilarityScore,
  getSimilarPostQuery,
  invalidateInterestCache
} from './modules/recommendationEngine.js';
