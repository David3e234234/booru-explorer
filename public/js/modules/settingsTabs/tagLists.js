// Tag list editors ("Filters" tab): the eight editable tag collections kept in
// temp arrays while the modal is open and committed to settings only on save.
// The chip renderers and the generic "Enter adds a tag" input behavior live here.
import { state } from '../../state.js';
import { clearDiscoveredAliasesApi } from '../../api.js';
import { t } from '../../i18n.js';
import { showToast, escapeHtml } from '../uiUtils.js';
import { persistSettings } from '../settingsPersist.js';
import {
  DEFAULT_AI_TAGS,
  DEFAULT_BLACKLIST,
  DEFAULT_CURVY_TAGS,
  DEFAULT_PETITE_TAGS,
  DEFAULT_FURRY_TAGS,
  DEFAULT_PREGNANT_TAGS,
  DEFAULT_LGBT_TAGS
} from '../settingsConstants.js';

let tempBlacklist = [];
let tempAiTags = [];
let tempCurvyTags = [];
let tempPetiteTags = [];
let tempFurryTags = [];
let tempPregnantTags = [];
let tempLgbtTags = [];
let tempIgnoredAliases = [];

// Snapshot from state.settings when the modal opens; empty collections fall
// back to their shipped defaults
export function loadTempTagsFromSettings() {
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

  tempIgnoredAliases = Array.isArray(state.settings.ignoredAliases)
    ? [...state.settings.ignoredAliases]
    : [];
}

// Re-sync after an import replaced state.settings under us
export function syncTempTagsFromState() {
  tempBlacklist = state.settings.blacklist || [];
  tempAiTags = state.settings.aiTags || [];
  tempCurvyTags = state.settings.curvyTags || [...DEFAULT_CURVY_TAGS];
  tempPetiteTags = state.settings.petiteTags || [...DEFAULT_PETITE_TAGS];
  renderSettingsChips();
}

export function getTempTags() {
  return {
    blacklist: tempBlacklist,
    aiTags: tempAiTags,
    curvyTags: tempCurvyTags,
    petiteTags: tempPetiteTags,
    furryTags: tempFurryTags,
    pregnantTags: tempPregnantTags,
    lgbtTags: tempLgbtTags,
    ignoredAliases: tempIgnoredAliases
  };
}

export function resetTempTagsToDefaults() {
  tempBlacklist = [...DEFAULT_BLACKLIST];
  tempAiTags = [...DEFAULT_AI_TAGS];
  tempCurvyTags = [...DEFAULT_CURVY_TAGS];
  tempPetiteTags = [...DEFAULT_PETITE_TAGS];
  tempFurryTags = [...DEFAULT_FURRY_TAGS];
  tempPregnantTags = [...DEFAULT_PREGNANT_TAGS];
  tempLgbtTags = [...DEFAULT_LGBT_TAGS];
  tempIgnoredAliases = [];
  renderSettingsChips();
}

export function addIgnoredAliasTag(tag) {
  if (!tag || typeof tag !== 'string') return;
  const clean = tag.trim().toLowerCase();
  if (!clean) return;
  if (!tempIgnoredAliases.includes(clean)) {
    tempIgnoredAliases.push(clean);
  }
  const currentList = Array.isArray(state.settings?.ignoredAliases) ? [...state.settings.ignoredAliases] : [];
  if (!currentList.includes(clean)) {
    currentList.push(clean);
    persistSettings({ ignoredAliases: currentList });
  }
  renderSettingsChips();
}

