// Feed video player: a compact autoplay-loop player for the vertical feed.
// It reuses the viewer's codec rules (HEVC transcode routing, unplayable
// containers, Rule34Video teaser resolution) without the viewer's heavy
// quality menu and draggable status banner.
import { t } from '../i18n.js';
import { state } from '../state.js';
import { getProxiedUrl, shouldProxyMedia } from '../api.js';
import { isHevcSource, browserSupportsHevc } from '../modules/hevcCodec.js';
import { isFullMediaPending, isRule34VideoTeaserUrl } from '../modules/uiUtils.js';
import { resolveRule34VideoMedia, getCachedRule34VideoMedia } from '../modules/rule34VideoResolve.js';

const UNPLAYABLE_CONTAINERS = new Set(['mkv', 'avi', 'wmv', 'flv', 'ts']);

function iconSvg(id, size = 20) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><use href="#${id}"/></svg>`;
}

/**
 * Builds the feed video player for a post.
 * Returns null when the post has no playable source: the caller then renders
 * the download fallback card.
 *
 * Playback control lives outside the player: the gesture layer toggles
 * play/pause on tap, the feed rail hosts the sound button (refreshed through
 * options.onMediaState) and the state element shows the paused glyph.
 *
 * @param {Object} post normalized post (or album item)
 * @param {{ onMediaState?: Function }} [options]
 * @returns {{ wrap: HTMLElement, video: HTMLVideoElement, progress: HTMLElement,
 *             stateEl: HTMLElement, setPlaying: Function, togglePlay: Function,
 *             isPaused: Function, getMuted: Function, toggleMuted: Function,
 *             destroy: Function } | null}
 */
export function createFeedVideoPlayer(post, options = {}) {
  const onMediaState = options.onMediaState;
  const baseUrl = post.fileUrl || post.sampleUrl || '';
  if (!baseUrl) return null;

  const cleanExt = String(post.fileExt || '').toLowerCase();
  const pendingFull = isFullMediaPending(post) || isRule34VideoTeaserUrl(baseUrl);
  // Containers the browser cannot decode at all: no point attaching a source.
  if (!pendingFull && UNPLAYABLE_CONTAINERS.has(cleanExt)) return null;

  const wrap = document.createElement('div');
  wrap.className = 'feed-video-wrap';

  const video = document.createElement('video');
  video.className = 'feed-media feed-video';
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.controls = false;
  video.loop = true;
  video.preload = 'auto';
  video.referrerPolicy = 'no-referrer';
  video.setAttribute('aria-label', t('feed.videoLabel', 'Видео'));

  // Respect the muted preference shared with the viewer player.
  const savedMuted = localStorage.getItem('booru_video_muted') === 'true';
  video.muted = savedMuted;

  // Thin progress line pinned to the bottom edge of the stage.
  const progress = document.createElement('div');
  progress.className = 'feed-video-progress';
  const progressFill = document.createElement('div');
  progressFill.className = 'feed-video-progress-fill';
  progress.appendChild(progressFill);
  progress.setAttribute('hidden', '');

  // Scrubbing: drag on the thin bar seeks (CSS touch-action: none keeps the
  // feed from scrolling while the finger is on it).
  let seeking = false;
  const seekTo = (clientX) => {
    if (!video.duration || !isFinite(video.duration)) return;
    const rect = progress.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    video.currentTime = ratio * video.duration;
    progressFill.style.width = `${ratio * 100}%`;
  };
  progress.addEventListener('pointerdown', (e) => {
    if (!video.duration || !isFinite(video.duration)) return;
    seeking = true;
    try { progress.setPointerCapture(e.pointerId); } catch {}
    seekTo(e.clientX);
    e.preventDefault();
  });
  progress.addEventListener('pointermove', (e) => {
    if (seeking) seekTo(e.clientX);
  });
  progress.addEventListener('pointerup', () => { seeking = false; });
  progress.addEventListener('pointercancel', () => { seeking = false; });

  // Paused-state glyph in the middle of the media. A tap toggles playback
  // (gesture layer) and the sound toggle lives in the feed rail, so this
  // player owns no buttons of its own.
  const stateEl = document.createElement('div');
  stateEl.className = 'feed-video-state';
  stateEl.setAttribute('aria-hidden', 'true');
  stateEl.innerHTML = iconSvg('ic-play', 34);

  const notifyMediaState = () => {
    try { if (typeof onMediaState === 'function') onMediaState(); } catch (_) { /* UI refresh must never break playback */ }
  };

  const syncStateUi = () => {
    stateEl.classList.toggle('visible', video.paused && !video.ended);
    notifyMediaState();
  };

  video.addEventListener('play', syncStateUi);
  video.addEventListener('pause', syncStateUi);
  video.addEventListener('volumechange', notifyMediaState);
  syncStateUi();
  video.addEventListener('timeupdate', () => {
    if (video.duration > 0) {
      progress.removeAttribute('hidden', '');
      if (!seeking) {
        progressFill.style.width = `${Math.min(100, (video.currentTime / video.duration) * 100)}%`;
      }
    }
  });

  // Show the bar as soon as metadata is known, even before the first frame
  // tick (paused or still buffering videos must expose their length).
  video.addEventListener('loadedmetadata', () => {
    if (video.duration > 0 && isFinite(video.duration)) progress.removeAttribute('hidden', '');
  });

  let destroyed = false;
  // Playback is driven by the slide window: the player stays paused until its
  // slide becomes active, so offscreen slides never decode or stream video.
  let desiredPlaying = false;

  const safePlay = () => {
    const attempt = video.play();
    if (attempt && typeof attempt.catch === 'function') {
      attempt.catch(() => {
        if (destroyed) return;
        // Autoplay with sound was blocked: fall back to muted playback.
        video.muted = true;
        notifyMediaState();
        video.play().catch(() => {});
      });
    }
  };

  const attachSource = (url) => {
    if (destroyed || !url) return;
    const isTranscode = url.startsWith('/api/transcode-video');
    const shouldUseProxy = isTranscode ? false : shouldProxyMedia({ site: post.site, url, type: 'video' });
    video.src = (url.startsWith('/api/') || !shouldUseProxy) ? url : getProxiedUrl(url);
    if (desiredPlaying) safePlay();
  };

  // Resolve overlay for Rule34Video posts whose feed entry only carries the
  // short teaser. The teaser must never loop as if it were the video.
  const resolveOverlay = document.createElement('div');
  resolveOverlay.className = 'feed-resolve';
  resolveOverlay.setAttribute('hidden', '');

  const startResolve = (auto) => {
    resolveOverlay.removeAttribute('hidden');
    resolveOverlay.innerHTML = `<div class="feed-spinner"></div><span>${t('feed.teaserPending', 'Получаем ссылку на полное видео...')}</span>`;
    resolveRule34VideoMedia(post).then((data) => {
      if (destroyed) return;
      if (data && (data.fileUrl || data.url)) {
        resolveOverlay.setAttribute('hidden', '');
        if (data.fileUrl && data.fileUrl !== post.fileUrl) post.fileUrl = data.fileUrl;
        attachSource(data.fileUrl || data.url);
      } else {
        showResolveRetry();
      }
    }).catch(() => {
      if (!destroyed) showResolveRetry();
    });
    if (auto) { /* auto-resolve started on creation, nothing else to do */ }
  };

  const showResolveRetry = () => {
    resolveOverlay.removeAttribute('hidden');
    resolveOverlay.innerHTML = `<span>${t('feed.teaserFailed', 'Полное видео недоступно')}</span>`;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'feed-resolve-btn';
    retry.textContent = t('vw.retry', 'Повторить');
    retry.addEventListener('click', () => startResolve(false));
    resolveOverlay.appendChild(retry);
  };

  if (pendingFull) {
    const cached = getCachedRule34VideoMedia(post);
    if (cached && (cached.fileUrl || cached.url)) {
      attachSource(cached.fileUrl || cached.url);
    } else {
      resolveOverlay.innerHTML = `<span>${t('feed.teaserHint', 'Доступно короткое превью')}</span>`;
      const loadBtn = document.createElement('button');
      loadBtn.type = 'button';
      loadBtn.className = 'feed-resolve-btn';
      loadBtn.textContent = t('feed.teaserResolve', 'Получить полное видео');
      loadBtn.addEventListener('click', () => startResolve(false));
      resolveOverlay.removeAttribute('hidden', '');
      resolveOverlay.appendChild(loadBtn);
    }
  } else if (isHevcSource(baseUrl) && !browserSupportsHevc(video)) {
    // HEVC the browser cannot decode: route straight through the transcode.
    video.src = `/api/transcode-video?url=${encodeURIComponent(baseUrl)}&quality=720p`;
    if (desiredPlaying) safePlay();
  } else {
    attachSource(baseUrl);
  }

  wrap.appendChild(video);
  wrap.appendChild(resolveOverlay);

  return {
    wrap,
    video,
    progress,
    stateEl,
    setPlaying(on) {
      if (destroyed) return;
      desiredPlaying = Boolean(on);
      if (on) {
        video.preload = 'auto';
        if (video.src || video.currentSrc) safePlay();
      } else {
        video.pause();
        video.preload = 'metadata';
      }
    },
    togglePlay() {
      if (destroyed) return;
      if (video.paused || video.ended) video.play().catch(() => {}); else video.pause();
    },
    isPaused() {
      return video.paused;
    },
    getMuted() {
      return video.muted;
    },
    toggleMuted() {
      if (destroyed) return;
      video.muted = !video.muted;
      try { localStorage.setItem('booru_video_muted', String(video.muted)); } catch {}
      notifyMediaState();
    },
    destroy() {
      destroyed = true;
      try { video.pause(); } catch {}
      video.removeAttribute('src');
      try { video.load(); } catch {}
      wrap.remove();
    }
  };
}
