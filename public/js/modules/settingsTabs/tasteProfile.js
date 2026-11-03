// Taste profile ("Recommendations" section): the interest weight chips, the
// excluded-tag list and the recommendation mode / skip-penalty controls.
import { state, getUserInterestTags, excludeInterestTag, restoreInterestTag, resetExcludedInterestTags, clearSessionInterests, saveLocalSettings } from '../../state.js';
import { saveSettings } from '../../api.js';
import { t } from '../../i18n.js';
import { showToast, escapeHtml } from '../uiUtils.js';

export function renderTasteProfileUI() {
  const checkRecSkipPenalty = document.getElementById('checkRecSkipPenalty');
  if (checkRecSkipPenalty) {
    checkRecSkipPenalty.checked = state.settings?.recommendationEnableSkipPenalty !== false;
  }

  const container = document.getElementById('recInterestsContainer');
  const countEl = document.getElementById('recInterestsCount');
  if (container) {
    const topInterests = getUserInterestTags(20);
    if (countEl) countEl.textContent = String(topInterests.length);

    if (topInterests.length === 0) {
      container.innerHTML = `<span class="text-muted" style="font-size: 12px;">${t('settings.noInterests', 'Лайкайте арты, чтобы сформировать профиль вкусов.')}</span>`;
    } else {
      container.innerHTML = topInterests.map(item => {
        const catClass = item.category === 'artist' ? 'chip-artist' : item.category === 'character' ? 'chip-char' : item.category === 'copyright' ? 'chip-cp' : 'chip-general';
        const displayTag = item.category === 'artist' ? `@${item.tag}` : item.tag;
        return `
          <div class="rec-interest-chip ${catClass}" title="${escapeHtml(t('settings.interestWeight', 'Вес интереса: {s}').replace('{s}', item.score.toFixed(1)))}">
            <span class="rec-chip-label">${escapeHtml(displayTag)}</span>
            <span class="rec-chip-score">${escapeHtml(item.score.toFixed(1))}</span>
            <button type="button" class="btn-rec-chip-remove" data-tag="${escapeHtml(item.tag)}" title="${escapeHtml(t('settings.excludeTagBtn', 'Исключить из рекомендаций'))}">×</button>
          </div>
        `;
      }).join('');

      container.querySelectorAll('.btn-rec-chip-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const tag = btn.dataset.tag;
          if (!tag) return;
          excludeInterestTag(tag);
          renderTasteProfileUI();
          showToast(t('gal.matchPopover.toastExcluded', 'Тег {t} исключен из рекомендаций').replace('{t}', tag));
        });
      });
    }
  }

  const excludedContainer = document.getElementById('recExcludedContainer');
  if (excludedContainer) {
    const excludedTags = Array.isArray(state.settings?.excludedInterestTags) ? state.settings.excludedInterestTags : [];
    if (excludedTags.length === 0) {
      excludedContainer.innerHTML = `<span class="text-muted" style="font-size: 12px;">${t('settings.noExcludedTags', 'Нет исключенных тегов')}</span>`;
    } else {
      excludedContainer.innerHTML = excludedTags.map(tag => {
        return `
          <div class="rec-excluded-chip">
            <span class="rec-chip-label">${escapeHtml(tag)}</span>
            <button type="button" class="btn-rec-chip-restore" data-tag="${escapeHtml(tag)}" title="${escapeHtml(t('settings.restoreTagBtn', 'Восстановить в рекомендациях'))}">✕</button>
          </div>
        `;
      }).join('');

      excludedContainer.querySelectorAll('.btn-rec-chip-restore').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const tag = btn.dataset.tag;
          if (!tag) return;
          restoreInterestTag(tag);
          renderTasteProfileUI();
          showToast(t('gal.matchPopover.toastRestored', 'Тег {t} возвращен в рекомендации').replace('{t}', tag));
        });
      });
    }
  }
}

// Wire the taste-profile controls; called once from initSettingsModal
export function initTasteProfileControls({ onSettingsChanged }) {
  const selectRecommendationMode = document.getElementById('selectRecommendationMode');
  if (selectRecommendationMode) {
    selectRecommendationMode.addEventListener('change', () => {
      const val = selectRecommendationMode.value;
      state.settings.recommendationMode = val;
      state.settings.enableRecommendations = val !== 'off';
      saveLocalSettings(state.settings);
      saveSettings(state.settings).catch(() => {});
      if (onSettingsChanged) onSettingsChanged();
    });
  }

  const btnResetExcludedRecTags = document.getElementById('btnResetExcludedRecTags');
  if (btnResetExcludedRecTags) {
    btnResetExcludedRecTags.addEventListener('click', () => {
      resetExcludedInterestTags();
      renderTasteProfileUI();
      showToast(t('settings.excludedCleared', 'Список исключений очищен'));
    });
  }

  const btnClearSessionInterests = document.getElementById('btnClearSessionInterests');
  if (btnClearSessionInterests) {
    btnClearSessionInterests.addEventListener('click', () => {
      clearSessionInterests();
      renderTasteProfileUI();
      showToast(t('settings.sessionCleared', 'Сессионная память вкусов очищена'));
    });
  }

  const checkRecSkipPenalty = document.getElementById('checkRecSkipPenalty');
  if (checkRecSkipPenalty) {
    checkRecSkipPenalty.addEventListener('change', () => {
      if (!state.settings) state.settings = {};
      state.settings.recommendationEnableSkipPenalty = checkRecSkipPenalty.checked;
      saveLocalSettings({ recommendationEnableSkipPenalty: checkRecSkipPenalty.checked });
    });
  }
}
