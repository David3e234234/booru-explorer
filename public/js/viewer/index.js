import { state, isPostFavorite, isPostLiked, isPostDisliked, toggleLikeLocally, toggleDislikeLocally, markPostViewed, recordSessionInteraction } from '../state.js';
import { getProxiedUrl, toggleFavoritePost, toggleLikePost, toggleDislikeApi } from '../api.js';
import { showToast, haptic, getPostSiteUrl, copyToClipboard } from '../modules/uiUtils.js';
import { setupImageZoom } from './imageZoom.js';
import { createVideoPlayer } from './videoPlayer.js';
import { renderSidebarTags, renderSidebarInfo } from './viewerSidebar.js';
import { notifyViewerOpened, notifyViewerMoved, notifyViewerClosed } from '../router.js';
import { t } from '../i18n.js';

import { resolvePostMetadata, renderAuthorInfo, handleAuthorFavToggle } from './viewerMetadata.js';
import { renderSidebarArchives, renderArchivePostCard, cancelAllArchiveDownloads } from './viewerArchives.js';
import { isArchiveInspectModalOpen, closeArchiveInspectModal, setArchiveInspectContext } from './viewerArchiveInspect.js';
import { renderSidebarCloudLinks, renderSidebarContent } from './viewerCloudLinks.js';
import { renderSidebarSimilarPosts, configureSimilar, initSimilarEvents } from './viewerSimilar.js';
import { getCurrentMediaItem, renderAlbumFilmstrip, switchAlbumSlide, preloadAdjacentMedia, loadFullAlbumForPost, downloadFullAlbum, downloadSingleMedia, configureAlbum } from './viewerAlbum.js';
import { setupViewerGestures } from './viewerGestures.js';

