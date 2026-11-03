// Per-site media proxy routing ("Proxy" tab): the temp site->mode map shown by
// the segmented controls, committed into settings only on save.
import { t } from '../../i18n.js';
import { escapeHtml } from '../uiUtils.js';
import { state } from '../../state.js';

export const SITES_MEDIA_PROXY_CONFIG = [
  { id: 'danbooru', name: 'Danbooru', badgeClass: 'site-danbooru', defaultHint: 'Кэш и обход hotlink' },
  { id: 'gelbooru', name: 'Gelbooru', badgeClass: 'site-gelbooru', defaultHint: 'По общим правилам' },
  { id: 'rule34', name: 'Rule34.xxx', badgeClass: 'site-r34', defaultHint: 'По общим правилам' },
  { id: 'yandere', name: 'Yande.re', badgeClass: 'site-yandere', defaultHint: 'По общим правилам' },
  { id: 'konachan', name: 'Konachan', badgeClass: 'site-konachan', defaultHint: 'По общим правилам' },
  { id: 'safebooru', name: 'Safebooru', badgeClass: 'site-safebooru', defaultHint: 'По общим правилам' },
  { id: 'rule34video', name: 'Rule34Video', badgeClass: 'site-rule34video', defaultHint: 'Серверный видео-стриминг' },
  { id: 'pawchive', name: 'Pawchive', badgeClass: 'site-pawchive', defaultHint: 'По общим правилам' },
  { id: 'kemono', name: 'Kemono', badgeClass: 'site-kemono', defaultHint: 'По общим правилам' },
  { id: 'xbooru', name: 'Xbooru', badgeClass: 'site-xbooru', defaultHint: 'По общим правилам' },
  { id: 'hypnohub', name: 'Hypnohub', badgeClass: 'site-hypnohub', defaultHint: 'По общим правилам' },
  { id: 'tbib', name: 'TBIB', badgeClass: 'site-tbib', defaultHint: 'По общим правилам' }
];

let tempSiteMediaProxy = {};

export function loadTempSiteMediaProxy() {
  tempSiteMediaProxy = (state.settings?.siteMediaProxy && typeof state.settings.siteMediaProxy === 'object') ? { ...state.settings.siteMediaProxy } : {};
}

export function getTempSiteMediaProxy() {
  return tempSiteMediaProxy;
}

export function resetTempSiteMediaProxy() {
  tempSiteMediaProxy = {};
  renderSiteMediaProxyUI();
}

function getSiteProxyHintText(site, mode) {
  if (mode === 'server') {
    return t('settings.proxyModeServerHint', 'Через сервер (кэш)');
  }
  if (mode === 'direct') {
    return t('settings.proxyModeDirectHint', 'Напрямую с CDN');
  }
  return site.defaultHint;
}

export function renderSiteMediaProxyUI() {
  const container = document.getElementById('siteMediaProxyList');
  if (!container) return;
  container.innerHTML = '';

  const fragment = document.createDocumentFragment();

  SITES_MEDIA_PROXY_CONFIG.forEach(site => {
    const currentMode = tempSiteMediaProxy[site.id] || 'default';
    const row = document.createElement('div');
    row.className = 'site-proxy-item';
    row.dataset.siteId = site.id;

    const meta = document.createElement('div');
    meta.className = 'site-proxy-meta';
    meta.innerHTML = `
      <span class="api-key-site-badge ${site.badgeClass}">${escapeHtml(site.name)}</span>
      <span class="site-proxy-hint-text" id="siteProxyHint_${site.id}">${escapeHtml(getSiteProxyHintText(site, currentMode))}</span>
    `;

    const controls = document.createElement('div');
    controls.className = 'segmented-control';
    controls.innerHTML = `
      <button type="button" class="segmented-pill ${currentMode === 'default' ? 'active' : ''}" data-proxy-mode="default" title="${t('settings.proxyModeDefault', 'По умолчанию')}">${t('settings.proxyModeDefault', 'По умолчанию')}</button>
      <button type="button" class="segmented-pill ${currentMode === 'server' ? 'active' : ''}" data-proxy-mode="server" title="${t('settings.proxyModeServer', 'Через сервер')}">${t('settings.proxyModeServer', 'Через сервер')}</button>
      <button type="button" class="segmented-pill ${currentMode === 'direct' ? 'active' : ''}" data-proxy-mode="direct" title="${t('settings.proxyModeDirect', 'Напрямую')}">${t('settings.proxyModeDirect', 'Напрямую')}</button>
    `;

    controls.addEventListener('click', (e) => {
      const btn = e.target.closest('.segmented-pill');
      if (!btn) return;
      const mode = btn.dataset.proxyMode;
      if (!mode) return;

      if (mode === 'default') {
        delete tempSiteMediaProxy[site.id];
      } else {
        tempSiteMediaProxy[site.id] = mode;
      }

      controls.querySelectorAll('.segmented-pill').forEach(b => {
        b.classList.toggle('active', b.dataset.proxyMode === mode);
      });

      const hintEl = document.getElementById(`siteProxyHint_${site.id}`);
      if (hintEl) {
        hintEl.textContent = getSiteProxyHintText(site, mode);
      }
    });

    row.appendChild(meta);
    row.appendChild(controls);
    fragment.appendChild(row);
  });

  container.appendChild(fragment);
}
