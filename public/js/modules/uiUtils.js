export const isMyLiveDemoHost = false;
export const isVercelHost = false;

export function haptic(pattern = 12) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch (e) {}
  }
}

export function showToast(message) {
  const toastContainer = document.getElementById('toastContainer');
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
    <span>${message}</span>
  `;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.2s ease-out';
    setTimeout(() => toast.remove(), 200);
  }, 2400);
}

export function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0.0 Б';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
