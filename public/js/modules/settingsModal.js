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
  syncFavoriteAuthors,
  testTelegramConnection,
  sendTelegramBackupNow,
  fetchTelegramBackupStatus
} from '../api.js';
import { showToast, formatBytes } from './uiUtils.js';
import { updateCategoryTabsUI, updateAiFilterUI, updateRatingFilterUI, updateTypeFilterUI, updateAgeFilterUI } from './filtersUI.js';

export const DEFAULT_AI_TAGS = [
  'ai_generated',
  'ai_art',
  'novelai',
  'stable_diffusion',
  'midjourney',
  'dall-e',
  'dall-e_3',
  'synthetic',
  'ai_assisted',
  'source_ai',
  'ai-generated',
  'generated_by_ai',
  'nai',
  'sd_xl',
  'comfyui',
  'pony_diffusion',
  'flux.1',
  'created_by_ai',
  'image_generation_model'
];

export const DEFAULT_BLACKLIST = [
  'guro',
  'scat',
  'snuff',
  'vomit',
  'fart'
];

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

export const DEFAULT_FURRY_TAGS = [
  'furry',
  'anthro',
  'feral',
  'scalie',
  'animal_humanoid',
  'beast',
  'kemono',
  'furry_male',
  'furry_female',
  'anthro_female',
  'anthro_male',
  'furred',
  'canine',
  'feline',
  'e621'
];

export const DEFAULT_PREGNANT_TAGS = [
  'pregnant',
  'pregnancy',
  'hyper_pregnancy',
  'impregnation',
  'inflation',
  'belly_expansion',
  'maternity',
  'pregnant_belly',
  'birthing',
  'unbirth',
  'oviposition'
];

export const DEFAULT_LGBT_TAGS = [
  'yaoi',
  'gay',
  'bara',
  'males_only',
  'male_only',
  'male_on_male',
  'multiple_males',
  'shounen_ai',
  'boys_love',
  'dansei_shounen_ai',
  'otoko_no_ko',
  'femboy',
  'crossdressing',
  'trap',
  'futanari',
  'dickgirl',
  'futa',
  'shemale',
  'newhalf',
  'transgender',
  'trans_woman',
  'trans_man',
  'gender_bender',
  'genderswap',
  'yuri',
  'lesbian',
  'shoujo_ai',
  'girls_love',
  'lgbt',
  'lgbtq'
];

let tempBlacklist = [];
let tempAiTags = [];
let tempCurvyTags = [];
let tempPetiteTags = [];
let tempFurryTags = [];
let tempPregnantTags = [];
let tempLgbtTags = [];

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

  const selectMaxServerCache = document.getElementById('selectMaxServerCache');
  if (selectMaxServerCache && s.maxServerCacheMb !== undefined) {
    selectMaxServerCache.value = String(s.maxServerCacheMb);
  }

  // Telegram автобэкап
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

export function updateTelegramBackupStatusUI(s = state.settings) {
  const statusDot = document.getElementById('telegramStatusDot');
  const statusText = document.getElementById('telegramStatusText');
  if (!statusText || !statusDot) return;

  const hasConfig = !!(s?.telegramBotToken && s?.telegramChatId);
  const isEnabled = !!s?.telegramBackupEnabled;
  const lastBackup = s?.telegramLastBackupAt;

  if (!hasConfig) {
    statusDot.className = 'tg-status-dot dot-idle';
    statusText.textContent = 'Бот не настроен (введите Token и Chat ID)';
  } else if (!isEnabled) {
    statusDot.className = 'tg-status-dot dot-paused';
    statusText.textContent = 'Автобэкап выключен (доступна ручная отправка)';
  } else {
    statusDot.className = 'tg-status-dot dot-active';
    if (lastBackup) {
      const d = new Date(lastBackup);
      const dateStr = d.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      statusText.textContent = `Активен. Последний бэкап: ${dateStr}`;
    } else {
      statusText.textContent = 'Активен. Ожидание первого автобэкапа';
    }
  }
}

export function persistSettings(partial) {
  state.settings = { ...state.settings, ...partial };
  saveLocalSettings(state.settings);
  saveSettings(state.settings).catch(() => {});
}