export function initViewer({ onFavoriteToggle, onFavoriteAuthorToggle, onTagSelect, onDislikeToggle, onFindSimilar } = {}) {
  const modal = document.getElementById('viewerModal');
  const backdrop = document.getElementById('viewerBackdrop');
  const btnClose = document.getElementById('btnCloseViewer');
  const btnPrev = document.getElementById('btnViewerPrev');
  const btnNext = document.getElementById('btnViewerNext');

  const viewerContent = document.querySelector('.viewer-content');
  const mediaWrapper = document.getElementById('viewerMediaWrapper');
  const siteBadge = document.getElementById('viewerSiteBadge');
  const resBadge = document.getElementById('viewerResolution');
  const extBadge = document.getElementById('viewerExtBadge');
  const btnDislikeModal = document.getElementById('btnDislikeModal');
  const btnLikeModal = document.getElementById('btnLikeModal');
  const btnFavModal = document.getElementById('btnFavModal');
  const btnSimilarModal = document.getElementById('btnSimilarModal');
  const btnDownload = document.getElementById('btnDownload');
  const btnDownloadAlbum = document.getElementById('btnDownloadAlbum');
  const btnCopyLink = document.getElementById('btnCopyLink');
  const btnViewerTagsToggle = document.getElementById('btnViewerTagsToggle');
  const btnCloseViewerTags = document.getElementById('btnCloseViewerTags');
  const viewerSidebar = document.getElementById('viewerSidebar');

  const viewerFavAuthorBtn = document.getElementById('viewerFavAuthorBtn');
  const btnFavAuthorSidebar = document.getElementById('btnFavAuthorSidebar');
  const btnFetchFullAlbum = document.getElementById('btnFetchFullAlbum');
  const btnDownloadAlbumSidebar = document.getElementById('btnDownloadAlbumSidebar');
  const btnDislikeSidebar = document.getElementById('btnDislikeSidebar');
  const btnDislikeSidebarText = document.getElementById('btnDislikeSidebarText');
  const btnCopyAllTags = document.getElementById('btnCopyAllTags');
  const btnCloseArchiveInspectModal = document.getElementById('btnCloseArchiveInspectModal');
  const archiveInspectBackdrop = document.getElementById('archiveInspectBackdrop');

  const viewerSimilarFilmstrip = document.getElementById('viewerSimilarFilmstrip');
  const similarFilmstripInner = document.getElementById('similarFilmstripInner');

  let currentPost = null;
  let currentAlbumIndex = 0;
  let directPostRef = null;
  let activeAbortController = null;
  let activeBlobUrl = null;
  let currentZoomInstance = null;
  let currentVideoInstance = null;
  let activeResolvePromise = null;

  function updateNavButtons() {
    if (!btnPrev || !btnNext) return;

    if (directPostRef) {
      const hasAlbumPrev = Boolean(currentPost?.isAlbum && Array.isArray(currentPost.albumItems) && currentAlbumIndex > 0);
      const hasAlbumNext = Boolean(currentPost?.isAlbum && Array.isArray(currentPost.albumItems) && currentAlbumIndex < currentPost.albumItems.length - 1);
      btnPrev.disabled = !hasAlbumPrev;
      btnPrev.classList.toggle('is-disabled', !hasAlbumPrev);
      btnNext.disabled = !hasAlbumNext;
      btnNext.classList.toggle('is-disabled', !hasAlbumNext);
      return;
    }

    const list = (state.displayedPosts && state.displayedPosts.length > 0) ? state.displayedPosts : state.posts;
    const canPrev = (currentPost?.isAlbum && Array.isArray(currentPost.albumItems) && currentAlbumIndex > 0) || (state.currentViewerIndex > 0);
    const canNext = (currentPost?.isAlbum && Array.isArray(currentPost.albumItems) && currentAlbumIndex < currentPost.albumItems.length - 1) || (state.currentViewerIndex >= 0 && state.currentViewerIndex < list.length - 1);

    btnPrev.disabled = !canPrev;
    btnPrev.classList.toggle('is-disabled', !canPrev);
    btnNext.disabled = !canNext;
    btnNext.classList.toggle('is-disabled', !canNext);
  }

  function loadMediaItem(item) {
    if (activeAbortController) { activeAbortController.abort(); activeAbortController = null; }
    if (activeBlobUrl) { URL.revokeObjectURL(activeBlobUrl); activeBlobUrl = null; }
    if (currentZoomInstance) { currentZoomInstance.destroy(); currentZoomInstance = null; }
    if (currentVideoInstance) { currentVideoInstance.destroy(); currentVideoInstance = null; }

    const directMedia = item.sampleUrl || item.fileUrl || item.previewUrl || '';
    if (!directMedia) {
      showToast(t('vw.mediaUnavailable', 'Ссылка на медиа недоступна'));
      return;
    }

    if (!mediaWrapper) return;
    mediaWrapper.innerHTML = '';
    const abortRef = {
      get current() { return activeAbortController; },
      set current(val) { activeAbortController = val; }
    };
    const blobRef = {
      get current() { return activeBlobUrl; },
      set current(val) { activeBlobUrl = val; }
    };

    if (item.isVideo) {
      currentVideoInstance = createVideoPlayer(item, {
        state,
        getProxiedUrl,
        abortRef,
        blobRef,
        resolvedVideoPromise: activeResolvePromise
      });
      mediaWrapper.appendChild(currentVideoInstance.videoContainer);
      mediaWrapper.appendChild(currentVideoInstance.statusBanner);
    } else {
      const container = document.createElement('div');
      container.className = 'viewer-image-container';

      const thumbMedia = item.previewUrl || item.thumb360 || item.thumb180 || item.sampleUrl || '';
      const needsThumbProxy = item.site === 'danbooru' || thumbMedia.includes('donmai.us') || state.settings?.proxyThumbnails !== false;
      const placeholderSrc = thumbMedia ? (thumbMedia.startsWith('/api/') ? thumbMedia : (needsThumbProxy ? getProxiedUrl(thumbMedia) : thumbMedia)) : '';

      let placeholderImg = null;
      if (placeholderSrc) {
        placeholderImg = document.createElement('img');
        placeholderImg.className = 'viewer-image-placeholder';
        placeholderImg.src = placeholderSrc;
        placeholderImg.referrerPolicy = 'no-referrer';
        placeholderImg.alt = '';
        container.appendChild(placeholderImg);
      }

      const spinner = document.createElement('div');
      spinner.className = 'viewer-media-spinner';
      container.appendChild(spinner);

      const img = document.createElement('img');
      img.className = 'viewer-image';
      const needsImgProxy = item.site === 'danbooru' || directMedia.includes('donmai.us') || state.settings?.proxyFullImages !== false;
      const proxyMedia = getProxiedUrl(directMedia);
      img.referrerPolicy = 'no-referrer';
      img.alt = 'Full View';

      const onImageReady = () => {
        img.classList.add('is-loaded');
        if (placeholderImg) {
          placeholderImg.classList.add('is-hidden');
          setTimeout(() => {
            if (placeholderImg && placeholderImg.parentElement) placeholderImg.remove();
          }, 300);
        }
        if (spinner && spinner.parentElement) {
          spinner.remove();
        }
      };

      img.addEventListener('load', onImageReady);
      img.addEventListener('error', function () {
        if (this.src !== proxyMedia) {
          console.warn('[Viewer Image Fallback] Переключение на прокси');
          this.src = proxyMedia;
        } else if (item.fileUrl && item.sampleUrl && this.src.includes(encodeURIComponent(item.sampleUrl))) {
          console.warn('[Viewer Image Fallback] Переключение на fileUrl');
          this.src = getProxiedUrl(item.fileUrl);
        } else if (item.previewUrl && !this.src.includes(encodeURIComponent(item.previewUrl))) {
          console.warn('[Viewer Image Fallback] Переключение на previewUrl');
          this.src = getProxiedUrl(item.previewUrl);
        } else {
          if (spinner && spinner.parentElement) spinner.remove();
          showToast(t('vw.fullImgFailed', 'Не удалось загрузить полноразмерное фото'));
        }
      });

      img.src = needsImgProxy ? proxyMedia : directMedia;
      if (img.complete && img.naturalWidth > 0) onImageReady();

      container.appendChild(img);
      currentZoomInstance = setupImageZoom(img, { showToast });
      mediaWrapper.appendChild(container);

      preloadAdjacentMedia(currentPost, currentAlbumIndex);
    }
  }

  // Wire dependencies to submodules
  setArchiveInspectContext({
    getCurrentPost: () => currentPost,
    onUnpacked: () => {
      currentAlbumIndex = 0;
      renderViewerPost(false);
    }
  });

  configureSimilar({
    openViewer: (idx, opts) => openViewer(idx, opts)
  });

  initSimilarEvents({
    getCurrentPost: () => currentPost
  });

  configureAlbum({
    getCurrentPost: () => currentPost,
    getAlbumIndex: () => currentAlbumIndex,
    setAlbumIndex: (idx) => { currentAlbumIndex = idx; },
    loadMediaItem,
    renderSidebarContent: (post) => renderSidebarContent(post),
    updateNavButtons
  });

  function updateInteractionStates(post) {
    const isFav = isPostFavorite(post.id);
    btnFavModal?.classList.toggle('active', isFav);
    btnFavModal?.querySelector('svg')?.setAttribute('fill', isFav ? 'currentColor' : 'none');

    const isLiked = isPostLiked(post.id);
    btnLikeModal?.classList.toggle('active', isLiked);
    btnLikeModal?.querySelector('svg')?.setAttribute('fill', isLiked ? 'currentColor' : 'none');

    const isDisliked = isPostDisliked(post.id);
    btnDislikeModal?.classList.toggle('active', isDisliked);
    btnDislikeSidebar?.classList.toggle('active', isDisliked);
    if (btnDislikeSidebarText) {
      btnDislikeSidebarText.textContent = isDisliked ? t('vw.hiddenFromFeed', 'Скрыто из ленты') : t('viewer.hideFromFeed', 'Скрыть из ленты');
    }

    if (btnSimilarModal) {
      btnSimilarModal.style.display = (state.settings?.enableSimilarPosts === false) ? 'none' : '';
    }
  }

  function renderViewerPost(skipMediaLoad = false) {
    if (!currentPost) return;

    if (currentPost.id) {
      markPostViewed(currentPost.id);
      recordSessionInteraction(currentPost, 'view');
    }

    if (siteBadge) siteBadge.textContent = currentPost.siteName || currentPost.site;
    if (resBadge) resBadge.textContent = (currentPost.width && currentPost.height) ? `${currentPost.width} × ${currentPost.height}` : t('vw.original', 'Оригинал');
    if (extBadge) extBadge.textContent = (currentPost.fileExt || 'JPG').toUpperCase();

    renderAuthorInfo(currentPost, {
      closeViewer,
      onTagSelect: (tag) => onTagSelect?.(tag),
      onFavoriteAuthorToggle
    });

    updateInteractionStates(currentPost);
    renderSidebarInfo(currentPost);

    renderSidebarTags(currentPost, {
      onTagSelect: (tag) => onTagSelect?.(tag),
      closeViewer
    });

    renderSidebarArchives(currentPost);
    const cloudLinks = renderSidebarCloudLinks(currentPost);
    renderSidebarContent(currentPost, (cloudLinks || []).map(l => l.url));
    renderSidebarSimilarPosts(currentPost);
    renderAlbumFilmstrip(currentPost, currentAlbumIndex);
    updateNavButtons();

    if (!skipMediaLoad) {
      const hasVisibleMedia = (Array.isArray(currentPost.albumItems) && currentPost.albumItems.length > 0) ||
        Boolean(currentPost.fileUrl || currentPost.sampleUrl || currentPost.previewUrl);

      if (hasVisibleMedia) {
        const activeMediaItem = getCurrentMediaItem(currentPost, currentAlbumIndex);
        loadMediaItem(activeMediaItem);
      } else if (currentPost.isArchive) {
        renderArchivePostCard(currentPost, mediaWrapper);
      } else {
        const activeMediaItem = getCurrentMediaItem(currentPost, currentAlbumIndex);
        loadMediaItem(activeMediaItem);
      }
    }

    if (!currentPost._albumFullyFetched && currentPost.site !== 'pawchive' && currentPost.site !== 'kemono' && (currentPost.hasChildren || currentPost.parentId || (currentPost.seriesKey && !currentPost.seriesKey.startsWith('pawchive:') && !currentPost.seriesKey.startsWith('kemono:')) || currentPost.pixiv_id)) {
      loadFullAlbumForPost(currentPost, false);
    }
  }

  function openViewer(index, opts = {}) {
    const list = (state.displayedPosts && state.displayedPosts.length > 0) ? state.displayedPosts : state.posts;

    if (opts.directPost) {
      directPostRef = opts.directPost;
      state.currentViewerIndex = -1;
      currentPost = opts.directPost;
    } else {
      if (index < 0 || index >= list.length) return;
      directPostRef = null;
      state.currentViewerIndex = index;
      currentPost = list[index];
    }
    currentAlbumIndex = opts.initialAlbumIndex || 0;
    if (viewerSidebar) viewerSidebar.classList.remove('open');
    if (viewerContent) viewerContent.classList.remove('ui-hidden');

    activeResolvePromise = resolvePostMetadata(currentPost, {
      onPostUpdated: () => {
        renderViewerPost(true);
      }
    });

    renderViewerPost();
    if (modal) modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    if (currentPost && currentPost.originalId != null) {
      if (opts.move) {
        notifyViewerMoved(currentPost.originalId);
      } else {
        notifyViewerOpened(currentPost.originalId);
      }
    }
  }

  function closeViewer() {
    if (!modal || modal.style.display === 'none') return;
    if (modal) modal.style.display = 'none';
    closeArchiveInspectModal();
    document.body.style.overflow = '';
    if (viewerSidebar) viewerSidebar.classList.remove('open');
    if (viewerContent) {
      viewerContent.classList.remove('ui-hidden');
      viewerContent.classList.remove('has-album');
      viewerContent.classList.remove('has-similar');
    }

    if (activeAbortController) { activeAbortController.abort(); activeAbortController = null; }
    if (activeBlobUrl) { URL.revokeObjectURL(activeBlobUrl); activeBlobUrl = null; }
    activeResolvePromise = null;
    if (currentZoomInstance) { currentZoomInstance.destroy(); currentZoomInstance = null; }
    if (currentVideoInstance) { currentVideoInstance.destroy(); currentVideoInstance = null; }

    cancelAllArchiveDownloads();

    if (mediaWrapper) mediaWrapper.innerHTML = '';
    if (viewerSimilarFilmstrip) viewerSimilarFilmstrip.style.display = 'none';
    if (similarFilmstripInner) similarFilmstripInner.innerHTML = '';

    currentPost = null;
    currentAlbumIndex = 0;
    directPostRef = null;
    state.currentViewerIndex = -1;
    notifyViewerClosed();
  }

  async function handleDislikeToggle() {
    if (!currentPost) return;
    haptic(20);
    const targetPost = currentPost;
    const isDislikedNow = toggleDislikeLocally(targetPost);
    btnDislikeModal?.classList.toggle('active', isDislikedNow);
    btnDislikeSidebar?.classList.toggle('active', isDislikedNow);
    if (btnDislikeSidebarText) {
      btnDislikeSidebarText.textContent = isDislikedNow ? t('vw.hiddenFromFeed', 'Скрыто из ленты') : t('viewer.hideFromFeed', 'Скрыть из ленты');
    }
    showToast(isDislikedNow ? t('vw.postHiddenToast', 'Пост скрыт (рекомендации обновлены)') : t('vw.unhiddenToast', 'Скрытие отменено'));

    if (isDislikedNow) {
      state.posts = (state.posts || []).filter(p => p && p.id !== targetPost.id);
    }
    if (typeof onDislikeToggle === 'function') {
      onDislikeToggle(targetPost, isDislikedNow);
    }

    try {
      await toggleDislikeApi(targetPost);
    } catch (e) {}
  }

  async function handleLikeToggle() {
    if (!currentPost) return;
    haptic([15, 20]);
    const isLikedNow = toggleLikeLocally(currentPost);
    btnLikeModal?.classList.toggle('active', isLikedNow);
    btnLikeModal?.querySelector('svg')?.setAttribute('fill', isLikedNow ? 'currentColor' : 'none');
    showToast(isLikedNow ? t('vw.likedToast', 'Понравилось (рекомендации обновлены)') : t('vw.likeRemovedToast', 'Лайк удален'));
    try {
      await toggleLikePost(currentPost);
    } catch (e) {}
    if (onFavoriteToggle) onFavoriteToggle();
  }

  async function handleFavToggle() {
    if (!currentPost) return;
    haptic([15, 25, 15]);
    try {
      const res = await toggleFavoritePost(currentPost);
      if (res?.success) {
        if (res.isFavorite) {
          state.favoriteIds.add(currentPost.id);
          state.favorites.unshift({ ...currentPost, favoritedAt: new Date().toISOString() });
          btnFavModal?.classList.add('active');
          btnFavModal?.querySelector('svg')?.setAttribute('fill', 'currentColor');
          showToast(t('vw.savedToFavs', 'Сохранено в закладки'));
        } else {
          state.favoriteIds.delete(currentPost.id);
          state.favorites = state.favorites.filter(f => f.id !== currentPost.id);
          btnFavModal?.classList.remove('active');
          btnFavModal?.querySelector('svg')?.setAttribute('fill', 'none');
          showToast(t('vw.removedFromFavs', 'Удалено из закладок'));
        }
        if (onFavoriteToggle) onFavoriteToggle();
      }
    } catch (err) {
      console.error(err);
    }
  }

  function goToNext(skipAlbum = false) {
    if (directPostRef) return;
    if (!skipAlbum && currentPost?.isAlbum && Array.isArray(currentPost.albumItems) && currentAlbumIndex < currentPost.albumItems.length - 1) {
      haptic(10);
      switchAlbumSlide(currentAlbumIndex + 1);
      return;
    }

    const list = (state.displayedPosts && state.displayedPosts.length > 0) ? state.displayedPosts : state.posts;
    if (state.currentViewerIndex < list.length - 1) {
      haptic(15);
      openViewer(state.currentViewerIndex + 1, { move: true });
    }
  }

  function goToPrev(skipAlbum = false) {
    if (directPostRef) return;
    if (!skipAlbum && currentPost?.isAlbum && Array.isArray(currentPost.albumItems) && currentAlbumIndex > 0) {
      haptic(10);
      switchAlbumSlide(currentAlbumIndex - 1);
      return;
    }

    const list = (state.displayedPosts && state.displayedPosts.length > 0) ? state.displayedPosts : state.posts;
    if (state.currentViewerIndex > 0) {
      haptic(15);
      openViewer(state.currentViewerIndex - 1, { move: true });
    }
  }

  // Bind toolbar and modal events
  btnDownloadAlbum?.addEventListener('click', (e) => { e.preventDefault(); downloadFullAlbum(currentPost); });
  btnDownloadAlbumSidebar?.addEventListener('click', (e) => { e.preventDefault(); downloadFullAlbum(currentPost); });
  btnViewerTagsToggle?.addEventListener('click', (e) => { e.stopPropagation(); viewerSidebar?.classList.toggle('open'); });
  btnCloseViewerTags?.addEventListener('click', (e) => { e.stopPropagation(); viewerSidebar?.classList.remove('open'); });
  btnCloseArchiveInspectModal?.addEventListener('click', (e) => { e.stopPropagation(); closeArchiveInspectModal(); });
  archiveInspectBackdrop?.addEventListener('click', (e) => { e.stopPropagation(); closeArchiveInspectModal(); });

  btnDislikeModal?.addEventListener('click', handleDislikeToggle);
  btnDislikeSidebar?.addEventListener('click', handleDislikeToggle);
  btnLikeModal?.addEventListener('click', handleLikeToggle);
  btnFavModal?.addEventListener('click', handleFavToggle);

  btnSimilarModal?.addEventListener('click', () => {
    if (!currentPost) return;
    haptic(15);
    if (typeof onFindSimilar === 'function') {
      onFindSimilar(currentPost);
      return;
    }
    if (viewerSimilarFilmstrip) {
      if (viewerSimilarFilmstrip.style.display === 'none') {
        renderSidebarSimilarPosts(currentPost, true);
      } else {
        viewerSimilarFilmstrip.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        viewerSimilarFilmstrip.animate([
          { transform: 'translateY(0) scale(1)' },
          { transform: 'translateY(-6px) scale(1.01)' },
          { transform: 'translateY(0) scale(1)' }
        ], { duration: 300, easing: 'ease-out' });
      }
    }
  });

  btnCopyLink?.addEventListener('click', async () => {
    if (!currentPost) return;
    const activeItem = (currentPost.isAlbum && currentPost.albumItems?.[currentAlbumIndex]) ? currentPost.albumItems[currentAlbumIndex] : currentPost;
    const siteUrl = getPostSiteUrl(activeItem) || getPostSiteUrl(currentPost);
    const urlToCopy = siteUrl || activeItem.fileUrl || activeItem.sampleUrl || currentPost.fileUrl || currentPost.sampleUrl;

    if (!urlToCopy) {
      showToast(t('vw.linkUnavailable', 'Ссылка недоступна'));
      return;
    }

    haptic(15);
    const success = await copyToClipboard(urlToCopy);
    showToast(success ? t('vw.linkCopied', 'Ссылка на пост скопирована') : t('vw.linkCopyFailed', 'Не удалось скопировать ссылку'));
  });

  btnDownload?.addEventListener('click', (e) => {
    e.preventDefault();
    if (!currentPost) return;
    const activeItem = (currentPost.isAlbum && currentPost.albumItems?.[currentAlbumIndex]) ? currentPost.albumItems[currentAlbumIndex] : currentPost;
    downloadSingleMedia(activeItem, currentPost);
  });

  btnPrev?.addEventListener('click', () => goToPrev(false));
  btnNext?.addEventListener('click', () => goToNext(false));

  btnCopyAllTags?.addEventListener('click', async () => {
    if (!currentPost || !Array.isArray(currentPost.tags)) return;
    haptic(15);
    const success = await copyToClipboard(currentPost.tags.join(' '));
    showToast(success ? t('vw.tagsCopied', 'Все теги поста скопированы') : t('vw.tagsCopyFailed', 'Не удалось скопировать теги'));
  });

  viewerFavAuthorBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    handleAuthorFavToggle(currentPost, { onFavoriteAuthorToggle });
  });

  btnFavAuthorSidebar?.addEventListener('click', (e) => {
    e.stopPropagation();
    handleAuthorFavToggle(currentPost, { onFavoriteAuthorToggle });
  });

  btnFetchFullAlbum?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!currentPost) return;
    haptic(15);
    loadFullAlbumForPost(currentPost, true);
  });

  btnClose?.addEventListener('click', closeViewer);
  backdrop?.addEventListener('click', closeViewer);

  setupViewerGestures({
    mediaWrapper,
    viewerContent,
    backdrop,
    viewerSidebar,
    getZoomInstance: () => currentZoomInstance,
    goToNext,
    goToPrev,
    closeViewer
  });

  window.addEventListener('keydown', (e) => {
    if (!modal || modal.style.display !== 'flex') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.key === 'Escape') {
      e.preventDefault();
      if (isArchiveInspectModalOpen()) {
        closeArchiveInspectModal();
        return;
      }
      if (viewerSidebar && viewerSidebar.classList.contains('open')) {
        viewerSidebar.classList.remove('open');
        return;
      }
      closeViewer();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goToPrev(e.shiftKey);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      goToNext(e.shiftKey);
    } else if (e.key.toLowerCase() === 'f') {
      e.preventDefault();
      btnFavModal?.click();
    } else if (e.key.toLowerCase() === 'l') {
      e.preventDefault();
      btnLikeModal?.click();
    }
  });

  function refreshSimilarState() {
    if (btnSimilarModal) {
      btnSimilarModal.style.display = (state.settings?.enableSimilarPosts === false) ? 'none' : '';
    }
    if (state.settings?.enableSimilarPosts === false) {
      if (viewerSimilarFilmstrip) viewerSimilarFilmstrip.style.display = 'none';
      if (viewerContent) viewerContent.classList.remove('has-similar');
    } else if (currentPost) {
      renderSidebarSimilarPosts(currentPost);
    }
  }

  return {
    openViewer,
    closeViewer,
    refreshSimilarState
  };
}
