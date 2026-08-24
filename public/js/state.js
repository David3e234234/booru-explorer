export const isMyLiveDemoHost = false;

export const DEFAULT_SITES = [
  { id: 'danbooru', name: 'Danbooru', accentColor: '#3b82f6' },
  { id: 'gelbooru', name: 'Gelbooru', accentColor: '#6366f1' },
  { id: 'rule34', name: 'Rule34', accentColor: '#aae5a4' },
  { id: 'yandere', name: 'Yande.re', accentColor: '#ec4899' },
  { id: 'konachan', name: 'Konachan', accentColor: '#f97316' },
  { id: 'safebooru', name: 'Safebooru', accentColor: '#10b981' },
  { id: 'rule34video', name: 'Rule34Video', accentColor: '#ef4444' },
  { id: 'xbooru', name: 'Xbooru', accentColor: '#f43f5e' },
  { id: 'hypnohub', name: 'Hypnohub', accentColor: '#8b5cf6' },
  { id: 'tbib', name: 'TBIB', accentColor: '#f59e0b' },
  { id: 'pawchive', name: 'Pawchive', accentColor: '#f97316' }
];

export const state = {
  sites: [...DEFAULT_SITES],
  currentSite: 'danbooru',
  currentCategory: 'new', // 'new', 'views', 'top', 'recommended', 'random', 'favorites'
  aiFilter: 'no-ai', // 'all', 'no-ai', 'only-ai'
  ratingFilter: 'all', // 'all', 'nsfw' (18+), 'questionable' (16+), 'sfw' (safe)
  typeFilter: 'all', // 'all', 'video', 'image'
  ageFilter: 'all', // 'all', 'adult', 'young'
  dateFilter: 'all', // 'all', '24h', '2d', '7d', '30d', '90d', '365d'
  videoDurationSort: 'none', // 'none' | 'longest' | 'shortest'
  hideFurry: true,
  hidePregnant: true,
  hideLgbt: false,
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
  settings: {
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
    dateFilter: 'all',
    hideFurry: true,
    hidePregnant: true,
    hideLgbt: false,
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
    deepFetchPages: 2,
    prioritizeUserTags: false,
    enableJsDemuxing: true,
    customSources: ['danbooru', 'gelbooru', 'rule34', 'yandere'],
    maxServerCacheMb: 1500
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

export function markPostViewed(id) {
  if (!id) return;
  state.viewedIds.add(id);
  try {
    const arr = Array.from(state.viewedIds);
    if (arr.length > 2000) {
      arr.splice(0, arr.length - 2000);
      state.viewedIds = new Set(arr);
    }
    localStorage.setItem(STORAGE_KEYS.VIEWED, JSON.stringify(arr));
  } catch (e) {}
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

// 🧠 Algorithm for extracting the user's interest map
export function getUserInterestTags(limit = null) {
  const counts = new Map(); // tag -> positive weight sum
  const dislikeCounts = new Map(); // tag -> negative penalty sum
  const weights = new Map(); // tag -> baseWeight
  const catMap = new Map(); // tag -> category

  // 1. Analyze all liked posts (weight × 2.0)
  for (const post of state.likes) {
    extractTagsFromPost(post, counts, weights, catMap, 2.0);
  }

  // 2. Analyze favorites (weight × 1.5)
  for (const post of state.favorites) {
    extractTagsFromPost(post, counts, weights, catMap, 1.5);
  }

  // 3. Analyze hidden / disliked posts (penalty × 1.8)
  for (const post of (state.dislikes || [])) {
    extractTagsFromPost(post, dislikeCounts, weights, catMap, 1.8);
  }

  const scores = new Map();

  // Apply sublinear smoothing with penalty subtraction: baseWeight * log2(1 + netCount)
  for (const [tag, count] of counts.entries()) {
    const penalty = dislikeCounts.get(tag) || 0;
    const netCount = count - penalty;
    if (netCount <= 0.1) continue; // Tag fully suppressed by dislikes

    const baseWeight = weights.get(tag) || 1.0;
    const score = baseWeight * Math.log2(1 + netCount);
    scores.set(tag, score);
  }

  // 4. Analyze favorite authors (weight × 5.0) -> fixed bonus
  for (const author of state.favoriteAuthors) {
    const raw = (author.name || '').toLowerCase().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_');
    if (raw) {
      scores.set(raw, (scores.get(raw) || 0) + 10.0);
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

// 🔗 Extract stable tag pair combinations (Author + Character, Character + Franchise) for seed queries
export function getUserInterestSeedPairs(limit = 10) {
  const userInterests = getUserInterestTags();
  if (userInterests.length === 0) return [];

  const interestMap = new Map(userInterests.map(i => [i.tag, i.score]));
  const excludedSet = new Set((state.settings.excludedInterestTags || []).map(t => String(t).toLowerCase().trim()));
  const pairScores = new Map(); // "tag1 tag2" -> score

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

    // Highest-quality seed result combinations
    for (const a of artists) {
      for (const c of characters) addPair(a, c, 2.5);
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

function cleanTagString(str) {
  if (!str) return '';
  return String(str).toLowerCase().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_').trim();
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

function extractTagsFromPost(post, counts, weights, catMap, multiplier = 1.0) {
  if (!post) return;

  const addTag = (rawTag, category, baseWeight) => {
    if (!rawTag) return;
    const clean = cleanTagString(String(rawTag).split(',')[0]);
    if (!clean) return;
    
    counts.set(clean, (counts.get(clean) || 0) + multiplier);
    
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

// 🎯 Compute a post's relevance percentage and its list of matched tags
export function calculatePostMatchPercent(post, userInterestMap) {
  if (!post || !userInterestMap || userInterestMap.size === 0) {
    return {
      percent: 0,
      matchedTags: [],
      valueOf() { return 0; },
      toString() { return '0'; }
    };
  }

  let matchPoints = 0;
  const matchedTags = [];
  const addedSet = new Set();

  const checkTag = (tag, weightMultiplier = 1.0, displayPrefix = '') => {
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
          score
        });
      }
    }
  };

  if (post.author) checkTag(post.author, 4.0, '@');
  if (post.tagDetails) {
    if (Array.isArray(post.tagDetails.artist)) post.tagDetails.artist.forEach(a => checkTag(a, 4.0, '@'));
    if (Array.isArray(post.tagDetails.character)) post.tagDetails.character.forEach(c => checkTag(c, 3.0));
    if (Array.isArray(post.tagDetails.copyright)) post.tagDetails.copyright.forEach(cp => checkTag(cp, 2.5));
    if (Array.isArray(post.tagDetails.general)) post.tagDetails.general.forEach(g => checkTag(g, 1.0));
  } else if (Array.isArray(post.tags)) {
    for (const t of post.tags) checkTag(t, 1.0);
  }

  if (matchPoints === 0) {
    return {
      percent: 0,
      matchedTags: [],
      valueOf() { return 0; },
      toString() { return '0'; }
    };
  }

  // Sort matched tags by significance
  matchedTags.sort((a, b) => b.score - a.score);

  const ratio = matchPoints / (matchPoints + 12);
  const percent = Math.min(99, Math.max(70, Math.round(62 + ratio * 37)));

  return {
    percent,
    matchedTags: matchedTags.map(m => m.display).slice(0, 4),
    valueOf() { return this.percent; },
    toString() { return String(this.percent); }
  };
}


