// Phone feed: a fullscreen vertical snap feed (one post per screen) that
// replaces the modal viewer on small screens. Chrome is a light layer over the
// media: a right action rail, a bottom info block and a topbar. Gestures:
// swipe to move between posts, tap to toggle chrome, double tap to like.
import { state, isPostLiked, isPostFavorite, toggleLikeLocally, toggleDislikeLocally, markPostViewed, recordSessionInteraction } from '../state.js';
import { toggleLikePost, toggleFavoritePost, toggleDislikeApi } from '../api.js';
import { showToast, haptic, escapeHtml, copyToClipboard, getPostSiteUrl } from '../modules/uiUtils.js';
import { t } from '../i18n.js';
import { notifyFeedOpened, notifyFeedMoved, notifyFeedClosed, adoptFeedUrl } from '../router.js';
import { downloadSingleMedia } from '../viewer/viewerAlbum.js';
import { initSlides, rebuildFeed, setActiveIndex, getActiveIndex, getPostList, getActiveMediaItem, disposeAll, syncList, renderSlideContent } from './slides.js';
import { createFeedGestures } from './gestures.js';
import { initFeedSheet } from './sheet.js';

const RATING_SHORT = {
  g: '0+', general: '0+', safe: '0+',
  s: '16+', sensitive: '16+',
  q: '16+', questionable: '16+',
  e: '18+', explicit: '18+'
};

let overlay = null;
let track = null;
let closeBtn = null;
let counterEl = null;
let railEl = null;
let infoEl = null;
let authorBtn = null;
let siteChip = null;
let factsEl = null;
let tagsRow = null;
let burstLayer = null;
let emptyEl = null;

let deps = null;
let gestures = null;
let feedSheet = null;
let actionSheet = null;      // transient sheet for "more" / quick actions
let isOpen = false;
let openedInitialized = false;
let scrollRaf = false;
let lastNotifiedId = null;
const pendingMutations = new Set();

function currentPost() {
  const list = getPostList();
  const idx = getActiveIndex();
  return (idx >= 0 && idx < list.length) ? list[idx] : null;
}

function isFeedOpen() {
  return isOpen;
}

// ── DOM construction ─────────────────────────────────────────────

