import { t } from '../i18n.js';

export function makeBannerDraggable(bannerEl) {
  if (!bannerEl) return;
  let isDraggingBanner = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  const getParentInfo = () => {
    const parent = bannerEl.offsetParent || bannerEl.parentElement || document.body;
    const pRect = parent.getBoundingClientRect();
    return { parent, pRect };
  };

  const applySavedPosition = () => {
    try {
      const saved = localStorage.getItem('booru_video_banner_pos');
      if (saved) {
        const pos = JSON.parse(saved);
        if (pos && typeof pos.xRatio === 'number' && typeof pos.yRatio === 'number') {
          const { parent } = getParentInfo();
          const parentWidth = parent.clientWidth || window.innerWidth;
          const parentHeight = parent.clientHeight || window.innerHeight;
          const bannerWidth = bannerEl.offsetWidth || 280;
          const bannerHeight = bannerEl.offsetHeight || 90;

          let left = pos.xRatio * parentWidth;
          let top = pos.yRatio * parentHeight;

          const maxX = Math.max(0, parentWidth - bannerWidth - 8);
          const maxY = Math.max(0, parentHeight - bannerHeight - 8);
          left = Math.max(8, Math.min(left, maxX));
          top = Math.max(8, Math.min(top, maxY));

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
      const { parent, pRect } = getParentInfo();
      const rect = bannerEl.getBoundingClientRect();
      const currentLeft = rect.left - pRect.left;
      const currentTop = rect.top - pRect.top;
      const parentWidth = parent.clientWidth || window.innerWidth;
      const parentHeight = parent.clientHeight || window.innerHeight;

      const pos = {
        xRatio: parentWidth > 0 ? currentLeft / parentWidth : 0,
        yRatio: parentHeight > 0 ? currentTop / parentHeight : 0,
        left: currentLeft,
        top: currentTop
      };
      localStorage.setItem('booru_video_banner_pos', JSON.stringify(pos));
    } catch (e) {
      console.warn('[Banner Position Save Error]', e);
    }
  };

  const startDrag = (clientX, clientY, target) => {
    if (target && (
      target.tagName === 'BUTTON' || 
      target.closest('button') || 
      target.tagName === 'INPUT' || 
      target.closest('input') || 
      target.tagName === 'A' || 
      target.closest('a')
    )) {
      return false;
    }
    const { pRect } = getParentInfo();
    const rect = bannerEl.getBoundingClientRect();
    startLeft = rect.left - pRect.left;
    startTop = rect.top - pRect.top;
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

    if (e && e.cancelable) {
      e.preventDefault();
    }

    let newLeft = startLeft + dx;
    let newTop = startTop + dy;

    const { parent } = getParentInfo();
    const parentWidth = parent.clientWidth || window.innerWidth;
    const parentHeight = parent.clientHeight || window.innerHeight;
    const bannerWidth = bannerEl.offsetWidth || 280;
    const bannerHeight = bannerEl.offsetHeight || 90;
    const maxX = Math.max(0, parentWidth - bannerWidth - 8);
    const maxY = Math.max(0, parentHeight - bannerHeight - 8);

    newLeft = Math.max(8, Math.min(newLeft, maxX));
    newTop = Math.max(8, Math.min(newTop, maxY));

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
    e.stopPropagation();
    if (e.touches.length === 1) {
      startDrag(e.touches[0].clientX, e.touches[0].clientY, e.target);
    }
  }, { passive: false });

  bannerEl.addEventListener('touchmove', (e) => {
    e.stopPropagation();
    if (isDraggingBanner && e.touches.length === 1) {
      moveDrag(e.touches[0].clientX, e.touches[0].clientY, e);
    }
  }, { passive: false });

  bannerEl.addEventListener('touchend', (e) => {
    e.stopPropagation();
    if (isDraggingBanner) {
      endDrag();
    }
  }, { passive: true });

  bannerEl.addEventListener('touchcancel', (e) => {
    e.stopPropagation();
    if (isDraggingBanner) {
      endDrag();
    }
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (isDraggingBanner && e.touches.length === 1) {
      moveDrag(e.touches[0].clientX, e.touches[0].clientY, e);
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
    }
  }, { passive: false });

  window.addEventListener('touchend', () => {
    if (isDraggingBanner) {
      endDrag();
    }
  }, { passive: true });

  window.addEventListener('touchcancel', () => {
    if (isDraggingBanner) {
      endDrag();
    }
  }, { passive: true });

  bannerEl.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    startDrag(e.clientX, e.clientY, e.target);
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
  let directMedia = currentPost.fileUrl || currentPost.sampleUrl;
  let proxyMedia = getProxiedUrl(directMedia);
  let transcodeMedia = `/api/transcode-video?url=${encodeURIComponent(directMedia)}`;

  // Rule34Video links are one-time use: after a token refresh, rebuild every source variant
  const rebuildMediaUrls = () => {
    directMedia = currentPost.fileUrl || currentPost.sampleUrl;
    proxyMedia = getProxiedUrl(directMedia);
    transcodeMedia = `/api/transcode-video?url=${encodeURIComponent(directMedia)}`;
  };

  const videoContainer = document.createElement('div');
  videoContainer.className = 'viewer-video-container';

  const statusBanner = document.createElement('div');
  statusBanner.className = 'video-status-banner';
  statusBanner.innerHTML = `
    <div class="video-status-drag-handle" title="${t('vp.dragHandle.title', 'Потяните, чтобы переместить')}"></div>
    <div class="video-status-top-row">
      <div class="video-status-left">
        <div class="video-status-spinner"></div>
        <span class="video-status-text">${t('vp.initStream', 'Инициализация видеопотока...')}</span>
      </div>
      <span class="video-progress-percent">0%</span>
    </div>
    <div class="video-progress-track">
      <div class="video-progress-fill" style="width: 0%;"></div>
    </div>
    <div class="video-status-actions">
      <button class="btn-cache-toggle" title="${t('vp.cacheBtn.title', 'Полностью закэшировать видео в память для просмотра без лагов')}">${t('vp.cacheBtn', 'Кэш в память')}</button>
      <button class="btn-transcode" title="${t('vp.transcodeBtn.title', 'Перекодировать видео в совместимый браузерный формат H.264/AAC через FFmpeg')}">${t('vp.transcodeBtn', 'FFmpeg фикс')}</button>
      <button class="btn-switch-source" title="${t('vp.switchSourceBtn.title', 'Переключить между прямым источником и прокси')}">${t('vp.proxyBtn', 'Прокси')}</button>
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

  // Restore the saved volume level and mute state
  try {
    const savedVolume = parseFloat(localStorage.getItem('booru_video_volume') ?? '1');
    const savedMuted = localStorage.getItem('booru_video_muted') === 'true';
    video.volume = isNaN(savedVolume) ? 1 : Math.max(0, Math.min(1, savedVolume));
    video.muted = savedMuted;
  } catch {}

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

  // Unmute button for when the browser's Autoplay Policy blocks sound
  const unmuteBtn = document.createElement('button');
  unmuteBtn.className = 'btn-video-unmute';
  unmuteBtn.style.display = 'none';
  unmuteBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
    <span>${t('vp.unmute', 'Включить звук')}</span>
  `;
  unmuteBtn.title = t('vp.unmute.title', 'Включить звук (кликните для снятия ограничения браузера)');

  unmuteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    video.muted = false;
    if (video.volume === 0) video.volume = 1;
    video.play().catch(() => {});
    unmuteBtn.style.display = 'none';
  });

  video.addEventListener('volumechange', () => {
    try {
      localStorage.setItem('booru_video_volume', String(video.volume));
      localStorage.setItem('booru_video_muted', String(video.muted));
      if (!video.muted && video.volume > 0) {
        unmuteBtn.style.display = 'none';
      }
    } catch {}
  });

  const safePlay = () => {
    if (!shouldAutoplay) return;
    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        // Browser blocked autoplay with sound (NotAllowedError)
        if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
          console.warn('[Video Autoplay] Автоплей со звуком ограничен браузером, переход на muted fallback');
          video.muted = true;
          video.play().catch(() => {});
          if (currentPost.hasSound !== false) {
            unmuteBtn.style.display = 'inline-flex';
          }
        }
      });
    }
  };

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
    btnCache.textContent = t('vp.caching', 'Кэширование...');
    setProgress(0, t('vp.cachingToMemory', 'Кэширование в память...'), true);

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
        setProgress(pct, t('vp.cachingProgress', 'Кэширование: {d}').replace('{d}', `${mbText}${totalMbText}`), true);
      }

      const contentType = res.headers.get('content-type') || (targetUrl.includes('.webm') ? 'video/webm' : 'video/mp4');
      const cleanMime = contentType.split(';')[0].trim();
      const blob = new Blob(chunks, { type: cleanMime });
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
      blobRef.current = URL.createObjectURL(blob);

      video.src = blobRef.current;
      safePlay();
      setProgress(100, t('vp.cachedInMemory', 'Закэшировано в память!'), false);
      btnCache.textContent = t('vp.inMemoryOk', 'В памяти (OK)');
      setTimeout(hideStatus, 1200);
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.warn('[PreCache Error]', err);
      btnCache.classList.remove('active');
      btnCache.textContent = t('vp.cacheBtn', 'Кэш в память');
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
  let reresolvedOnce = false;
  let lastFallbackTime = 0;

  const switchToTranscode = (message) => {
    currentSource = 'transcode';
    if (btnTranscode) {
      btnTranscode.classList.add('active');
      btnTranscode.textContent = t('vp.transcodeBtn', 'FFmpeg фикс');
    }
    setProgress(0, message, true);
    video.src = transcodeMedia;
    safePlay();
  };

  const startClientRemux = async (targetUrl) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    isPreCaching = true;
    currentSource = 'remux';
    if (btnTranscode) {
      btnTranscode.classList.add('active');
      btnTranscode.textContent = t('vp.jsRemuxing', 'JS Ремукс...');
    }
    setProgress(0, t('vp.jsDemuxing', 'Клиентский JS-демуксинг (MSE)...'), true);

    let internalAbortReason = null;
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

      // Per-track segment queue: appendBuffer can't be called while the SourceBuffer
      // is still busy with the previous one. Previously such segments were dropped and broke the stream
      const trackPipes = [];
      const pumpTrack = (id) => {
        const pipe = trackPipes.find(p => p.id === id);
        if (!pipe || pipe.sourceBuffer.updating || ms.readyState !== 'open') return;
        const buffer = pipe.queue.shift();
        if (!buffer) return;
        try { pipe.sourceBuffer.appendBuffer(buffer); } catch {}
      };
      const pumpAll = () => trackPipes.forEach(p => pumpTrack(p.id));
      const enqueueSegment = (id, buffer) => {
        if (!buffer || ms.readyState !== 'open') return;
        const pipe = trackPipes.find(p => p.id === id);
        if (!pipe) return;
        pipe.queue.push(buffer);
        pumpTrack(id);
      };

      await new Promise((resolve, reject) => {
        ms.addEventListener('sourceopen', () => resolve(), { once: true });
        setTimeout(() => reject(new Error('MediaSource timeout')), 3500);
      });

      let readySettled = false;
      mp4boxfile.onReady = (info) => {
        readySettled = true;
        try {
          const videoTrack = info.tracks.find(t => t.video || t.type === 'video') || info.tracks[0];
          const audioTrack = info.tracks.find(t => t.audio || t.type === 'audio');

          const registerPipe = (trackId, sourceBuffer) => {
            sourceBuffer.mode = 'segments';
            trackPipes.push({ id: trackId, sourceBuffer, queue: [] });
            sourceBuffer.addEventListener('updateend', pumpAll);
          };

          if (videoTrack) {
            mp4boxfile.setSegmentOptions(videoTrack.id, null, { nbSamples: 100 });
            const codec = videoTrack.codec || 'avc1.42E01E';
            const vMime = `video/mp4; codecs="${codec}"`;
            const sb = MediaSource.isTypeSupported(vMime)
              ? ms.addSourceBuffer(vMime)
              : ms.addSourceBuffer('video/mp4; codecs="avc1.42E01E"');
            registerPipe(videoTrack.id, sb);
          }

          if (audioTrack) {
            mp4boxfile.setSegmentOptions(audioTrack.id, null, { nbSamples: 100 });
            const aCodec = audioTrack.codec || 'mp4a.40.2';
            const aMime = `audio/mp4; codecs="${aCodec}"`;
            if (MediaSource.isTypeSupported(aMime)) {
              registerPipe(audioTrack.id, ms.addSourceBuffer(aMime));
            } else if (MediaSource.isTypeSupported('audio/mp4; codecs="mp4a.40.2"')) {
              registerPipe(audioTrack.id, ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"'));
            }
          }

          const initSegs = mp4boxfile.initializeSegmentation();
          if (Array.isArray(initSegs)) {
            initSegs.forEach(seg => enqueueSegment(seg.id, seg.buffer));
          }
        } catch (e) {
          console.warn('[MSE Init Warning]', e);
        }
      };

      mp4boxfile.onSegment = (id, user, buffer) => enqueueSegment(id, buffer);

      // If the MP4 structure wasn't recognized (e.g. an HTML response arrived), don't hang forever
      const readyWatchdog = setTimeout(() => {
        if (!readySettled) {
          console.warn('[Client Remux] MP4-метаданные не распознаны, отмена');
          internalAbortReason = new Error('MP4-метаданные не распознаны');
          try { controller.abort(); } catch {}
        }
      }, 12000);

      const res = await fetch(targetUrl, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const resType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (resType.includes('text/html') || resType.includes('application/json') || resType.includes('text/plain')) {
        throw new Error(`Источник вернул ${resType} вместо видео`);
      }
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
        setProgress(pct, t('vp.jsRemuxProgress', 'JS Ремукс: {d} MB').replace('{d}', (loaded / (1024 * 1024)).toFixed(1)), true);
      }

      if (total > 0 && loaded < total * 0.98) {
        throw new Error(`Поток оборвался: получено ${(loaded / 1048576).toFixed(1)} из ${(total / 1048576).toFixed(1)} MB`);
      }
      if (!readySettled) {
        throw new Error('MP4-метаданные не распознаны');
      }

      isPreCaching = false;
      if (btnTranscode) {
        btnTranscode.textContent = t('vp.jsRemuxOk', 'JS Ремукс (OK)');
      }
      setProgress(100, t('vp.jsRemuxDone', 'JS Ремукс готов'), false);
      safePlay();
      setTimeout(hideStatus, 1200);
    } catch (err) {
      // User-initiated aborts or source switches must not fall through to FFmpeg
      if (err.name === 'AbortError' && !internalAbortReason) return;
      clearTimeout(loadTimeout);
      console.warn('[Client Remux Error]', err);
      isPreCaching = false;
      switchToTranscode(t('vp.hwCodecFailed', 'Аппаратный кодек не подошел. Переход на FFmpeg (H.264/AAC)...'));
    }
  };

  const startRemuxOrTranscodeFallback = () => {
    if (state.settings?.enableJsDemuxing !== false) {
      startClientRemux(proxyMedia);
    } else {
      switchToTranscode(t('vp.transcodingFfmpeg', 'Перекодирование через серверный FFmpeg (H.264/AAC)...'));
    }
  };

  const handleProxySourceFailure = () => {
    // Rule34Video links are one-shot: try a fresh token before remuxing
    if (currentPost.site === 'rule34video' && !reresolvedOnce) {
      reresolvedOnce = true;
      setProgress(0, t('vp.linkExpired', 'Ссылка источника устарела, обновляем...'), true);
      fetch(`/api/resolve-video?url=${encodeURIComponent(currentPost.source || '')}&id=${currentPost.originalId}&site=rule34video`)
        .then(r => r.json())
        .then(data => {
          if (data && data.fullVideoUrl) {
            currentPost.fileUrl = data.fullVideoUrl;
            currentPost.hasSound = true;
            rebuildMediaUrls();
            setProgress(0, t('vp.reconnectingProxy', 'Повторное подключение через прокси...'), true);
            video.src = proxyMedia;
            safePlay();
          } else {
            startRemuxOrTranscodeFallback();
          }
        })
        .catch(() => startRemuxOrTranscodeFallback());
      return;
    }
    startRemuxOrTranscodeFallback();
  };

  const handleVideoError = () => {
    if (isPreCaching) return;
    // Errors arrive in bursts per single switch: debounce so we don't hammer the source
    const now = Date.now();
    if (now - lastFallbackTime < 1200) return;
    lastFallbackTime = now;

    if (currentSource === 'direct') {
      currentSource = 'proxy';
      if (switchBtn) switchBtn.textContent = t('vp.directCdn', 'Прямой CDN');
      setProgress(0, t('vp.connectingProxy', 'Подключение через прокси...'), true);
      video.src = proxyMedia;
      safePlay();
    } else if (currentSource === 'proxy') {
      handleProxySourceFailure();
    } else if (currentSource === 'remux') {
      switchToTranscode(t('vp.autoFixFfmpeg', 'Авто-исправление кодека через FFmpeg (H.264/AAC)...'));
    } else {
      setProgress(0, t('vp.playbackFailed', 'Не удалось воспроизвести видео (ошибка исходного файла)'), false, true);
    }
  };

  if (btnTranscode) {
    btnTranscode.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isPreCaching && abortRef.current) {
        abortRef.current.abort();
        isPreCaching = false;
        btnCache.classList.remove('active');
        btnCache.textContent = t('vp.cacheBtn', 'Кэш в память');
      }
      if (state.settings?.enableJsDemuxing !== false) {
        startClientRemux(proxyMedia);
      } else {
        switchToTranscode(t('vp.transcodingFfmpeg', 'Перекодирование через серверный FFmpeg (H.264/AAC)...'));
      }
    });
  }

  if (switchBtn) {
    switchBtn.textContent = currentSource === 'proxy' ? t('vp.directCdn', 'Прямой CDN') : t('vp.proxyBtn', 'Прокси');
    switchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isPreCaching && abortRef.current) {
        abortRef.current.abort();
        isPreCaching = false;
        btnCache.classList.remove('active');
        btnCache.textContent = t('vp.cacheBtn', 'Кэш в память');
      }
      if (btnTranscode) btnTranscode.classList.remove('active');

      if (currentSource === 'direct') {
        currentSource = 'proxy';
        switchBtn.textContent = t('vp.directCdn', 'Прямой CDN');
        setProgress(0, t('vp.loadingViaServer', 'Загрузка через локальный сервер...'), true);
        video.src = proxyMedia;
      } else {
        currentSource = 'direct';
        switchBtn.textContent = t('vp.proxyBtn', 'Прокси');
        setProgress(0, t('vp.loadingDirectCdn', 'Загрузка напрямую с CDN...'), true);
        video.src = directMedia;
      }
      safePlay();
    });
  }

  video.addEventListener('loadstart', () => {
    if (!isPreCaching) {
      const statusText = currentSource === 'transcode' 
        ? t('vp.preparingFfmpeg', 'Подготовка FFmpeg H.264/AAC видео...') 
        : (currentSource === 'proxy' ? t('vp.connectingLocalProxy', 'Подключение через локальный прокси...') : t('vp.initCdnStream', 'Инициализация видеопотока CDN...'));
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
      setProgress(pct, t('vp.buffering', 'Буферизация...'), true);
      if (pct >= 99) {
        setTimeout(hideStatus, 800);
      }
    }
  });

  video.addEventListener('waiting', () => {
    if (!isPreCaching) {
      setProgress(null, t('vp.bufferingVideo', 'Буферизация видео...'), true);
    }
  });

  video.addEventListener('loadedmetadata', () => {
    if (video.duration && !isNaN(video.duration)) {
      currentPost.duration = video.duration;
      const mins = Math.floor(video.duration / 60);
      const secs = Math.floor(video.duration % 60);
      currentPost.durationText = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

      const infoDuration = document.getElementById('infoDuration');
      const infoDurationRow = document.getElementById('infoDurationRow');
      if (infoDuration) infoDuration.textContent = currentPost.durationText;
      if (infoDurationRow) infoDurationRow.style.display = 'flex';
    }
  });

  // Automatically resolve full HD video with sound for Rule34Video
  if (currentPost.site === 'rule34video') {
    fetch(`/api/resolve-video?url=${encodeURIComponent(currentPost.source || '')}&id=${currentPost.originalId}&site=rule34video`)
      .then(r => r.json())
      .then(data => {
        if (data && data.fullVideoUrl) {
          currentPost.fileUrl = data.fullVideoUrl;
          currentPost.hasSound = true;
          rebuildMediaUrls();
          const fullDirect = data.fullVideoUrl;
          const fullProxy = getProxiedUrl(fullDirect);
          const targetUrl = (currentSource === 'proxy' || needsProxy) ? fullProxy : fullDirect;

          let currentTarget = '';
          try {
            const parsed = new URL(video.src, window.location.href);
            currentTarget = parsed.pathname + parsed.search;
          } catch {}
          let nextTarget = '';
          try {
            const parsed = new URL(targetUrl, window.location.href);
            nextTarget = parsed.pathname + parsed.search;
          } catch {}

          if (currentTarget !== nextTarget && !isPreCaching) {
            const curTime = video.currentTime || 0;
            const isPaused = video.paused;
            video.src = targetUrl;
            video.addEventListener('loadedmetadata', () => {
              if (curTime > 0 && curTime < video.duration) {
                try { video.currentTime = curTime; } catch {}
              }
              if (!isPaused) safePlay();
            }, { once: true });
            safePlay();
            setProgress(100, t('vp.hdConnected', 'HD Видео ({q}) со звуком подключено').replace('{q}', data.quality || '1080p'), false);
            setTimeout(hideStatus, 1500);
          }
        }
      })
      .catch(() => {});
  }

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
  videoContainer.appendChild(unmuteBtn);

  // Start autoplay with safe Autoplay Policy handling
  safePlay();

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
