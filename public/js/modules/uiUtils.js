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
  if (post.postUrl) return post.postUrl;
  if (post.pageUrl) return post.pageUrl;

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
    return `https://konachan.net/post/show/${origId}`;
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

  if (post.source && /^https?:\/\//i.test(post.source)) {
    return post.source;
  }

  return post.fileUrl || post.sampleUrl || '';
}