function buildOverlay() {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.className = 'feed-overlay';
  overlay.id = 'feedOverlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', t('feed.aria', 'Лента постов'));

  overlay.innerHTML = `
    <div class="feed-track" id="feedTrack" tabindex="-1"></div>
    <div class="feed-scrim feed-scrim-top"></div>
    <div class="feed-scrim feed-scrim-bottom"></div>
    <div class="feed-topbar">
      <button type="button" class="feed-btn feed-close-btn" id="feedCloseBtn">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="feed-counter mono" id="feedCounter"></div>
    </div>
    <div class="feed-rail" id="feedRail">
      <button type="button" class="feed-rail-btn" data-action="like" id="feedLikeBtn">
        <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-heart"/></svg>
      </button>
      <button type="button" class="feed-rail-btn" data-action="fav" id="feedFavBtn">
        <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-bookmark"/></svg>
      </button>
      <button type="button" class="feed-rail-btn" data-action="download" id="feedDownloadBtn">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </button>
      <button type="button" class="feed-rail-btn" data-action="info" id="feedInfoBtn">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      </button>
      <button type="button" class="feed-rail-btn" data-action="more" id="feedMoreBtn">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>
      </button>
    </div>
    <div class="feed-info" id="feedInfo">
      <div class="feed-info-author-row">
        <button type="button" class="feed-info-author" id="feedAuthorBtn"></button>
        <span class="feed-site-chip" id="feedSiteChip"></span>
      </div>
      <div class="feed-info-facts" id="feedFacts"></div>
      <div class="feed-info-tags" id="feedTagsRow"></div>
    </div>
    <div class="feed-burst-layer" id="feedBurstLayer"></div>
    <div class="feed-empty" id="feedEmpty" hidden>
      <div class="feed-empty-title">${t('feed.empty.title', 'Здесь пока пусто')}</div>
      <div class="feed-empty-text">${t('feed.empty.text', 'В текущих результатах нет постов.')}</div>
      <button type="button" class="feed-fallback-btn" id="feedEmptySearchBtn">${t('feed.empty.action', 'Изменить поиск')}</button>
    </div>
  `;

  document.body.appendChild(overlay);

  track = overlay.querySelector('#feedTrack');
  closeBtn = overlay.querySelector('#feedCloseBtn');
  counterEl = overlay.querySelector('#feedCounter');
  railEl = overlay.querySelector('#feedRail');
  infoEl = overlay.querySelector('#feedInfo');
  authorBtn = overlay.querySelector('#feedAuthorBtn');
  siteChip = overlay.querySelector('#feedSiteChip');
  factsEl = overlay.querySelector('#feedFacts');
  tagsRow = overlay.querySelector('#feedTagsRow');
  burstLayer = overlay.querySelector('#feedBurstLayer');
  emptyEl = overlay.querySelector('#feedEmpty');

  closeBtn.addEventListener('click', () => closeFeed());
  overlay.querySelector('#feedEmptySearchBtn').addEventListener('click', () => {
    closeFeed();
    deps.onOpenSearchDrawer?.();
  });

  railEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.feed-rail-btn');
    if (!btn) return;
    const post = currentPost();
    if (!post) return;
    switch (btn.dataset.action) {
      case 'like': performLike(post); break;
      case 'fav': performFav(post); break;
      case 'download': performDownload(post); break;
      case 'info': feedSheet.openFor(post); break;
      case 'more': openMoreSheet(post); break;
    }
  });

  authorBtn.addEventListener('click', () => {
    const post = currentPost();
    if (!post) return;
    const raw = post.author || (post.tagDetails?.artist && post.tagDetails.artist[0]) || '';
    const clean = String(raw).split(',')[0].trim().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_');
    if (!clean) return;
    closeFeed();
    deps.onAuthorSelect?.(clean);
  });

  tagsRow.addEventListener('click', (e) => {
    const chip = e.target.closest('.feed-tag-chip');
    if (!chip) return;
    const tag = chip.dataset.tag;
    if (!tag) return;
    if (chip.dataset.more) { feedSheet.openFor(currentPost()); return; }
    closeFeed();
    deps.onTagSelect?.(tag);
  });

  // Fallback card actions (archive slides, unplayable video).
  track.addEventListener('click', (e) => {
    const btn = e.target.closest('.feed-fallback-btn');
    if (!btn) return;
    const slide = btn.closest('.feed-slide');
    const idx = Number(slide?.dataset.index);
    const post = getPostList()[idx];
    if (!post) return;
    if (btn.dataset.action === 'open') {
      deps.onOpenViewer?.(idx);
    } else if (btn.dataset.action === 'download') {
      performDownload(post);
    }
  });

  // Scroll handler: rAF-throttled active-slide detection.
  track.addEventListener('scroll', () => {
    if (scrollRaf) return;
    scrollRaf = true;
    requestAnimationFrame(() => {
      scrollRaf = false;
      if (!isOpen) return;
      const h = track.clientHeight || 1;
      const idx = Math.round(track.scrollTop / h);
      if (idx !== getActiveIndex() && idx >= 0 && idx < getPostList().length) {
        setActiveIndex(idx);
      }
    });
  }, { passive: true });

  gestures = createFeedGestures({
    track,
    getActiveSlide: () => track.querySelector('.feed-slide.is-active'),
    onToggleChrome: () => overlay.classList.toggle('chrome-hidden'),
    onLike: (x, y) => {
      const post = currentPost();
      if (!post) return;
      showHeartBurst(x, y);
      if (!isPostLiked(post.id)) performLike(post);
    },
    onClose: () => closeFeed()
  });

  feedSheet = initFeedSheet({
    onTagSelect: (tag) => deps.onTagSelect?.(tag),
    onAuthorSelect: (author) => deps.onAuthorSelect?.(author),
    onFavoriteAuthorToggle: () => deps.onFavoriteAuthorToggle?.(),
    onSwitchSiteAndSearch: (site, query) => deps.onSwitchSiteAndSearch?.(site, query)
  });

  document.addEventListener('keydown', onKeydown);
  document.addEventListener('booru:langchange', refreshLabels);
}

