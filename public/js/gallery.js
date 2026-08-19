import { state, isPostFavorite, isAuthorFavorite, isPostLiked, toggleLikeLocally } from './state.js';
import { getProxiedUrl, toggleFavoritePost, toggleLikePost } from './api.js';

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

  // Бесшовная бесконечная прокрутка
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

    // Мобильный автоплей видео без звука при прокрутке в фокус
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
              videoEl.src = shouldUseProxy ? getProxiedUrl(videoTarget) : videoTarget;
            }
          }
          videoEl.muted = true;
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

    // Наблюдатель для определения длительности видео без автоплея
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
  } else {
    window.addEventListener('scroll', () => {
      if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 600) {
        if (!state.isLoading && state.hasMore && state.posts.length > 0 && state.currentCategory !== 'favorites') {
          onLoadMore();
        }
      }
    });
  }

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

  function renderGallery(append = false) {
    if (btnLoadMore) {
      btnLoadMore.classList.remove('loading');
    }

    // При активной сортировке и дозагрузке (append=true) необходимо полностью
    // перерендерить список: новые посты вставляются в середину отсортированного
    // массива, поэтому нельзя просто добавить их в конец DOM
    if (append && state.videoDurationSort && state.videoDurationSort !== 'none') {
      append = false;
    }

    if (!append) {
      galleryGrid.innerHTML = '';
    }

    loadingSpinner.style.display = 'none';
    scrollLoader.style.display = 'none';

    if (state.currentCategory === 'favorites') {
      currentSiteLabel.textContent = 'Избранное';
    } else if (state.currentCategory === 'profile') {
      currentSiteLabel.textContent = 'Профиль';
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

      if (state.currentCategory === 'profile') {
        if (state.profileSubTab === 'likes') {
          if (emptyTitle) emptyTitle.textContent = 'Нет понравившихся постов';
          if (emptyDesc) emptyDesc.textContent = 'Оценивайте посты сердечком в галерее или просмотрщике, чтобы собрать коллекцию.';
        } else if (state.profileSubTab === 'favorites') {
          if (emptyTitle) emptyTitle.textContent = 'В закладках пока пусто';
          if (emptyDesc) emptyDesc.textContent = 'Сохраняйте работы в закладки, чтобы быстро возвращаться к ним в любое время.';
        } else if (state.profileSubTab === 'authors') {
          if (emptyTitle) emptyTitle.textContent = 'Нет отслеживаемых авторов';
          if (emptyDesc) emptyDesc.textContent = 'Добавляйте художников в любимые, чтобы отслеживать их новые работы.';
        }
      } else if (state.currentCategory === 'favorites') {
        if (emptyTitle) emptyTitle.textContent = 'В избранном пока пусто';
        if (emptyDesc) emptyDesc.textContent = 'Нажмите на значок закладки на любой карточке, чтобы сохранить пост.';
      } else {
        if (emptyTitle) emptyTitle.textContent = 'Ничего не найдено';
        if (emptyDesc) emptyDesc.textContent = 'Попробуйте изменить теги поиска или переключить Booru-источник.';
      }

      resultsCount.textContent = '0 постов';
      if (loadMoreContainer) loadMoreContainer.style.display = 'none';
      return;
    }

    emptyState.style.display = 'none';
    resultsCount.textContent = `Загружено: ${postsToDisplay.length} постов`;

    // Отображение кнопки «Загрузить еще»
    if (loadMoreContainer) {
      if (state.hasMore && state.currentCategory !== 'favorites' && state.currentCategory !== 'profile' && postsToDisplay.length >= 10) {
        loadMoreContainer.style.display = 'flex';
      } else {
        loadMoreContainer.style.display = 'none';
      }
    }

    const startIndex = append ? galleryGrid.children.length : 0;
    const postsToRender = postsToDisplay.slice(startIndex);

    // Батчевая вставка через DocumentFragment для минимизации перерисовок DOM
    const fragment = document.createDocumentFragment();
    postsToRender.forEach((post, i) => {
      const globalIndex = startIndex + i;
      const card = createMediaCard(post, globalIndex);
      fragment.appendChild(card);
    });
    galleryGrid.appendChild(fragment);

    // Авто-дозагрузка: если постов так мало, что нет скроллбара
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

    const isVideoExt = (url) => {
      if (!url) return false;
      const clean = url.split('?')[0].toLowerCase();
      return clean.endsWith('.mp4') || clean.endsWith('.webm') || clean.endsWith('.zip') || clean.endsWith('.mkv') || clean.endsWith('.mov') || clean.endsWith('.m4v');
    };

    // Выбор источника превью в соответствии с настройкой качества: 'low', 'medium', 'high', 'original'
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
      // Статичные изображения
      if (quality === 'low') {
        // Danbooru: 180x180 эскиз, остальные: previewUrl
        directThumb = (post.site === 'danbooru' && post.thumb180) ? post.thumb180
          : ((!isVideoExt(post.previewUrl) && post.previewUrl) || post.sampleUrl || post.fileUrl || '');
      } else if (quality === 'medium') {
        // Danbooru: 360x360 вариант напрямую из поля
        if (post.site === 'danbooru') {
          directThumb = post.thumb360 || post.thumb180 || post.previewUrl || '';
        } else {
          directThumb = (!isVideoExt(post.sampleUrl) && post.sampleUrl) || (!isVideoExt(post.previewUrl) && post.previewUrl) || post.fileUrl || '';
        }
      } else if (quality === 'high') {
        // Danbooru: 720x720 WebP вариант напрямую из поля
        if (post.site === 'danbooru') {
          directThumb = post.thumb720 || post.thumbSample || post.thumb360 || post.previewUrl || '';
        } else {
          directThumb = (!isVideoExt(post.sampleUrl) && post.sampleUrl) || post.fileUrl || post.previewUrl || '';
        }
      } else if (quality === 'original') {
        // Danbooru: полный оригинал напрямую из поля
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
    const mainThumbSrc = directThumb ? (directThumb.startsWith('/api/') ? directThumb : (shouldUseThumbProxy ? getProxiedUrl(directThumb) : directThumb)) : '';

    const siteName = post.siteName || (post.site ? post.site.toUpperCase() : '');
    const siteBadge = siteName ? `<span class="badge-site site-${post.site}">${siteName}</span>` : '';

    let formatBadge = '';
    if (post.isVideo) {
      if (post.hasSound) {
        formatBadge = `<span class="badge-format video" style="background-color: var(--accent-primary);">Звук</span>`;
      } else {
        formatBadge = `<span class="badge-format video">Видео</span>`;
      }
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

    const aiBadge = post.isAi ? `<span class="badge-ai" title="Работа создана с помощью ИИ">ИИ</span>` : '';

    let ratingBadge = '';
    const r = (post.rating || '').toLowerCase();
    if (r === 'e' || r === 'explicit' || r === 'q' || r === 'questionable') {
      ratingBadge = `<span class="badge-format" style="background-color: rgba(244,63,94,0.85);">18+</span>`;
    }

    // Очищаем автора от мусорных суффиксов, но отображаем полное имя автора
    const rawAuthor = post.author || (post.tagDetails?.artist && post.tagDetails.artist[0]) || '';
    let cleanAuthor = rawAuthor.split(',')[0].trim().replace(/^@/, '').replace(/^pixiv:/, '');
    cleanAuthor = cleanAuthor.replace(/_?\((artist|creator|circle|studio|doujin|illustrator)\)$/i, '').replace(/\([^)]*\)$/, '').trim();
    const authorBadge = cleanAuthor ? `<span class="badge-format author" title="Автор: ${cleanAuthor} (нажмите для поиска)">${cleanAuthor}</span>` : '';

    let durationBadge = '';
    if (post.isVideo && (post.durationText || post.duration > 0)) {
      const durLabel = post.durationText || `${Math.floor(post.duration / 60)}:${Math.floor(post.duration % 60) < 10 ? '0' : ''}${Math.floor(post.duration % 60)}`;
      durationBadge = `<span class="badge-format badge-duration" title="Длительность: ${durLabel}">${durLabel}</span>`;
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
          dateBadge = `<span class="badge-format badge-date" title="Дата: ${d.toLocaleString('ru-RU')}">${shortDate}</span>`;
        }
      } catch (e) {}
    }

    let matchBadge = '';
    if (state.currentCategory === 'recommended' && post.matchPercent && post.matchPercent > 0) {
      matchBadge = `<span class="badge-format match-percent" title="Совпадение со вкусами: ${post.matchPercent}%">${post.matchPercent}%</span>`;
    }

    const isFav = isPostFavorite(post.id);
    const isLiked = isPostLiked(post.id);

    card.innerHTML = `
      <div class="media-thumb-container">
        <div class="badge-group-top">
          <div style="display: flex; gap: 3px; align-items: center; flex-wrap: wrap; max-width: 65%;">
            ${siteBadge}
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
          <div class="card-score">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 28.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            ${post.score || 0}
          </div>
          <div class="card-action-btns">
            <button class="btn-card-action btn-card-like ${isLiked ? 'active' : ''}" data-post-id="${post.id}" title="${isLiked ? 'Убрать лайк' : 'Нравится'}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
            </button>
            <button class="btn-card-action btn-card-fav ${isFav ? 'active' : ''}" data-post-id="${post.id}" title="${isFav ? 'Удалить из закладок' : 'Сохранить в закладки'}">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
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
          this.src = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200' fill='%231a202e'><rect width='200' height='200'/><text x='50%' y='50%' fill='%2364748b' text-anchor='middle' font-size='12'>🎬 Видео</text></svg>`;
        }
      });
    }

    card.addEventListener('click', (e) => {
      const likeBtn = e.target.closest('.btn-card-like');
      if (likeBtn) {
        e.stopPropagation();
        if (navigator.vibrate) try { navigator.vibrate([15, 20]); } catch (err) {}
        handleLikeClick(post, likeBtn);
        return;
      }
      const favBtn = e.target.closest('.btn-card-fav');
      if (favBtn) {
        e.stopPropagation();
        if (navigator.vibrate) try { navigator.vibrate([15, 25, 15]); } catch (err) {}
        handleFavoriteClick(post, favBtn);
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
      onOpenViewer(index);
    });

    if (post.isVideo) {
      const videoEl = card.querySelector('.hover-video-preview');
      let hoverTimer = null;

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
                durBadge.style.cssText = 'background-color: rgba(15, 23, 42, 0.85); border: 1px solid rgba(255, 255, 255, 0.2);';
                topGroup.appendChild(durBadge);
              }
            }
            if (durBadge) durBadge.textContent = `⏱️ ${post.durationText}`;
          }
        }, { once: true });
      }

      if (mobileVideoObserver && state.settings?.videoAutoplayMobile !== false) {
        mobileVideoObserver.observe(card);
      }

      if (videoMetadataObserver && !post.duration) {
        videoMetadataObserver.observe(card);
      }

      card.addEventListener('mouseenter', () => {
        if (state.settings?.videoAutoplayHover === false || !videoEl) return;
        if (checkHoverPreview && !checkHoverPreview.checked) return;
        
        // Умная задержка (150 мс), чтобы не перегружать сеть при быстром скролле
        hoverTimer = setTimeout(() => {
          if (!videoEl.src) {
            const videoTarget = post.fileUrl || post.sampleUrl;
            if (videoTarget) {
              const shouldUseProxy = (post.site === 'danbooru' || post.site === 'rule34video' || videoTarget.includes('donmai.us') || videoTarget.includes('rule34video.com') || videoTarget.includes('boomio-cdn.com')) ? true : (state.settings?.proxyVideos !== false && state.settings?.proxyVideoDefault !== false);
              videoEl.src = shouldUseProxy ? getProxiedUrl(videoTarget) : videoTarget;
            }
          }
          
          videoEl.muted = true;
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

      card.addEventListener('mouseleave', () => {
        if (hoverTimer) {
          clearTimeout(hoverTimer);
          hoverTimer = null;
        }
        if (videoEl) {
          videoEl.pause();
          videoEl.removeAttribute('src');
          videoEl.load();
          card.classList.remove('video-playing');
        }
      });

      videoEl.addEventListener('error', function () {
        const videoTarget = post.fileUrl || post.sampleUrl;
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

    return card;
  }

  async function handleLikeClick(post, btn) {
    const isLikedNow = toggleLikeLocally(post);
    if (isLikedNow) {
      btn.classList.add('active');
      btn.querySelector('svg').setAttribute('fill', 'currentColor');
    } else {
      btn.classList.remove('active');
      btn.querySelector('svg').setAttribute('fill', 'none');
      if (state.currentCategory === 'profile' && state.profileSubTab === 'likes') {
        state.posts = state.posts.filter(p => p.id !== post.id);
        renderGallery();
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
        if (res.isFavorite) {
          state.favoriteIds.add(post.id);
          state.favorites.unshift(post);
          btn.classList.add('active');
          btn.querySelector('svg').setAttribute('fill', 'currentColor');
        } else {
          state.favoriteIds.delete(post.id);
          state.favorites = state.favorites.filter(f => f.id !== post.id);
          btn.classList.remove('active');
          btn.querySelector('svg').setAttribute('fill', 'none');
          if (state.currentCategory === 'favorites' || (state.currentCategory === 'profile' && state.profileSubTab === 'favorites')) {
            state.posts = state.posts.filter(p => p.id !== post.id);
            renderGallery();
          }
        }
        if (onFavoriteToggle) onFavoriteToggle();
      }
    } catch (err) {
      console.error('Ошибка избранного:', err);
    }
  }

  function renderAuthorCards(authorsList, { onExplore, onDelete, onAddAuthor, onChangePreview } = {}) {
    galleryGrid.innerHTML = '';
    loadingSpinner.style.display = 'none';
    scrollLoader.style.display = 'none';

    currentSiteLabel.textContent = 'Любимые авторы';

    const stateTitle = emptyState.querySelector('.state-title');
    const stateDesc = emptyState.querySelector('.state-desc');

    if (!authorsList || authorsList.length === 0) {
      emptyState.style.display = 'flex';
      if (stateTitle) stateTitle.textContent = 'Нет сохраненных авторов';
      if (stateDesc) {
        stateDesc.innerHTML = `
          <span>У вас пока нет сохраненных авторов в подписках.</span>
          <div style="margin-top: 14px;">
            <button type="button" class="btn-action-primary btn-add-author" id="btnAddAuthorEmpty" style="padding: 9px 18px; font-size: 13px;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              <span>Добавить автора вручную</span>
            </button>
          </div>
        `;
        const btnEmptyAdd = document.getElementById('btnAddAuthorEmpty');
        if (btnEmptyAdd && onAddAuthor) {
          btnEmptyAdd.addEventListener('click', onAddAuthor);
        }
      }
      resultsCount.textContent = '0 авторов';
      return;
    }

    emptyState.style.display = 'none';
    if (stateTitle) stateTitle.textContent = 'Ничего не найдено';
    if (stateDesc) stateDesc.textContent = 'Попробуйте изменить теги поиска или переключить Booru-источник.';

    resultsCount.textContent = `Авторов в избранном: ${authorsList.length}`;

    const fragment = document.createDocumentFragment();
    authorsList.forEach(author => {
      const card = createAuthorCard(author, { onExplore, onDelete, onChangePreview });
      fragment.appendChild(card);
    });
    galleryGrid.appendChild(fragment);
  }

  function createAuthorCard(author, { onExplore, onDelete, onChangePreview } = {}) {
    const card = document.createElement('div');
    card.className = 'author-card';
    card.dataset.authorName = author.name;

    const siteObj = state.sites.find(s => s.id === author.site);
    const siteName = siteObj ? siteObj.name : (author.site ? author.site.toUpperCase() : 'Danbooru');
    const shouldUseThumbProxy = state.settings?.proxyThumbnails !== false;
    const preview = author.previewUrl ? (author.previewUrl.startsWith('/api/') ? author.previewUrl : (shouldUseThumbProxy ? getProxiedUrl(author.previewUrl) : author.previewUrl)) : '';

    let formattedDate = '';
    if (author.createdAt) {
      try {
        const d = new Date(author.createdAt);
        if (!isNaN(d.getTime())) formattedDate = d.toLocaleDateString('ru-RU');
      } catch (e) {}
    }

    card.innerHTML = `
      <div class="author-card-cover">
        ${preview ? `<img class="author-cover-img" src="${preview}" alt="${author.displayName || author.name}" loading="lazy" decoding="async">` : `<div class="author-cover-placeholder"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg></div>`}
        <div class="author-card-gradient"></div>
        <span class="author-card-site-badge">${siteName}</span>
        <button type="button" class="btn-author-change-cover" title="Сменить обложку автора">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          <span class="change-cover-text">Обложка</span>
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
          <button class="btn-author-explore" title="Открыть работы автора ${author.name}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <span>Смотреть работы</span>
          </button>
          <button class="btn-author-change-cover-action" title="Выбрать обложку из постов автора">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </button>
          <button class="btn-author-delete" title="Удалить из избранных">
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

    const btnCoverAction = card.querySelector('.btn-author-change-cover-action');
    if (btnCoverAction) {
      btnCoverAction.addEventListener('click', (e) => {
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

  document.querySelectorAll('.btn-size').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-size').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const cols = btn.dataset.cols;
      const is1Col = localStorage.getItem('booru_grid_mobile') === '1col';
      galleryGrid.className = `gallery-grid grid-${cols} ${is1Col ? 'grid-1col' : ''}`;
    });
  });

  return {
    renderGallery,
    renderAuthorCards,
    showLoading: () => {
      loadingSpinner.style.display = 'flex';
      emptyState.style.display = 'none';
      scrollLoader.style.display = 'none';
      resultsCount.textContent = 'Идёт поиск...';
    },
    showScrollLoading: () => {
      scrollLoader.style.display = 'flex';
      resultsCount.textContent = `Загрузка следующих постов...`;
    }
  };
}
