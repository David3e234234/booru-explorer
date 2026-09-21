import { haptic } from '../modules/uiUtils.js';

// Native browser video controls are drawn inside the <video> box and never exist in
// the DOM, so the seek/volume bar can only be hit-tested by geometry. 64px covers the
// bottom control bar of Chrome and Safari; a narrower band would keep the top part of
// the seek bar swipeable and flip the post instead of scrubbing.
const NATIVE_VIDEO_CONTROLS_BAND_PX = 64;

function isVideoControlsTouch(target, touch) {
  if (!touch) return false;
  const videoEl = target.closest('.viewer-video');
  if (!videoEl) return false;

  const rect = videoEl.getBoundingClientRect();
  const band = Math.min(NATIVE_VIDEO_CONTROLS_BAND_PX, rect.height);
  return touch.clientY >= rect.bottom - band && touch.clientX >= rect.left && touch.clientX <= rect.right;
}

/**
 * Checks if the touch event originated from an interactive UI element
 * (e.g. native video controls, filmstrip, button, input, link, sidebar).
 * The rest of the video stays swipeable, otherwise a video post could not be
 * navigated on mobile at all (the arrow buttons are desktop-only).
 * @param {EventTarget|null} target
 * @param {Touch} [touch]
 * @returns {boolean}
 */
export function isInteractiveTouchTarget(target, touch) {
  if (!target || typeof target.closest !== 'function') return false;
  return Boolean(
    isVideoControlsTouch(target, touch) ||
    target.closest('.video-status-banner') ||
    target.closest('.viewer-album-filmstrip') ||
    target.closest('.viewer-similar-filmstrip') ||
    target.closest('.btn-video-unmute') ||
    target.closest('.viewer-sidebar') ||
    target.closest('.viewer-header') ||
    target.closest('button') ||
    target.closest('input') ||
    target.closest('a')
  );
}

/**
 * Initializes touch gestures on the viewer media container:
 * - Two-finger pinch to zoom
 * - One-finger pull down to dismiss (with spring animation)
 * - Horizontal swipe left/right for next/prev navigation
 * - Quick vertical swipe down to close
 * - Double tap to toggle zoom level
 * - Single tap to toggle UI controls visibility
 *
 * @param {Object} params
 * @param {HTMLElement} params.mediaWrapper
 * @param {HTMLElement} [params.viewerContent]
 * @param {HTMLElement} [params.backdrop]
 * @param {HTMLElement} [params.viewerSidebar]
 * @param {Function} [params.getZoomInstance]
 * @param {Function} [params.goToNext]
 * @param {Function} [params.goToPrev]
 * @param {Function} [params.closeViewer]
 * @returns {{ destroy: Function }}
 */
export function setupViewerGestures({
  mediaWrapper,
  viewerContent,
  backdrop,
  viewerSidebar,
  getZoomInstance,
  goToNext,
  goToPrev,
  closeViewer
}) {
  if (!mediaWrapper) return { destroy: () => {} };

  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  let isDraggingDown = false;
  let initialPinchDist = 0;
  let initialZoom = 1;
  let isPinching = false;
  let lastTapTime = 0;

  const onTouchStart = (e) => {
    if (isInteractiveTouchTarget(e.target, e.touches[0])) {
      isPinching = false;
      isDraggingDown = false;
      touchStartX = 0;
      touchStartY = 0;
      touchStartTime = 0;
      return;
    }

    const zoom = getZoomInstance ? getZoomInstance() : null;
    if (zoom && zoom.getZoomLevel() > 1.05) {
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
      initialZoom = zoom ? zoom.getZoomLevel() : 1;
    } else if (e.touches.length === 1) {
      isPinching = false;
      isDraggingDown = false;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartTime = Date.now();
    }
  };

  const onTouchMove = (e) => {
    if (isInteractiveTouchTarget(e.target, e.touches[0]) || !touchStartY) {
      return;
    }

    const zoom = getZoomInstance ? getZoomInstance() : null;
    if (zoom && zoom.getZoomLevel() > 1.05) {
      return;
    }

    if (isPinching && e.touches.length === 2 && zoom) {
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (initialPinchDist > 0) {
        const factor = currentDist / initialPinchDist;
        zoom.setPinchZoom(factor, initialZoom);
      }
    } else if (e.touches.length === 1 && (!zoom || zoom.getZoomLevel() <= 1.05)) {
      const deltaY = e.touches[0].clientY - touchStartY;
      const deltaX = e.touches[0].clientX - touchStartX;
      if (deltaY > 15 && Math.abs(deltaY) > Math.abs(deltaX) * 1.2) {
        isDraggingDown = true;
        if (e.cancelable) {
          e.preventDefault();
        }
        if (viewerContent) {
          viewerContent.style.transition = 'none';
          viewerContent.style.transform = `translateY(${Math.max(0, deltaY)}px) scale(${Math.max(0.88, 1 - deltaY / 1200)})`;
        }
        if (backdrop) {
          backdrop.style.opacity = `${Math.max(0.2, 1 - deltaY / 400)}`;
        }
      } else if (isDraggingDown) {
        if (e.cancelable) {
          e.preventDefault();
        }
      }
    }
  };

  const onTouchEnd = (e) => {
    const zoom = getZoomInstance ? getZoomInstance() : null;

    if (isInteractiveTouchTarget(e.target, e.changedTouches[0]) && !isDraggingDown) {
      touchStartX = 0;
      touchStartY = 0;
      touchStartTime = 0;
      return;
    }

    if (zoom && zoom.getZoomLevel() > 1.05 && !isDraggingDown) {
      touchStartX = 0;
      touchStartY = 0;
      touchStartTime = 0;
      return;
    }

    if (isPinching) {
      if (e.touches.length < 2) isPinching = false;
      if (zoom && zoom.getZoomLevel() < 1) {
        zoom.resetZoom();
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
          if (typeof closeViewer === 'function') closeViewer();
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

    if (e.changedTouches.length === 1 && (!zoom || zoom.getZoomLevel() <= 1.05)) {
      if (!touchStartY) return;
      const deltaX = e.changedTouches[0].clientX - touchStartX;
      const deltaY = e.changedTouches[0].clientY - touchStartY;
      const deltaTime = Date.now() - touchStartTime;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      if (absX > 50 && absX > absY * 1.5 && deltaTime < 450) {
        if (deltaX < 0) {
          if (typeof goToNext === 'function') goToNext(false);
        } else {
          if (typeof goToPrev === 'function') goToPrev(false);
        }
        return;
      }

      if (deltaY > 80 && absY > absX * 1.5 && deltaTime < 450) {
        haptic(25);
        if (typeof closeViewer === 'function') closeViewer();
        return;
      }

      if (absX < 12 && absY < 12 && deltaTime < 250) {
        const now = Date.now();
        const tapX = e.changedTouches[0].clientX;
        const tapY = e.changedTouches[0].clientY;
        if (now - lastTapTime < 300) {
          if (zoom) {
            zoom.toggleDoubleTapZoom(tapX, tapY);
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
  };

  mediaWrapper.addEventListener('touchstart', onTouchStart, { passive: true });
  mediaWrapper.addEventListener('touchmove', onTouchMove, { passive: false });
  mediaWrapper.addEventListener('touchend', onTouchEnd);

  return {
    destroy: () => {
      mediaWrapper.removeEventListener('touchstart', onTouchStart);
      mediaWrapper.removeEventListener('touchmove', onTouchMove);
      mediaWrapper.removeEventListener('touchend', onTouchEnd);
    }
  };
}
