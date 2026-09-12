import { state, loadLocalPresets, saveLocalPresets } from '../state.js';
import { showToast } from './uiUtils.js';
import { t } from '../i18n.js';

let applyPresetCallback = null;
let getCurrentTagsCallback = null;
let getCurrentSiteCallback = null;
let getCurrentFiltersCallback = null;
let editingPresetId = null;

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseTagsString(str) {
  if (!str) return [];
  // Split by comma, newline or whitespace, ignoring multiple spaces
  const parts = str.split(/[,\s\n]+/);
  const cleanTags = [];
  for (const p of parts) {
    const clean = p.trim().toLowerCase().replace(/\s+/g, '_');
    if (clean && !cleanTags.includes(clean)) {
      cleanTags.push(clean);
    }
  }
  return cleanTags;
}

export function formatFiltersSummary(filters) {
  if (!filters || typeof filters !== 'object') return '';
  const parts = [];
  if (filters.ratingFilter && filters.ratingFilter !== 'all') {
    const map = { nsfw: '18+', questionable: '16+', sfw: 'SFW' };
    parts.push(map[filters.ratingFilter] || filters.ratingFilter);
  }
  if (filters.aiFilter && filters.aiFilter !== 'all') {
    const map = { 'no-ai': t('sidebar.aiNoAi', 'Без ИИ'), 'only-ai': t('sidebar.aiOnly', 'ИИ') };
    parts.push(map[filters.aiFilter] || filters.aiFilter);
  }
  if (filters.typeFilter && filters.typeFilter !== 'all') {
    const map = { video: t('sidebar.typeVideo', 'Видео'), audio: t('sidebar.typeAudio', 'Со звуком'), image: t('sidebar.typeImage', 'Изображения'), zip: 'ZIP' };
    parts.push(map[filters.typeFilter] || filters.typeFilter);
  }
  if (filters.ageFilter && filters.ageFilter !== 'all') {
    const map = { adult: t('sidebar.shapesAdult', 'Пышные'), young: t('sidebar.shapesYoung', 'Миниатюрные') };
    parts.push(map[filters.ageFilter] || filters.ageFilter);
  }
  if (filters.hideFurry) parts.push(t('presets.filterHideFurry', 'Без фурри'));
  if (filters.hidePregnant) parts.push(t('presets.filterHidePregnant', 'Без беременности'));
  if (filters.hideLgbt) parts.push(t('presets.filterHideLgbt', 'Без ЛГБТ'));
  if (filters.postSort && filters.postSort !== 'new') {
    const map = { hot: t('nav.hot', 'Горячее'), views: t('nav.views', 'Просмотры'), top: t('nav.top', 'По рейтингу') };
    parts.push(map[filters.postSort] || filters.postSort);
  }
  return parts.length > 0 ? parts.join(', ') : t('presets.defaultFilters', 'Стандартные фильтры');
}

export function initSearchPresets({ onApplyPreset, getCurrentTags, getCurrentSite, getCurrentFilters }) {
  applyPresetCallback = onApplyPreset;
  getCurrentTagsCallback = getCurrentTags;
  getCurrentSiteCallback = getCurrentSite;
  getCurrentFiltersCallback = getCurrentFilters;

  const btnSavePreset = document.getElementById('btnSavePreset');
  const modalBackdrop = document.getElementById('modalPresetBackdrop');
  const btnCloseModal = document.getElementById('btnClosePresetModal');
  const btnCancelModal = document.getElementById('btnCancelPreset');
  const btnSaveConfirm = document.getElementById('btnSavePresetConfirm');
  const inputName = document.getElementById('presetInputName');
  const inputTags = document.getElementById('presetInputTags');

  const formPreset = document.getElementById('formPreset');

  btnSavePreset?.addEventListener('click', () => {
    let currentTags = typeof getCurrentTagsCallback === 'function'
      ? [...getCurrentTagsCallback()]
      : [...(state.searchTags || [])];
    const searchInput = document.getElementById('searchInput');
    const inputVal = searchInput?.value?.trim();
    if (inputVal) {
      const clean = inputVal.toLowerCase().replace(/\s+/g, '_');
      if (!currentTags.includes(clean)) {
        currentTags.push(clean);
      }
    }
    openPresetModal(null, currentTags);
  });

  btnCloseModal?.addEventListener('click', closePresetModal);
  btnCancelModal?.addEventListener('click', closePresetModal);

  modalBackdrop?.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) {
      closePresetModal();
    }
  });

  formPreset?.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSavePresetSubmit();
  });

  btnSaveConfirm?.addEventListener('click', (e) => {
    e.preventDefault();
    handleSavePresetSubmit();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalBackdrop && modalBackdrop.style.display !== 'none') {
      closePresetModal();
    }
  });

  renderPresetsList();
}

