import { t } from '../i18n.js';
import { shouldProxyMedia } from '../api.js';
import { showToast, escapeHtml, toSafeHttpUrl, getPostSiteUrl, isFullMediaPending, isRule34VideoTeaserUrl } from '../modules/uiUtils.js';
import { resolveRule34VideoMedia } from '../modules/rule34VideoResolve.js';
import { isHevcSource, browserSupportsHevc } from '../modules/hevcCodec.js';

export function makeBannerDraggable(bannerEl) {
  if (!bannerEl) return;
  // Kept for backward compatibility
  bannerEl._destroyDrag = () => {};
}

let mp4BoxLoader = null;

function ensureMp4Box() {
  if (window.MP4Box) return Promise.resolve(window.MP4Box);
  if (mp4BoxLoader) return mp4BoxLoader;
  mp4BoxLoader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/js/mp4box.all.min.js';
    script.onload = () => window.MP4Box ? resolve(window.MP4Box) : reject(new Error('MP4Box load failed'));
    script.onerror = () => reject(new Error('MP4Box load failed'));
    document.head.appendChild(script);
  });
  return mp4BoxLoader;
}

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0 || !isFinite(seconds)) return '0:00';
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const remM = m % 60;
  const remS = s % 60;
  const secStr = remS < 10 ? `0${remS}` : `${remS}`;
  if (h > 0) {
    const minStr = remM < 10 ? `0${remM}` : `${remM}`;
    return `${h}:${minStr}:${secStr}`;
  }
  return `${remM}:${secStr}`;
}

