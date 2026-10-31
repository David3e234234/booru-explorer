import { state, addSearchTag, setFavoriteAuthors } from '../state.js';
import { deleteFavoriteAuthor, toggleFavoriteAuthor, fetchFavoriteAuthors, updateFavoriteAuthorPreview, syncFavoriteAuthors, fetchPosts, getProxiedUrl, shouldProxyMedia, updateAuthorNotificationSites } from '../api.js';
import { showToast, haptic, toSafeHttpUrl, toSafeCssColor, escapeHtml } from './uiUtils.js';
import { t } from '../i18n.js';

let currentPickerAuthor = null;
let coverPickerSeq = 0;
let onCoverUpdatedCallback = null;

let currentNotifAuthor = null;
let tempNotifSites = [];
let notifModalCallbacks = null;
let addAuthorNotifSites = new Set();

export function switchFavoritesSubTab(tab, { onSearch, onRenderAuthors }) {
  const btnFavSubPosts = document.getElementById('btnFavSubPosts');
  const btnFavSubAuthors = document.getElementById('btnFavSubAuthors');
  const favAuthorsActions = document.getElementById('favAuthorsActions');

  state.favoritesSubTab = tab;
  if (btnFavSubPosts) btnFavSubPosts.classList.toggle('active', tab === 'posts');
  if (btnFavSubAuthors) btnFavSubAuthors.classList.toggle('active', tab === 'authors');
  if (favAuthorsActions) favAuthorsActions.style.display = tab === 'authors' ? 'flex' : 'none';

  if (tab === 'authors') {
    if (onRenderAuthors) onRenderAuthors();
  } else {
    if (onSearch) onSearch(true);
  }
}

export function renderFavoriteAuthorsList(galleryInstance, { onExploreAuthor, onUpdateBadge }) {
  const favAuthorsSearchInput = document.getElementById('favAuthorsSearchInput');
  const profileAuthorsSearchInput = document.getElementById('profileAuthorsSearchInput');
  const query = (favAuthorsSearchInput?.value || profileAuthorsSearchInput?.value || '').trim().toLowerCase();
  let authors = [...state.favoriteAuthors];
  if (query) {
    authors = authors.filter(a =>
      (a.name || '').toLowerCase().includes(query) ||
      (a.displayName || '').toLowerCase().includes(query)
    );
  }
  galleryInstance.renderAuthorCards(authors, {
    onExplore: onExploreAuthor,
    onAddAuthor: openAddAuthorModal,
    onChangePreview: openCoverPickerModal,
    onConfigureNotifications: (author) => openAuthorNotifSourcesModal(author, galleryInstance, { onExploreAuthor, onUpdateBadge }),
    onDelete: async (author) => {
      if (!author || !author.name) return;
      try {
        const res = await deleteFavoriteAuthor(author.name);
        if (res.success) {
          const cleanName = (author.name || '').toLowerCase().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_');
          const updatedList = res.authors || state.favoriteAuthors.filter(a => (a.name || '').toLowerCase() !== cleanName);
          setFavoriteAuthors(updatedList);
          if (onUpdateBadge) onUpdateBadge();
          renderFavoriteAuthorsList(galleryInstance, { onExploreAuthor, onUpdateBadge });
          showToast(t('fav.authorRemoved', 'Автор {name} удален из любимых').replace('{name}', author.displayName || author.name));
        }
      } catch (err) {
        console.error('Ошибка удаления автора:', err);
        showToast(t('fav.authorDeleteFailed', 'Не удалось удалить автора'));
      }
    }
  });
}

export function openCoverPickerModal(author) {
  if (!author) return;
  currentPickerAuthor = author;
  const modalBackdrop = document.getElementById('modalPickAuthorCoverBackdrop');
  const title = document.getElementById('pickAuthorCoverTitle');
  const subtitle = document.getElementById('pickAuthorCoverSubtitle');
  const selectSite = document.getElementById('selectCoverPickerSite');

  if (title) title.textContent = t('fav.coverPickerTitle', 'Выбор обложки: {name}').replace('{name}', author.displayName || author.name);
  if (subtitle) subtitle.textContent = t('coverPicker.subtitle', 'Выберите арт художника, чтобы сделать его превью автора');
  if (selectSite) selectSite.value = author.site || state.currentSite || 'danbooru';
  if (modalBackdrop) modalBackdrop.style.display = 'flex';

  loadAuthorPostsForCover(author, selectSite?.value || 'danbooru');
}

