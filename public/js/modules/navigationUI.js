import { state } from '../state.js';
import { closeAllDrawers } from './drawers.js';
import { fetchSites } from '../api.js';

export function renderSitesBar({ onSelectSite }) {
  const sourcesList = document.getElementById('sourcesList');
  if (!sourcesList) return;
  sourcesList.innerHTML = '';

  const allItem = document.createElement('div');
  allItem.className = `source-item ${state.currentSite === 'all' ? 'active' : ''}`;
  allItem.innerHTML = `
    <span class="source-dot" style="background-color: var(--accent-primary)"></span>
    <span>⚡ Все сразу</span>
  `;
  allItem.addEventListener('click', () => onSelectSite('all'));
  sourcesList.appendChild(allItem);

  state.sites.forEach(site => {
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

  state.sites.forEach(site => {
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

export async function loadBooruSites({ onSelectSite }) {
  try {
    const data = await fetchSites();
    const sites = data.sites || [];
    state.sites = sites;
    const currentSiteLabel = document.getElementById('currentSiteLabel');
    if (currentSiteLabel) {
      if (state.currentSite === 'all') {
        currentSiteLabel.textContent = 'Все сразу';
      } else {
        const siteObj = state.sites.find(s => s.id === state.currentSite);
        currentSiteLabel.textContent = siteObj ? siteObj.name : state.currentSite;
      }
    }
    renderSitesBar({ onSelectSite });
    renderMobileSourcesSheet({ onSelectSite });
  } catch (err) {
    console.error('Ошибка загрузки сайтов:', err);
  }
}
