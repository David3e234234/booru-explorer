// Board credential test buttons and the batch external-sync button. Each test
// button validates only the values typed into its own card; nothing here
// touches the temp settings objects.
import { state } from '../../state.js';
import { testSiteAuth, syncExternalAccounts } from '../../api.js';
import { t } from '../../i18n.js';
import { showToast } from '../uiUtils.js';

// Wire the test buttons; called once from initSettingsModal
export function initCredentialTests() {
  const authTestConfigs = [
    { btnId: 'btnTestRule34Auth', site: 'rule34', fields: { apiKey: 'inputRule34ApiKey', userId: 'inputRule34UserId' } },
    { btnId: 'btnTestGelbooruAuth', site: 'gelbooru', fields: { apiKey: 'inputGelbooruApiKey', userId: 'inputGelbooruUserId' } },
    { btnId: 'btnTestDanbooruAuth', site: 'danbooru', fields: { apiKey: 'inputDanbooruApiKey', login: 'inputDanbooruLogin' } },
    { btnId: 'btnTestKonachanAuth', site: 'konachan', fields: { login: 'inputKonachanLogin', password: 'inputKonachanPassword' } },
    { btnId: 'btnTestYandereAuth', site: 'yandere', fields: { login: 'inputYandereLogin', password: 'inputYanderePassword' } },
    { btnId: 'btnTestPawchiveAuth', site: 'pawchive', fields: { session: 'inputPawchiveSession' } },
    { btnId: 'btnTestKemonoAuth', site: 'kemono', fields: { session: 'inputKemonoSession' } }
  ];
  authTestConfigs.forEach(({ btnId, site, fields }) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const payload = { site };
      let hasAnyValue = false;
      for (const [key, inputId] of Object.entries(fields)) {
        const el = document.getElementById(inputId);
        payload[key] = el ? el.value.trim() : '';
        if (payload[key]) hasAnyValue = true;
      }

      if (!hasAnyValue) {
        showToast(t('set.authTestNeedsCreds', 'Заполните данные для входа в карточке'));
        return;
      }

      // A half-filled pair is rejected instead of silently falling back, so a
      // forgotten password is not reported as a broken session token.
      const pairIncomplete = ('login' in payload && payload.login) !== ('password' in payload && Boolean(payload.password));
      if (pairIncomplete && !payload.session) {
        showToast(t('set.authTestNeedsCreds', 'Заполните данные для входа в карточке'));
        return;
      }

      const originalHtml = btn.innerHTML;
      btn.disabled = true;
      btn.classList.add('is-loading');
      btn.innerHTML = `<span>${t('set.tgTesting', 'Проверка...')}</span>`;

      try {
        const res = await testSiteAuth(payload);
        if (res.success) {
          showToast(res.message || t('set.authTestOk', 'Авторизация работает'));
        } else {
          showToast(t('set.errorPrefix', 'Ошибка: {m}').replace('{m}', res.message || t('set.authTestFail', 'Проверка не пройдена')));
        }
      } catch (err) {
        showToast(t('set.errorPrefix', 'Ошибка: {m}').replace('{m}', err.message || t('set.serverUnreachable', 'Не удалось связаться с сервером')));
      } finally {
        btn.disabled = false;
        btn.classList.remove('is-loading');
        btn.innerHTML = originalHtml;
      }
    });
  });

  // Batch external synchronization button
  const btnSyncExternalAll = document.getElementById('btnSyncExternalAll');
  const syncExternalStatusText = document.getElementById('syncExternalStatusText');
  if (btnSyncExternalAll) {
    btnSyncExternalAll.addEventListener('click', async () => {
      const originalHtml = btnSyncExternalAll.innerHTML;
      btnSyncExternalAll.disabled = true;
      btnSyncExternalAll.classList.add('is-loading');
      btnSyncExternalAll.innerHTML = `<span>${t('settings.syncing', 'Выгрузка...')}</span>`;
      if (syncExternalStatusText) {
        syncExternalStatusText.style.display = 'block';
        syncExternalStatusText.textContent = t('settings.syncingStatus', 'Отправка данных на внешние серверы (Danbooru, Pawchive)...');
      }

      try {
        const inputDanbooruApiKey = document.getElementById('inputDanbooruApiKey');
        const inputDanbooruLogin = document.getElementById('inputDanbooruLogin');
        const inputKonachanLogin = document.getElementById('inputKonachanLogin');
        const inputKonachanPassword = document.getElementById('inputKonachanPassword');
        const inputYandereLogin = document.getElementById('inputYandereLogin');
        const inputYanderePassword = document.getElementById('inputYanderePassword');
        const inputPawchiveSession = document.getElementById('inputPawchiveSession');
        const inputKemonoSession = document.getElementById('inputKemonoSession');

        const activeSettings = {
          ...(state.settings || {}),
          danbooruApiKey: inputDanbooruApiKey ? inputDanbooruApiKey.value.trim() : (state.settings?.danbooruApiKey || ''),
          danbooruLogin: inputDanbooruLogin ? inputDanbooruLogin.value.trim() : (state.settings?.danbooruLogin || ''),
          konachanLogin: inputKonachanLogin ? inputKonachanLogin.value.trim() : (state.settings?.konachanLogin || ''),
          konachanPassword: inputKonachanPassword ? inputKonachanPassword.value.trim() : (state.settings?.konachanPassword || ''),
          yandereLogin: inputYandereLogin ? inputYandereLogin.value.trim() : (state.settings?.yandereLogin || ''),
          yanderePassword: inputYanderePassword ? inputYanderePassword.value.trim() : (state.settings?.yanderePassword || ''),
          pawchiveSession: inputPawchiveSession ? inputPawchiveSession.value.trim() : (state.settings?.pawchiveSession || ''),
          kemonoSession: inputKemonoSession ? inputKemonoSession.value.trim() : (state.settings?.kemonoSession || ''),
        };

        const res = await syncExternalAccounts({
          targetSite: 'all',
          syncLikes: true,
          syncFavorites: true,
          syncAuthors: true,
          settings: activeSettings
        });
        if (res.success) {
          showToast(res.message || t('settings.syncSuccess', 'Синхронизация успешно выполнена'));
          if (syncExternalStatusText) {
            syncExternalStatusText.textContent = res.message || t('settings.syncSuccess', 'Синхронизация успешно выполнена');
          }
        } else {
          showToast(t('set.errorPrefix', 'Ошибка: {m}').replace('{m}', res.message || 'Ошибка синхронизации'));
          if (syncExternalStatusText) {
            syncExternalStatusText.textContent = res.message || 'Ошибка синхронизации';
          }
        }
      } catch (err) {
        showToast(t('set.errorPrefix', 'Ошибка: {m}').replace('{m}', err.message || t('set.serverUnreachable', 'Не удалось связаться с сервером')));
        if (syncExternalStatusText) {
          syncExternalStatusText.textContent = err.message || 'Сбой связи с сервером';
        }
      } finally {
        btnSyncExternalAll.disabled = false;
        btnSyncExternalAll.classList.remove('is-loading');
        btnSyncExternalAll.innerHTML = originalHtml;
      }
    });
  }
}
