// Storage usage display, cache clearing, JSON export/import (incl. account
// restore) and the Telegram auto-backup card.
import {
  state,
  saveLocalSettings,
  saveLocalAuth,
  exportUserData,
  importUserData
} from '../../state.js';
import {
  saveSettings,
  fetchCacheInfo,
  clearCache,
  syncFavorites,
  syncLikes,
  syncDislikes,
  syncFavoriteAuthors,
  testTelegramConnection,
  sendTelegramBackupNow,
  apiExportAccount,
  apiRestoreAccount,
  fetchAliasesInfo
} from '../../api.js';
import { t } from '../../i18n.js';
import { showToast, formatBytes } from '../uiUtils.js';
import { updateHeaderAuthUI } from '../authModal.js';
import { persistSettings } from '../settingsPersist.js';
import { syncTempTagsFromState } from './tagLists.js';

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
  let pwaMediaCacheBytes = 0;
  if ('caches' in window) {
    try {
      const keys = await caches.keys();
      for (const k of keys) {
        const isMediaCache = k.includes('media');
        const cache = await caches.open(k);
        const reqs = await cache.keys();
        for (const req of reqs) {
          const res = await cache.match(req);
          if (res) {
            const blob = await res.blob();
            pwaCacheBytes += blob.size;
            if (isMediaCache) {
              pwaMediaCacheBytes += blob.size;
            }
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
    storageQuotaText.textContent = quotaBytes > 0 ? formatBytes(quotaBytes) : t('set.quotaUnknown', '-- ГБ');
  }

  if (storageProgressBar && quotaBytes > 0) {
    const pct = Math.min(100, Math.max(1, Math.round((clientTotalBytes / quotaBytes) * 100)));
    storageProgressBar.style.width = `${pct}%`;
  }

  if (storageMediaCacheText) storageMediaCacheText.textContent = formatBytes(pwaMediaCacheBytes);
  if (storageServerCacheText) {
    const formattedLimit = maxServerCacheMb > 0
      ? (maxServerCacheMb >= 1000 ? (maxServerCacheMb / 1000).toFixed(1).replace('.0', '') + ' ' + t('unit.gb', 'ГБ') : maxServerCacheMb + ' ' + t('unit.mb', 'МБ'))
      : null;
    const limitLabel = formattedLimit ? ` / ${formattedLimit}` : ` (${t('settings.cacheUnlimited', 'Без лимита')})`;
    storageServerCacheText.textContent = `${formatBytes(serverCacheBytes)}${limitLabel}`;
  }
  const storageLimitBadge = document.getElementById('storageLimitBadge');
  if (storageLimitBadge) {
    storageLimitBadge.textContent = maxServerCacheMb > 0
      ? (maxServerCacheMb >= 1000 ? (maxServerCacheMb / 1000).toFixed(1).replace('.0', '') + ' ' + t('unit.gb', 'ГБ') : maxServerCacheMb + ' ' + t('unit.mb', 'МБ'))
      : t('settings.cacheUnlimited', 'Без лимита');
  }
}

export async function updateDiscoveredAliasesUI() {
  const countEl = document.getElementById('discoveredAliasesCountText');
  if (!countEl) return;
  try {
    const info = await fetchAliasesInfo();
    countEl.textContent = String(info.discoveredCount || 0);
  } catch {
    countEl.textContent = '0';
  }
}

export async function handleClearStorageCache() {
  const btn = document.getElementById('btnClearStorageBtn');
  const statusEl = document.getElementById('storageClearStatus');

  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = t('set.clearing', 'Очистка...');

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
      for (const name of cacheNames) {
        if (name.includes('media') || name.startsWith('booru-cache-')) {
          await caches.delete(name);
        } else if (name.startsWith('booru-explorer-')) {
          try {
            const appCache = await caches.open(name);
            const requests = await appCache.keys();
            await Promise.all(
              requests
                .filter(req => {
                  try {
                    const pathname = new URL(req.url).pathname;
                    return pathname.startsWith('/api/');
                  } catch {
                    return false;
                  }
                })
                .map(req => appCache.delete(req))
            );
          } catch {}
        }
      }
    }

    await clearCache();

    await updateStorageUsageInfo();
    if (statusEl) {
      statusEl.textContent = t('set.cacheCleared', 'Кэш очищен');
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
    }
    showToast(t('set.mediaCacheCleared', 'Кэш медиа успешно очищен'));
  } catch (err) {
    console.error('[Settings] Cache clear failed:', err);
    if (statusEl) {
      statusEl.textContent = t('set.clearFailed', 'Ошибка очистки');
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
    }
    // The server half of the clear needs a signed-in account (401) while the
    // browser-side caches above are already gone, so surface the server's reason
    // instead of a bare "could not clear" that reads like a half-success
    const reason = err instanceof Error && err.message ? `: ${err.message}` : '';
    showToast(t('set.cacheClearIncomplete', 'Не удалось полностью очистить кэш') + reason);
  } finally {
    if (btn) btn.disabled = false;
  }
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
    statusText.textContent = t('set.tgNotConfigured', 'Бот не настроен (введите Token и Chat ID)');
  } else if (!isEnabled) {
    statusDot.className = 'tg-status-dot dot-paused';
    statusText.textContent = t('set.tgDisabled', 'Автобэкап выключен (доступна ручная отправка)');
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
      statusText.textContent = t('set.tgActiveLast', 'Активен. Последний бэкап: {d}').replace('{d}', dateStr);
    } else {
      statusText.textContent = t('set.tgActiveWaiting', 'Активен. Ожидание первого автобэкапа');
    }
  }
}

