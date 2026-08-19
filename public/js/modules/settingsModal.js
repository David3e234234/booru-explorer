import { 
  state, 
  saveLocalSettings, 
  exportUserData, 
  importUserData 
} from '../state.js';
import { 
  saveSettings, 
  fetchCacheInfo, 
  clearCache, 
  syncFavorites, 
  syncLikes, 
  syncFavoriteAuthors 
} from '../api.js';
import { showToast, formatBytes } from './uiUtils.js';
import { updateCategoryTabsUI, updateAiFilterUI, updateRatingFilterUI, updateTypeFilterUI, updateAgeFilterUI } from './filtersUI.js';

export const DEFAULT_CURVY_TAGS = [
  'milf',
  'mature_female',
  'mature',
  'tall_female',
  'tall',
  'curvy',
  'curvy_female',
  'wide_hips',
  'thick_thighs',
  'huge_breasts',
  'gigantic_breasts',
  'large_breasts',
  'big_breasts',
  'voluptuous',
  'plump',
  'chubby',
  'bbw',
  'mother',
  'housewife',
  'office_lady',
  'teacher',
  'cow_girl'
];

export const DEFAULT_PETITE_TAGS = [
  'loli',
  'shota',
  'petite',
  'flat_chest',
  'small_breasts',
  'short_female',
  'short_stature',
  'smol',
  'chibi',
  'schoolgirl',
  'young',
  'teenager',
  'underage',
  'middle_school_student',
  'elementary_school_student',
  'junior_high_school_student',
  'high_school_student',
  'preschooler',
  'kindergarten',
  'toddler'
];

let tempBlacklist = [];
let tempAiTags = [];
let tempCurvyTags = [];
let tempPetiteTags = [];

export function applySettingsToUIAndState(s) {
  if (!s) return;
  let theme = s.theme;
  if (theme === 'dark' || theme === 'oled') theme = 'midnight';
  else if (theme === 'light') theme = 'warm-paper';
  else if (!['midnight', 'emerald', 'tokyo-night', 'nordic-frost', 'warm-paper'].includes(theme)) {
    theme = 'midnight';
  }
  s.theme = theme;
  state.settings = { ...state.settings, ...s, theme };
  document.documentElement.setAttribute('data-theme', theme);
  const savedSite = s.defaultSite || localStorage.getItem('booru_selected_site');
  if (savedSite) {
    state.currentSite = savedSite;
  }
  if (s.aiFilter) {
    state.aiFilter = s.aiFilter;
    updateAiFilterUI();
  }
  if (s.ratingFilter) {
    state.ratingFilter = s.ratingFilter;
    updateRatingFilterUI();
  }
  if (s.typeFilter) {
    state.typeFilter = s.typeFilter;
    updateTypeFilterUI();
  }
  if (s.ageFilter) {
    state.ageFilter = s.ageFilter;
    updateAgeFilterUI();
  }
  const checkHideFurry = document.getElementById('checkHideFurry');
  if (typeof s.hideFurry === 'boolean') {
    state.hideFurry = s.hideFurry;
    if (checkHideFurry) checkHideFurry.checked = state.hideFurry;
  }
  const checkHidePregnant = document.getElementById('checkHidePregnant');
  if (typeof s.hidePregnant === 'boolean') {
    state.hidePregnant = s.hidePregnant;
    if (checkHidePregnant) checkHidePregnant.checked = state.hidePregnant;
  }
  const inputRule34ApiKey = document.getElementById('inputRule34ApiKey');
  const inputRule34UserId = document.getElementById('inputRule34UserId');
  const inputGelbooruApiKey = document.getElementById('inputGelbooruApiKey');
  const inputGelbooruUserId = document.getElementById('inputGelbooruUserId');
  const inputDanbooruApiKey = document.getElementById('inputDanbooruApiKey');
  const inputDanbooruLogin = document.getElementById('inputDanbooruLogin');
  const selectItemsPerPage = document.getElementById('selectItemsPerPage');
  const checkProxyThumbnails = document.getElementById('checkProxyThumbnails');
  const checkProxyFullImages = document.getElementById('checkProxyFullImages');
  const checkProxyVideos = document.getElementById('checkProxyVideos');
  const checkProxyDownloads = document.getElementById('checkProxyDownloads');
  const selectPreviewQuality = document.getElementById('selectPreviewQuality');
  const checkVideoAutoplayHover = document.getElementById('checkVideoAutoplayHover');
  const checkVideoAutoplayMobile = document.getElementById('checkVideoAutoplayMobile');
  const checkVideoAutoplayViewer = document.getElementById('checkVideoAutoplayViewer');

  if (s.rule34ApiKey && inputRule34ApiKey) inputRule34ApiKey.value = s.rule34ApiKey;
  if (s.rule34UserId && inputRule34UserId) inputRule34UserId.value = s.rule34UserId;
  if (s.gelbooruApiKey && inputGelbooruApiKey) inputGelbooruApiKey.value = s.gelbooruApiKey;
  if (s.gelbooruUserId && inputGelbooruUserId) inputGelbooruUserId.value = s.gelbooruUserId;
  if (s.danbooruApiKey && inputDanbooruApiKey) inputDanbooruApiKey.value = s.danbooruApiKey;
  if (s.danbooruLogin && inputDanbooruLogin) inputDanbooruLogin.value = s.danbooruLogin;
  if (s.itemsPerPage) {
    state.limit = s.itemsPerPage;
    if (selectItemsPerPage) selectItemsPerPage.value = String(s.itemsPerPage);
  }
  if (typeof s.proxyThumbnails === 'boolean' && checkProxyThumbnails) {
    checkProxyThumbnails.checked = s.proxyThumbnails;
  }
  if (typeof s.proxyFullImages === 'boolean' && checkProxyFullImages) {
    checkProxyFullImages.checked = s.proxyFullImages;
  }
  if (typeof s.proxyVideos === 'boolean' && checkProxyVideos) {
    checkProxyVideos.checked = s.proxyVideos;
  } else if (typeof s.proxyVideoDefault === 'boolean' && checkProxyVideos) {
    checkProxyVideos.checked = s.proxyVideoDefault;
  }
  const checkEnableJsDemuxing = document.getElementById('checkEnableJsDemuxing');
  if (typeof s.enableJsDemuxing === 'boolean' && checkEnableJsDemuxing) {
    checkEnableJsDemuxing.checked = s.enableJsDemuxing;
  }
  if (typeof s.proxyDownloads === 'boolean' && checkProxyDownloads) {
    checkProxyDownloads.checked = s.proxyDownloads;
  }
  if (s.previewQuality && selectPreviewQuality) {
    selectPreviewQuality.value = s.previewQuality;
  }
  if (typeof s.videoAutoplayHover === 'boolean' && checkVideoAutoplayHover) {
    checkVideoAutoplayHover.checked = s.videoAutoplayHover;
  }
  if (typeof s.videoAutoplayMobile === 'boolean' && checkVideoAutoplayMobile) {
    checkVideoAutoplayMobile.checked = s.videoAutoplayMobile;
  }
  if (typeof s.videoAutoplayViewer === 'boolean' && checkVideoAutoplayViewer) {
    checkVideoAutoplayViewer.checked = s.videoAutoplayViewer;
  }
}

