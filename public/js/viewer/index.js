import { state, isPostFavorite, isAuthorFavorite, isPostLiked, isPostDisliked, toggleLikeLocally, toggleDislikeLocally, markPostViewed, setFavoriteAuthors } from '../state.js';
import { getProxiedUrl, toggleFavoritePost, toggleFavoriteAuthor, toggleLikePost, toggleDislikeApi, updateFavoriteAuthorPreview, syncFavoriteAuthors, fetchAlbumPosts } from '../api.js';
import { showToast, haptic, getPostSiteUrl, copyToClipboard } from '../modules/uiUtils.js';
import { setupImageZoom } from './imageZoom.js';
import { createVideoPlayer } from './videoPlayer.js';
import { renderSidebarTags, formatRating } from './viewerSidebar.js';

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
  let activeAbortController = null;
  let activeBlobUrl = null;
  let currentZoomInstance = null;
  let currentVideoInstance = null;

  // Сенсорные переменные для жестов
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  let isDraggingDown = false;
  let initialPinchDist = 0;
  let initialZoom = 1;
  let isPinching = false;
  let lastTapTime = 0;

  function openViewer(index) {
    const list = (state.displayedPosts && state.displayedPosts.length > 0) ? state.displayedPosts : state.posts;
    if (index < 0 || index >= list.length) return;
    state.currentViewerIndex = index;
    currentPost = list[index];
    currentAlbumIndex = 0;
    if (viewerSidebar) viewerSidebar.classList.remove('open');
    if (viewerContent) viewerContent.classList.remove('ui-hidden');
    renderViewerPost();
    if (modal) modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeViewer() {
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
    if (currentZoomInstance) {
      currentZoomInstance.destroy();
      currentZoomInstance = null;
    }
    if (currentVideoInstance) {
      currentVideoInstance.destroy();
      currentVideoInstance = null;
    }

    if (mediaWrapper) mediaWrapper.innerHTML = '';
    currentPost = null;
    currentAlbumIndex = 0;
    state.currentViewerIndex = -1;
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
          itemDiv.title = `Изображение ${idx + 1} из ${currentPost.albumItems.length}`;

          const thumbUrl = item.thumb180 || item.thumb360 || item.previewUrl || item.sampleUrl || item.fileUrl || '';
          const needsThumbProxy = (item.site === 'danbooru' || thumbUrl.includes('donmai.us')) ? true : (state.settings?.proxyThumbnails !== false);
          const thumbSrc = thumbUrl ? (thumbUrl.startsWith('/api/') ? thumbUrl : (needsThumbProxy ? getProxiedUrl(thumbUrl) : thumbUrl)) : '';

          itemDiv.innerHTML = `
            <img class="album-filmstrip-img" src="${thumbSrc}" alt="Слайд ${idx + 1}" loading="lazy" referrerpolicy="no-referrer">
            <span class="album-filmstrip-page">${idx + 1}</span>
          `;

          itemDiv.addEventListener('click', (e) => {
            e.stopPropagation();
            haptic(10);
            switchAlbumSlide(idx);
          });

          albumFilmstripInner.appendChild(itemDiv);
        });

        // Скроллим активный элемент в видимую область
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

      // Наличие серии для дозагрузки в сайдбаре
      if (infoAlbumRow) {
        const canFetch = Boolean(currentPost?.canFetchAlbum || currentPost?.hasChildren || currentPost?.parentId || currentPost?.seriesKey);
        infoAlbumRow.style.display = canFetch ? 'flex' : 'none';
        if (btnFetchFullAlbumText) {
          if (isAlbum) {
            btnFetchFullAlbumText.textContent = `Обновить сет (${currentPost.albumItems.length} фото)`;
          } else {
            btnFetchFullAlbumText.textContent = 'Найти все части сета';
          }
        }
      }
    }

    function switchAlbumSlide(idx) {
      if (!currentPost?.albumItems || idx < 0 || idx >= currentPost.albumItems.length) return;
      currentAlbumIndex = idx;

      // Обновляем бейдж страницы
      if (viewerAlbumPageText) {
        viewerAlbumPageText.textContent = `${currentAlbumIndex + 1} / ${currentPost.albumItems.length}`;
      }

      // Обновляем активный класс в ленте миниатюр
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
      if (resBadge) resBadge.textContent = (activeItem.width && activeItem.height) ? `${activeItem.width} × ${activeItem.height}` : 'Оригинал';
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
        showToast('Ссылка на медиа недоступна');
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
          blobRef
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
            showToast('Не удалось загрузить полноразмерное фото');
          }
        });

        currentZoomInstance = setupImageZoom(img, { showToast });
        mediaWrapper.appendChild(img);
      }
    }

  function renderViewerPost() {
    if (!currentPost) return;

    if (currentPost.id) {
      markPostViewed(currentPost.id);
    }

    if (siteBadge) siteBadge.textContent = currentPost.siteName || currentPost.site;
    if (resBadge) resBadge.textContent = (currentPost.width && currentPost.height) ? `${currentPost.width} × ${currentPost.height}` : 'Оригинал';
    if (extBadge) extBadge.textContent = (currentPost.fileExt || 'JPG').toUpperCase();

    // Отображение Автора
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
        viewerFavAuthorBtn.title = isFavAuthor ? `Удалить автора "${cleanAuthorTag}" из любимых` : `Добавить автора "${cleanAuthorTag}" в любимые`;
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
        btnFavAuthorSidebarText.textContent = isFavAuthor ? 'В избранном' : 'В избранное';
        btnFavAuthorSidebar.title = isFavAuthor ? `Удалить автора "${cleanAuthorTag}" из любимых` : `Добавить автора "${cleanAuthorTag}" в любимые`;
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
          showToast(`Этот арт установлен обложкой автора ${authorName}!`);
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
        btnDislikeSidebarText.textContent = isDisliked ? 'Скрыто из ленты' : 'Скрыть из ленты';
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
        infoSite.innerHTML = `<a href="${postPageUrl}" target="_blank" rel="noopener noreferrer" style="color: var(--accent-primary); text-decoration: none; display: inline-flex; align-items: center; gap: 4px;" title="Открыть страницу на сайте ${siteName}">${siteName} <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>`;
      } else {
        infoSite.textContent = siteName;
      }
    }
    if (infoRating) infoRating.textContent = formatRating(currentPost.rating);
    let scoreText = `★ ${currentPost.score || 0}`;
    if (currentPost.views > 0 || currentPost.viewsText) {
      scoreText += `  •  👁️ ${currentPost.viewsText || currentPost.views}`;
    } else if (currentPost.favCount > 0) {
      scoreText += `  •  🔖 ${currentPost.favCount}`;
    }
    if (infoScore) infoScore.textContent = scoreText;
    if (infoAi) {
      infoAi.textContent = currentPost.isAi ? 'Да (ИИ-арт)' : 'Нет (Авторский)';
      infoAi.style.color = currentPost.isAi ? 'var(--accent-warning)' : 'var(--text-primary)';
    }

    // Рендер тегов в сайдбаре
    renderSidebarTags(currentPost, {
      onTagSelect: (t) => {
        if (onTagSelect) onTagSelect(t);
      },
      closeViewer
    });

    renderAlbumFilmstrip();
    const activeMediaItem = getCurrentMediaItem();
    loadMediaItem(activeMediaItem);
  }

  // Загрузка всех частей серии по кнопке в сайдбаре
  if (btnFetchFullAlbum) {
    btnFetchFullAlbum.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!currentPost) return;
      haptic(15);
      btnFetchFullAlbum.disabled = true;
      if (btnFetchFullAlbumText) btnFetchFullAlbumText.textContent = 'Поиск серии...';

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

          // Синхронизируем обновленный альбом в глобальном состоянии галереи
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

          // Обновляем бейдж карточки в DOM галереи
          const cardEl = document.querySelector(`.post-card[data-id="${currentPost.id}"]`);
          if (cardEl) {
            cardEl.classList.add('is-album-card');
            let badgeAlbum = cardEl.querySelector('.badge-album');
            if (!badgeAlbum) {
              badgeAlbum = document.createElement('span');
              badgeAlbum.className = 'badge-format badge-album';
              cardEl.querySelector('.post-badges')?.prepend(badgeAlbum);
            }
            if (badgeAlbum) {
              badgeAlbum.innerHTML = `📑 ${res.albumItems.length}`;
            }
          }

          renderViewerPost();
          showToast(`Найдено ${res.albumItems.length} изображений серии!`);
        } else {
          showToast('Дополнительные части серии не найдены');
          if (btnFetchFullAlbumText) btnFetchFullAlbumText.textContent = 'Части серии не найдены';
        }
      } catch (err) {
        console.error('Ошибка поиска альбома:', err);
        showToast('Не удалось выполнить поиск частей серии');
      } finally {
        btnFetchFullAlbum.disabled = false;
      }
    });
  }

  // Скачивание всех изображений альбома
  async function downloadFullAlbum(e) {
    if (e) e.preventDefault();
    if (!currentPost || !currentPost.isAlbum || !Array.isArray(currentPost.albumItems) || currentPost.albumItems.length === 0) return;
    haptic(20);
    showToast(`Начато скачивание альбома (${currentPost.albumItems.length} файлов)...`);

    for (let i = 0; i < currentPost.albumItems.length; i++) {
      const item = currentPost.albumItems[i];
      const downloadTarget = item.fileUrl || item.sampleUrl || item.previewUrl;
      if (!downloadTarget) continue;

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
      // Небольшая задержка между скачиваниями
      await new Promise(r => setTimeout(r, 350));
    }
    showToast('Все изображения альбома загружены');
  }

  if (btnDownloadAlbum) {
    btnDownloadAlbum.addEventListener('click', downloadFullAlbum);
  }
  if (btnDownloadAlbumSidebar) {
    btnDownloadAlbumSidebar.addEventListener('click', downloadFullAlbum);
  }

  // Переключение шторки тегов на мобильных
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
        btnDislikeSidebarText.textContent = isDislikedNow ? 'Скрыто из ленты' : 'Скрыть из ленты';
      }
    }
    showToast(isDislikedNow ? 'Пост скрыт (рекомендации обновлены)' : 'Скрытие отменено');
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
      showToast(isLikedNow ? 'Понравилось (рекомендации обновлены)' : 'Лайк удален');
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
            showToast('Сохранено в закладки');
          } else {
            state.favoriteIds.delete(currentPost.id);
            state.favorites = state.favorites.filter(f => f.id !== currentPost.id);
            btnFavModal.classList.remove('active');
            btnFavModal.querySelector('svg')?.setAttribute('fill', 'none');
            showToast('Удалено из закладок');
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
        showToast('Ссылка недоступна');
        return;
      }
      
      haptic(15);
      const success = await copyToClipboard(urlToCopy);
      if (success) {
        showToast('Ссылка на пост скопирована');
      } else {
        showToast('Не удалось скопировать ссылку');
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
        showToast('Ссылка на файл недоступна');
        return;
      }

      showToast('Начата загрузка на устройство...');
      
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
            showToast('Файл сохранён напрямую с CDN');
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
        showToast('Файл сохранён в память устройства');
      } catch (err) {
        console.warn('[Download error]', err);
        showToast('Не удалось загрузить файл для сохранения');
      }
    });
  }

  function goToNext(skipAlbum = false) {
    if (!skipAlbum && currentPost?.isAlbum && Array.isArray(currentPost.albumItems) && currentAlbumIndex < currentPost.albumItems.length - 1) {
      haptic(10);
      switchAlbumSlide(currentAlbumIndex + 1);
      return;
    }

    const list = (state.displayedPosts && state.displayedPosts.length > 0) ? state.displayedPosts : state.posts;
    if (state.currentViewerIndex < list.length - 1) {
      haptic(15);
      openViewer(state.currentViewerIndex + 1);
    }
  }

  function goToPrev(skipAlbum = false) {
    if (!skipAlbum && currentPost?.isAlbum && Array.isArray(currentPost.albumItems) && currentAlbumIndex > 0) {
      haptic(10);
      switchAlbumSlide(currentAlbumIndex - 1);
      return;
    }

    const list = (state.displayedPosts && state.displayedPosts.length > 0) ? state.displayedPosts : state.posts;
    if (state.currentViewerIndex > 0) {
      haptic(15);
      openViewer(state.currentViewerIndex - 1);
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
        showToast('Все теги поста скопированы');
      } else {
        showToast('Не удалось скопировать теги');
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
          showToast(`Автор ${authorName} добавлен в любимые`);
        } else {
          state.favoriteAuthorNames.delete(cleanAuthorTag.toLowerCase());
          state.favoriteAuthors = state.favoriteAuthors.filter(a => (a.name || '').toLowerCase() !== cleanAuthorTag.toLowerCase());
          showToast(`Автор ${authorName} удален из любимых`);
        }

        const isFavAuthor = res.isFavorite;
        if (viewerFavAuthorBtn) {
          viewerFavAuthorBtn.classList.toggle('active', isFavAuthor);
          viewerFavAuthorBtn.title = isFavAuthor ? `Удалить автора "${cleanAuthorTag}" из любимых` : `Добавить автора "${cleanAuthorTag}" в любимые`;
        }
        if (btnFavAuthorSidebar && btnFavAuthorSidebarText) {
          btnFavAuthorSidebar.classList.toggle('active', isFavAuthor);
          btnFavAuthorSidebarText.textContent = isFavAuthor ? 'В избранном' : 'В избранное';
          btnFavAuthorSidebar.title = isFavAuthor ? `Удалить автора "${cleanAuthorTag}" из любимых` : `Добавить автора "${cleanAuthorTag}" в любимые`;
        }
        if (btnSetAuthorCoverSidebar) {
          btnSetAuthorCoverSidebar.style.display = isFavAuthor ? 'inline-flex' : 'none';
        }

        if (onFavoriteAuthorToggle) onFavoriteAuthorToggle();
      }
    } catch (err) {
      console.error('Ошибка добавления автора в любимые:', err);
      showToast('Не удалось обновить избранного автора');
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

  // Проверка касания по интерактивным элементам (плашка видео, лента альбома, сайдбар, кнопки)
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

  // Сенсорные жесты
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
