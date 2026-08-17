import { state, isPostFavorite, isAuthorFavorite, isPostLiked, toggleLikeLocally, markPostViewed } from './state.js';
import { getProxiedUrl, toggleFavoritePost, toggleFavoriteAuthor, toggleLikePost } from './api.js';

export function initViewer({ onFavoriteToggle, onFavoriteAuthorToggle, onTagSelect, showToast }) {
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
  const viewerTagsBadgeCount = document.getElementById('viewerTagsBadgeCount');
  const btnCloseViewerTags = document.getElementById('btnCloseViewerTags');
  const viewerSidebar = document.getElementById('viewerSidebar');
  const viewerAuthorBadge = document.getElementById('viewerAuthorBadge');
  const viewerAuthorText = document.getElementById('viewerAuthorText');
  const viewerFavAuthorBtn = document.getElementById('viewerFavAuthorBtn');
  const infoAuthorRow = document.getElementById('infoAuthorRow');
  const infoAuthor = document.getElementById('infoAuthor');
  const btnFavAuthorSidebar = document.getElementById('btnFavAuthorSidebar');
  const btnFavAuthorSidebarText = document.getElementById('btnFavAuthorSidebarText');

  // Сайдбар
  const infoSite = document.getElementById('infoSite');
  const infoRating = document.getElementById('infoRating');
  const infoScore = document.getElementById('infoScore');
  const infoAi = document.getElementById('infoAi');
  const tagsCloud = document.getElementById('viewerTagsCloud');
  const tagsCountTotal = document.getElementById('tagsCountTotal');
  const btnCopyAllTags = document.getElementById('btnCopyAllTags');

  function hapticVibrate(pattern) {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (e) {}
    }
  }

  let currentPost = null;
  let zoomLevel = 1;
  let panX = 0;
  let panY = 0;
  let isDragging = false;
  let startX = 0;
  let startY = 0;

  // Сенсорные переменные для жестов (Touch Gestures)
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  let isDraggingDown = false;
  let initialPinchDist = 0;
  let initialZoom = 1;
  let isPinching = false;
  let lastTapTime = 0;

  let activeAbortController = null;
  let activeBlobUrl = null;

  function openViewer(index) {
    if (index < 0 || index >= state.posts.length) return;
    state.currentViewerIndex = index;
    currentPost = state.posts[index];
    if (viewerSidebar) viewerSidebar.classList.remove('open');
    if (viewerContent) viewerContent.classList.remove('ui-hidden');
    renderViewerPost();
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeViewer() {
    modal.style.display = 'none';
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
    mediaWrapper.innerHTML = '';
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

    zoomLevel = 1;
    panX = 0;
    panY = 0;

    siteBadge.textContent = currentPost.siteName || currentPost.site;
    resBadge.textContent = (currentPost.width && currentPost.height) ? `${currentPost.width} × ${currentPost.height}` : 'Оригинал';
    extBadge.textContent = (currentPost.fileExt || 'JPG').toUpperCase();

    // Отображение Автора (Artist / Creator / Model)
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
          onTagSelect(cleanAuthorTag);
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
          onTagSelect(cleanAuthorTag);
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
    btnFavModal.classList.toggle('active', isFav);
    btnFavModal.querySelector('svg').setAttribute('fill', isFav ? 'currentColor' : 'none');

    const isLiked = isPostLiked(currentPost.id);
    if (btnLikeModal) {
      btnLikeModal.classList.toggle('active', isLiked);
      btnLikeModal.querySelector('svg').setAttribute('fill', isLiked ? 'currentColor' : 'none');
    }

    // btnDownload behavior is handled by click event below

    infoSite.textContent = currentPost.siteName || currentPost.site;
    infoRating.textContent = formatRating(currentPost.rating);
    infoScore.textContent = `★ ${currentPost.score || 0}`;
    infoAi.textContent = currentPost.isAi ? 'Да (ИИ-арт)' : 'Нет (Авторский)';
    infoAi.style.color = currentPost.isAi ? 'var(--accent-warning)' : 'var(--text-primary)';

    renderSidebarTags(currentPost);

    mediaWrapper.innerHTML = '';

    const directMedia = currentPost.isVideo 
      ? (currentPost.fileUrl || currentPost.sampleUrl) 
      : (currentPost.sampleUrl || currentPost.fileUrl);

    if (!directMedia) {
      mediaWrapper.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--text-muted); padding: 40px; text-align: center;">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span style="font-size: 14px; font-weight: 600; color: var(--text-primary);">Медиафайл недоступен</span>
          <span style="font-size: 12px;">Пост находится в обработке на сервере источника или недоступен для публичного скачивания</span>
        </div>
      `;
      return;
    }

    const proxyMedia = getProxiedUrl(directMedia);
    const transcodeMedia = `/api/transcode-video?url=${encodeURIComponent(directMedia)}`;

    if (currentPost.isVideo) {
      const videoContainer = document.createElement('div');
      videoContainer.className = 'viewer-video-container';

      // Индикатор состояния видео с прогресс-баром и кнопками управления
      const statusBanner = document.createElement('div');
      statusBanner.className = 'video-status-banner';
      statusBanner.innerHTML = `
        <div class="video-status-drag-handle" title="Потяните, чтобы переместить"></div>
        <div class="video-status-top-row">
          <div class="video-status-left">
            <div class="video-status-spinner"></div>
            <span class="video-status-text">Инициализация видеопотока...</span>
          </div>
          <span class="video-progress-percent">0%</span>
        </div>
        <div class="video-progress-track">
          <div class="video-progress-fill" style="width: 0%;"></div>
        </div>
        <div class="video-status-actions">
          <button class="btn-cache-toggle" title="Полностью закэшировать видео в память для просмотра без лагов">⚡ Кэш в память</button>
          <button class="btn-transcode" title="Перекодировать видео в совместимый браузерный формат H.264/AAC через FFmpeg">🔄 FFmpeg фикс</button>
          <button class="btn-switch-source" title="Переключить между прямым источником и прокси">🛡️ Прокси</button>
        </div>
      `;

      makeBannerDraggable(statusBanner);

      const isBannerVisible = state.settings.showVideoStatusBanner !== false;
      if (!isBannerVisible) {
        statusBanner.style.display = 'none';
      }

      const shouldAutoplay = state.settings?.videoAutoplayViewer !== false;
      const video = document.createElement('video');
      video.className = 'viewer-video';
      video.referrerPolicy = 'no-referrer';
      video.controls = true;
      video.autoplay = shouldAutoplay;
      video.loop = true;
      video.playsInline = true;
      video.preload = shouldAutoplay ? 'auto' : 'metadata';

      const posterQuality = state.settings?.previewQuality || 'high';
      const videoTarget = currentPost.fileUrl || currentPost.sampleUrl || '';
      if (posterQuality === 'high' || posterQuality === 'original') {
        video.poster = videoTarget ? `/api/video-thumbnail?url=${encodeURIComponent(videoTarget)}&quality=${posterQuality}` : (currentPost.previewUrl || '');
      } else if (currentPost.previewUrl) {
        video.poster = currentPost.previewUrl;
      }
      if (currentPost.width && currentPost.height) {
        video.style.aspectRatio = `${currentPost.width} / ${currentPost.height}`;
      }

      const textEl = statusBanner.querySelector('.video-status-text');
      const spinEl = statusBanner.querySelector('.video-status-spinner');
      const percentEl = statusBanner.querySelector('.video-progress-percent');
      const fillEl = statusBanner.querySelector('.video-progress-fill');
      const btnCache = statusBanner.querySelector('.btn-cache-toggle');
      const btnTranscode = statusBanner.querySelector('.btn-transcode');
      const isMyLiveDemo = typeof window !== 'undefined' && window.location.hostname === 'booru-explorer-kappa.vercel.app';
      const needsProxy = currentPost.site === 'danbooru' || directMedia.includes('donmai.us') || (!isMyLiveDemo && state.settings?.proxyVideos !== false && state.settings?.proxyVideoDefault !== false);
      let currentSource = needsProxy ? 'proxy' : 'direct'; // 'direct', 'proxy', 'transcode'
      let isPreCaching = false;
      let loadTimeout = null;

      const setProgress = (percent, text = null, showSpinner = true, isError = false) => {
        if (text && textEl) textEl.textContent = text;
        if (spinEl) spinEl.style.display = showSpinner ? 'block' : 'none';
        if (percent !== null && percent !== undefined) {
          const clamped = Math.min(100, Math.max(0, Math.round(percent)));
          if (percentEl) percentEl.textContent = `${clamped}%`;
          if (fillEl) fillEl.style.width = `${clamped}%`;
        }
        statusBanner.classList.toggle('error', isError);
        if (state.settings.showVideoStatusBanner !== false) {
          statusBanner.style.display = 'flex';
        }
      };

      const hideStatus = () => {
        statusBanner.style.display = 'none';
      };

      // Функция полной предзагрузки в память (Кэширование)
      const startPreCaching = async (targetUrl) => {
        if (activeAbortController) activeAbortController.abort();
        activeAbortController = new AbortController();
        isPreCaching = true;
        btnCache.classList.add('active');
        btnCache.textContent = '⚡ Кэширование...';
        setProgress(0, 'Кэширование в память...', true);

        try {
          const res = await fetch(targetUrl, { signal: activeAbortController.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const contentLength = res.headers.get('content-length');
          const total = contentLength ? parseInt(contentLength, 10) : 0;
          let loaded = 0;
          const reader = res.body.getReader();
          const chunks = [];

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            loaded += value.length;
            const pct = total > 0 ? (loaded / total) * 100 : Math.min(95, (loaded / 5000000) * 100);
            const mbText = (loaded / (1024 * 1024)).toFixed(1);
            const totalMbText = total > 0 ? ` / ${(total / (1024 * 1024)).toFixed(1)} MB` : ' MB';
            setProgress(pct, `Кэширование: ${mbText}${totalMbText}`, true);
          }

          const blob = new Blob(chunks, { type: 'video/mp4' });
          if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
          activeBlobUrl = URL.createObjectURL(blob);

          video.src = activeBlobUrl;
          video.play().catch(() => {});
          setProgress(100, 'Закэшировано в память! ⚡', false);
          btnCache.textContent = '⚡ В памяти (OK)';
          setTimeout(hideStatus, 1200);
        } catch (err) {
          if (err.name === 'AbortError') return;
          console.warn('[PreCache Error]', err);
          btnCache.classList.remove('active');
          btnCache.textContent = '⚡ Кэш в память';
          isPreCaching = false;
          handleVideoError();
        }
      };

      btnCache.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentSrc = currentSource === 'transcode' ? transcodeMedia : (currentSource === 'proxy' ? proxyMedia : directMedia);
        startPreCaching(currentSrc);
      });

      let mediaSourceInstance = null;

      // Функция демультиплексирования и сборки fMP4 в браузере через MediaSource
      const startClientRemux = async (targetUrl) => {
        if (activeAbortController) activeAbortController.abort();
        activeAbortController = new AbortController();
        isPreCaching = true;
        currentSource = 'remux';
        if (btnTranscode) {
          btnTranscode.classList.add('active');
          btnTranscode.textContent = '🚀 JS Ремукс...';
        }
        setProgress(0, '🚀 Клиентский JS-демуксинг (MSE)...', true);

        try {
          if (!window.MediaSource || !window.MP4Box) {
            throw new Error('MediaSource или MP4Box не поддерживается');
          }

          if (mediaSourceInstance && mediaSourceInstance.readyState === 'open') {
            try { mediaSourceInstance.endOfStream(); } catch {}
          }

          const ms = new MediaSource();
          mediaSourceInstance = ms;
          if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
          activeBlobUrl = URL.createObjectURL(ms);
          video.src = activeBlobUrl;

          const mp4boxfile = window.MP4Box.createFile();
          let sourceBuffer = null;
          let fileInfo = null;

          await new Promise((resolve, reject) => {
            ms.addEventListener('sourceopen', () => resolve(), { once: true });
            setTimeout(() => reject(new Error('MediaSource timeout')), 3000);
          });

          mp4boxfile.onReady = (info) => {
            fileInfo = info;
            try {
              // Инициализация сегментов для каждого трека
              mp4boxfile.setSegmentOptions(info.tracks[0].id, null, { nbSamples: 100 });
              const mime = `video/mp4; codecs="${info.mime.split('codecs="')[1]?.replace('"', '') || 'avc1.42E01E, mp4a.40.2'}"`;
              if (MediaSource.isTypeSupported(mime)) {
                sourceBuffer = ms.addSourceBuffer(mime);
              } else {
                sourceBuffer = ms.addSourceBuffer('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
              }
              sourceBuffer.mode = 'segments';
              const initSegs = mp4boxfile.initializeSegmentation();
              if (initSegs && initSegs.length > 0 && initSegs[0].buffer) {
                sourceBuffer.appendBuffer(initSegs[0].buffer);
              }
            } catch (e) {
              console.warn('[MSE Init Warning]', e);
            }
          };

          mp4boxfile.onSegment = (id, user, buffer, sampleNum, is_last) => {
            if (sourceBuffer && !sourceBuffer.updating && ms.readyState === 'open') {
              try {
                sourceBuffer.appendBuffer(buffer);
              } catch (e) {
                console.warn('[MSE Append Warning]', e);
              }
            }
          };

          // Читаем видео по чанкам и скармливаем MP4Box
          const res = await fetch(targetUrl, { signal: activeAbortController.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const contentLength = res.headers.get('content-length');
          const total = contentLength ? parseInt(contentLength, 10) : 0;
          let loaded = 0;
          let fileStart = 0;
          const reader = res.body.getReader();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const buffer = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
            buffer.fileStart = fileStart;
            fileStart += buffer.byteLength;
            loaded += value.length;

            mp4boxfile.appendBuffer(buffer);
            mp4boxfile.flush();

            const pct = total > 0 ? (loaded / total) * 100 : Math.min(95, (loaded / 5000000) * 100);
            setProgress(pct, `🚀 JS Ремукс: ${(loaded / (1024 * 1024)).toFixed(1)} MB`, true);
          }

          isPreCaching = false;
          if (btnTranscode) {
            btnTranscode.textContent = '🚀 JS Ремукс (OK)';
          }
          setProgress(100, '🚀 JS Ремукс готов!', false);
          video.play().catch(() => {});
          setTimeout(hideStatus, 1200);
        } catch (err) {
          if (err.name === 'AbortError') return;
          console.warn('[Client Remux Error]', err);
          isPreCaching = false;
          // Если JS-демультиплексирование не справилось (например, неподдерживаемый кодек) — аварийный переход на FFmpeg
          currentSource = 'transcode';
          if (btnTranscode) {
            btnTranscode.classList.add('active');
            btnTranscode.textContent = '🔄 FFmpeg фикс';
          }
          setProgress(0, '🔄 Аппаратный кодек не подошел. Переход на FFmpeg (H.264)...', true);
          video.src = transcodeMedia;
          video.play().catch(() => {});
        }
      };

      const handleVideoError = () => {
        if (isPreCaching) return;
        if (currentSource === 'direct') {
          currentSource = 'proxy';
          if (switchBtn) switchBtn.textContent = '⚡ Прямой CDN';
          setProgress(0, 'Подключение через локальный прокси...', true);
          video.src = proxyMedia;
          video.play().catch(() => {});
        } else if (currentSource === 'proxy') {
          // Шаг 2: Попытка быстрого клиентского демультиплексирования в браузере (0% CPU сервера)
          startClientRemux(proxyMedia);
        } else if (currentSource === 'remux') {
          // Шаг 3: Аварийный переход на серверный FFmpeg транскодер
          currentSource = 'transcode';
          if (btnTranscode) {
            btnTranscode.classList.add('active');
            btnTranscode.textContent = '🔄 FFmpeg фикс';
          }
          setProgress(0, '🔄 Авто-исправление кодека через FFmpeg (H.264)...', true);
          video.src = transcodeMedia;
          video.play().catch(() => {});
        } else {
          setProgress(0, 'Не удалось воспроизвести видео (ошибка исходного файла)', false, true);
        }
      };

      // Кнопка принудительного FFmpeg / Remux перекодирования
      if (btnTranscode) {
        btnTranscode.addEventListener('click', (e) => {
          e.stopPropagation();
          if (isPreCaching && activeAbortController) {
            activeAbortController.abort();
            isPreCaching = false;
            btnCache.classList.remove('active');
            btnCache.textContent = '⚡ Кэш в память';
          }
          // При ручном клике — сразу пробуем быстрый клиентский демукс
          startClientRemux(proxyMedia);
        });
      }

      // Переключатель источника
      if (switchBtn) {
        switchBtn.textContent = currentSource === 'proxy' ? '⚡ Прямой CDN' : '🛡️ Прокси';
        switchBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (isPreCaching && activeAbortController) {
            activeAbortController.abort();
            isPreCaching = false;
            btnCache.classList.remove('active');
            btnCache.textContent = '⚡ Кэш в память';
          }
          if (btnTranscode) btnTranscode.classList.remove('active');

          if (currentSource === 'direct') {
            currentSource = 'proxy';
            switchBtn.textContent = '⚡ Прямой CDN';
            setProgress(0, 'Загрузка через локальный сервер...', true);
            video.src = proxyMedia;
          } else {
            currentSource = 'direct';
            switchBtn.textContent = '🛡️ Прокси';
            setProgress(0, 'Загрузка напрямую с CDN...', true);
            video.src = directMedia;
          }
          video.play().catch(() => {});
        });
      }

      video.addEventListener('loadstart', () => {
        if (!isPreCaching) {
          const statusText = currentSource === 'transcode' 
            ? '🔄 Подготовка FFmpeg H.264 видео...' 
            : (currentSource === 'proxy' ? 'Подключение через локальный прокси...' : 'Инициализация видеопотока CDN...');
          setProgress(0, statusText, true);
        }
        clearTimeout(loadTimeout);
        // Если за 2.5 секунды прямое видео не готово, переключаем на локальный прокси
        loadTimeout = setTimeout(() => {
          if (video.readyState < 2 && currentSource === 'direct' && !isPreCaching) {
            console.warn('[Video Timeout] Прямая загрузка CDN не ответила, переход на прокси');
            handleVideoError();
          }
        }, 2500);
      });

      video.addEventListener('progress', () => {
        if (isPreCaching) return;
        if (video.duration > 0 && video.buffered.length > 0) {
          const bufferedEnd = video.buffered.end(video.buffered.length - 1);
          const pct = (bufferedEnd / video.duration) * 100;
          setProgress(pct, 'Буферизация...', true);
          if (pct >= 99) {
            setTimeout(hideStatus, 800);
          }
        }
      });

      video.addEventListener('waiting', () => {
        if (!isPreCaching) {
          setProgress(null, 'Буферизация видео...', true);
        }
      });

      video.addEventListener('canplay', () => {
        clearTimeout(loadTimeout);
        if (!isPreCaching) hideStatus();
      });

      video.addEventListener('playing', () => {
        clearTimeout(loadTimeout);
        if (!isPreCaching) hideStatus();
      });

      video.addEventListener('error', () => {
        clearTimeout(loadTimeout);
        if (!isPreCaching) {
          console.warn('[Video Error] Ошибка тега video, запуск обработчика fallback');
          handleVideoError();
        }
      });

      // Старт воспроизведения
      video.src = currentSource === 'proxy' ? proxyMedia : directMedia;
      videoContainer.appendChild(video);
      mediaWrapper.appendChild(videoContainer);
      mediaWrapper.appendChild(statusBanner);
    } else {
      const img = document.createElement('img');
      img.className = 'viewer-image';
      const isMyLiveDemo = typeof window !== 'undefined' && window.location.hostname === 'booru-explorer-kappa.vercel.app';
      const needsImgProxy = currentPost.site === 'danbooru' || directMedia.includes('donmai.us') || (!isMyLiveDemo && state.settings?.proxyFullImages !== false);
      img.src = needsImgProxy ? proxyMedia : directMedia;
      img.referrerPolicy = 'no-referrer';
      img.alt = 'Full View';

      img.addEventListener('error', function () {
        if (isMyLiveDemo) {
          showToast('Не удалось загрузить фото напрямую с CDN');
          return;
        }
        if (this.src !== proxyMedia) {
          console.warn('[Viewer Image Fallback] Переключение на прокси');
          this.src = proxyMedia;
        } else {
          showToast('Не удалось загрузить полноразмерное фото');
        }
      });

      img.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY * -0.0015;
        zoomLevel = Math.min(Math.max(0.5, zoomLevel + delta), 4.5);
        updateImageTransform(img);
      });

      img.addEventListener('mousedown', (e) => {
        if (zoomLevel > 1) {
          isDragging = true;
          startX = e.clientX - panX;
          startY = e.clientY - panY;
          img.classList.add('dragging');
        }
      });

      window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        panX = e.clientX - startX;
        panY = e.clientY - startY;
        updateImageTransform(img);
      });

      window.addEventListener('mouseup', () => {
        if (isDragging) {
          isDragging = false;
          img.classList.remove('dragging');
        }
      });

      img.addEventListener('dblclick', () => {
        zoomLevel = zoomLevel === 1 ? 2 : 1;
        panX = 0;
        panY = 0;
        updateImageTransform(img);
      });

      mediaWrapper.appendChild(img);
    }
  }

  function updateImageTransform(img) {
    if (!img) return;
    img.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
  }

  function renderSidebarTags(post) {
    tagsCloud.innerHTML = '';
    const tags = Array.isArray(post.tags) ? post.tags : [];
    tagsCountTotal.textContent = String(tags.length);
    if (viewerTagsBadgeCount) {
      viewerTagsBadgeCount.textContent = String(tags.length);
    }

    if (tags.length === 0) {
      tagsCloud.innerHTML = '<span style="color: var(--text-muted); font-size: 12px;">Теги отсутствуют</span>';
      return;
    }

    tags.forEach(tag => {
      const tagEl = document.createElement('a');
      tagEl.className = `post-tag ${getTagCategoryClass(tag, post.tagDetails)}`;
      tagEl.textContent = tag.replace(/_/g, ' ');
      tagEl.href = '#';

      tagEl.addEventListener('click', (e) => {
        e.preventDefault();
        closeViewer();
        onTagSelect(tag);
      });

      tagsCloud.appendChild(tagEl);
    });
  }

  function getTagCategoryClass(tag, details) {
    if (!details) return '';
    const clean = tag.toLowerCase();
    if (details.artist && details.artist.includes(clean)) return 'tag-artist';
    if (details.character && details.character.includes(clean)) return 'tag-character';
    if (details.copyright && details.copyright.includes(clean)) return 'tag-copyright';
    if (details.meta && details.meta.includes(clean)) return 'tag-meta';
    return '';
  }

  function formatRating(r) {
    const raw = String(r || '').toLowerCase();
    const map = {
      'g': 'Safe (Безопасный 0+)',
      'general': 'Safe (Безопасный 0+)',
      'safe': 'Safe (Безопасный 0+)',
      's': 'Sensitive (Пикантный 16+)',
      'sensitive': 'Sensitive (Пикантный 16+)',
      'q': 'Questionable (Эротика 16+)',
      'questionable': 'Questionable (Эротика 16+)',
      'e': 'Explicit (Для взрослых 18+)',
      'explicit': 'Explicit (Для взрослых 18+)'
    };
    return map[raw] || 'Safe (Безопасный 0+)';
  }

  function makeBannerDraggable(bannerEl) {
    if (!bannerEl) return;
    let isDraggingBanner = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    // Восстановление ранее сохраненного положения плашки
    const applySavedPosition = () => {
      try {
        const saved = localStorage.getItem('booru_video_banner_pos');
        if (saved) {
          const pos = JSON.parse(saved);
          if (pos && typeof pos.xRatio === 'number' && typeof pos.yRatio === 'number') {
            const bannerWidth = bannerEl.offsetWidth || 280;
            const bannerHeight = bannerEl.offsetHeight || 90;
            let left = pos.xRatio * window.innerWidth;
            let top = pos.yRatio * window.innerHeight;

            const maxX = window.innerWidth - bannerWidth - 8;
            const maxY = window.innerHeight - bannerHeight - 16;
            left = Math.max(8, Math.min(left, maxX));
            top = Math.max(48, Math.min(top, maxY));

            bannerEl.style.bottom = 'auto';
            bannerEl.style.right = 'auto';
            bannerEl.style.left = `${left}px`;
            bannerEl.style.top = `${top}px`;
            bannerEl.style.transform = 'none';
          }
        }
      } catch (e) {
        console.warn('[Banner Position Load Error]', e);
      }
    };

    applySavedPosition();
    requestAnimationFrame(applySavedPosition);

    const savePosition = () => {
      try {
        const rect = bannerEl.getBoundingClientRect();
        const pos = {
          xRatio: rect.left / window.innerWidth,
          yRatio: rect.top / window.innerHeight,
          left: rect.left,
          top: rect.top
        };
        localStorage.setItem('booru_video_banner_pos', JSON.stringify(pos));
      } catch (e) {
        console.warn('[Banner Position Save Error]', e);
      }
    };

    const startDrag = (clientX, clientY, target) => {
      if (target && (target.tagName === 'BUTTON' || target.closest('button'))) {
        return false;
      }
      const rect = bannerEl.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      startX = clientX;
      startY = clientY;
      isDraggingBanner = true;

      bannerEl.style.bottom = 'auto';
      bannerEl.style.right = 'auto';
      bannerEl.style.left = `${startLeft}px`;
      bannerEl.style.top = `${startTop}px`;
      bannerEl.style.transform = 'none';
      bannerEl.classList.add('is-dragging');
      return true;
    };

    const moveDrag = (clientX, clientY, e) => {
      if (!isDraggingBanner) return;
      const dx = clientX - startX;
      const dy = clientY - startY;

      if ((Math.abs(dx) > 2 || Math.abs(dy) > 2) && e && e.cancelable) {
        e.preventDefault();
      }

      let newLeft = startLeft + dx;
      let newTop = startTop + dy;

      const bannerWidth = bannerEl.offsetWidth || 280;
      const bannerHeight = bannerEl.offsetHeight || 90;
      const maxX = window.innerWidth - bannerWidth - 8;
      const maxY = window.innerHeight - bannerHeight - 16;

      newLeft = Math.max(8, Math.min(newLeft, maxX));
      newTop = Math.max(48, Math.min(newTop, maxY));

      bannerEl.style.left = `${newLeft}px`;
      bannerEl.style.top = `${newTop}px`;
    };

    const endDrag = () => {
      if (isDraggingBanner) {
        isDraggingBanner = false;
        bannerEl.classList.remove('is-dragging');
        savePosition();
      }
    };

    bannerEl.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        if (startDrag(e.touches[0].clientX, e.touches[0].clientY, e.target)) {
          e.stopPropagation();
        }
      }
    }, { passive: false });

    bannerEl.addEventListener('touchmove', (e) => {
      if (isDraggingBanner && e.touches.length === 1) {
        moveDrag(e.touches[0].clientX, e.touches[0].clientY, e);
        e.stopPropagation();
      }
    }, { passive: false });

    bannerEl.addEventListener('touchend', (e) => {
      if (isDraggingBanner) {
        endDrag();
        e.stopPropagation();
      }
    }, { passive: true });

    bannerEl.addEventListener('mousedown', (e) => {
      if (startDrag(e.clientX, e.clientY, e.target)) {
        e.stopPropagation();
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (isDraggingBanner) {
        moveDrag(e.clientX, e.clientY, e);
      }
    });

    window.addEventListener('mouseup', () => {
      if (isDraggingBanner) {
        endDrag();
      }
    });
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
      hapticVibrate([15, 20]);
      const isLikedNow = toggleLikeLocally(currentPost);
      btnLikeModal.classList.toggle('active', isLikedNow);
      btnLikeModal.querySelector('svg').setAttribute('fill', isLikedNow ? 'currentColor' : 'none');
      showToast(isLikedNow ? 'Понравилось ❤️ (Рекомендации обучены)' : 'Лайк удален');
      try {
        await toggleLikePost(currentPost);
      } catch (e) {}
      onFavoriteToggle();
    });
  }

  btnFavModal.addEventListener('click', async () => {
    if (!currentPost) return;
    hapticVibrate([15, 25, 15]);
    try {
      const res = await toggleFavoritePost(currentPost);
      if (res.success) {
        if (res.isFavorite) {
          state.favoriteIds.add(currentPost.id);
          state.favorites.unshift(currentPost);
          btnFavModal.classList.add('active');
          btnFavModal.querySelector('svg').setAttribute('fill', 'currentColor');
          showToast('Сохранено в закладки 🔖');
        } else {
          state.favoriteIds.delete(currentPost.id);
          state.favorites = state.favorites.filter(f => f.id !== currentPost.id);
          btnFavModal.classList.remove('active');
          btnFavModal.querySelector('svg').setAttribute('fill', 'none');
          showToast('Удалено из закладок');
        }
        onFavoriteToggle();
      }
    } catch (err) {
      console.error(err);
    }
  });

  btnCopyLink.addEventListener('click', () => {
    if (!currentPost) return;
    const url = currentPost.fileUrl || currentPost.sampleUrl;
    navigator.clipboard.writeText(url).then(() => {
      showToast('Прямая ссылка скопирована 📋');
    });
  });

  // Скачивание напрямую в память мобильного устройства / браузера
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
    
    const isMyLiveDemo = typeof window !== 'undefined' && window.location.hostname === 'booru-explorer-kappa.vercel.app';
    const shouldUseProxyDownload = currentPost.site === 'danbooru' || downloadTarget.includes('donmai.us') || (!isMyLiveDemo && state.settings?.proxyDownloads !== false);
    
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

  btnCopyAllTags.addEventListener('click', () => {
    if (!currentPost || !Array.isArray(currentPost.tags)) return;
    navigator.clipboard.writeText(currentPost.tags.join(' ')).then(() => {
      showToast('Все теги поста скопированы 📋');
    });
  });

  async function handleAuthorFavToggle() {
    if (!currentPost) return;
    const rawAuthor = currentPost.author || (currentPost.tagDetails?.artist && currentPost.tagDetails.artist.length > 0 ? currentPost.tagDetails.artist.join(', ') : '');
    const authorName = typeof rawAuthor === 'string' ? rawAuthor : (rawAuthor ? String(rawAuthor) : '');
    if (!authorName || !authorName.trim()) return;

    const cleanAuthorTag = authorName.split(',')[0].trim().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_');
    hapticVibrate([15, 25, 15]);

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
      showToast('Не удалось обновить избранного автора', 'error');
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

  btnPrev.addEventListener('click', () => {
    if (state.currentViewerIndex > 0) {
      hapticVibrate(15);
      openViewer(state.currentViewerIndex - 1);
    }
  });

  btnNext.addEventListener('click', () => {
    if (state.currentViewerIndex < state.posts.length - 1) {
      hapticVibrate(15);
      openViewer(state.currentViewerIndex + 1);
    }
  });

  btnClose.addEventListener('click', closeViewer);
  backdrop.addEventListener('click', closeViewer);

  // Сенсорные жесты: свайпы, пинч-зум и тапы
  mediaWrapper.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      isPinching = true;
      isDraggingDown = false;
      initialPinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      initialZoom = zoomLevel;
    } else if (e.touches.length === 1) {
      isPinching = false;
      isDraggingDown = false;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartTime = Date.now();
      if (zoomLevel > 1) {
        isDragging = true;
        startX = touchStartX - panX;
        startY = touchStartY - panY;
      }
    }
  }, { passive: true });

  mediaWrapper.addEventListener('touchmove', (e) => {
    if (isPinching && e.touches.length === 2) {
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (initialPinchDist > 0) {
        const factor = currentDist / initialPinchDist;
        zoomLevel = Math.min(Math.max(0.8, initialZoom * factor), 4.5);
        const img = mediaWrapper.querySelector('.viewer-image');
        updateImageTransform(img);
      }
    } else if (isDragging && e.touches.length === 1 && zoomLevel > 1) {
      panX = e.touches[0].clientX - startX;
      panY = e.touches[0].clientY - startY;
      const img = mediaWrapper.querySelector('.viewer-image');
      updateImageTransform(img);
    } else if (e.touches.length === 1 && zoomLevel <= 1.05) {
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
      if (zoomLevel < 1) {
        zoomLevel = 1;
        panX = 0;
        panY = 0;
        const img = mediaWrapper.querySelector('.viewer-image');
        updateImageTransform(img);
      }
      return;
    }

    if (isDragging) {
      isDragging = false;
    }

    if (isDraggingDown) {
      isDraggingDown = false;
      const deltaY = e.changedTouches[0].clientY - touchStartY;
      if (deltaY > 90) {
        hapticVibrate(25);
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

    if (e.changedTouches.length === 1 && zoomLevel <= 1.05) {
      const deltaX = e.changedTouches[0].clientX - touchStartX;
      const deltaY = e.changedTouches[0].clientY - touchStartY;
      const deltaTime = Date.now() - touchStartTime;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      // Свайп влево / вправо (переключение)
      if (absX > 50 && absX > absY * 1.5 && deltaTime < 450) {
        if (deltaX < 0) {
          btnNext.click();
        } else {
          btnPrev.click();
        }
        return;
      }

      // Свайп вниз (закрытие)
      if (deltaY > 80 && absY > absX * 1.5 && deltaTime < 450) {
        hapticVibrate(25);
        closeViewer();
        return;
      }

      // Одиночный или двойной тап
      if (absX < 12 && absY < 12 && deltaTime < 250) {
        const now = Date.now();
        if (now - lastTapTime < 300) {
          // Двойной тап — зум 2x / сброс
          const img = mediaWrapper.querySelector('.viewer-image');
          if (img) {
            zoomLevel = zoomLevel === 1 ? 2.2 : 1;
            panX = 0;
            panY = 0;
            updateImageTransform(img);
          }
        } else {
          // Одиночный тап — переключение чистого режима (скрыть/показать элементы интерфейса)
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

  window.addEventListener('keydown', (e) => {
    if (modal.style.display !== 'flex') return;

    if (e.key === 'Escape') {
      closeViewer();
    } else if (e.key === 'ArrowLeft') {
      btnPrev.click();
    } else if (e.key === 'ArrowRight') {
      btnNext.click();
    } else if (e.key.toLowerCase() === 'f') {
      btnFavModal.click();
    } else if (e.key.toLowerCase() === 'l') {
      if (btnLikeModal) btnLikeModal.click();
    }
  });

  return {
    openViewer,
    closeViewer
  };
}
