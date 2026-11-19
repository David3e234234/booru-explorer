import { fetchTagAutocomplete } from './api.js';
import { state, addSearchTag, removeSearchTag } from './state.js';
import { t } from './i18n.js';

const SEARCH_HISTORY_KEY = 'booru_search_history_v1';
const MAX_SEARCH_HISTORY = 20;

export function getSearchHistory() {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(item => item && Array.isArray(item.tags) && item.tags.length > 0) : [];
  } catch {
    return [];
  }
}

export function recordSearchHistory(tags, site) {
  if (!Array.isArray(tags) || tags.length === 0) return;
  const cleanTags = tags.map(t => String(t || '').trim()).filter(Boolean);
  if (cleanTags.length === 0) return;

  try {
    const current = getSearchHistory();
    const tagKey = cleanTags.slice().sort().join(' ').toLowerCase();
    const siteKey = String(site || '').toLowerCase();

    const filtered = current.filter(item => {
      const itemTagKey = (item.tags || []).slice().sort().join(' ').toLowerCase();
      const itemSiteKey = String(item.site || '').toLowerCase();
      return !(itemTagKey === tagKey && itemSiteKey === siteKey);
    });

    filtered.unshift({
      tags: cleanTags,
      site: site || 'danbooru',
      ts: Date.now()
    });

    if (filtered.length > MAX_SEARCH_HISTORY) {
      filtered.length = MAX_SEARCH_HISTORY;
    }
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(filtered));
  } catch (err) {
    console.warn('[Search History Error]', err);
  }
}

export function removeSearchHistoryItem(idx) {
  try {
    const current = getSearchHistory();
    if (idx >= 0 && idx < current.length) {
      current.splice(idx, 1);
      localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(current));
    }
    return current;
  } catch {
    return [];
  }
}

export function clearSearchHistory() {
  try {
    localStorage.removeItem(SEARCH_HISTORY_KEY);
  } catch {}
}

