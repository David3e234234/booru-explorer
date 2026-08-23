import { fetchTagAutocomplete } from './api.js';
import { state, addSearchTag, removeSearchTag } from './state.js';

export function initAutocomplete({ onSearch }) {
  const searchInput = document.getElementById('searchInput');
  const tagsWrapper = document.getElementById('searchTagsWrapper');
  const dropdown = document.getElementById('autocompleteDropdown');
  const btnClear = document.getElementById('btnClearSearch');

  let debounceTimer = null;
  let activeIndex = -1;
  let currentSuggestions = [];
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
  }

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
      hideDropdown();
      return;
    }

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
      try {
        const data = await fetchTagAutocomplete(normalizedVal, state.currentSite);
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
        hideDropdown();
      }
    }, 80);
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
      onSearch();
    } else if (e.key === 'Escape') {
      hideDropdown();
    }
  });

  function renderDropdown(tags) {
    if (!tags || tags.length === 0) {
      hideDropdown();
      return;
    }
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
        onSearch();
      }
    }
  }

  function hideDropdown() {
    dropdown.style.display = 'none';
    activeIndex = -1;
    currentSuggestions = [];
  }

  btnClear.addEventListener('click', () => {
    state.searchTags = [];
    searchInput.value = '';
    renderTagsChips();
    hideDropdown();
  });

  document.addEventListener('click', (e) => {
    if (!tagsWrapper.contains(e.target) && !dropdown.contains(e.target)) {
      hideDropdown();
    }
  });

  return {
    renderTagsChips,
    selectTag
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
