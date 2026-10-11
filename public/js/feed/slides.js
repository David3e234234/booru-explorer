// Feed slide track: every list index keeps a lightweight shell (one screen
// tall, snap-aligned) for the whole session, so the scroll geometry is always
// exactly listLength screens and scrollTop = index * slideHeight holds for any
// position. Only a small window around the active slide carries content;
// leaving the window depopulates the shell (video and zoom disposed, DOM
// cleared) without changing layout. Earlier revisions removed far slides from
// the DOM entirely, which collapsed the scrollable range: past the fourth post
// the track ran out of scroll and froze, and opening at a deep index clamped
// to the wrong post.
import { t } from '../i18n.js';
import { state } from '../state.js';
import { fetchAlbumPosts, getProxiedUrl } from '../api.js';
import { escapeHtml } from '../modules/uiUtils.js';
import { getMediaItemUrl, preloadSingleUrl } from '../viewer/viewerAlbum.js';
import { createFeedVideoPlayer } from './video.js';

const POPULATE_RADIUS = 1;    // content mounted this far around the active slide
const DEPOPULATE_RADIUS = 2;  // content outside this distance is disposed
const DEPOPULATE_DELAY_MS = 300;

let slideNodes = [];   // shell elements for every index (kept for the session)
let activeIdx = -1;
let viewport = null;   // feed-track scroll container
let slidesContainer = null;
let postList = [];
let renderCallbacks = null;
let depopulateQueue = new Set();
let depopulateTimer = null;

export function initSlides({ trackEl, hooks }) {
  viewport = trackEl;
  slidesContainer = document.createElement('div');
  slidesContainer.className = 'feed-slides';
  viewport.appendChild(slidesContainer);
  postList = [];
  slideNodes = [];
  renderCallbacks = hooks || {};
}

function createShell(i) {
  const node = document.createElement('div');
  node.className = 'feed-slide';
  node.dataset.index = String(i);
  node._populated = false;
  slidesContainer.appendChild(node);
  slideNodes[i] = node;
  return node;
}

function populateSlide(i) {
  const node = slideNodes[i];
  if (!node || node._populated) return node || null;
  if (i < 0 || i >= postList.length) return null;
  node._populated = true;
  renderCallbacks.renderSlide(node, i);
  return node;
}

function depopulateSlide(i) {
  const node = slideNodes[i];
  if (!node || !node._populated) return;
  node._populated = false;
  if (renderCallbacks.onSlideDispose) renderCallbacks.onSlideDispose(node);
  node.innerHTML = '';
  node._feedVideo = null;
  node._feedCarousel = null;
  node._feedImg = null;
  node._feedNoMedia = false;
}

function flushDepopulateQueue() {
  if (depopulateTimer) { clearTimeout(depopulateTimer); depopulateTimer = null; }
  const candidates = [...depopulateQueue];
  depopulateQueue.clear();
  candidates.forEach((i) => depopulateSlide(i));
}

function scheduleDepopulate() {
  if (depopulateTimer) return;
  depopulateTimer = setTimeout(() => {
    depopulateTimer = null;
    const candidates = [...depopulateQueue];
    depopulateQueue.clear();
    candidates.forEach((i) => {
      if (Math.abs(i - activeIdx) > DEPOPULATE_RADIUS) depopulateSlide(i);
    });
  }, DEPOPULATE_DELAY_MS);
}

function recycleFarSlides(center) {
  for (let i = 0; i < slideNodes.length; i++) {
    const node = slideNodes[i];
    if (!node || !node._populated) continue;
    if (Math.abs(i - center) > DEPOPULATE_RADIUS) depopulateQueue.add(i);
  }
  if (depopulateQueue.size > 0) scheduleDepopulate();
}

function markActive(i) {
  if (i === activeIdx) return;
  const prev = activeIdx >= 0 ? slideNodes[activeIdx] : null;
  activeIdx = i;
  if (prev) prev.classList.remove('is-active');
  const cur = populateSlide(i);
  if (cur) cur.classList.add('is-active');
  if (renderCallbacks.onActiveChange) renderCallbacks.onActiveChange(i, prev);
}

function preloadForSlide(i) {
  const post = postList[i];
  if (!post) return;
  const item = getActiveMediaItem(post);
  if (item.isVideo || item.fileExt === 'zip') return; // videos/archives stream on demand
  const url = getMediaItemUrl(item);
  if (url) preloadSingleUrl(url);
}

export function getActiveMediaItem(post) {
  if (post?.isAlbum && Array.isArray(post.albumItems) && post.albumItems.length > 0) {
    return post.albumItems[0] || post;
  }
  return post;
}