export function closeCoverPickerModal() {
  coverPickerSeq += 1;
  const modalBackdrop = document.getElementById('modalPickAuthorCoverBackdrop');
  if (modalBackdrop) modalBackdrop.style.display = 'none';
  currentPickerAuthor = null;
}

async function loadAuthorPostsForCover(author, site) {
  const seq = ++coverPickerSeq;
  const statusBox = document.getElementById('coverPickerStatus');
  const emptyBox = document.getElementById('coverPickerEmpty');
  const grid = document.getElementById('coverPickerGrid');

  if (statusBox) statusBox.style.display = 'flex';
  if (emptyBox) emptyBox.style.display = 'none';
  if (grid) grid.innerHTML = '';

  try {
    const targetSite = site || author.site || 'danbooru';
    let authorTag = author.name;
    if (targetSite === 'pawchive' || targetSite === 'kemono') {
      authorTag = (author.service && author.user)
        ? `service:${author.service} user:${author.user}`
        : `artist:${author.name}`;
    }
    const res = await fetchPosts({
      site: targetSite,
      tags: authorTag,
      page: 1,
      limit: 40,
      category: 'new'
    });

    if (seq !== coverPickerSeq || currentPickerAuthor !== author) return;
    if (statusBox) statusBox.style.display = 'none';

    if (res.success && Array.isArray(res.posts) && res.posts.length > 0) {
      if (emptyBox) emptyBox.style.display = 'none';
      renderCoverPickerPosts(res.posts, author, site);
    } else {
      if (emptyBox) emptyBox.style.display = 'block';
    }
  } catch (err) {
    console.error('Ошибка загрузки работ автора для обложки:', err);
    if (statusBox) statusBox.style.display = 'none';
    if (emptyBox) emptyBox.style.display = 'block';
  }
}

function isVideoUrl(url) {
  if (!url) return false;
  const clean = url.split('?')[0].toLowerCase();
  return clean.endsWith('.mp4') || clean.endsWith('.webm') || clean.endsWith('.mov') || clean.endsWith('.mkv') || clean.endsWith('.avi');
}

