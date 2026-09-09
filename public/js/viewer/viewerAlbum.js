import { state } from '../state.js';
import { fetchAlbumPosts, getProxiedUrl } from '../api.js';
import { downloadManager } from '../modules/downloadManager.js';
import { showToast, haptic } from '../modules/uiUtils.js';
import { t } from '../i18n.js';

const preloadedUrls = new Set();
let albumFetchSeq = 0;

let albumContext = {
  getCurrentPost: () => null,
  getAlbumIndex: () => 0,
  setAlbumIndex: () => {},
  loadMediaItem: () => {},
  renderSidebarContent: () => {},
  updateNavButtons: () => {}
};

/**
 * Configure shared viewer context for album state and operations.
 * @param {{ getCurrentPost: () => Object, getAlbumIndex: () => number, setAlbumIndex: (idx: number) => void, loadMediaItem: Function, renderSidebarContent: Function, updateNavButtons: Function }} ctx
 */
export function configureAlbum(ctx) {
  albumContext = { ...albumContext, ...ctx };
}

/**
 * Returns the currently active media item for a post (current album slide or post itself).
 * @param {Object} [post]
 * @param {number} [albumIndex]
 * @returns {Object|null}
 */
export function getCurrentMediaItem(post, albumIndex) {
  const p = post || albumContext.getCurrentPost?.();
  const idx = (albumIndex !== undefined) ? albumIndex : (albumContext.getAlbumIndex ? albumContext.getAlbumIndex() : 0);
  if (p?.isAlbum && Array.isArray(p.albumItems) && p.albumItems.length > 0) {
    return p.albumItems[idx] || p;
  }
  return p;
}

/**
 * Resolves the displayable media URL for an album item, proxying if necessary.
 * @param {Object} item
 * @returns {string}
 */
export function getMediaItemUrl(item) {
  if (!item) return '';
  const directMedia = item.sampleUrl || item.fileUrl || item.previewUrl || '';
  const isBooru = item.site === 'allgirl' || directMedia.includes('booru.org');
  const hasCustomAllgirlProxy = Boolean(state.settings?.allgirlProxy || state.settings?.globalProxy);
  const needsImgProxy = (item.site === 'danbooru' || directMedia.includes('donmai.us'))
    ? true
    : (isBooru ? hasCustomAllgirlProxy : (state.settings?.proxyFullImages !== false));
  return needsImgProxy ? getProxiedUrl(directMedia) : directMedia;
}

/**
 * Preloads a single image URL in the background.
 * @param {string} url
 */
export function preloadSingleUrl(url) {
  if (!url || preloadedUrls.has(url)) return;
  preloadedUrls.add(url);
  if (preloadedUrls.size > 60) {
    const first = preloadedUrls.values().next().value;
    preloadedUrls.delete(first);
  }
  const img = new Image();
  img.referrerPolicy = 'no-referrer';
  img.src = url;
  if ('decode' in img) {
    img.decode().catch(() => {});
  }
}

/**
 * Preloads neighboring slides of the current album and adjacent gallery items.
 * @param {Object} [post]
 * @param {number} [albumIndex]
 */
export function preloadAdjacentMedia(post, albumIndex) {
  const curPost = post || albumContext.getCurrentPost?.();
  const curIdx = (albumIndex !== undefined) ? albumIndex : (albumContext.getAlbumIndex ? albumContext.getAlbumIndex() : 0);
  if (!curPost) return;

  // 1. If currently in an album, preload neighboring album slides
  if (curPost.isAlbum && Array.isArray(curPost.albumItems) && curPost.albumItems.length > 1) {
    const items = curPost.albumItems;
    if (curIdx + 1 < items.length) {
      preloadSingleUrl(getMediaItemUrl(items[curIdx + 1]));
    }
    if (curIdx + 2 < items.length) {
      preloadSingleUrl(getMediaItemUrl(items[curIdx + 2]));
    }
    if (curIdx - 1 >= 0) {
      preloadSingleUrl(getMediaItemUrl(items[curIdx - 1]));
    }
  }

  // 2. Preload neighboring posts in the gallery
  const list = (state.displayedPosts && state.displayedPosts.length > 0) ? state.displayedPosts : state.posts;
  if (!Array.isArray(list) || list.length === 0 || state.currentViewerIndex < 0) return;

  const postIdx = state.currentViewerIndex;
  for (let offset = 1; offset <= 2; offset++) {
    const nextPost = list[postIdx + offset];
    if (nextPost && !nextPost.isVideo) {
      const activeItem = (nextPost.isAlbum && nextPost.albumItems?.[0]) ? nextPost.albumItems[0] : nextPost;
      preloadSingleUrl(getMediaItemUrl(activeItem));
    }
  }
  if (postIdx - 1 >= 0) {
    const prevPost = list[postIdx - 1];
    if (prevPost && !prevPost.isVideo) {
      const activeItem = (prevPost.isAlbum && prevPost.albumItems?.[0]) ? prevPost.albumItems[0] : prevPost;
      preloadSingleUrl(getMediaItemUrl(activeItem));
    }
  }
}