/**
 * Rebuilds the feed for a new post list, opening at `startIndex`.
 */
export function rebuildFeed(list, startIndex) {
  flushDepopulateQueue();
  for (let i = 0; i < slideNodes.length; i++) depopulateSlide(i);
  slidesContainer.innerHTML = '';
  slideNodes = [];
  postList = Array.isArray(list) ? list : [];
  activeIdx = -1;
  for (let i = 0; i < postList.length; i++) createShell(i);

  if (postList.length === 0) {
    if (renderCallbacks.onEmpty) renderCallbacks.onEmpty();
    return;
  }

  const first = Math.max(0, Math.min(startIndex, postList.length - 1));
  for (let i = Math.max(0, first - POPULATE_RADIUS); i <= Math.min(postList.length - 1, first + POPULATE_RADIUS); i++) {
    populateSlide(i);
  }
  requestAnimationFrame(() => {
    if (!viewport) return;
    const h = viewport.clientHeight || 1;
    viewport.scrollTop = first * h;
    markActive(first);
  });
}

/**
 * Extends the track after infinite-scroll appends new posts: new indices get
 * fresh shells at the end. Shrinking lists are ignored (removing entries
 * mid-scroll would shift every index).
 */
export function syncList(newList) {
  if (!Array.isArray(newList) || newList === postList) return;
  if (newList.length < postList.length) return;
  postList = newList;
  for (let i = slideNodes.length; i < postList.length; i++) createShell(i);
}

/**
 * Called by the scroll handler when the active slide changes.
 */
export function setActiveIndex(i) {
  if (i < 0 || i >= postList.length) return;
  // Populate the window around the new slide first, then mark it active so the
  // active-change hook always sees a populated node.
  for (let j = Math.max(0, i - POPULATE_RADIUS); j <= Math.min(postList.length - 1, i + POPULATE_RADIUS); j++) {
    populateSlide(j);
  }
  markActive(i);
  recycleFarSlides(i);
  for (let k = i + 1; k <= Math.min(postList.length - 1, i + 2); k++) {
    preloadForSlide(k);
  }
  if (i > 0) preloadForSlide(i - 1);
  if (postList.length - i <= 3 && renderCallbacks.onNearEnd) renderCallbacks.onNearEnd();
}

export function getActiveIndex() {
  return activeIdx;
}

export function getPostList() {
  return postList;
}

export function getSlideNode(i) {
  return slideNodes[i] || null;
}

export function disposeAll() {
  flushDepopulateQueue();
  for (let i = 0; i < slideNodes.length; i++) depopulateSlide(i);
  if (slidesContainer) slidesContainer.innerHTML = '';
  slideNodes = [];
  postList = [];
  activeIdx = -1;
}

// ── Slide content ────────────────────────────────────────────────

function isArchiveItem(item) {
  return Boolean(item && (item.isArchive === true || item.fileExt === 'zip' || (Array.isArray(item.archiveUrls) && item.archiveUrls.length > 0)));
}

function createImageWithFallbacks(item, className) {
  const img = document.createElement('img');
  img.className = className;
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  img.draggable = false;
  img.decoding = 'async';

  const direct = item.sampleUrl || item.fileUrl || item.previewUrl || '';
  const needsProxy = (item.site === 'danbooru' || direct.includes('donmai.us'))
    ? true
    : (state.settings?.proxyFullImages !== false);

  const targetSrc = direct.startsWith('/api/') || !needsProxy ? direct : getProxiedUrl(direct);
  let errorAttempt = 0;
  img.addEventListener('error', () => {
    errorAttempt++;
    if (errorAttempt === 1 && direct && !img.src.includes('/api/proxy') && needsProxy) {
      img.src = getProxiedUrl(direct);
    } else if (errorAttempt <= 2 && item.fileUrl && img.src !== item.fileUrl && img.src !== getProxiedUrl(item.fileUrl)) {
      img.src = getProxiedUrl(item.fileUrl);
    } else if (errorAttempt <= 3 && item.previewUrl && img.src !== item.previewUrl && img.src !== getProxiedUrl(item.previewUrl)) {
      img.src = getProxiedUrl(item.previewUrl);
    } else if (img.dataset.onFinalError !== '1') {
      img.dataset.onFinalError = '1';
      img.dispatchEvent(new CustomEvent('feed-image-failed', { bubbles: true }));
    }
  });
  img.src = targetSrc;
  return img;
}

