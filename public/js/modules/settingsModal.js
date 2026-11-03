import {
  state,
  saveLocalSettings,
  invalidateInterestCache
} from '../state.js';
import {
  saveSettings,
  markAuthHeadersDirty
} from '../api.js';
import {
  showToast,
  syncThemeColor
} from './uiUtils.js';
import { t, getLang, setLang } from '../i18n.js';
import { updateCategoryTabsUI, updatePostSortUI, updateAiFilterUI, updateRatingFilterUI, updateTypeFilterUI, updateAgeFilterUI, updatePawchiveServiceUI, updateKemonoServiceUI } from './filtersUI.js';

import { lockBodyScroll, unlockBodyScroll } from './scrollLock.js';
import {
  normalizeProxyString
} from './settingsConstants.js';

import {
  renderSettingsChips,
  initTagListInputs,
  loadTempTagsFromSettings,
  getTempTags,
  resetTempTagsToDefaults
} from './settingsTabs/tagLists.js';
import { loadTempSiteSortTags, getTempSiteSortTags, resetTempSiteSortTags, initSiteSortEditor } from './settingsTabs/siteSortEditor.js';
import { loadTempSiteMediaProxy, getTempSiteMediaProxy, resetTempSiteMediaProxy, renderSiteMediaProxyUI } from './settingsTabs/mediaProxySettings.js';
import { renderTasteProfileUI, initTasteProfileControls } from './settingsTabs/tasteProfile.js';
import {
  updateStorageUsageInfo,
  updateDiscoveredAliasesUI,
  updateTelegramBackupStatusUI,
  initStorageBackup
} from './settingsTabs/storageBackup.js';
import { initCredentialTests } from './settingsTabs/credentialTests.js';
import { initProxyTests } from './settingsTabs/proxyTests.js';
import { ensureSettingsMarkup } from './settingsMarkup.js';
import { initNotificationSettingsControls } from './notificationsUI.js';

