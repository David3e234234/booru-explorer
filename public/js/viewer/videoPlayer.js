

export function makeBannerDraggable(bannerEl) {
  if (!bannerEl) return;
  let isDraggingBanner = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

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

export function createVideoPlayer(currentPost, { state, getProxiedUrl, abortRef, blobRef }) {
  const directMedia = currentPost.fileUrl || currentPost.sampleUrl;
  const proxyMedia = getProxiedUrl(directMedia);
  const transcodeMedia = `/api/transcode-video?url=${encodeURIComponent(directMedia)}`;

  const videoContainer = document.createElement('div');
  videoContainer.className = 'viewer-video-container';

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
  const switchBtn = statusBanner.querySelector('.btn-switch-source');
  
  const needsProxy = currentPost.site === 'danbooru' || currentPost.site === 'rule34video' || directMedia.includes('donmai.us') || directMedia.includes('rule34video.com') || directMedia.includes('boomio-cdn.com') || (state.settings?.proxyVideos !== false && state.settings?.proxyVideoDefault !== false);
  let currentSource = needsProxy ? 'proxy' : 'direct';
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

  const startPreCaching = async (targetUrl) => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    isPreCaching = true;
    btnCache.classList.add('active');
    btnCache.textContent = '⚡ Кэширование...';
    setProgress(0, 'Кэширование в память...', true);

    try {
      const res = await fetch(targetUrl, { signal: abortRef.current.signal });
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
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
      blobRef.current = URL.createObjectURL(blob);

      video.src = blobRef.current;
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

  const startClientRemux = async (targetUrl) => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
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
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
      blobRef.current = URL.createObjectURL(ms);
      video.src = blobRef.current;

      const mp4boxfile = window.MP4Box.createFile();
      let sourceBuffer = null;

      await new Promise((resolve, reject) => {
        ms.addEventListener('sourceopen', () => resolve(), { once: true });
        setTimeout(() => reject(new Error('MediaSource timeout')), 3000);
      });

      mp4boxfile.onReady = (info) => {
        try {
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

      mp4boxfile.onSegment = (id, user, buffer) => {
        if (sourceBuffer && !sourceBuffer.updating && ms.readyState === 'open') {
          try {
            sourceBuffer.appendBuffer(buffer);
          } catch (e) {
            console.warn('[MSE Append Warning]', e);
          }
        }
      };

      const res = await fetch(targetUrl, { signal: abortRef.current.signal });
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
      setProgress(0, 'Подключение через прокси...', true);
      video.src = proxyMedia;
      video.play().catch(() => {});
    } else if (currentSource === 'proxy') {
      startClientRemux(proxyMedia);
    } else if (currentSource === 'remux') {
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

  if (btnTranscode) {
    btnTranscode.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isPreCaching && abortRef.current) {
        abortRef.current.abort();
        isPreCaching = false;
        btnCache.classList.remove('active');
        btnCache.textContent = '⚡ Кэш в память';
      }
      startClientRemux(proxyMedia);
    });
  }

  if (switchBtn) {
    switchBtn.textContent = currentSource === 'proxy' ? '⚡ Прямой CDN' : '🛡️ Прокси';
    switchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isPreCaching && abortRef.current) {
        abortRef.current.abort();
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

  video.src = currentSource === 'proxy' ? proxyMedia : directMedia;
  videoContainer.appendChild(video);

  return {
    videoContainer,
    statusBanner,
    video,
    destroy: () => {
      clearTimeout(loadTimeout);
      if (mediaSourceInstance && mediaSourceInstance.readyState === 'open') {
        try { mediaSourceInstance.endOfStream(); } catch {}
      }
    }
  };
}