export function persistSettings(partial) {
  state.settings = { ...state.settings, ...partial };
  saveLocalSettings(state.settings);
  saveSettings(state.settings).catch(() => {});
}

export function renderSettingsChips() {
  const blacklistWrapper = document.getElementById('blacklistWrapper');
  const blacklistInput = document.getElementById('blacklistInput');
  const aiTagsWrapper = document.getElementById('aiTagsWrapper');
  const aiTagsInput = document.getElementById('aiTagsInput');
  const curvyTagsWrapper = document.getElementById('curvyTagsWrapper');
  const curvyTagsInput = document.getElementById('curvyTagsInput');
  const petiteTagsWrapper = document.getElementById('petiteTagsWrapper');
  const petiteTagsInput = document.getElementById('petiteTagsInput');

  // Черный список
  if (blacklistWrapper && blacklistInput) {
    blacklistWrapper.querySelectorAll('.tag-chip').forEach(c => c.remove());
    tempBlacklist.forEach(tag => {
      const chip = document.createElement('div');
      chip.className = 'tag-chip';
      chip.innerHTML = `
        <span>${tag}</span>
        <span class="tag-chip-remove" data-bl-tag="${tag}">×</span>
      `;
      chip.querySelector('.tag-chip-remove').addEventListener('click', () => {
        tempBlacklist = tempBlacklist.filter(t => t !== tag);
        renderSettingsChips();
      });
      blacklistWrapper.insertBefore(chip, blacklistInput);
    });
  }

  // AI теги
  if (aiTagsWrapper && aiTagsInput) {
    aiTagsWrapper.querySelectorAll('.tag-chip').forEach(c => c.remove());
    tempAiTags.forEach(tag => {
      const chip = document.createElement('div');
      chip.className = 'tag-chip';
      chip.innerHTML = `
        <span>${tag}</span>
        <span class="tag-chip-remove" data-ai-tag="${tag}">×</span>
      `;
      chip.querySelector('.tag-chip-remove').addEventListener('click', () => {
        tempAiTags = tempAiTags.filter(t => t !== tag);
        renderSettingsChips();
      });
      aiTagsWrapper.insertBefore(chip, aiTagsInput);
    });
  }

  // Слова для «Мамочки» (Curvy)
  if (curvyTagsWrapper && curvyTagsInput) {
    curvyTagsWrapper.querySelectorAll('.tag-chip').forEach(c => c.remove());
    tempCurvyTags.forEach(tag => {
      const chip = document.createElement('div');
      chip.className = 'tag-chip';
      chip.innerHTML = `
        <span>${tag}</span>
        <span class="tag-chip-remove" data-curvy-tag="${tag}">×</span>
      `;
      chip.querySelector('.tag-chip-remove').addEventListener('click', () => {
        tempCurvyTags = tempCurvyTags.filter(t => t !== tag);
        renderSettingsChips();
      });
      curvyTagsWrapper.insertBefore(chip, curvyTagsInput);
    });
  }

  // Слова для «Лоли» (Petite)
  if (petiteTagsWrapper && petiteTagsInput) {
    petiteTagsWrapper.querySelectorAll('.tag-chip').forEach(c => c.remove());
    tempPetiteTags.forEach(tag => {
      const chip = document.createElement('div');
      chip.className = 'tag-chip';
      chip.innerHTML = `
        <span>${tag}</span>
        <span class="tag-chip-remove" data-petite-tag="${tag}">×</span>
      `;
      chip.querySelector('.tag-chip-remove').addEventListener('click', () => {
        tempPetiteTags = tempPetiteTags.filter(t => t !== tag);
        renderSettingsChips();
      });
      petiteTagsWrapper.insertBefore(chip, petiteTagsInput);
    });
  }
}