export function applySettingsToUIAndState(s) {
  if (!s) return;
  let theme = s.theme;
  if (theme === 'dark' || theme === 'oled' || theme === 'midnight' || theme === 'emerald' || theme === 'nordic-frost') theme = 'kotobox';
  else if (theme === 'light') theme = 'warm-paper';
  else if (!['kotobox', 'tokyo-night', 'warm-paper'].includes(theme)) {
    theme = 'kotobox';
  }
  s.theme = theme;
  state.settings = { ...state.settings, ...s, theme };
  document.documentElement.setAttribute('data-theme', theme);
  syncThemeColor();
  invalidateInterestCache();
  markAuthHeadersDirty();
  const savedSite = s.defaultSite || localStorage.getItem('booru_selected_site');
  if (savedSite) {
    state.currentSite = savedSite;
  }
  if (s.postSort) {
    state.postSort = s.postSort;
    updatePostSortUI();
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

  if (s.pawchiveService) {
    state.pawchiveService = s.pawchiveService;
    updatePawchiveServiceUI();
  }
  if (s.kemonoService) {
    state.kemonoService = s.kemonoService;
    updateKemonoServiceUI();
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
  const checkHideLgbt = document.getElementById('checkHideLgbt');
  if (typeof s.hideLgbt === 'boolean') {
    state.hideLgbt = s.hideLgbt;
    if (checkHideLgbt) checkHideLgbt.checked = state.hideLgbt;
  }
  const inputRule34ApiKey = document.getElementById('inputRule34ApiKey');
  const inputRule34UserId = document.getElementById('inputRule34UserId');
  const inputGelbooruApiKey = document.getElementById('inputGelbooruApiKey');
  const inputGelbooruUserId = document.getElementById('inputGelbooruUserId');
  const inputDanbooruApiKey = document.getElementById('inputDanbooruApiKey');
  const inputDanbooruLogin = document.getElementById('inputDanbooruLogin');
  const inputKonachanLogin = document.getElementById('inputKonachanLogin');
  const inputKonachanPassword = document.getElementById('inputKonachanPassword');
  const inputYandereLogin = document.getElementById('inputYandereLogin');
  const inputYanderePassword = document.getElementById('inputYanderePassword');
  const inputPawchiveSession = document.getElementById('inputPawchiveSession');
  const inputKemonoSession = document.getElementById('inputKemonoSession');
  const selectItemsPerPage = document.getElementById('selectItemsPerPage');
  const checkProxyThumbnails = document.getElementById('checkProxyThumbnails');
  const checkProxyFullImages = document.getElementById('checkProxyFullImages');
  const checkProxyVideos = document.getElementById('checkProxyVideos');
  const checkProxyDownloads = document.getElementById('checkProxyDownloads');
  const selectPreviewQuality = document.getElementById('selectPreviewQuality');
  const selectVideoDefaultQuality = document.getElementById('selectVideoDefaultQuality');
  const checkVideoAutoplayHover = document.getElementById('checkVideoAutoplayHover');
  const checkVideoAutoplayMobile = document.getElementById('checkVideoAutoplayMobile');
  const checkVideoAutoplayViewer = document.getElementById('checkVideoAutoplayViewer');
  const checkEnableSimilarPosts = document.getElementById('checkEnableSimilarPosts');

  if (inputRule34ApiKey && s.rule34ApiKey !== undefined) inputRule34ApiKey.value = s.rule34ApiKey || '';
  if (inputRule34UserId && s.rule34UserId !== undefined) inputRule34UserId.value = s.rule34UserId || '';
  if (inputGelbooruApiKey && s.gelbooruApiKey !== undefined) inputGelbooruApiKey.value = s.gelbooruApiKey || '';
  if (inputGelbooruUserId && s.gelbooruUserId !== undefined) inputGelbooruUserId.value = s.gelbooruUserId || '';
  if (inputDanbooruApiKey && s.danbooruApiKey !== undefined) inputDanbooruApiKey.value = s.danbooruApiKey || '';
  if (inputDanbooruLogin && s.danbooruLogin !== undefined) inputDanbooruLogin.value = s.danbooruLogin || '';
  if (inputKonachanLogin && s.konachanLogin !== undefined) inputKonachanLogin.value = s.konachanLogin || '';
  if (inputKonachanPassword && s.konachanPassword !== undefined) inputKonachanPassword.value = s.konachanPassword || '';
  if (inputYandereLogin && s.yandereLogin !== undefined) inputYandereLogin.value = s.yandereLogin || '';
  if (inputYanderePassword && s.yanderePassword !== undefined) inputYanderePassword.value = s.yanderePassword || '';
  if (inputPawchiveSession && s.pawchiveSession !== undefined) inputPawchiveSession.value = s.pawchiveSession || '';
  if (inputKemonoSession && s.kemonoSession !== undefined) inputKemonoSession.value = s.kemonoSession || '';

  const proxyInputs = [
    { key: 'globalProxy', id: 'inputGlobalProxy' },
    { key: 'danbooruProxy', id: 'inputDanbooruProxy' },
    { key: 'gelbooruProxy', id: 'inputGelbooruProxy' },
    { key: 'rule34Proxy', id: 'inputRule34Proxy' },
    { key: 'yandereProxy', id: 'inputYandereProxy' },
    { key: 'konachanProxy', id: 'inputKonachanProxy' },
    { key: 'safebooruProxy', id: 'inputSafebooruProxy' },
    { key: 'rule34videoProxy', id: 'inputRule34videoProxy' },
    { key: 'pawchiveProxy', id: 'inputPawchiveProxy' },
    { key: 'kemonoProxy', id: 'inputKemonoProxy' },
    { key: 'xbooruProxy', id: 'inputXbooruProxy' },
    { key: 'hypnohubProxy', id: 'inputHypnohubProxy' },
    { key: 'tbibProxy', id: 'inputTbibProxy' }
  ];
  proxyInputs.forEach(({ key, id }) => {
    const el = document.getElementById(id);
    if (el && s[key] !== undefined) el.value = s[key] || '';
  });
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
  if (s.videoDefaultQuality && selectVideoDefaultQuality) {
    selectVideoDefaultQuality.value = s.videoDefaultQuality;
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
  if (typeof s.enableSimilarPosts === 'boolean' && checkEnableSimilarPosts) {
    checkEnableSimilarPosts.checked = s.enableSimilarPosts;
  }
  const checkHideZipPostsApply = document.getElementById('checkHideZipPosts');
  if (checkHideZipPostsApply && typeof s.hideZipPosts === 'boolean') {
    checkHideZipPostsApply.checked = s.hideZipPosts;
  }
  const checkUnpackArchivesApply = document.getElementById('checkUnpackArchivesOnDownload');
  if (checkUnpackArchivesApply && typeof s.unpackArchivesOnDownload === 'boolean') {
    checkUnpackArchivesApply.checked = s.unpackArchivesOnDownload;
  }
  const checkGroupAlbumsApply = document.getElementById('checkGroupAlbums');
  if (checkGroupAlbumsApply && typeof s.groupAlbums === 'boolean') {
    checkGroupAlbumsApply.checked = s.groupAlbums;
  }
  const selectArchiveDownloadThreadsApply = document.getElementById('selectArchiveDownloadThreads');
  if (selectArchiveDownloadThreadsApply && s.archiveDownloadThreads !== undefined) {
    selectArchiveDownloadThreadsApply.value = String(s.archiveDownloadThreads);
  }

  const selectMaxServerCache = document.getElementById('selectMaxServerCache');
  if (selectMaxServerCache && s.maxServerCacheMb !== undefined) {
    selectMaxServerCache.value = String(s.maxServerCacheMb);
  }

  if (s.recommendationMode) {
    state.settings.recommendationMode = s.recommendationMode;
  }
  const selectRecommendationMode = document.getElementById('selectRecommendationMode');
  if (selectRecommendationMode && state.settings.recommendationMode) {
    selectRecommendationMode.value = state.settings.recommendationMode;
  }

  // Telegram auto-backup
  const checkTelegramBackupEnabled = document.getElementById('checkTelegramBackupEnabled');
  const inputTelegramBotToken = document.getElementById('inputTelegramBotToken');
  const inputTelegramChatId = document.getElementById('inputTelegramChatId');
  const selectTelegramBackupInterval = document.getElementById('selectTelegramBackupInterval');
  const telegramBackupForm = document.getElementById('telegramBackupForm');

  if (checkTelegramBackupEnabled && typeof s.telegramBackupEnabled === 'boolean') {
    checkTelegramBackupEnabled.checked = s.telegramBackupEnabled;
    if (telegramBackupForm) {
      telegramBackupForm.classList.toggle('is-disabled', !s.telegramBackupEnabled);
    }
  }
  if (inputTelegramBotToken && typeof s.telegramBotToken === 'string') {
    inputTelegramBotToken.value = s.telegramBotToken;
  }
  if (inputTelegramChatId && (typeof s.telegramChatId === 'string' || typeof s.telegramChatId === 'number')) {
    inputTelegramChatId.value = String(s.telegramChatId);
  }
  if (selectTelegramBackupInterval && s.telegramBackupInterval) {
    selectTelegramBackupInterval.value = s.telegramBackupInterval;
  }

  updateTelegramBackupStatusUI(s);
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
  if (tabId === 'filters' || tabId === 'search') {
    renderTasteProfileUI();
  }
  if (tabId === 'proxy') {
    renderSiteMediaProxyUI();
  }
}

export function openSettingsModal() {
  // Full-screen modal over the phone feed: playback must stop underneath it,
  // otherwise the video keeps streaming and decoding behind the dialog.
  document.dispatchEvent(new CustomEvent('booru:settings-opened'));
  const settingsModal = document.getElementById('settingsModal');
  const inputRule34ApiKey = document.getElementById('inputRule34ApiKey');
  const inputRule34UserId = document.getElementById('inputRule34UserId');
  const inputGelbooruApiKey = document.getElementById('inputGelbooruApiKey');
  const inputGelbooruUserId = document.getElementById('inputGelbooruUserId');
  const inputDanbooruApiKey = document.getElementById('inputDanbooruApiKey');
  const inputDanbooruLogin = document.getElementById('inputDanbooruLogin');
  const inputKonachanLogin = document.getElementById('inputKonachanLogin');
  const inputKonachanPassword = document.getElementById('inputKonachanPassword');
  const inputYandereLogin = document.getElementById('inputYandereLogin');
  const inputYanderePassword = document.getElementById('inputYanderePassword');
  const inputPawchiveSession = document.getElementById('inputPawchiveSession');
  const inputKemonoSession = document.getElementById('inputKemonoSession');
  const selectItemsPerPage = document.getElementById('selectItemsPerPage');
  const selectPreviewQuality = document.getElementById('selectPreviewQuality');
  const selectDeepFetchPages = document.getElementById('selectDeepFetchPages');
  const checkProxyThumbnails = document.getElementById('checkProxyThumbnails');
  const checkProxyFullImages = document.getElementById('checkProxyFullImages');
  const checkProxyVideos = document.getElementById('checkProxyVideos');
  const checkProxyDownloads = document.getElementById('checkProxyDownloads');
  const checkProxyVideoDefault = document.getElementById('checkProxyVideoDefault');
  const checkShowVideoStatusBanner = document.getElementById('checkShowVideoStatusBanner');
  const checkVideoAutoplayHover = document.getElementById('checkVideoAutoplayHover');
  const checkVideoAutoplayMobile = document.getElementById('checkVideoAutoplayMobile');
  const checkVideoAutoplayViewer = document.getElementById('checkVideoAutoplayViewer');
  const checkEnableSimilarPosts = document.getElementById('checkEnableSimilarPosts');
  const checkPrioritizeUserTags = document.getElementById('checkPrioritizeUserTags');
  const checkEnablePaheal = document.getElementById('checkEnablePaheal');
  const selectRule34Provider = document.getElementById('selectRule34Provider');

  loadTempTagsFromSettings();

  const checkEnableAliasDiscovery = document.getElementById('checkEnableAliasDiscovery');
  if (checkEnableAliasDiscovery) {
    checkEnableAliasDiscovery.checked = state.settings.enableAliasDiscovery !== false;
  }

  renderSettingsChips();
  renderTasteProfileUI();
  updateStorageUsageInfo();
  updateDiscoveredAliasesUI();

  const customAliasesInput = document.getElementById('customAliasesInput');
  if (customAliasesInput) customAliasesInput.value = state.settings.customAliases || '';

  if (inputRule34ApiKey) inputRule34ApiKey.value = state.settings.rule34ApiKey || '';
  if (inputRule34UserId) inputRule34UserId.value = state.settings.rule34UserId || '';
  if (inputGelbooruApiKey) inputGelbooruApiKey.value = state.settings.gelbooruApiKey || '';
  if (inputGelbooruUserId) inputGelbooruUserId.value = state.settings.gelbooruUserId || '';
  if (inputDanbooruApiKey) inputDanbooruApiKey.value = state.settings.danbooruApiKey || '';
  if (inputDanbooruLogin) inputDanbooruLogin.value = state.settings.danbooruLogin || '';
  if (inputKonachanLogin) inputKonachanLogin.value = state.settings.konachanLogin || '';
  if (inputKonachanPassword) inputKonachanPassword.value = state.settings.konachanPassword || '';
  if (inputYandereLogin) inputYandereLogin.value = state.settings.yandereLogin || '';
  if (inputYanderePassword) inputYanderePassword.value = state.settings.yanderePassword || '';
  if (inputPawchiveSession) inputPawchiveSession.value = state.settings.pawchiveSession || '';
  if (inputKemonoSession) inputKemonoSession.value = state.settings.kemonoSession || '';

  const proxyInputs = [
    { key: 'globalProxy', id: 'inputGlobalProxy' },
    { key: 'danbooruProxy', id: 'inputDanbooruProxy' },
    { key: 'gelbooruProxy', id: 'inputGelbooruProxy' },
    { key: 'rule34Proxy', id: 'inputRule34Proxy' },
    { key: 'yandereProxy', id: 'inputYandereProxy' },
    { key: 'konachanProxy', id: 'inputKonachanProxy' },
    { key: 'safebooruProxy', id: 'inputSafebooruProxy' },
    { key: 'rule34videoProxy', id: 'inputRule34videoProxy' },
    { key: 'pawchiveProxy', id: 'inputPawchiveProxy' },
    { key: 'kemonoProxy', id: 'inputKemonoProxy' },
    { key: 'xbooruProxy', id: 'inputXbooruProxy' },
    { key: 'hypnohubProxy', id: 'inputHypnohubProxy' },
    { key: 'tbibProxy', id: 'inputTbibProxy' }
  ];
  proxyInputs.forEach(({ key, id }) => {
    const el = document.getElementById(id);
    if (el) {
      el.value = state.settings[key] || '';
      if (!el._hasProxyNormalizeListener) {
        el._hasProxyNormalizeListener = true;
        el.addEventListener('blur', () => {
          const val = el.value.trim();
          if (val) {
            const norm = normalizeProxyString(val);
            if (norm && norm !== val) el.value = norm;
          }
        });
      }
    }
  });
  if (selectItemsPerPage) selectItemsPerPage.value = String(state.limit || 40);
  if (selectPreviewQuality) selectPreviewQuality.value = state.settings.previewQuality || 'medium';
  const selectVideoDefaultQualityModal = document.getElementById('selectVideoDefaultQuality');
  if (selectVideoDefaultQualityModal) selectVideoDefaultQualityModal.value = state.settings.videoDefaultQuality || 'original';
  if (checkVideoAutoplayHover) checkVideoAutoplayHover.checked = state.settings.videoAutoplayHover !== false;
  if (checkVideoAutoplayMobile) checkVideoAutoplayMobile.checked = state.settings.videoAutoplayMobile !== false;
  if (checkVideoAutoplayViewer) checkVideoAutoplayViewer.checked = state.settings.videoAutoplayViewer !== false;
  if (checkEnableSimilarPosts) checkEnableSimilarPosts.checked = state.settings.enableSimilarPosts !== false;
  if (checkPrioritizeUserTags) checkPrioritizeUserTags.checked = state.settings.prioritizeUserTags === true;
  if (selectRule34Provider) {
    selectRule34Provider.value = state.settings.rule34Provider || (state.settings.enablePaheal === false ? 'rule34xxx' : 'rule34xxx');
  } else if (checkEnablePaheal) {
    checkEnablePaheal.checked = state.settings.enablePaheal !== false;
  }
  const checkHideZipPostsModal = document.getElementById('checkHideZipPosts');
  if (checkHideZipPostsModal) checkHideZipPostsModal.checked = state.settings.hideZipPosts === true;
  const checkUnpackArchivesModal = document.getElementById('checkUnpackArchivesOnDownload');
  if (checkUnpackArchivesModal) checkUnpackArchivesModal.checked = state.settings.unpackArchivesOnDownload === true;
  const checkGroupAlbumsModal = document.getElementById('checkGroupAlbums');
  if (checkGroupAlbumsModal) checkGroupAlbumsModal.checked = state.settings.groupAlbums !== false;
  const selectArchiveDownloadThreadsModal = document.getElementById('selectArchiveDownloadThreads');
  if (selectArchiveDownloadThreadsModal) selectArchiveDownloadThreadsModal.value = String(state.settings.archiveDownloadThreads || 4);
  const checkEnableJsDemuxingModal = document.getElementById('checkEnableJsDemuxing');
  if (checkEnableJsDemuxingModal) checkEnableJsDemuxingModal.checked = state.settings.enableJsDemuxing !== false;
  if (selectDeepFetchPages) selectDeepFetchPages.value = String(state.settings.deepFetchPages || 1);

  if (checkProxyThumbnails) checkProxyThumbnails.checked = state.settings.proxyThumbnails !== false;
  if (checkProxyFullImages) checkProxyFullImages.checked = state.settings.proxyFullImages !== false;
  if (checkProxyVideos) checkProxyVideos.checked = (state.settings.proxyVideos !== false && state.settings.proxyVideoDefault !== false);
  if (checkProxyDownloads) checkProxyDownloads.checked = state.settings.proxyDownloads !== false;
  if (checkProxyVideoDefault) checkProxyVideoDefault.checked = (state.settings.proxyVideos !== false && state.settings.proxyVideoDefault !== false);
  if (checkShowVideoStatusBanner) checkShowVideoStatusBanner.checked = state.settings.showVideoStatusBanner !== false;

  const selectMaxServerCacheModal = document.getElementById('selectMaxServerCache');
  if (selectMaxServerCacheModal && state.settings.maxServerCacheMb !== undefined) {
    selectMaxServerCacheModal.value = String(state.settings.maxServerCacheMb);
  }

  const selectRecommendationMode = document.getElementById('selectRecommendationMode');
  if (selectRecommendationMode) selectRecommendationMode.value = state.settings.recommendationMode || 'tags-only';

  // Update per-site sort tags
  loadTempSiteSortTags();

  // Open the General tab by default
  loadTempSiteMediaProxy();
  renderSiteMediaProxyUI();
  switchSettingsTab('general');

  if (settingsModal && settingsModal.style.display !== 'none') return;
  if (settingsModal) settingsModal.style.display = 'flex';
  document.body.classList.add('settings-open');
  lockBodyScroll();
  document.querySelectorAll('.mobile-nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.nav === 'settings');
  });
}

export function closeSettingsModal() {
  const settingsModal = document.getElementById('settingsModal');
  const wasOpen = settingsModal && settingsModal.style.display !== 'none';
  if (settingsModal) settingsModal.style.display = 'none';
  if (wasOpen) {
    document.body.classList.remove('settings-open');
    unlockBodyScroll();
  }
  updateCategoryTabsUI();
  document.dispatchEvent(new CustomEvent('booru:settings-closed'));
}

// PWA install prompt: the button lives in the lazily injected settings
// markup, so the prompt event is captured at module load — it usually fires
// long before the user first opens the settings.
let deferredInstallPrompt = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const group = document.getElementById('pwaInstallGroup');
    if (group) group.style.display = 'block';
  });
}

