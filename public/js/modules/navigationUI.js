import { state } from '../state.js';
import { closeAllDrawers } from './drawers.js';
import { fetchSites } from '../api.js';
import { persistSettings } from './settingsModal.js';
import { showToast } from './uiUtils.js';

let customSourcesCallbacks = null;

export function getCustomSourcesList() {
  const custom = state.settings?.customSources;
  if (Array.isArray(custom) && custom.length > 0) {
    return custom;
  }
  return ['danbooru', 'gelbooru', 'rule34', 'yandere'];
}

export function updateCurrentSiteLabel() {
  const currentSiteLabel = document.getElementById('currentSiteLabel');
  if (!currentSiteLabel) return;

  if (state.currentSite === 'all') {
    currentSiteLabel.textContent = 'Все сразу';
  } else if (state.currentSite === 'custom') {
    const list = getCustomSourcesList();
    currentSiteLabel.textContent = `Своя (${list.length})`;
  } else {
    const siteObj = (state.sites || []).find(s => s.id === state.currentSite);
    currentSiteLabel.textContent = siteObj ? siteObj.name : state.currentSite;
  }
}

export function renderSitesBar({ onSelectSite }) {
  const sourcesList = document.getElementById('sourcesList');
  if (!sourcesList) return;
  sourcesList.innerHTML = '';

  // 1. Все сразу (ALL)
  const allItem = document.createElement('div');
  allItem.className = `source-item ${state.currentSite === 'all' ? 'active' : ''}`;
  allItem.innerHTML = `
    <span class="source-dot" style="background-color: var(--accent-primary)"></span>
    <span>⚡ Все сразу</span>
  `;
  allItem.addEventListener('click', () => onSelectSite('all'));
  sourcesList.appendChild(allItem);

  // 2. Своя подборка (CUSTOM)
  const customList = getCustomSourcesList();
  const customItem = document.createElement('div');
  customItem.className = `source-item source-item-custom ${state.currentSite === 'custom' ? 'active' : ''}`;
  customItem.innerHTML = `
    <div class="source-item-left">
      <span class="source-dot" style="background: linear-gradient(135deg, #f59e0b, #ec4899)"></span>
      <span class="source-item-title">🎯 Свой выбор</span>
      <span class="source-custom-badge">${customList.length}</span>
    </div>
    <button type="button" class="btn-source-gear" title="Настроить выбранные сайты">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
    </button>
  `;

  customItem.addEventListener('click', (e) => {
    if (e.target.closest('.btn-source-gear')) {
      e.stopPropagation();
      openCustomSourcesModal();
      return;
    }
    onSelectSite('custom');
  });

  sourcesList.appendChild(customItem);

  // 3. Отдельные сайты
  (state.sites || []).forEach(site => {
    const item = document.createElement('div');
    item.className = `source-item ${state.currentSite === site.id ? 'active' : ''}`;
    item.innerHTML = `
      <span class="source-dot" style="background-color: ${site.accentColor || 'var(--text-muted)'}"></span>
      <span>${site.name}</span>
    `;
    item.addEventListener('click', () => {
      onSelectSite(site.id);
    });
    sourcesList.appendChild(item);
  });
}

export function renderMobileSourcesSheet({ onSelectSite }) {
  const sourcesListMobile = document.getElementById('sourcesListMobile');
  if (!sourcesListMobile) return;
  sourcesListMobile.innerHTML = '';

  // 1. Все сразу
  const allCard = document.createElement('div');
  allCard.className = `source-mobile-card ${state.currentSite === 'all' ? 'active' : ''}`;
  allCard.innerHTML = `
    <div class="source-mobile-title-wrap">
      <span class="source-dot" style="background-color: var(--accent-primary)"></span>
      <span class="source-mobile-name">⚡ Все сразу</span>
    </div>
    <span class="source-mobile-badge">ALL</span>
  `;
  allCard.addEventListener('click', () => {
    onSelectSite('all');
    closeAllDrawers();
  });
  sourcesListMobile.appendChild(allCard);

  // 2. Свой выбор
  const customList = getCustomSourcesList();
  const customCard = document.createElement('div');
  customCard.className = `source-mobile-card source-mobile-card-custom ${state.currentSite === 'custom' ? 'active' : ''}`;
  customCard.innerHTML = `
    <div class="source-mobile-title-wrap">
      <span class="source-dot" style="background: linear-gradient(135deg, #f59e0b, #ec4899)"></span>
      <span class="source-mobile-name">🎯 Свой выбор</span>
      <span class="source-custom-badge">${customList.length}</span>
    </div>
    <div class="source-mobile-actions">
      <button type="button" class="btn-source-gear-mobile" title="Настроить список">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
      </button>
      <span class="source-mobile-badge">CUSTOM</span>
    </div>
  `;

  customCard.addEventListener('click', (e) => {
    if (e.target.closest('.btn-source-gear-mobile')) {
      e.stopPropagation();
      closeAllDrawers();
      openCustomSourcesModal();
      return;
    }
    onSelectSite('custom');
    closeAllDrawers();
  });
  sourcesListMobile.appendChild(customCard);

  // 3. Отдельные сайты
  (state.sites || []).forEach(site => {
    const card = document.createElement('div');
    card.className = `source-mobile-card ${state.currentSite === site.id ? 'active' : ''}`;
    card.innerHTML = `
      <div class="source-mobile-title-wrap">
        <span class="source-dot" style="background-color: ${site.accentColor || 'var(--text-muted)'}"></span>
        <span class="source-mobile-name" title="${site.name}">${site.name}</span>
      </div>
      <span class="source-mobile-badge">${(site.id || '').toUpperCase()}</span>
    `;
    card.addEventListener('click', () => {
      onSelectSite(site.id);
      closeAllDrawers();
    });
    sourcesListMobile.appendChild(card);
  });
}

