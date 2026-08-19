export function setupImageZoom(img, { showToast }) {
  let zoomLevel = 1;
  let panX = 0;
  let panY = 0;
  let isDragging = false;
  let startX = 0;
  let startY = 0;

  function updateTransform() {
    if (!img) return;
    img.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
  }

  function resetZoom() {
    zoomLevel = 1;
    panX = 0;
    panY = 0;
    updateTransform();
  }

  function toggleDoubleTapZoom() {
    zoomLevel = zoomLevel === 1 ? 2.2 : 1;
    panX = 0;
    panY = 0;
    updateTransform();
  }

  function setPinchZoom(factor, initialZoom) {
    zoomLevel = Math.min(Math.max(0.8, initialZoom * factor), 4.5);
    updateTransform();
  }

  function setPan(dx, dy) {
    panX = dx;
    panY = dy;
    updateTransform();
  }

  img.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY * -0.0015;
    zoomLevel = Math.min(Math.max(0.5, zoomLevel + delta), 4.5);
    updateTransform();
  });

  img.addEventListener('mousedown', (e) => {
    if (zoomLevel > 1) {
      isDragging = true;
      startX = e.clientX - panX;
      startY = e.clientY - panY;
      img.classList.add('dragging');
    }
  });

  const onMouseMove = (e) => {
    if (!isDragging) return;
    panX = e.clientX - startX;
    panY = e.clientY - startY;
    updateTransform();
  };

  const onMouseUp = () => {
    if (isDragging) {
      isDragging = false;
      img.classList.remove('dragging');
    }
  };

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  img.addEventListener('dblclick', () => {
    toggleDoubleTapZoom();
  });

  return {
    resetZoom,
    toggleDoubleTapZoom,
    setPinchZoom,
    setPan,
    getZoomLevel: () => zoomLevel,
    getPan: () => ({ panX, panY }),
    destroy: () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }
  };
}
