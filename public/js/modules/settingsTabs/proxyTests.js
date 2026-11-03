// Upstream proxy test buttons and the per-site editor row picker. Pure DOM
// wiring: reads the input values, normalizes them, asks the server to dial.
import { t } from '../../i18n.js';
import { showToast } from '../uiUtils.js';
import { testProxyConnection } from '../../api.js';
import { normalizeProxyString } from '../settingsConstants.js';

// Wire the proxy controls; called once from initSettingsModal
export function initProxyTests() {
  // Upstream proxy site picker dropdown setup
  const selectUpstreamProxySite = document.getElementById('selectUpstreamProxySite');
  const updateUpstreamProxyRows = () => {
    const selected = selectUpstreamProxySite ? selectUpstreamProxySite.value : 'danbooru';
    document.querySelectorAll('.upstream-site-editor-row').forEach(row => {
      row.style.display = (row.dataset.upstreamSite === selected) ? 'block' : 'none';
    });
  };
  if (selectUpstreamProxySite) {
    selectUpstreamProxySite.addEventListener('change', updateUpstreamProxyRows);
    updateUpstreamProxyRows();
  }

  document.querySelectorAll('.upstream-site-editor-row input').forEach(inp => {
    inp.addEventListener('focus', () => {
      const parentRow = inp.closest('.upstream-site-editor-row');
      const site = parentRow?.dataset?.upstreamSite;
      if (site && selectUpstreamProxySite && selectUpstreamProxySite.value !== site) {
        selectUpstreamProxySite.value = site;
        updateUpstreamProxyRows();
      }
    });
  });

  // Per-site proxy tests
  const proxyTestConfigs = [
    { btnId: 'btnTestGlobalProxy', site: '', inputId: 'inputGlobalProxy' },
    { btnId: 'btnTestDanbooruProxy', site: 'danbooru', inputId: 'inputDanbooruProxy' },
    { btnId: 'btnTestGelbooruProxy', site: 'gelbooru', inputId: 'inputGelbooruProxy' },
    { btnId: 'btnTestRule34Proxy', site: 'rule34', inputId: 'inputRule34Proxy' },
    { btnId: 'btnTestYandereProxy', site: 'yandere', inputId: 'inputYandereProxy' },
    { btnId: 'btnTestKonachanProxy', site: 'konachan', inputId: 'inputKonachanProxy' },
    { btnId: 'btnTestSafebooruProxy', site: 'safebooru', inputId: 'inputSafebooruProxy' },
    { btnId: 'btnTestRule34videoProxy', site: 'rule34video', inputId: 'inputRule34videoProxy' },
    { btnId: 'btnTestPawchiveProxy', site: 'pawchive', inputId: 'inputPawchiveProxy' },
    { btnId: 'btnTestKemonoProxy', site: 'kemono', inputId: 'inputKemonoProxy' },
    { btnId: 'btnTestXbooruProxy', site: 'xbooru', inputId: 'inputXbooruProxy' },
    { btnId: 'btnTestHypnohubProxy', site: 'hypnohub', inputId: 'inputHypnohubProxy' },
    { btnId: 'btnTestTbibProxy', site: 'tbib', inputId: 'inputTbibProxy' }
  ];
  proxyTestConfigs.forEach(({ btnId, site, inputId }) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const el = document.getElementById(inputId);
      const rawProxy = el ? el.value.trim() : '';

      if (!rawProxy) {
        showToast(t('set.proxyTestNeedsUrl', 'Введите URL прокси (например: http://127.0.0.1:8080)'));
        return;
      }

      const proxyUrl = normalizeProxyString(rawProxy);
      if (el && proxyUrl !== rawProxy) {
        el.value = proxyUrl;
      }

      const originalHtml = btn.innerHTML;
      btn.disabled = true;
      btn.classList.add('is-loading');
      btn.innerHTML = `<span>${t('set.tgTesting', 'Проверка...')}</span>`;

      try {
        const res = await testProxyConnection(site, proxyUrl);
        if (res.success) {
          showToast(res.message || t('set.proxyTestOk', 'Прокси успешно подключен'));
        } else {
          showToast(t('set.errorPrefix', 'Ошибка: {m}').replace('{m}', res.message || t('set.proxyTestFail', 'Не удалось подключиться через прокси')));
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
}
