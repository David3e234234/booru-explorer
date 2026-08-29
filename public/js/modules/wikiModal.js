import { showToast } from './uiUtils.js';
import { t } from '../i18n.js';

export function initWikiModal({ onSelectTag, onSwitchSite }) {
  const modalBackdrop = document.getElementById('modalWikiBackdrop');
  const btnClose = document.getElementById('btnCloseWikiModal');
  const btnHeaderWiki = document.getElementById('btnHeaderWiki');
  const wikiTabs = modalBackdrop?.querySelectorAll('.wiki-tab-btn');
  const wikiPanes = modalBackdrop?.querySelectorAll('.wiki-tab-pane');
  const wikiSearchInput = document.getElementById('wikiSearchInput');
  const btnClearWikiSearch = document.getElementById('btnClearWikiSearch');

  function openWiki(tab = 'tag-basics') {
    if (!modalBackdrop) return;
    switchTab(tab);
    if (wikiSearchInput) wikiSearchInput.value = '';
    filterWikiCards('');
    modalBackdrop.style.display = 'flex';
  }

  function closeWiki() {
    if (!modalBackdrop) return;
    modalBackdrop.style.display = 'none';
  }

  function switchTab(tabId) {
    wikiTabs?.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    wikiPanes?.forEach(pane => {
      pane.style.display = pane.id === `wikiPane-${tabId}` ? 'block' : 'none';
    });
  }

  function filterWikiCards(query) {
    const q = (query || '').toLowerCase().trim();
    if (btnClearWikiSearch) {
      btnClearWikiSearch.style.display = q ? 'flex' : 'none';
    }

    const cards = modalBackdrop?.querySelectorAll('.wiki-card, .wiki-source-card');
    cards?.forEach(card => {
      if (!q) {
        card.style.display = '';
        return;
      }
      const text = card.textContent.toLowerCase();
      card.style.display = text.includes(q) ? '' : 'none';
    });
  }

  // Event Listeners
  btnHeaderWiki?.addEventListener('click', () => openWiki('tag-basics'));
  btnClose?.addEventListener('click', closeWiki);

  modalBackdrop?.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) closeWiki();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalBackdrop?.style.display === 'flex') {
      closeWiki();
    }
  });

  wikiTabs?.forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });

  wikiSearchInput?.addEventListener('input', (e) => {
    filterWikiCards(e.target.value);
  });

  btnClearWikiSearch?.addEventListener('click', () => {
    if (wikiSearchInput) {
      wikiSearchInput.value = '';
      filterWikiCards('');
      wikiSearchInput.focus();
    }
  });

  // Delegate clicks on interactive tag pills and source switches
  modalBackdrop?.addEventListener('click', (e) => {
    const tagEl = e.target.closest('.wiki-tag-example');
    if (tagEl) {
      const tag = tagEl.dataset.tag || tagEl.textContent.trim();
      if (tag) {
        if (typeof onSelectTag === 'function') {
          onSelectTag(tag);
          closeWiki();
          showToast(t('wiki.tagAdded', 'Тег {tag} добавлен в поиск').replace('{tag}', tag), 'success');
        }
      }
      return;
    }

    const switchSiteEl = e.target.closest('.btn-wiki-switch-site');
    if (switchSiteEl) {
      const site = switchSiteEl.dataset.site;
      if (site && typeof onSwitchSite === 'function') {
        onSwitchSite(site);
        closeWiki();
        showToast(t('wiki.siteSwitched', 'Источник переключен на {site}').replace('{site}', site), 'info');
      }
    }
  });

  return {
    open: openWiki,
    close: closeWiki
  };
}