function applyStaticLabels() {
  closeBtn.title = t('feed.close.title', 'Закрыть ленту');
  closeBtn.setAttribute('aria-label', closeBtn.title);
  const setBtn = (id, key, fallback) => {
    const btn = overlay.querySelector(id);
    if (!btn) return;
    btn.title = t(key, fallback);
    btn.setAttribute('aria-label', btn.title);
  };
  setBtn('#feedLikeBtn', 'viewer.like.title', 'Нравится');
  setBtn('#feedFavBtn', 'viewer.fav.title', 'Сохранить в закладки (Избранное)');
  setBtn('#feedDownloadBtn', 'feed.download', 'Скачать');
  setBtn('#feedInfoBtn', 'viewer.tagsToggle.title', 'Теги и информация');
  setBtn('#feedMoreBtn', 'feed.more.title', 'Ещё');
}

function refreshLabels() {
  if (!overlay) return;
  applyStaticLabels();
  const idx = getActiveIndex();
  if (idx >= 0) updateChromeForIndex(idx);
}

// ── Chrome updates ───────────────────────────────────────────────

function updateRailStates(post) {
  if (!post) return;
  const likeBtn = overlay.querySelector('#feedLikeBtn');
  const favBtn = overlay.querySelector('#feedFavBtn');
  const liked = isPostLiked(post.id);
  likeBtn.classList.toggle('active', liked);
  likeBtn.querySelector('use').setAttribute('href', liked ? '#ic-heart-filled' : '#ic-heart');
  const faved = isPostFavorite(post.id);
  favBtn.classList.toggle('active', faved);
  favBtn.querySelector('use').setAttribute('href', faved ? '#ic-bookmark-filled' : '#ic-bookmark');
}

function updateChromeForIndex(idx) {
  const list = getPostList();
  const post = list[idx];
  if (!post) return;

  counterEl.textContent = `${idx + 1} / ${list.length}`;

  const author = post.author || '';
  authorBtn.textContent = author || t('viewer.authorNotSpecified', 'автор не указан');
  authorBtn.classList.toggle('is-empty', !author);
  siteChip.textContent = post.siteName || post.site || '';

  const facts = [];
  if (post.width && post.height) facts.push(`${post.width}×${post.height}`);
  if (post.fileExt) facts.push(String(post.fileExt).toUpperCase());
  const rating = RATING_SHORT[String(post.rating || '').toLowerCase()];
  if (rating) facts.push(rating);
  if (Number(post.score) > 0) facts.push(`★ ${post.score}`);
  factsEl.innerHTML = facts.map(f => `<span class="feed-fact mono">${escapeHtml(f)}</span>`).join('');

  const tags = Array.isArray(post.tags) ? post.tags.filter(x => typeof x === 'string' && x.trim()) : [];
  const visible = tags.slice(0, 4);
  const more = tags.length - visible.length;
  tagsRow.innerHTML = visible.map(tag =>
    `<button type="button" class="feed-tag-chip" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`
  ).join('') + (more > 0
    ? `<button type="button" class="feed-tag-chip feed-tag-more" data-more="1">+${more}</button>`
    : '');

  updateRailStates(post);
}

// ── Actions ──────────────────────────────────────────────────────

async function performLike(post) {
  const key = `like:${post.id}`;
  if (pendingMutations.has(key)) return;
  pendingMutations.add(key);
  haptic([15, 20]);
  const isLikedNow = toggleLikeLocally(post);
  updateRailStates(post);
  const toast = showToast(isLikedNow ? t('vw.likedToast', 'Понравилось (рекомендации обновлены)') : t('vw.likeRemovedToast', 'Лайк удален'));
  try {
    const result = await toggleLikePost(post, isLikedNow);
    if (!result?.success) throw new Error(result?.message || 'save failed');
  } catch {
    toggleLikeLocally(post);
    updateRailStates(post);
    toast?.dismiss?.();
    showToast(t('vw.likeFailed', 'Не удалось сохранить лайк'), 'error');
  } finally {
    pendingMutations.delete(key);
  }
  deps.onFavoriteToggle?.();
}

