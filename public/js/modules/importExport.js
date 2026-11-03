// Account import/export: builds the client export document and merges imported
// payloads into local state. Untrusted input is sanitized before it reaches state.
import {
  state,
  SECRET_SETTING_FIELDS,
  loadLocalSettings,
  saveLocalSettings,
  loadLocalPresets,
  loadLocalFavorites,
  loadLocalFavoriteAuthors,
  loadLocalLikes,
  loadLocalDislikes,
  setFavorites,
  setFavoriteAuthors,
  setLikes,
  setDislikes,
  setPresets
} from '../state.js';
import { invalidateInterestCache } from './recommendationEngine.js';

// Export all user data (settings, favorites, likes, dislikes, authors, account) into a JSON object.
// `account` comes from GET /api/auth/export and is included only when logged in.
export function exportUserData(account = null) {
  const settings = sanitizeImportedValue(loadLocalSettings() || state.settings || {}) || {};
  for (const field of SECRET_SETTING_FIELDS) delete settings[field];
  const exportObject = {
    version: 2,
    exportedAt: new Date().toISOString(),
    settings,
    presets: loadLocalPresets() || state.searchPresets || [],
    favorites: loadLocalFavorites() || state.favorites || [],
    favoriteAuthors: loadLocalFavoriteAuthors() || state.favoriteAuthors || [],
    likes: loadLocalLikes() || state.likes || [],
    dislikes: loadLocalDislikes() || state.dislikes || []
  };
  if (account && typeof account === 'object' && account.username) {
    exportObject.account = { id: account.id, username: account.username, createdAt: account.createdAt || null };
  }
  return exportObject;
}

// Accept both flat v1/v2 files and nested Telegram backups ({ data: {...} })
function sanitizeImportedValue(value, depth = 0) {
  if (value === null) return null;
  if (typeof value === 'string') return value.slice(0, 10000);
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'boolean') return value;
  if (depth >= 3) return null;
  if (Array.isArray(value)) {
    return value.slice(0, 500).map(item => sanitizeImportedValue(item, depth + 1)).filter(item => item !== null);
  }
  if (typeof value === 'object') {
    const clean = {};
    for (const [key, item] of Object.entries(value).slice(0, 500)) {
      const cleanValue = sanitizeImportedValue(item, depth + 1);
      if (cleanValue !== null) clean[String(key).slice(0, 200)] = cleanValue;
    }
    return clean;
  }
  return null;
}

function normalizeImportedList(value, key, maxItems = 5000) {
  if (!Array.isArray(value)) return null;
  return value
    .filter(item => item && typeof item === 'object' && item[key])
    .slice(0, maxItems)
    .map(item => sanitizeImportedValue(item));
}

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

// Import user data from JSON.
// With `replace` the imported lists overwrite local ones instead of merging —
// used after switching to the account from the file, so no stale local items leak into it.
export function importUserData(data, { replace = false } = {}) {
  if (!data || typeof data !== 'object') {
    throw new Error('Некорректный формат файла данных');
  }

  const normalized = normalizeImportPayload(data);
  const importedCounts = { settings: false, favorites: 0, favoriteAuthors: 0, likes: 0, dislikes: 0, account: normalized.account };

  // 1. Settings
  if (normalized.settings && typeof normalized.settings === 'object' && !Array.isArray(normalized.settings)) {
    const cleanSettings = sanitizeImportedValue(normalized.settings) || {};
    for (const field of SECRET_SETTING_FIELDS) delete cleanSettings[field];
    saveLocalSettings(cleanSettings);
    state.settings = { ...state.settings, ...cleanSettings };
    importedCounts.settings = true;
  }

  // 2. Favorites
  const importedFavorites = normalizeImportedList(normalized.favorites, 'id');
  if (importedFavorites) {
    const existing = replace ? [] : (loadLocalFavorites() || []);
    const mergedMap = new Map();
    existing.forEach(p => mergedMap.set(p.id, p));
    importedFavorites.forEach(p => mergedMap.set(p.id, p));
    const mergedList = Array.from(mergedMap.values());
    setFavorites(mergedList);
    importedCounts.favorites = mergedList.length;
  }

  // 3. Favorite authors
  const importedAuthors = normalizeImportedList(normalized.favoriteAuthors, 'name', 1000);
  if (importedAuthors) {
    const existing = replace ? [] : (loadLocalFavoriteAuthors() || []);
    const mergedMap = new Map();
    existing.forEach(a => mergedMap.set((a.name || '').toLowerCase(), a));
    importedAuthors.forEach(a => mergedMap.set((a.name || '').toLowerCase(), a));
    const mergedList = Array.from(mergedMap.values());
    setFavoriteAuthors(mergedList);
    importedCounts.favoriteAuthors = mergedList.length;
  }

  // 4. Likes
  const importedLikes = normalizeImportedList(normalized.likes, 'id');
  if (importedLikes) {
    const existing = replace ? [] : (loadLocalLikes() || []);
    const mergedMap = new Map();
    existing.forEach(l => mergedMap.set(l.id, l));
    importedLikes.forEach(l => mergedMap.set(l.id, l));
    const mergedList = Array.from(mergedMap.values());
    setLikes(mergedList);
    importedCounts.likes = mergedList.length;
  }

  // 5. Dislikes
  const importedDislikes = normalizeImportedList(normalized.dislikes, 'id');
  if (importedDislikes) {
    const existing = replace ? [] : (loadLocalDislikes() || []);
    const mergedMap = new Map();
    existing.forEach(d => mergedMap.set(d.id, d));
    importedDislikes.forEach(d => mergedMap.set(d.id, d));
    const mergedList = Array.from(mergedMap.values());
    setDislikes(mergedList);
    importedCounts.dislikes = mergedList.length;
  }

  // 6. Presets
  const incomingPresets = Array.isArray(normalized.presets)
    ? normalized.presets
    : (Array.isArray(normalized.settings?.searchPresets) ? normalized.settings.searchPresets : null);
  if (Array.isArray(incomingPresets)) {
    const existing = replace ? [] : (loadLocalPresets() || []);
    const mergedMap = new Map();
    existing.forEach(p => mergedMap.set(p.id || p.name, p));
    incomingPresets
      .filter(p => p && typeof p === 'object' && (p.id || p.name))
      .slice(0, 100)
      .forEach(p => {
        const cleanPreset = sanitizeImportedValue(p);
        if (cleanPreset) mergedMap.set(cleanPreset.id || cleanPreset.name, cleanPreset);
      });
    const mergedList = Array.from(mergedMap.values());
    setPresets(mergedList);
    importedCounts.presets = mergedList.length;
  }

  invalidateInterestCache();
  return importedCounts;
}
