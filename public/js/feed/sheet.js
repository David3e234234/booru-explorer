// Feed info sheet: tags with categories, author actions and post links.
// Tag classification reuses the viewer's helpers so booru categories stay
// consistent between the feed and the desktop viewer.
import { t } from '../i18n.js';
import { state } from '../state.js';
import { showToast, copyToClipboard, escapeHtml, toSafeHttpUrl, getPostSiteUrl } from '../modules/uiUtils.js';
import { CATEGORY_ORDER, CATEGORY_CONFIG, getTagCategory, formatRating } from '../viewer/viewerSidebar.js';
import { handleAuthorFavToggle } from '../viewer/viewerMetadata.js';
import { openCreatorResolverModal } from '../viewer/viewerCreatorResolver.js';

export function initFeedSheet(hooks) {
  const sheet = document.createElement('div');
  sheet.className = 'feed-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', t('feed.info.sheetTitle', 'Информация о посте'));
  sheet.innerHTML = `
    <div class="feed-sheet-backdrop" data-close="1"></div>
    <div class="feed-sheet-panel">
      <div class="feed-sheet-handle"></div>
      <div class="feed-sheet-header">
        <h3 class="feed-sheet-title" data-i18n="feed.info.sheetTitle">Информация о посте</h3>
        <button type="button" class="feed-sheet-close" data-close="1" aria-label="${t('modal.close', 'Закрыть')}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="feed-sheet-body"></div>
    </div>
  `;

  document.body.appendChild(sheet);
  sheet.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeFeedSheet();
  });

  let currentPost = null;

  function openFor(post) {
    currentPost = post;
    renderBody(post);
    sheet.classList.add('open');
    const closeBtn = sheet.querySelector('.feed-sheet-close');
    if (closeBtn) closeBtn.focus();
  }

  function closeFeedSheet() {
    sheet.classList.remove('open');
    currentPost = null;
  }

  function isOpen() {
    return sheet.classList.contains('open');
  }

  function handleKeydown(e) {
    if (e.key === 'Escape' && isOpen()) {
      closeFeedSheet();
      return true;
    }
    return false;
  }

  function renderBody(post) {
    const body = sheet.querySelector('.feed-sheet-body');
    if (!body || !post) return;
    body.innerHTML = '';

    // Post header: author, site, resolution, rating.
    const author = post.author || '';
    const metaRow = document.createElement('div');
    metaRow.className = 'feed-sheet-meta';
    const res = (post.width && post.height) ? `${post.width} × ${post.height}` : t('vw.original', 'Оригинал');
    const rating = formatRating(post.rating);
    metaRow.innerHTML = `
      <div class="feed-sheet-author-row">
        ${author ? `<button type="button" class="feed-sheet-author" data-author="${escapeHtml(author)}">${escapeHtml(author)}</button>` : `<span class="feed-sheet-author feed-sheet-author-empty">${t('viewer.authorNotSpecified', 'автор не указан')}</span>`}
        <span class="feed-sheet-site">${escapeHtml(post.siteName || post.site || '')}</span>
      </div>
      <div class="feed-sheet-facts">
        <span class="feed-sheet-fact mono">${escapeHtml(res)}</span>
        <span class="feed-sheet-fact mono">${escapeHtml(String((post.fileExt || 'jpg').toUpperCase()))}</span>
        ${rating ? `<span class="feed-sheet-fact">${escapeHtml(rating)}</span>` : ''}
        ${post.score ? `<span class="feed-sheet-fact mono">★ ${escapeHtml(String(post.score))}</span>` : ''}
      </div>
    `;
    body.appendChild(metaRow);

    // Author actions: favourite author / find original on Kemono / Pawchive.
    if (author) {
      const actions = document.createElement('div');
      actions.className = 'feed-sheet-actions';
      const isFav = state.favoriteAuthorNames?.has(author.toLowerCase().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_'));
      const favBtn = document.createElement('button');
      favBtn.type = 'button';
      favBtn.className = 'feed-sheet-action' + (isFav ? ' active' : '');
      favBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><use href="#${isFav ? 'ic-star-filled' : 'ic-star'}"/></svg><span>${isFav ? t('feed.authorUnfav', 'Убрать автора из любимых') : t('feed.authorFav', 'В любимые авторы')}</span>`;
      favBtn.addEventListener('click', async () => {
        await handleAuthorFavToggle(post, {
          onFavoriteAuthorToggle: hooks.onFavoriteAuthorToggle
        });
        const nowFav = state.favoriteAuthorNames?.has(author.toLowerCase().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_'));
        favBtn.classList.toggle('active', Boolean(nowFav));
      });
      actions.appendChild(favBtn);

      const resolverBtn = document.createElement('button');
      resolverBtn.type = 'button';
      resolverBtn.className = 'feed-sheet-action';
      resolverBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg><span>${t('viewer.findOnKemono.title', 'Найти оригинал или профиль автора на Kemono / Pawchive')}</span>`;
      resolverBtn.addEventListener('click', () => {
        openCreatorResolverModal(post, {
          onSwitchSiteAndSearch: hooks.onSwitchSiteAndSearch,
          closeViewer: () => closeFeedSheet()
        });
      });
      actions.appendChild(resolverBtn);
      body.appendChild(actions);
    }

    // Tags grouped by category.
    const tagsCloud = document.createElement('div');
    tagsCloud.className = 'feed-sheet-tags';
    const rawTags = Array.isArray(post.tags) ? post.tags.filter(x => typeof x === 'string' && x.trim()) : [];
    if (rawTags.length === 0) {
      tagsCloud.innerHTML = `<span class="feed-sheet-empty">${t('vsb.noTags', 'Теги отсутствуют')}</span>`;
    } else {
      const groups = {};
      const seen = new Set();
      rawTags.forEach(tag => {
        const clean = tag.toLowerCase().trim();
        if (seen.has(clean)) return;
        seen.add(clean);
        const cat = getTagCategory(tag, post.tagDetails, post.author, post.assistants);
        (groups[cat] = groups[cat] || []).push(tag);
      });

      CATEGORY_ORDER.forEach(catKey => {
        const list = groups[catKey];
        if (!list || list.length === 0) return;
        const config = CATEGORY_CONFIG[catKey];
        const groupEl = document.createElement('div');
        groupEl.className = `feed-tag-group group-${catKey}`;
        const header = document.createElement('div');
        header.className = 'feed-tag-group-header';
        header.innerHTML = `<span class="${config.colorClass}">${config.label}</span><span class="feed-tag-count mono">${list.length}</span>`;
        groupEl.appendChild(header);
        const chips = document.createElement('div');
        chips.className = 'feed-tag-chips';
        list.forEach(tag => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = `feed-tag-chip ${config.tagClass}`;
          chip.textContent = tag;
          chip.addEventListener('click', () => {
            closeFeedSheet();
            hooks.onTagSelect(tag);
          });
          chips.appendChild(chip);
        });
        groupEl.appendChild(chips);
        tagsCloud.appendChild(groupEl);
      });
    }
    body.appendChild(tagsCloud);

    // Links: open on the board, copy link.
    const links = document.createElement('div');
    links.className = 'feed-sheet-links';
    const siteUrl = getPostSiteUrl(post);
    if (siteUrl) {
      const openBtn = document.createElement('a');
      openBtn.className = 'feed-sheet-link';
      openBtn.href = toSafeHttpUrl(siteUrl) || '#';
      openBtn.target = '_blank';
      openBtn.rel = 'noopener noreferrer';
      openBtn.textContent = t('feed.openOnSite', 'Открыть на сайте');
      links.appendChild(openBtn);
    }
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'feed-sheet-link';
    copyBtn.textContent = t('feed.copyLink', 'Скопировать ссылку');
    copyBtn.addEventListener('click', async () => {
      const url = getPostSiteUrl(post) || window.location.href;
      const ok = await copyToClipboard(url);
      showToast(ok ? t('feed.copied', 'Скопировано: ') + url : t('feed.copyFailed', 'Не удалось скопировать'), ok ? 'info' : 'error');
    });
    links.appendChild(copyBtn);
    body.appendChild(links);

    if (post.content) {
      const desc = document.createElement('div');
      desc.className = 'feed-sheet-desc';
      desc.textContent = String(post.content);
      body.appendChild(desc);
    }
  }

  return {
    openFor,
    close: closeFeedSheet,
    isOpen,
    handleKeydown,
    destroy() {
      sheet.remove();
    }
  };
}
