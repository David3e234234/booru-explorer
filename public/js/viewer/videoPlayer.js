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
    if (e.touches.length === 1) {
      if (startDrag(e.touches[0].clientX, e.touches[0].clientY, e.target)) {
        e.stopPropagation();
      }
    }
  }, { passive: false });

  window.addEventListener('touchmove', (e) => {
    if (isDraggingBanner && e.touches.length === 1) {
      moveDrag(e.touches[0].clientX, e.touches[0].clientY, e);
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

  // Восстановление сохраненного уровня громкости и mute-состояния
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

  // Кнопка включения звука при ограничении браузерной Autoplay Policy
  const unmuteBtn = document.createElement('button');
  unmuteBtn.className = 'btn-video-unmute';
  unmuteBtn.style.display = 'none';
  unmuteBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
    <span>Включить звук</span>
  `;
  unmuteBtn.title = 'Включить звук (кликните для снятия ограничения браузера)';

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
        // Если браузер ограничил автоплей из-за звука (NotAllowedError)
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

      const contentType = res.headers.get('content-type') || (targetUrl.includes('.webm') ? 'video/webm' : 'video/mp4');
      const cleanMime = contentType.split(';')[0].trim();
      const blob = new Blob(chunks, { type: cleanMime });
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
      blobRef.current = URL.createObjectURL(blob);

      video.src = blobRef.current;
      safePlay();
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
      let videoSourceBuffer = null;
      let audioSourceBuffer = null;
      let videoTrackId = null;
      let audioTrackId = null;

      await new Promise((resolve, reject) => {
        ms.addEventListener('sourceopen', () => resolve(), { once: true });
        setTimeout(() => reject(new Error('MediaSource timeout')), 3500);
      });

      mp4boxfile.onReady = (info) => {
        try {
          const videoTrack = info.tracks.find(t => t.video || t.type === 'video') || info.tracks[0];
          const audioTrack = info.tracks.find(t => t.audio || t.type === 'audio');

          if (videoTrack) {
            videoTrackId = videoTrack.id;
            mp4boxfile.setSegmentOptions(videoTrack.id, null, { nbSamples: 100 });
            const codec = videoTrack.codec || 'avc1.42E01E';
            const vMime = `video/mp4; codecs="${codec}"`;
            if (MediaSource.isTypeSupported(vMime)) {
              videoSourceBuffer = ms.addSourceBuffer(vMime);
            } else {
              videoSourceBuffer = ms.addSourceBuffer('video/mp4; codecs="avc1.42E01E"');
            }
            videoSourceBuffer.mode = 'segments';
          }

          if (audioTrack) {
            audioTrackId = audioTrack.id;
            mp4boxfile.setSegmentOptions(audioTrack.id, null, { nbSamples: 100 });
            const aCodec = audioTrack.codec || 'mp4a.40.2';
            const aMime = `audio/mp4; codecs="${aCodec}"`;
            if (MediaSource.isTypeSupported(aMime)) {
              audioSourceBuffer = ms.addSourceBuffer(aMime);
            } else if (MediaSource.isTypeSupported('audio/mp4; codecs="mp4a.40.2"')) {
              audioSourceBuffer = ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
            }
            if (audioSourceBuffer) audioSourceBuffer.mode = 'segments';
          }

          const initSegs = mp4boxfile.initializeSegmentation();
          if (Array.isArray(initSegs)) {
            initSegs.forEach(seg => {
              if (seg.id === videoTrackId && videoSourceBuffer && seg.buffer) {
                try { videoSourceBuffer.appendBuffer(seg.buffer); } catch {}
              } else if (seg.id === audioTrackId && audioSourceBuffer && seg.buffer) {
                try { audioSourceBuffer.appendBuffer(seg.buffer); } catch {}
              }
            });
          }
        } catch (e) {
          console.warn('[MSE Init Warning]', e);
        }
      };

      mp4boxfile.onSegment = (id, user, buffer) => {
        if (id === videoTrackId && videoSourceBuffer && !videoSourceBuffer.updating && ms.readyState === 'open') {
          try { videoSourceBuffer.appendBuffer(buffer); } catch {}
        } else if (id === audioTrackId && audioSourceBuffer && !audioSourceBuffer.updating && ms.readyState === 'open') {
          try { audioSourceBuffer.appendBuffer(buffer); } catch {}
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
      safePlay();
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
      setProgress(0, '🔄 Аппаратный кодек не подошел. Переход на FFmpeg (H.264/AAC)...', true);
      video.src = transcodeMedia;
      safePlay();
    }
  };

  const handleVideoError = () => {
    if (isPreCaching) return;
    if (currentSource === 'direct') {
      currentSource = 'proxy';
      if (switchBtn) switchBtn.textContent = '⚡ Прямой CDN';
      setProgress(0, 'Подключение через прокси...', true);
      video.src = proxyMedia;
      safePlay();
    } else if (currentSource === 'proxy') {
      if (state.settings?.enableJsDemuxing !== false) {
        startClientRemux(proxyMedia);
      } else {
        currentSource = 'transcode';
        if (btnTranscode) {
          btnTranscode.classList.add('active');
          btnTranscode.textContent = '🔄 FFmpeg фикс';
        }
        setProgress(0, '🔄 Перекодирование через серверный FFmpeg (H.264/AAC)...', true);
        video.src = transcodeMedia;
        safePlay();
      }
    } else if (currentSource === 'remux') {
      currentSource = 'transcode';
      if (btnTranscode) {
        btnTranscode.classList.add('active');
        btnTranscode.textContent = '🔄 FFmpeg фикс';
      }
      setProgress(0, '🔄 Авто-исправление кодека через FFmpeg (H.264/AAC)...', true);
      video.src = transcodeMedia;
      safePlay();
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
      if (state.settings?.enableJsDemuxing !== false) {
        startClientRemux(proxyMedia);
      } else {
        currentSource = 'transcode';
        btnTranscode.classList.add('active');
        btnTranscode.textContent = '🔄 FFmpeg фикс';
        setProgress(0, '🔄 Перекодирование через серверный FFmpeg (H.264/AAC)...', true);
        video.src = transcodeMedia;
        safePlay();
      }
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
      safePlay();
    });
  }

  video.addEventListener('loadstart', () => {
    if (!isPreCaching) {
      const statusText = currentSource === 'transcode' 
        ? '🔄 Подготовка FFmpeg H.264/AAC видео...' 
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

  // Автоматическое разрешение полного HD видео со звуком для Rule34Video
  if (currentPost.site === 'rule34video') {
    fetch(`/api/resolve-video?url=${encodeURIComponent(currentPost.source || '')}&id=${currentPost.originalId}&site=rule34video`)
      .then(r => r.json())
      .then(data => {
        if (data && data.fullVideoUrl) {
          currentPost.fileUrl = data.fullVideoUrl;
          currentPost.hasSound = true;
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
            setProgress(100, `🎬 HD Видео (${data.quality || '1080p'}) со звуком подключено`, false);
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

  // Запуск автоплея с безопасным перехватом Autoplay Policy
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
