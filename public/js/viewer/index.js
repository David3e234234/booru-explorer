import { state, isPostFavorite, isAuthorFavorite, isPostLiked, toggleLikeLocally, markPostViewed } from '../state.js';
import { getProxiedUrl, toggleFavoritePost, toggleFavoriteAuthor, toggleLikePost } from '../api.js';
import { showToast, haptic } from '../modules/uiUtils.js';
import { setupImageZoom } from './imageZoom.js';
import { createVideoPlayer } from './videoPlayer.js';
import { renderSidebarTags, formatRating } from './viewerSidebar.js';

export function initViewer({ onFavoriteToggle, onFavoriteAuthorToggle, onTagSelect }) {
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
  const btnLikeModal = document.getElementById('btnLikeModal');
  const btnFavModal = document.getElementById('btnFavModal');
  const btnDownload = document.getElementById('btnDownload');
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

  const infoSite = document.getElementById('infoSite');
  const infoRating = document.getElementById('infoRating');
  const infoScore = document.getElementById('infoScore');
  const infoAi = document.getElementById('infoAi');
  const btnCopyAllTags = document.getElementById('btnCopyAllTags');

  let currentPost = null;
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
    if (index < 0 || index >= state.posts.length) return;
    state.currentViewerIndex = index;
    currentPost = state.posts[index];
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
    if (viewerContent) viewerContent.classList.remove('ui-hidden');
    
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
    state.currentViewerIndex = -1;
  }

  function renderViewerPost() {
    if (!currentPost) return;

    if (currentPost.id) {
      markPostViewed(currentPost.id);
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
          if (onTagSelect) onTagSelect(cleanAuthorTag);
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
          if (onTagSelect) onTagSelect(cleanAuthorTag);
        };
      }
      if (btnFavAuthorSidebar && btnFavAuthorSidebarText) {
        btnFavAuthorSidebar.classList.toggle('active', isFavAuthor);
        btnFavAuthorSidebarText.textContent = isFavAuthor ? 'В избранном' : 'В избранное';
        btnFavAuthorSidebar.title = isFavAuthor ? `Удалить автора "${cleanAuthorTag}" из любимых` : `Добавить автора "${cleanAuthorTag}" в любимые`;
      }
    } else {
      if (viewerAuthorBadge) viewerAuthorBadge.style.display = 'none';
      if (viewerFavAuthorBtn) viewerFavAuthorBtn.style.display = 'none';
      if (infoAuthorRow) infoAuthorRow.style.display = 'none';
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

    const infoDurationRow = document.getElementById('infoDurationRow');
    const infoDuration = document.getElementById('infoDuration');
    if (currentPost.isVideo && (currentPost.durationText || currentPost.duration > 0)) {
      const durText = currentPost.durationText || `${Math.floor(currentPost.duration / 60)}:${Math.floor(currentPost.duration % 60) < 10 ? '0' : ''}${Math.floor(currentPost.duration % 60)}`;
      if (infoDuration) infoDuration.textContent = durText;
      if (infoDurationRow) infoDurationRow.style.display = 'flex';
    } else {
      if (infoDurationRow) infoDurationRow.style.display = 'none';
    }

    if (infoSite) infoSite.textContent = currentPost.siteName || currentPost.site;
    if (infoRating) infoRating.textContent = formatRating(currentPost.rating);
    if (infoScore) infoScore.textContent = `★ ${currentPost.score || 0}`;
    if (infoAi) {
      infoAi.textContent = currentPost.isAi ? 'Да (ИИ-арт)' : 'Нет (Авторский)';
      infoAi.style.color = currentPost.isAi ? 'var(--accent-warning)' : 'var(--text-primary)';
    }

    renderSidebarTags(currentPost, { onTagSelect, closeViewer });

    if (!mediaWrapper) return;
    mediaWrapper.innerHTML = '';

    const directMedia = currentPost.isVideo 
      ? (currentPost.fileUrl || currentPost.sampleUrl) 
      : (currentPost.sampleUrl || currentPost.fileUrl);

    if (!directMedia) {
      mediaWrapper.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--text-muted); padding: 40px; text-align: center;">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="16"/></svg>
          <span style="font-size: 14px; font-weight: 600; color: var(--text-primary);">Медиафайл недоступен</span>
          <span style="font-size: 12px;">Пост находится в обработке на сервере источника или недоступен для публичного скачивания</span>
        </div>
      `;
      return;
    }

    const abortRef = {
      get current() { return activeAbortController; },
      set current(val) { activeAbortController = val; }
    };
    const blobRef = {
      get current() { return activeBlobUrl; },
      set current(val) { activeBlobUrl = val; }
    };

    if (currentPost.isVideo) {
      currentVideoInstance = createVideoPlayer(currentPost, {
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
      const needsImgProxy = currentPost.site === 'danbooru' || directMedia.includes('donmai.us') || state.settings?.proxyFullImages !== false;
      const proxyMedia = getProxiedUrl(directMedia);
      img.src = needsImgProxy ? proxyMedia : directMedia;
      img.referrerPolicy = 'no-referrer';
      img.alt = 'Full View';

      img.addEventListener('error', function () {
        if (this.src !== proxyMedia) {
          console.warn('[Viewer Image Fallback] Переключение на прокси');
          this.src = proxyMedia;
        } else {
          showToast('Не удалось загрузить полноразмерное фото');
        }
      });

      currentZoomInstance = setupImageZoom(img, { showToast });
      mediaWrapper.appendChild(img);
    }
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

  if (btnLikeModal) {
    btnLikeModal.addEventListener('click', async () => {
      if (!currentPost) return;
      haptic([15, 20]);
      const isLikedNow = toggleLikeLocally(currentPost);
      btnLikeModal.classList.toggle('active', isLikedNow);
      btnLikeModal.querySelector('svg')?.setAttribute('fill', isLikedNow ? 'currentColor' : 'none');
      showToast(isLikedNow ? 'Понравилось ❤️ (Рекомендации обучены)' : 'Лайк удален');
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
            showToast('Сохранено в закладки 🔖');
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
    btnCopyLink.addEventListener('click', () => {
      if (!currentPost) return;
      const url = currentPost.fileUrl || currentPost.sampleUrl;
      navigator.clipboard.writeText(url).then(() => {
        showToast('Прямая ссылка скопирована 📋');
      });
    });
  }

  if (btnDownload) {
    btnDownload.addEventListener('click', async (e) => {
      e.preventDefault();
      if (!currentPost) return;
      const downloadTarget = currentPost.fileUrl || currentPost.sampleUrl;
      if (!downloadTarget) {
        showToast('Ссылка на файл недоступна');
        return;
      }
      const ext = currentPost.fileExt || (currentPost.isVideo ? 'mp4' : 'jpg');
      const filename = `booru_${currentPost.site || 'post'}_${currentPost.id}.${ext}`;

      showToast('Начата загрузка на устройство... 📥');
      
      const shouldUseProxyDownload = currentPost.site === 'danbooru' || downloadTarget.includes('donmai.us') || state.settings?.proxyDownloads !== false;
      
      if (!shouldUseProxyDownload) {
        try {
          const directRes = await fetch(downloadTarget, { mode: 'cors' });
          if (directRes.ok) {
            const blob = await directRes.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
            showToast('Файл сохранён напрямую с CDN! 💾');
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
        const blobUrl = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
        showToast('Файл сохранён в память устройства! 💾');
      } catch (err) {
        console.warn('[Direct download fallback]', err);
        const a = document.createElement('a');
        a.href = getProxiedUrl(downloadTarget);
        a.target = '_blank';
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        showToast('Файл открыт для сохранения');
      }
    });
  }

  if (btnCopyAllTags) {
    btnCopyAllTags.addEventListener('click', () => {
      if (!currentPost || !Array.isArray(currentPost.tags)) return;
      navigator.clipboard.writeText(currentPost.tags.join(' ')).then(() => {
        showToast('Все теги поста скопированы 📋');
      });
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
          showToast(`Автор ${authorName} добавлен в любимые ⭐`);
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

  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      if (state.currentViewerIndex > 0) {
        haptic(15);
        openViewer(state.currentViewerIndex - 1);
      }
    });
  }

  if (btnNext) {
    btnNext.addEventListener('click', () => {
      if (state.currentViewerIndex < state.posts.length - 1) {
        haptic(15);
        openViewer(state.currentViewerIndex + 1);
      }
    });
  }

  if (btnClose) btnClose.addEventListener('click', closeViewer);
  if (backdrop) backdrop.addEventListener('click', closeViewer);

  // Сенсорные жесты
  if (mediaWrapper) {
    mediaWrapper.addEventListener('touchstart', (e) => {
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
        const deltaX = e.changedTouches[0].clientX - touchStartX;
        const deltaY = e.changedTouches[0].clientY - touchStartY;
        const deltaTime = Date.now() - touchStartTime;
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        if (absX > 50 && absX > absY * 1.5 && deltaTime < 450) {
          if (deltaX < 0) {
            btnNext?.click();
          } else {
            btnPrev?.click();
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
          if (now - lastTapTime < 300) {
            if (currentZoomInstance) {
              currentZoomInstance.toggleDoubleTapZoom();
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

    if (e.key === 'Escape') {
      closeViewer();
    } else if (e.key === 'ArrowLeft') {
      btnPrev?.click();
    } else if (e.key === 'ArrowRight') {
      btnNext?.click();
    } else if (e.key.toLowerCase() === 'f') {
      btnFavModal?.click();
    } else if (e.key.toLowerCase() === 'l') {
      btnLikeModal?.click();
    }
  });

  return {
    openViewer,
    closeViewer
  };
}