function buildSingleMedia(node, item) {
  const stage = node.querySelector('.feed-stage');
  if (!item) {
    stage.appendChild(errorBlock(t('feed.imageFailed', 'Не удалось загрузить изображение'), null));
    return;
  }
  if (item.isVideo && (item.fileUrl || item.sampleUrl || item.teaserUrl)) {
    const player = createFeedVideoPlayer(item);
    if (player) {
      stage.appendChild(player.wrap);
      node._feedVideo = player;
      node._feedNoMedia = false;
      if (node.classList.contains('is-active')) player.setPlaying(true);
      return;
    }
    stage.appendChild(fallbackCard({
      icon: videoIcon(),
      title: t('feed.videoUnavailable', 'Видео недоступно'),
      text: t('feed.videoUnavailableHint', 'Формат не поддерживается или источник недоступен'),
      actionLabel: t('viewer.downloadArchive', 'Скачать'),
      action: 'download'
    }));
    node._feedNoMedia = true;
    return;
  }

  // Still image: low-res placeholder first, then the full file.
  const thumbMedia = item.previewUrl || item.thumb360 || item.thumb180 || '';
  const thumbNeedsProxy = (item.site === 'danbooru' || (typeof thumbMedia === 'string' && thumbMedia.includes('donmai.us')))
    ? true
    : (state.settings?.proxyThumbnails !== false);
  const placeholderSrc = thumbMedia
    ? (thumbMedia.startsWith('/api/') ? thumbMedia : (thumbNeedsProxy ? getProxiedUrl(thumbMedia) : thumbMedia))
    : '';

  const spinner = document.createElement('div');
  spinner.className = 'feed-media-spinner';
  stage.appendChild(spinner);

  if (placeholderSrc) {
    const ph = document.createElement('img');
    ph.className = 'feed-img-placeholder';
    ph.src = placeholderSrc;
    ph.alt = '';
    ph.referrerPolicy = 'no-referrer';
    ph.decoding = 'async';
    stage.appendChild(ph);
  }

  const img = createImageWithFallbacks(item, 'feed-media feed-img');
  img.addEventListener('load', () => {
    spinner.remove();
    const ph = stage.querySelector('.feed-img-placeholder');
    if (ph) ph.remove();
  });
  img.addEventListener('feed-image-failed', () => {
    spinner.remove();
    stage.appendChild(errorBlock(t('feed.imageFailed', 'Не удалось загрузить изображение'), () => {
      const fresh = createImageWithFallbacks(item, 'feed-media feed-img');
      fresh.addEventListener('feed-image-failed', () => {});
      stage.appendChild(fresh);
    }));
  });
  if (img.complete && img.naturalWidth > 0) {
    spinner.remove();
  }
  stage.appendChild(img);
  node._feedImg = img;
  node._feedNoMedia = false;
}

/**
 * Album carousel: one horizontal scroll-snap strip per slide, so the vertical
 * feed swipe keeps moving between posts.
 */
function buildCarousel(node, post) {
  const stage = node.querySelector('.feed-stage');
  const items = post.albumItems.filter(Boolean);
  const carousel = document.createElement('div');
  carousel.className = 'feed-carousel';

  items.forEach((item, idx) => {
    const page = document.createElement('div');
    page.className = 'feed-carousel-item';
    page.dataset.page = String(idx);
    if (item.isVideo && (item.fileUrl || item.sampleUrl)) {
      const player = createFeedVideoPlayer(item);
      if (player) {
        page.appendChild(player.wrap);
        page._feedVideo = player;
      } else {
        page.appendChild(createImageWithFallbacks(item, 'feed-media feed-img'));
      }
    } else if (isArchiveItem(item)) {
      page.appendChild(fallbackCard({
        icon: archiveIcon(),
        title: t('vw.archiveZip', 'ZIP архив'),
        text: t('feed.archiveInFeed', 'Архив нельзя показать в ленте'),
        actionLabel: t('feed.openInViewer', 'Открыть в просмотрщике'),
        action: 'open'
      }));
    } else {
      page.appendChild(createImageWithFallbacks(item, 'feed-media feed-img'));
    }
    carousel.appendChild(page);
  });

  const counter = document.createElement('div');
  counter.className = 'feed-carousel-counter mono';
  counter.textContent = `1 / ${items.length}`;

  const dots = document.createElement('div');
  dots.className = 'feed-carousel-dots';
  items.forEach((_, idx) => {
    const dot = document.createElement('span');
    dot.className = 'feed-carousel-dot' + (idx === 0 ? ' active' : '');
    dots.appendChild(dot);
  });

  let raf = false;
  carousel.addEventListener('scroll', () => {
    if (raf) return;
    raf = true;
    requestAnimationFrame(() => {
      raf = false;
      const w = carousel.clientWidth || 1;
      const page = Math.round(carousel.scrollLeft / w);
      counter.textContent = `${Math.min(items.length, page + 1)} / ${items.length}`;
      dots.querySelectorAll('.feed-carousel-dot').forEach((d, i) => d.classList.toggle('active', i === page));
      // Only the visible page may play a video, and only on the active slide.
      carousel.querySelectorAll('.feed-carousel-item').forEach((p, i) => {
        if (p._feedVideo) {
          p._feedVideo.setPlaying(i === page && node.classList.contains('is-active'));
        }
      });
    });
  }, { passive: true });

  stage.appendChild(carousel);
  stage.appendChild(counter);
  stage.appendChild(dots);
  node._feedCarousel = carousel;
  node._feedNoMedia = false;
}