let tempCustomSources = [];

export function openCustomSourcesModal() {
  const modalBackdrop = document.getElementById('modalCustomSourcesBackdrop');
  const grid = document.getElementById('customSourcesCheckboxGrid');
  if (!modalBackdrop || !grid) return;

  tempCustomSources = [...getCustomSourcesList()];
  renderCustomSourcesCheckboxes();

  modalBackdrop.style.display = 'flex';
}

export function closeCustomSourcesModal() {
  const modalBackdrop = document.getElementById('modalCustomSourcesBackdrop');
  if (modalBackdrop) modalBackdrop.style.display = 'none';
}

function renderCustomSourcesCheckboxes() {
  const grid = document.getElementById('customSourcesCheckboxGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const sites = state.sites || [];
  sites.forEach(site => {
    const isChecked = tempCustomSources.includes(site.id);
    const card = document.createElement('label');
    card.className = `custom-source-choice ${isChecked ? 'selected' : ''}`;
    card.innerHTML = `
      <input type="checkbox" class="custom-source-checkbox" data-site="${site.id}" ${isChecked ? 'checked' : ''}>
      <div class="custom-source-choice-content">
        <div class="custom-source-choice-head">
          <span class="source-dot" style="background-color: ${site.accentColor || 'var(--text-muted)'}"></span>
          <span class="custom-source-name">${site.name}</span>
          <span class="custom-source-badge">${(site.rating === 'nsfw' ? '18+' : (site.rating === 'safe' ? 'SFW' : 'MIX'))}</span>
        </div>
        <p class="custom-source-desc">${site.description || ''}</p>
      </div>
    `;

    const input = card.querySelector('input');
    input.addEventListener('change', () => {
      if (input.checked) {
        if (!tempCustomSources.includes(site.id)) tempCustomSources.push(site.id);
      } else {
        tempCustomSources = tempCustomSources.filter(id => id !== site.id);
      }
      card.classList.toggle('selected', input.checked);
    });

    grid.appendChild(card);
  });
}

export function initCustomSourcesModal({ onApply }) {
  customSourcesCallbacks = { onApply };

  const btnClose = document.getElementById('btnCloseCustomSourcesModal');
  const backdrop = document.getElementById('modalCustomSourcesBackdrop');
  const btnToggleAll = document.getElementById('btnCustomSourcesToggleAll');
  const btnApply = document.getElementById('btnApplyCustomSources');

  if (btnClose) btnClose.addEventListener('click', closeCustomSourcesModal);
  if (backdrop) {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeCustomSourcesModal();
    });
  }

  if (btnToggleAll) {
    btnToggleAll.addEventListener('click', () => {
      const allIds = (state.sites || []).map(s => s.id);
      if (tempCustomSources.length === allIds.length) {
        tempCustomSources = ['danbooru'];
        btnToggleAll.textContent = 'Выбрать все';
      } else {
        tempCustomSources = [...allIds];
        btnToggleAll.textContent = 'Сбросить все';
      }
      renderCustomSourcesCheckboxes();
    });
  }

  if (btnApply) {
    btnApply.addEventListener('click', () => {
      if (tempCustomSources.length === 0) {
        showToast('Выберите хотя бы один источник');
        return;
      }

      state.settings.customSources = [...tempCustomSources];
      persistSettings({ customSources: state.settings.customSources });

      closeCustomSourcesModal();
      showToast(`Выбрано источников: ${tempCustomSources.length}`);

      if (customSourcesCallbacks && typeof customSourcesCallbacks.onApply === 'function') {
        customSourcesCallbacks.onApply(state.settings.customSources);
      }
    });
  }
}

export async function loadBooruSites({ onSelectSite }) {
  try {
    const data = await fetchSites();
    const sites = data.sites || [];
    state.sites = sites;
    updateCurrentSiteLabel();
    renderSitesBar({ onSelectSite });
    renderMobileSourcesSheet({ onSelectSite });
  } catch (err) {
    console.error('Ошибка загрузки сайтов:', err);
  }
}