export async function updateStorageUsageInfo() {
  const storageUsageText = document.getElementById('storageUsageText');
  const storageQuotaText = document.getElementById('storageQuotaText');
  const storageProgressBar = document.getElementById('storageProgressBar');
  const storageMediaCacheText = document.getElementById('storageMediaCacheText');
  const storageServerCacheText = document.getElementById('storageServerCacheText');

  let localBytes = 0;
  try {
    for (const key in localStorage) {
      if (Object.prototype.hasOwnProperty.call(localStorage, key)) {
        localBytes += (localStorage[key].length + key.length) * 2;
      }
    }
  } catch {}

  let pwaCacheBytes = 0;
  if ('caches' in window) {
    try {
      const keys = await caches.keys();
      for (const k of keys) {
        const cache = await caches.open(k);
        const reqs = await cache.keys();
        for (const req of reqs) {
          const res = await cache.match(req);
          if (res) {
            const blob = await res.blob();
            pwaCacheBytes += blob.size;
          }
        }
      }
    } catch {}
  }

  let serverCacheBytes = 0;
  try {
    const data = await fetchCacheInfo();
    if (data && data.success) {
      serverCacheBytes = data.diskCacheBytes || 0;
    }
  } catch {}

  let quotaBytes = 0;
  let usageBytes = 0;
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      usageBytes = est.usage || 0;
      quotaBytes = est.quota || 0;
    } catch {}
  }

  const clientTotalBytes = usageBytes || (localBytes + pwaCacheBytes);

  if (storageUsageText) storageUsageText.textContent = formatBytes(clientTotalBytes);
  if (storageQuotaText) {
    storageQuotaText.textContent = quotaBytes > 0 ? formatBytes(quotaBytes) : '-- ГБ';
  }

  if (storageProgressBar && quotaBytes > 0) {
    const pct = Math.min(100, Math.max(1, Math.round((clientTotalBytes / quotaBytes) * 100)));
    storageProgressBar.style.width = `${pct}%`;
  }

  if (storageMediaCacheText) storageMediaCacheText.textContent = formatBytes(pwaCacheBytes || localBytes);
  if (storageServerCacheText) storageServerCacheText.textContent = formatBytes(serverCacheBytes);
}

export async function handleClearStorageCache() {
  const btn = document.getElementById('btnClearStorageBtn');
  const statusEl = document.getElementById('storageClearStatus');

  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = 'Очистка...';

  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('booru_cache_') || key.startsWith('booru_history_') || key.startsWith('booru_thumb_'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));

    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter(n => n.startsWith('booru-cache-') || n.includes('media'))
          .map(n => caches.delete(n))
      );
    }

    try {
      await clearCache();
    } catch (err) {}

    await updateStorageUsageInfo();
    if (statusEl) {
      statusEl.textContent = 'Кэш очищен';
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
    }
    showToast('Кэш медиа успешно очищен');
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Ошибка очистки';
    showToast('Не удалось полностью очистить кэш');
  } finally {
    if (btn) btn.disabled = false;
  }
}

