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

let tempBlacklist = [];
let tempAiTags = [];

export function applySettingsToUIAndState(s) {
  if (!s) return;
  state.settings = { ...state.settings, ...s };
  if (s.theme) {
    document.documentElement.setAttribute('data-theme', s.theme);
  }
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
}

export async function updateStorageUsageInfo() {
  const storageTotalText = document.getElementById('storageTotalText');
  const storageClientCacheText = document.getElementById('storageClientCacheText');
  const storageServerCacheText = document.getElementById('storageServerCacheText');

  let totalBytes = 0;
  try {
    for (const key in localStorage) {
      if (Object.prototype.hasOwnProperty.call(localStorage, key)) {
        totalBytes += (localStorage[key].length + key.length) * 2;
      }
    }
  } catch {}

  let serverCacheBytes = 0;
  try {
    const data = await fetchCacheInfo();
    if (data.success) {
      serverCacheBytes = data.diskCacheBytes || 0;
    }
  } catch {}

  if (storageTotalText) storageTotalText.textContent = formatBytes(totalBytes + serverCacheBytes);
  if (storageClientCacheText) storageClientTextFormat(storageClientCacheText, totalBytes);
  if (storageServerCacheText) storageServerCacheText.textContent = formatBytes(serverCacheBytes);
}

