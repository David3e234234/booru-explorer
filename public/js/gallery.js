import { state, isPostFavorite, isAuthorFavorite, isPostLiked, toggleLikeLocally, toggleDislikeLocally, isPostDisliked } from './state.js';
import { getProxiedUrl, toggleFavoritePost, toggleLikePost, toggleDislikeApi } from './api.js';
import { showToast, showActionToast, haptic, isVideoMediaUrl } from './modules/uiUtils.js';
import { t } from './i18n.js';

export function initGallery({ onOpenViewer, onFavoriteToggle, onTagClick, onTagSelect, onLoadMore, onRefresh }) {
  const galleryGrid = document.getElementById('galleryGrid');
  const loadingSpinner = document.getElementById('loadingSpinner');
  const emptyState = document.getElementById('emptyState');
  const resultsCount = document.getElementById('resultsCount');
  const currentSiteLabel = document.getElementById('currentSiteLabel');
  const checkHoverPreview = document.getElementById('checkHoverPreview');
  const infiniteScrollTrigger = document.getElementById('infiniteScrollTrigger');
  const scrollLoader = document.getElementById('scrollLoader');
  const mainContent = document.querySelector('.main-content');

  let observer = null;
  let mobileVideoObserver = null;
  let videoMetadataObserver = null;

  // Custom Pull-to-Refresh
  if (mainContent) {
    let touchStartPull = 0;
    let isPulling = false;
    let pullRefreshIndicator = null;
    
    // Create visual indicator
    pullRefreshIndicator = document.createElement('div');
    pullRefreshIndicator.className = 'pull-to-refresh-indicator';
    pullRefreshIndicator.innerHTML = '<div class="mini-spinner"></div>';
    pullRefreshIndicator.style.cssText = 'position: absolute; top: -40px; left: 50%; transform: translateX(-50%); opacity: 0; transition: transform 0.2s, opacity 0.2s; z-index: 100;';
    
    const galleryContainer = document.querySelector('.gallery-container');
    if (galleryContainer) {
      galleryContainer.style.position = 'relative';
      galleryContainer.prepend(pullRefreshIndicator);
    }

    mainContent.addEventListener('touchstart', (e) => {
      if (mainContent.scrollTop <= 0) {
        touchStartPull = e.touches[0].clientY;
        isPulling = true;
      } else {
        isPulling = false;
      }
    }, { passive: true });

    mainContent.addEventListener('touchmove', (e) => {
      if (!isPulling) return;
      const pullDist = e.touches[0].clientY - touchStartPull;
      if (pullDist > 0 && mainContent.scrollTop <= 0) {
        // We are pulling down at the very top
        if (pullRefreshIndicator) {
          const visualDist = Math.min(pullDist * 0.4, 60);
          pullRefreshIndicator.style.transform = `translate(-50%, ${visualDist}px)`;
          pullRefreshIndicator.style.opacity = Math.min(pullDist / 100, 1).toString();
        }
      }
    }, { passive: true });

    mainContent.addEventListener('touchend', (e) => {
      if (isPulling) {
        const touchEndPull = e.changedTouches[0].clientY;
        const pullDist = touchEndPull - touchStartPull;
        
        if (pullDist > 120 && mainContent.scrollTop <= 0) {
          // Trigger refresh
          if (pullRefreshIndicator) {
            pullRefreshIndicator.style.transform = `translate(-50%, 40px)`;
            pullRefreshIndicator.style.opacity = '1';
          }
          if (onRefresh && state.currentCategory !== 'favorites') {
             setTimeout(() => {
                onRefresh();
                resetPullIndicator();
             }, 400);
          } else {
             resetPullIndicator();
          }
        } else {
          resetPullIndicator();
        }
      }
      isPulling = false;
    });

    function resetPullIndicator() {
      if (pullRefreshIndicator) {
        pullRefreshIndicator.style.transform = 'translate(-50%, 0)';
        pullRefreshIndicator.style.opacity = '0';
      }
    }
  }

  // Seamless infinite scrolling
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver((entries) => {
      const first = entries[0];
      if (first.isIntersecting && !state.isLoading && state.hasMore && state.posts.length > 0 && state.currentCategory !== 'favorites') {
        onLoadMore();
      }
    }, {
      root: null,
      rootMargin: '600px',
      threshold: 0.05
    });
    observer.observe(infiniteScrollTrigger);

    // Mobile autoplay of muted videos when scrolled into focus
    mobileVideoObserver = new IntersectionObserver((entries) => {
      if (window.innerWidth > 800) return;
      if (state.settings?.videoAutoplayMobile === false) return;
      entries.forEach(entry => {
        const card = entry.target;
        const videoEl = card.querySelector('.hover-video-preview');
        if (!videoEl) return;
        const post = card._post || state.posts.find(p => p.id === card.dataset.postId) || (state.displayedPosts || state.posts)[parseInt(card.dataset.index, 10)];
        if (!post || !post.isVideo) return;

        if (entry.isIntersecting) {
          if (!videoEl.src) {
            const videoTarget = post.fileUrl || post.sampleUrl;
            if (videoTarget) {
              const shouldUseProxy = (post.site === 'danbooru' || post.site === 'rule34video' || videoTarget.includes('donmai.us') || videoTarget.includes('rule34video.com') || videoTarget.includes('boomio-cdn.com')) ? true : (state.settings?.proxyVideos !== false && state.settings?.proxyVideoDefault !== false);
              card._videoProbe = false;
              videoEl.src = shouldUseProxy ? getProxiedUrl(videoTarget) : videoTarget;
            }
          }
          videoEl.muted = true;
          card._videoProbe = false;
          const playPromise = videoEl.play();
          if (playPromise !== undefined) {
            playPromise.then(() => {
              card.classList.add('video-playing');
            }).catch(() => {});
          }
        } else {
          videoEl.pause();
          videoEl.removeAttribute('src');
          videoEl.load();
          card.classList.remove('video-playing');
        }
      });
    }, {
      root: null,
      rootMargin: '-15% 0px -15% 0px',
      threshold: 0.5
    });

    // Observer for detecting video duration without autoplay
    videoMetadataObserver = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const card = entry.target;
          const videoEl = card.querySelector('.hover-video-preview');
          const post = card._post || state.posts.find(p => p.id === card.dataset.postId) || (state.displayedPosts || state.posts)[parseInt(card.dataset.index, 10)];
          if (videoEl && post && post.isVideo && !post.duration) {
            const videoTarget = post.fileUrl || post.sampleUrl;
            if (videoTarget && !videoEl.src) {
              const shouldUseProxy = (post.site === 'danbooru' || post.site === 'rule34video' || videoTarget.includes('donmai.us') || videoTarget.includes('rule34video.com') || videoTarget.includes('boomio-cdn.com')) ? true : (state.settings?.proxyVideos !== false && state.settings?.proxyVideoDefault !== false);
              // Mark as a background probe: its errors must not trigger proxy/transcode escalation
              card._videoProbe = true;
              videoEl.preload = 'metadata';
              videoEl.src = shouldUseProxy ? getProxiedUrl(videoTarget) : videoTarget;
            }
          }
          obs.unobserve(card);
        }
      });
    }, {
      root: null,
      rootMargin: '300px 0px',
      threshold: 0.01
    });
  }

  const handleScrollCheck = () => {
    if (!state.isLoading && state.hasMore && state.posts.length > 0 && state.currentCategory !== 'favorites') {
      // The body is the only real scroller at every breakpoint (.main-content has no
      // height constraint), so proximity must be measured against document height
      if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 700) {
        onLoadMore();
      }
    }
  };

  window.addEventListener('scroll', handleScrollCheck, { passive: true });

  const loadMoreContainer = document.getElementById('loadMoreContainer');
  const btnLoadMore = document.getElementById('btnLoadMore');

  if (btnLoadMore) {
    btnLoadMore.addEventListener('click', () => {
      if (!state.isLoading && state.hasMore && state.currentCategory !== 'favorites') {
        btnLoadMore.classList.add('loading');
        onLoadMore();
      }
    });
  }

  // ── Infinite feed virtualization ──
  // Posts are split into chunks; outside the viewport, cards are replaced by
  // lightweight placeholders of the same height, so the scrollbar and positions stay stable.
  const VIRT_CHUNK_SIZE = 24;
  const VIRT_MOUNT_MARGIN = 1.5;   // how many screen heights to mount ahead
  const VIRT_UNMOUNT_MARGIN = 4;   // hysteresis: unmount farther than we mount
  let virtChunks = [];             // [{ els: [], mounted }]
  let virtTotal = 0;
  let virtUpdateScheduled = false;
  // Incremental scan state: chunk elements follow post order in the grid, so their
  // vertical bounds grow monotonically. Frames that scroll down (or stay put) can
  // start past the dead top region and stop at the first chunk fully below the
  // window; scrolling up or any grid geometry change falls back to a full pass.
  let virtScanFrom = 0;
  let virtLastScrollY = -1;
  let virtLastVh = -1;

  function createPlaceholder(index) {
    const ph = document.createElement('div');
    ph.className = 'media-card-placeholder';
    ph.dataset.index = String(index);
    return ph;
  }

  function detachCardObservers(card) {
    if (mobileVideoObserver) mobileVideoObserver.unobserve(card);
    if (videoMetadataObserver) videoMetadataObserver.unobserve(card);
  }

  function resetVirtualization() {
    virtChunks = [];
    virtTotal = 0;
    virtScanFrom = 0;
    virtLastScrollY = -1;
    virtLastVh = -1;
  }

  function buildPlaceholderRange(from, to) {
    for (let start = from; start < to; start += VIRT_CHUNK_SIZE) {
      const end = Math.min(start + VIRT_CHUNK_SIZE, to);
      const els = [];
      for (let i = start; i < end; i++) els.push(createPlaceholder(i));
      virtChunks.push({ els, mounted: false });
    }
    virtTotal = to;
  }

  function chunkBounds(chunk) {
    const first = chunk.els[0];
    const last = chunk.els[chunk.els.length - 1];
    if (!first) return null;
    const a = first.getBoundingClientRect();
    const b = last !== first ? last.getBoundingClientRect() : a;
    return { top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) };
  }

  function updateVisibleChunks() {
    virtUpdateScheduled = false;
    if (!virtChunks.length) return;

    const vh = window.innerHeight || document.documentElement.clientHeight;
    if (vh !== virtLastVh) {
      virtScanFrom = 0;
      virtLastVh = vh;
    }
    const scrollY = window.scrollY || 0;
    if (scrollY < virtLastScrollY) {
      virtScanFrom = 0;
    }
    virtLastScrollY = scrollY;

    const mountMargin = vh * VIRT_MOUNT_MARGIN;
    const unmountMargin = vh * VIRT_UNMOUNT_MARGIN;
    const toMount = [];
    const toUnmount = [];
    let firstAlive = virtChunks.length;
    let sweepFrom = -1;

    for (let i = virtScanFrom; i < virtChunks.length; i++) {
      const chunk = virtChunks[i];
      const bounds = chunkBounds(chunk);
      if (!bounds) continue;
      if (bounds.bottom < -unmountMargin) {
        // Entirely above the window: mounted chunks unmount, placeholders stay put
        if (chunk.mounted) toUnmount.push(i);
        continue;
      }
      firstAlive = Math.min(firstAlive, i);
      if (bounds.top > vh + unmountMargin) {
        // First chunk fully below the window; every later chunk is even lower,
        // so the rest is swept without measuring
        sweepFrom = i;
        break;
      }
      if (!chunk.mounted) {
        if (bounds.bottom >= -mountMargin && bounds.top <= vh + mountMargin) toMount.push(i);
      }
    }

    if (sweepFrom !== -1) {
      for (let i = sweepFrom; i < virtChunks.length; i++) {
        if (virtChunks[i].mounted) toUnmount.push(i);
      }
      firstAlive = Math.min(firstAlive, sweepFrom);
    }
    virtScanFrom = firstAlive;

    toMount.forEach(idx => mountChunk(idx));
    toUnmount.forEach(idx => unmountChunk(idx));
  }

  function scheduleVirtualUpdate() {
    if (virtUpdateScheduled) return;
    virtUpdateScheduled = true;
    requestAnimationFrame(updateVisibleChunks);
  }

  function mountChunk(chunkIdx) {
    const chunk = virtChunks[chunkIdx];
    if (!chunk || chunk.mounted) return;
    const postsToDisplay = state.displayedPosts || state.posts;
    chunk.els = chunk.els.map((el, slot) => {
      const index = parseInt(el.dataset.index, 10);
      if (el.classList.contains('media-card')) return el;
      const post = postsToDisplay[index];
      if (!post) return el;
      const card = createMediaCard(post, index);
      card._chunkIdx = chunkIdx;
      el.replaceWith(card);
      return card;
    });
    chunk.mounted = true;
  }

  function unmountChunk(chunkIdx) {
    const chunk = virtChunks[chunkIdx];
    if (!chunk || !chunk.mounted) return;
    if (hoverState.card && chunk.els.includes(hoverState.card)) {
      stopHoverPreview();
    }
    const postsToDisplay = state.displayedPosts || state.posts;
    chunk.els = chunk.els.map(el => {
      if (!el.classList.contains('media-card')) return el;
      detachCardObservers(el);
      const ph = createPlaceholder(parseInt(el.dataset.index, 10));
      el.replaceWith(ph);
      return ph;
    });
    chunk.mounted = false;
  }

  if (mainContent) {
    mainContent.addEventListener('scroll', scheduleVirtualUpdate, { passive: true });
  }
  window.addEventListener('scroll', scheduleVirtualUpdate, { passive: true });
  window.addEventListener('resize', scheduleVirtualUpdate, { passive: true });
  if ('ResizeObserver' in window) {
    const gridResizeObserver = new ResizeObserver(() => {
      // Grid box changed (append, 1col image loads): vertical offsets are stale
      virtScanFrom = 0;
      scheduleVirtualUpdate();
    });
    gridResizeObserver.observe(galleryGrid);
  }

  function getProcessedPosts() {
    if (!state.videoDurationSort || state.videoDurationSort === 'none') {
      return state.posts;
    }
    const postsCopy = [...state.posts];
    if (state.videoDurationSort === 'longest') {
      return postsCopy.sort((a, b) => (b.duration || 0) - (a.duration || 0));
    } else if (state.videoDurationSort === 'shortest') {
      return postsCopy.sort((a, b) => {
        const durA = a.duration || (a.isVideo ? 999999 : 0);
        const durB = b.duration || (b.isVideo ? 999999 : 0);
        return durA - durB;
      });
    }
    return postsCopy;
  }

  function renderGallery(append = false, opts = {}) {
    if (btnLoadMore) {
      btnLoadMore.classList.remove('loading');
    }

    // With active sorting and appending more posts (append=true), the list must be
    // fully re-rendered: new posts are inserted into the middle of the sorted
    // array, so they can't just be appended to the end of the DOM
    if (append && state.videoDurationSort && state.videoDurationSort !== 'none') {
      append = false;
    }

    loadingSpinner.style.display = 'none';
    scrollLoader.style.display = 'none';

    if (state.currentCategory === 'favorites') {
      currentSiteLabel.textContent = t('gal.labelFavorites', 'Избранное');
    } else if (state.currentCategory === 'profile') {
      currentSiteLabel.textContent = t('gal.labelProfile', 'Профиль');
    } else {
      const siteObj = state.sites.find(s => s.id === state.currentSite);
      currentSiteLabel.textContent = siteObj ? siteObj.name : state.currentSite;
    }

    const postsToDisplay = getProcessedPosts();
    state.displayedPosts = postsToDisplay;

    if (postsToDisplay.length === 0) {
      emptyState.style.display = 'flex';
      const emptyTitle = emptyState.querySelector('.state-title');
      const emptyDesc = emptyState.querySelector('.state-desc');

      if (state.lastSearchFailed && state.currentCategory !== 'profile' && state.currentCategory !== 'favorites') {
        state.lastSearchFailed = false;
        if (emptyTitle) emptyTitle.textContent = t('gal.errorTitle', 'Не удалось загрузить посты');
        if (emptyDesc) emptyDesc.textContent = t('gal.errorDesc', 'Проверьте подключение к сети и попробуйте еще раз: нажмите «Искать» или кнопку обновления рядом с ним.');
      } else if (state.currentCategory === 'profile') {
        if (state.profileSubTab === 'likes') {
          if (emptyTitle) emptyTitle.textContent = t('gal.emptyLikesTitle', 'Нет понравившихся постов');
          if (emptyDesc) emptyDesc.textContent = t('gal.emptyLikesDesc', 'Оценивайте посты сердечком в галерее или просмотрщике, чтобы собрать коллекцию.');
        } else if (state.profileSubTab === 'favorites') {
          if (emptyTitle) emptyTitle.textContent = t('gal.emptyFavsTitle', 'В закладках пока пусто');
          if (emptyDesc) emptyDesc.textContent = t('gal.emptyFavsDesc', 'Сохраняйте работы в закладки, чтобы быстро возвращаться к ним в любое время.');
        } else if (state.profileSubTab === 'authors') {
          if (emptyTitle) emptyTitle.textContent = t('gal.emptyAuthorsTitle', 'Нет отслеживаемых авторов');
          if (emptyDesc) emptyDesc.textContent = t('gal.emptyAuthorsDesc', 'Добавляйте художников в любимые, чтобы отслеживать их новые работы.');
        }
      } else if (state.currentCategory === 'favorites') {
        if (emptyTitle) emptyTitle.textContent = t('gal.emptyFavoritesTitle', 'В избранном пока пусто');
        if (emptyDesc) emptyDesc.textContent = t('gal.emptyFavoritesDesc', 'Нажмите на значок закладки на любой карточке, чтобы сохранить пост.');
      } else {
        if (emptyTitle) emptyTitle.textContent = t('gal.noResultsTitle', 'Ничего не найдено');
        if (emptyDesc) emptyDesc.textContent = t('gal.noResultsDesc', 'Попробуйте изменить теги поиска или переключить Booru-источник.');
      }

      resultsCount.textContent = t('gal.countPosts', '{n} постов').replace('{n}', '0');
      if (loadMoreContainer) loadMoreContainer.style.display = 'none';
      stopHoverPreview();
      resetVirtualization();
      galleryGrid.innerHTML = '';
      return;
    }

    emptyState.style.display = 'none';
    resultsCount.textContent = t('gal.loadedCount', 'Загружено: {n} постов').replace('{n}', postsToDisplay.length);

    // Show the "Load more" button
    if (loadMoreContainer) {
      if (state.hasMore && state.currentCategory !== 'favorites' && state.currentCategory !== 'profile' && postsToDisplay.length >= 10) {
        loadMoreContainer.style.display = 'flex';
      } else {
        loadMoreContainer.style.display = 'none';
      }
    }

    const prevScrollTop = mainContent ? mainContent.scrollTop : 0;

    if (!append) {
      // Full re-render: first placeholders for all posts (stable feed height),
      // then restore scroll and mount chunks around the visible area
      stopHoverPreview();
      virtChunks.forEach(chunk => {
        if (!chunk.mounted) return;
        chunk.els.forEach(el => {
          if (el.classList.contains('media-card')) detachCardObservers(el);
        });
      });
      galleryGrid.innerHTML = '';
      resetVirtualization();

      const fragment = document.createDocumentFragment();
      buildPlaceholderRange(0, postsToDisplay.length);
      virtChunks.forEach(chunk => chunk.els.forEach(el => fragment.appendChild(el)));
      galleryGrid.appendChild(fragment);

      if (mainContent) {
        mainContent.scrollTop = opts.preserveScroll ? prevScrollTop : 0;
      }
      updateVisibleChunks();
    } else {
      // Append: new posts get placeholders, visible ones mount themselves
      const startIndex = Math.min(virtTotal, postsToDisplay.length);
      if (startIndex < postsToDisplay.length) {
        buildPlaceholderRange(startIndex, postsToDisplay.length);
        const fragment = document.createDocumentFragment();
        virtChunks.forEach(chunk => chunk.els.forEach(el => {
          if (parseInt(el.dataset.index, 10) >= startIndex) fragment.appendChild(el);
        }));
        galleryGrid.appendChild(fragment);
        updateVisibleChunks();
      }
    }

    // Auto-load: if there are so few posts that there's no scrollbar
    setTimeout(() => {
      if (state.hasMore && !state.isLoading && state.posts.length > 0 && state.currentCategory !== 'favorites') {
        const hasScrollbar = document.body.scrollHeight > window.innerHeight + 100;
        if (!hasScrollbar) {
          console.log('[Gallery] Экран не заполнен, продолжаем глубокий поиск...');
          onLoadMore();
        }
      }
    }, 200);
  }

  function createMediaCard(post, index) {
    const card = document.createElement('div');
    card.className = 'media-card';
    card.dataset.index = index;
    card.dataset.postId = post.id;
    card._post = post;

    const isVideoExt = isVideoMediaUrl;

    // Pick the preview source based on the quality setting: 'low', 'medium', 'high', 'original'
    const quality = state.settings?.previewQuality || 'medium';
    let directThumb = '';

    if (post.isVideo) {
      const hasStaticPreview = post.previewUrl && !isVideoExt(post.previewUrl);
      const videoTarget = post.sampleUrl || post.fileUrl || '';

      if (quality === 'low') {
        directThumb = hasStaticPreview ? post.previewUrl : (videoTarget ? `/api/video-thumbnail?url=${encodeURIComponent(videoTarget)}&quality=low` : '');
      } else if (quality === 'medium') {
        if (post.site === 'danbooru' && (post.thumb360 || post.thumb180)) {
          directThumb = post.thumb360 || post.thumb180;
        } else if (hasStaticPreview) {
          directThumb = post.previewUrl;
        } else if (videoTarget) {
          directThumb = `/api/video-thumbnail?url=${encodeURIComponent(videoTarget)}&quality=medium`;
        } else {
          directThumb = post.previewUrl || '';
        }
      } else if (quality === 'high' || quality === 'original') {
        if (post.site === 'danbooru' && (post.thumb720 || post.thumbSample)) {
          directThumb = post.thumb720 || post.thumbSample;
        } else if (hasStaticPreview) {
          directThumb = post.previewUrl;
        } else if (videoTarget) {
          directThumb = `/api/video-thumbnail?url=${encodeURIComponent(videoTarget)}&quality=${quality}`;
        } else {
          directThumb = post.previewUrl || '';
        }
      }
    } else {
      // Static images
      if (quality === 'low') {
        // Danbooru: 180x180 thumbnail, others: previewUrl
        directThumb = (post.site === 'danbooru' && post.thumb180) ? post.thumb180
          : ((!isVideoExt(post.previewUrl) && post.previewUrl) || post.sampleUrl || post.fileUrl || '');
      } else if (quality === 'medium') {
        // Danbooru: 360x360 variant straight from the field
        if (post.site === 'danbooru') {
          directThumb = post.thumb360 || post.thumb180 || post.previewUrl || '';
        } else {
          directThumb = (!isVideoExt(post.sampleUrl) && post.sampleUrl) || (!isVideoExt(post.previewUrl) && post.previewUrl) || post.fileUrl || '';
        }
      } else if (quality === 'high') {
        // Danbooru: 720x720 WebP variant straight from the field
        if (post.site === 'danbooru') {
          directThumb = post.thumb720 || post.thumbSample || post.thumb360 || post.previewUrl || '';
        } else {
          directThumb = (!isVideoExt(post.sampleUrl) && post.sampleUrl) || post.fileUrl || post.previewUrl || '';
        }
      } else if (quality === 'original') {
        // Danbooru: full original straight from the field
        if (post.site === 'danbooru') {
          directThumb = (!isVideoExt(post.thumbOriginal) && post.thumbOriginal) || post.thumb720 || post.fileUrl || '';
        } else {
          directThumb = (!isVideoExt(post.fileUrl) && post.fileUrl) || post.sampleUrl || post.previewUrl || '';
        }
      }
    }

    if (!directThumb || isVideoExt(directThumb)) {
      if (post.isVideo) {
        directThumb = `/api/video-thumbnail?url=${encodeURIComponent(post.sampleUrl || post.fileUrl)}&quality=${quality}`;
      } else {
        directThumb = (!post.isVideo && post.sampleUrl && !isVideoExt(post.sampleUrl)) ? post.sampleUrl : (post.fileUrl || '');
      }
    }

    const shouldUseThumbProxy = (post.site === 'danbooru' || (directThumb && directThumb.includes('donmai.us'))) ? true : (state.settings?.proxyThumbnails !== false);
    let mainThumbSrc = directThumb ? (directThumb.startsWith('/api/') ? directThumb : (shouldUseThumbProxy ? getProxiedUrl(directThumb) : directThumb)) : '';

    // Archive-only posts have no source preview - show a generated ZIP placeholder
    if (!mainThumbSrc && post.isArchive) {
      mainThumbSrc = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" rx="14" fill="#232a36"/><path d="M38 26h30l16 16v50a8 8 0 0 1-8 8H38a8 8 0 0 1-8-8V34a8 8 0 0 1 8-8z" fill="#f97316" opacity="0.92"/><path d="M68 26v16h16" fill="#c2410c"/><text x="60" y="88" font-family="Arial,sans-serif" font-size="17" font-weight="bold" fill="#fff" text-anchor="middle">ZIP</text></svg>');
    }

    const siteName = post.siteName || (post.site ? post.site.toUpperCase() : '');
    const siteBadge = siteName ? `<span class="badge-site site-${post.site}">${siteName}</span>` : '';

    let formatBadge = '';
    if (post.isVideo) {
      if (post.hasSound) {
        formatBadge = `<span class="badge-format video" style="background-color: var(--accent-primary);">${t('gal.badgeSound', 'Звук')}</span>`;
      } else {
        formatBadge = `<span class="badge-format video">${t('gal.badgeVideo', 'Видео')}</span>`;
      }
    } else if (post.isArchive) {
      formatBadge = `<span class="badge-format" style="background-color: rgba(249, 115, 22, 0.85);" title="${t('gal.badgeZip.title', 'Пост содержит только ZIP-архивы - откроется после распаковки')}">ZIP</span>`;
    } else if (post.isGif) {
      formatBadge = `<span class="badge-format gif">GIF</span>`;
    } else if (post.width && post.height) {
      if (post.width >= 3800 || post.height >= 3800) {
        formatBadge = `<span class="badge-format" style="background-color: rgba(59, 130, 246, 0.85);">4K UHD</span>`;
      } else if (post.width >= 2000 || post.height >= 2000) {
        formatBadge = `<span class="badge-format" style="background-color: rgba(99, 102, 241, 0.75);">2K QHD</span>`;
      } else if (post.width >= 1200 || post.height >= 1200) {
        formatBadge = `<span class="badge-format" style="background-color: rgba(71, 85, 105, 0.75);">HD</span>`;
      }
    }

    const aiBadge = post.isAi ? `<span class="badge-ai" title="${t('gal.badgeAi.title', 'Работа создана с помощью ИИ')}">${t('gal.badgeAi', 'ИИ')}</span>` : '';

    let ratingBadge = '';
    const r = (post.rating || '').toLowerCase();
    if (r === 'e' || r === 'explicit' || r === 'q' || r === 'questionable') {
      ratingBadge = `<span class="badge-format" style="background-color: rgba(244,63,94,0.85);">18+</span>`;
    }

    // Strip junk suffixes from the author but display the full author name
    const rawAuthor = post.author || (post.tagDetails?.artist && post.tagDetails.artist[0]) || '';
    let cleanAuthor = rawAuthor.split(',')[0].trim().replace(/^@/, '').replace(/^pixiv:/, '');
    cleanAuthor = cleanAuthor.replace(/_?\((artist|creator|circle|studio|doujin|illustrator)\)$/i, '').replace(/\([^)]*\)$/, '').trim();
    const authorBadge = cleanAuthor ? `<span class="badge-format author" title="${t('gal.authorBadge.title', 'Автор: {name} (нажмите для поиска)').replace('{name}', cleanAuthor)}">${cleanAuthor}</span>` : '';

    let durationBadge = '';
    if (post.isVideo && (post.durationText || post.duration > 0)) {
      const durLabel = post.durationText || `${Math.floor(post.duration / 60)}:${Math.floor(post.duration % 60) < 10 ? '0' : ''}${Math.floor(post.duration % 60)}`;
      durationBadge = `<span class="badge-format badge-duration" title="${t('gal.durationBadge.title', 'Длительность: {d}').replace('{d}', durLabel)}">${durLabel}</span>`;
    }

    let dateBadge = '';
    if (post.createdAt) {
      try {
        const d = new Date(post.createdAt);
        if (!isNaN(d.getTime())) {
          const day = String(d.getDate()).padStart(2, '0');
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const year = String(d.getFullYear()).slice(-2);
          const shortDate = `${day}.${month}.${year}`;
          dateBadge = `<span class="badge-format badge-date" title="${t('gal.dateBadge.title', 'Дата: {d}').replace('{d}', d.toLocaleString(document.documentElement.lang === 'en' ? 'en-US' : 'ru-RU'))}">${shortDate}</span>`;
        }
      } catch (e) {}
    }

    let matchBadge = '';
    if (state.currentCategory === 'recommended' && post.matchPercent && post.matchPercent > 0) {
      const matchedInfo = (Array.isArray(post.matchedTags) && post.matchedTags.length > 0)
        ? `&#10;${t('gal.matchTagsInfo', 'Совпало: {tags}').replace('{tags}', post.matchedTags.join(', '))}`
        : '';
      matchBadge = `<span class="badge-format match-percent" title="${t('gal.matchBadge.title', 'Совпадение со вкусами: {p}%').replace('{p}', post.matchPercent)}${matchedInfo}">${post.matchPercent}%</span>`;
    }

    let albumBadge = '';
    if (post.isAlbum && post.albumCount > 1) {
      card.classList.add('is-album-card');
      albumBadge = `<span class="badge-format badge-album" title="${t('gal.albumBadge.title', 'Альбом: {n} изображений').replace('{n}', post.albumCount)}"><svg width="10" height="10" viewBox="0 0 24 24"><use href="#ic-album"/></svg> <span>${post.albumCount}</span></span>`;
    }

    const formatCompactNumber = (num) => {
      if (!num) return '0';
      if (typeof num === 'string') {
        if (num.match(/[KkMmBb]/)) return num;
        const parsed = parseFloat(num);
        if (isNaN(parsed)) return num;
        num = parsed;
      }
      if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
      if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
      return String(num);
    };

    const isFav = isPostFavorite(post.id);
    const isLiked = isPostLiked(post.id);

    card.innerHTML = `
      <div class="media-thumb-container">
        <div class="badge-group-top">
          <div style="display: flex; gap: 3px; align-items: center; flex-wrap: wrap; max-width: 65%;">
            ${siteBadge}
            ${albumBadge}
            ${formatBadge}
            ${durationBadge}
            ${matchBadge}
          </div>
          <div style="display: flex; gap: 3px; align-items: center; flex-wrap: wrap; justify-content: flex-end;">
            ${dateBadge}
            ${ratingBadge}
            ${aiBadge}
          </div>
        </div>

        <img class="media-thumb" 
             src="${mainThumbSrc}" 
             alt="Booru Media" 
             loading="lazy" 
             decoding="async"
             referrerpolicy="no-referrer"
             data-fallback="${directThumb}">
        
        ${post.isVideo ? `<video class="hover-video-preview" loop muted playsinline preload="none" referrerpolicy="no-referrer"></video>` : ''}

        <div class="badge-group-bottom">
          ${authorBadge}
        </div>

        <div class="card-overlay-bottom">
          <div class="card-meta-indicators">
            <div class="card-score" title="${t('gal.scoreBadge.title', 'Оценка / Рейтинг: {n}').replace('{n}', post.score || 0)}">
              <svg width="12" height="12" viewBox="0 0 24 24"><use href="#ic-star-filled"/></svg>
              <span>${post.score || 0}</span>
            </div>
            ${(post.views > 0 || post.viewsText) ? `
              <div class="card-views" title="${t('gal.viewsBadge.title', 'Просмотры: {n}').replace('{n}', post.viewsText || post.views)}">
                <svg width="12" height="12" viewBox="0 0 24 24"><use href="#ic-eye"/></svg>
                <span>${post.viewsText || formatCompactNumber(post.views)}</span>
              </div>
            ` : (post.favCount > 0 ? `
              <div class="card-views card-favs" title="${t('gal.favsBadge.title', 'В закладках: {n}').replace('{n}', post.favCount)}">
                <svg width="11" height="11" viewBox="0 0 24 24"><use href="#ic-bookmark-filled"/></svg>
                <span>${formatCompactNumber(post.favCount)}</span>
              </div>
            ` : '')}
          </div>
          <div class="card-action-btns">
            <button class="btn-card-action btn-card-dislike" data-post-id="${post.id}" title="${t('viewer.dislike.title', 'Не интересно (скрыть и меньше рекомендовать)')}">
              <svg width="13" height="13" viewBox="0 0 24 24"><use href="#ic-dislike"/></svg>
            </button>
            <button class="btn-card-action btn-card-like ${isLiked ? 'active' : ''}" data-post-id="${post.id}" title="${isLiked ? t('gal.unlike.title', 'Убрать лайк') : t('gal.like.title', 'Нравится')}">
              <svg width="13" height="13" viewBox="0 0 24 24"><use href="${isLiked ? '#ic-heart-filled' : '#ic-heart'}"/></svg>
            </button>
            <button class="btn-card-action btn-card-fav ${isFav ? 'active' : ''}" data-post-id="${post.id}" title="${isFav ? t('gal.unfav.title', 'Удалить из закладок') : t('gal.fav.title', 'Сохранить в закладки')}">
              <svg width="13" height="13" viewBox="0 0 24 24"><use href="${isFav ? '#ic-bookmark-filled' : '#ic-bookmark'}"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;

    const imgEl = card.querySelector('.media-thumb');
    if (imgEl) {
      imgEl.addEventListener('error', function () {
        const fallback = this.dataset.fallback;
        const proxyFallback = fallback ? (fallback.startsWith('/api/') ? fallback : getProxiedUrl(fallback)) : '';
        if (proxyFallback && this.src !== proxyFallback && !this.src.includes('/api/proxy')) {
          this.src = proxyFallback;
        } else if (post.previewUrl && !isVideoExt(post.previewUrl) && !this.src.includes(encodeURIComponent(post.previewUrl))) {
          this.src = getProxiedUrl(post.previewUrl);
        } else if (fallback && this.src !== fallback && !this.src.includes(encodeURIComponent(fallback))) {
          this.src = fallback.startsWith('/api/') ? fallback : getProxiedUrl(fallback);
        } else if (post.isVideo && !this.src.includes('/api/video-thumbnail')) {
          this.src = `/api/video-thumbnail?url=${encodeURIComponent(post.sampleUrl || post.fileUrl)}&quality=low`;
        } else {
          this.src = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200' fill='%231a202e'><rect width='200' height='200'/><text x='50%' y='50%' fill='%2364748b' text-anchor='middle' font-size='12'>${t('gal.badgeVideo', 'Видео')}</text></svg>`;
        }
      });
    }

    // Click logic is handled via delegation on galleryGrid (see initGallery)

    if (post.isVideo) {
      const videoEl = card.querySelector('.hover-video-preview');

      if (videoEl) {
        videoEl.addEventListener('loadedmetadata', () => {
          if (videoEl.duration && !post.duration) {
            post.duration = videoEl.duration;
            const mins = Math.floor(videoEl.duration / 60);
            const secs = Math.floor(videoEl.duration % 60);
            post.durationText = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
            let durBadge = card.querySelector('.badge-duration');
            if (!durBadge) {
              const topGroup = card.querySelector('.badge-group-top > div');
              if (topGroup) {
                durBadge = document.createElement('span');
                durBadge.className = 'badge-format badge-duration';
                durBadge.style.cssText = 'background-color: rgba(12, 9, 6, 0.85); border: 1px solid rgba(255, 255, 255, 0.2);';
                topGroup.appendChild(durBadge);
              }
            }
            if (durBadge) durBadge.textContent = post.durationText;
          }
        }, { once: true });

        videoEl.addEventListener('error', function () {
          // Background duration probes fail often (expired URLs, unsupported codecs);
          // escalating them queued server-side FFmpeg jobs just from scrolling the feed
          if (card._videoProbe) {
            card._videoProbe = false;
            return;
          }
          const videoTarget = post.fileUrl || post.sampleUrl;
          if (!videoTarget) {
            card.classList.remove('video-playing');
            return;
          }
          const transcodeUrl = `/api/transcode-video?url=${encodeURIComponent(videoTarget)}`;
          const proxyUrl = getProxiedUrl(videoTarget);
          if (this.src !== proxyUrl && !this.src.includes('/api/proxy') && this.src !== transcodeUrl) {
            this.src = proxyUrl;
            this.play().catch(() => {});
          } else if (this.src !== transcodeUrl) {
            this.src = transcodeUrl;
            this.play().catch(() => {});
          } else {
            card.classList.remove('video-playing');
          }
        });
      }

      if (mobileVideoObserver && state.settings?.videoAutoplayMobile !== false) {
        mobileVideoObserver.observe(card);
      }

      if (videoMetadataObserver && !post.duration) {
        videoMetadataObserver.observe(card);
      }
    }

    return card;
  }

  // ── Event delegation on the grid: one listener instead of thousands on cards ──

  // Touch intent tracking: a tap whose finger drifted between press and release
  // is likely a mis-tap during scrolling, so like/fav/hide actions skip it.
  let touchStartPoint = null;
  const TOUCH_DRIFT_TOLERANCE_PX = 10;
  galleryGrid.addEventListener('touchstart', (e) => {
    const firstTouch = e.touches[0];
    touchStartPoint = firstTouch ? { x: firstTouch.clientX, y: firstTouch.clientY } : null;
  }, { passive: true });

  function isDriftedTouch(e) {
    if (!touchStartPoint) return false;
    const dx = e.clientX - touchStartPoint.x;
    const dy = e.clientY - touchStartPoint.y;
    return (dx * dx + dy * dy) > TOUCH_DRIFT_TOLERANCE_PX * TOUCH_DRIFT_TOLERANCE_PX;
  }

  galleryGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.media-card');
    if (!card || !galleryGrid.contains(card)) return;
    const post = card._post;
    if (!post) return;

    const dislikeBtn = e.target.closest('.btn-card-dislike');
    if (dislikeBtn) {
      e.stopPropagation();
      if (!isDriftedTouch(e)) {
        haptic(20);
        handleDislikeClick(post, card);
      }
      return;
    }
    const likeBtn = e.target.closest('.btn-card-like');
    if (likeBtn) {
      e.stopPropagation();
      if (!isDriftedTouch(e)) {
        haptic([15, 20]);
        handleLikeClick(post, likeBtn);
      }
      return;
    }
    const favBtn = e.target.closest('.btn-card-fav');
    if (favBtn) {
      e.stopPropagation();
      if (!isDriftedTouch(e)) {
        haptic([15, 25, 15]);
        handleFavoriteClick(post, favBtn);
      }
      return;
    }
    const authorBadgeEl = e.target.closest('.badge-format.author');
    if (authorBadgeEl) {
      e.stopPropagation();
      const rawA = post.author || (post.tagDetails?.artist && post.tagDetails.artist[0]) || '';
      let cleanTag = rawA.split(',')[0].trim().replace(/^@/, '').replace(/^pixiv:/, '').replace(/\s+/g, '_');
      if (cleanTag && onTagSelect) {
        onTagSelect(cleanTag);
        return;
      }
    }
    onOpenViewer(parseInt(card.dataset.index, 10));
  });

  // Hover video previews via mouseover/mouseout delegation
  let hoverState = { card: null, timer: null, videoEl: null };

  function stopHoverPreview() {
    if (hoverState.timer) {
      clearTimeout(hoverState.timer);
      hoverState.timer = null;
    }
    if (hoverState.videoEl && hoverState.card) {
      hoverState.videoEl.pause();
      hoverState.videoEl.removeAttribute('src');
      hoverState.videoEl.load();
      hoverState.card.classList.remove('video-playing');
    }
    hoverState = { card: null, timer: null, videoEl: null };
  }

  galleryGrid.addEventListener('mouseover', (e) => {
    const card = e.target.closest('.media-card');
    if (card === hoverState.card) return;
    stopHoverPreview();
    if (!card || !galleryGrid.contains(card)) return;

    const post = card._post;
    const videoEl = card.querySelector('.hover-video-preview');
    if (!post || !post.isVideo || !videoEl) return;
    if (state.settings?.videoAutoplayHover === false) return;
    if (checkHoverPreview && !checkHoverPreview.checked) return;

    // Smart delay (150 ms) to avoid hammering the network during fast scrolling
    hoverState = { card, timer: null, videoEl };
    hoverState.timer = setTimeout(() => {
      if (!videoEl.src) {
        const videoTarget = post.fileUrl || post.sampleUrl;
        if (videoTarget) {
          const shouldUseProxy = (post.site === 'danbooru' || post.site === 'rule34video' || videoTarget.includes('donmai.us') || videoTarget.includes('rule34video.com') || videoTarget.includes('boomio-cdn.com')) ? true : (state.settings?.proxyVideos !== false && state.settings?.proxyVideoDefault !== false);
          videoEl.src = shouldUseProxy ? getProxiedUrl(videoTarget) : videoTarget;
        }
      }

      videoEl.muted = true;
      card._videoProbe = false;
      const playPromise = videoEl.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            card.classList.add('video-playing');
          })
          .catch(() => {});
      }
    }, 150);
  });

  galleryGrid.addEventListener('mouseleave', () => stopHoverPreview());
  galleryGrid.addEventListener('mouseout', (e) => {
    if (!hoverState.card) return;
    const related = e.relatedTarget;
    if (related && hoverState.card.contains(related)) return;
    stopHoverPreview();
  });

  const HIDE_UNDO_WINDOW_MS = 6000;

  function updateResultsCount() {
    const resultsCountEl = document.getElementById('resultsCount');
    if (resultsCountEl) resultsCountEl.textContent = t('gal.countPosts', '{n} постов').replace('{n}', state.posts.length);
  }

  async function handleDislikeClick(post, card) {
    toggleDislikeLocally(post);

    // Collapse the card right away but defer the removal until the undo window closes,
    // so an accidental hide can be reverted from the snackbar
    card.classList.add('card-hiding');
    let removed = false;
    const removalTimer = setTimeout(() => {
      removed = true;
      state.posts = state.posts.filter(p => p.id !== post.id);
      // Full re-render instead of surgical DOM removal: patching indices of remaining
      // placeholders and mounted cards is error-prone and let hidden posts resurface
      // when scrolling back through stale chunks of state.displayedPosts
      renderGallery(false, { preserveScroll: true });
    }, HIDE_UNDO_WINDOW_MS);

    showActionToast(
      t('gal.postHidden', 'Пост скрыт из рекомендаций'),
      t('gal.undoHide', 'Отменить'),
      async () => {
        if (removed) return;
        clearTimeout(removalTimer);
        toggleDislikeLocally(post);
        card.classList.remove('card-hiding');
        showToast(t('gal.hideUndone', 'Скрытие отменено'));
        try {
          await toggleDislikeApi(post);
        } catch (err) {
          console.error('Ошибка отмены скрытого поста:', err);
        }
      },
      HIDE_UNDO_WINDOW_MS
    );

    try {
      await toggleDislikeApi(post);
    } catch (err) {
      console.error('Ошибка сохранения скрытого поста:', err);
    }
  }

  async function handleLikeClick(post, btn) {
    const isLikedNow = toggleLikeLocally(post);
    const useEl = btn.querySelector('use');
    if (isLikedNow) {
      btn.classList.add('active');
      if (useEl) useEl.setAttribute('href', '#ic-heart-filled');
    } else {
      btn.classList.remove('active');
      if (useEl) useEl.setAttribute('href', '#ic-heart');
      if (state.currentCategory === 'profile' && state.profileSubTab === 'likes') {
        state.posts = state.posts.filter(p => p.id !== post.id);
        renderGallery(false, { preserveScroll: true });
      }
    }
    if (onFavoriteToggle) onFavoriteToggle();
    try {
      await toggleLikePost(post);
    } catch (err) {
      console.error('Ошибка лайка:', err);
    }
  }

  async function handleFavoriteClick(post, btn) {
    try {
      const res = await toggleFavoritePost(post);
      if (res.success) {
        const useEl = btn.querySelector('use');
        if (res.isFavorite) {
          state.favoriteIds.add(post.id);
          state.favorites.unshift(post);
          btn.classList.add('active');
          if (useEl) useEl.setAttribute('href', '#ic-bookmark-filled');
        } else {
          state.favoriteIds.delete(post.id);
          state.favorites = state.favorites.filter(f => f.id !== post.id);
          btn.classList.remove('active');
          if (useEl) useEl.setAttribute('href', '#ic-bookmark');
          if (state.currentCategory === 'favorites' || (state.currentCategory === 'profile' && state.profileSubTab === 'favorites')) {
            state.posts = state.posts.filter(p => p.id !== post.id);
            renderGallery(false, { preserveScroll: true });
          }
        }
        if (onFavoriteToggle) onFavoriteToggle();
      }
    } catch (err) {
      console.error('Ошибка избранного:', err);
    }
  }

  function renderAuthorCards(authorsList, { onExplore, onDelete, onAddAuthor, onChangePreview } = {}) {
    stopHoverPreview();
    resetVirtualization();
    galleryGrid.innerHTML = '';
    loadingSpinner.style.display = 'none';
    scrollLoader.style.display = 'none';

    currentSiteLabel.textContent = t('gal.labelAuthors', 'Любимые авторы');

    const stateTitle = emptyState.querySelector('.state-title');
    const stateDesc = emptyState.querySelector('.state-desc');

    if (!authorsList || authorsList.length === 0) {
      emptyState.style.display = 'flex';
      if (stateTitle) stateTitle.textContent = t('gal.noSavedAuthors', 'Нет сохраненных авторов');
      if (stateDesc) {
        stateDesc.innerHTML = `
          <span>${t('gal.noAuthorsHint', 'У вас пока нет любимых авторов.')}</span>
          <div style="margin-top: 14px;">
            <button type="button" class="btn-action-primary btn-add-author" id="btnAddAuthorEmpty" style="padding: 9px 18px; font-size: 13px;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              <span>${t('gal.addAuthorManually', 'Добавить автора вручную')}</span>
            </button>
          </div>
        `;
        const btnEmptyAdd = document.getElementById('btnAddAuthorEmpty');
        if (btnEmptyAdd && onAddAuthor) {
          btnEmptyAdd.addEventListener('click', onAddAuthor);
        }
      }
      resultsCount.textContent = t('gal.countAuthors', '{n} авторов').replace('{n}', '0');
      return;
    }

    emptyState.style.display = 'none';
    if (stateTitle) stateTitle.textContent = t('gal.noResultsTitle', 'Ничего не найдено');
    if (stateDesc) stateDesc.textContent = t('gal.noResultsDesc', 'Попробуйте изменить теги поиска или переключить Booru-источник.');

    resultsCount.textContent = t('gal.authorsCount', 'Авторов в избранном: {n}').replace('{n}', authorsList.length);

    const fragment = document.createDocumentFragment();
    authorsList.forEach(author => {
      const card = createAuthorCard(author, { onExplore, onDelete, onChangePreview });
      fragment.appendChild(card);
    });
    galleryGrid.appendChild(fragment);
  }

  const isVideoUrl = isVideoMediaUrl;

  function getAuthorPreviewByQuality(author) {
    if (!author) return '';
    const quality = state.settings?.previewQuality || 'medium';

    // 1. Look for a suitable static URL matching the selected quality
    let candidate = '';

    if (quality === 'low') {
      candidate = (!isVideoUrl(author.thumb180) && author.thumb180) ||
                  (!isVideoUrl(author.previewUrl) && author.previewUrl) ||
                  (!isVideoUrl(author.sampleUrl) && author.sampleUrl) ||
                  (!isVideoUrl(author.fileUrl) && author.fileUrl) || '';
    } else if (quality === 'medium') {
      candidate = (!isVideoUrl(author.thumb360) && author.thumb360) ||
                  (!isVideoUrl(author.sampleUrl) && author.sampleUrl) ||
                  (!isVideoUrl(author.previewUrl) && author.previewUrl) ||
                  (!isVideoUrl(author.fileUrl) && author.fileUrl) || '';
    } else if (quality === 'high') {
      candidate = (!isVideoUrl(author.thumb720) && author.thumb720) ||
                  (!isVideoUrl(author.sampleUrl) && author.sampleUrl) ||
                  (!isVideoUrl(author.fileUrl) && author.fileUrl) ||
                  (!isVideoUrl(author.previewUrl) && author.previewUrl) || '';
    } else if (quality === 'original') {
      candidate = (!isVideoUrl(author.fileUrl) && author.fileUrl) ||
                  (!isVideoUrl(author.sampleUrl) && author.sampleUrl) ||
                  (!isVideoUrl(author.thumbOriginal) && author.thumbOriginal) ||
                  (!isVideoUrl(author.previewUrl) && author.previewUrl) || '';
    }

    // 2. If all direct URLs are empty or videos, check the raw previewUrl
    if (!candidate) {
      const raw = author.previewUrl || author.sampleUrl || author.fileUrl || '';
      if (!raw) return '';

      if (isVideoUrl(raw) || raw.includes('/api/transcode') || raw.includes('.mp4') || raw.includes('.webm')) {
        return `/api/video-thumbnail?url=${encodeURIComponent(raw)}&quality=${quality}`;
      }
      candidate = raw;
    }

    // If the candidate is a video URL, transcode it via /api/video-thumbnail
    if (isVideoUrl(candidate)) {
      return `/api/video-thumbnail?url=${encodeURIComponent(candidate)}&quality=${quality}`;
    }

    // 3. Adaptive transformation for the Danbooru CDN
    if (candidate.includes('donmai.us') || (candidate.includes('danbooru') && candidate.includes('/180x180/'))) {
      if (quality === 'low') return candidate.replace(/\/(360x360|720x720|original|sample)\//g, '/180x180/');
      if (quality === 'medium') return candidate.replace(/\/(180x180|720x720|original)\//g, '/360x360/');
      if (quality === 'high') return candidate.replace(/\/(180x180|360x360)\//g, '/720x720/');
      if (quality === 'original') return candidate.replace(/\/(180x180|360x360|720x720)\//g, '/original/');
    }

    return candidate;
  }

  function createAuthorCard(author, { onExplore, onDelete, onChangePreview } = {}) {
    const card = document.createElement('div');
    card.className = 'author-card';
    card.dataset.authorName = author.name;

    const siteObj = state.sites.find(s => s.id === author.site);
    const siteName = siteObj ? siteObj.name : (author.site ? author.site.toUpperCase() : 'Danbooru');
    const rawPreview = getAuthorPreviewByQuality(author);
    const shouldUseThumbProxy = (author.site === 'danbooru' || (rawPreview && rawPreview.includes('donmai.us'))) ? true : (state.settings?.proxyThumbnails !== false);
    const preview = rawPreview ? (rawPreview.startsWith('/api/') ? rawPreview : (shouldUseThumbProxy ? getProxiedUrl(rawPreview) : rawPreview)) : '';

    let formattedDate = '';
    if (author.createdAt) {
      try {
        const d = new Date(author.createdAt);
        if (!isNaN(d.getTime())) formattedDate = d.toLocaleDateString(document.documentElement.lang === 'en' ? 'en-US' : 'ru-RU');
      } catch (e) {}
    }

    card.innerHTML = `
      <div class="author-card-cover">
        ${preview ? `<img class="author-cover-img" src="${preview}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none'; this.parentElement.querySelector('.author-cover-placeholder')?.removeAttribute('style');">` : ''}
        <div class="author-cover-placeholder" style="${preview ? 'display: none;' : ''}"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg></div>
        <div class="author-card-gradient"></div>
        <span class="author-card-site-badge">${siteName}</span>
        <button type="button" class="btn-author-change-cover" title="${t('gal.changeCover.title', 'Сменить обложку автора')}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          <span class="change-cover-text">${t('gal.coverText', 'Обложка')}</span>
        </button>
      </div>
      <div class="author-card-body">
        <div class="author-card-title-row">
          <span class="author-name-text" title="${author.displayName || author.name}">${author.displayName || author.name}</span>
          ${formattedDate ? `<span class="author-tag-pill" style="color: var(--text-muted); font-size: 10px;">${formattedDate}</span>` : ''}
        </div>
        <div class="author-tag-pill">
          <span>${author.name}</span>
        </div>
        <div class="author-card-actions">
          <button class="btn-author-explore" title="${t('gal.exploreAuthor.title', 'Открыть работы автора {name}').replace('{name}', author.name)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <span>${t('gal.viewWorks', 'Смотреть работы')}</span>
          </button>
          <button class="btn-author-delete" title="${t('gal.removeAuthor.title', 'Удалить из избранных')}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          </button>
        </div>
      </div>
    `;

    const btnCoverTop = card.querySelector('.btn-author-change-cover');
    if (btnCoverTop) {
      btnCoverTop.addEventListener('click', (e) => {
        e.stopPropagation();
        if (onChangePreview) onChangePreview(author);
      });
    }

    const btnExplore = card.querySelector('.btn-author-explore');
    if (btnExplore) {
      btnExplore.addEventListener('click', (e) => {
        e.stopPropagation();
        if (onExplore) onExplore(author);
      });
    }

    const btnDelete = card.querySelector('.btn-author-delete');
    if (btnDelete) {
      btnDelete.addEventListener('click', (e) => {
        e.stopPropagation();
        if (onDelete) onDelete(author);
      });
    }

    return card;
  }

  // Note: .btn-size grid-size handling lives in app.js (setupEventListeners),
  // which persists the choice and preserves other classes on the grid

  return {
    renderGallery,
    renderAuthorCards,
    showLoading: () => {
      loadingSpinner.style.display = 'flex';
      emptyState.style.display = 'none';
      scrollLoader.style.display = 'none';
      resultsCount.textContent = t('gal.searching', 'Идёт поиск...');
    },
    showScrollLoading: () => {
      scrollLoader.style.display = 'flex';
      resultsCount.textContent = t('gal.loadingMore', 'Загрузка следующих постов...');
    }
  };
}
