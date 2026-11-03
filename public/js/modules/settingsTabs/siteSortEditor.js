// Per-site sort tag overrides ("Search" tab): hot/views/top/new tag inputs per
// board. Edits live in a temp map committed on save; the inputs autosave into
// it on every keystroke so switching sites never loses a half-typed value.
import { state } from '../../state.js';
import { t } from '../../i18n.js';
import { showToast } from '../uiUtils.js';
import { SITE_SORT_METADATA } from '../settingsConstants.js';

let tempSiteSortTags = {};
let currentSortEditingSite = 'gelbooru';

// Snapshot from settings when the modal opens and select the initial site
export function loadTempSiteSortTags() {
  tempSiteSortTags = JSON.parse(JSON.stringify(state.settings.siteSortTags || {}));
  const selectSortTagsSite = document.getElementById('selectSortTagsSite');
  const initialSortSite = (state.currentSite && state.currentSite !== 'custom' && state.currentSite !== 'all') ? state.currentSite : 'gelbooru';
  if (selectSortTagsSite) {
    selectSortTagsSite.value = initialSortSite;
  }
  renderSiteSortTagsUI(initialSortSite);
}

export function getTempSiteSortTags() {
  return tempSiteSortTags;
}

export function resetTempSiteSortTags() {
  tempSiteSortTags = {};
  renderSiteSortTagsUI(currentSortEditingSite || 'gelbooru');
}

function saveCurrentSiteSortInputs() {
  const inputHot = document.getElementById('inputSiteSortHot');
  const inputViews = document.getElementById('inputSiteSortViews');
  const inputTop = document.getElementById('inputSiteSortTop');
  const inputNew = document.getElementById('inputSiteSortNew');
  if (!currentSortEditingSite) return;

  const hot = inputHot ? inputHot.value.trim() : '';
  const views = inputViews ? inputViews.value.trim() : '';
  const top = inputTop ? inputTop.value.trim() : '';
  const newTag = inputNew ? inputNew.value.trim() : '';

  if (hot || views || top || newTag) {
    tempSiteSortTags[currentSortEditingSite] = { hot, views, top, new: newTag };
  } else {
    delete tempSiteSortTags[currentSortEditingSite];
  }
}

export function renderSiteSortTagsUI(siteId) {
  if (!siteId) siteId = 'gelbooru';
  currentSortEditingSite = siteId;

  const meta = SITE_SORT_METADATA[siteId] || SITE_SORT_METADATA.gelbooru;
  const currentTags = tempSiteSortTags[siteId] || {};

  const inputHot = document.getElementById('inputSiteSortHot');
  const inputViews = document.getElementById('inputSiteSortViews');
  const inputTop = document.getElementById('inputSiteSortTop');
  const inputNew = document.getElementById('inputSiteSortNew');

  const badgeHot = document.getElementById('siteSortHotDefaultBadge');
  const badgeViews = document.getElementById('siteSortViewsDefaultBadge');
  const badgeTop = document.getElementById('siteSortTopDefaultBadge');
  const badgeNew = document.getElementById('siteSortNewDefaultBadge');
  const presetsContainer = document.getElementById('siteSortHotPresets');

  if (inputHot) {
    inputHot.value = currentTags.hot || '';
    inputHot.placeholder = meta.hotPlaceholder;
  }
  if (inputViews) {
    inputViews.value = currentTags.views || '';
    inputViews.placeholder = meta.viewsPlaceholder;
  }
  if (inputTop) {
    inputTop.value = currentTags.top || '';
    inputTop.placeholder = meta.topPlaceholder;
  }
  if (inputNew) {
    inputNew.value = currentTags.new || '';
    inputNew.placeholder = meta.newPlaceholder;
  }

  if (badgeHot) badgeHot.textContent = `(авто: ${meta.hotBadge})`;
  if (badgeViews) badgeViews.textContent = `(авто: ${meta.viewsBadge})`;
  if (badgeTop) badgeTop.textContent = `(авто: ${meta.topBadge})`;
  if (badgeNew) badgeNew.textContent = `(авто: ${meta.newBadge})`;

  if (presetsContainer) {
    presetsContainer.innerHTML = '';
    if (meta.presets && meta.presets.length > 0) {
      const label = document.createElement('span');
      label.style.fontSize = '10px';
      label.style.opacity = '0.7';
      label.style.alignSelf = 'center';
      label.textContent = t('settings.sortPresets', 'Пресеты:');
      presetsContainer.appendChild(label);

      meta.presets.forEach(pr => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-text';
        btn.style.fontSize = '10px';
        btn.style.padding = '2px 6px';
        btn.style.background = 'var(--surface-sunken)';
        btn.style.border = '1px solid var(--border-subtle)';
        btn.style.borderRadius = 'var(--radius-sm)';
        btn.style.cursor = 'pointer';
        btn.textContent = pr;
        btn.addEventListener('click', () => {
          if (inputHot) {
            inputHot.value = pr;
            saveCurrentSiteSortInputs();
          }
        });
        presetsContainer.appendChild(btn);
      });
    }
  }
}

// Wire the editor's controls; called once from initSettingsModal
export function initSiteSortEditor() {
  const selectSortTagsSite = document.getElementById('selectSortTagsSite');
  if (selectSortTagsSite) {
    selectSortTagsSite.addEventListener('change', () => {
      saveCurrentSiteSortInputs();
      renderSiteSortTagsUI(selectSortTagsSite.value);
    });
  }

  const inputSiteSortHot = document.getElementById('inputSiteSortHot');
  const inputSiteSortViews = document.getElementById('inputSiteSortViews');
  const inputSiteSortTop = document.getElementById('inputSiteSortTop');
  const inputSiteSortNew = document.getElementById('inputSiteSortNew');
  [inputSiteSortHot, inputSiteSortViews, inputSiteSortTop, inputSiteSortNew].forEach(inp => {
    if (inp) inp.addEventListener('input', saveCurrentSiteSortInputs);
  });

  const btnResetCurrentSiteSort = document.getElementById('btnResetCurrentSiteSort');
  if (btnResetCurrentSiteSort) {
    btnResetCurrentSiteSort.addEventListener('click', () => {
      if (currentSortEditingSite && tempSiteSortTags[currentSortEditingSite]) {
        delete tempSiteSortTags[currentSortEditingSite];
      }
      renderSiteSortTagsUI(currentSortEditingSite);
      showToast(t('settings.siteSortReset', 'Теги для сайта сброшены к стандартным'));
    });
  }
}
