// Feed gesture layer: single tap toggles chrome, double tap likes,
// pinch zooms the active image, pull-down on the first slide closes the feed.
import { setupImageZoom } from '../viewer/imageZoom.js';

const TAP_SLOP_PX = 10;
const DOUBLE_TAP_MS = 280;
const CLOSE_DRAG_PX = 110;

export function createFeedGestures({
  track,
  getActiveSlide,
  onToggleChrome,
  onLike,
  onClose
}) {
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  let lastTapTime = 0;
  let singleTapTimer = null;

  let pullStartY = 0;
  let pulling = false;
  let pullPast = false;

  let zoomInst = null;      // imageZoom instance for the active slide
  let destroyed = false;

  function zoomed() {
    return zoomInst && zoomInst.getZoomLevel() > 1.05;
  }

  function isUiElement(target) {
    if (!target || typeof target.closest !== 'function') return true;
    return Boolean(
      target.closest('button, a, input, textarea, select, .feed-info, .feed-rail, .feed-sheet, .feed-video-controls, .feed-resolve')
    );
    // The media itself, scrims and dots stay gesture targets.
  }

  const attachZoomSafe = slide => {
    if (zoomInst) { zoomInst.destroy(); zoomInst = null; }
    const img = slide && slide.querySelector('.feed-img');
    if (!img) return;
    zoomInst = setupImageZoom(img, {});
  };

  function onActiveSlideChange(slide) {
    attachZoomSafe(slide);
  }

  function onTouchStart(e) {
    if (e.touches.length !== 1) { pulling = false; return; }
    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    touchStartTime = Date.now();
    pulling = false;
    pullPast = false;

    if (zoomed()) return; // imageZoom owns panning while zoomed

    const active = getActiveSlide();
    const atTop = active ? track.scrollTop <= 1 : true;
    if (atTop && !isUiElement(e.target)) {
      pullStartY = touch.clientY;
      pulling = true;
    }
  }

  function onTouchMove(e) {
    if (!pulling || e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - pullStartY;
    if (dy > 8 && track.scrollTop <= 1) {
      pullPast = true;
      if (e.cancelable) e.preventDefault();
      const d = Math.max(0, dy);
      track.style.setProperty('--feed-pull', String(Math.round(d)));
      track.classList.add('is-pulling');
    } else if (dy < -8) {
      pulling = false;
      track.classList.remove('is-pulling');
      track.style.removeProperty('--feed-pull');
    }
  }

  function finishPull() {
    track.classList.remove('is-pulling');
    track.style.removeProperty('--feed-pull');
  }

  function onTouchEnd(e) {
    if (e.touches.length > 0) return;
    const touch = e.changedTouches[0];
    if (!touch) return;

    if (pulling && pullPast) {
      const dy = touch.clientY - pullStartY;
      pulling = false;
      finishPull();
      if (dy > CLOSE_DRAG_PX) onClose();
      return;
    }
    pulling = false;

    if (zoomed()) return;

    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;
    const dt = Date.now() - touchStartTime;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (absX > TAP_SLOP_PX || absY > TAP_SLOP_PX || dt > 350) return; // swipe/scroll, not a tap

    if (isUiElement(e.target)) return; // buttons handle their own clicks

    // Non-UI tap: cancel the synthetic click/dblclick so neither the zoom
    // handler nor the card logic below reacts to a double tap.
    if (e.cancelable) e.preventDefault();

    const now = Date.now();
    if (now - lastTapTime < DOUBLE_TAP_MS) {
      // Double tap: like + heart burst at the tap point.
      if (singleTapTimer) { clearTimeout(singleTapTimer); singleTapTimer = null; }
      lastTapTime = 0;
      onLike(touch.clientX, touch.clientY);
      return;
    }
    lastTapTime = now;
    singleTapTimer = setTimeout(() => {
      if (destroyed) return;
      if (Date.now() - lastTapTime >= DOUBLE_TAP_MS - 20) {
        onToggleChrome();
      }
    }, DOUBLE_TAP_MS);
  }

  track.addEventListener('touchstart', onTouchStart, { passive: true });
  track.addEventListener('touchmove', onTouchMove, { passive: false });
  track.addEventListener('touchend', onTouchEnd);
  track.addEventListener('touchcancel', () => { pulling = false; finishPull(); });

  return {
    onActiveSlideChange,
    destroy() {
      destroyed = true;
      if (singleTapTimer) clearTimeout(singleTapTimer);
      if (zoomInst) { zoomInst.destroy(); zoomInst = null; }
      finishPull();
      track.removeEventListener('touchstart', onTouchStart);
      track.removeEventListener('touchmove', onTouchMove);
      track.removeEventListener('touchend', onTouchEnd);
    }
  };
}