function renderCoverPickerPosts(posts, author, site) {
  const grid = document.getElementById('coverPickerGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const fragment = document.createDocumentFragment();
  posts.forEach(post => {
    let displayThumb = '';
    const hasStaticPreview = post.previewUrl && !isVideoUrl(post.previewUrl);
    const videoTarget = post.sampleUrl || post.fileUrl || (isVideoUrl(post.previewUrl) ? post.previewUrl : '');

    if (hasStaticPreview) {
      displayThumb = post.previewUrl;
    } else if (videoTarget) {
      displayThumb = `/api/video-thumbnail?url=${encodeURIComponent(videoTarget)}&quality=medium`;
    } else {
      displayThumb = post.previewUrl || post.sampleUrl || post.fileUrl || '';
    }

    if (!displayThumb) return;

    const shouldUseProxy = shouldProxyMedia({ site: post.site, url: displayThumb, type: 'thumbnail' });
    const finalThumbUrl = toSafeHttpUrl(displayThumb.startsWith('/api/') ? displayThumb : (shouldUseProxy ? getProxiedUrl(displayThumb) : displayThumb));
    if (!finalThumbUrl) return;

    const isCurrent = author.previewUrl && (author.previewUrl === post.previewUrl || author.previewUrl === post.sampleUrl || author.previewUrl === finalThumbUrl);

    const item = document.createElement('div');
    item.className = `cover-picker-item ${isCurrent ? 'active' : ''}`;
    item.title = post.isVideo ? t('fav.coverVideoTitle', 'Сделать видеопревью обложкой автора') : t('fav.coverImageTitle', 'Сделать этот арт обложкой автора');

    item.innerHTML = `
      <img class="cover-picker-thumb" src="${escapeHtml(finalThumbUrl)}" alt="" loading="lazy" decoding="async">
      <div class="cover-picker-overlay">${post.isVideo ? t('fav.coverOverlayVideo', 'Видеообложка') : t('viewer.makeCover', 'Сделать обложкой')}</div>
      ${isCurrent ? `<span class="cover-picker-badge-current">${t('fav.coverCurrent', 'Текущая')}</span>` : ''}
    `;

    item.addEventListener('click', async () => {
      haptic(15);
      await handleSelectAuthorCover(author, post, site);
    });

    fragment.appendChild(item);
  });

  grid.appendChild(fragment);
}

async function handleSelectAuthorCover(author, post, site) {
  if (!author || !post) return;

  const isVideo = post.isVideo || isVideoUrl(post.fileUrl) || isVideoUrl(post.sampleUrl) || isVideoUrl(post.previewUrl);
  const staticPreview = (!isVideoUrl(post.previewUrl) && post.previewUrl) || '';
  const videoTarget = post.sampleUrl || post.fileUrl || post.previewUrl || '';
  
  const chosenUrl = staticPreview || (isVideo ? `/api/video-thumbnail?url=${encodeURIComponent(videoTarget)}&quality=medium` : (post.sampleUrl || post.fileUrl || ''));
  const sampleUrl = post.sampleUrl || '';
  const fileUrl = post.fileUrl || '';
  const thumb180 = post.thumb180 || '';
  const thumb360 = post.thumb360 || '';
  const thumb720 = post.thumb720 || '';

  // 1. Optimistically update local state.favoriteAuthors
  const cleanName = (author.name || '').toLowerCase().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_');
  const target = state.favoriteAuthors.find(a => 
    (a.name || '').toLowerCase().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_') === cleanName ||
    (a.displayName || '').toLowerCase() === (author.displayName || '').toLowerCase()
  );

  if (target) {
    target.previewUrl = chosenUrl;
    target.sampleUrl = sampleUrl;
    target.fileUrl = fileUrl;
    target.thumb180 = thumb180;
    target.thumb360 = thumb360;
    target.thumb720 = thumb720;
    if (site) target.site = site;
  } else {
    author.previewUrl = chosenUrl;
    author.sampleUrl = sampleUrl;
    author.fileUrl = fileUrl;
    author.thumb180 = thumb180;
    author.thumb360 = thumb360;
    author.thumb720 = thumb720;
    if (site) author.site = site;
    state.favoriteAuthors.unshift(author);
  }

  setFavoriteAuthors([...state.favoriteAuthors]);
  closeCoverPickerModal();
  showToast(t('fav.coverUpdated', 'Обложка автора {name} обновлена!').replace('{name}', author.displayName || author.name));
  if (onCoverUpdatedCallback) onCoverUpdatedCallback();

  // 2. Send the update to the server
  try {
    await updateFavoriteAuthorPreview(author.name, chosenUrl, site, { sampleUrl, fileUrl, thumb180, thumb360, thumb720 });
    await syncFavoriteAuthors(state.favoriteAuthors);
  } catch (err) {
    console.warn('Сервер не ответил, сохранено локально:', err);
  }
}

export function initCoverPickerModal({ onCoverUpdated }) {
  onCoverUpdatedCallback = onCoverUpdated;
  const modalBackdrop = document.getElementById('modalPickAuthorCoverBackdrop');
  const btnClose = document.getElementById('btnClosePickAuthorCoverModal');
  const selectSite = document.getElementById('selectCoverPickerSite');
  const btnRefresh = document.getElementById('btnRefreshCoverPicker');

  if (btnClose) btnClose.addEventListener('click', closeCoverPickerModal);
  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) closeCoverPickerModal();
    });
  }

  if (selectSite) {
    selectSite.addEventListener('change', () => {
      if (currentPickerAuthor) {
        loadAuthorPostsForCover(currentPickerAuthor, selectSite.value);
      }
    });
  }

  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      if (currentPickerAuthor) {
        loadAuthorPostsForCover(currentPickerAuthor, selectSite?.value || 'danbooru');
      }
    });
  }
}