/**
 * Renders the album thumbnails filmstrip at the bottom of the viewer.
 * @param {Object} [post]
 * @param {number} [albumIndex]
 * @param {Object} [options={}]
 */
export function renderAlbumFilmstrip(post, albumIndex, options = {}) {
  const viewerAlbumFilmstrip = document.getElementById('viewerAlbumFilmstrip');
  const albumFilmstripInner = document.getElementById('albumFilmstripInner');
  const viewerContent = document.querySelector('.viewer-content');
  const viewerAlbumBadge = document.getElementById('viewerAlbumBadge');
  const viewerAlbumPageText = document.getElementById('viewerAlbumPageText');
  const btnDownloadAlbum = document.getElementById('btnDownloadAlbum');
  const btnDownloadAlbumSidebar = document.getElementById('btnDownloadAlbumSidebar');
  const infoAlbumRow = document.getElementById('infoAlbumRow');
  const btnFetchFullAlbumText = document.getElementById('btnFetchFullAlbumText');

  if (!viewerAlbumFilmstrip || !albumFilmstripInner) return;

  const currentPost = post || albumContext.getCurrentPost?.();
  const currentAlbumIndex = (albumIndex !== undefined) ? albumIndex : (albumContext.getAlbumIndex ? albumContext.getAlbumIndex() : 0);
  const isAlbum = Boolean(currentPost?.isAlbum && Array.isArray(currentPost.albumItems) && currentPost.albumItems.length > 1);

  if (isAlbum) {
    if (viewerContent) {
      viewerContent.classList.add('has-album');
    }
    viewerAlbumFilmstrip.style.display = 'block';
    if (viewerAlbumBadge && viewerAlbumPageText) {
      viewerAlbumBadge.style.display = 'inline-flex';
      viewerAlbumPageText.textContent = `${currentAlbumIndex + 1} / ${currentPost.albumItems.length}`;
    }
    if (btnDownloadAlbum) {
      btnDownloadAlbum.style.display = 'inline-flex';
    }
    if (btnDownloadAlbumSidebar) {
      btnDownloadAlbumSidebar.style.display = 'inline-flex';
    }

    albumFilmstripInner.innerHTML = '';
    currentPost.albumItems.forEach((item, idx) => {
      const itemDiv = document.createElement('div');
      itemDiv.className = `album-filmstrip-item ${idx === currentAlbumIndex ? 'active' : ''}`;
      itemDiv.title = t('vw.albumImageTitle', 'Изображение {n} из {total}').replace('{n}', idx + 1).replace('{total}', currentPost.albumItems.length);

      let thumbUrl = item.thumb180 || item.thumb360 || item.previewUrl || item.sampleUrl || item.fileUrl || '';
      // Extracted archive videos serve the raw mp4 as thumb: swap it for an FFmpeg frame
      if (item.isVideo && thumbUrl.startsWith('/api/archive/file')) {
        thumbUrl = `/api/video-thumbnail?url=${encodeURIComponent(thumbUrl)}&quality=low`;
      }
      const isBooruThumb = item.site === 'allgirl' || thumbUrl.includes('booru.org');
      const hasCustomAllgirlProxy = Boolean(state.settings?.allgirlProxy || state.settings?.globalProxy);
      const needsThumbProxy = (item.site === 'danbooru' || thumbUrl.includes('donmai.us'))
        ? true
        : (isBooruThumb ? hasCustomAllgirlProxy : (state.settings?.proxyThumbnails !== false));
      const thumbSrc = thumbUrl ? (thumbUrl.startsWith('/api/') ? thumbUrl : (needsThumbProxy ? getProxiedUrl(thumbUrl) : thumbUrl)) : '';

      itemDiv.innerHTML = `
        <img class="album-filmstrip-img" src="${thumbSrc}" alt="${t('vw.slideAlt', 'Слайд {n}').replace('{n}', idx + 1)}" loading="lazy" referrerpolicy="no-referrer">
        <span class="album-filmstrip-page">${idx + 1}</span>
      `;

      itemDiv.addEventListener('click', (e) => {
        e.stopPropagation();
        haptic(10);
        switchAlbumSlide(idx, options);
      });

      albumFilmstripInner.appendChild(itemDiv);
    });

    // Scroll the active item into view
    const activeThumb = albumFilmstripInner.children[currentAlbumIndex];
    if (activeThumb) {
      activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  } else {
    if (viewerContent) viewerContent.classList.remove('has-album');
    viewerAlbumFilmstrip.style.display = 'none';
    if (viewerAlbumBadge) viewerAlbumBadge.style.display = 'none';
    if (btnDownloadAlbum) btnDownloadAlbum.style.display = 'none';
    if (btnDownloadAlbumSidebar) btnDownloadAlbumSidebar.style.display = 'none';
  }

  // Whether a series exists for lazy loading in the sidebar
  if (infoAlbumRow) {
    const canFetch = Boolean(currentPost?.canFetchAlbum || currentPost?.hasChildren || currentPost?.parentId || currentPost?.seriesKey);
    infoAlbumRow.style.display = canFetch ? 'flex' : 'none';
    if (btnFetchFullAlbumText) {
      if (isAlbum) {
        btnFetchFullAlbumText.textContent = t('vw.refreshSet', 'Обновить сет ({n} фото)').replace('{n}', currentPost.albumItems.length);
      } else {
        btnFetchFullAlbumText.textContent = t('viewer.findFullSet', 'Найти все части сета');
      }
    }
  }
}

/**
 * Switches the active album slide by index.
 * @param {number} idx
 * @param {Object} [options={}]
 */
export function switchAlbumSlide(idx, options = {}) {
  const currentPost = options.currentPost || albumContext.getCurrentPost?.();
  if (!currentPost?.albumItems || idx < 0 || idx >= currentPost.albumItems.length) return;

  if (typeof options.setAlbumIndex === 'function') {
    options.setAlbumIndex(idx);
  } else if (albumContext.setAlbumIndex) {
    albumContext.setAlbumIndex(idx);
  }

  const currentAlbumIndex = idx;
  const viewerAlbumPageText = document.getElementById('viewerAlbumPageText');
  const albumFilmstripInner = document.getElementById('albumFilmstripInner');
  const resBadge = document.getElementById('viewerResolution');
  const extBadge = document.getElementById('viewerExtBadge');

  // Update the page badge
  if (viewerAlbumPageText) {
    viewerAlbumPageText.textContent = `${currentAlbumIndex + 1} / ${currentPost.albumItems.length}`;
  }

  // Update the active class in the thumbnail filmstrip
  if (albumFilmstripInner) {
    Array.from(albumFilmstripInner.children).forEach((child, i) => {
      child.classList.toggle('active', i === currentAlbumIndex);
    });
    const activeThumb = albumFilmstripInner.children[currentAlbumIndex];
    if (activeThumb) {
      activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }

  const activeItem = currentPost.albumItems[currentAlbumIndex];
  if (resBadge) resBadge.textContent = (activeItem.width && activeItem.height) ? `${activeItem.width} × ${activeItem.height}` : t('vw.original', 'Оригинал');
  if (extBadge) extBadge.textContent = (activeItem.fileExt || 'JPG').toUpperCase();

  if (typeof options.onSlideChanged === 'function') {
    options.onSlideChanged(activeItem, currentAlbumIndex);
  } else {
    if (albumContext.renderSidebarContent) albumContext.renderSidebarContent(activeItem || currentPost);
    if (albumContext.updateNavButtons) albumContext.updateNavButtons();
    if (albumContext.loadMediaItem) albumContext.loadMediaItem(activeItem);
  }
}

/**
 * Asynchronously loads all parts/slides of a series or set for a post.
 * @param {Object} targetPost
 * @param {boolean} [isUserExplicit=false]
 * @param {Object} [options={}]
 */
export async function loadFullAlbumForPost(targetPost, isUserExplicit = false, options = {}) {
  if (!targetPost || targetPost.site === 'pawchive' || targetPost.site === 'kemono') return;
  const canFetch = Boolean(targetPost.canFetchAlbum || targetPost.hasChildren || targetPost.parentId || (targetPost.seriesKey && !targetPost.seriesKey.startsWith('pawchive:') && !targetPost.seriesKey.startsWith('kemono:')) || targetPost.pixiv_id);
  if (!canFetch) return;
  if (targetPost._albumFetchInProgress) return;

  targetPost._albumFetchInProgress = true;
  const currentSeq = ++albumFetchSeq;

  const btnFetchFullAlbum = document.getElementById('btnFetchFullAlbum');
  const btnFetchFullAlbumText = document.getElementById('btnFetchFullAlbumText');

  if (btnFetchFullAlbum) btnFetchFullAlbum.disabled = true;
  if (btnFetchFullAlbumText) btnFetchFullAlbumText.textContent = t('vw.searchingSeries', 'Поиск серии...');

  try {
    const res = await fetchAlbumPosts({
      site: targetPost.site,
      seriesKey: targetPost.seriesKey || '',
      parentId: targetPost.parentId || '',
      originalId: targetPost.originalId || '',
      postUrl: targetPost.postUrl || ''
    });

    const currentPost = options.currentPost || albumContext.getCurrentPost?.();
    if (currentSeq !== albumFetchSeq && currentPost?.id !== targetPost.id) {
      return;
    }

    targetPost._albumFullyFetched = true;

    if (res.success && Array.isArray(res.albumItems) && res.albumItems.length > 0) {
      const prevAlbumCount = targetPost.albumItems?.length || 1;
      targetPost.isAlbum = true;
      targetPost.albumItems = res.albumItems;
      targetPost.albumCount = res.albumItems.length;
      if (!targetPost.content && res.albumItems[0]?.content) {
        targetPost.content = res.albumItems[0].content;
      }

      // Always start album from the very first photo (slide 0 / index 0)
      const firstItem = res.albumItems[0];
      if (firstItem) {
        if (firstItem.previewUrl) targetPost.previewUrl = firstItem.previewUrl;
        if (firstItem.thumb180) targetPost.thumb180 = firstItem.thumb180;
        if (firstItem.thumb360) targetPost.thumb360 = firstItem.thumb360;
        if (firstItem.thumb720) targetPost.thumb720 = firstItem.thumb720;
        if (firstItem.sampleUrl) targetPost.sampleUrl = firstItem.sampleUrl;
        if (firstItem.fileUrl) targetPost.fileUrl = firstItem.fileUrl;
      }

      if (albumContext.setAlbumIndex) albumContext.setAlbumIndex(0);

      // Sync the updated album back into global gallery state
      const list = (state.displayedPosts && state.displayedPosts.length > 0) ? state.displayedPosts : state.posts;
      if (state.currentViewerIndex >= 0 && state.currentViewerIndex < list.length && list[state.currentViewerIndex]?.id === targetPost.id) {
        list[state.currentViewerIndex] = targetPost;
      }
      if (Array.isArray(state.posts)) {
        const origIdx = state.posts.findIndex(p => p.id === targetPost.id);
        if (origIdx !== -1) {
          state.posts[origIdx] = targetPost;
        }
      }

      // Update the card badge and preview in the gallery DOM
      const cardEl = document.querySelector(`.media-card[data-post-id="${targetPost.id}"]`);
      if (cardEl) {
        cardEl.classList.add('is-album-card');
        if (firstItem) {
          const imgEl = cardEl.querySelector('.media-thumb');
          const newThumb = firstItem.thumb360 || firstItem.previewUrl || firstItem.fileUrl;
          if (imgEl && newThumb) {
            imgEl.src = getProxiedUrl(newThumb);
          }
        }
        const topGroup = cardEl.querySelector('.badge-group-top > div');
        let badgeAlbum = topGroup ? topGroup.querySelector('.badge-album') : null;
        if (!badgeAlbum && topGroup) {
          badgeAlbum = document.createElement('span');
          badgeAlbum.className = 'badge-format badge-album';
          const siteBadgeEl = topGroup.querySelector('.badge-site');
          if (siteBadgeEl) {
            topGroup.insertBefore(badgeAlbum, siteBadgeEl.nextSibling);
          } else {
            topGroup.prepend(badgeAlbum);
          }
        }
        if (badgeAlbum) {
          badgeAlbum.title = t('gal.albumBadge.title', 'Альбом: {n} изображений').replace('{n}', res.albumItems.length);
          badgeAlbum.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24"><use href="#ic-album"/></svg> <span>${res.albumItems.length}</span>`;
        }
      }

      // Re-render viewer UI if the user is currently viewing this post
      if (currentPost?.id === targetPost.id) {
        renderAlbumFilmstrip(targetPost, 0, options);
        switchAlbumSlide(0, options);
        if (btnFetchFullAlbumText) {
          btnFetchFullAlbumText.textContent = t('vw.refreshSet', 'Обновить сет ({n} фото)').replace('{n}', targetPost.albumItems.length);
        }
        if (isUserExplicit && res.albumItems.length > prevAlbumCount) {
          showToast(t('vw.seriesFound', 'Найдено {n} изображений серии!').replace('{n}', res.albumItems.length));
        }
      }
    } else {
      if (isUserExplicit) {
        showToast(t('vw.seriesNone', 'Дополнительные части серии не найдены'));
      }
      if (btnFetchFullAlbumText) btnFetchFullAlbumText.textContent = t('vw.seriesPartsNone', 'Части серии не найдены');
    }
  } catch (err) {
    console.error('Ошибка поиска альбома:', err);
    if (isUserExplicit) {
      showToast(t('vw.seriesSearchFailed', 'Не удалось выполнить поиск частей серии'));
    }
  } finally {
    targetPost._albumFetchInProgress = false;
    if (btnFetchFullAlbum) btnFetchFullAlbum.disabled = false;
  }
}

/**
 * Downloads all images in an album sequentially.
 * @param {Object} currentPost
 */
export async function downloadFullAlbum(currentPost) {
  if (!currentPost || !currentPost.isAlbum || !Array.isArray(currentPost.albumItems) || currentPost.albumItems.length === 0) return;
  haptic(20);
  showToast(t('vw.albumDownloadStart', 'Начато скачивание альбома ({n} файлов)...').replace('{n}', currentPost.albumItems.length));

  for (let i = 0; i < currentPost.albumItems.length; i++) {
    const item = currentPost.albumItems[i];
    const downloadTarget = item.fileUrl || item.sampleUrl || item.previewUrl;
    if (!downloadTarget) continue;

    if (downloadTarget.startsWith('/api/archive/file')) {
      const dlUrl = downloadTarget.includes('?') ? `${downloadTarget}&download=1` : `${downloadTarget}?download=1`;
      const a = document.createElement('a');
      const baseId = currentPost.id || currentPost.originalId || 'album';
      a.href = dlUrl;
      a.download = item.title || `album_${currentPost.site || 'post'}_${baseId}_p${i + 1}.${item.fileExt || (item.isVideo ? 'mp4' : 'jpg')}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise(r => setTimeout(r, 250));
      continue;
    }

    try {
      const proxyUrl = getProxiedUrl(downloadTarget);
      const res = await fetch(proxyUrl);
      if (res.ok) {
        const blob = await res.blob();
        const ext = item.fileExt || (item.isVideo ? 'mp4' : 'jpg');
        const baseId = currentPost.id || currentPost.originalId || 'album';
        const filename = `album_${currentPost.site || 'post'}_${baseId}_p${i + 1}.${ext}`;
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      }
    } catch (err) {
      console.warn(`[Album download err on page ${i + 1}]`, err);
    }
    await new Promise(r => setTimeout(r, 350));
  }
  showToast(t('vw.albumDownloaded', 'Все изображения альбома загружены'));
}

/**
 * Downloads a single media item (image, video, or archive file) to the local device.
 * @param {Object} item - Active media item or post.
 * @param {Object} [currentPost] - Parent post.
 */
export async function downloadSingleMedia(item, currentPost) {
  const activeItem = item || currentPost;
  if (!activeItem) return;

  const downloadTarget = activeItem.fileUrl || activeItem.sampleUrl || activeItem.previewUrl;
  if (!downloadTarget) {
    showToast(t('vw.fileLinkUnavailable', 'Ссылка на файл недоступна'));
    return;
  }

  const isZipArchive = activeItem.fileExt === 'zip' || downloadTarget.toLowerCase().includes('.zip') || (Array.isArray(activeItem.archiveUrls) && activeItem.archiveUrls.length > 0);
  if (isZipArchive) {
    const targetArchiveUrl = (Array.isArray(activeItem.archiveUrls) && activeItem.archiveUrls[0]) || downloadTarget;
    const filename = (Array.isArray(activeItem.archiveNames) && activeItem.archiveNames[0]) || `booru_${activeItem.site || 'archive'}_${activeItem.id || 'pack'}.zip`;
    const size = (Array.isArray(activeItem.archiveSizes) && activeItem.archiveSizes[0]) || 0;
    downloadManager.startDownload({ url: targetArchiveUrl, filename, size, isZip: true });
    return;
  }

  showToast(t('vw.downloadStarted', 'Начата загрузка на устройство...'));

  if (downloadTarget.startsWith('/api/archive/file')) {
    const dlUrl = downloadTarget.includes('?') ? `${downloadTarget}&download=1` : `${downloadTarget}?download=1`;
    const a = document.createElement('a');
    a.href = dlUrl;
    a.download = activeItem.title || `file_${activeItem.originalId || activeItem.id}.${activeItem.fileExt || (activeItem.isVideo ? 'mp4' : 'jpg')}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast(t('vw.savedToDevice', 'Файл сохранён в память устройства'));
    return;
  }

  const getExtensionFromMime = (mimeType, fallbackExt) => {
    if (!mimeType) return fallbackExt || 'jpg';
    const low = mimeType.toLowerCase();
    if (low.includes('png')) return 'png';
    if (low.includes('jpeg') || low.includes('jpg')) return 'jpg';
    if (low.includes('webp')) return 'webp';
    if (low.includes('gif')) return 'gif';
    if (low.includes('mp4')) return 'mp4';
    if (low.includes('webm')) return 'webm';
    return fallbackExt || 'jpg';
  };

  const shouldUseProxyDownload = activeItem.site === 'danbooru' || downloadTarget.includes('donmai.us') || state.settings?.proxyDownloads !== false;

  if (!shouldUseProxyDownload) {
    try {
      const directRes = await fetch(downloadTarget, { mode: 'cors' });
      if (directRes.ok) {
        const blob = await directRes.blob();
        const ext = getExtensionFromMime(blob.type, activeItem.fileExt || (activeItem.isVideo ? 'mp4' : 'jpg'));
        const filename = `booru_${activeItem.site || 'post'}_${activeItem.id}.${ext}`;
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
        showToast(t('vw.savedFromCdn', 'Файл сохранён напрямую с CDN'));
        return;
      }
    } catch (directErr) {
      console.warn('[Direct download failed, switching to proxy]', directErr);
    }
  }

  try {
    const proxyUrl = getProxiedUrl(downloadTarget);
    const res = await fetch(proxyUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const ext = getExtensionFromMime(blob.type, activeItem.fileExt || (activeItem.isVideo ? 'mp4' : 'jpg'));
    const filename = `booru_${activeItem.site || 'post'}_${activeItem.id}.${ext}`;
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    showToast(t('vw.savedToDevice', 'Файл сохранён в память устройства'));
  } catch (err) {
    console.warn('[Download error]', err);
    showToast(t('vw.downloadFailed', 'Не удалось загрузить файл для сохранения'));
  }
}