export function createVideoPlayer(currentPost, { state, getProxiedUrl, abortRef, blobRef, resolvedVideoPromise = null }) {
  const defaultPrefQuality = state.settings?.videoDefaultQuality || 'original';
  let activeQuality = defaultPrefQuality; // 'original', '720p', '480p'

  const getBaseOriginal = () => currentPost.fileUrl || currentPost.sampleUrl || '';

  const isCurrentHevc = () => isHevcSource(getBaseOriginal()) && !browserSupportsHevc();
  let hevcTranscodeTried = false;

  const getMediaUrlForQuality = (qualityKey) => {
    const originalUrl = getBaseOriginal();

    if (Array.isArray(currentPost.videoQualities) && currentPost.videoQualities.length > 0) {
      const match = currentPost.videoQualities.find(q => q.quality === qualityKey);
      if (match?.url) return { url: match.url, isTranscode: false, label: match.label || match.quality };
    }

    if (isCurrentHevc() && qualityKey === 'original' && originalUrl && !originalUrl.startsWith('/api/transcode-video')) {
      const transcodeUrl = `/api/transcode-video?url=${encodeURIComponent(originalUrl)}&quality=720p`;
      return { url: transcodeUrl, isTranscode: true, label: '720p (H.264)' };
    }

    if ((qualityKey === '480p' || qualityKey === '720p') && originalUrl && !originalUrl.startsWith('/api/transcode-video')) {
      const transcodeUrl = `/api/transcode-video?url=${encodeURIComponent(originalUrl)}&quality=${qualityKey}`;
      return { url: transcodeUrl, isTranscode: true, label: qualityKey };
    }

    return { url: originalUrl, isTranscode: false, label: currentPost.quality || 'Оригинал' };
  };

  let activeMediaInfo = getMediaUrlForQuality(activeQuality);
  let directMedia = activeMediaInfo.url;
  let proxyMedia = activeMediaInfo.isTranscode ? directMedia : getProxiedUrl(directMedia);

  const rebuildMediaUrls = () => {
    activeMediaInfo = getMediaUrlForQuality(activeQuality);
    directMedia = activeMediaInfo.url;
    proxyMedia = activeMediaInfo.isTranscode ? directMedia : getProxiedUrl(directMedia);
  };

  const teaserUrl = currentPost.teaserUrl || (isRule34VideoTeaserUrl(directMedia) ? directMedia : '');
  let fullMediaPending = isFullMediaPending(currentPost);
  let playingTeaser = false;
  let playerDestroyed = false;
  let resolveWatchdog = null;
  let idleTimer = null;
  let isSettingsMenuOpen = false;
  let isScrubbing = false;
  let singleClickTimeout = null;
  let isCachedInMemory = false;

  // Root container
  const videoContainer = document.createElement('div');
  videoContainer.className = 'viewer-video-container';

  // Dummy status banner so callers (e.g. index.js) appending statusBanner won't fail
  const statusBanner = document.createElement('div');
  statusBanner.className = 'video-status-banner';
  statusBanner.style.display = 'none';

  // Native HTML5 video element with custom YouTube overlay
  const shouldAutoplay = state.settings?.videoAutoplayViewer !== false;
  const video = document.createElement('video');
  video.className = 'viewer-video';
  video.referrerPolicy = 'no-referrer';
  video.controls = false; // YouTube player controls replace default browser controls
  video.autoplay = shouldAutoplay;
  video.loop = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.preload = shouldAutoplay ? 'auto' : 'metadata';

  // Restore volume and mute state
  try {
    const savedVolume = parseFloat(localStorage.getItem('booru_video_volume') ?? '1');
    const savedMuted = localStorage.getItem('booru_video_muted') === 'true';
    video.volume = isNaN(savedVolume) ? 1 : Math.max(0, Math.min(1, savedVolume));
    video.muted = savedMuted;
  } catch {}

  const posterQuality = state.settings?.previewQuality || 'high';
  const videoTarget = currentPost.fileUrl || currentPost.sampleUrl || '';
  const stillPoster = (fullMediaPending && currentPost.previewUrl && !isRule34VideoTeaserUrl(currentPost.previewUrl))
    ? currentPost.previewUrl
    : '';
  if (stillPoster) {
    video.poster = stillPoster;
  } else if (posterQuality === 'high' || posterQuality === 'original') {
    video.poster = videoTarget ? `/api/video-thumbnail?url=${encodeURIComponent(videoTarget)}&quality=${posterQuality}` : (currentPost.previewUrl || '');
  } else if (currentPost.previewUrl) {
    video.poster = currentPost.previewUrl;
  }

  if (currentPost.width && currentPost.height) {
    video.style.aspectRatio = `${currentPost.width} / ${currentPost.height}`;
  }

  // Center loading spinner
  const ytCenterSpinner = document.createElement('div');
  ytCenterSpinner.className = 'yt-center-spinner';

  // Center action pulse ripple (play / pause animation on video click)
  const ytCenterAction = document.createElement('div');
  ytCenterAction.className = 'yt-center-action';

  let rippleTimeout = null;
  const triggerCenterRipple = (isPlaying) => {
    ytCenterAction.innerHTML = isPlaying
      ? `<svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`
      : `<svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
    ytCenterAction.classList.remove('pulse');
    void ytCenterAction.offsetWidth; // force reflow
    ytCenterAction.classList.add('pulse');
    clearTimeout(rippleTimeout);
    rippleTimeout = setTimeout(() => {
      ytCenterAction.classList.remove('pulse');
    }, 400);
  };

  // Unmute button for autoplay blocked by browser policy
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

  const safePlay = () => {
    if (!shouldAutoplay) return;
    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
          video.muted = true;
          video.play().catch(() => {});
          if (currentPost.hasSound !== false) {
            unmuteBtn.style.display = 'inline-flex';
          }
        }
      });
    }
  };

  // ═══════════════════════════════════════════════════════════
  // YouTube Controls Layout & Construction
  // ═══════════════════════════════════════════════════════════
  const ytControlsWrapper = document.createElement('div');
  ytControlsWrapper.className = 'yt-controls-wrapper';

  const ytScrim = document.createElement('div');
  ytScrim.className = 'yt-controls-scrim';
  ytControlsWrapper.appendChild(ytScrim);

  // Timeline / Scrubber
  const ytProgressBarContainer = document.createElement('div');
  ytProgressBarContainer.className = 'yt-progress-bar-container';

  const ytProgressTrack = document.createElement('div');
  ytProgressTrack.className = 'yt-progress-track';

  const ytProgressBuffer = document.createElement('div');
  ytProgressBuffer.className = 'yt-progress-buffer';

  const ytProgressPlayed = document.createElement('div');
  ytProgressPlayed.className = 'yt-progress-played';

  const ytProgressScrubberHandle = document.createElement('div');
  ytProgressScrubberHandle.className = 'yt-progress-scrubber-handle';
  ytProgressPlayed.appendChild(ytProgressScrubberHandle);

  const ytProgressHoverLine = document.createElement('div');
  ytProgressHoverLine.className = 'yt-progress-hover-line';

  ytProgressTrack.appendChild(ytProgressBuffer);
  ytProgressTrack.appendChild(ytProgressPlayed);
  ytProgressTrack.appendChild(ytProgressHoverLine);

  const ytProgressTooltip = document.createElement('div');
  ytProgressTooltip.className = 'yt-progress-tooltip';
  ytProgressTooltip.textContent = '0:00';

  ytProgressBarContainer.appendChild(ytProgressTrack);
  ytProgressBarContainer.appendChild(ytProgressTooltip);
  ytControlsWrapper.appendChild(ytProgressBarContainer);

  // Controls Row (Left & Right)
  const ytControlsRow = document.createElement('div');
  ytControlsRow.className = 'yt-controls-row';

  // Left Controls: Play/Pause, Volume + Slider, Time Display, Status Badge
  const ytControlsLeft = document.createElement('div');
  ytControlsLeft.className = 'yt-controls-left';

  const ytBtnPlay = document.createElement('button');
  ytBtnPlay.className = 'yt-btn yt-btn-play';
  ytBtnPlay.type = 'button';
  ytBtnPlay.title = `${t('vp.play', 'Воспроизвести')} (k / space)`;
  ytBtnPlay.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;

  const ytVolumeArea = document.createElement('div');
  ytVolumeArea.className = 'yt-volume-area';

  const ytBtnVolume = document.createElement('button');
  ytBtnVolume.className = 'yt-btn yt-btn-volume';
  ytBtnVolume.type = 'button';
  ytBtnVolume.title = `${t('vp.mute', 'Отключить звук')} (m)`;
  ytBtnVolume.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;

  const ytVolumeSliderContainer = document.createElement('div');
  ytVolumeSliderContainer.className = 'yt-volume-slider-container';

  const ytVolumeSlider = document.createElement('input');
  ytVolumeSlider.type = 'range';
  ytVolumeSlider.className = 'yt-volume-slider';
  ytVolumeSlider.min = '0';
  ytVolumeSlider.max = '1';
  ytVolumeSlider.step = '0.05';
  ytVolumeSlider.value = video.muted ? '0' : String(video.volume);
  ytVolumeSlider.title = t('vp.volume', 'Громкость');

  ytVolumeSliderContainer.appendChild(ytVolumeSlider);
  ytVolumeArea.appendChild(ytBtnVolume);
  ytVolumeArea.appendChild(ytVolumeSliderContainer);

  const ytTimeDisplay = document.createElement('div');
  ytTimeDisplay.className = 'yt-time-display';
  ytTimeDisplay.innerHTML = `
    <span class="yt-time-current">0:00</span>
    <span class="yt-time-separator">/</span>
    <span class="yt-time-duration">0:00</span>
  `;

  const ytTimeCurrent = ytTimeDisplay.querySelector('.yt-time-current');
  const ytTimeDuration = ytTimeDisplay.querySelector('.yt-time-duration');

  const ytStatusBadge = document.createElement('div');
  ytStatusBadge.className = 'yt-status-badge';
  ytStatusBadge.style.display = 'none';
  ytStatusBadge.innerHTML = `
    <span class="yt-status-spinner"></span>
    <span class="yt-status-text">...</span>
  `;
  const ytStatusSpinner = ytStatusBadge.querySelector('.yt-status-spinner');
  const ytStatusText = ytStatusBadge.querySelector('.yt-status-text');

  ytControlsLeft.appendChild(ytBtnPlay);
  ytControlsLeft.appendChild(ytVolumeArea);
  ytControlsLeft.appendChild(ytTimeDisplay);
  ytControlsLeft.appendChild(ytStatusBadge);

  // Right Controls: HD Badge, Settings Gear, PiP, Fullscreen
  const ytControlsRight = document.createElement('div');
  ytControlsRight.className = 'yt-controls-right';

  const ytSettingsAnchor = document.createElement('div');
  ytSettingsAnchor.className = 'yt-settings-anchor';

  const ytBtnSettings = document.createElement('button');
  ytBtnSettings.className = 'yt-btn yt-btn-settings';
  ytBtnSettings.type = 'button';
  ytBtnSettings.title = t('vp.settings', 'Настройки');
  ytBtnSettings.innerHTML = `
    <span class="yt-hd-badge" style="display: none;">HD</span>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"/>
    </svg>
  `;

  const ytHdBadge = ytBtnSettings.querySelector('.yt-hd-badge');

  const ytSettingsMenu = document.createElement('div');
  ytSettingsMenu.className = 'yt-settings-menu';
  ytSettingsMenu.style.display = 'none';

  ytSettingsAnchor.appendChild(ytBtnSettings);
  ytSettingsAnchor.appendChild(ytSettingsMenu);

  const ytBtnPip = document.createElement('button');
  ytBtnPip.className = 'yt-btn yt-btn-pip';
  ytBtnPip.type = 'button';
  ytBtnPip.title = t('vp.pipBtn.title', 'Картинка в картинке');
  ytBtnPip.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z"/>
    </svg>
  `;
  if (!document.pictureInPictureEnabled) {
    ytBtnPip.style.display = 'none';
  }

  const ytBtnFullscreen = document.createElement('button');
  ytBtnFullscreen.className = 'yt-btn yt-btn-fullscreen';
  ytBtnFullscreen.type = 'button';
  ytBtnFullscreen.title = `${t('vp.fullscreen', 'Во весь экран')} (f)`;
  ytBtnFullscreen.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
    </svg>
  `;

  ytControlsRight.appendChild(ytSettingsAnchor);
  ytControlsRight.appendChild(ytBtnPip);
  ytControlsRight.appendChild(ytBtnFullscreen);

  ytControlsRow.appendChild(ytControlsLeft);
  ytControlsRow.appendChild(ytControlsRight);
  ytControlsWrapper.appendChild(ytControlsRow);

  // ═══════════════════════════════════════════════════════════
  // Autohide & Inactivity Timer
  // ═══════════════════════════════════════════════════════════
  const wakeControls = () => {
    videoContainer.classList.remove('hide-cursor');
    ytControlsWrapper.classList.add('visible');
    clearTimeout(idleTimer);
    if (!video.paused && !isSettingsMenuOpen && !isScrubbing) {
      idleTimer = setTimeout(() => {
        if (!video.paused && !isSettingsMenuOpen && !isScrubbing) {
          videoContainer.classList.add('hide-cursor');
          ytControlsWrapper.classList.remove('visible');
        }
      }, 2500);
    }
  };

  videoContainer.addEventListener('mousemove', wakeControls);
  videoContainer.addEventListener('touchstart', wakeControls, { passive: true });

  // ═══════════════════════════════════════════════════════════
  // Play / Pause Logic
  // ═══════════════════════════════════════════════════════════
  const updatePlayButtonUI = () => {
    const isPaused = video.paused;
    videoContainer.classList.toggle('is-paused', isPaused);
    if (isPaused) {
      ytBtnPlay.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
      ytBtnPlay.title = `${t('vp.play', 'Воспроизвести')} (k / space)`;
      wakeControls();
    } else {
      ytBtnPlay.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
      ytBtnPlay.title = `${t('vp.pause', 'Пауза')} (k / space)`;
      wakeControls();
    }
  };

  const togglePlayPause = () => {
    if (video.paused) {
      video.play().catch(() => {});
      triggerCenterRipple(true);
    } else {
      video.pause();
      triggerCenterRipple(false);
    }
    updatePlayButtonUI();
  };

  ytBtnPlay.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePlayPause();
  });

  video.addEventListener('play', updatePlayButtonUI);
  video.addEventListener('pause', updatePlayButtonUI);

  // Video click (single click = play/pause, double click = fullscreen)
  video.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isSettingsMenuOpen) {
      closeSettingsMenu();
      return;
    }
    if (singleClickTimeout !== null) {
      clearTimeout(singleClickTimeout);
      singleClickTimeout = null;
      toggleFullscreen();
      return;
    }
    singleClickTimeout = setTimeout(() => {
      singleClickTimeout = null;
      togglePlayPause();
    }, 240);
  });

  // ═══════════════════════════════════════════════════════════
  // Volume & Mute UI Logic
  // ═══════════════════════════════════════════════════════════
  const updateVolumeUI = () => {
    const isMuted = video.muted || video.volume === 0;
    ytVolumeSlider.value = isMuted ? '0' : String(video.volume);

    if (isMuted) {
      ytBtnVolume.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`;
      ytBtnVolume.title = `${t('vp.unmute', 'Включить звук')} (m)`;
    } else if (video.volume > 0.5) {
      ytBtnVolume.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
      ytBtnVolume.title = `${t('vp.mute', 'Отключить звук')} (m)`;
    } else {
      ytBtnVolume.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z"/></svg>`;
      ytBtnVolume.title = `${t('vp.mute', 'Отключить звук')} (m)`;
    }

    try {
      localStorage.setItem('booru_video_volume', String(video.volume));
      localStorage.setItem('booru_video_muted', String(video.muted));
    } catch {}
  };

  ytBtnVolume.addEventListener('click', (e) => {
    e.stopPropagation();
    if (video.muted) {
      video.muted = false;
      if (video.volume === 0) video.volume = 1;
    } else {
      video.muted = true;
    }
    updateVolumeUI();
  });

  ytVolumeSlider.addEventListener('input', (e) => {
    e.stopPropagation();
    const val = parseFloat(ytVolumeSlider.value);
    video.volume = val;
    video.muted = val === 0;
    updateVolumeUI();
  });

  video.addEventListener('volumechange', () => {
    updateVolumeUI();
    if (!video.muted && video.volume > 0) {
      unmuteBtn.style.display = 'none';
    }
  });

  updateVolumeUI();

  // ═══════════════════════════════════════════════════════════
  // Progress Bar & Scrubbing
  // ═══════════════════════════════════════════════════════════
  const updateProgressUI = () => {
    if (isScrubbing) return;
    const dur = video.duration;
    const cur = video.currentTime;
    if (dur > 0 && !isNaN(dur)) {
      const pct = Math.min(100, Math.max(0, (cur / dur) * 100));
      ytProgressPlayed.style.width = `${pct}%`;
      ytTimeCurrent.textContent = formatTime(cur);
      ytTimeDuration.textContent = formatTime(dur);
    } else {
      ytProgressPlayed.style.width = '0%';
      ytTimeCurrent.textContent = formatTime(cur);
      ytTimeDuration.textContent = currentPost.durationText || '0:00';
    }
  };

  const updateBufferUI = () => {
    if (video.duration > 0 && video.buffered.length > 0) {
      const end = video.buffered.end(video.buffered.length - 1);
      const pct = Math.min(100, (end / video.duration) * 100);
      ytProgressBuffer.style.width = `${pct}%`;
    }
  };

  video.addEventListener('timeupdate', updateProgressUI);
  video.addEventListener('progress', updateBufferUI);

  const getScrubberFraction = (clientX) => {
    const rect = ytProgressBarContainer.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const offsetX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    return offsetX / rect.width;
  };

  ytProgressBarContainer.addEventListener('mousemove', (e) => {
    const fraction = getScrubberFraction(e.clientX);
    const rect = ytProgressBarContainer.getBoundingClientRect();
    const pct = fraction * 100;
    const hoverX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));

    ytProgressHoverLine.style.display = 'block';
    ytProgressHoverLine.style.left = `${hoverX}px`;

    const dur = video.duration || currentPost.duration || 0;
    if (dur > 0) {
      ytProgressTooltip.textContent = formatTime(fraction * dur);
      ytProgressTooltip.style.left = `${hoverX}px`;
      ytProgressTooltip.style.opacity = '1';
    }
  });

  ytProgressBarContainer.addEventListener('mouseleave', () => {
    if (!isScrubbing) {
      ytProgressHoverLine.style.display = 'none';
      ytProgressTooltip.style.opacity = '0';
    }
  });

  const onScrubberPointerDown = (e) => {
    e.stopPropagation();
    isScrubbing = true;
    ytProgressBarContainer.classList.add('is-scrubbing');
    wakeControls();

    const fraction = getScrubberFraction(e.clientX);
    ytProgressPlayed.style.width = `${fraction * 100}%`;
    const dur = video.duration || currentPost.duration || 0;
    if (dur > 0) {
      try { video.currentTime = fraction * dur; } catch {}
    }

    const onPointerMove = (ev) => {
      if (!isScrubbing) return;
      const frac = getScrubberFraction(ev.clientX);
      ytProgressPlayed.style.width = `${frac * 100}%`;
      const d = video.duration || currentPost.duration || 0;
      if (d > 0) {
        try { video.currentTime = frac * d; } catch {}
        ytTimeCurrent.textContent = formatTime(frac * d);
      }
    };

    const onPointerUp = () => {
      isScrubbing = false;
      ytProgressBarContainer.classList.remove('is-scrubbing');
      ytProgressHoverLine.style.display = 'none';
      ytProgressTooltip.style.opacity = '0';
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      wakeControls();
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  ytProgressBarContainer.addEventListener('pointerdown', onScrubberPointerDown);

  // ═══════════════════════════════════════════════════════════
  // Fullscreen & PiP Handling
  // ═══════════════════════════════════════════════════════════
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      if (videoContainer.requestFullscreen) {
        videoContainer.requestFullscreen().catch(() => {});
      } else if (video.webkitEnterFullscreen) {
        video.webkitEnterFullscreen();
      }
    }
  };

  const onFullscreenChange = () => {
    const isFs = Boolean(document.fullscreenElement);
    if (isFs) {
      ytBtnFullscreen.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>`;
      ytBtnFullscreen.title = `${t('vp.exitFullscreen', 'Выйти из полноэкранного режима')} (f)`;
    } else {
      ytBtnFullscreen.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>`;
      ytBtnFullscreen.title = `${t('vp.fullscreen', 'Во весь экран')} (f)`;
    }
  };

  document.addEventListener('fullscreenchange', onFullscreenChange);
  ytBtnFullscreen.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFullscreen();
  });

  ytBtnPip.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (err) {
      console.warn('[PiP error]', err);
      showToast(t('vp.pipNotSupported', 'Картинка в картинке не поддерживается'));
    }
  });

  // ═══════════════════════════════════════════════════════════
  // Quality & Playback Speed Management
  // ═══════════════════════════════════════════════════════════
  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  let currentSpeed = parseFloat(localStorage.getItem('booru_video_speed') || '1');
  if (isNaN(currentSpeed) || !SPEEDS.includes(currentSpeed)) currentSpeed = 1;

  const setPlaybackSpeed = (speed) => {
    currentSpeed = speed;
    video.playbackRate = currentSpeed;
    try { localStorage.setItem('booru_video_speed', String(currentSpeed)); } catch {}
  };

  video.addEventListener('loadedmetadata', () => { video.playbackRate = currentSpeed; });
  video.addEventListener('play', () => { video.playbackRate = currentSpeed; });

  const getAvailableQualities = () => {
    const list = [];
    if (Array.isArray(currentPost.videoQualities) && currentPost.videoQualities.length > 0) {
      for (const q of currentPost.videoQualities) {
        if (!list.some(item => item.key === q.quality)) {
          list.push({ key: q.quality, label: q.label || q.quality });
        }
      }
    }
    if (!list.some(item => item.key === '480p')) {
      list.push({ key: '480p', label: '480p (Быстро)' });
    }
    if (!list.some(item => item.key === 'original')) {
      list.push({ key: 'original', label: 'Оригинал' });
    }
    return list;
  };

  const getQualityShortLabel = () => {
    if (activeQuality === 'original') return 'Оригинал';
    return activeQuality || 'HD';
  };

  const updateHDBadge = () => {
    const isHD = activeQuality !== '480p' || (currentPost.height && currentPost.height >= 720);
    ytHdBadge.style.display = isHD ? 'inline-block' : 'none';
  };
  updateHDBadge();

  const switchQuality = (newQuality) => {
    if (activeQuality === newQuality) return;
    activeQuality = newQuality;
    updateHDBadge();
    rebuildMediaUrls();

    if (iosTranscodeAbort) {
      try { iosTranscodeAbort.abort(); iosTranscodeAbort = null; } catch {}
    }
    iosWaitDone = false;

    const targetUrl = (currentSource === 'proxy' || needsProxy || activeMediaInfo.isTranscode) ? proxyMedia : directMedia;
    const curTime = video.currentTime || 0;
    const isPaused = video.paused;

    if (isPreCaching && abortRef.current) {
      abortRef.current.abort();
      isPreCaching = false;
    }

    setProgress(0, t('vp.switchingQuality', 'Переключение качества ({q})...').replace('{q}', activeMediaInfo.label || newQuality), true);
    video.src = targetUrl;
    video.addEventListener('loadedmetadata', () => {
      if (curTime > 0 && curTime < video.duration) {
        try { video.currentTime = curTime; } catch {}
      }
      if (!isPaused) safePlay();
    }, { once: true });
    safePlay();
  };

  // ═══════════════════════════════════════════════════════════
  // YouTube Settings Menu (Screenshot 3 Matching)
  // ═══════════════════════════════════════════════════════════
  const closeSettingsMenu = () => {
    isSettingsMenuOpen = false;
    ytSettingsMenu.style.display = 'none';
    videoContainer.classList.remove('menu-open');
    wakeControls();
  };

  const openSettingsMenu = () => {
    isSettingsMenuOpen = true;
    renderSettingsView('main');
    ytSettingsMenu.style.display = 'block';
    videoContainer.classList.add('menu-open');
    wakeControls();
  };

  const renderSettingsView = (viewName = 'main') => {
    ytSettingsMenu.innerHTML = '';

    if (viewName === 'main') {
      // 1. Playback Speed Row
      const speedRow = document.createElement('div');
      speedRow.className = 'yt-menu-item';
      speedRow.innerHTML = `
        <div class="yt-menu-item-left">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>${t('yt.speed', 'Скорость воспроизведения')}</span>
        </div>
        <div class="yt-menu-item-right">
          <span class="yt-menu-value">${currentSpeed === 1 ? t('yt.normal', 'Обычная') : `${currentSpeed}x`}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      `;
      speedRow.addEventListener('click', (e) => {
        e.stopPropagation();
        renderSettingsView('speed');
      });
      ytSettingsMenu.appendChild(speedRow);

      // 2. Quality Row
      const qualityRow = document.createElement('div');
      qualityRow.className = 'yt-menu-item';
      qualityRow.innerHTML = `
        <div class="yt-menu-item-left">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
          <span>${t('yt.quality', 'Качество')}</span>
        </div>
        <div class="yt-menu-item-right">
          <span class="yt-menu-value">${getQualityShortLabel()}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      `;
      qualityRow.addEventListener('click', (e) => {
        e.stopPropagation();
        renderSettingsView('quality');
      });
      ytSettingsMenu.appendChild(qualityRow);

      // 3. Source Row
      const sourceRow = document.createElement('div');
      sourceRow.className = 'yt-menu-item';
      sourceRow.innerHTML = `
        <div class="yt-menu-item-left">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          <span>${t('yt.source', 'Источник')}</span>
        </div>
        <div class="yt-menu-item-right">
          <span class="yt-menu-value">${currentSource === 'proxy' ? t('yt.proxy', 'Прокси (Сервер)') : t('yt.direct', 'Прямой (CDN)')}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      `;
      sourceRow.addEventListener('click', (e) => {
        e.stopPropagation();
        renderSettingsView('source');
      });
      ytSettingsMenu.appendChild(sourceRow);

      // 4. Cache in Memory Row
      const cacheRow = document.createElement('div');
      cacheRow.className = 'yt-menu-item';
      const cacheStatusLabel = isCachedInMemory ? t('yt.cached', 'В памяти ✓') : (isPreCaching ? '...' : '');
      cacheRow.innerHTML = `
        <div class="yt-menu-item-left">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
          <span>${t('yt.cache', 'Кэш в память')}</span>
        </div>
        <div class="yt-menu-item-right">
          <span class="yt-menu-value">${cacheStatusLabel}</span>
        </div>
      `;
      cacheRow.addEventListener('click', (e) => {
        e.stopPropagation();
        closeSettingsMenu();
        const currentSrc = currentSource === 'proxy' ? proxyMedia : directMedia;
        startPreCaching(currentSrc);
      });
      ytSettingsMenu.appendChild(cacheRow);

      // 5. Download Video Row
      const downloadRow = document.createElement('div');
      downloadRow.className = 'yt-menu-item';
      downloadRow.innerHTML = `
        <div class="yt-menu-item-left">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span>${t('yt.download', 'Скачать видео')}</span>
        </div>
      `;
      downloadRow.addEventListener('click', (e) => {
        e.stopPropagation();
        closeSettingsMenu();
        triggerDownload();
      });
      ytSettingsMenu.appendChild(downloadRow);

    } else if (viewName === 'speed') {
      // Header with back arrow
      const header = document.createElement('div');
      header.className = 'yt-menu-header';
      header.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
        <span>${t('yt.speed', 'Скорость воспроизведения')}</span>
      `;
      header.addEventListener('click', (e) => {
        e.stopPropagation();
        renderSettingsView('main');
      });
      ytSettingsMenu.appendChild(header);

      for (const sp of SPEEDS) {
        const item = document.createElement('div');
        const isActive = currentSpeed === sp;
        item.className = `yt-menu-item${isActive ? ' active' : ''}`;
        item.innerHTML = `
          <div class="yt-menu-item-left">
            <span class="yt-menu-check">${isActive ? '✓' : ''}</span>
            <span>${sp === 1 ? t('yt.normal', 'Обычная') : `${sp}x`}</span>
          </div>
        `;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          setPlaybackSpeed(sp);
          closeSettingsMenu();
        });
        ytSettingsMenu.appendChild(item);
      }

    } else if (viewName === 'quality') {
      // Header with back arrow
      const header = document.createElement('div');
      header.className = 'yt-menu-header';
      header.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
        <span>${t('yt.quality', 'Качество')}</span>
      `;
      header.addEventListener('click', (e) => {
        e.stopPropagation();
        renderSettingsView('main');
      });
      ytSettingsMenu.appendChild(header);

      const avail = getAvailableQualities();
      for (const q of avail) {
        const item = document.createElement('div');
        const isActive = activeQuality === q.key;
        item.className = `yt-menu-item${isActive ? ' active' : ''}`;
        item.innerHTML = `
          <div class="yt-menu-item-left">
            <span class="yt-menu-check">${isActive ? '✓' : ''}</span>
            <span>${q.label}</span>
          </div>
        `;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          closeSettingsMenu();
          switchQuality(q.key);
        });
        ytSettingsMenu.appendChild(item);
      }

    } else if (viewName === 'source') {
      // Header with back arrow
      const header = document.createElement('div');
      header.className = 'yt-menu-header';
      header.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
        <span>${t('yt.source', 'Источник')}</span>
      `;
      header.addEventListener('click', (e) => {
        e.stopPropagation();
        renderSettingsView('main');
      });
      ytSettingsMenu.appendChild(header);

      // Direct CDN option
      const optDirect = document.createElement('div');
      const isDirect = currentSource === 'direct';
      optDirect.className = `yt-menu-item${isDirect ? ' active' : ''}`;
      optDirect.innerHTML = `
        <div class="yt-menu-item-left">
          <span class="yt-menu-check">${isDirect ? '✓' : ''}</span>
          <span>${t('yt.direct', 'Прямой (CDN)')}</span>
        </div>
      `;
      optDirect.addEventListener('click', (e) => {
        e.stopPropagation();
        closeSettingsMenu();
        if (currentSource !== 'direct') {
          currentSource = 'direct';
          setProgress(0, t('vp.loadingDirectCdn', 'Загрузка напрямую с CDN...'), true);
          video.src = directMedia;
          safePlay();
        }
      });
      ytSettingsMenu.appendChild(optDirect);

      // Local Proxy option
      const optProxy = document.createElement('div');
      const isProxy = currentSource === 'proxy';
      optProxy.className = `yt-menu-item${isProxy ? ' active' : ''}`;
      optProxy.innerHTML = `
        <div class="yt-menu-item-left">
          <span class="yt-menu-check">${isProxy ? '✓' : ''}</span>
          <span>${t('yt.proxy', 'Прокси (Сервер)')}</span>
        </div>
      `;
      optProxy.addEventListener('click', (e) => {
        e.stopPropagation();
        closeSettingsMenu();
        if (currentSource !== 'proxy') {
          currentSource = 'proxy';
          setProgress(0, t('vp.loadingViaServer', 'Загрузка через локальный сервер...'), true);
          video.src = proxyMedia;
          safePlay();
        }
      });
      ytSettingsMenu.appendChild(optProxy);
    }
  };

  ytBtnSettings.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isSettingsMenuOpen) {
      closeSettingsMenu();
    } else {
      openSettingsMenu();
    }
  });

  const onDocClickCloseSettings = (e) => {
    if (isSettingsMenuOpen && !ytSettingsAnchor.contains(e.target)) {
      closeSettingsMenu();
    }
  };
  document.addEventListener('click', onDocClickCloseSettings);

  // ═══════════════════════════════════════════════════════════
  // Keyboard Shortcuts
  // ═══════════════════════════════════════════════════════════
  const onKeyDown = (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) {
      return;
    }
    if (!document.body.contains(videoContainer)) return;

    if (e.code === 'Space' || e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      togglePlayPause();
    } else if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      toggleFullscreen();
    } else if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      video.muted = !video.muted;
      if (!video.muted && video.volume === 0) video.volume = 1;
      updateVolumeUI();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      video.currentTime = Math.max(0, video.currentTime - 5);
      wakeControls();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
      wakeControls();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      video.volume = Math.min(1, Math.round((video.volume + 0.1) * 10) / 10);
      video.muted = false;
      updateVolumeUI();
      wakeControls();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      video.volume = Math.max(0, Math.round((video.volume - 0.1) * 10) / 10);
      updateVolumeUI();
      wakeControls();
    }
  };
  document.addEventListener('keydown', onKeyDown);

  // ═══════════════════════════════════════════════════════════
  // Networking, Transcoding, Caching & Error Handling
  // ═══════════════════════════════════════════════════════════
  const triggerDownload = () => {
    if (fullMediaPending) {
      showToast(t('vp.downloadPending', 'Полное видео ещё загружается, попробуйте через пару секунд'));
      return;
    }
    const rawTarget = currentPost.fileUrl || currentPost.sampleUrl || currentPost.previewUrl || '';
    if (!rawTarget) return;
    if (rawTarget.startsWith('/api/archive/file')) {
      const dlUrl = rawTarget.includes('?') ? `${rawTarget}&download=1` : `${rawTarget}?download=1`;
      const a = document.createElement('a');
      a.href = dlUrl;
      const cleanName = currentPost.title || `video_${currentPost.originalId || currentPost.id || 'file'}.${currentPost.fileExt || 'mp4'}`;
      a.download = cleanName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    const proxyUrl = getProxiedUrl(rawTarget);
    const a = document.createElement('a');
    a.href = proxyUrl;
    const ext = currentPost.fileExt || 'mp4';
    a.download = `video_${currentPost.site || 'file'}_${currentPost.id}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const needsProxy = shouldProxyMedia({ site: currentPost.site, url: directMedia, type: 'video', settings: state.settings });
  let currentSource = needsProxy ? 'proxy' : 'direct';
  let isPreCaching = false;
  let iosTranscodeAbort = null;
  let iosWaitDone = false;
  let loadTimeout = null;

  const setProgress = (percent, text = null, showSpinner = true, isError = false) => {
    if (text) {
      ytStatusText.textContent = text;
      ytStatusSpinner.style.display = showSpinner ? 'inline-block' : 'none';
      ytStatusBadge.style.display = 'inline-flex';
    }
    if (showSpinner && (video.readyState < 3 || isPreCaching)) {
      ytCenterSpinner.classList.add('active');
    } else {
      ytCenterSpinner.classList.remove('active');
    }
  };

  const hideStatus = () => {
    ytStatusBadge.style.display = 'none';
    ytCenterSpinner.classList.remove('active');
  };

  let unsupportedFallbackEl = null;
  let iosWaitOverlay = null;

  const showIosWaitOverlay = () => {
    if (iosWaitOverlay) return;
    video.style.display = 'none';
    iosWaitOverlay = document.createElement('div');
    iosWaitOverlay.className = 'video-unsupported-fallback';
    iosWaitOverlay.innerHTML = `
      <div class="video-unsupported-icon" style="animation: spin 2s linear infinite;">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
        </svg>
      </div>
      <div class="video-unsupported-title">Конвертация для iOS...</div>
      <div class="video-unsupported-desc" style="max-width: 280px; text-align: center;">Пожалуйста, подождите. Сервер подготавливает совместимый MP4 файл. Это может занять около минуты.</div>
    `;
    videoContainer.appendChild(iosWaitOverlay);
  };

  const hideIosWaitOverlay = () => {
    if (iosWaitOverlay) {
      iosWaitOverlay.remove();
      iosWaitOverlay = null;
      video.style.display = '';
    }
  };

  const showUnsupportedVideoFallback = (message = null) => {
    if (unsupportedFallbackEl) return;
    clearTimeout(loadTimeout);
    isPreCaching = false;
    try { video.pause(); } catch {}
    video.removeAttribute('src');
    try { video.load(); } catch {}
    video.style.display = 'none';

    unsupportedFallbackEl = document.createElement('div');
    unsupportedFallbackEl.className = 'video-unsupported-fallback';
    const ext = (currentPost.fileExt || 'video').toUpperCase();
    const titleText = t('vp.unsupportedFormat', 'Формат видео не поддерживается');
    const descText = message || t('vp.unsupportedDesc', 'Браузер не поддерживает воспроизведение этого видео ({ext}). Вы можете скачать файл на устройство и открыть в плеере (VLC, MPV).').replace('{ext}', ext);
    const dlBtnText = t('vp.downloadFile', 'Скачать видео');

    unsupportedFallbackEl.innerHTML = `
      <div class="video-unsupported-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v1"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
          <polygon points="23 7 16 12 23 17 23 7"/>
        </svg>
      </div>
      <div class="video-unsupported-title">${titleText}</div>
      <div class="video-unsupported-desc">${descText}</div>
      <div class="video-unsupported-actions">
        <button type="button" class="btn-download-video-fallback">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <span>${dlBtnText}</span>
        </button>
      </div>
    `;

    const dlBtn = unsupportedFallbackEl.querySelector('.btn-download-video-fallback');
    if (dlBtn) {
      dlBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerDownload();
      });
    }

    videoContainer.appendChild(unsupportedFallbackEl);
    setProgress(0, t('vp.unsupportedShort', 'Формат видео не поддерживается. Скачайте файл.'), false, true);
  };

  const showFullMediaUnavailable = () => {
    if (unsupportedFallbackEl || !teaserUrl || playerDestroyed) return;
    clearTimeout(resolveWatchdog);
    resolveWatchdog = null;

    const siteUrl = toSafeHttpUrl(getPostSiteUrl(currentPost) || '');
    const siteAction = siteUrl
      ? `<a class="btn-video-fallback-ghost" href="${escapeHtml(siteUrl)}" target="_blank" rel="noopener noreferrer">
           <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
           <span>${t('vp.openOnSite', 'Открыть на сайте')}</span>
         </a>`
      : '';

    unsupportedFallbackEl = document.createElement('div');
    unsupportedFallbackEl.className = 'video-unsupported-fallback';
    unsupportedFallbackEl.innerHTML = `
      <div class="video-unsupported-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
      </div>
      <div class="video-unsupported-title">${t('vp.fullUnavailable', 'Полное видео недоступно')}</div>
      <div class="video-unsupported-desc">${t('vp.fullUnavailableDesc', 'Rule34Video не отдал ссылку на файл. Повторите попытку, откройте страницу на сайте или посмотрите короткое превью.')}</div>
      <div class="video-unsupported-actions">
        <button type="button" class="btn-download-video-fallback btn-retry-resolve">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          <span>${t('vp.retryResolve', 'Повторить')}</span>
        </button>
        <button type="button" class="btn-video-fallback-ghost btn-play-teaser">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          <span>${t('vp.playTeaser', 'Смотреть превью (20 сек)')}</span>
        </button>
        ${siteAction}
      </div>
    `;

    unsupportedFallbackEl.querySelector('.btn-retry-resolve')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (unsupportedFallbackEl) { unsupportedFallbackEl.remove(); unsupportedFallbackEl = null; }
      startFullMediaResolve(true);
    });

    unsupportedFallbackEl.querySelector('.btn-play-teaser')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (unsupportedFallbackEl) { unsupportedFallbackEl.remove(); unsupportedFallbackEl = null; }
      playTeaser();
    });

    videoContainer.appendChild(unsupportedFallbackEl);
    setProgress(0, t('vp.fullUnavailableShort', 'Полное видео недоступно'), false, true);
  };

  const playTeaser = () => {
    if (!teaserUrl || playerDestroyed) return;
    clearTimeout(resolveWatchdog);
    resolveWatchdog = null;
    playingTeaser = true;
    video.loop = false;
    video.poster = '';
    const target = needsProxy ? getProxiedUrl(teaserUrl) : teaserUrl;
    video.src = target;
    safePlay();
  };

  const startPreCaching = async (targetUrl) => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    isPreCaching = true;
    isCachedInMemory = false;
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
      isPreCaching = false;
      isCachedInMemory = true;
      setProgress(100, t('vp.cachedInMemory', 'Закэшировано в память!'), false);
      setTimeout(hideStatus, 1500);
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.warn('[PreCache Error]', err);
      isPreCaching = false;
      isCachedInMemory = false;
      handleVideoError();
    }
  };

  let mediaSourceInstance = null;
  let reresolvedOnce = false;
  let lastFallbackTime = 0;

  const startClientRemux = async (targetUrl) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    isPreCaching = true;
    currentSource = 'remux';
    setProgress(0, t('vp.jsDemuxing', 'Клиентский JS-демуксинг (MSE)...'), true);

    let internalAbortReason = null;
    try {
      if (!window.MediaSource) {
        throw new Error('MediaSource не поддерживается');
      }
      await ensureMp4Box();

      if (mediaSourceInstance && mediaSourceInstance.readyState === 'open') {
        try { mediaSourceInstance.endOfStream(); } catch {}
      }

      const ms = new MediaSource();
      mediaSourceInstance = ms;
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
      blobRef.current = URL.createObjectURL(ms);
      video.src = blobRef.current;

      const mp4boxfile = window.MP4Box.createFile();
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
      setProgress(100, t('vp.jsRemuxDone', 'JS Ремукс готов'), false);
      safePlay();
      setTimeout(hideStatus, 1200);
    } catch (err) {
      if (err.name === 'AbortError' && !internalAbortReason) return;
      clearTimeout(loadTimeout);
      console.warn('[Client Remux Error]', err);
      isPreCaching = false;
      showUnsupportedVideoFallback(t('vp.hwCodecFailed', 'Кодек видео не поддерживается браузером. Скачайте файл для просмотра.'));
    }
  };

  const startTranscodeWait = async (targetUrl, { overlay = false } = {}) => {
    if (iosTranscodeAbort) {
      try { iosTranscodeAbort.abort(); } catch {}
    }
    iosTranscodeAbort = new AbortController();
    iosWaitDone = true;
    isPreCaching = true;
    setProgress(0, overlay
      ? t('vp.iosTranscoding', 'Apple устройства не поддерживают стриминг. Ожидание завершения конвертации...')
      : t('vp.transcodingHevc', 'Видео в кодеке HEVC, конвертируем в H.264...'), true);

    if (overlay) showIosWaitOverlay();

    try {
      const res = await fetch(targetUrl, {
        method: 'HEAD',
        signal: iosTranscodeAbort.signal
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);

      isPreCaching = false;
      if (overlay) hideIosWaitOverlay();
      setProgress(100, overlay
        ? t('vp.iosTranscodeDone', 'Конвертация завершена!')
        : t('vp.transcodeDone', 'Конвертация завершена!'), false);
      setTimeout(hideStatus, 1500);

      video.src = targetUrl;
      safePlay();
    } catch (err) {
      if (err.name === 'AbortError') return;
      isPreCaching = false;
      if (overlay) hideIosWaitOverlay();
      showUnsupportedVideoFallback();
    }
  };

  const startIosTranscodeWait = (targetUrl) => startTranscodeWait(targetUrl, { overlay: true });

  const startRemuxOrFallback = () => {
    const cleanExt = (currentPost.fileExt || '').toLowerCase();
    if (isCurrentHevc()) {
      if (!hevcTranscodeTried) {
        hevcTranscodeTried = true;
        const hevcTranscodeUrl = `/api/transcode-video?url=${encodeURIComponent(getBaseOriginal())}&quality=720p`;
        startTranscodeWait(hevcTranscodeUrl);
      } else {
        showUnsupportedVideoFallback();
      }
      return;
    }

    const hasMseSupport = Boolean(
      typeof window !== 'undefined' &&
      window.MediaSource &&
      typeof MediaSource.isTypeSupported === 'function' &&
      MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"')
    );

    if (hasMseSupport && state.settings?.enableJsDemuxing !== false && (cleanExt === 'mp4' || cleanExt === 'm4v' || (!cleanExt && directMedia.includes('.mp4')))) {
      startClientRemux(proxyMedia);
    } else {
      if (activeMediaInfo && activeMediaInfo.isTranscode && !iosWaitDone) {
        startIosTranscodeWait(proxyMedia);
      } else {
        showUnsupportedVideoFallback();
      }
    }
  };

  const handleProxySourceFailure = () => {
    if (currentPost.site === 'rule34video' && !reresolvedOnce) {
      reresolvedOnce = true;
      setProgress(0, t('vp.linkExpired', 'Ссылка источника устарела, обновляем...'), true);
      resolveRule34VideoMedia(currentPost, { force: true })
        .then(data => {
          if (data && data.fullVideoUrl) {
            currentPost.fileUrl = data.fullVideoUrl;
            currentPost.sampleUrl = data.fullVideoUrl;
            currentPost.hasFullMediaPending = false;
            currentPost.hasSound = true;
            fullMediaPending = false;
            rebuildMediaUrls();
            setProgress(0, t('vp.reconnectingProxy', 'Повторное подключение через прокси...'), true);
            video.src = proxyMedia;
            safePlay();
          } else {
            startRemuxOrFallback();
          }
        })
        .catch(() => startRemuxOrFallback());
      return;
    }
    startRemuxOrFallback();
  };

  const handleVideoError = () => {
    if (isPreCaching) return;
    if (video.error && video.error.code === 1) return;
    
    const isFatal = video.error && (video.error.code === 3 || video.error.code === 4);
    if (!isFatal && (video.currentTime > 0 || video.readyState >= 2)) return;

    const now = Date.now();
    if (now - lastFallbackTime < 1500) return;
    lastFallbackTime = now;

    if (isCurrentHevc() && !hevcTranscodeTried && !(activeMediaInfo && activeMediaInfo.isTranscode)) {
      hevcTranscodeTried = true;
      const hevcTranscodeUrl = `/api/transcode-video?url=${encodeURIComponent(getBaseOriginal())}&quality=720p`;
      setProgress(0, t('vp.transcodingHevc', 'Видео в кодеке HEVC, конвертируем в H.264...'), true);
      video.src = hevcTranscodeUrl;
      safePlay();
      return;
    }

    if (currentSource === 'direct' && !directMedia.startsWith('/api/')) {
      currentSource = 'proxy';
      setProgress(0, t('vp.connectingProxy', 'Подключение через прокси...'), true);
      video.src = proxyMedia;
      safePlay();
    } else if (currentSource === 'proxy' || directMedia.startsWith('/api/')) {
      handleProxySourceFailure();
    } else {
      showUnsupportedVideoFallback();
    }
  };

  video.addEventListener('loadstart', () => {
    if (!isPreCaching) {
      const statusText = currentSource === 'proxy' 
        ? t('vp.connectingLocalProxy', 'Подключение через локальный прокси...') 
        : t('vp.initCdnStream', 'Инициализация видеопотока CDN...');
      setProgress(0, statusText, true);
    }
    clearTimeout(loadTimeout);
    loadTimeout = setTimeout(() => {
      if (video.readyState < 2 && currentSource === 'direct' && !isPreCaching) {
        console.warn('[Video Timeout] Прямая загрузка CDN не ответила, переход на прокси');
        handleVideoError();
      }
    }, 8000);
  });

  video.addEventListener('waiting', () => {
    if (!isPreCaching) {
      setProgress(null, t('vp.bufferingVideo', 'Буферизация видео...'), true);
    }
  });

  video.addEventListener('loadedmetadata', () => {
    const isTranscodingStream = Boolean(activeMediaInfo?.isTranscode);
    const hasKnownDuration = Boolean(currentPost.duration && currentPost.duration > 0);

    if (playingTeaser) return;

    if (video.duration && !isNaN(video.duration) && (!isTranscodingStream || !hasKnownDuration)) {
      currentPost.duration = video.duration;
      const mins = Math.floor(video.duration / 60);
      const secs = Math.floor(video.duration % 60);
      currentPost.durationText = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

      const infoDuration = document.getElementById('infoDuration');
      const infoDurationRow = document.getElementById('infoDurationRow');
      if (infoDuration) infoDuration.textContent = currentPost.durationText;
      if (infoDurationRow) infoDurationRow.style.display = 'flex';
      ytTimeDuration.textContent = currentPost.durationText;
    }
  });

  const applyFullMedia = (data) => {
    currentPost.fileUrl = data.fullVideoUrl;
    currentPost.sampleUrl = data.fullVideoUrl;
    currentPost.hasFullMediaPending = false;
    currentPost.hasSound = true;
    fullMediaPending = false;
    playingTeaser = false;
    if (data.quality) currentPost.quality = data.quality;
    if (Array.isArray(data.videoQualities)) currentPost.videoQualities = data.videoQualities;
    updateHDBadge();
    rebuildMediaUrls();
    const targetUrl = (currentSource === 'proxy' || needsProxy || activeMediaInfo.isTranscode) ? proxyMedia : directMedia;

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
  };

  const startFullMediaResolve = (force = false) => {
    if (currentPost.site !== 'rule34video') return;
    if (currentPost.source || currentPost.originalId) {
      const request = (force || typeof resolvedVideoPromise?.then !== 'function')
        ? resolveRule34VideoMedia(currentPost, { force })
        : resolvedVideoPromise;

      clearTimeout(resolveWatchdog);
      resolveWatchdog = setTimeout(() => {
        if (!playerDestroyed && fullMediaPending) showFullMediaUnavailable();
      }, 20000);

      request
        .then((data) => {
          if (playerDestroyed) return;
          clearTimeout(resolveWatchdog);
          resolveWatchdog = null;
          if (data && data.fullVideoUrl) {
            applyFullMedia(data);
            return;
          }
          if (fullMediaPending) showFullMediaUnavailable();
        })
        .catch(() => {
          if (playerDestroyed || !fullMediaPending) return;
          clearTimeout(resolveWatchdog);
          resolveWatchdog = null;
          showFullMediaUnavailable();
        });
    } else if (fullMediaPending) {
      showFullMediaUnavailable();
    }
  };

  startFullMediaResolve();

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
      if (video.error && video.error.code === 1) return;
      if (video.currentTime > 0 || video.readyState >= 2) return;
      console.warn('[Video Error] Ошибка тега video, запуск обработчика fallback');
      handleVideoError();
    }
  });

  videoContainer.appendChild(video);
  videoContainer.appendChild(ytCenterSpinner);
  videoContainer.appendChild(ytCenterAction);
  videoContainer.appendChild(unmuteBtn);
  videoContainer.appendChild(ytControlsWrapper);

  const UNPLAYABLE_CONTAINERS = new Set(['mkv', 'avi', 'wmv', 'flv', 'ts']);
  const cleanExt = String(currentPost.fileExt || '').toLowerCase();
  if (fullMediaPending) {
    setProgress(0, t('vp.resolvingFull', 'Получаем ссылку на полное видео...'), true);
  } else if (UNPLAYABLE_CONTAINERS.has(cleanExt)) {
    showUnsupportedVideoFallback();
  } else {
    video.src = currentSource === 'proxy' ? proxyMedia : directMedia;
    safePlay();
  }

  return {
    videoContainer,
    statusBanner,
    video,
    destroy: () => {
      playerDestroyed = true;
      clearTimeout(resolveWatchdog);
      clearTimeout(idleTimer);
      clearTimeout(singleClickTimeout);
      clearTimeout(rippleTimeout);
      if (iosTranscodeAbort) {
        try { iosTranscodeAbort.abort(); iosTranscodeAbort = null; } catch {}
      }
      hideIosWaitOverlay();
      clearTimeout(loadTimeout);
      document.removeEventListener('click', onDocClickCloseSettings);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      try { video.pause(); } catch {}
      video.removeAttribute('src');
      try { video.load(); } catch {}
      if (mediaSourceInstance && mediaSourceInstance.readyState === 'open') {
        try { mediaSourceInstance.endOfStream(); } catch {}
      }
      if (unsupportedFallbackEl) {
        unsupportedFallbackEl.remove();
        unsupportedFallbackEl = null;
      }
    }
  };
}
