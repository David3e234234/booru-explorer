// Account data loaders: settings, favorites, likes, dislikes and followed
// authors. Every loader takes a generation token so responses from a previous
// login session cannot commit into the next account.
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
  setPresets,
  setAuthorAliases
} from '../state.js';
import {
  fetchSettings,
  saveSettings,
  fetchFavorites,
  fetchFavoriteAuthors,
  fetchLikes,
  fetchDislikes,
  fetchAliasesMap
} from '../api.js';
import { renderPresetsList, updatePresetActiveState } from './searchPresetsUI.js';

// Monotonic token: account data responses from a superseded session are discarded
let accountGeneration = 0;

export function bumpAccountGeneration() {
  accountGeneration += 1;
}

let deps = {
  applySettingsToUIAndState: async () => {},
  updateFavoritesBadge: () => {},
  getProfileUI: () => null
};

export function initAccountData(d) {
  deps = { ...deps, ...d };
}

export async function loadUserSettings(generation = accountGeneration) {
  try {
    const local = loadLocalSettings() || {};
    if (Object.keys(local).length > 0) {
      await deps.applySettingsToUIAndState(local);
    }
    const data = await fetchSettings();
    if (generation !== accountGeneration) return;
    const serverSettings = data?.settings || {};

    let merged;
    let shouldSyncToServer = false;

    if (state.currentUser) {
      // Authenticated user: server settings are authoritative, never wipe them out with empty local values
      merged = { ...state.settings, ...serverSettings };

      // Ensure that credentials in SECRET_SETTING_FIELDS from server are preserved,
      // and any non-empty local credentials the server account is missing get migrated
      for (const field of SECRET_SETTING_FIELDS) {
        const serverVal = serverSettings[field];
        const localVal = local[field];
        if (serverVal && String(serverVal).trim() !== '') {
          merged[field] = serverVal;
        } else if (localVal && String(localVal).trim() !== '') {
          merged[field] = localVal;
          shouldSyncToServer = true;
        }
      }

      // Also transfer any proxy settings that the account is missing
      const proxyFields = SECRET_SETTING_FIELDS.filter(f => f.endsWith('Proxy'));
      for (const field of proxyFields) {
        const serverVal = serverSettings[field];
        const localVal = local[field];
        if (serverVal && String(serverVal).trim() !== '') {
          merged[field] = serverVal;
        } else if (localVal && String(localVal).trim() !== '') {
          merged[field] = localVal;
          shouldSyncToServer = true;
        }
      }

      // Search presets synchronization
      const serverPresets = Array.isArray(serverSettings.searchPresets) ? serverSettings.searchPresets : null;
      const localPresets = loadLocalPresets() || [];
      if (serverPresets && serverPresets.length > 0) {
        merged.searchPresets = serverPresets;
        setPresets(serverPresets);
      } else if (localPresets.length > 0 && (!serverPresets || serverPresets.length === 0)) {
        merged.searchPresets = localPresets;
        setPresets(localPresets);
        shouldSyncToServer = true;
      } else if (serverPresets && serverPresets.length === 0) {
        merged.searchPresets = [];
        setPresets([]);
      }
    } else {
      // Anonymous / logged out: local settings override server defaults
      merged = { ...serverSettings, ...local };
      const localPresets = loadLocalPresets() || [];
      if (localPresets.length > 0) {
        merged.searchPresets = localPresets;
        setPresets(localPresets);
      }
    }

    await deps.applySettingsToUIAndState(merged);
    saveLocalSettings(merged);
    renderPresetsList();
    updatePresetActiveState();

    if (shouldSyncToServer && state.currentUser) {
      saveSettings(merged).catch(() => {});
    }
  } catch (err) {
    console.error('Ошибка настроек:', err);
  }
}

export async function loadFavorites(generation = accountGeneration) {
  try {
    if (state.currentUser) {
      const data = await fetchFavorites();
      if (generation !== accountGeneration) return;
      const serverFavs = Array.isArray(data?.favorites) ? data.favorites : [];
      setFavorites(serverFavs);
      deps.updateFavoritesBadge();
    } else {
      const localFavs = loadLocalFavorites() || [];
      setFavorites(localFavs);
      deps.updateFavoritesBadge();
    }
  } catch (err) {
    console.error('Ошибка избранного:', err);
  }
}

export async function loadFavoriteAuthors(generation = accountGeneration) {
  try {
    if (state.currentUser) {
      const data = await fetchFavoriteAuthors();
      if (generation !== accountGeneration) return;
      const serverAuthors = Array.isArray(data?.authors) ? data.authors : [];
      setFavoriteAuthors(serverAuthors);
      deps.updateFavoritesBadge();
    } else {
      const localAuthors = loadLocalFavoriteAuthors() || [];
      setFavoriteAuthors(localAuthors);
      deps.updateFavoritesBadge();
    }
  } catch (err) {
    console.error('Ошибка любимых авторов:', err);
  }
}

export async function loadAuthorAliasesMap() {
  try {
    const map = await fetchAliasesMap();
    if (map && typeof map === 'object') {
      setAuthorAliases(map);
    }
  } catch (err) {
    console.warn('Не удалось загрузить карту алиасов авторов:', err);
  }
}

export async function loadLikes(generation = accountGeneration) {
  try {
    if (state.currentUser) {
      const data = await fetchLikes();
      if (generation !== accountGeneration) return;
      const serverLikes = Array.isArray(data?.likes) ? data.likes : [];
      setLikes(serverLikes);
    } else {
      const localLikes = loadLocalLikes() || [];
      setLikes(localLikes);
    }
  } catch (err) {
    console.error('Ошибка лайков:', err);
  }
}

export async function loadDislikes(generation = accountGeneration) {
  try {
    if (state.currentUser) {
      const data = await fetchDislikes();
      if (generation !== accountGeneration) return;
      const serverDislikes = Array.isArray(data?.dislikes) ? data.dislikes : [];
      setDislikes(serverDislikes);
    } else {
      const localDislikes = loadLocalDislikes() || [];
      setDislikes(localDislikes);
    }
  } catch (err) {
    console.error('Ошибка загрузки скрытых постов:', err);
  }
}

export async function refreshAllUserData() {
  const generation = accountGeneration;
  await Promise.allSettled([
    loadUserSettings(generation),
    loadFavorites(generation),
    loadFavoriteAuthors(generation),
    loadLikes(generation),
    loadDislikes(generation)
  ]);
  deps.updateFavoritesBadge();
  renderPresetsList();
  updatePresetActiveState();
  const profileUI = deps.getProfileUI();
  if (profileUI) profileUI.renderProfile();
  document.dispatchEvent(new CustomEvent('booru:user-changed'));
}
