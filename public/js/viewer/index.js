import { state, isPostFavorite, isAuthorFavorite, isPostLiked, isPostDisliked, toggleLikeLocally, toggleDislikeLocally, markPostViewed, setFavoriteAuthors } from '../state.js';
import { getProxiedUrl, toggleFavoritePost, toggleFavoriteAuthor, toggleLikePost, toggleDislikeApi, updateFavoriteAuthorPreview, syncFavoriteAuthors, fetchAlbumPosts, fetchArchiveList, fetchArchiveStatus } from '../api.js';
import { showToast, haptic, getPostSiteUrl, copyToClipboard } from '../modules/uiUtils.js';
import { setupImageZoom } from './imageZoom.js';
import { createVideoPlayer } from './videoPlayer.js';
import { renderSidebarTags, formatRating } from './viewerSidebar.js';
import { notifyViewerOpened, notifyViewerMoved, notifyViewerClosed } from '../router.js';
import { t } from '../i18n.js';

function isVideoUrl(url) {
  if (!url) return false;
  const clean = url.split('?')[0].toLowerCase();
  return clean.endsWith('.mp4') || clean.endsWith('.webm') || clean.endsWith('.mov') || clean.endsWith('.mkv') || clean.endsWith('.avi');
}

export function initViewer({ onFavoriteToggle, onFavoriteAuthorToggle, onTagSelect }) {
  const modal = document.getElementById('viewerModal');
  const backdrop = document.getElementById('viewerBackdrop');
  const btnClose = document.getElementById('btnCloseViewer');
  const btnPrev = document.getElementById('btnViewerPrev');
  const btnNext = document.getElementById('btnViewerNext');

  const viewerContent = document.querySelector('.viewer-content');
  const mediaWrapper = document.getElementById('viewerMediaWrapper');
  const siteBadge = document.getElementById('viewerSiteBadge');
  const viewerAlbumBadge = document.getElementById('viewerAlbumBadge');
  const viewerAlbumPageText = document.getElementById('viewerAlbumPageText');
  const resBadge = document.getElementById('viewerResolution');
  const extBadge = document.getElementById('viewerExtBadge');
  const btnDislikeModal = document.getElementById('btnDislikeModal');
  const btnLikeModal = document.getElementById('btnLikeModal');
  const btnFavModal = document.getElementById('btnFavModal');
  const btnDownload = document.getElementById('btnDownload');
  const btnDownloadAlbum = document.getElementById('btnDownloadAlbum');
  const btnCopyLink = document.getElementById('btnCopyLink');
  const btnViewerTagsToggle = document.getElementById('btnViewerTagsToggle');
  const btnCloseViewerTags = document.getElementById('btnCloseViewerTags');
  const viewerSidebar = document.getElementById('viewerSidebar');
  const viewerAuthorBadge = document.getElementById('viewerAuthorBadge');
  const viewerAuthorText = document.getElementById('viewerAuthorText');
  const viewerFavAuthorBtn = document.getElementById('viewerFavAuthorBtn');
  const infoAuthorRow = document.getElementById('infoAuthorRow');
  const infoAuthor = document.getElementById('infoAuthor');
  const btnFavAuthorSidebar = document.getElementById('btnFavAuthorSidebar');
  const btnFavAuthorSidebarText = document.getElementById('btnFavAuthorSidebarText');
  const btnSetAuthorCoverSidebar = document.getElementById('btnSetAuthorCoverSidebar');

  const infoSite = document.getElementById('infoSite');
  const infoAlbumRow = document.getElementById('infoAlbumRow');
  const btnFetchFullAlbum = document.getElementById('btnFetchFullAlbum');
  const btnFetchFullAlbumText = document.getElementById('btnFetchFullAlbumText');
  const btnDownloadAlbumSidebar = document.getElementById('btnDownloadAlbumSidebar');
  const btnDislikeSidebar = document.getElementById('btnDislikeSidebar');
  const btnDislikeSidebarText = document.getElementById('btnDislikeSidebarText');
  const infoRating = document.getElementById('infoRating');
  const infoScore = document.getElementById('infoScore');
  const infoAi = document.getElementById('infoAi');
  const btnCopyAllTags = document.getElementById('btnCopyAllTags');

  const viewerAlbumFilmstrip = document.getElementById('viewerAlbumFilmstrip');
  const albumFilmstripInner = document.getElementById('albumFilmstripInner');

  let currentPost = null;
  let currentAlbumIndex = 0;
  let directPostRef = null;
  let activeAbortController = null;
  let activeBlobUrl = null;
  let currentZoomInstance = null;
  let currentVideoInstance = null;
  // Shared /api/resolve-video result for the currently opened post - both the
  // metadata refresh here and createVideoPlayer consume the same request
  let activeResolvePromise = null;

  // Touch state variables for gestures
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  let isDraggingDown = false;
  let initialPinchDist = 0;
  let initialZoom = 1;
  let isPinching = false;
  let lastTapTime = 0;

  function openViewer(index, opts = {}) {
    const list = (state.displayedPosts && state.displayedPosts.length > 0) ? state.displayedPosts : state.posts;
    if (opts.directPost) {
      // Standalone post opened by deep link: no neighbors, not part of the grid
      directPostRef = opts.directPost;
      state.currentViewerIndex = -1;
      currentPost = opts.directPost;
    } else {
      if (index < 0 || index >= list.length) return;
      directPostRef = null;
      state.currentViewerIndex = index;
      currentPost = list[index];
    }
    currentAlbumIndex = 0;
    if (viewerSidebar) viewerSidebar.classList.remove('open');
    if (viewerContent) viewerContent.classList.remove('ui-hidden');
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

    // For Rule34Video videos, refresh full metadata (author, tags, HD stream).
    // One request total: the video player receives the same promise.
    if (currentPost?.site === 'rule34video' && (currentPost.source || currentPost.originalId)) {
      const targetPostId = currentPost.id;
      activeResolvePromise = fetch(`/api/resolve-video?url=${encodeURIComponent(currentPost.source || '')}&id=${currentPost.originalId}&site=rule34video`)
        .then(r => r.json())
        .then(data => {
          if (!data || currentPost?.id !== targetPostId) return null;
          let changed = false;
          if (data.author && data.author !== currentPost.author) {
            currentPost.author = data.author;
            changed = true;
          }
          if (data.tags && Array.isArray(data.tags) && data.tags.length > (currentPost.tags?.length || 0)) {
            currentPost.tags = data.tags;
            currentPost.tagDetails = data.tagDetails || currentPost.tagDetails;
            changed = true;
          }
          if (data.fullVideoUrl && !currentPost.fileUrl.includes('1080p') && data.fullVideoUrl !== currentPost.fileUrl) {
            currentPost.fileUrl = data.fullVideoUrl;
          }
          if (changed) {
            renderViewerPost(true);
          }
          return data;
        })
        .catch(() => null);
    } else {
      activeResolvePromise = null;
    }
  }

  function closeViewer() {
    if (!modal || modal.style.display === 'none') return;
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
    if (viewerSidebar) viewerSidebar.classList.remove('open');
    if (viewerContent) {
      viewerContent.classList.remove('ui-hidden');
      viewerContent.classList.remove('has-album');
    }
    
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
    if (activeBlobUrl) {
      URL.revokeObjectURL(activeBlobUrl);
      activeBlobUrl = null;
    }
    activeResolvePromise = null;
    if (currentZoomInstance) {
      currentZoomInstance.destroy();
      currentZoomInstance = null;
    }
    if (currentVideoInstance) {
      currentVideoInstance.destroy();
      currentVideoInstance = null;
    }

    if (activeArchiveDownloads && activeArchiveDownloads.size > 0) {
      activeArchiveDownloads.forEach((ctrl) => {
        try { ctrl.abort(); } catch {}
      });
      activeArchiveDownloads.clear();
    }

    if (mediaWrapper) mediaWrapper.innerHTML = '';
    currentPost = null;
    currentAlbumIndex = 0;
    directPostRef = null;
    state.currentViewerIndex = -1;
    notifyViewerClosed();
  }

    function getCurrentMediaItem() {
      if (currentPost?.isAlbum && Array.isArray(currentPost.albumItems) && currentPost.albumItems.length > 0) {
        return currentPost.albumItems[currentAlbumIndex] || currentPost;
      }
      return currentPost;
    }

    function renderAlbumFilmstrip() {
      if (!viewerAlbumFilmstrip || !albumFilmstripInner) return;

      const isAlbum = Boolean(currentPost?.isAlbum && Array.isArray(currentPost.albumItems) && currentPost.albumItems.length > 1);

      if (isAlbum) {
        if (viewerContent) viewerContent.classList.add('has-album');
        viewerAlbumFilmstrip.style.display = 'block';
        if (viewerAlbumBadge && viewerAlbumPageText) {
          viewerAlbumBadge.style.display = 'inline-flex';
          viewerAlbumPageText.textContent = `${currentAlbumIndex + 1} / ${currentPost.albumItems.length}`;
        }
        if (btnDownloadAlbum) {
          btnDownloadAlbum.style.display = 'inline-flex';
        }
        if (btnDownloadAlbumSidebar) {
          btnDownloadAlbumSidebar.style.display = 'inline-flex';
        }

        albumFilmstripInner.innerHTML = '';
        currentPost.albumItems.forEach((item, idx) => {
          const itemDiv = document.createElement('div');
          itemDiv.className = `album-filmstrip-item ${idx === currentAlbumIndex ? 'active' : ''}`;
          itemDiv.title = t('vw.albumImageTitle', 'Изображение {n} из {total}').replace('{n}', idx + 1).replace('{total}', currentPost.albumItems.length);

          let thumbUrl = item.thumb180 || item.thumb360 || item.previewUrl || item.sampleUrl || item.fileUrl || '';
          // Extracted archive videos serve the raw mp4 as thumb: swap it for an FFmpeg frame
          if (item.isVideo && thumbUrl.startsWith('/api/archive/file')) {
            thumbUrl = `/api/video-thumbnail?url=${encodeURIComponent(thumbUrl)}&quality=low`;
          }
          const needsThumbProxy = (item.site === 'danbooru' || thumbUrl.includes('donmai.us')) ? true : (state.settings?.proxyThumbnails !== false);
          const thumbSrc = thumbUrl ? (thumbUrl.startsWith('/api/') ? thumbUrl : (needsThumbProxy ? getProxiedUrl(thumbUrl) : thumbUrl)) : '';

          itemDiv.innerHTML = `
            <img class="album-filmstrip-img" src="${thumbSrc}" alt="${t('vw.slideAlt', 'Слайд {n}').replace('{n}', idx + 1)}" loading="lazy" referrerpolicy="no-referrer">
            <span class="album-filmstrip-page">${idx + 1}</span>
          `;

          itemDiv.addEventListener('click', (e) => {
            e.stopPropagation();
            haptic(10);
            switchAlbumSlide(idx);
          });

          albumFilmstripInner.appendChild(itemDiv);
        });

        // Scroll the active item into view
        const activeThumb = albumFilmstripInner.children[currentAlbumIndex];
        if (activeThumb) {
          activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
      } else {
        if (viewerContent) viewerContent.classList.remove('has-album');
        viewerAlbumFilmstrip.style.display = 'none';
        if (viewerAlbumBadge) viewerAlbumBadge.style.display = 'none';
        if (btnDownloadAlbum) btnDownloadAlbum.style.display = 'none';
        if (btnDownloadAlbumSidebar) btnDownloadAlbumSidebar.style.display = 'none';
      }

      // Whether a series exists for lazy loading in the sidebar
      if (infoAlbumRow) {
        const canFetch = Boolean(currentPost?.canFetchAlbum || currentPost?.hasChildren || currentPost?.parentId || currentPost?.seriesKey);
        infoAlbumRow.style.display = canFetch ? 'flex' : 'none';
        if (btnFetchFullAlbumText) {
          if (isAlbum) {
            btnFetchFullAlbumText.textContent = t('vw.refreshSet', 'Обновить сет ({n} фото)').replace('{n}', currentPost.albumItems.length);
          } else {
            btnFetchFullAlbumText.textContent = t('viewer.findFullSet', 'Найти все части сета');
          }
        }
      }
    }

    function switchAlbumSlide(idx) {
      if (!currentPost?.albumItems || idx < 0 || idx >= currentPost.albumItems.length) return;
      currentAlbumIndex = idx;

      // Update the page badge
      if (viewerAlbumPageText) {
        viewerAlbumPageText.textContent = `${currentAlbumIndex + 1} / ${currentPost.albumItems.length}`;
      }

      // Update the active class in the thumbnail filmstrip
      if (albumFilmstripInner) {
        Array.from(albumFilmstripInner.children).forEach((child, i) => {
          child.classList.toggle('active', i === currentAlbumIndex);
        });
        const activeThumb = albumFilmstripInner.children[currentAlbumIndex];
        if (activeThumb) {
          activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
      }

      const activeItem = currentPost.albumItems[currentAlbumIndex];
      if (resBadge) resBadge.textContent = (activeItem.width && activeItem.height) ? `${activeItem.width} × ${activeItem.height}` : t('vw.original', 'Оригинал');
      if (extBadge) extBadge.textContent = (activeItem.fileExt || 'JPG').toUpperCase();

      loadMediaItem(activeItem);
    }

    function loadMediaItem(item) {
      if (activeAbortController) {
        activeAbortController.abort();
        activeAbortController = null;
      }
      if (activeBlobUrl) {
        URL.revokeObjectURL(activeBlobUrl);
        activeBlobUrl = null;
      }
      if (currentZoomInstance) {
        currentZoomInstance.destroy();
        currentZoomInstance = null;
      }
      if (currentVideoInstance) {
        currentVideoInstance.destroy();
        currentVideoInstance = null;
      }

      const directMedia = item.sampleUrl || item.fileUrl || item.previewUrl || '';
      if (!directMedia) {
        showToast(t('vw.mediaUnavailable', 'Ссылка на медиа недоступна'));
        return;
      }

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
        const img = document.createElement('img');
        img.className = 'viewer-image';
        const needsImgProxy = item.site === 'danbooru' || directMedia.includes('donmai.us') || state.settings?.proxyFullImages !== false;
        const proxyMedia = getProxiedUrl(directMedia);
        img.src = needsImgProxy ? proxyMedia : directMedia;
        img.referrerPolicy = 'no-referrer';
        img.alt = 'Full View';

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
            showToast(t('vw.fullImgFailed', 'Не удалось загрузить полноразмерное фото'));
          }
        });

        currentZoomInstance = setupImageZoom(img, { showToast });
        mediaWrapper.appendChild(img);
      }
    }

    const activeArchiveDownloads = new Map();

    function formatBytes(bytes) {
      if (!bytes || isNaN(bytes) || bytes <= 0) return '';
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
      if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }

    function createAnimatedArchiveButton({ url, name, size = 0, isSidebar = false }) {
      const btn = document.createElement('button');
      btn.className = 'btn-archive-download';
      btn.type = 'button';

      const cleanName = name || 'archive.zip';
      const displaySize = size > 0 ? formatBytes(size) : '';

      btn.innerHTML = `
        <div class="btn-archive-progress-fill" style="width: 0%;"></div>
        <div class="btn-archive-inner">
          <svg class="btn-archive-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <span class="btn-archive-label">${cleanName}</span>
          ${displaySize ? `<span class="btn-archive-sub">(${displaySize})</span>` : ''}
        </div>
      `;

      const fillEl = btn.querySelector('.btn-archive-progress-fill');
      const labelEl = btn.querySelector('.btn-archive-label');
      const iconEl = btn.querySelector('.btn-archive-icon');
      const subEl = btn.querySelector('.btn-archive-sub');

      let abortController = null;
      let isDownloading = false;

      const setProgress = (percent, loadedBytes, totalBytes) => {
        const clamped = Math.min(100, Math.max(0, Math.round(percent)));
        if (fillEl) fillEl.style.width = `${clamped}%`;
        const loadedMb = (loadedBytes / (1024 * 1024)).toFixed(1);
        if (totalBytes > 0) {
          const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);
          if (labelEl) labelEl.textContent = `${clamped}% · ${loadedMb} / ${totalMb} MB`;
        } else {
          if (labelEl) labelEl.textContent = `${loadedMb} MB...`;
        }
      };

      const resetToDefault = () => {
        btn.classList.remove('is-downloading', 'is-completed', 'is-error');
        if (fillEl) fillEl.style.width = '0%';
        if (labelEl) labelEl.textContent = cleanName;
        if (subEl) subEl.textContent = displaySize ? `(${displaySize})` : '';
        if (iconEl) {
          iconEl.innerHTML = `
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          `;
        }
        isDownloading = false;
        abortController = null;
      };

      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();

        if (isDownloading) {
          if (abortController) {
            abortController.abort();
          }
          resetToDefault();
          showToast(t('vw.downloadCancelled', 'Скачивание отменено'));
          return;
        }

        const isUnpackEnabled = state.settings?.unpackArchivesOnDownload === true;
        const isExtractable = /\.(zip|rar|7z)$/i.test(cleanName) || url.toLowerCase().includes('.zip');

        if (isUnpackEnabled && isExtractable) {
          // Unpack on server and download extracted files
          isDownloading = true;
          btn.classList.remove('is-completed', 'is-error');
          btn.classList.add('is-downloading');
          if (subEl) subEl.textContent = '';
          if (labelEl) labelEl.textContent = t('vw.unpackingOnServer', 'Распаковка на сервере...');

          abortController = new AbortController();
          activeArchiveDownloads.set(url, abortController);

          let pollInterval = setInterval(async () => {
            const status = await fetchArchiveStatus(url);
            if (status && status.active) {
              if (status.phase === 'extract') {
                if (fillEl) fillEl.style.width = '100%';
                if (labelEl) labelEl.textContent = t('vw.archiveExtracting', 'Извлечение файлов...');
              } else if (status.phase === 'download' && status.total > 0) {
                const pct = status.percent || Math.round((status.received / status.total) * 100);
                if (fillEl) fillEl.style.width = `${pct}%`;
                const loadedMb = (status.received / (1024 * 1024)).toFixed(1);
                const totalMb = (status.total / (1024 * 1024)).toFixed(1);
                if (labelEl) labelEl.textContent = `${pct}% · ${loadedMb} / ${totalMb} MB`;
              }
            }
          }, 600);

          try {
            const res = await fetchArchiveList(url);
            clearInterval(pollInterval);

            if (abortController.signal.aborted) {
              resetToDefault();
              return;
            }

            if (res && res.success && Array.isArray(res.albumItems) && res.albumItems.length > 0) {
              if (fillEl) fillEl.style.width = '100%';
              if (labelEl) labelEl.textContent = t('vw.savingFiles', 'Сохранение файлов ({n})...').replace('{n}', String(res.albumItems.length));

              for (let i = 0; i < res.albumItems.length; i++) {
                if (abortController.signal.aborted) break;
                const item = res.albumItems[i];
                const downloadUrl = `${item.fileUrl}&download=1`;
                const a = document.createElement('a');
                a.href = downloadUrl;
                a.download = item.title || `file_${i + 1}.${item.fileExt || 'jpg'}`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                if (res.albumItems.length > 1) {
                  await new Promise(r => setTimeout(r, 200));
                }
              }

              btn.classList.remove('is-downloading');
              btn.classList.add('is-completed');
              if (labelEl) labelEl.textContent = t('vw.downloadedFilesCount', 'Скачано ({n} файлов) ✓').replace('{n}', String(res.albumItems.length));
              if (iconEl) {
                iconEl.innerHTML = `<polyline points="20 6 9 17 4 12"/>`;
              }
              showToast(t('vw.archiveExtractedAndSaved', 'Архив распакован, файлы ({n} шт.) сохранены на устройство').replace('{n}', String(res.albumItems.length)));
              setTimeout(() => resetToDefault(), 4000);
              return;
            }
          } catch (err) {
            clearInterval(pollInterval);
            if (err.name === 'AbortError') {
              resetToDefault();
              return;
            }
            console.warn('[Server unpack error, fallback to direct download]', err);
          } finally {
            clearInterval(pollInterval);
            activeArchiveDownloads.delete(url);
          }
        }

        // Direct stream download (default, or for non-zip attachments like .clip, .psd)
        isDownloading = true;
        btn.classList.remove('is-completed', 'is-error');
        btn.classList.add('is-downloading');
        if (subEl) subEl.textContent = '';
        if (labelEl) labelEl.textContent = '0%...';

        abortController = new AbortController();
        activeArchiveDownloads.set(url, abortController);

        try {
          const targetUrl = getProxiedUrl(url);
          const res = await fetch(targetUrl, { signal: abortController.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          const contentLength = res.headers.get('content-length');
          const total = contentLength ? parseInt(contentLength, 10) : (size > 0 ? size : 0);
          let loaded = 0;
          const reader = res.body.getReader();
          const chunks = [];

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            loaded += value.length;
            const pct = total > 0 ? (loaded / total) * 100 : Math.min(95, (loaded / 5000000) * 100);
            setProgress(pct, loaded, total);
          }

          const blob = new Blob(chunks, { type: 'application/octet-stream' });
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = cleanName;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

          btn.classList.remove('is-downloading');
          btn.classList.add('is-completed');
          if (fillEl) fillEl.style.width = '100%';
          const finalMb = (loaded / (1024 * 1024)).toFixed(1);
          if (labelEl) labelEl.textContent = t('vw.downloadArchiveDone', 'Скачано ({size} МБ) ✓').replace('{size}', finalMb);
          if (iconEl) {
            iconEl.innerHTML = `<polyline points="20 6 9 17 4 12"/>`;
          }
          showToast(t('vw.downloadArchiveDoneShort', 'Файл сохранён на устройство'));

          setTimeout(() => {
            resetToDefault();
          }, 4000);
        } catch (err) {
          if (err.name === 'AbortError') {
            resetToDefault();
            return;
          }
          console.warn('[Archive download error]', err);
          btn.classList.remove('is-downloading');
          btn.classList.add('is-error');
          if (fillEl) fillEl.style.width = '0%';
          if (labelEl) labelEl.textContent = t('vw.downloadArchiveError', 'Ошибка. Повторить?');
          isDownloading = false;
          abortController = null;
        } finally {
          activeArchiveDownloads.delete(url);
        }
      });

      return btn;
    }

    function renderArchivePostCard(targetPost) {
      if (!mediaWrapper) return;
      mediaWrapper.innerHTML = '';

      const card = document.createElement('div');
      card.className = 'archive-post-card';

      const archiveCount = Array.isArray(targetPost.archiveUrls) ? targetPost.archiveUrls.length : 1;
      const descText = t('vw.archiveCardDesc', 'Пост содержит архив с материалами ({n} шт.). Нажмите кнопку ниже для сохранения на устройство.').replace('{n}', String(archiveCount));
      const titleText = targetPost.title || t('vw.archiveCardTitle', 'Архив файлов');

      card.innerHTML = `
        <div class="archive-card-icon-wrap">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 8v13H3V8"/>
            <path d="M1 3h22v5H1z"/>
            <path d="M10 12h4"/>
          </svg>
        </div>
        <div class="archive-card-header">
          <div class="archive-card-title">${titleText}</div>
          <div class="archive-card-desc">${descText}</div>
        </div>
        <div class="archive-card-buttons"></div>
      `;

      const buttonsContainer = card.querySelector('.archive-card-buttons');
      if (Array.isArray(targetPost.archiveUrls) && targetPost.archiveUrls.length > 0) {
        targetPost.archiveUrls.forEach((url, idx) => {
          const name = (Array.isArray(targetPost.archiveNames) && targetPost.archiveNames[idx]) || `archive_${idx + 1}.zip`;
          const size = (Array.isArray(targetPost.archiveSizes) && targetPost.archiveSizes[idx]) || 0;
          const btn = createAnimatedArchiveButton({ url, name, size, isSidebar: false });
          buttonsContainer.appendChild(btn);
        });
      }

      mediaWrapper.appendChild(card);
    }

    function renderSidebarArchives(targetPost) {
      const section = document.getElementById('viewerSidebarArchivesSection');
      const countEl = document.getElementById('viewerSidebarArchivesCount');
      const listEl = document.getElementById('viewerSidebarArchivesList');
      if (!section || !listEl) return;

      if (!targetPost || !targetPost.isArchive || !Array.isArray(targetPost.archiveUrls) || targetPost.archiveUrls.length === 0) {
        section.style.display = 'none';
        listEl.innerHTML = '';
        return;
      }

      section.style.display = 'block';
      if (countEl) countEl.textContent = String(targetPost.archiveUrls.length);
      listEl.innerHTML = '';

      targetPost.archiveUrls.forEach((url, idx) => {
        const name = (Array.isArray(targetPost.archiveNames) && targetPost.archiveNames[idx]) || `archive_${idx + 1}.zip`;
        const size = (Array.isArray(targetPost.archiveSizes) && targetPost.archiveSizes[idx]) || 0;
        const btn = createAnimatedArchiveButton({ url, name, size, isSidebar: true });
        listEl.appendChild(btn);
      });
    }

  function renderViewerPost(skipMediaLoad = false) {
    if (!currentPost) return;

    if (currentPost.id) {
      markPostViewed(currentPost.id);
    }

    if (siteBadge) siteBadge.textContent = currentPost.siteName || currentPost.site;
    if (resBadge) resBadge.textContent = (currentPost.width && currentPost.height) ? `${currentPost.width} × ${currentPost.height}` : t('vw.original', 'Оригинал');
    if (extBadge) extBadge.textContent = (currentPost.fileExt || 'JPG').toUpperCase();

    // Author display
    const rawAuthor = currentPost.author || (currentPost.tagDetails?.artist && currentPost.tagDetails.artist.length > 0 ? currentPost.tagDetails.artist.join(', ') : '');
    const authorName = typeof rawAuthor === 'string' ? rawAuthor : (rawAuthor ? String(rawAuthor) : '');
    if (authorName && authorName.trim()) {
      const cleanAuthorTag = authorName.split(',')[0].trim().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_');
      const isFavAuthor = isAuthorFavorite(cleanAuthorTag);

      if (viewerAuthorBadge && viewerAuthorText) {
        viewerAuthorText.textContent = authorName;
        viewerAuthorBadge.style.display = 'inline-flex';
        viewerAuthorBadge.onclick = (e) => {
          e.stopPropagation();
          closeViewer();
          const tagToSearch = (currentPost.site === 'rule34video' && !cleanAuthorTag.includes(':'))
            ? `artist:${cleanAuthorTag}`
            : cleanAuthorTag;
          if (onTagSelect) onTagSelect(tagToSearch);
        };
      }
      if (viewerFavAuthorBtn) {
        viewerFavAuthorBtn.style.display = 'inline-flex';
        viewerFavAuthorBtn.classList.toggle('active', isFavAuthor);
        viewerFavAuthorBtn.title = isFavAuthor
          ? t('vw.authorRemoveTitle', 'Удалить автора "{name}" из любимых').replace('{name}', cleanAuthorTag)
          : t('vw.authorAddTitle', 'Добавить автора "{name}" в любимые').replace('{name}', cleanAuthorTag);
      }
      if (infoAuthorRow && infoAuthor) {
        infoAuthor.textContent = authorName;
        infoAuthorRow.style.display = 'flex';
        infoAuthor.onclick = () => {
          closeViewer();
          const tagToSearch = (currentPost.site === 'rule34video' && !cleanAuthorTag.includes(':'))
            ? `artist:${cleanAuthorTag}`
            : cleanAuthorTag;
          if (onTagSelect) onTagSelect(tagToSearch);
        };
      }
      if (btnFavAuthorSidebar && btnFavAuthorSidebarText) {
        btnFavAuthorSidebar.classList.toggle('active', isFavAuthor);
        btnFavAuthorSidebarText.textContent = isFavAuthor ? t('vw.authorFavOn', 'В избранном') : t('viewer.favAuthorInline', 'В избранное');
        btnFavAuthorSidebar.title = isFavAuthor
          ? t('vw.authorRemoveTitle', 'Удалить автора "{name}" из любимых').replace('{name}', cleanAuthorTag)
          : t('vw.authorAddTitle', 'Добавить автора "{name}" в любимые').replace('{name}', cleanAuthorTag);
      }
      if (btnSetAuthorCoverSidebar) {
        btnSetAuthorCoverSidebar.style.display = isFavAuthor ? 'inline-flex' : 'none';
        btnSetAuthorCoverSidebar.onclick = async (e) => {
          e.stopPropagation();
          haptic(15);
          const isVideo = currentPost.isVideo || isVideoUrl(currentPost.fileUrl) || isVideoUrl(currentPost.sampleUrl) || isVideoUrl(currentPost.previewUrl);
          const rawUrl = currentPost.sampleUrl || currentPost.fileUrl || currentPost.previewUrl;
          const chosenUrl = isVideo ? (currentPost.previewUrl || rawUrl) : (currentPost.sampleUrl || currentPost.fileUrl || currentPost.previewUrl);
          if (!chosenUrl) return;

          const sampleUrl = isVideo ? '' : (currentPost.sampleUrl || '');
          const fileUrl = isVideo ? '' : (currentPost.fileUrl || '');
          const thumb180 = currentPost.previewUrl || '';
          const thumb360 = currentPost.sampleUrl || '';
          const thumb720 = currentPost.fileUrl || '';

          const target = state.favoriteAuthors.find(a => (a.name || '').toLowerCase() === cleanAuthorTag.toLowerCase());
          if (target) {
            target.previewUrl = chosenUrl;
            target.sampleUrl = sampleUrl;
            target.fileUrl = fileUrl;
            target.thumb180 = thumb180;
            target.thumb360 = thumb360;
            target.thumb720 = thumb720;
            target.site = currentPost.site || target.site || 'danbooru';
          }
          setFavoriteAuthors([...state.favoriteAuthors]);
          showToast(t('vw.coverSetForAuthor', 'Этот арт установлен обложкой автора {name}!').replace('{name}', authorName));
          if (onFavoriteAuthorToggle) onFavoriteAuthorToggle();

          try {
            await updateFavoriteAuthorPreview(cleanAuthorTag, chosenUrl, currentPost.site || 'danbooru', { sampleUrl, fileUrl, thumb180, thumb360, thumb720 });
            await syncFavoriteAuthors(state.favoriteAuthors);
          } catch (err) {
            console.error('Ошибка сохранения обложки автора:', err);
          }
        };
      }
    } else {
      if (viewerAuthorBadge) viewerAuthorBadge.style.display = 'none';
      if (viewerFavAuthorBtn) viewerFavAuthorBtn.style.display = 'none';
      if (infoAuthorRow) infoAuthorRow.style.display = 'none';
      if (btnSetAuthorCoverSidebar) btnSetAuthorCoverSidebar.style.display = 'none';
    }

    const isFav = isPostFavorite(currentPost.id);
    if (btnFavModal) {
      btnFavModal.classList.toggle('active', isFav);
      btnFavModal.querySelector('svg')?.setAttribute('fill', isFav ? 'currentColor' : 'none');
    }

    const isLiked = isPostLiked(currentPost.id);
    if (btnLikeModal) {
      btnLikeModal.classList.toggle('active', isLiked);
      btnLikeModal.querySelector('svg')?.setAttribute('fill', isLiked ? 'currentColor' : 'none');
    }

    const isDisliked = isPostDisliked(currentPost.id);
    if (btnDislikeModal) {
      btnDislikeModal.classList.toggle('active', isDisliked);
    }
    if (btnDislikeSidebar) {
      btnDislikeSidebar.classList.toggle('active', isDisliked);
      if (btnDislikeSidebarText) {
        btnDislikeSidebarText.textContent = isDisliked ? t('vw.hiddenFromFeed', 'Скрыто из ленты') : t('viewer.hideFromFeed', 'Скрыть из ленты');
      }
    }

    const infoDurationRow = document.getElementById('infoDurationRow');
    const infoDuration = document.getElementById('infoDuration');
    if (currentPost.isVideo && (currentPost.durationText || currentPost.duration > 0)) {
      const durText = currentPost.durationText || `${Math.floor(currentPost.duration / 60)}:${Math.floor(currentPost.duration % 60) < 10 ? '0' : ''}${Math.floor(currentPost.duration % 60)}`;
      if (infoDuration) infoDuration.textContent = durText;
      if (infoDurationRow) infoDurationRow.style.display = 'flex';
    } else {
      if (infoDurationRow) infoDurationRow.style.display = 'none';
    }

    if (infoSite) {
      const siteName = currentPost.siteName || currentPost.site;
      const postPageUrl = getPostSiteUrl(currentPost);
      if (postPageUrl) {
        infoSite.innerHTML = `<a href="${postPageUrl}" target="_blank" rel="noopener noreferrer" style="color: var(--accent-primary); text-decoration: none; display: inline-flex; align-items: center; gap: 4px;" title="${t('vw.openOnSite', 'Открыть страницу на сайте {name}').replace('{name}', siteName)}">${siteName} <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>`;
      } else {
        infoSite.textContent = siteName;
      }
    }
    if (infoRating) infoRating.textContent = formatRating(currentPost.rating);
    let scoreText = `★ ${currentPost.score || 0}`;
    if (currentPost.views > 0 || currentPost.viewsText) {
      scoreText += ` · ${t('vw.viewsShort', '{n} просм.').replace('{n}', currentPost.viewsText || currentPost.views)}`;
    } else if (currentPost.favCount > 0) {
      scoreText += ` · ${t('vw.favsShort', '{n} в избранном').replace('{n}', currentPost.favCount)}`;
    }
    if (infoScore) infoScore.textContent = scoreText;
    if (infoAi) {
      infoAi.textContent = currentPost.isAi ? t('vw.aiYes', 'Да (ИИ-арт)') : t('vw.aiNo', 'Нет (Авторский)');
      infoAi.style.color = currentPost.isAi ? 'var(--accent-warning)' : 'var(--text-primary)';
    }

    // Render tags into the sidebar
    renderSidebarTags(currentPost, {
      onTagSelect: (t) => {
        if (onTagSelect) onTagSelect(t);
      },
      closeViewer
    });

    renderSidebarArchives(currentPost);
    renderAlbumFilmstrip();

    if (!skipMediaLoad) {
      const hasVisibleMedia = (Array.isArray(currentPost.albumItems) && currentPost.albumItems.length > 0) ||
        Boolean(currentPost.fileUrl || currentPost.sampleUrl || currentPost.previewUrl);

      if (hasVisibleMedia) {
        const activeMediaItem = getCurrentMediaItem();
        loadMediaItem(activeMediaItem);
      } else if (currentPost.isArchive) {
        renderArchivePostCard(currentPost);
      } else {
        const activeMediaItem = getCurrentMediaItem();
        loadMediaItem(activeMediaItem);
      }
    }
  }

  // Load all series parts via the sidebar button
  if (btnFetchFullAlbum) {
    btnFetchFullAlbum.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!currentPost) return;
      haptic(15);
      btnFetchFullAlbum.disabled = true;
      if (btnFetchFullAlbumText) btnFetchFullAlbumText.textContent = t('vw.searchingSeries', 'Поиск серии...');

      try {
        const res = await fetchAlbumPosts({
          site: currentPost.site,
          seriesKey: currentPost.seriesKey || '',
          parentId: currentPost.parentId || '',
          originalId: currentPost.originalId || ''
        });

        if (res.success && Array.isArray(res.albumItems) && res.albumItems.length > 0) {
          currentPost.isAlbum = true;
          currentPost.albumItems = res.albumItems;
          currentPost.albumCount = res.albumItems.length;
          currentAlbumIndex = 0;

          // Sync the updated album back into global gallery state
          const list = (state.displayedPosts && state.displayedPosts.length > 0) ? state.displayedPosts : state.posts;
          if (state.currentViewerIndex >= 0 && state.currentViewerIndex < list.length) {
            list[state.currentViewerIndex] = currentPost;
          }
          if (Array.isArray(state.posts)) {
            const origIdx = state.posts.findIndex(p => p.id === currentPost.id);
            if (origIdx !== -1) {
              state.posts[origIdx] = currentPost;
            }
          }

          // Update the card badge in the gallery DOM.
          // Cards are .media-card[data-post-id] with badges inside .badge-group-top > div;
          // the old .post-card[data-id] selector matched nothing.
          const cardEl = document.querySelector(`.media-card[data-post-id="${currentPost.id}"]`);
          if (cardEl) {
            cardEl.classList.add('is-album-card');
            const topGroup = cardEl.querySelector('.badge-group-top > div');
            let badgeAlbum = topGroup ? topGroup.querySelector('.badge-album') : null;
            if (!badgeAlbum && topGroup) {
              badgeAlbum = document.createElement('span');
              badgeAlbum.className = 'badge-format badge-album';
              const siteBadgeEl = topGroup.querySelector('.badge-site');
              if (siteBadgeEl) {
                topGroup.insertBefore(badgeAlbum, siteBadgeEl.nextSibling);
              } else {
                topGroup.prepend(badgeAlbum);
              }
            }
            if (badgeAlbum) {
              badgeAlbum.title = t('gal.albumBadge.title', 'Альбом: {n} изображений').replace('{n}', res.albumItems.length);
              badgeAlbum.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24"><use href="#ic-album"/></svg> <span>${res.albumItems.length}</span>`;
            }
          }

          renderViewerPost();
          showToast(t('vw.seriesFound', 'Найдено {n} изображений серии!').replace('{n}', res.albumItems.length));
        } else {
          showToast(t('vw.seriesNone', 'Дополнительные части серии не найдены'));
          if (btnFetchFullAlbumText) btnFetchFullAlbumText.textContent = t('vw.seriesPartsNone', 'Части серии не найдены');
        }
      } catch (err) {
        console.error('Ошибка поиска альбома:', err);
        showToast(t('vw.seriesSearchFailed', 'Не удалось выполнить поиск частей серии'));
      } finally {
        btnFetchFullAlbum.disabled = false;
      }
    });
  }

  // Download all album images
  async function downloadFullAlbum(e) {
    if (e) e.preventDefault();
    if (!currentPost || !currentPost.isAlbum || !Array.isArray(currentPost.albumItems) || currentPost.albumItems.length === 0) return;
    haptic(20);
    showToast(t('vw.albumDownloadStart', 'Начато скачивание альбома ({n} файлов)...').replace('{n}', currentPost.albumItems.length));

    for (let i = 0; i < currentPost.albumItems.length; i++) {
      const item = currentPost.albumItems[i];
      const downloadTarget = item.fileUrl || item.sampleUrl || item.previewUrl;
      if (!downloadTarget) continue;

      if (downloadTarget.startsWith('/api/archive/file')) {
        const dlUrl = downloadTarget.includes('?') ? `${downloadTarget}&download=1` : `${downloadTarget}?download=1`;
        const a = document.createElement('a');
        a.href = dlUrl;
        a.download = item.title || `album_${currentPost.site || 'post'}_${currentPost.id}_p${i + 1}.${item.fileExt || (item.isVideo ? 'mp4' : 'jpg')}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        await new Promise(r => setTimeout(r, 250));
        continue;
      }

      try {
        const proxyUrl = getProxiedUrl(downloadTarget);
        const res = await fetch(proxyUrl);
        if (res.ok) {
          const blob = await res.blob();
          const ext = item.fileExt || (item.isVideo ? 'mp4' : 'jpg');
          const filename = `album_${currentPost.site || 'post'}_${currentPost.id}_p${i + 1}.${ext}`;
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
        }
      } catch (err) {
        console.warn(`[Album download err on page ${i + 1}]`, err);
      }
      // Small delay between downloads
      await new Promise(r => setTimeout(r, 350));
    }
    showToast(t('vw.albumDownloaded', 'Все изображения альбома загружены'));
  }

  if (btnDownloadAlbum) {
    btnDownloadAlbum.addEventListener('click', downloadFullAlbum);
  }
  if (btnDownloadAlbumSidebar) {
    btnDownloadAlbumSidebar.addEventListener('click', downloadFullAlbum);
  }

  // Toggle the tags drawer on mobile
  if (btnViewerTagsToggle) {
    btnViewerTagsToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (viewerSidebar) viewerSidebar.classList.toggle('open');
    });
  }

  if (btnCloseViewerTags) {
    btnCloseViewerTags.addEventListener('click', (e) => {
      e.stopPropagation();
      if (viewerSidebar) viewerSidebar.classList.remove('open');
    });
  }

  async function handleDislikeToggle() {
    if (!currentPost) return;
    haptic(20);
    const isDislikedNow = toggleDislikeLocally(currentPost);
    if (btnDislikeModal) btnDislikeModal.classList.toggle('active', isDislikedNow);
    if (btnDislikeSidebar) {
      btnDislikeSidebar.classList.toggle('active', isDislikedNow);
      if (btnDislikeSidebarText) {
        btnDislikeSidebarText.textContent = isDislikedNow ? t('vw.hiddenFromFeed', 'Скрыто из ленты') : t('viewer.hideFromFeed', 'Скрыть из ленты');
      }
    }
    showToast(isDislikedNow ? t('vw.postHiddenToast', 'Пост скрыт (рекомендации обновлены)') : t('vw.unhiddenToast', 'Скрытие отменено'));
    try {
      await toggleDislikeApi(currentPost);
    } catch (e) {}
  }

  if (btnDislikeModal) {
    btnDislikeModal.addEventListener('click', handleDislikeToggle);
  }
  if (btnDislikeSidebar) {
    btnDislikeSidebar.addEventListener('click', handleDislikeToggle);
  }

  if (btnLikeModal) {
    btnLikeModal.addEventListener('click', async () => {
      if (!currentPost) return;
      haptic([15, 20]);
      const isLikedNow = toggleLikeLocally(currentPost);
      btnLikeModal.classList.toggle('active', isLikedNow);
      btnLikeModal.querySelector('svg')?.setAttribute('fill', isLikedNow ? 'currentColor' : 'none');
      showToast(isLikedNow ? t('vw.likedToast', 'Понравилось (рекомендации обновлены)') : t('vw.likeRemovedToast', 'Лайк удален'));
      try {
        await toggleLikePost(currentPost);
      } catch (e) {}
      if (onFavoriteToggle) onFavoriteToggle();
    });
  }

  if (btnFavModal) {
    btnFavModal.addEventListener('click', async () => {
      if (!currentPost) return;
      haptic([15, 25, 15]);
      try {
        const res = await toggleFavoritePost(currentPost);
        if (res.success) {
          if (res.isFavorite) {
            state.favoriteIds.add(currentPost.id);
            state.favorites.unshift(currentPost);
            btnFavModal.classList.add('active');
            btnFavModal.querySelector('svg')?.setAttribute('fill', 'currentColor');
            showToast(t('vw.savedToFavs', 'Сохранено в закладки'));
          } else {
            state.favoriteIds.delete(currentPost.id);
            state.favorites = state.favorites.filter(f => f.id !== currentPost.id);
            btnFavModal.classList.remove('active');
            btnFavModal.querySelector('svg')?.setAttribute('fill', 'none');
            showToast(t('vw.removedFromFavs', 'Удалено из закладок'));
          }
          if (onFavoriteToggle) onFavoriteToggle();
        }
      } catch (err) {
        console.error(err);
      }
    });
  }

  if (btnCopyLink) {
    btnCopyLink.addEventListener('click', async () => {
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
      if (success) {
        showToast(t('vw.linkCopied', 'Ссылка на пост скопирована'));
      } else {
        showToast(t('vw.linkCopyFailed', 'Не удалось скопировать ссылку'));
      }
    });
  }

  if (btnDownload) {
    btnDownload.addEventListener('click', async (e) => {
      e.preventDefault();
      if (!currentPost) return;
      const activeItem = (currentPost.isAlbum && currentPost.albumItems?.[currentAlbumIndex]) ? currentPost.albumItems[currentAlbumIndex] : currentPost;
      const downloadTarget = activeItem.fileUrl || activeItem.sampleUrl || activeItem.previewUrl;
      if (!downloadTarget) {
        showToast(t('vw.fileLinkUnavailable', 'Ссылка на файл недоступна'));
        return;
      }

      showToast(t('vw.downloadStarted', 'Начата загрузка на устройство...'));

      if (downloadTarget.startsWith('/api/archive/file')) {
        const dlUrl = downloadTarget.includes('?') ? `${downloadTarget}&download=1` : `${downloadTarget}?download=1`;
        const a = document.createElement('a');
        a.href = dlUrl;
        a.download = activeItem.title || `file_${activeItem.originalId || activeItem.id}.${activeItem.fileExt || (activeItem.isVideo ? 'mp4' : 'jpg')}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        showToast(t('vw.savedToDevice', 'Файл сохранён в память устройства'));
        return;
      }
      
      const getExtensionFromMime = (mimeType, fallbackExt) => {
        if (!mimeType) return fallbackExt || 'jpg';
        const low = mimeType.toLowerCase();
        if (low.includes('png')) return 'png';
        if (low.includes('jpeg') || low.includes('jpg')) return 'jpg';
        if (low.includes('webp')) return 'webp';
        if (low.includes('gif')) return 'gif';
        if (low.includes('mp4')) return 'mp4';
        if (low.includes('webm')) return 'webm';
        return fallbackExt || 'jpg';
      };

      const shouldUseProxyDownload = activeItem.site === 'danbooru' || downloadTarget.includes('donmai.us') || state.settings?.proxyDownloads !== false;
      
      if (!shouldUseProxyDownload) {
        try {
          const directRes = await fetch(downloadTarget, { mode: 'cors' });
          if (directRes.ok) {
            const blob = await directRes.blob();
            const ext = getExtensionFromMime(blob.type, activeItem.fileExt || (activeItem.isVideo ? 'mp4' : 'jpg'));
            const filename = `booru_${activeItem.site || 'post'}_${activeItem.id}.${ext}`;
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
            showToast(t('vw.savedFromCdn', 'Файл сохранён напрямую с CDN'));
            return;
          }
        } catch (directErr) {
          console.warn('[Direct download failed, switching to proxy]', directErr);
        }
      }

      try {
        const proxyUrl = getProxiedUrl(downloadTarget);
        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const ext = getExtensionFromMime(blob.type, activeItem.fileExt || (activeItem.isVideo ? 'mp4' : 'jpg'));
        const filename = `booru_${activeItem.site || 'post'}_${activeItem.id}.${ext}`;
        const blobUrl = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
        showToast(t('vw.savedToDevice', 'Файл сохранён в память устройства'));
      } catch (err) {
        console.warn('[Download error]', err);
        showToast(t('vw.downloadFailed', 'Не удалось загрузить файл для сохранения'));
      }
    });
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

  if (btnPrev) {
    btnPrev.addEventListener('click', () => goToPrev(false));
  }

  if (btnNext) {
    btnNext.addEventListener('click', () => goToNext(false));
  }

  if (btnCopyAllTags) {
    btnCopyAllTags.addEventListener('click', async () => {
      if (!currentPost || !Array.isArray(currentPost.tags)) return;
      haptic(15);
      const success = await copyToClipboard(currentPost.tags.join(' '));
      if (success) {
        showToast(t('vw.tagsCopied', 'Все теги поста скопированы'));
      } else {
        showToast(t('vw.tagsCopyFailed', 'Не удалось скопировать теги'));
      }
    });
  }

  async function handleAuthorFavToggle() {
    if (!currentPost) return;
    const rawAuthor = currentPost.author || (currentPost.tagDetails?.artist && currentPost.tagDetails.artist.length > 0 ? currentPost.tagDetails.artist.join(', ') : '');
    const authorName = typeof rawAuthor === 'string' ? rawAuthor : (rawAuthor ? String(rawAuthor) : '');
    if (!authorName || !authorName.trim()) return;

    const cleanAuthorTag = authorName.split(',')[0].trim().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_');
    haptic([15, 25, 15]);

    try {
      const res = await toggleFavoriteAuthor({
        name: cleanAuthorTag,
        displayName: authorName,
        previewUrl: currentPost.previewUrl || currentPost.sampleUrl || '',
        site: currentPost.site || 'danbooru'
      });

      if (res.success) {
        if (res.isFavorite) {
          state.favoriteAuthorNames.add(cleanAuthorTag.toLowerCase());
          state.favoriteAuthors.unshift(res.author || {
            id: cleanAuthorTag,
            name: cleanAuthorTag,
            displayName: authorName,
            previewUrl: currentPost.previewUrl || currentPost.sampleUrl || '',
            site: currentPost.site || 'danbooru',
            createdAt: new Date().toISOString()
          });
          showToast(t('vw.authorAdded', 'Автор {name} добавлен в любимые').replace('{name}', authorName));
        } else {
          state.favoriteAuthorNames.delete(cleanAuthorTag.toLowerCase());
          state.favoriteAuthors = state.favoriteAuthors.filter(a => (a.name || '').toLowerCase() !== cleanAuthorTag.toLowerCase());
          showToast(t('vw.authorRemoved', 'Автор {name} удален из любимых').replace('{name}', authorName));
        }

        const isFavAuthor = res.isFavorite;
        if (viewerFavAuthorBtn) {
          viewerFavAuthorBtn.classList.toggle('active', isFavAuthor);
          viewerFavAuthorBtn.title = isFavAuthor
            ? t('vw.authorRemoveTitle', 'Удалить автора "{name}" из любимых').replace('{name}', cleanAuthorTag)
            : t('vw.authorAddTitle', 'Добавить автора "{name}" в любимые').replace('{name}', cleanAuthorTag);
        }
        if (btnFavAuthorSidebar && btnFavAuthorSidebarText) {
          btnFavAuthorSidebar.classList.toggle('active', isFavAuthor);
          btnFavAuthorSidebarText.textContent = isFavAuthor ? t('vw.authorFavOn', 'В избранном') : t('viewer.favAuthorInline', 'В избранное');
          btnFavAuthorSidebar.title = isFavAuthor
            ? t('vw.authorRemoveTitle', 'Удалить автора "{name}" из любимых').replace('{name}', cleanAuthorTag)
            : t('vw.authorAddTitle', 'Добавить автора "{name}" в любимые').replace('{name}', cleanAuthorTag);
        }
        if (btnSetAuthorCoverSidebar) {
          btnSetAuthorCoverSidebar.style.display = isFavAuthor ? 'inline-flex' : 'none';
        }

        if (onFavoriteAuthorToggle) onFavoriteAuthorToggle();
      }
    } catch (err) {
      console.error('Ошибка добавления автора в любимые:', err);
      showToast(t('vw.authorUpdateFailed', 'Не удалось обновить избранного автора'));
    }
  }

  if (viewerFavAuthorBtn) {
    viewerFavAuthorBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleAuthorFavToggle();
    });
  }

  if (btnFavAuthorSidebar) {
    btnFavAuthorSidebar.addEventListener('click', (e) => {
      e.stopPropagation();
      handleAuthorFavToggle();
    });
  }

  if (btnClose) btnClose.addEventListener('click', closeViewer);
  if (backdrop) backdrop.addEventListener('click', closeViewer);

  // Check for touches on interactive elements (video banner, album filmstrip, sidebar, buttons)
  function isInteractiveTouchTarget(target) {
    if (!target) return false;
    return Boolean(
      target.closest('.video-status-banner') ||
      target.closest('.viewer-album-filmstrip') ||
      target.closest('.btn-video-unmute') ||
      target.closest('.viewer-sidebar') ||
      target.closest('.viewer-header') ||
      target.closest('button') ||
      target.closest('input') ||
      target.closest('a')
    );
  }

  // Touch gestures
  if (mediaWrapper) {
    mediaWrapper.addEventListener('touchstart', (e) => {
      if (isInteractiveTouchTarget(e.target)) {
        isPinching = false;
        isDraggingDown = false;
        touchStartX = 0;
        touchStartY = 0;
        touchStartTime = 0;
        return;
      }

      if (currentZoomInstance && currentZoomInstance.getZoomLevel() > 1.05) {
        isPinching = false;
        isDraggingDown = false;
        touchStartX = 0;
        touchStartY = 0;
        touchStartTime = 0;
        return;
      }

      if (e.touches.length === 2) {
        isPinching = true;
        isDraggingDown = false;
        initialPinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        initialZoom = currentZoomInstance ? currentZoomInstance.getZoomLevel() : 1;
      } else if (e.touches.length === 1) {
        isPinching = false;
        isDraggingDown = false;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartTime = Date.now();
      }
    }, { passive: true });

    mediaWrapper.addEventListener('touchmove', (e) => {
      if (isInteractiveTouchTarget(e.target) || !touchStartY) {
        return;
      }

      if (currentZoomInstance && currentZoomInstance.getZoomLevel() > 1.05) {
        return;
      }

      if (isPinching && e.touches.length === 2 && currentZoomInstance) {
        const currentDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        if (initialPinchDist > 0) {
          const factor = currentDist / initialPinchDist;
          currentZoomInstance.setPinchZoom(factor, initialZoom);
        }
      } else if (e.touches.length === 1 && (!currentZoomInstance || currentZoomInstance.getZoomLevel() <= 1.05)) {
        const deltaY = e.touches[0].clientY - touchStartY;
        const deltaX = e.touches[0].clientX - touchStartX;
        if (deltaY > 15 && Math.abs(deltaY) > Math.abs(deltaX) * 1.2) {
          isDraggingDown = true;
          if (viewerContent) {
            viewerContent.style.transition = 'none';
            viewerContent.style.transform = `translateY(${Math.max(0, deltaY)}px) scale(${Math.max(0.88, 1 - deltaY / 1200)})`;
          }
          if (backdrop) {
            backdrop.style.opacity = `${Math.max(0.2, 1 - deltaY / 400)}`;
          }
        }
      }
    }, { passive: true });

    mediaWrapper.addEventListener('touchend', (e) => {
      if (isInteractiveTouchTarget(e.target) && !isDraggingDown) {
        touchStartX = 0;
        touchStartY = 0;
        touchStartTime = 0;
        return;
      }

      if (currentZoomInstance && currentZoomInstance.getZoomLevel() > 1.05 && !isDraggingDown) {
        touchStartX = 0;
        touchStartY = 0;
        touchStartTime = 0;
        return;
      }

      if (isPinching) {
        if (e.touches.length < 2) isPinching = false;
        if (currentZoomInstance && currentZoomInstance.getZoomLevel() < 1) {
          currentZoomInstance.resetZoom();
        }
        return;
      }

      if (isDraggingDown) {
        isDraggingDown = false;
        const deltaY = e.changedTouches[0].clientY - touchStartY;
        if (deltaY > 90) {
          haptic(25);
          if (viewerContent) {
            viewerContent.style.transition = 'transform 0.2s cubic-bezier(0.4, 0, 1, 1)';
            viewerContent.style.transform = `translateY(100vh)`;
          }
          setTimeout(() => {
            if (viewerContent) {
              viewerContent.style.transition = '';
              viewerContent.style.transform = '';
            }
            if (backdrop) backdrop.style.opacity = '';
            closeViewer();
          }, 180);
          return;
        } else {
          if (viewerContent) {
            viewerContent.style.transition = 'transform 0.2s ease-out';
            viewerContent.style.transform = '';
          }
          if (backdrop) {
            backdrop.style.transition = 'opacity 0.2s ease-out';
            backdrop.style.opacity = '';
          }
          setTimeout(() => {
            if (viewerContent) viewerContent.style.transition = '';
            if (backdrop) backdrop.style.transition = '';
          }, 220);
        }
      }

      if (e.changedTouches.length === 1 && (!currentZoomInstance || currentZoomInstance.getZoomLevel() <= 1.05)) {
        if (!touchStartY) return;
        const deltaX = e.changedTouches[0].clientX - touchStartX;
        const deltaY = e.changedTouches[0].clientY - touchStartY;
        const deltaTime = Date.now() - touchStartTime;
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        if (absX > 50 && absX > absY * 1.5 && deltaTime < 450) {
          if (deltaX < 0) {
            goToNext(false);
          } else {
            goToPrev(false);
          }
          return;
        }

        if (deltaY > 80 && absY > absX * 1.5 && deltaTime < 450) {
          haptic(25);
          closeViewer();
          return;
        }

        if (absX < 12 && absY < 12 && deltaTime < 250) {
          const now = Date.now();
          const tapX = e.changedTouches[0].clientX;
          const tapY = e.changedTouches[0].clientY;
          if (now - lastTapTime < 300) {
            if (currentZoomInstance) {
              currentZoomInstance.toggleDoubleTapZoom(tapX, tapY);
            }
          } else {
            setTimeout(() => {
              if (Date.now() - lastTapTime >= 280) {
                if (viewerSidebar && viewerSidebar.classList.contains('open')) {
                  viewerSidebar.classList.remove('open');
                } else if (viewerContent) {
                  viewerContent.classList.toggle('ui-hidden');
                }
              }
            }, 280);
          }
          lastTapTime = now;
        }
      }
    });
  }

  window.addEventListener('keydown', (e) => {
    if (!modal || modal.style.display !== 'flex') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.key === 'Escape') {
      e.preventDefault();
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

  return {
    openViewer,
    closeViewer
  };
}