/**
 * Renders one slide. Called by the virtualization layer for every slide that
 * enters the mounted window.
 */
export function renderSlideContent(node, post) {
  node._feedVideo = null;
  node._feedCarousel = null;
  node._feedImg = null;
  node._feedNoMedia = false;
  node.innerHTML = '';

  const stage = document.createElement('div');
  stage.className = 'feed-stage';
  node.appendChild(stage);

  if (!post) return;

  if (isArchiveItem(post)) {
    stage.appendChild(fallbackCard({
      icon: archiveIcon(),
      title: t('vw.archiveZip', 'ZIP архив'),
      text: t('feed.archiveInFeed', 'Архив нельзя показать в ленте'),
      actionLabel: t('feed.openInViewer', 'Открыть в просмотрщике'),
      action: 'open'
    }));
    node._feedNoMedia = true;
    return;
  }

  const albumItems = (post.isAlbum && Array.isArray(post.albumItems)) ? post.albumItems : null;
  if (albumItems && albumItems.length > 1) {
    buildCarousel(node, post);
    return;
  }

  buildSingleMedia(node, getActiveMediaItem(post));

  // Album-like posts whose items are not loaded yet: fetch once for the
  // active slide so the carousel can appear (same exclusions as the viewer).
  maybeFetchAlbum(post).then((loaded) => {
    if (!loaded || !node.isConnected || node._populated !== true) return;
    renderSlideContent(node, post);
    if (node.classList.contains('is-active') && node._feedVideo) node._feedVideo.setPlaying(true);
  });
}

async function maybeFetchAlbum(post) {
  if (!post || post._feedAlbumRequested || post._feedAlbumResolved) return false;
  if (post.site === 'pawchive' || post.site === 'kemono') return false;
  if (state.settings?.groupAlbums === false) return false;
  const canFetch = Boolean(post.canFetchAlbum || post.hasChildren || post.parentId ||
    (post.seriesKey && !post.seriesKey.startsWith('pawchive:') && !post.seriesKey.startsWith('kemono:')) ||
    post.pixiv_id);
  if (!canFetch) return false;
  post._feedAlbumRequested = true;
  try {
    const res = await fetchAlbumPosts({
      site: post.site,
      seriesKey: post.seriesKey || '',
      parentId: post.parentId || '',
      originalId: post.originalId || '',
      postUrl: post.postUrl || ''
    });
    if (res?.success && Array.isArray(res.albumItems) && res.albumItems.length > 1) {
      const prevCount = Array.isArray(post.albumItems) ? post.albumItems.length : 1;
      post.isAlbum = true;
      post.albumItems = res.albumItems;
      post.albumCount = res.albumItems.length;
      post._feedAlbumResolved = true;
      return prevCount <= 1;
    }
  } catch {
    // Keep the single-media view; the slide is still fully usable.
  }
  return false;
}

function fallbackCard({ icon, title, text, actionLabel, action }) {
  const card = document.createElement('div');
  card.className = 'feed-fallback-card';
  card.innerHTML = `
    <div class="feed-fallback-icon">${icon}</div>
    <div class="feed-fallback-title">${escapeHtml(title)}</div>
    <div class="feed-fallback-text">${escapeHtml(text)}</div>
    <button type="button" class="feed-fallback-btn" data-action="${escapeHtml(action)}">${escapeHtml(actionLabel)}</button>
  `;
  return card;
}

function errorBlock(text, onRetry) {
  const box = document.createElement('div');
  box.className = 'feed-slide-error';
  box.innerHTML = `<span>${escapeHtml(text)}</span>`;
  if (onRetry) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'feed-fallback-btn';
    retry.textContent = t('vw.retry', 'Повторить');
    retry.addEventListener('click', () => {
      box.remove();
      onRetry();
    });
    box.appendChild(retry);
  }
  return box;
}

function archiveIcon() {
  return '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>';
}

function videoIcon() {
  return '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="2" y="5" width="14" height="14" rx="2"/><path d="m16 10 6-3v10l-6-3z"/></svg>';
}