export function openAuthorNotifSourcesModal(author, galleryInstance, callbacks = {}) {
  if (!author) return;
  currentNotifAuthor = author;
  notifModalCallbacks = { galleryInstance, ...callbacks };

  const modalBackdrop = document.getElementById('modalAuthorNotifSourcesBackdrop');
  const infoBox = document.getElementById('authorNotifModalAuthorInfo');
  if (!modalBackdrop) return;

  const currentSites = Array.isArray(author.notificationSites) && author.notificationSites.length > 0
    ? [...author.notificationSites]
    : [author.site || 'danbooru'];
  tempNotifSites = [...currentSites];

  if (infoBox) {
    const rawPreview = author.thumb180 || author.previewUrl || author.thumb360 || '';
    const shouldUseThumbProxy = shouldProxyMedia({ site: author.site, url: rawPreview, type: 'thumbnail' });
    const avatarUrl = toSafeHttpUrl(rawPreview ? (rawPreview.startsWith('/api/') ? rawPreview : (shouldUseThumbProxy ? getProxiedUrl(rawPreview) : rawPreview)) : '');
    const siteObj = (state.sites || []).find(s => s.id === author.site);
    const siteName = siteObj ? siteObj.name : (author.site ? author.site.toUpperCase() : 'Danbooru');

    infoBox.innerHTML = `
      ${avatarUrl ? `
        <img src="${escapeHtml(avatarUrl)}" alt="" class="author-notif-modal-avatar">
      ` : `
        <div class="author-notif-modal-avatar" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/></svg>
        </div>
      `}
      <div class="author-notif-modal-names">
        <span class="author-notif-modal-display-name">${escapeHtml(author.displayName || author.name)}</span>
        <span class="author-notif-modal-tag">@${escapeHtml(author.name)}</span>
      </div>
      <span class="author-card-site-badge" title="${escapeHtml(t('addAuthor.siteLabel', 'Предпочитаемый Booru-источник:'))}">${escapeHtml(siteName)}</span>
    `;
  }

  renderAuthorNotifSourcesGrid();
  modalBackdrop.style.display = 'flex';
}

export function closeAuthorNotifSourcesModal() {
  const modalBackdrop = document.getElementById('modalAuthorNotifSourcesBackdrop');
  if (modalBackdrop) modalBackdrop.style.display = 'none';
  currentNotifAuthor = null;
  notifModalCallbacks = null;
}