async function performFav(post) {
  const key = `fav:${post.id}`;
  if (pendingMutations.has(key)) return;
  pendingMutations.add(key);
  haptic([15, 25, 15]);
  try {
    const desired = !isPostFavorite(post.id);
    const res = await toggleFavoritePost(post, desired);
    if (res?.success) {
      if (res.isFavorite) {
        state.favoriteIds.add(post.id);
        state.favorites.unshift({ ...post, favoritedAt: new Date().toISOString() });
        showToast(t('vw.savedToFavs', 'Сохранено в закладки'));
      } else {
        state.favoriteIds.delete(post.id);
        state.favorites = state.favorites.filter(f => f.id !== post.id);
      }
      updateRailStates(post);
    }
  } catch {
    showToast(t('gal.favoriteFailed', 'Не удалось изменить закладки'), 'error');
  } finally {
    pendingMutations.delete(key);
  }
  deps.onFavoriteToggle?.();
}

async function performDislike(post) {
  const key = `dislike:${post.id}`;
  if (pendingMutations.has(key)) return;
  pendingMutations.add(key);
  haptic(20);
  const isDislikedNow = toggleDislikeLocally(post);
  const toast = showToast(isDislikedNow
    ? t('vw.postHiddenToast', 'Пост скрыт (рекомендации обновлены)')
    : t('vw.unhiddenToast', 'Скрытие отменено'));
  if (isDislikedNow) {
    state.posts = (state.posts || []).filter(p => p && p.id !== post.id);
  }
  deps.onDislikeToggle?.(post, isDislikedNow);
  try {
    const result = await toggleDislikeApi(post, isDislikedNow);
    if (!result?.success) throw new Error(result?.message || 'hide failed');
  } catch {
    toggleDislikeLocally(post);
    if (isDislikedNow && !state.posts.some(p => p.id === post.id)) state.posts.unshift(post);
    toast?.dismiss?.();
    showToast(t('vw.hideFailed', 'Не удалось скрыть пост'), 'error');
  } finally {
    pendingMutations.delete(key);
  }
}

function performDownload(post) {
  const item = getActiveMediaItem(post);
  downloadSingleMedia(item, post);
}

function performSimilar(post) {
  deps.onFindSimilar?.(post);
}

function performOpenSite(post) {
  const url = getPostSiteUrl(post);
  if (!url) {
    showToast(t('feed.noSiteLink', 'Ссылка на пост недоступна'));
    return;
  }
  window.open(url, '_blank', 'noopener');
}

async function performCopyLink(post) {
  const url = getPostSiteUrl(post) || window.location.href;
  const ok = await copyToClipboard(url);
  showToast(ok ? `${t('feed.copied', 'Скопировано: ')}${url}` : t('feed.copyFailed', 'Не удалось скопировать'), ok ? 'info' : 'error');
}

// ── Sheets ───────────────────────────────────────────────────────

function openMoreSheet(post) {
  openActionSheet(t('feed.more.title', 'Ещё'), [
    { label: t('feed.more.dislike', 'Не интересно'), icon: '#ic-dislike', action: async () => { closeActionSheet(); await performDislike(post); } },
    { label: t('feed.more.similar', 'Похожие посты'), icon: '#ic-compass', action: () => { closeActionSheet(); performSimilar(post); } },
    { label: t('feed.openOnSite', 'Открыть на сайте'), icon: '#ic-external', action: () => { closeActionSheet(); performOpenSite(post); } },
    { label: t('feed.copyLink', 'Скопировать ссылку'), icon: '#ic-link', action: () => { closeActionSheet(); performCopyLink(post); } }
  ]);
}