function renderChipsForGroup(wrapperEl, inputEl, tagList, onRemove) {
  if (!wrapperEl || !inputEl) return;
  wrapperEl.querySelectorAll('.tag-chip').forEach(c => c.remove());
  tagList.forEach(tag => {
    const chip = document.createElement('div');
    chip.className = 'tag-chip';
    chip.innerHTML = `
      <span>${escapeHtml(tag)}</span>
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

  renderChipsForGroup(
    document.getElementById('ignoredAliasesWrapper'),
    document.getElementById('ignoredAliasesInput'),
    tempIgnoredAliases,
    (tag) => { tempIgnoredAliases = tempIgnoredAliases.filter(t => t !== tag); renderSettingsChips(); }
  );
}

// Wire the chip inputs and the per-list reset buttons; called once from initSettingsModal
export function initTagListInputs() {
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
  setupTagInput('ignoredAliasesInput', 'ignoredAliasesWrapper', () => tempIgnoredAliases, (l) => { tempIgnoredAliases = l; });

  const resetButtons = [
    { id: 'btnResetBlacklist', list: () => [...DEFAULT_BLACKLIST], msg: 'set.blacklistReset', fallback: 'Черный список сброшен к стандартному' },
    { id: 'btnResetAiTags', list: () => [...DEFAULT_AI_TAGS], msg: 'set.aiTagsReset', fallback: 'Теги ИИ сброшены к стандартным' },
    { id: 'btnResetCurvyTags', list: () => [...DEFAULT_CURVY_TAGS], msg: 'set.curvyReset', fallback: 'Слова для «Пышные» сброшены к стандартным' },
    { id: 'btnResetPetiteTags', list: () => [...DEFAULT_PETITE_TAGS], msg: 'set.petiteReset', fallback: 'Слова для «Миниатюрные» сброшены к стандартным' },
    { id: 'btnResetFurryTags', list: () => [...DEFAULT_FURRY_TAGS], msg: 'set.furryReset', fallback: 'Слова для «Фурри» сброшены к стандартным' },
    { id: 'btnResetPregnantTags', list: () => [...DEFAULT_PREGNANT_TAGS], msg: 'set.pregnantReset', fallback: 'Слова для «Беременность» сброшены к стандартным' },
    { id: 'btnResetLgbtTags', list: () => [...DEFAULT_LGBT_TAGS], msg: 'set.lgbtReset', fallback: 'Слова для «ЛГБТ» сброшены к стандартным' }
  ];
  const setters = {
    btnResetBlacklist: (l) => { tempBlacklist = l; },
    btnResetAiTags: (l) => { tempAiTags = l; },
    btnResetCurvyTags: (l) => { tempCurvyTags = l; },
    btnResetPetiteTags: (l) => { tempPetiteTags = l; },
    btnResetFurryTags: (l) => { tempFurryTags = l; },
    btnResetPregnantTags: (l) => { tempPregnantTags = l; },
    btnResetLgbtTags: (l) => { tempLgbtTags = l; }
  };
  resetButtons.forEach(({ id, list, msg, fallback }) => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.addEventListener('click', () => {
        setters[id](list());
        renderSettingsChips();
        showToast(t(msg, fallback));
      });
    }
  });

  const btnResetIgnoredAliases = document.getElementById('btnResetIgnoredAliases');
  if (btnResetIgnoredAliases) {
    btnResetIgnoredAliases.addEventListener('click', () => {
      tempIgnoredAliases = [];
      renderSettingsChips();
      showToast(t('set.ignoredAliasesReset', 'Список запрещённых алиасов очищен'));
    });
  }

  const btnResetCustomAliases = document.getElementById('btnResetCustomAliases');
  if (btnResetCustomAliases) {
    btnResetCustomAliases.addEventListener('click', () => {
      const customAliasesInput = document.getElementById('customAliasesInput');
      if (customAliasesInput) customAliasesInput.value = '';
      showToast(t('set.customAliasesReset', 'Пользовательские алиасы очищены'));
    });
  }

  const btnClearDiscoveredAliases = document.getElementById('btnClearDiscoveredAliases');
  if (btnClearDiscoveredAliases) {
    btnClearDiscoveredAliases.addEventListener('click', async () => {
      const res = await clearDiscoveredAliasesApi();
      if (res && res.success) {
        const countEl = document.getElementById('discoveredAliasesCountText');
        if (countEl) countEl.textContent = '0';
        showToast(t('set.discoveredAliasesCleared', 'Кэш автопоиска алиасов очищен'));
      }
    });
  }
}