function renderAuthorNotifSourcesGrid() {
  const grid = document.getElementById('authorNotifSourcesGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const sites = state.sites || [];
  sites.forEach(site => {
    const isChecked = tempNotifSites.includes(site.id);
    const card = document.createElement('label');
    card.className = `author-notif-site-card ${isChecked ? 'selected' : ''}`;
    card.innerHTML = `
      <input type="checkbox" class="author-notif-site-checkbox" data-site="${escapeHtml(site.id)}" ${isChecked ? 'checked' : ''}>
      <span class="source-dot" style="background-color: ${toSafeCssColor(site.accentColor)}; width: 8px; height: 8px; border-radius: 50%;"></span>
      <div class="author-notif-site-info">
        <span class="author-notif-site-name">${escapeHtml(site.name)}</span>
        <span class="author-notif-site-rating">${escapeHtml(site.rating === 'nsfw' ? '18+' : (site.rating === 'safe' ? 'SFW' : 'MIX'))}</span>
      </div>
    `;

    const input = card.querySelector('input');
    input.addEventListener('change', () => {
      if (input.checked) {
        if (!tempNotifSites.includes(site.id)) tempNotifSites.push(site.id);
        card.classList.add('selected');
      } else {
        tempNotifSites = tempNotifSites.filter(id => id !== site.id);
        card.classList.remove('selected');
      }
    });

    grid.appendChild(card);
  });
}

export function initAuthorNotifSourcesModal() {
  const modalBackdrop = document.getElementById('modalAuthorNotifSourcesBackdrop');
  const btnClose = document.getElementById('btnCloseAuthorNotifSourcesModal');
  const btnCancel = document.getElementById('btnCancelAuthorNotifSources');
  const btnSave = document.getElementById('btnSaveAuthorNotifSources');
  const btnSelectAll = document.getElementById('btnAuthorNotifSelectAll');
  const btnPrimaryOnly = document.getElementById('btnAuthorNotifPrimaryOnly');

  if (btnClose) btnClose.addEventListener('click', closeAuthorNotifSourcesModal);
  if (btnCancel) btnCancel.addEventListener('click', closeAuthorNotifSourcesModal);

  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) closeAuthorNotifSourcesModal();
    });
  }

  if (btnSelectAll) {
    btnSelectAll.addEventListener('click', () => {
      const allIds = (state.sites || []).map(s => s.id);
      const isAllSelected = allIds.length > 0 && allIds.every(id => tempNotifSites.includes(id));
      if (isAllSelected) {
        tempNotifSites = [currentNotifAuthor?.site || 'danbooru'];
      } else {
        tempNotifSites = [...allIds];
      }
      renderAuthorNotifSourcesGrid();
    });
  }

  if (btnPrimaryOnly) {
    btnPrimaryOnly.addEventListener('click', () => {
      tempNotifSites = [currentNotifAuthor?.site || 'danbooru'];
      renderAuthorNotifSourcesGrid();
    });
  }

  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      if (!currentNotifAuthor) return;
      haptic(10);
      const targetSites = tempNotifSites.length > 0 ? [...tempNotifSites] : [currentNotifAuthor.site || 'danbooru'];
      currentNotifAuthor.notificationSites = targetSites;

      const cleanName = (currentNotifAuthor.name || '').toLowerCase().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_');
      const inState = (state.favoriteAuthors || []).find(a => 
        (a.name || '').toLowerCase().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_') === cleanName
      );
      if (inState) inState.notificationSites = targetSites;

      setFavoriteAuthors([...state.favoriteAuthors]);
      const authorToSave = currentNotifAuthor;
      const callbacks = notifModalCallbacks;
      closeAuthorNotifSourcesModal();

      showToast(t('fav.notifSourcesSaved', 'Источники уведомлений автора {name} сохранены').replace('{name}', authorToSave.displayName || authorToSave.name));

      if (callbacks?.galleryInstance) {
        renderFavoriteAuthorsList(callbacks.galleryInstance, {
          onExploreAuthor: callbacks.onExploreAuthor,
          onUpdateBadge: callbacks.onUpdateBadge
        });
      }

      try {
        await updateAuthorNotificationSites(authorToSave.name, targetSites);
        await syncFavoriteAuthors(state.favoriteAuthors);
      } catch (err) {
        console.warn('Сервер не ответил, источники уведомлений сохранены локально:', err);
      }
    });
  }
}

export function openAddAuthorModal() {
  const modalAddAuthorBackdrop = document.getElementById('modalAddAuthorBackdrop');
  const inputAuthorName = document.getElementById('inputAuthorName');
  const selectAuthorSite = document.getElementById('selectAuthorSite');

  if (modalAddAuthorBackdrop) modalAddAuthorBackdrop.style.display = 'flex';
  if (inputAuthorName) {
    inputAuthorName.value = '';
    setTimeout(() => inputAuthorName.focus(), 60);
  }

  const initialSite = selectAuthorSite?.value || 'danbooru';
  addAuthorNotifSites = new Set([initialSite]);
  renderAddAuthorNotifChips();
}

export function closeAddAuthorModal() {
  const modalAddAuthorBackdrop = document.getElementById('modalAddAuthorBackdrop');
  if (modalAddAuthorBackdrop) modalAddAuthorBackdrop.style.display = 'none';
}

