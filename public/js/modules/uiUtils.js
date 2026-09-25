import { t } from '../i18n.js';

export const isMyLiveDemoHost = false;
export const isVercelHost = false;

export function syncThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const color = getComputedStyle(document.documentElement).getPropertyValue('--bg-main').trim();
  if (color) meta.setAttribute('content', color);
}

export function haptic(pattern = 12) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch (e) {}
  }
}

/**
 * Toasts and card badges interpolate tag names, author names and descriptions coming
 * from the Booru APIs into innerHTML, so those strings have to be escaped first.
 * Tags such as `*: <meta>` would otherwise break the markup.
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function toSafeHttpUrl(value, { allowMailto = false } = {}) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const base = typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost';
    const parsed = new URL(value, base);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
    if (allowMailto && parsed.protocol === 'mailto:') return parsed.href;
    return '';
  } catch {
    return '';
  }
}

export function toSafeImageUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const trimmed = value.trim();
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=]+$/i.test(trimmed)) return trimmed;
  if (/^data:image\/svg\+xml(?:;charset=utf-8)?,/i.test(trimmed)) {
    const markup = decodeURIComponent(trimmed.slice(trimmed.indexOf(',') + 1));
    if (!/<\s*script|on[a-z]+\s*=|foreignObject|javascript:/i.test(markup)) return trimmed;
  }
  return toSafeHttpUrl(trimmed);
}

export function toSafeCssColor(value, fallback = 'var(--text-muted)') {
  return typeof value === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|var\(--[a-z0-9-]+\))$/i.test(value.trim())
    ? value.trim()
    : fallback;
}

export function showToast(message) {
  const toastContainer = document.getElementById('toastContainer');
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
    <span>${escapeHtml(message)}</span>
  `;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.2s ease-out';
    setTimeout(() => toast.remove(), 200);
  }, 2400);
}

export function showActionToast(message, actionLabel, onAction, duration = 6000) {
  const toastContainer = document.getElementById('toastContainer');
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <span>${escapeHtml(message)}</span>
    <button type="button" class="toast-action-btn">${escapeHtml(actionLabel)}</button>
  `;
  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.2s ease-out';
    setTimeout(() => toast.remove(), 200);
  };
  const timer = setTimeout(dismiss, duration);
  toast.querySelector('.toast-action-btn').addEventListener('click', () => {
    clearTimeout(timer);
    dismiss();
    if (typeof onAction === 'function') onAction();
  });
  toastContainer.appendChild(toast);
}

export function copyToClipboard(text) {
  if (!text) return Promise.resolve(false);
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text)
      .then(() => true)
      .catch(() => fallbackCopyTextToClipboard(text));
  }
  return Promise.resolve(fallbackCopyTextToClipboard(text));
}

function fallbackCopyTextToClipboard(text) {
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.error('Fallback clipboard error:', err);
    return false;
  }
}

export function getPostSiteUrl(post) {
  if (!post) return '';
  if (post.postUrl) return toSafeHttpUrl(post.postUrl);
  if (post.pageUrl) return toSafeHttpUrl(post.pageUrl);

  const site = (post.site || '').toLowerCase();
  const origId = post.originalId || (post.id ? String(post.id).replace(/^[a-z0-9]+_/, '') : '');

  if (site === 'danbooru' && origId) {
    return `https://danbooru.donmai.us/posts/${origId}`;
  }
  if (site === 'rule34video') {
    if (post.source && /^https?:\/\/(?:www\.)?rule34video\.com\//i.test(post.source)) {
      return post.source;
    }
    if (origId) return `https://rule34video.com/videos/${origId}/`;
  }
  if (site === 'yandere' && origId) {
    return `https://yande.re/post/show/${origId}`;
  }
  if (site === 'konachan' && origId) {
    return `https://konachan.com/post/show/${origId}`;
  }
  if (site === 'safebooru' && origId) {
    return `https://safebooru.org/index.php?page=post&s=view&id=${origId}`;
  }
  if (site === 'rule34') {
    const isPaheal = (post.id && String(post.id).startsWith('paheal_')) || 
                     (post.fileUrl && post.fileUrl.includes('paheal')) ||
                     (post.previewUrl && post.previewUrl.includes('paheal'));
    if (isPaheal && origId) {
      return `https://rule34.paheal.net/post/view/${origId}`;
    }
    if (origId) {
      return `https://rule34.xxx/index.php?page=post&s=view&id=${origId}`;
    }
  }
  if (site === 'gelbooru' && origId) {
    return `https://gelbooru.com/index.php?page=post&s=view&id=${origId}`;
  }
  if (site === 'xbooru' && origId) {
    return `https://xbooru.com/index.php?page=post&s=view&id=${origId}`;
  }
  if (site === 'hypnohub' && origId) {
    return `https://hypnohub.net/index.php?page=post&s=view&id=${origId}`;
  }
  if (site === 'tbib' && origId) {
    return `https://tbib.org/index.php?page=post&s=view&id=${origId}`;
  }
  if (site === 'pawchive') {
    if (post.postUrl) return post.postUrl;
    if (origId) return `https://pawchive.pw/posts`;
  }
  if (site === 'kemono') {
    if (post.postUrl) return post.postUrl;
    if (post.source && /^https?:\/\/(?:www\.)?kemono\./i.test(post.source)) return post.source;
    if (origId) return `https://kemono.cr`;
  }

  if (post.source && /^https?:\/\//i.test(post.source)) {
    return toSafeHttpUrl(post.source);
  }

  return toSafeHttpUrl(post.fileUrl || post.sampleUrl || '');
}

export function formatBytes(bytes, decimals = 1) {
  if (!bytes || isNaN(bytes) || bytes <= 0) return '0 ' + t('unit.b', 'Б');
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = [t('unit.b', 'Б'), t('unit.kb', 'КБ'), t('unit.mb', 'МБ'), t('unit.gb', 'ГБ'), t('unit.tb', 'ТБ')];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  if (i >= sizes.length) return (bytes / Math.pow(k, sizes.length - 1)).toFixed(dm) + ' ' + sizes[sizes.length - 1];
  const val = (bytes / Math.pow(k, i)).toFixed(dm);
  return (val.endsWith('.0') ? val.slice(0, -2) : val) + ' ' + sizes[i];
}

// Single video-extension check (previously duplicated in gallery.js, network.js, etc.)
export function isVideoMediaUrl(url) {
  if (!url) return false;
  const clean = url.split('?')[0].toLowerCase();
  return clean.endsWith('.mp4') || clean.endsWith('.webm') ||
         clean.endsWith('.mkv') || clean.endsWith('.mov') || clean.endsWith('.m4v');
}

/**
 * Card templates render the duration badge only when the duration is known at render
 * time, so duration probes and metadata resolves have to upsert it afterwards.
 * Styling lives in `.badge-format.badge-duration` to keep both paths identical.
 */
export function upsertCardDurationBadge(cardEl, durationText) {
  if (!cardEl || !durationText) return;

  let badge = cardEl.querySelector('.badge-duration');
  if (!badge) {
    const badgeRow = cardEl.querySelector('.badge-group-top > div');
    if (!badgeRow) return;
    badge = document.createElement('span');
    badge.className = 'badge-format badge-duration';
    badgeRow.appendChild(badge);
  }

  badge.textContent = durationText;
  badge.setAttribute('title', t('gal.durationBadge.title', 'Длительность: {d}').replace('{d}', durationText));
}