export function switchSettingsTab(tabId) {
  document.querySelectorAll('.settings-nav-tab').forEach(btn => {
    const isActive = btn.dataset.tab === tabId;
    btn.classList.toggle('active', isActive);
    if (isActive) {
      btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  });
  document.querySelectorAll('.settings-tab-pane').forEach(pane => {
    pane.style.display = (pane.id === `tabPane-${tabId}`) ? 'flex' : 'none';
  });
}

export function openSettingsModal() {
  const settingsModal = document.getElementById('settingsModal');
  const inputRule34ApiKey = document.getElementById('inputRule34ApiKey');
  const inputRule34UserId = document.getElementById('inputRule34UserId');
  const inputGelbooruApiKey = document.getElementById('inputGelbooruApiKey');
  const inputGelbooruUserId = document.getElementById('inputGelbooruUserId');
  const inputDanbooruApiKey = document.getElementById('inputDanbooruApiKey');
  const inputDanbooruLogin = document.getElementById('inputDanbooruLogin');
  const selectItemsPerPage = document.getElementById('selectItemsPerPage');
  const checkProxyThumbnails = document.getElementById('checkProxyThumbnails');
  const checkProxyFullImages = document.getElementById('checkProxyFullImages');
  const checkProxyVideos = document.getElementById('checkProxyVideos');
  const checkProxyDownloads = document.getElementById('checkProxyDownloads');
  const checkProxyVideoDefault = document.getElementById('checkProxyVideoDefault');
  const selectPreviewQuality = document.getElementById('selectPreviewQuality');
  const checkVideoAutoplayHover = document.getElementById('checkVideoAutoplayHover');
  const checkVideoAutoplayMobile = document.getElementById('checkVideoAutoplayMobile');
  const checkVideoAutoplayViewer = document.getElementById('checkVideoAutoplayViewer');
  const checkShowVideoStatusBanner = document.getElementById('checkShowVideoStatusBanner');
  const selectDeepFetchPages = document.getElementById('selectDeepFetchPages');
  const checkPrioritizeUserTags = document.getElementById('checkPrioritizeUserTags');
  const checkEnablePaheal = document.getElementById('checkEnablePaheal');

  tempBlacklist = Array.isArray(state.settings.blacklist) && state.settings.blacklist.length > 0 
    ? [...state.settings.blacklist] 
    : ['guro', 'scat', 'snuff', 'vomit', 'fart'];

  tempAiTags = Array.isArray(state.settings.aiTags) && state.settings.aiTags.length > 0 
    ? [...state.settings.aiTags] 
    : ['ai_generated', 'ai_art', 'novelai', 'stable_diffusion', 'midjourney', 'synthetic', 'ai_assisted'];

  tempCurvyTags = Array.isArray(state.settings.curvyTags) && state.settings.curvyTags.length > 0 
    ? [...state.settings.curvyTags] 
    : [...DEFAULT_CURVY_TAGS];

  tempPetiteTags = Array.isArray(state.settings.petiteTags) && state.settings.petiteTags.length > 0 
    ? [...state.settings.petiteTags] 
    : [...DEFAULT_PETITE_TAGS];

  renderSettingsChips();
  updateStorageUsageInfo();

  if (inputRule34ApiKey) inputRule34ApiKey.value = state.settings.rule34ApiKey || '';
  if (inputRule34UserId) inputRule34UserId.value = state.settings.rule34UserId || '';
  if (inputGelbooruApiKey) inputGelbooruApiKey.value = state.settings.gelbooruApiKey || '';
  if (inputGelbooruUserId) inputGelbooruUserId.value = state.settings.gelbooruUserId || '';
  if (inputDanbooruApiKey) inputDanbooruApiKey.value = state.settings.danbooruApiKey || '';
  if (inputDanbooruLogin) inputDanbooruLogin.value = state.settings.danbooruLogin || '';
  if (selectItemsPerPage) selectItemsPerPage.value = String(state.limit || 100);
  if (selectPreviewQuality) selectPreviewQuality.value = state.settings.previewQuality || 'medium';
  if (checkVideoAutoplayHover) checkVideoAutoplayHover.checked = state.settings.videoAutoplayHover !== false;
  if (checkVideoAutoplayMobile) checkVideoAutoplayMobile.checked = state.settings.videoAutoplayMobile !== false;
  if (checkVideoAutoplayViewer) checkVideoAutoplayViewer.checked = state.settings.videoAutoplayViewer !== false;
  if (checkPrioritizeUserTags) checkPrioritizeUserTags.checked = state.settings.prioritizeUserTags === true;
  if (checkEnablePaheal) checkEnablePaheal.checked = state.settings.enablePaheal !== false;
  const checkEnableJsDemuxingModal = document.getElementById('checkEnableJsDemuxing');
  if (checkEnableJsDemuxingModal) checkEnableJsDemuxingModal.checked = state.settings.enableJsDemuxing !== false;
  if (selectDeepFetchPages) selectDeepFetchPages.value = String(state.settings.deepFetchPages || 2);

  if (checkProxyThumbnails) checkProxyThumbnails.checked = state.settings.proxyThumbnails !== false;
  if (checkProxyFullImages) checkProxyFullImages.checked = state.settings.proxyFullImages !== false;
  if (checkProxyVideos) checkProxyVideos.checked = (state.settings.proxyVideos !== false && state.settings.proxyVideoDefault !== false);
  if (checkProxyDownloads) checkProxyDownloads.checked = state.settings.proxyDownloads !== false;
  if (checkProxyVideoDefault) checkProxyVideoDefault.checked = (state.settings.proxyVideos !== false && state.settings.proxyVideoDefault !== false);
  if (checkShowVideoStatusBanner) checkShowVideoStatusBanner.checked = state.settings.showVideoStatusBanner !== false;

  const currentTheme = document.documentElement.getAttribute('data-theme') || 'midnight';
  document.querySelectorAll('.btn-theme').forEach(b => {
    b.classList.toggle('active', b.dataset.themeVal === currentTheme);
  });

  // По умолчанию открываем вкладку Общие
  switchSettingsTab('general');

  if (settingsModal) settingsModal.style.display = 'flex';
  document.querySelectorAll('.mobile-nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.nav === 'settings');
  });
}