// Wire the storage/backup controls; called once from initSettingsModal
export function initStorageBackup({ applySettingsToUIAndState, onDataImported, onUpdateFavoritesBadge }) {
  const btnRefreshStorage = document.getElementById('btnRefreshStorage');
  const btnClearStorageBtn = document.getElementById('btnClearStorageBtn');
  const btnExportData = document.getElementById('btnExportData');
  const btnImportData = document.getElementById('btnImportData');
  const inputImportFile = document.getElementById('inputImportFile');

  if (btnRefreshStorage) btnRefreshStorage.addEventListener('click', updateStorageUsageInfo);
  if (btnClearStorageBtn) btnClearStorageBtn.addEventListener('click', handleClearStorageCache);

  const selectMaxServerCache = document.getElementById('selectMaxServerCache');
  if (selectMaxServerCache) {
    selectMaxServerCache.addEventListener('change', () => {
      const val = parseInt(selectMaxServerCache.value, 10);
      state.settings.maxServerCacheMb = val;
      persistSettings({ maxServerCacheMb: val });
      updateStorageUsageInfo();
      showToast(t('set.cacheLimitChanged', 'Лимит серверного кэша: {v}').replace('{v}',
        val > 0 ? (val >= 1000 ? (val / 1000).toFixed(1) + ' ' + t('unit.gb', 'ГБ') : val + ' ' + t('unit.mb', 'МБ')) : t('settings.cacheUnlimited', 'Без ограничений')
      ));
    });
  }

  if (btnExportData) {
    btnExportData.addEventListener('click', async () => {
      try {
        let account = null;
        if (state.currentUser) {
          account = await apiExportAccount();
        }
        const data = exportUserData(account);
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
        showToast(t('set.backupDownloaded', 'Резервная копия скачана') +
          (data.account ? t('set.backupWithAccount', ' (с аккаунтом {name})').replace('{name}', data.account.username) : ''));
      } catch (err) {
        showToast(t('set.exportFailed', 'Ошибка при экспорте данных'));
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
        if (file.size > 25 * 1024 * 1024) {
          throw new Error(t('set.importTooLarge', 'Файл слишком большой'));
        }
        const text = await file.text();
        let parsed = JSON.parse(text);

        // Unwrap nested Telegram backups ({ version, data: { settings, ... } })
        const nested = parsed && typeof parsed === 'object' && typeof parsed.data === 'object' && !Array.isArray(parsed.data)
          ? parsed.data
          : null;
        if (nested && !parsed.settings && !Array.isArray(parsed.favorites)) {
          parsed = { ...nested, account: parsed.account || nested.account || null };
        }

        // Restore + log into the account embedded in the file (before merging data,
        // so all server syncs below land under that account)
        let switchedAccount = false;
        const fileAccount = parsed.account;
        if (fileAccount && fileAccount.username) {
          const sameAccount = state.currentUser &&
            String(state.currentUser.username).toLowerCase() === String(fileAccount.username).toLowerCase();
          if (!sameAccount) {
            const wantLogin = confirm(t('set.accountFound',
              'В файле найден аккаунт «{name}». Войти в него и загрузить его данные?').replace('{name}', fileAccount.username));
            if (wantLogin) {
              const password = prompt(t('set.accountPasswordPrompt', 'Введите пароль аккаунта {name}').replace('{name}', fileAccount.username));
              if (password === null) {
                showToast(t('set.accountRestoreCancelled', 'Вход в аккаунт отменен'), 'error');
              } else if (!password) {
                showToast(t('set.accountPasswordRequired', 'Введите пароль аккаунта'), 'error');
              } else {
                try {
                  const res = await apiRestoreAccount(fileAccount, password);
                  if (res.success && res.token && res.user) {
                    saveLocalAuth(res.token, res.user);
                    updateHeaderAuthUI();
                    switchedAccount = true;
                    showToast(t('set.accountRestored', 'Вы вошли как @{name}').replace('{name}', res.user.username), 'success');
                  } else {
                    showToast(res.message || t('set.accountRestoreFailed', 'Не удалось войти в аккаунт из файла'), 'error');
                  }
                } catch (err) {
                  showToast(t('set.accountRestoreFailed', 'Не удалось войти в аккаунт из файла'), 'error');
                }
              }
            }
          }
        }

        // After an account switch replace lists instead of merging:
        // stale items of the previous session must not leak into the restored account
        const counts = importUserData(parsed, { replace: switchedAccount });

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
        if (counts.dislikes > 0) {
          try { await syncDislikes(state.dislikes); } catch (err) {}
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
        const inputKonachanLogin = document.getElementById('inputKonachanLogin');
        const inputKonachanPassword = document.getElementById('inputKonachanPassword');
        const inputYandereLogin = document.getElementById('inputYandereLogin');
        const inputYanderePassword = document.getElementById('inputYanderePassword');
        const inputPawchiveSession = document.getElementById('inputPawchiveSession');
        const inputKemonoSession = document.getElementById('inputKemonoSession');

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
        syncTempTagsFromState();

        showToast(t('set.importDone', 'Данные загружены: настройки, {favs} закладок, {authors} авторов')
          .replace('{favs}', counts.favorites).replace('{authors}', counts.favoriteAuthors));
        if (onDataImported) onDataImported();
      } catch (err) {
        showToast(`${t('set.importFailed', 'Ошибка импорта')}: ${err.message || 'неверный JSON'}`);
      }
    });
  }

  // Telegram auto-backup events
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
        showToast(t('set.tgTestNeedsCreds', 'Укажите токен бота и Chat ID для проверки связи'));
        return;
      }

      const originalHtml = btnTestTelegram.innerHTML;
      btnTestTelegram.disabled = true;
      btnTestTelegram.classList.add('is-loading');
      btnTestTelegram.innerHTML = `<span>${t('set.tgTesting', 'Проверка...')}</span>`;

      try {
        const res = await testTelegramConnection(token, chatId);
        if (res.success) {
          showToast(res.message || t('set.tgTestOk', 'Связь с ботом успешно установлена!'));
          updateTelegramBackupStatusUI({
            ...state.settings,
            telegramBotToken: token,
            telegramChatId: chatId,
            telegramBackupEnabled: checkTelegramBackupEnabled ? checkTelegramBackupEnabled.checked : true
          });
        } else {
          showToast(t('set.errorPrefix', 'Ошибка: {m}').replace('{m}', res.message || t('set.tgTestFail', 'Сбой проверки')));
        }
      } catch (err) {
        showToast(t('set.errorPrefix', 'Ошибка: {m}').replace('{m}', err.message || t('set.serverUnreachable', 'Не удалось связаться с сервером')));
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
        showToast(t('set.tgSendNeedsCreds', 'Сначала введите токен бота и Chat ID'));
        return;
      }

      // Save the currently entered settings before submitting
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
      btnSendTelegramBackup.innerHTML = `<span>${t('set.tgSending', 'Отправка...')}</span>`;

      try {
        const res = await sendTelegramBackupNow();
        if (res.success) {
          showToast(t('set.tgBackupSent', 'Резервная копия доставлена в Telegram!'));
          if (res.result?.lastBackupAt) {
            state.settings.telegramLastBackupAt = res.result.lastBackupAt;
            saveLocalSettings(state.settings);
            updateTelegramBackupStatusUI(state.settings);
          }
        } else {
          showToast(t('set.errorPrefix', 'Ошибка: {m}').replace('{m}', res.message || t('set.tgSendFail', 'Сбой отправки бэкапа')));
        }
      } catch (err) {
        showToast(t('set.errorPrefix', 'Ошибка: {m}').replace('{m}', err.message || t('set.connLost', 'Сбой соединения')));
      } finally {
        btnSendTelegramBackup.disabled = false;
        btnSendTelegramBackup.classList.remove('is-loading');
        btnSendTelegramBackup.innerHTML = originalHtml;
      }
    });
  }
}