export function renderPresetsList() {
  const container = document.getElementById('searchPresetsList');
  if (!container) return;

  const presets = loadLocalPresets();
  state.searchPresets = presets;

  if (!presets || presets.length === 0) {
    container.innerHTML = `
      <div class="empty-presets-hint">
        ${escapeHtml(t('presets.emptyHint', 'Нет пресетов. Введите теги и нажмите «+ Сохранить».'))}
      </div>
    `;
    return;
  }

  const currentTagsSet = new Set((state.searchTags || []).map(t => t.toLowerCase()));

  container.innerHTML = presets.map(preset => {
    const tags = Array.isArray(preset.tags) ? preset.tags : [];
    let isMatching = tags.length > 0 &&
      tags.length === currentTagsSet.size &&
      tags.every(t => currentTagsSet.has(t.toLowerCase()));

    if (isMatching && preset.filters && typeof getCurrentFiltersCallback === 'function') {
      const currentFilters = getCurrentFiltersCallback();
      if (currentFilters) {
        for (const [k, v] of Object.entries(preset.filters)) {
          if (currentFilters[k] !== undefined && currentFilters[k] !== v) {
            isMatching = false;
            break;
          }
        }
      }
    }

    const tagsPreview = tags.join(', ');
    const siteBadge = preset.site
      ? `<span class="preset-site-badge" title="${escapeHtml(t('presets.siteBound', 'Привязан к источнику:'))} ${escapeHtml(preset.site)}">${escapeHtml(preset.site)}</span>`
      : '';

    const filtersSummary = preset.filters ? formatFiltersSummary(preset.filters) : '';
    const filtersBadge = preset.filters
      ? `<span class="preset-filters-badge" title="${escapeHtml(t('presets.saveFilters', 'Фильтры и ползунки:'))} ${escapeHtml(filtersSummary)}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg></span>`
      : '';

    return `
      <div class="preset-item${isMatching ? ' active' : ''}" data-id="${escapeHtml(preset.id)}">
        <button type="button" class="preset-main-btn" title="${escapeHtml(tagsPreview)}${filtersSummary ? `\n${filtersSummary}` : ''}">
          <svg class="preset-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
          <span class="preset-name">${escapeHtml(preset.name || tags[0] || t('presets.unnamed', 'Пресет'))}</span>
          ${siteBadge}
          ${filtersBadge}
          <span class="preset-count" title="${escapeHtml(tagsPreview)}">${tags.length}</span>
        </button>
        <div class="preset-actions">
          <button type="button" class="btn-preset-action-item btn-preset-edit" title="${escapeHtml(t('presets.editTitle', 'Редактировать'))}" data-id="${escapeHtml(preset.id)}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button type="button" class="btn-preset-action-item btn-preset-delete" title="${escapeHtml(t('presets.deleteTitle', 'Удалить'))}" data-id="${escapeHtml(preset.id)}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Attach event handlers
  container.querySelectorAll('.preset-main-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.preset-item');
      const id = item?.dataset.id;
      if (id) {
        const p = presets.find(x => x.id === id);
        if (p) applyPreset(p);
      }
    });
  });

  container.querySelectorAll('.btn-preset-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const p = presets.find(x => x.id === id);
      if (p) openPresetModal(p);
    });
  });

  container.querySelectorAll('.btn-preset-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      deletePreset(id);
    });
  });
}

export function updatePresetActiveState() {
  const container = document.getElementById('searchPresetsList');
  if (!container) return;

  const presets = state.searchPresets || loadLocalPresets();
  const currentTagsSet = new Set((state.searchTags || []).map(t => t.toLowerCase()));
  const currentFilters = typeof getCurrentFiltersCallback === 'function' ? getCurrentFiltersCallback() : null;

  container.querySelectorAll('.preset-item').forEach(item => {
    const id = item.dataset.id;
    const p = presets.find(x => x.id === id);
    if (!p) return;
    const tags = Array.isArray(p.tags) ? p.tags : [];
    let isMatching = tags.length > 0 &&
      tags.length === currentTagsSet.size &&
      tags.every(t => currentTagsSet.has(t.toLowerCase()));

    if (isMatching && p.filters && currentFilters) {
      for (const [k, v] of Object.entries(p.filters)) {
        if (currentFilters[k] !== undefined && currentFilters[k] !== v) {
          isMatching = false;
          break;
        }
      }
    }
    item.classList.toggle('active', isMatching);
  });
}

export function applyPreset(preset) {
  if (!preset || !Array.isArray(preset.tags)) return;

  if (typeof applyPresetCallback === 'function') {
    applyPresetCallback(preset);
  } else {
    state.searchTags = [...preset.tags];
  }

  updatePresetActiveState();
  const name = preset.name || preset.tags.join(', ');
  showToast(`${t('presets.appliedToast', 'Применен пресет:')} ${name}`);
}

export function openPresetModal(presetToEdit = null, prefillTags = []) {
  const modalBackdrop = document.getElementById('modalPresetBackdrop');
  const title = document.getElementById('presetModalTitle');
  const inputName = document.getElementById('presetInputName');
  const inputTags = document.getElementById('presetInputTags');
  const checkBindSite = document.getElementById('presetCheckBindSite');
  const siteLabel = document.getElementById('presetBoundSiteName');
  const checkSaveFilters = document.getElementById('presetCheckSaveFilters');
  const hintFilters = document.getElementById('presetFiltersPreviewHint');

  if (!modalBackdrop || !inputName || !inputTags) return;

  const currentSite = typeof getCurrentSiteCallback === 'function'
    ? getCurrentSiteCallback()
    : (state.currentSite || 'danbooru');
  const currentFilters = typeof getCurrentFiltersCallback === 'function'
    ? getCurrentFiltersCallback()
    : null;

  let activeFiltersForModal = currentFilters;

  if (presetToEdit) {
    editingPresetId = presetToEdit.id;
    if (title) title.textContent = t('presets.editHeader', 'Редактировать пресет');
    inputName.value = presetToEdit.name || '';
    inputTags.value = Array.isArray(presetToEdit.tags) ? presetToEdit.tags.join(', ') : '';
    if (checkBindSite) {
      checkBindSite.checked = Boolean(presetToEdit.site);
    }
    if (siteLabel) {
      siteLabel.textContent = presetToEdit.site || currentSite;
    }
    if (checkSaveFilters) {
      checkSaveFilters.checked = Boolean(presetToEdit.filters);
    }
    if (presetToEdit.filters) {
      activeFiltersForModal = presetToEdit.filters;
    }
  } else {
    editingPresetId = null;
    if (title) title.textContent = t('presets.newHeader', 'Новый пресет поиска');

    const tags = Array.isArray(prefillTags) && prefillTags.length > 0
      ? prefillTags
      : [];

    inputTags.value = tags.join(', ');

    // Suggest a default name based on first tag or empty
    if (tags.length > 0) {
      const first = tags[0].replace(/_/g, ' ');
      inputName.value = first.charAt(0).toUpperCase() + first.slice(1);
    } else {
      inputName.value = '';
    }

    if (checkBindSite) checkBindSite.checked = false;
    if (siteLabel) siteLabel.textContent = currentSite;
    if (checkSaveFilters) checkSaveFilters.checked = true;
  }

  function updateHint() {
    if (!hintFilters) return;
    if (checkSaveFilters && checkSaveFilters.checked) {
      const summary = formatFiltersSummary(activeFiltersForModal);
      hintFilters.textContent = '⚡ ' + summary;
      hintFilters.style.color = '';
    } else {
      hintFilters.textContent = t('presets.noFiltersSaved', 'Фильтры не сохраняются (только теги)');
      hintFilters.style.color = 'var(--text-muted)';
    }
  }

  updateHint();
  checkSaveFilters?.onchange = updateHint;

  modalBackdrop.style.display = 'flex';
  setTimeout(() => {
    inputName.focus();
    inputName.select();
  }, 60);
}

export function closePresetModal() {
  const modalBackdrop = document.getElementById('modalPresetBackdrop');
  if (modalBackdrop) modalBackdrop.style.display = 'none';
  editingPresetId = null;
}

function handleSavePresetSubmit() {
  const inputName = document.getElementById('presetInputName');
  const inputTags = document.getElementById('presetInputTags');
  const checkBindSite = document.getElementById('presetCheckBindSite');
  const checkSaveFilters = document.getElementById('presetCheckSaveFilters');

  if (!inputName || !inputTags) return;

  const rawName = inputName.value.trim();
  const tags = parseTagsString(inputTags.value);

  if (tags.length === 0) {
    showToast(t('presets.errorNoTags', 'Укажите хотя бы один тег'));
    inputTags.focus();
    return;
  }

  const name = rawName || tags[0].replace(/_/g, ' ');
  const currentSite = typeof getCurrentSiteCallback === 'function'
    ? getCurrentSiteCallback()
    : (state.currentSite || 'danbooru');
  const site = checkBindSite?.checked ? currentSite : null;

  const currentFilters = typeof getCurrentFiltersCallback === 'function'
    ? getCurrentFiltersCallback()
    : null;
  const filters = (checkSaveFilters && checkSaveFilters.checked) ? currentFilters : null;

  const presets = loadLocalPresets();

  if (editingPresetId) {
    const idx = presets.findIndex(p => p.id === editingPresetId);
    if (idx !== -1) {
      presets[idx] = {
        ...presets[idx],
        name,
        tags,
        site,
        filters,
        updatedAt: new Date().toISOString()
      };
      showToast(t('presets.updated', 'Пресет обновлен'));
    }
  } else {
    const newPreset = {
      id: `preset_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      tags,
      site,
      filters,
      createdAt: new Date().toISOString()
    };
    presets.unshift(newPreset);
    showToast(t('presets.created', 'Пресет сохранен'));
  }

  saveLocalPresets(presets);
  renderPresetsList();
  closePresetModal();
}

export function deletePreset(presetId) {
  if (!presetId) return;

  const presets = loadLocalPresets();
  const p = presets.find(x => x.id === presetId);
  const name = p ? p.name : '';

  const updated = presets.filter(x => x.id !== presetId);
  saveLocalPresets(updated);
  renderPresetsList();

  showToast(`${t('presets.deleted', 'Пресет удален')}: ${name}`);
}
