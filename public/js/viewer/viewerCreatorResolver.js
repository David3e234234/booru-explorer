import { t } from '../i18n.js';
import { haptic, toSafeHttpUrl } from '../modules/uiUtils.js';
import { getAuthHeaders } from '../api.js';

let activeAbortController = null;
let escHandler = null;

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrlAttr(value) {
  return escapeAttr(toSafeHttpUrl(value));
}

function getConfidenceBadge(confidence, matchReason) {
  if (confidence === 'high' || matchReason === 'exact_id') {
    return `<span class="cr-confidence-badge cr-confidence-high" title="${escapeAttr(t('viewer.confidenceExact', 'Точное совпадение по ID/источнику'))}">${t('viewer.confidenceExact', 'Точное совпадение')}</span>`;
  }
  if (confidence === 'medium' || matchReason === 'exact_name' || matchReason === 'normalized_name') {
    return `<span class="cr-confidence-badge cr-confidence-medium" title="${escapeAttr(t('viewer.confidenceMedium', 'Совпадение по имени'))}">${t('viewer.confidenceMedium', 'По имени')}</span>`;
  }
  return `<span class="cr-confidence-badge cr-confidence-fuzzy" title="${escapeAttr(t('viewer.confidenceFuzzy', 'Похожее имя'))}">${t('viewer.confidenceFuzzy', 'Похожее')}</span>`;
}

function getServiceClass(service) {
  const s = String(service || '').toLowerCase();
  if (s === 'patreon') return 'cr-service-patreon';
  if (s === 'fanbox') return 'cr-service-fanbox';
  if (s === 'fantia') return 'cr-service-fantia';
  if (s === 'boosty') return 'cr-service-boosty';
  if (s === 'gumroad') return 'cr-service-gumroad';
  if (s === 'discord') return 'cr-service-discord';
  return 'cr-service-other';
}

function formatFavorited(count) {
  const n = parseInt(count, 10) || 0;
  if (n <= 0) return '';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/**
 * Closes the creator resolver modal.
 */
export function closeCreatorResolverModal() {
  const modal = document.getElementById('creatorResolverModal');
  const backdrop = document.getElementById('creatorResolverBackdrop');
  if (modal) modal.style.display = 'none';
  if (backdrop) backdrop.style.display = 'none';

  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }

  if (escHandler) {
    document.removeEventListener('keydown', escHandler);
    escHandler = null;
  }
}

/**
 * Opens and renders the creator resolver modal for the given post.
 *
 * @param {Object} currentPost - The currently viewed post
 * @param {Object} callbacks
 * @param {Function} [callbacks.onSwitchSiteAndSearch] - Callback when user chooses to search in-app
 * @param {Function} [callbacks.closeViewer] - Closes the main media viewer
 */
export function openCreatorResolverModal(currentPost, { onSwitchSiteAndSearch, closeViewer } = {}) {
  const modal = document.getElementById('creatorResolverModal');
  const backdrop = document.getElementById('creatorResolverBackdrop');
  const body = document.getElementById('creatorResolverBody');
  const btnClose = document.getElementById('btnCloseCreatorResolverModal');

  if (!modal || !body) return;

  // Abort any ongoing resolve request
  if (activeAbortController) {
    activeAbortController.abort();
  }
  activeAbortController = new AbortController();

  modal.style.display = 'flex';
  modal.style.zIndex = '100010';
  if (backdrop) backdrop.style.display = 'block';

  // Backdrop and Close Button listeners
  if (backdrop) backdrop.onclick = () => closeCreatorResolverModal();
  if (btnClose) btnClose.onclick = () => closeCreatorResolverModal();
  modal.onclick = (e) => {
    if (e.target === modal) closeCreatorResolverModal();
  };

  // Esc listener
  if (escHandler) document.removeEventListener('keydown', escHandler);
  escHandler = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closeCreatorResolverModal();
    }
  };
  document.addEventListener('keydown', escHandler);

  // Initial loading state
  body.innerHTML = `
    <div class="cr-loading-state">
      <div class="cr-spinner"></div>
      <div>${t('viewer.resolverSearching', 'Поиск профилей и оригиналов на Kemono и Pawchive...')}</div>
    </div>
  `;

  let primaryVisualArtist = '';
  if (currentPost?.tagDetails?.artist && currentPost.tagDetails.artist.length > 0) {
    const visualTag = currentPost.tagDetails.artist.find(a => !/_?\((audio|sfx|sound|voice|va|music)\)$/i.test(a));
    primaryVisualArtist = visualTag || currentPost.tagDetails.artist[0];
  }

  const rawAuthor = currentPost?.author || primaryVisualArtist || '';
  const authorName = typeof rawAuthor === 'string' ? rawAuthor : (rawAuthor ? String(rawAuthor) : '');
  const authorParts = authorName.split(',').map(s => s.trim()).filter(Boolean);
  const mainAuthor = authorParts.find(a => !/\((audio|sfx|sound|voice|va|music)\)/i.test(a)) || authorParts[0] || authorName;

  const params = new URLSearchParams({
    author: mainAuthor || '',
    source: currentPost?.source || currentPost?.postUrl || '',
    site: currentPost?.site || '',
    originalId: currentPost?.originalId || currentPost?.id || ''
  });

  fetch(`/api/resolve-author-creators?${params.toString()}`, { signal: activeAbortController.signal, headers: getAuthHeaders() })
    .then(r => r.json())
    .then(data => {
      if (!data || !data.success) {
        throw new Error(data?.message || 'Failed to resolve creator');
      }
      renderResolverResults(data, currentPost, { onSwitchSiteAndSearch, closeViewer });
    })
    .catch(err => {
      if (err.name === 'AbortError') return;
      body.innerHTML = `
        <div class="cr-empty-box">
          <div>${t('viewer.resolverNotFound', 'Не удалось получить данные с сервера')}</div>
          <div class="cr-fallback-actions">
            <button class="btn-cr-fallback" id="btnCrFallbackRetry">${t('coverPicker.refresh', 'Повторить')}</button>
          </div>
        </div>
      `;
      const retryBtn = document.getElementById('btnCrFallbackRetry');
      if (retryBtn) {
        retryBtn.onclick = () => openCreatorResolverModal(currentPost, { onSwitchSiteAndSearch, closeViewer });
      }
    });
}

