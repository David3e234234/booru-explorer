export function setupImageZoom(img, { showToast } = {}) {
  if (!img) return null;

  let zoomLevel = 1;
  let panX = 0;
  let panY = 0;

  let isMouseDragging = false;
  let mouseStartX = 0;
  let mouseStartY = 0;

  let isTouchDragging = false;
  let touchStartX = 0;
  let touchStartY = 0;

  let isPinching = false;
  let initialPinchDist = 0;
  let initialZoom = 1;
  let pinchMidX = 0;
  let pinchMidY = 0;

  function updateTransform(animate = true) {
    if (!img) return;
    if (animate) {
      img.style.transition = 'transform 0.22s cubic-bezier(0.2, 0, 0.2, 1)';
    } else {
      img.style.transition = 'none';
    }

    if (zoomLevel > 1.005 || panX !== 0 || panY !== 0) {
      img.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${zoomLevel})`;
      img.classList.add('zoomed');
    } else {
      img.style.transform = '';
      img.classList.remove('zoomed');
    }
  }

  function clampPan() {
    if (zoomLevel <= 1.02) {
      panX = 0;
      panY = 0;
      return;
    }

    const container = img.parentElement || document.body;
    const contRect = container.getBoundingClientRect();
    const imgNaturalW = img.offsetWidth || img.naturalWidth || contRect.width;
    const imgNaturalH = img.offsetHeight || img.naturalHeight || contRect.height;

    const curW = imgNaturalW * zoomLevel;
    const curH = imgNaturalH * zoomLevel;

    // Максимально допустимое панорамирование (половина видимого превышения) + мягкий запас 40px
    const maxPanX = Math.max(0, (curW - contRect.width) / 2) + 40;
    const maxPanY = Math.max(0, (curH - contRect.height) / 2) + 40;

    panX = Math.max(-maxPanX, Math.min(maxPanX, panX));
    panY = Math.max(-maxPanY, Math.min(maxPanY, panY));
  }

  function zoomToPoint(targetZoom, clientX, clientY, animate = true) {
    const newZoom = Math.min(5.0, Math.max(1.0, targetZoom));

    if (newZoom <= 1.02) {
      resetZoom();
      return;
    }

    if (typeof clientX === 'number' && typeof clientY === 'number') {
      const container = img.parentElement || img;
      const contRect = container.getBoundingClientRect();
      const cx = clientX - (contRect.left + contRect.width / 2);
      const cy = clientY - (contRect.top + contRect.height / 2);

      const scaleRatio = newZoom / zoomLevel;
      panX = cx - (cx - panX) * scaleRatio;
      panY = cy - (cy - panY) * scaleRatio;
      zoomLevel = newZoom;
    } else {
      zoomLevel = newZoom;
    }

    clampPan();
    updateTransform(animate);
  }

  function resetZoom() {
    zoomLevel = 1;
    panX = 0;
    panY = 0;
    updateTransform(true);
  }

  function toggleDoubleTapZoom(clientX, clientY) {
    if (zoomLevel <= 1.05) {
      const targetX = typeof clientX === 'number' ? clientX : window.innerWidth / 2;
      const targetY = typeof clientY === 'number' ? clientY : window.innerHeight / 2;
      zoomToPoint(2.5, targetX, targetY, true);
    } else {
      resetZoom();
    }
  }

  function setPinchZoom(factor, initZoom) {
    zoomToPoint(initZoom * factor, pinchMidX, pinchMidY, false);
  }

  function setPan(dx, dy) {
    panX = dx;
    panY = dy;
    clampPan();
    updateTransform(false);
  }

  // Зум колесиком мыши с фокусом на курсоре
  const onWheel = (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.25 : 0.8;
    zoomToPoint(zoomLevel * factor, e.clientX, e.clientY, true);
  };

  // Перетаскивание мышью
  const onMouseDown = (e) => {
    if (zoomLevel > 1.02 && e.button === 0) {
      isMouseDragging = true;
      mouseStartX = e.clientX - panX;
      mouseStartY = e.clientY - panY;
      img.classList.add('dragging');
      e.preventDefault();
    }
  };

  const onMouseMove = (e) => {
    if (!isMouseDragging) return;
    panX = e.clientX - mouseStartX;
    panY = e.clientY - mouseStartY;
    clampPan();
    updateTransform(false);
  };

  const onMouseUp = () => {
    if (isMouseDragging) {
      isMouseDragging = false;
      img.classList.remove('dragging');
      updateTransform(true);
    }
  };

  const onDblClick = (e) => {
    e.preventDefault();
    toggleDoubleTapZoom(e.clientX, e.clientY);
  };

  // Сенсорные события для панорамирования и pinch-зума
  const onTouchStart = (e) => {
    if (e.touches.length === 1 && zoomLevel > 1.05) {
      isTouchDragging = true;
      isPinching = false;
      touchStartX = e.touches[0].clientX - panX;
      touchStartY = e.touches[0].clientY - panY;
      e.stopPropagation();
    } else if (e.touches.length === 2) {
      isPinching = true;
      isTouchDragging = false;
      initialPinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      initialZoom = zoomLevel;
      pinchMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      pinchMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      e.stopPropagation();
    }
  };

  const onTouchMove = (e) => {
    if (isPinching && e.touches.length === 2) {
      const curDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const factor = curDist / (initialPinchDist || 1);
      pinchMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      pinchMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      zoomToPoint(initialZoom * factor, pinchMidX, pinchMidY, false);
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
    } else if (isTouchDragging && e.touches.length === 1) {
      panX = e.touches[0].clientX - touchStartX;
      panY = e.touches[0].clientY - touchStartY;
      clampPan();
      updateTransform(false);
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
    }
  };

  const onTouchEnd = (e) => {
    if (isPinching) {
      if (e.touches.length < 2) isPinching = false;
      if (zoomLevel < 1.02) {
        resetZoom();
      } else {
        clampPan();
        updateTransform(true);
      }
      e.stopPropagation();
    } else if (isTouchDragging) {
      isTouchDragging = false;
      clampPan();
      updateTransform(true);
      e.stopPropagation();
    }
  };

  img.addEventListener('wheel', onWheel, { passive: false });
  img.addEventListener('mousedown', onMouseDown);
  img.addEventListener('dblclick', onDblClick);
  img.addEventListener('touchstart', onTouchStart, { passive: false });
  img.addEventListener('touchmove', onTouchMove, { passive: false });
  img.addEventListener('touchend', onTouchEnd, { passive: false });
  img.addEventListener('touchcancel', onTouchEnd, { passive: false });

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  return {
    resetZoom,
    toggleDoubleTapZoom,
    zoomToPoint,
    setPinchZoom,
    setPan,
    getZoomLevel: () => zoomLevel,
    getPan: () => ({ panX, panY }),
    destroy: () => {
      img.removeEventListener('wheel', onWheel);
      img.removeEventListener('mousedown', onMouseDown);
      img.removeEventListener('dblclick', onDblClick);
      img.removeEventListener('touchstart', onTouchStart);
      img.removeEventListener('touchmove', onTouchMove);
      img.removeEventListener('touchend', onTouchEnd);
      img.removeEventListener('touchcancel', onTouchEnd);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }
  };
}