function storageClientTextFormat(el, bytes) {
  el.textContent = formatBytes(bytes);
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

    try {
      await clearCache();
    } catch {}

    if (statusEl) {
      statusEl.textContent = 'Кэш очищен! ✅';
      setTimeout(() => { statusEl.textContent = ''; }, 3000);
    }
    await updateStorageUsageInfo();
    showToast('Кэш медиа и миниатюр очищен 🧹');
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Ошибка';
  } finally {
    if (btn) btn.disabled = false;
  }
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

  tempBlacklist = [...(state.settings.blacklist || [])];
  tempAiTags = [...(state.settings.aiTags || [])];
  renderSettingsChips();
  updateStorageUsageInfo();

  if (inputRule34ApiKey) inputRule34ApiKey.value = state.settings.rule34ApiKey || '';
  if (inputRule34UserId) inputRule34UserId.value = state.settings.rule34UserId || '';
  if (inputGelbooruApiKey) inputGelbooruApiKey.value = state.settings.gelbooruApiKey || '';
  if (inputGelbooruUserId) inputGelbooruUserId.value = state.settings.gelbooruUserId || '';
  if (inputDanbooruApiKey) inputDanbooruApiKey.value = state.settings.danbooruApiKey || '';
  if (inputDanbooruLogin) inputDanbooruLogin.value = state.settings.danbooruLogin || '';

  if (selectItemsPerPage) selectItemsPerPage.value = state.settings.itemsPerPage || 100;
  if (selectPreviewQuality) selectPreviewQuality.value = state.settings.previewQuality || 'medium';
  if (checkVideoAutoplayHover) checkVideoAutoplayHover.checked = state.settings.videoAutoplayHover !== false;
  if (checkVideoAutoplayMobile) checkVideoAutoplayMobile.checked = state.settings.videoAutoplayMobile !== false;
  if (checkVideoAutoplayViewer) checkVideoAutoplayViewer.checked = state.settings.videoAutoplayViewer !== false;
  
  const rowProxyThumbnails = document.getElementById('rowProxyThumbnails');
  const proxyThumbnailsVercelNotice = document.getElementById('proxyThumbnailsVercelNotice');
  const rowProxyFullImages = document.getElementById('rowProxyFullImages');
  const proxyFullImagesVercelNotice = document.getElementById('proxyFullImagesVercelNotice');
  const rowProxyVideos = document.getElementById('rowProxyVideos');
  const proxyVideosVercelNotice = document.getElementById('proxyVideosVercelNotice');
  const rowProxyDownloads = document.getElementById('rowProxyDownloads');
  const proxyDownloadsVercelNotice = document.getElementById('proxyDownloadsVercelNotice');

  const proxyToggles = [
    { el: checkProxyThumbnails, row: rowProxyThumbnails, notice: proxyThumbnailsVercelNotice, setting: state.settings.proxyThumbnails !== false },
    { el: checkProxyFullImages, row: rowProxyFullImages, notice: proxyFullImagesVercelNotice, setting: state.settings.proxyFullImages !== false },
    { el: checkProxyVideos, row: rowProxyVideos, notice: proxyVideosVercelNotice, setting: (state.settings.proxyVideos !== false && state.settings.proxyVideoDefault !== false) },
    { el: checkProxyDownloads, row: rowProxyDownloads, notice: proxyDownloadsVercelNotice, setting: state.settings.proxyDownloads !== false }
  ];

  proxyToggles.forEach(item => {
    if (item.el) {
      item.el.checked = item.setting;
      item.el.disabled = false;
    }
    if (item.row) {
      item.row.style.opacity = '1';
      item.row.style.cursor = 'pointer';
    }
    if (item.notice) item.notice.style.display = 'none';
  });

  if (checkProxyVideoDefault) checkProxyVideoDefault.checked = (state.settings.proxyVideos !== false && state.settings.proxyVideoDefault !== false);
  if (checkShowVideoStatusBanner) checkShowVideoStatusBanner.checked = state.settings.showVideoStatusBanner !== false;

  const selectDeepFetchPages = document.getElementById('selectDeepFetchPages');
  if (selectDeepFetchPages) selectDeepFetchPages.value = state.settings.deepFetchPages || 2;

  const checkPrioritizeUserTags = document.getElementById('checkPrioritizeUserTags');
  if (checkPrioritizeUserTags) checkPrioritizeUserTags.checked = state.settings.prioritizeUserTags || false;

  const checkEnablePaheal = document.getElementById('checkEnablePaheal');
  if (checkEnablePaheal) checkEnablePaheal.checked = state.settings.enablePaheal !== false;

  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  document.querySelectorAll('.btn-theme').forEach(b => {
    b.classList.toggle('active', b.dataset.themeVal === currentTheme);
  });

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
  const btnRefreshStorage = document.getElementById('btnRefreshStorage');
  const btnClearStorageBtn = document.getElementById('btnClearStorageBtn');
  const btnExportData = document.getElementById('btnExportData');
  const btnImportData = document.getElementById('btnImportData');
  const inputImportFile = document.getElementById('inputImportFile');

  if (btnSettings) btnSettings.addEventListener('click', openSettingsModal);
  if (btnCloseSettings) btnCloseSettings.addEventListener('click', closeSettingsModal);
  if (settingsBackdrop) settingsBackdrop.addEventListener('click', closeSettingsModal);

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
        showToast('Резервная копия скачана 📦');
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
        renderSettingsChips();

        showToast(`Данные загружены! Настройки, ${counts.favorites} закладок, ${counts.favoriteAuthors} авторов ✅`);
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
      const themeVal = btn.dataset.themeVal;
      document.documentElement.setAttribute('data-theme', themeVal);
    });
  });

  if (btnSaveSettings) {
    btnSaveSettings.addEventListener('click', async () => {
      const activeThemeBtn = document.querySelector('.btn-theme.active');
      const theme = activeThemeBtn ? activeThemeBtn.dataset.themeVal : 'dark';

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
        rule34ApiKey: inputRule34ApiKey ? inputRule34ApiKey.value.trim() : '',
        rule34UserId: inputRule34UserId ? inputRule34UserId.value.trim() : '',
        gelbooruApiKey: inputGelbooruApiKey ? inputGelbooruApiKey.value.trim() : '',
        gelbooruUserId: inputGelbooruUserId ? inputGelbooruUserId.value.trim() : '',
        danbooruApiKey: inputDanbooruApiKey ? inputDanbooruApiKey.value.trim() : '',
        danbooruLogin: inputDanbooruLogin ? inputDanbooruLogin.value.trim() : '',
        deepFetchPages: deepFetchPagesVal,
        prioritizeUserTags: prioritizeUserTagsVal,
        enablePaheal: enablePahealVal
      };

      saveLocalSettings(updated);

      try {
        const res = await saveSettings(updated);
        if (res.success) {
          state.settings = { ...updated, ...res.settings };
          state.limit = itemsPerPageVal;
          saveLocalSettings(state.settings);
          closeSettingsModal();
          showToast('Настройки сохранены ✅');
          if (onSettingsChanged) onSettingsChanged();
        }
      } catch (err) {
        state.settings = updated;
        state.limit = itemsPerPageVal;
        closeSettingsModal();
        showToast('Настройки сохранены в браузере ✅');
        if (onSettingsChanged) onSettingsChanged();
      }
    });
  }

  if (btnResetSettings) {
    btnResetSettings.addEventListener('click', async () => {
      tempBlacklist = ['guro', 'scat', 'snuff', 'vomit', 'fart'];
      tempAiTags = ['ai_generated', 'novelai', 'stable_diffusion', 'midjourney', 'synthetic', 'ai_assisted'];
      
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
      renderSettingsChips();
      saveLocalSettings({
        blacklist: tempBlacklist,
        aiTags: tempAiTags,
        rule34ApiKey: '',
        rule34UserId: '',
        gelbooruApiKey: '',
        gelbooruUserId: '',
        danbooruApiKey: '',
        danbooruLogin: ''
      });
      showToast('Значения сброшены к стандартным');
    });
  }
}