function renderChipsForGroup(wrapperEl, inputEl, tagList, onRemove) {
  if (!wrapperEl || !inputEl) return;
  wrapperEl.querySelectorAll('.tag-chip').forEach(c => c.remove());
  tagList.forEach(tag => {
    const chip = document.createElement('div');
    chip.className = 'tag-chip';
    chip.innerHTML = `
      <span>${tag}</span>
      <span class="tag-chip-remove">×</span>
    `;
    chip.querySelector('.tag-chip-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      onRemove(tag);
    });
    wrapperEl.insertBefore(chip, inputEl);
  });
}

export function renderSettingsChips() {
  renderChipsForGroup(
    document.getElementById('blacklistWrapper'),
    document.getElementById('blacklistInput'),
    tempBlacklist,
    (tag) => { tempBlacklist = tempBlacklist.filter(t => t !== tag); renderSettingsChips(); }
  );

  renderChipsForGroup(
    document.getElementById('aiTagsWrapper'),
    document.getElementById('aiTagsInput'),
    tempAiTags,
    (tag) => { tempAiTags = tempAiTags.filter(t => t !== tag); renderSettingsChips(); }
  );

  renderChipsForGroup(
    document.getElementById('curvyTagsWrapper'),
    document.getElementById('curvyTagsInput'),
    tempCurvyTags,
    (tag) => { tempCurvyTags = tempCurvyTags.filter(t => t !== tag); renderSettingsChips(); }
  );

  renderChipsForGroup(
    document.getElementById('petiteTagsWrapper'),
    document.getElementById('petiteTagsInput'),
    tempPetiteTags,
    (tag) => { tempPetiteTags = tempPetiteTags.filter(t => t !== tag); renderSettingsChips(); }
  );

  renderChipsForGroup(
    document.getElementById('furryTagsWrapper'),
    document.getElementById('furryTagsInput'),
    tempFurryTags,
    (tag) => { tempFurryTags = tempFurryTags.filter(t => t !== tag); renderSettingsChips(); }
  );

  renderChipsForGroup(
    document.getElementById('pregnantTagsWrapper'),
    document.getElementById('pregnantTagsInput'),
    tempPregnantTags,
    (tag) => { tempPregnantTags = tempPregnantTags.filter(t => t !== tag); renderSettingsChips(); }
  );

  renderChipsForGroup(
    document.getElementById('lgbtTagsWrapper'),
    document.getElementById('lgbtTagsInput'),
    tempLgbtTags,
    (tag) => { tempLgbtTags = tempLgbtTags.filter(t => t !== tag); renderSettingsChips(); }
  );
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
  let maxServerCacheMb = (state.settings.maxServerCacheMb !== undefined) ? Number(state.settings.maxServerCacheMb) : 1500;
  try {
    const data = await fetchCacheInfo();
    if (data && data.success) {
      serverCacheBytes = data.diskCacheBytes || 0;
    }
  } catch {}

  const selectMaxServerCache = document.getElementById('selectMaxServerCache');
  if (selectMaxServerCache && maxServerCacheMb !== undefined) {
    selectMaxServerCache.value = String(maxServerCacheMb);
  }

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
  if (storageServerCacheText) {
    const formattedLimit = maxServerCacheMb > 0 
      ? (maxServerCacheMb >= 1000 ? (maxServerCacheMb / 1000).toFixed(1).replace('.0', '') + ' ГБ' : maxServerCacheMb + ' МБ')
      : null;
    const limitLabel = formattedLimit ? ` / ${formattedLimit}` : ' (Без лимита)';
    storageServerCacheText.textContent = `${formatBytes(serverCacheBytes)}${limitLabel}`;
  }
  const storageLimitBadge = document.getElementById('storageLimitBadge');
  if (storageLimitBadge) {
    storageLimitBadge.textContent = maxServerCacheMb > 0 
      ? (maxServerCacheMb >= 1000 ? (maxServerCacheMb / 1000).toFixed(1).replace('.0', '') + ' ГБ' : maxServerCacheMb + ' МБ')
      : 'Без лимита';
  }
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
    : [...DEFAULT_BLACKLIST];

  tempAiTags = Array.isArray(state.settings.aiTags) && state.settings.aiTags.length > 0 
    ? [...state.settings.aiTags] 
    : [...DEFAULT_AI_TAGS];

  tempCurvyTags = Array.isArray(state.settings.curvyTags) && state.settings.curvyTags.length > 0 
    ? [...state.settings.curvyTags] 
    : [...DEFAULT_CURVY_TAGS];

  tempPetiteTags = Array.isArray(state.settings.petiteTags) && state.settings.petiteTags.length > 0 
    ? [...state.settings.petiteTags] 
    : [...DEFAULT_PETITE_TAGS];

  tempFurryTags = Array.isArray(state.settings.furryTags) && state.settings.furryTags.length > 0 
    ? [...state.settings.furryTags] 
    : [...DEFAULT_FURRY_TAGS];

  tempPregnantTags = Array.isArray(state.settings.pregnantTags) && state.settings.pregnantTags.length > 0 
    ? [...state.settings.pregnantTags] 
    : [...DEFAULT_PREGNANT_TAGS];

  tempLgbtTags = Array.isArray(state.settings.lgbtTags) && state.settings.lgbtTags.length > 0 
    ? [...state.settings.lgbtTags] 
    : [...DEFAULT_LGBT_TAGS];

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

  const selectMaxServerCacheModal = document.getElementById('selectMaxServerCache');
  if (selectMaxServerCacheModal && state.settings.maxServerCacheMb !== undefined) {
    selectMaxServerCacheModal.value = String(state.settings.maxServerCacheMb);
  }

  const currentTheme = document.documentElement.getAttribute('data-theme') || 'kotobox';
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

  const btnProfileSettings = document.getElementById('btnProfileSettings');
  if (btnSettings) btnSettings.addEventListener('click', openSettingsModal);
  if (btnProfileSettings) btnProfileSettings.addEventListener('click', openSettingsModal);
  if (btnCloseSettings) btnCloseSettings.addEventListener('click', closeSettingsModal);
  if (settingsBackdrop) settingsBackdrop.addEventListener('click', closeSettingsModal);

  // Универсальный обработчик ввода тегов для групп
  const setupTagInput = (inputId, wrapperId, getList, setList) => {
    const input = document.getElementById(inputId);
    const wrapper = document.getElementById(wrapperId);
    if (!input) return;

    if (wrapper) {
      wrapper.addEventListener('click', (e) => {
        if (e.target === wrapper) {
          input.focus();
        }
      });
    }

    input.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ',') && input.value.trim()) {
        e.preventDefault();
        const raw = input.value.trim().toLowerCase();
        const tokens = raw.split(/[, ]+/).map(t => t.trim().replace(/\s+/g, '_')).filter(Boolean);
        let list = getList();
        let changed = false;
        tokens.forEach(val => {
          if (val && !list.includes(val)) {
            list.push(val);
            changed = true;
          }
        });
        if (changed) {
          setList(list);
          renderSettingsChips();
        }
        input.value = '';
      } else if (e.key === 'Backspace' && !input.value) {
        let list = getList();
        if (list.length > 0) {
          list.pop();
          setList(list);
          renderSettingsChips();
        }
      }
    });
  };

  setupTagInput('blacklistInput', 'blacklistWrapper', () => tempBlacklist, (l) => { tempBlacklist = l; });
  setupTagInput('aiTagsInput', 'aiTagsWrapper', () => tempAiTags, (l) => { tempAiTags = l; });
  setupTagInput('curvyTagsInput', 'curvyTagsWrapper', () => tempCurvyTags, (l) => { tempCurvyTags = l; });
  setupTagInput('petiteTagsInput', 'petiteTagsWrapper', () => tempPetiteTags, (l) => { tempPetiteTags = l; });
  setupTagInput('furryTagsInput', 'furryTagsWrapper', () => tempFurryTags, (l) => { tempFurryTags = l; });
  setupTagInput('pregnantTagsInput', 'pregnantTagsWrapper', () => tempPregnantTags, (l) => { tempPregnantTags = l; });
  setupTagInput('lgbtTagsInput', 'lgbtTagsWrapper', () => tempLgbtTags, (l) => { tempLgbtTags = l; });

  // Кнопки сброса к значениям по умолчанию
  const btnResetBlacklist = document.getElementById('btnResetBlacklist');
  if (btnResetBlacklist) {
    btnResetBlacklist.addEventListener('click', () => {
      tempBlacklist = [...DEFAULT_BLACKLIST];
      renderSettingsChips();
      showToast('Черный список сброшен к стандартному');
    });
  }

  const btnResetAiTags = document.getElementById('btnResetAiTags');
  if (btnResetAiTags) {
    btnResetAiTags.addEventListener('click', () => {
      tempAiTags = [...DEFAULT_AI_TAGS];
      renderSettingsChips();
      showToast('Теги ИИ сброшены к стандартным');
    });
  }

  const btnResetCurvyTags = document.getElementById('btnResetCurvyTags');
  if (btnResetCurvyTags) {
    btnResetCurvyTags.addEventListener('click', () => {
      tempCurvyTags = [...DEFAULT_CURVY_TAGS];
      renderSettingsChips();
      showToast('Слова для «Пышные» сброшены к стандартным');
    });
  }

  const btnResetPetiteTags = document.getElementById('btnResetPetiteTags');
  if (btnResetPetiteTags) {
    btnResetPetiteTags.addEventListener('click', () => {
      tempPetiteTags = [...DEFAULT_PETITE_TAGS];
      renderSettingsChips();
      showToast('Слова для «Миниатюрные» сброшены к стандартным');
    });
  }

  const btnResetFurryTags = document.getElementById('btnResetFurryTags');
  if (btnResetFurryTags) {
    btnResetFurryTags.addEventListener('click', () => {
      tempFurryTags = [...DEFAULT_FURRY_TAGS];
      renderSettingsChips();
      showToast('Слова для «Фурри» сброшены к стандартным');
    });
  }

  const btnResetPregnantTags = document.getElementById('btnResetPregnantTags');
  if (btnResetPregnantTags) {
    btnResetPregnantTags.addEventListener('click', () => {
      tempPregnantTags = [...DEFAULT_PREGNANT_TAGS];
      renderSettingsChips();
      showToast('Слова для «Беременность» сброшены к стандартным');
    });
  }

  const btnResetLgbtTags = document.getElementById('btnResetLgbtTags');
  if (btnResetLgbtTags) {
    btnResetLgbtTags.addEventListener('click', () => {
      tempLgbtTags = [...DEFAULT_LGBT_TAGS];
      renderSettingsChips();
      showToast('Слова для «ЛГБТ» сброшены к стандартным');
    });
  }

  if (btnRefreshStorage) btnRefreshStorage.addEventListener('click', updateStorageUsageInfo);
  if (btnClearStorageBtn) btnClearStorageBtn.addEventListener('click', handleClearStorageCache);

  const selectMaxServerCache = document.getElementById('selectMaxServerCache');
  if (selectMaxServerCache) {
    selectMaxServerCache.addEventListener('change', () => {
      const val = parseInt(selectMaxServerCache.value, 10);
      state.settings.maxServerCacheMb = val;
      persistSettings({ maxServerCacheMb: val });
      updateStorageUsageInfo();
      showToast(`Лимит серверного кэша: ${val > 0 ? (val >= 1000 ? (val / 1000).toFixed(1) + ' ГБ' : val + ' МБ') : 'Без ограничений'}`);
    });
  }

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

  // Telegram Автобэкап события
  const checkTelegramBackupEnabled = document.getElementById('checkTelegramBackupEnabled');
  const telegramBackupForm = document.getElementById('telegramBackupForm');
  const btnTestTelegram = document.getElementById('btnTestTelegram');
  const btnSendTelegramBackup = document.getElementById('btnSendTelegramBackup');

  if (checkTelegramBackupEnabled) {
    checkTelegramBackupEnabled.addEventListener('change', () => {
      if (telegramBackupForm) {
        telegramBackupForm.classList.toggle('is-disabled', !checkTelegramBackupEnabled.checked);
      }
      updateTelegramBackupStatusUI({
        ...state.settings,
        telegramBackupEnabled: checkTelegramBackupEnabled.checked
      });
    });
  }

  if (btnTestTelegram) {
    btnTestTelegram.addEventListener('click', async () => {
      const tokenInput = document.getElementById('inputTelegramBotToken');
      const chatInput = document.getElementById('inputTelegramChatId');
      const token = tokenInput ? tokenInput.value.trim() : '';
      const chatId = chatInput ? chatInput.value.trim() : '';

      if (!token || !chatId) {
        showToast('Укажите токен бота и Chat ID для проверки связи');
        return;
      }

      const originalHtml = btnTestTelegram.innerHTML;
      btnTestTelegram.disabled = true;
      btnTestTelegram.classList.add('is-loading');
      btnTestTelegram.innerHTML = '<span>Проверка...</span>';

      try {
        const res = await testTelegramConnection(token, chatId);
        if (res.success) {
          showToast(res.message || 'Связь с ботом успешно установлена!');
          updateTelegramBackupStatusUI({ 
            ...state.settings, 
            telegramBotToken: token, 
            telegramChatId: chatId, 
            telegramBackupEnabled: checkTelegramBackupEnabled ? checkTelegramBackupEnabled.checked : true 
          });
        } else {
          showToast(`Ошибка: ${res.message || 'Сбой проверки'}`);
        }
      } catch (err) {
        showToast(`Ошибка: ${err.message || 'Не удалось связаться с сервером'}`);
      } finally {
        btnTestTelegram.disabled = false;
        btnTestTelegram.classList.remove('is-loading');
        btnTestTelegram.innerHTML = originalHtml;
      }
    });
  }

  if (btnSendTelegramBackup) {
    btnSendTelegramBackup.addEventListener('click', async () => {
      const tokenInput = document.getElementById('inputTelegramBotToken');
      const chatInput = document.getElementById('inputTelegramChatId');
      const intervalSelect = document.getElementById('selectTelegramBackupInterval');
      const enabledCheck = document.getElementById('checkTelegramBackupEnabled');

      const token = tokenInput ? tokenInput.value.trim() : '';
      const chatId = chatInput ? chatInput.value.trim() : '';

      if (!token || !chatId) {
        showToast('Сначала введите токен бота и Chat ID');
        return;
      }

      // Сохраняем текущие введенные настройки перед отправкой
      const currentSettings = {
        ...state.settings,
        telegramBackupEnabled: enabledCheck ? enabledCheck.checked : false,
        telegramBotToken: token,
        telegramChatId: chatId,
        telegramBackupInterval: intervalSelect ? intervalSelect.value : 'daily'
      };
      state.settings = currentSettings;
      saveLocalSettings(currentSettings);
      await saveSettings(currentSettings).catch(() => {});

      const originalHtml = btnSendTelegramBackup.innerHTML;
      btnSendTelegramBackup.disabled = true;
      btnSendTelegramBackup.classList.add('is-loading');
      btnSendTelegramBackup.innerHTML = '<span>Отправка...</span>';

      try {
        const res = await sendTelegramBackupNow();
        if (res.success) {
          showToast('Резервная копия доставлена в Telegram!');
          if (res.result?.lastBackupAt) {
            state.settings.telegramLastBackupAt = res.result.lastBackupAt;
            saveLocalSettings(state.settings);
            updateTelegramBackupStatusUI(state.settings);
          }
        } else {
          showToast(`Ошибка: ${res.message || 'Сбой отправки бэкапа'}`);
        }
      } catch (err) {
        showToast(`Ошибка: ${err.message || 'Сбой соединения'}`);
      } finally {
        btnSendTelegramBackup.disabled = false;
        btnSendTelegramBackup.classList.remove('is-loading');
        btnSendTelegramBackup.innerHTML = originalHtml;
      }
    });
  }

  document.querySelectorAll('.btn-theme').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-theme').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const themeVal = btn.dataset.themeVal || 'kotobox';
      document.documentElement.setAttribute('data-theme', themeVal);
      state.settings.theme = themeVal;
      saveLocalSettings(state.settings);
    });
  });

  if (btnSaveSettings) {
    btnSaveSettings.addEventListener('click', async () => {
      const activeThemeBtn = document.querySelector('.btn-theme.active');
      const theme = activeThemeBtn ? activeThemeBtn.dataset.themeVal : 'kotobox';

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

      const checkTgEnabled = document.getElementById('checkTelegramBackupEnabled');
      const inputTgToken = document.getElementById('inputTelegramBotToken');
      const inputTgChat = document.getElementById('inputTelegramChatId');
      const selectTgInterval = document.getElementById('selectTelegramBackupInterval');
      const selectMaxServerCache = document.getElementById('selectMaxServerCache');
      const maxServerCacheMbVal = selectMaxServerCache ? (parseInt(selectMaxServerCache.value, 10)) : (state.settings.maxServerCacheMb !== undefined ? state.settings.maxServerCacheMb : 1500);

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
        furryTags: tempFurryTags,
        pregnantTags: tempPregnantTags,
        lgbtTags: tempLgbtTags,
        maxServerCacheMb: maxServerCacheMbVal,
        rule34ApiKey: inputRule34ApiKey ? inputRule34ApiKey.value.trim() : '',
        rule34UserId: inputRule34UserId ? inputRule34UserId.value.trim() : '',
        gelbooruApiKey: inputGelbooruApiKey ? inputGelbooruApiKey.value.trim() : '',
        gelbooruUserId: inputGelbooruUserId ? inputGelbooruUserId.value.trim() : '',
        danbooruApiKey: inputDanbooruApiKey ? inputDanbooruApiKey.value.trim() : '',
        danbooruLogin: inputDanbooruLogin ? inputDanbooruLogin.value.trim() : '',
        telegramBackupEnabled: checkTgEnabled ? checkTgEnabled.checked : false,
        telegramBotToken: inputTgToken ? inputTgToken.value.trim() : '',
        telegramChatId: inputTgChat ? inputTgChat.value.trim() : '',
        telegramBackupInterval: selectTgInterval ? selectTgInterval.value : 'daily',
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
      tempBlacklist = [...DEFAULT_BLACKLIST];
      tempAiTags = [...DEFAULT_AI_TAGS];
      tempCurvyTags = [...DEFAULT_CURVY_TAGS];
      tempPetiteTags = [...DEFAULT_PETITE_TAGS];
      tempFurryTags = [...DEFAULT_FURRY_TAGS];
      tempPregnantTags = [...DEFAULT_PREGNANT_TAGS];
      tempLgbtTags = [...DEFAULT_LGBT_TAGS];
      renderSettingsChips();
      
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
      if (inputTgToken) inputTgToken.value = '';
      if (inputTgChat) inputTgChat.value = '';
      if (checkTgEnabled) checkTgEnabled.checked = false;
      if (selectTgInterval) selectTgInterval.value = 'daily';
      if (telegramBackupForm) telegramBackupForm.classList.add('is-disabled');
      if (selectPreviewQuality) selectPreviewQuality.value = 'medium';
      if (checkVideoAutoplayHover) checkVideoAutoplayHover.checked = true;
      if (checkVideoAutoplayMobile) checkVideoAutoplayMobile.checked = true;
      if (checkVideoAutoplayViewer) checkVideoAutoplayViewer.checked = true;
      if (checkEnablePaheal) checkEnablePaheal.checked = true;
      if (checkEnableJsDemuxing) checkEnableJsDemuxing.checked = true;
      if (selectMaxServerCache) selectMaxServerCache.value = '1500';
      if (checkEnableJsDemuxing) checkEnableJsDemuxing.checked = true;
      renderSettingsChips();
      updateTelegramBackupStatusUI({
        telegramBackupEnabled: false,
        telegramBotToken: '',
        telegramChatId: '',
        telegramBackupInterval: 'daily',
        telegramLastBackupAt: null
      });
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
        telegramBackupEnabled: false,
        telegramBotToken: '',
        telegramChatId: '',
        telegramBackupInterval: 'daily',
        telegramLastBackupAt: null,
        enableJsDemuxing: true
      });
      showToast('Значения сброшены к стандартным');
    });
  }
}