function renderAddAuthorNotifChips() {
  const container = document.getElementById('addAuthorNotifSitesContainer');
  if (!container) return;
  container.innerHTML = '';

  const sites = state.sites || [];
  sites.forEach(site => {
    const isSelected = addAuthorNotifSites.has(site.id);
    const chip = document.createElement('div');
    chip.className = `author-notif-chip ${isSelected ? 'selected' : ''}`;
    chip.innerHTML = `
      <span class="source-dot" style="background-color: ${toSafeCssColor(site.accentColor)}; width: 7px; height: 7px; border-radius: 50%;"></span>
      <span>${escapeHtml(site.name)}</span>
    `;

    chip.addEventListener('click', () => {
      if (addAuthorNotifSites.has(site.id)) {
        if (addAuthorNotifSites.size > 1) {
          addAuthorNotifSites.delete(site.id);
        }
      } else {
        addAuthorNotifSites.add(site.id);
      }
      renderAddAuthorNotifChips();
    });

    container.appendChild(chip);
  });
}

export function initAddAuthorModal({ onAuthorSaved }) {
  const modalAddAuthorBackdrop = document.getElementById('modalAddAuthorBackdrop');
  const formAddAuthor = document.getElementById('formAddAuthor');
  const inputAuthorName = document.getElementById('inputAuthorName');
  const selectAuthorSite = document.getElementById('selectAuthorSite');
  const btnCloseAddAuthorModal = document.getElementById('btnCloseAddAuthorModal');
  const btnCancelAddAuthor = document.getElementById('btnCancelAddAuthor');
  const btnAddAuthorModalOpen = document.getElementById('btnAddAuthorModalOpen');
  const btnProfileAddAuthor = document.getElementById('btnProfileAddAuthor');

  if (selectAuthorSite) {
    selectAuthorSite.addEventListener('change', () => {
      const chosen = selectAuthorSite.value;
      if (chosen && addAuthorNotifSites.size <= 1) {
        addAuthorNotifSites = new Set([chosen]);
        renderAddAuthorNotifChips();
      }
    });
  }

  if (btnAddAuthorModalOpen) {
    btnAddAuthorModalOpen.addEventListener('click', () => {
      haptic(10);
      openAddAuthorModal();
    });
  }

  if (btnProfileAddAuthor) {
    btnProfileAddAuthor.addEventListener('click', () => {
      haptic(10);
      openAddAuthorModal();
    });
  }

  // Click delegation for dynamically created add-author buttons
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#btnAddAuthorEmpty, .btn-add-author-action, [data-action="open-add-author"]');
    if (btn) {
      haptic(10);
      openAddAuthorModal();
    }
  });

  if (btnCloseAddAuthorModal) btnCloseAddAuthorModal.addEventListener('click', closeAddAuthorModal);
  if (btnCancelAddAuthor) btnCancelAddAuthor.addEventListener('click', closeAddAuthorModal);

  if (modalAddAuthorBackdrop) {
    modalAddAuthorBackdrop.addEventListener('click', (e) => {
      if (e.target === modalAddAuthorBackdrop) closeAddAuthorModal();
    });
  }

  if (formAddAuthor) {
    formAddAuthor.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rawName = (inputAuthorName?.value || '').trim();
      const site = selectAuthorSite?.value || 'danbooru';
      if (!rawName) return;

      const cleanTag = rawName.replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_');
      const notificationSites = addAuthorNotifSites.size > 0 ? Array.from(addAuthorNotifSites) : [site];

      try {
        const res = await toggleFavoriteAuthor({
          name: cleanTag,
          displayName: rawName,
          site,
          notificationSites
        });

        if (res.success) {
          const authData = await fetchFavoriteAuthors();
          if (authData.authors) {
            setFavoriteAuthors(authData.authors);
          }
          closeAddAuthorModal();
          showToast(t('fav.authorSaved', 'Автор {name} сохранён в любимые').replace('{name}', rawName));
          if (onAuthorSaved) onAuthorSaved();
        } else {
          showToast(res.message || t('fav.authorSaveFailed', 'Ошибка сохранения автора'));
        }
      } catch (err) {
        console.error('Ошибка добавления автора:', err);
        showToast(t('fav.authorSaveFailed', 'Ошибка сохранения автора'));
      }
    });
  }
}