export function closeSettingsModal() {
  const settingsModal = document.getElementById('settingsModal');
  if (settingsModal) settingsModal.style.display = 'none';
  updateCategoryTabsUI();
}

export function initSettingsModal({ onSettingsChanged, onDataImported, onUpdateFavoritesBadge }) {
  const btnSettings = document.getElementById('btnSettings');
  const btnCloseSettings = document.getElementById('btnCloseSettings');
  const settingsBackdrop = document.getElementById('settingsBackdrop');
  const btnSaveSettings = document.getElementById('btnSaveSettings');
  const btnResetSettings = document.getElementById('btnResetSettings');
  const blacklistInput = document.getElementById('blacklistInput');
  const aiTagsInput = document.getElementById('aiTagsInput');
  const curvyTagsInput = document.getElementById('curvyTagsInput');
  const petiteTagsInput = document.getElementById('petiteTagsInput');
  const btnResetCurvyTags = document.getElementById('btnResetCurvyTags');
  const btnResetPetiteTags = document.getElementById('btnResetPetiteTags');
  const btnRefreshStorage = document.getElementById('btnRefreshStorage');
  const btnClearStorageBtn = document.getElementById('btnClearStorageBtn');
  const btnExportData = document.getElementById('btnExportData');
  const btnImportData = document.getElementById('btnImportData');
  const inputImportFile = document.getElementById('inputImportFile');

  // Переключение вкладок
  document.querySelectorAll('.settings-nav-tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      const tabId = tabBtn.dataset.tab;
      if (tabId) switchSettingsTab(tabId);
    });
  });

  if (btnSettings) btnSettings.addEventListener('click', openSettingsModal);
  if (btnCloseSettings) btnCloseSettings.addEventListener('click', closeSettingsModal);
  if (settingsBackdrop) settingsBackdrop.addEventListener('click', closeSettingsModal);

  // Добавление тега в Черный список
  if (blacklistInput) {
    blacklistInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && blacklistInput.value.trim()) {
        e.preventDefault();
        const val = blacklistInput.value.trim().toLowerCase().replace(/\s+/g, '_');
        if (!tempBlacklist.includes(val)) {
          tempBlacklist.push(val);
          renderSettingsChips();
        }
        blacklistInput.value = '';
      }
    });
  }

  // Добавление тега в AI Detector
  if (aiTagsInput) {
    aiTagsInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && aiTagsInput.value.trim()) {
        e.preventDefault();
        const val = aiTagsInput.value.trim().toLowerCase().replace(/\s+/g, '_');
        if (!tempAiTags.includes(val)) {
          tempAiTags.push(val);
          renderSettingsChips();
        }
        aiTagsInput.value = '';
      }
    });
  }

  // Добавление тега в Мамочки (Curvy)
  if (curvyTagsInput) {
    curvyTagsInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && curvyTagsInput.value.trim()) {
        e.preventDefault();
        const val = curvyTagsInput.value.trim().toLowerCase().replace(/\s+/g, '_');
        if (!tempCurvyTags.includes(val)) {
          tempCurvyTags.push(val);
          renderSettingsChips();
        }
        curvyTagsInput.value = '';
      }
    });
  }

  // Добавление тега в Лоли (Petite)
  if (petiteTagsInput) {
    petiteTagsInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && petiteTagsInput.value.trim()) {
        e.preventDefault();
        const val = petiteTagsInput.value.trim().toLowerCase().replace(/\s+/g, '_');
        if (!tempPetiteTags.includes(val)) {
          tempPetiteTags.push(val);
          renderSettingsChips();
        }
        petiteTagsInput.value = '';
      }
    });
  }

  // Сброс слов Мамочек к дефолту
  if (btnResetCurvyTags) {
    btnResetCurvyTags.addEventListener('click', () => {
      tempCurvyTags = [...DEFAULT_CURVY_TAGS];
      renderSettingsChips();
      showToast('Слова для фильтра «Мамочки» сброшены к стандартным');
    });
  }

  // Сброс слов Лоли к дефолту
  if (btnResetPetiteTags) {
    btnResetPetiteTags.addEventListener('click', () => {
      tempPetiteTags = [...DEFAULT_PETITE_TAGS];
      renderSettingsChips();
      showToast('Слова для фильтра «Лоли» сброшены к стандартным');
    });
  }

  if (btnRefreshStorage) btnRefreshStorage.addEventListener('click', updateStorageUsageInfo);
  if (btnClearStorageBtn) btnClearStorageBtn.addEventListener('click', handleClearStorageCache);

  if (btnExportData) {
    btnExportData.addEventListener('click', () => {
      try {
        const data = exportUserData();
        const jsonStr = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const now = new Date();
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        a.href = url;
        a.download = `booru_explorer_backup_${dateStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Резервная копия скачана');
      } catch (err) {
        showToast('Ошибка при экспорте данных');
      }
    });
  }

  if (btnImportData && inputImportFile) {
    btnImportData.addEventListener('click', () => {
      inputImportFile.value = '';
      inputImportFile.click();
    });

    inputImportFile.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const counts = importUserData(parsed);

        if (counts.settings) {
          try { await saveSettings(state.settings); } catch (err) {}
          applySettingsToUIAndState(state.settings);
        }
        if (counts.favorites > 0) {
          try { await syncFavorites(state.favorites); } catch (err) {}
          if (onUpdateFavoritesBadge) onUpdateFavoritesBadge();
        }
        if (counts.likes > 0) {
          try { await syncLikes(state.likes); } catch (err) {}
        }
        if (counts.favoriteAuthors > 0) {
          try { await syncFavoriteAuthors(state.favoriteAuthors); } catch (err) {}
          if (onUpdateFavoritesBadge) onUpdateFavoritesBadge();
        }

        const inputRule34ApiKey = document.getElementById('inputRule34ApiKey');
        const inputRule34UserId = document.getElementById('inputRule34UserId');
        const inputGelbooruApiKey = document.getElementById('inputGelbooruApiKey');
        const inputGelbooruUserId = document.getElementById('inputGelbooruUserId');
        const inputDanbooruApiKey = document.getElementById('inputDanbooruApiKey');
        const inputDanbooruLogin = document.getElementById('inputDanbooruLogin');

        if (inputRule34ApiKey) inputRule34ApiKey.value = state.settings.rule34ApiKey || '';
        if (inputRule34UserId) inputRule34UserId.value = state.settings.rule34UserId || '';
        if (inputGelbooruApiKey) inputGelbooruApiKey.value = state.settings.gelbooruApiKey || '';
        if (inputGelbooruUserId) inputGelbooruUserId.value = state.settings.gelbooruUserId || '';
        if (inputDanbooruApiKey) inputDanbooruApiKey.value = state.settings.danbooruApiKey || '';
        if (inputDanbooruLogin) inputDanbooruLogin.value = state.settings.danbooruLogin || '';
        tempBlacklist = state.settings.blacklist || [];
        tempAiTags = state.settings.aiTags || [];
        tempCurvyTags = state.settings.curvyTags || [...DEFAULT_CURVY_TAGS];
        tempPetiteTags = state.settings.petiteTags || [...DEFAULT_PETITE_TAGS];
        renderSettingsChips();

        showToast(`Данные загружены: настройки, ${counts.favorites} закладок, ${counts.favoriteAuthors} авторов`);
        if (onDataImported) onDataImported();
      } catch (err) {
        showToast('Ошибка импорта: неверный JSON файл');
      }
    });
  }

  document.querySelectorAll('.btn-theme').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-theme').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const themeVal = btn.dataset.themeVal || 'midnight';
      document.documentElement.setAttribute('data-theme', themeVal);
      state.settings.theme = themeVal;
      saveLocalSettings(state.settings);
    });
  });

  if (btnSaveSettings) {
    btnSaveSettings.addEventListener('click', async () => {
      const activeThemeBtn = document.querySelector('.btn-theme.active');
      const theme = activeThemeBtn ? activeThemeBtn.dataset.themeVal : 'midnight';

      const selectItemsPerPage = document.getElementById('selectItemsPerPage');
      const selectPreviewQuality = document.getElementById('selectPreviewQuality');
      const checkVideoAutoplayHover = document.getElementById('checkVideoAutoplayHover');
      const checkVideoAutoplayMobile = document.getElementById('checkVideoAutoplayMobile');
      const checkVideoAutoplayViewer = document.getElementById('checkVideoAutoplayViewer');
      const checkProxyThumbnails = document.getElementById('checkProxyThumbnails');
      const checkProxyFullImages = document.getElementById('checkProxyFullImages');
      const checkProxyVideos = document.getElementById('checkProxyVideos');
      const checkProxyDownloads = document.getElementById('checkProxyDownloads');
      const checkProxyVideoDefault = document.getElementById('checkProxyVideos') || document.getElementById('checkProxyVideoDefault');
      const checkShowVideoStatusBanner = document.getElementById('checkShowVideoStatusBanner');

      const itemsPerPageVal = selectItemsPerPage ? (parseInt(selectItemsPerPage.value, 10) || 100) : 100;
      const previewQualityVal = selectPreviewQuality ? selectPreviewQuality.value : 'medium';
      const videoAutoplayHoverVal = checkVideoAutoplayHover ? checkVideoAutoplayHover.checked : true;
      const videoAutoplayMobileVal = checkVideoAutoplayMobile ? checkVideoAutoplayMobile.checked : true;
      const videoAutoplayViewerVal = checkVideoAutoplayViewer ? checkVideoAutoplayViewer.checked : true;
      
      const proxyThumbnailsVal = checkProxyThumbnails ? checkProxyThumbnails.checked : true;
      const proxyFullImagesVal = checkProxyFullImages ? checkProxyFullImages.checked : true;
      const proxyVideosVal = checkProxyVideos ? checkProxyVideos.checked : (checkProxyVideoDefault ? checkProxyVideoDefault.checked : true);
      const proxyDownloadsVal = checkProxyDownloads ? checkProxyDownloads.checked : true;
      const proxyVideoDefaultVal = proxyVideosVal;
      const showVideoStatusBannerVal = checkShowVideoStatusBanner ? checkShowVideoStatusBanner.checked : true;
      
      const selectDeepFetchPages = document.getElementById('selectDeepFetchPages');
      const deepFetchPagesVal = selectDeepFetchPages ? (parseInt(selectDeepFetchPages.value, 10) || 2) : 2;

      const checkPrioritizeUserTags = document.getElementById('checkPrioritizeUserTags');
      const prioritizeUserTagsVal = checkPrioritizeUserTags ? checkPrioritizeUserTags.checked : false;

      const checkEnablePaheal = document.getElementById('checkEnablePaheal');
      const enablePahealVal = checkEnablePaheal ? checkEnablePaheal.checked : true;

      const checkEnableJsDemuxing = document.getElementById('checkEnableJsDemuxing');
      const enableJsDemuxingVal = checkEnableJsDemuxing ? checkEnableJsDemuxing.checked : true;

      const inputRule34ApiKey = document.getElementById('inputRule34ApiKey');
      const inputRule34UserId = document.getElementById('inputRule34UserId');
      const inputGelbooruApiKey = document.getElementById('inputGelbooruApiKey');
      const inputGelbooruUserId = document.getElementById('inputGelbooruUserId');
      const inputDanbooruApiKey = document.getElementById('inputDanbooruApiKey');
      const inputDanbooruLogin = document.getElementById('inputDanbooruLogin');

      const updated = {
        ...state.settings,
        theme,
        itemsPerPage: itemsPerPageVal,
        previewQuality: previewQualityVal,
        videoAutoplayHover: videoAutoplayHoverVal,
        videoAutoplayMobile: videoAutoplayMobileVal,
        videoAutoplayViewer: videoAutoplayViewerVal,
        proxyThumbnails: proxyThumbnailsVal,
        proxyFullImages: proxyFullImagesVal,
        proxyVideos: proxyVideosVal,
        proxyDownloads: proxyDownloadsVal,
        proxyVideoDefault: proxyVideoDefaultVal,
        showVideoStatusBanner: showVideoStatusBannerVal,
        blacklist: tempBlacklist,
        aiTags: tempAiTags,
        curvyTags: tempCurvyTags,
        petiteTags: tempPetiteTags,
        rule34ApiKey: inputRule34ApiKey ? inputRule34ApiKey.value.trim() : '',
        rule34UserId: inputRule34UserId ? inputRule34UserId.value.trim() : '',
        gelbooruApiKey: inputGelbooruApiKey ? inputGelbooruApiKey.value.trim() : '',
        gelbooruUserId: inputGelbooruUserId ? inputGelbooruUserId.value.trim() : '',
        danbooruApiKey: inputDanbooruApiKey ? inputDanbooruApiKey.value.trim() : '',
        danbooruLogin: inputDanbooruLogin ? inputDanbooruLogin.value.trim() : '',
        deepFetchPages: deepFetchPagesVal,
        prioritizeUserTags: prioritizeUserTagsVal,
        enablePaheal: enablePahealVal,
        enableJsDemuxing: enableJsDemuxingVal
      };

      saveLocalSettings(updated);

      try {
        const res = await saveSettings(updated);
        if (res && res.success) {
          state.settings = { ...updated, ...res.settings };
          state.limit = itemsPerPageVal;
          saveLocalSettings(state.settings);
          closeSettingsModal();
          showToast('Настройки сохранены');
          if (onSettingsChanged) onSettingsChanged();
        }
      } catch (err) {
        state.settings = updated;
        state.limit = itemsPerPageVal;
        closeSettingsModal();
        showToast('Настройки сохранены в браузере');
        if (onSettingsChanged) onSettingsChanged();
      }
    });
  }

  if (btnResetSettings) {
    btnResetSettings.addEventListener('click', async () => {
      tempBlacklist = ['guro', 'scat', 'snuff', 'vomit', 'fart'];
      tempAiTags = ['ai_generated', 'ai_art', 'novelai', 'stable_diffusion', 'midjourney', 'synthetic', 'ai_assisted'];
      tempCurvyTags = [...DEFAULT_CURVY_TAGS];
      tempPetiteTags = [...DEFAULT_PETITE_TAGS];
      
      const inputRule34ApiKey = document.getElementById('inputRule34ApiKey');
      const inputRule34UserId = document.getElementById('inputRule34UserId');
      const inputGelbooruApiKey = document.getElementById('inputGelbooruApiKey');
      const inputGelbooruUserId = document.getElementById('inputGelbooruUserId');
      const inputDanbooruApiKey = document.getElementById('inputDanbooruApiKey');
      const inputDanbooruLogin = document.getElementById('inputDanbooruLogin');
      const selectPreviewQuality = document.getElementById('selectPreviewQuality');
      const checkVideoAutoplayHover = document.getElementById('checkVideoAutoplayHover');
      const checkVideoAutoplayMobile = document.getElementById('checkVideoAutoplayMobile');
      const checkVideoAutoplayViewer = document.getElementById('checkVideoAutoplayViewer');
      const checkEnablePaheal = document.getElementById('checkEnablePaheal');
      const checkEnableJsDemuxing = document.getElementById('checkEnableJsDemuxing');

      if (inputRule34ApiKey) inputRule34ApiKey.value = '';
      if (inputRule34UserId) inputRule34UserId.value = '';
      if (inputGelbooruApiKey) inputGelbooruApiKey.value = '';
      if (inputGelbooruUserId) inputGelbooruUserId.value = '';
      if (inputDanbooruApiKey) inputDanbooruApiKey.value = '';
      if (inputDanbooruLogin) inputDanbooruLogin.value = '';
      if (selectPreviewQuality) selectPreviewQuality.value = 'medium';
      if (checkVideoAutoplayHover) checkVideoAutoplayHover.checked = true;
      if (checkVideoAutoplayMobile) checkVideoAutoplayMobile.checked = true;
      if (checkVideoAutoplayViewer) checkVideoAutoplayViewer.checked = true;
      if (checkEnablePaheal) checkEnablePaheal.checked = true;
      if (checkEnableJsDemuxing) checkEnableJsDemuxing.checked = true;
      renderSettingsChips();
      saveLocalSettings({
        blacklist: tempBlacklist,
        aiTags: tempAiTags,
        curvyTags: tempCurvyTags,
        petiteTags: tempPetiteTags,
        rule34ApiKey: '',
        rule34UserId: '',
        gelbooruApiKey: '',
        gelbooruUserId: '',
        danbooruApiKey: '',
        danbooruLogin: '',
        enableJsDemuxing: true
      });
      showToast('Значения сброшены к стандартным');
    });
  }
}