function renderResolverResults(data, currentPost, { onSwitchSiteAndSearch, closeViewer }) {
  const body = document.getElementById('creatorResolverBody');
  if (!body) return;

  const { author, aliases = [], detectedSources = [], kemono = [], pawchive = [], fallbackSearch = {} } = data;
  const authorDisplay = author || currentPost.author || 'Автор';

  let html = '';

  // 1. Detected Sources Bar (Patreon, Fanbox, etc.)
  if (detectedSources.length > 0) {
    html += `
      <div class="cr-sources-bar">
        <span class="cr-sources-label">${t('viewer.detectedSource', 'Источник автора:')}</span>
        ${detectedSources.map(s => `
          <a href="${safeUrlAttr(s.url)}" target="_blank" rel="noopener noreferrer" class="cr-source-chip" title="${escapeAttr(s.url)}">
            <span class="cr-service-badge ${getServiceClass(s.service)}">${escapeHtml(s.service)}</span>
            <span>${escapeHtml(s.slug || s.id || 'Ссылка')}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </a>
        `).join('')}
      </div>
    `;
  }

  // 2. Known aliases bar (if Danbooru / e621 gave other names)
  const distinctAliases = (aliases || []).filter(a => a && a.toLowerCase() !== authorDisplay.toLowerCase());
  if (distinctAliases.length > 0) {
    html += `
      <div class="cr-aliases-bar">
        <div class="cr-aliases-header">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
          <span>${t('viewer.knownAliases', 'Другие ники / псевдонимы автора:')}</span>
        </div>
        <div class="cr-aliases-list">
          ${distinctAliases.map(a => `
            <button class="cr-alias-chip btn-cr-in-app" data-site="kemono" data-query="${escapeAttr(a)}" title="Искать на Kemono по нику: ${escapeAttr(a)}">
              <span>${escapeHtml(a)}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }

  // 3. Kemono Section
  html += `
    <div class="cr-section">
      <div class="cr-section-header">
        <div class="cr-section-title">
          <span>Kemono</span>
          <span class="cr-section-badge">${kemono.length}</span>
        </div>
        <a href="${safeUrlAttr(fallbackSearch.kemonoWebUrl)}" target="_blank" rel="noopener noreferrer" class="btn-text" style="font-size: 11px;">
          ${t('viewer.openExternal', 'Открыть kemono.cr')} ↗
        </a>
      </div>
  `;

  if (kemono.length > 0) {
    html += `<div class="cr-cards-list">`;
    kemono.forEach(k => {
      const favFormatted = formatFavorited(k.favorited);
      html += `
        <div class="cr-card">
          <div class="cr-card-info">
            <div class="cr-card-top-row">
              <span class="cr-card-name" title="${escapeAttr(k.name)}">${escapeHtml(k.name)}</span>
              <span class="cr-service-badge ${getServiceClass(k.service)}">${escapeHtml(k.service)}</span>
              ${getConfidenceBadge(k.matchConfidence, k.matchReason)}
            </div>
            <div class="cr-card-meta">
              <span>ID: ${escapeHtml(k.id)}</span>
              ${favFormatted ? `<span class="cr-fav-count" title="${escapeAttr(String(k.favorited ?? 0))} избранных">♥ ${favFormatted}</span>` : ''}
            </div>
          </div>
          <div class="cr-card-actions">
            <button class="btn-cr-action btn-cr-primary btn-cr-in-app" data-site="kemono" data-query="${escapeAttr(k.searchQuery || k.name)}" title="${escapeAttr(t('viewer.openInApp.title', 'Искать работы этого автора в приложении'))}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              <span>${t('viewer.openInApp', 'В приложении')}</span>
            </button>
            <a href="${safeUrlAttr(k.url)}" target="_blank" rel="noopener noreferrer" class="btn-cr-action btn-cr-secondary" title="${escapeAttr(t('viewer.openExternal.title', 'Открыть страницу автора в новой вкладке'))}">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              <span>${t('viewer.openExternal', 'На сайте')}</span>
            </a>
          </div>
        </div>
      `;
    });
    html += `</div>`;
  } else {
    html += `
      <div class="cr-empty-box">
        <div>${t('viewer.resolverNotFound', 'Точных совпадений в каталоге Kemono не найдено')}</div>
        <div class="cr-fallback-actions">
          <button class="btn-cr-fallback btn-cr-in-app" data-site="kemono" data-query="${escapeAttr(fallbackSearch.kemonoAppQuery)}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <span>${escapeHtml(t('viewer.searchFallback', 'Искать "{author}" в Kemono').replace('{site}', 'Kemono').replace('{author}', authorDisplay))}</span>
          </button>
          <a href="${safeUrlAttr(fallbackSearch.kemonoWebUrl)}" target="_blank" rel="noopener noreferrer" class="btn-cr-fallback">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            <span>На kemono.cr</span>
          </a>
        </div>
      </div>
    `;
  }
  html += `</div>`; // end Kemono section

  // 4. Pawchive Section
  html += `
    <div class="cr-section">
      <div class="cr-section-header">
        <div class="cr-section-title">
          <span>Pawchive</span>
          <span class="cr-section-badge">${pawchive.length}</span>
        </div>
        <a href="${safeUrlAttr(fallbackSearch.pawchiveWebUrl)}" target="_blank" rel="noopener noreferrer" class="btn-text" style="font-size: 11px;">
          ${t('viewer.openExternal', 'Открыть pawchive.pw')} ↗
        </a>
      </div>
  `;

  if (pawchive.length > 0) {
    html += `<div class="cr-cards-list">`;
    pawchive.forEach(p => {
      const favFormatted = formatFavorited(p.favorited);
      html += `
        <div class="cr-card">
          <div class="cr-card-info">
            <div class="cr-card-top-row">
              <span class="cr-card-name" title="${escapeAttr(p.name)}">${escapeHtml(p.name)}</span>
              <span class="cr-service-badge ${getServiceClass(p.service)}">${escapeHtml(p.service)}</span>
              ${getConfidenceBadge(p.matchConfidence, p.matchReason)}
            </div>
            <div class="cr-card-meta">
              <span>ID: ${escapeHtml(p.id)}</span>
              ${favFormatted ? `<span class="cr-fav-count" title="${escapeAttr(String(p.favorited ?? 0))} избранных">♥ ${favFormatted}</span>` : ''}
            </div>
          </div>
          <div class="cr-card-actions">
            <button class="btn-cr-action btn-cr-primary btn-cr-in-app" data-site="pawchive" data-query="${escapeAttr(p.searchQuery || p.name)}" title="${escapeAttr(t('viewer.openInApp.title', 'Искать работы этого автора в приложении'))}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              <span>${t('viewer.openInApp', 'В приложении')}</span>
            </button>
            <a href="${safeUrlAttr(p.url)}" target="_blank" rel="noopener noreferrer" class="btn-cr-action btn-cr-secondary" title="${escapeAttr(t('viewer.openExternal.title', 'Открыть страницу автора в новой вкладке'))}">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              <span>${t('viewer.openExternal', 'На сайте')}</span>
            </a>
          </div>
        </div>
      `;
    });
    html += `</div>`;
  } else {
    html += `
      <div class="cr-empty-box">
        <div>${t('viewer.resolverNotFound', 'Точных совпадений в каталоге Pawchive не найдено')}</div>
        <div class="cr-fallback-actions">
          <button class="btn-cr-fallback btn-cr-in-app" data-site="pawchive" data-query="${escapeAttr(fallbackSearch.pawchiveAppQuery)}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <span>${escapeHtml(t('viewer.searchFallback', 'Искать "{author}" в Pawchive').replace('{site}', 'Pawchive').replace('{author}', authorDisplay))}</span>
          </button>
          <a href="${safeUrlAttr(fallbackSearch.pawchiveWebUrl)}" target="_blank" rel="noopener noreferrer" class="btn-cr-fallback">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            <span>На pawchive.pw</span>
          </a>
        </div>
      </div>
    `;
  }
  html += `</div>`; // end Pawchive section

  body.innerHTML = html;

  // Bind click handlers for "In App" buttons
  body.querySelectorAll('.btn-cr-in-app').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      haptic(15);
      const site = btn.getAttribute('data-site');
      const query = btn.getAttribute('data-query');
      closeCreatorResolverModal();
      if (typeof closeViewer === 'function') closeViewer({ skipHistoryBack: true });
      if (typeof onSwitchSiteAndSearch === 'function') {
        onSwitchSiteAndSearch(site, query);
      }
    };
  });
}