function bindPwaInstallControls() {
  const group = document.getElementById('pwaInstallGroup');
  if (deferredInstallPrompt && group) group.style.display = 'block';
  const btnInstallPwa = document.getElementById('btnInstallPwa');
  if (btnInstallPwa) {
    btnInstallPwa.addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') {
          showToast(t('app.pwaInstalling', 'Приложение Booru Explorer устанавливается'));
          if (group) group.style.display = 'none';
        }
        deferredInstallPrompt = null;
      } else {
        showToast(t('app.pwaManualInstall', 'Для установки нажмите «На экран "Домой"» в меню браузера'));
      }
    });
  }
}

export function initSettingsModal({ onSettingsChanged, onDataImported, onUpdateFavoritesBadge }) {
  ensureSettingsMarkup();
  bindPwaInstallControls();
  initNotificationSettingsControls();
  const btnSettings = document.getElementById('btnSettings');
  const btnCloseSettings = document.getElementById('btnCloseSettings');
  const settingsBackdrop = document.getElementById('settingsBackdrop');
  const btnSaveSettings = document.getElementById('btnSaveSettings');
  const btnResetSettings = document.getElementById('btnResetSettings');

  // Tab switching
  document.querySelectorAll('.settings-nav-tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      const tabId = tabBtn.dataset.tab;
      if (tabId) switchSettingsTab(tabId);
    });
  });

  const btnProfileSettings = document.getElementById('btnProfileSettings');
  if (btnSettings) btnSettings.addEventListener('click', openSettingsModal);
  if (btnProfileSettings) btnProfileSettings.addEventListener('click', openSettingsModal);
  if (btnCloseSettings) btnCloseSettings.addEventListener('click', closeSettingsModal);
  if (settingsBackdrop) settingsBackdrop.addEventListener('click', closeSettingsModal);

  // Per-tab controls, each owning its own DOM wiring and temp state
  initSiteSortEditor();
  initTagListInputs();
  initTasteProfileControls({ onSettingsChanged });
  initStorageBackup({ applySettingsToUIAndState, onDataImported, onUpdateFavoritesBadge });
  initCredentialTests();
  initProxyTests();

  document.querySelectorAll('.btn-theme[data-theme-val]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-theme[data-theme-val]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const themeVal = btn.dataset.themeVal || 'kotobox';
      document.documentElement.setAttribute('data-theme', themeVal);
      syncThemeColor();
      state.settings.theme = themeVal;
      saveLocalSettings(state.settings);
    });
  });

  // Language switcher: applies instantly and persists in localStorage (i18n.setLang)
  document.querySelectorAll('#langOptions .btn-theme').forEach(btn => {
    btn.addEventListener('click', () => {
      const langVal = btn.dataset.langVal === 'en' ? 'en' : 'ru';
      setLang(langVal);
      document.querySelectorAll('#langOptions .btn-theme').forEach(b => b.classList.toggle('active', b.dataset.langVal === langVal));
    });
  });
  // Reflect the saved language in the switcher on open
  document.querySelectorAll('#langOptions .btn-theme').forEach(b => {
    b.classList.toggle('active', (b.dataset.langVal === 'en') === (getLang() === 'en'));
  });

  if (btnSaveSettings) {
    btnSaveSettings.addEventListener('click', async () => {
      const activeThemeBtn = document.querySelector('.btn-theme[data-theme-val].active');
      const theme = activeThemeBtn ? activeThemeBtn.dataset.themeVal : 'kotobox';

      const selectItemsPerPage = document.getElementById('selectItemsPerPage');
      const selectPreviewQuality = document.getElementById('selectPreviewQuality');
      const selectVideoDefaultQuality = document.getElementById('selectVideoDefaultQuality');
      const checkVideoAutoplayHover = document.getElementById('checkVideoAutoplayHover');
      const checkVideoAutoplayMobile = document.getElementById('checkVideoAutoplayMobile');
      const checkVideoAutoplayViewer = document.getElementById('checkVideoAutoplayViewer');
      const checkEnableSimilarPosts = document.getElementById('checkEnableSimilarPosts');
      const checkProxyThumbnails = document.getElementById('checkProxyThumbnails');
      const checkProxyFullImages = document.getElementById('checkProxyFullImages');
      const checkProxyVideos = document.getElementById('checkProxyVideos');
      const checkProxyDownloads = document.getElementById('checkProxyDownloads');
      const checkProxyVideoDefault = document.getElementById('checkProxyVideos') || document.getElementById('checkProxyVideoDefault');
      const checkShowVideoStatusBanner = document.getElementById('checkShowVideoStatusBanner');

      const itemsPerPageVal = selectItemsPerPage ? (parseInt(selectItemsPerPage.value, 10) || 40) : 40;
      const previewQualityVal = selectPreviewQuality ? selectPreviewQuality.value : 'medium';
      const videoAutoplayHoverVal = checkVideoAutoplayHover ? checkVideoAutoplayHover.checked : true;
      const videoAutoplayMobileVal = checkVideoAutoplayMobile ? checkVideoAutoplayMobile.checked : true;
      const videoAutoplayViewerVal = checkVideoAutoplayViewer ? checkVideoAutoplayViewer.checked : true;
      const enableSimilarPostsVal = checkEnableSimilarPosts ? checkEnableSimilarPosts.checked : true;
      
      const proxyThumbnailsVal = checkProxyThumbnails ? checkProxyThumbnails.checked : true;
      const proxyFullImagesVal = checkProxyFullImages ? checkProxyFullImages.checked : true;
      const proxyVideosVal = checkProxyVideos ? checkProxyVideos.checked : (checkProxyVideoDefault ? checkProxyVideoDefault.checked : true);
      const proxyDownloadsVal = checkProxyDownloads ? checkProxyDownloads.checked : true;
      const proxyVideoDefaultVal = proxyVideosVal;
      const showVideoStatusBannerVal = checkShowVideoStatusBanner ? checkShowVideoStatusBanner.checked : true;
      
      const selectDeepFetchPages = document.getElementById('selectDeepFetchPages');
      const deepFetchPagesVal = selectDeepFetchPages ? (parseInt(selectDeepFetchPages.value, 10) || 1) : 1;

      const checkPrioritizeUserTags = document.getElementById('checkPrioritizeUserTags');
      const prioritizeUserTagsVal = checkPrioritizeUserTags ? checkPrioritizeUserTags.checked : false;

      const selectRule34Provider = document.getElementById('selectRule34Provider');
      const checkEnablePaheal = document.getElementById('checkEnablePaheal');
      const rule34ProviderVal = selectRule34Provider 
        ? selectRule34Provider.value 
        : (checkEnablePaheal && !checkEnablePaheal.checked ? 'rule34xxx' : 'rule34xxx');
      const enablePahealVal = rule34ProviderVal === 'paheal';

      const checkEnableJsDemuxing = document.getElementById('checkEnableJsDemuxing');
      const enableJsDemuxingVal = checkEnableJsDemuxing ? checkEnableJsDemuxing.checked : true;

      const checkHideZipPosts = document.getElementById('checkHideZipPosts');
      const hideZipPostsVal = checkHideZipPosts ? checkHideZipPosts.checked : false;

      const checkUnpackArchives = document.getElementById('checkUnpackArchivesOnDownload');
      const unpackArchivesOnDownloadVal = checkUnpackArchives ? checkUnpackArchives.checked : false;

      const selectArchiveDownloadThreads = document.getElementById('selectArchiveDownloadThreads');
      const archiveDownloadThreadsVal = selectArchiveDownloadThreads ? (parseInt(selectArchiveDownloadThreads.value, 10) || 4) : 4;

      const checkGroupAlbums = document.getElementById('checkGroupAlbums');
      const groupAlbumsVal = checkGroupAlbums ? checkGroupAlbums.checked : true;

      const inputRule34ApiKey = document.getElementById('inputRule34ApiKey');
      const inputRule34UserId = document.getElementById('inputRule34UserId');
      const inputGelbooruApiKey = document.getElementById('inputGelbooruApiKey');
      const inputGelbooruUserId = document.getElementById('inputGelbooruUserId');
      const inputDanbooruApiKey = document.getElementById('inputDanbooruApiKey');
      const inputDanbooruLogin = document.getElementById('inputDanbooruLogin');
      const inputKonachanLogin = document.getElementById('inputKonachanLogin');
      const inputKonachanPassword = document.getElementById('inputKonachanPassword');
      const inputYandereLogin = document.getElementById('inputYandereLogin');
      const inputYanderePassword = document.getElementById('inputYanderePassword');
      const inputPawchiveSession = document.getElementById('inputPawchiveSession');
      const inputKemonoSession = document.getElementById('inputKemonoSession');

      const checkTgEnabled = document.getElementById('checkTelegramBackupEnabled');
      const inputTgToken = document.getElementById('inputTelegramBotToken');
      const inputTgChat = document.getElementById('inputTelegramChatId');
      const selectTgInterval = document.getElementById('selectTelegramBackupInterval');
      const selectMaxServerCache = document.getElementById('selectMaxServerCache');
      const maxServerCacheMbVal = selectMaxServerCache ? (parseInt(selectMaxServerCache.value, 10)) : (state.settings.maxServerCacheMb !== undefined ? state.settings.maxServerCacheMb : 1500);

      const tags = getTempTags();
      const updated = {
        ...state.settings,
        theme,
        itemsPerPage: itemsPerPageVal,
        previewQuality: previewQualityVal,
        videoDefaultQuality: selectVideoDefaultQuality ? selectVideoDefaultQuality.value : 'original',
        videoAutoplayHover: videoAutoplayHoverVal,
        videoAutoplayMobile: videoAutoplayMobileVal,
        videoAutoplayViewer: videoAutoplayViewerVal,
        enableSimilarPosts: enableSimilarPostsVal,
        proxyThumbnails: proxyThumbnailsVal,
        proxyFullImages: proxyFullImagesVal,
        proxyVideos: proxyVideosVal,
        proxyDownloads: proxyDownloadsVal,
        proxyVideoDefault: proxyVideoDefaultVal,
        showVideoStatusBanner: showVideoStatusBannerVal,
        blacklist: tags.blacklist,
        aiTags: tags.aiTags,
        curvyTags: tags.curvyTags,
        petiteTags: tags.petiteTags,
        furryTags: tags.furryTags,
        pregnantTags: tags.pregnantTags,
        lgbtTags: tags.lgbtTags,
        maxServerCacheMb: maxServerCacheMbVal,
        rule34ApiKey: inputRule34ApiKey ? inputRule34ApiKey.value.trim() : '',
        rule34UserId: inputRule34UserId ? inputRule34UserId.value.trim() : '',
        gelbooruApiKey: inputGelbooruApiKey ? inputGelbooruApiKey.value.trim() : '',
        gelbooruUserId: inputGelbooruUserId ? inputGelbooruUserId.value.trim() : '',
        danbooruApiKey: inputDanbooruApiKey ? inputDanbooruApiKey.value.trim() : '',
        danbooruLogin: inputDanbooruLogin ? inputDanbooruLogin.value.trim() : '',
        konachanLogin: inputKonachanLogin ? inputKonachanLogin.value.trim() : '',
        konachanPassword: inputKonachanPassword ? inputKonachanPassword.value.trim() : '',
        yandereLogin: inputYandereLogin ? inputYandereLogin.value.trim() : '',
        yanderePassword: inputYanderePassword ? inputYanderePassword.value.trim() : '',
        pawchiveSession: inputPawchiveSession ? inputPawchiveSession.value.trim() : '',
        kemonoSession: inputKemonoSession ? inputKemonoSession.value.trim() : '',
        globalProxy: normalizeProxyString(document.getElementById('inputGlobalProxy')?.value.trim() || ''),
        danbooruProxy: normalizeProxyString(document.getElementById('inputDanbooruProxy')?.value.trim() || ''),
        gelbooruProxy: normalizeProxyString(document.getElementById('inputGelbooruProxy')?.value.trim() || ''),
        rule34Proxy: normalizeProxyString(document.getElementById('inputRule34Proxy')?.value.trim() || ''),
        yandereProxy: normalizeProxyString(document.getElementById('inputYandereProxy')?.value.trim() || ''),
        konachanProxy: normalizeProxyString(document.getElementById('inputKonachanProxy')?.value.trim() || ''),
        safebooruProxy: normalizeProxyString(document.getElementById('inputSafebooruProxy')?.value.trim() || ''),
        rule34videoProxy: normalizeProxyString(document.getElementById('inputRule34videoProxy')?.value.trim() || ''),
        pawchiveProxy: normalizeProxyString(document.getElementById('inputPawchiveProxy')?.value.trim() || ''),
        kemonoProxy: normalizeProxyString(document.getElementById('inputKemonoProxy')?.value.trim() || ''),
        xbooruProxy: normalizeProxyString(document.getElementById('inputXbooruProxy')?.value.trim() || ''),
        hypnohubProxy: normalizeProxyString(document.getElementById('inputHypnohubProxy')?.value.trim() || ''),
        tbibProxy: normalizeProxyString(document.getElementById('inputTbibProxy')?.value.trim() || ''),
        telegramBackupEnabled: checkTgEnabled ? checkTgEnabled.checked : false,
        telegramBotToken: inputTgToken ? inputTgToken.value.trim() : '',
        telegramChatId: inputTgChat ? inputTgChat.value.trim() : '',
        telegramBackupInterval: selectTgInterval ? selectTgInterval.value : 'daily',
        deepFetchPages: deepFetchPagesVal,
        prioritizeUserTags: prioritizeUserTagsVal,
        rule34Provider: rule34ProviderVal,
        enablePaheal: enablePahealVal,
        enableJsDemuxing: enableJsDemuxingVal,
        hideZipPosts: hideZipPostsVal,
        unpackArchivesOnDownload: unpackArchivesOnDownloadVal,
        archiveDownloadThreads: archiveDownloadThreadsVal,
        groupAlbums: groupAlbumsVal,
        recommendationMode: document.getElementById('selectRecommendationMode')?.value || 'tags-only',
        enableRecommendations: document.getElementById('selectRecommendationMode')?.value !== 'off',
        recommendationEnableSkipPenalty: document.getElementById('checkRecSkipPenalty')?.checked !== false,
        siteSortTags: getTempSiteSortTags(),
        customAliases: document.getElementById('customAliasesInput')?.value || '',
        enableAliasDiscovery: document.getElementById('checkEnableAliasDiscovery')?.checked !== false,
        ignoredAliases: tags.ignoredAliases,
        siteMediaProxy: getTempSiteMediaProxy()
      };

      saveLocalSettings(updated);

      try {
        const res = await saveSettings(updated);
        if (res && res.success) {
          state.settings = { ...updated, ...res.settings };
          state.limit = itemsPerPageVal;
          saveLocalSettings(state.settings);
          closeSettingsModal();
          showToast(t('set.saved', 'Настройки сохранены'));
          if (onSettingsChanged) onSettingsChanged();
        }
      } catch (err) {
        state.settings = updated;
        state.limit = itemsPerPageVal;
        closeSettingsModal();
        showToast(t('set.savedLocally', 'Настройки сохранены в браузере'));
        if (onSettingsChanged) onSettingsChanged();
      }
    });
  }

  if (btnResetSettings) {
    btnResetSettings.addEventListener('click', async () => {
      resetTempSiteMediaProxy();
      resetTempTagsToDefaults();
      
      const inputRule34ApiKey = document.getElementById('inputRule34ApiKey');
      const inputRule34UserId = document.getElementById('inputRule34UserId');
      const inputGelbooruApiKey = document.getElementById('inputGelbooruApiKey');
      const inputGelbooruUserId = document.getElementById('inputGelbooruUserId');
      const inputDanbooruApiKey = document.getElementById('inputDanbooruApiKey');
      const inputDanbooruLogin = document.getElementById('inputDanbooruLogin');
      const inputKonachanLogin = document.getElementById('inputKonachanLogin');
      const inputKonachanPassword = document.getElementById('inputKonachanPassword');
      const inputYandereLogin = document.getElementById('inputYandereLogin');
      const inputYanderePassword = document.getElementById('inputYanderePassword');
      const inputPawchiveSession = document.getElementById('inputPawchiveSession');
      const inputKemonoSession = document.getElementById('inputKemonoSession');
      const selectPreviewQuality = document.getElementById('selectPreviewQuality');
      const checkVideoAutoplayHover = document.getElementById('checkVideoAutoplayHover');
      const checkVideoAutoplayMobile = document.getElementById('checkVideoAutoplayMobile');
      const checkVideoAutoplayViewer = document.getElementById('checkVideoAutoplayViewer');
      const checkEnableSimilarPosts = document.getElementById('checkEnableSimilarPosts');
      const checkEnablePaheal = document.getElementById('checkEnablePaheal');
      const checkEnableJsDemuxing = document.getElementById('checkEnableJsDemuxing');
      const selectMaxServerCache = document.getElementById('selectMaxServerCache');

      const checkTgEnabled = document.getElementById('checkTelegramBackupEnabled');
      const inputTgToken = document.getElementById('inputTelegramBotToken');
      const inputTgChat = document.getElementById('inputTelegramChatId');
      const selectTgInterval = document.getElementById('selectTelegramBackupInterval');
      const telegramBackupForm = document.getElementById('telegramBackupForm');

      if (inputRule34ApiKey) inputRule34ApiKey.value = '';
      if (inputRule34UserId) inputRule34UserId.value = '';
      if (inputGelbooruApiKey) inputGelbooruApiKey.value = '';
      if (inputGelbooruUserId) inputGelbooruUserId.value = '';
      if (inputDanbooruApiKey) inputDanbooruApiKey.value = '';
      if (inputDanbooruLogin) inputDanbooruLogin.value = '';
      if (inputKonachanLogin) inputKonachanLogin.value = '';
      if (inputKonachanPassword) inputKonachanPassword.value = '';
      if (inputYandereLogin) inputYandereLogin.value = '';
      if (inputYanderePassword) inputYanderePassword.value = '';
      if (inputPawchiveSession) inputPawchiveSession.value = '';
      if (inputKemonoSession) inputKemonoSession.value = '';
      const proxyInputIds = [
        'inputGlobalProxy', 'inputDanbooruProxy', 'inputGelbooruProxy', 'inputRule34Proxy',
        'inputYandereProxy', 'inputKonachanProxy', 'inputSafebooruProxy', 'inputRule34videoProxy',
        'inputPawchiveProxy', 'inputKemonoProxy', 'inputXbooruProxy', 'inputHypnohubProxy', 'inputTbibProxy'
      ];
      proxyInputIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      if (inputTgToken) inputTgToken.value = '';
      if (inputTgChat) inputTgChat.value = '';
      if (checkTgEnabled) checkTgEnabled.checked = false;
      if (selectTgInterval) selectTgInterval.value = 'daily';
      if (telegramBackupForm) telegramBackupForm.classList.add('is-disabled');
      if (selectPreviewQuality) selectPreviewQuality.value = 'medium';
      const selectVideoDefaultQualityReset = document.getElementById('selectVideoDefaultQuality');
      if (selectVideoDefaultQualityReset) selectVideoDefaultQualityReset.value = 'original';
      if (checkVideoAutoplayHover) checkVideoAutoplayHover.checked = true;
      if (checkVideoAutoplayMobile) checkVideoAutoplayMobile.checked = true;
      if (checkVideoAutoplayViewer) checkVideoAutoplayViewer.checked = true;
      if (checkEnableSimilarPosts) checkEnableSimilarPosts.checked = true;
      const selectRule34ProviderReset = document.getElementById('selectRule34Provider');
      if (selectRule34ProviderReset) selectRule34ProviderReset.value = 'rule34xxx';
      if (checkEnablePaheal) checkEnablePaheal.checked = true;
      if (checkEnableJsDemuxing) checkEnableJsDemuxing.checked = true;
      if (selectMaxServerCache) selectMaxServerCache.value = '1500';
      const checkEnableAliasDiscovery = document.getElementById('checkEnableAliasDiscovery');
      if (checkEnableAliasDiscovery) checkEnableAliasDiscovery.checked = true;
      const customAliasesInput = document.getElementById('customAliasesInput');
      if (customAliasesInput) customAliasesInput.value = '';
      resetTempSiteSortTags();
      renderSettingsChips();
      updateTelegramBackupStatusUI({
        telegramBackupEnabled: false,
        telegramBotToken: '',
        telegramChatId: '',
        telegramBackupInterval: 'daily',
        telegramLastBackupAt: null
      });
      const resetTags = getTempTags();
      saveLocalSettings({
        blacklist: resetTags.blacklist,
        aiTags: resetTags.aiTags,
        curvyTags: resetTags.curvyTags,
        petiteTags: resetTags.petiteTags,
        customAliases: '',
        enableAliasDiscovery: true,
        ignoredAliases: [],
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
        telegramBackupEnabled: false,
        telegramBotToken: '',
        telegramChatId: '',
        telegramBackupInterval: 'daily',
        telegramLastBackupAt: null,
        enableJsDemuxing: true,
        siteSortTags: {}
      });
      showToast(t('set.allReset', 'Значения сброшены к стандартным'));
    });
  }
}