export function openQuickActions(post) {
  if (!post) return;
  const liked = isPostLiked(post.id);
  const faved = isPostFavorite(post.id);
  openActionSheet(t('feed.quick.title', 'Действия'), [
    { label: liked ? t('gal.unlike.title', 'Убрать лайк') : t('gal.like.title', 'Нравится'), icon: liked ? '#ic-heart-filled' : '#ic-heart', action: async () => { closeActionSheet(); await performLike(post); } },
    { label: faved ? t('gal.unfav.title', 'Удалить из закладок') : t('gal.fav.title', 'Сохранить в закладки'), icon: faved ? '#ic-bookmark-filled' : '#ic-bookmark', action: async () => { closeActionSheet(); await performFav(post); } },
    { label: t('feed.download', 'Скачать'), icon: 'download', action: () => { closeActionSheet(); performDownload(post); } },
    { label: t('feed.more.dislike', 'Не интересно'), icon: '#ic-dislike', action: async () => { closeActionSheet(); await performDislike(post); } },
    { label: t('feed.quick.openFeed', 'Открыть в ленте'), icon: '#ic-album', action: () => {
      closeActionSheet();
      const list = deps.getList() || [];
      const idx = list.findIndex(p => p && (p.id === post.id || p.originalId === post.originalId));
      openFeed(idx >= 0 ? idx : 0);
    } }
  ]);
}

function openActionSheet(title, items) {
  closeActionSheet();
  const el = document.createElement('div');
  el.className = 'feed-sheet feed-action-sheet open';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', title);

  const rows = items.map((item, i) => `
    <button type="button" class="feed-action-row" data-row="${i}">
      <span class="feed-action-icon">${renderActionIcon(item.icon)}</span>
      <span class="feed-action-label">${escapeHtml(item.label)}</span>
    </button>
  `).join('');

  el.innerHTML = `
    <div class="feed-sheet-backdrop" data-close="1"></div>
    <div class="feed-sheet-panel">
      <div class="feed-sheet-handle"></div>
      <div class="feed-sheet-header">
        <h3 class="feed-sheet-title">${escapeHtml(title)}</h3>
        <button type="button" class="feed-sheet-close" data-close="1" aria-label="${t('modal.close', 'Закрыть')}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="feed-sheet-body feed-action-list">${rows}</div>
    </div>
  `;
  document.body.appendChild(el);
  actionSheet = el;
  const openedAt = Date.now();

  el.addEventListener('click', (e) => {
    // Ignore the synthetic click that follows a long-press release (belt and
    // braces: gallery.js already cancels it on touchend).
    if (Date.now() - openedAt < 350) return;
    if (e.target.closest('[data-close]')) { closeActionSheet(); return; }
    const row = e.target.closest('.feed-action-row');
    if (row) items[Number(row.dataset.row)]?.action?.();
  });

  // Touch devices pop the native context menu on a long hold; while the sheet
  // is up it must not appear over it.
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

function renderActionIcon(icon) {
  if (icon === 'download') {
    return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  }
  return `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><use href="${icon}"/></svg>`;
}

function closeActionSheet() {
  if (actionSheet) {
    actionSheet.remove();
    actionSheet = null;
  }
}

function isActionSheetOpen() {
  return Boolean(actionSheet);
}

function showHeartBurst(x, y) {
  if (!burstLayer) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = document.createElement('span');
  el.className = 'feed-heart-burst' + (reduced ? ' reduced' : '');
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.innerHTML = '<svg width="88" height="88" viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-heart-filled"/></svg>';
  burstLayer.appendChild(el);
  setTimeout(() => el.remove(), reduced ? 300 : 750);
}

// ── Keyboard ─────────────────────────────────────────────────────

function onKeydown(e) {
  if (!isOpen) {
    if (isActionSheetOpen() && e.key === 'Escape') closeActionSheet();
    return;
  }
  if (e.key === 'Escape') {
    if (feedSheet.isOpen()) { feedSheet.close(); return; }
    if (isActionSheetOpen()) { closeActionSheet(); return; }
    closeFeed();
    return;
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const idx = getActiveIndex() + (e.key === 'ArrowDown' ? 1 : -1);
    scrollToIndex(idx, true);
    return;
  }
  if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && feedSheet.isOpen() === false) {
    const slide = track.querySelector('.feed-slide.is-active');
    const carousel = slide?.querySelector('.feed-carousel');
    if (carousel) {
      e.preventDefault();
      carousel.scrollBy({ left: (e.key === 'ArrowRight' ? 1 : -1) * carousel.clientWidth, behavior: 'smooth' });
    }
  }
}

function scrollToIndex(idx, smooth) {
  const len = getPostList().length;
  if (idx < 0 || idx >= len) return;
  const h = track.clientHeight || 1;
  track.scrollTo({ top: idx * h, behavior: smooth ? 'smooth' : 'auto' });
}