export function initAutocomplete({ onSearch, onTagsChanged }) {
  const searchInput = document.getElementById('searchInput');
  const tagsWrapper = document.getElementById('searchTagsWrapper');
  const dropdown = document.getElementById('autocompleteDropdown');
  const btnClear = document.getElementById('btnClearSearch');

  let debounceTimer = null;
  let requestSeq = 0;
  let activeIndex = -1;
  let currentSuggestions = [];
  let isShowingHistory = false;
  let activeAbortController = null;
  const suggestionsCache = new Map(); // Fast client-side suggestion cache

  function renderTagsChips() {
    // Remove old chips
    const existingChips = tagsWrapper.querySelectorAll('.tag-chip');
    existingChips.forEach(c => c.remove());

    // Insert current ones before the input
    state.searchTags.forEach(tag => {
      const chip = document.createElement('div');
      chip.className = 'tag-chip';
      chip.innerHTML = `
        <span>${escapeHtml(tag)}</span>
        <span class="tag-chip-remove" data-tag="${escapeHtml(tag)}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </span>
      `;
      tagsWrapper.insertBefore(chip, searchInput);
    });

    btnClear.style.display = (state.searchTags.length > 0 || searchInput.value) ? 'flex' : 'none';
    if (typeof onTagsChanged === 'function') {
      onTagsChanged();
    }
  }

  function renderHistoryDropdown() {
    const history = getSearchHistory();
    if (!history || history.length === 0) {
      hideDropdown();
      return;
    }
    isShowingHistory = true;
    activeIndex = -1;
    currentSuggestions = [];

    dropdown.innerHTML = `
      <div class="autocomplete-history-header">
        <span class="ac-history-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>${escapeHtml(t('search.recentQueries', 'Недавние поиски'))}</span>
        </span>
        <button type="button" class="btn-clear-search-history" title="${escapeHtml(t('search.clearHistory', 'Очистить'))}">${escapeHtml(t('search.clearHistory', 'Очистить'))}</button>
      </div>
      <div class="autocomplete-history-list">
        ${history.map((item, idx) => `
          <div class="autocomplete-item autocomplete-history-item" data-index="${idx}">
            <div class="ac-history-left">
              <svg class="ac-history-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <div class="ac-history-tags">
                ${item.tags.map(tag => `<span class="ac-history-tag">${escapeHtml(tag)}</span>`).join('')}
              </div>
              ${item.site && item.site !== 'all' ? `<span class="ac-history-site">${escapeHtml(item.site)}</span>` : ''}
            </div>
            <button type="button" class="ac-history-remove" data-index="${idx}" title="${escapeHtml(t('search.removeFromHistory', 'Удалить из истории'))}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        `).join('')}
      </div>
    `;

    dropdown.style.display = 'block';

    const clearBtn = dropdown.querySelector('.btn-clear-search-history');
    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearSearchHistory();
        hideDropdown();
      });
    }

    dropdown.querySelectorAll('.ac-history-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        removeSearchHistoryItem(idx);
        renderHistoryDropdown();
      });
    });

    dropdown.querySelectorAll('.autocomplete-history-item').forEach(item => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.index, 10);
        const hist = getSearchHistory();
        const selected = hist[idx];
        if (selected && Array.isArray(selected.tags)) {
          state.searchTags = [...selected.tags];
          searchInput.value = '';
          renderTagsChips();
          hideDropdown();
          recordSearchHistory(state.searchTags, state.currentSite);
          onSearch();
        }
      });
    });
  }

  const showHistoryIfEmpty = () => {
    if (!searchInput.value.trim() && state.searchTags.length === 0) {
      renderHistoryDropdown();
    }
  };

  searchInput.addEventListener('focus', showHistoryIfEmpty);
  searchInput.addEventListener('click', showHistoryIfEmpty);

  tagsWrapper.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.tag-chip-remove');
    if (removeBtn) {
      const tag = removeBtn.dataset.tag;
      removeSearchTag(tag);
      renderTagsChips();
    } else {
      searchInput.focus();
    }
  });

  searchInput.addEventListener('input', () => {
    const val = searchInput.value.trim();
    btnClear.style.display = (state.searchTags.length > 0 || val) ? 'flex' : 'none';

    clearTimeout(debounceTimer);
    if (!val) {
      requestSeq += 1;
      if (state.searchTags.length === 0) {
        renderHistoryDropdown();
      } else {
        hideDropdown();
      }
      return;
    }

    isShowingHistory = false;
    const normalizedVal = val.replace(/\s+/g, '_');
    const cacheKey = `${state.currentSite}:${normalizedVal.toLowerCase()}`;
    if (suggestionsCache.has(cacheKey)) {
      const cached = suggestionsCache.get(cacheKey);
      if (Array.isArray(cached) && cached.length > 0) {
        currentSuggestions = cached;
        renderDropdown(currentSuggestions);
        return;
      }
    }

    debounceTimer = setTimeout(async () => {
      const seq = ++requestSeq;
      if (activeAbortController) activeAbortController.abort();
      activeAbortController = new AbortController();
      try {
        const data = await fetchTagAutocomplete(normalizedVal, state.currentSite);
        if (seq !== requestSeq || normalizedVal !== searchInput.value.trim().replace(/\s+/g, '_')) return;
        currentSuggestions = data.tags || [];
        if (currentSuggestions.length > 0) {
          if (suggestionsCache.size > 200) {
            const firstKey = suggestionsCache.keys().next().value;
            suggestionsCache.delete(firstKey);
          }
          suggestionsCache.set(cacheKey, currentSuggestions);
        }
        renderDropdown(currentSuggestions);
      } catch (err) {
        if (err?.name !== 'AbortError') hideDropdown();
      }
    }, 150);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !searchInput.value && state.searchTags.length > 0) {
      state.searchTags.pop();
      renderTagsChips();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentSuggestions.length > 0) {
        activeIndex = (activeIndex + 1) % currentSuggestions.length;
        updateActiveItem();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentSuggestions.length > 0) {
        activeIndex = (activeIndex - 1 + currentSuggestions.length) % currentSuggestions.length;
        updateActiveItem();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && currentSuggestions[activeIndex]) {
        selectTag(currentSuggestions[activeIndex].value, false);
      } else if (searchInput.value.trim()) {
        selectTag(searchInput.value.trim(), false);
      }
      hideDropdown();
    } else if (e.key === 'Escape') {
      hideDropdown();
    }
  });

  function renderDropdown(tags) {
    if (!tags || tags.length === 0) {
      hideDropdown();
      return;
    }
    isShowingHistory = false;
    activeIndex = -1;
    dropdown.innerHTML = tags.map((t, idx) => `
      <div class="autocomplete-item" data-index="${idx}" data-val="${escapeHtml(t.value)}">
        <span class="ac-tag-name category-${t.category || 'general'}">${escapeHtml(t.label || t.value)}</span>
        ${t.count ? `<span class="ac-tag-count">${formatNumber(t.count)}</span>` : ''}
      </div>
    `).join('');

    dropdown.style.display = 'block';

    dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
      item.addEventListener('click', () => {
        selectTag(item.dataset.val, false);
      });
    });
  }

  function updateActiveItem() {
    const items = dropdown.querySelectorAll('.autocomplete-item');
    items.forEach((it, idx) => {
      it.classList.toggle('selected', idx === activeIndex);
    });
    if (activeIndex >= 0 && items[activeIndex]) {
      items[activeIndex].scrollIntoView({ block: 'nearest' });
    }
  }

  function selectTag(val, triggerSearch = false) {
    if (addSearchTag(val)) {
      searchInput.value = '';
      renderTagsChips();
      hideDropdown();
      if (triggerSearch) {
        recordSearchHistory(state.searchTags, state.currentSite);
        onSearch();
      }
    }
  }

  function hideDropdown() {
    dropdown.style.display = 'none';
    activeIndex = -1;
    currentSuggestions = [];
    isShowingHistory = false;
  }

  function clear() {
    state.searchTags = [];
    searchInput.value = '';
    renderTagsChips();
    hideDropdown();
  }

  btnClear.addEventListener('click', clear);

  document.addEventListener('click', (e) => {
    if (!tagsWrapper.contains(e.target) && !dropdown.contains(e.target)) {
      hideDropdown();
    }
  });

  return {
    renderTagsChips,
    selectTag,
    clear,
    clearTags: clear,
    recordSearch: (tags, site) => recordSearchHistory(tags, site),
    getHistory: getSearchHistory
  };
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return String(num);
}