// ── Lifecycle ────────────────────────────────────────────────────

export function initFeed(hooks) {
  deps = hooks;
  buildOverlay();
  applyStaticLabels();

  initSlides({
    trackEl: track,
    hooks: {
      renderSlide: (node, idx) => {
        renderSlideContent(node, getPostList()[idx]);
      },
      onSlideCreated: () => {},
      onSlideDispose: (node) => {
        if (node._feedVideo) { node._feedVideo.destroy(); node._feedVideo = null; }
        node._feedImg = null;
      },
      onActiveChange: (idx, prevNode) => {
        if (prevNode?._feedVideo) prevNode._feedVideo.setPlaying(false);
        const cur = track.querySelector(`.feed-slide[data-index="${idx}"]`);
        if (cur?._feedVideo) cur._feedVideo.setPlaying(true);
        gestures?.onActiveSlideChange(cur);
        updateChromeForIndex(idx);
        const post = getPostList()[idx];
        if (post) {
          if (post.id) {
            markPostViewed(post.id);
            recordSessionInteraction(post, 'view');
          }
          if (openedInitialized && post.originalId != null && post.originalId !== lastNotifiedId) {
            lastNotifiedId = post.originalId;
            notifyFeedMoved(post.originalId);
          }
        }
      },
      onEmpty: () => showEmptyState(true),
      onNearEnd: () => deps.onLoadMore?.()
    }
  });

  return {
    openFeed,
    closeFeed,
    openQuickActions,
    onListChanged,
    isFeedOpen,
    getFeedFrameIndex
  };
}

function showEmptyState(show) {
  emptyEl.hidden = !show;
  infoEl.style.display = show ? 'none' : '';
  railEl.style.display = show ? 'none' : '';
}

/**
 * Called by app.js after the results list grows (infinite scroll): extends
 * the feed with the new posts without touching the scroll position.
 */
export function onListChanged() {
  if (!isOpen) return;
  syncList(deps.getList() || []);
  const idx = getActiveIndex();
  if (idx >= 0) updateChromeForIndex(idx);
}

/**
 * Opens the feed at the given index in the current results list.
 * @param {number} index
 * @param {{ fromHistory?: boolean }} [opts]
 */
export function openFeed(index = 0, opts = {}) {
  buildOverlay();
  const wasOpen = isOpen;
  let list = deps.getList() || [];
  let startIndex = index;
  if (opts.directPost) {
    const found = list.findIndex(p => p && (p.id === opts.directPost.id || (p.originalId && p.originalId === opts.directPost.originalId)));
    if (found >= 0) {
      startIndex = found;
    } else {
      list = [opts.directPost];
      startIndex = 0;
    }
  }
  isOpen = true;
  openedInitialized = false;
  lastNotifiedId = null;
  closeActionSheet();

  overlay.classList.add('open');
  overlay.classList.remove('chrome-hidden');
  document.body.style.overflow = 'hidden';

  rebuildFeed(list, Math.max(0, Math.min(startIndex, Math.max(0, list.length - 1))));

  if (list.length === 0) {
    showEmptyState(true);
  } else {
    showEmptyState(false);
    const post = getPostList()[Math.max(0, Math.min(startIndex, list.length - 1))];
    if (post && post.originalId != null) {
      if (opts.fromHistory) {
        adoptFeedUrl(post.originalId);
      } else if (wasOpen) {
        adoptFeedUrl(post.originalId);
        notifyFeedMoved(post.originalId);
      } else {
        notifyFeedOpened(post.originalId);
      }
      lastNotifiedId = post.originalId;
    }
  }
  openedInitialized = true;
  applyStaticLabels();
  if (list.length > 0) closeBtn.focus();
}

export function closeFeed(options = {}) {
  if (!isOpen) return;
  isOpen = false;
  openedInitialized = false;
  overlay.classList.remove('open');
  document.body.style.overflow = '';
  feedSheet.close();
  closeActionSheet();
  gestures?.onActiveSlideChange(null);
  disposeAll();
  lastNotifiedId = null;
  notifyFeedClosed(options);
}

export function getFeedFrameIndex() {
  return getActiveIndex();
}

export { isFeedOpen };
