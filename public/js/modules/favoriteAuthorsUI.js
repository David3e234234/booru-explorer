import { state, addSearchTag, setFavoriteAuthors } from '../state.js';
import { deleteFavoriteAuthor, toggleFavoriteAuthor, fetchFavoriteAuthors, updateFavoriteAuthorPreview, syncFavoriteAuthors, fetchPosts, getProxiedUrl } from '../api.js';
import { showToast, haptic } from './uiUtils.js';

let currentPickerAuthor = null;
let onCoverUpdatedCallback = null;

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
          showToast(`Автор ${author.displayName || author.name} удален из любимых`);
        }
      } catch (err) {
        console.error('Ошибка удаления автора:', err);
        showToast('Не удалось удалить автора');
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

  if (title) title.textContent = `Выбор обложки: ${author.displayName || author.name}`;
  if (subtitle) subtitle.textContent = `Выберите арт художника, чтобы сделать его превью автора`;
  if (selectSite) selectSite.value = author.site || state.currentSite || 'danbooru';
  if (modalBackdrop) modalBackdrop.style.display = 'flex';

  loadAuthorPostsForCover(author, selectSite?.value || 'danbooru');
}

export function closeCoverPickerModal() {
  const modalBackdrop = document.getElementById('modalPickAuthorCoverBackdrop');
  if (modalBackdrop) modalBackdrop.style.display = 'none';
  currentPickerAuthor = null;
}

async function loadAuthorPostsForCover(author, site) {
  const statusBox = document.getElementById('coverPickerStatus');
  const emptyBox = document.getElementById('coverPickerEmpty');
  const grid = document.getElementById('coverPickerGrid');

  if (statusBox) statusBox.style.display = 'flex';
  if (emptyBox) emptyBox.style.display = 'none';
  if (grid) grid.innerHTML = '';

  try {
    const res = await fetchPosts({
      site: site || author.site || 'danbooru',
      tags: author.name,
      page: 1,
      limit: 40,
      category: 'new'
    });

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
  const shouldUseThumbProxy = state.settings?.proxyThumbnails !== false;

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

    const shouldUseProxy = (post.site === 'danbooru' || displayThumb.includes('donmai.us')) ? true : shouldUseThumbProxy;
    const finalThumbUrl = displayThumb.startsWith('/api/') ? displayThumb : (shouldUseProxy ? getProxiedUrl(displayThumb) : displayThumb);

    const isCurrent = author.previewUrl && (author.previewUrl === post.previewUrl || author.previewUrl === post.sampleUrl || author.previewUrl === finalThumbUrl);

    const item = document.createElement('div');
    item.className = `cover-picker-item ${isCurrent ? 'active' : ''}`;
    item.title = post.isVideo ? 'Сделать видеопревью обложкой автора' : 'Сделать этот арт обложкой автора';

    item.innerHTML = `
      <img class="cover-picker-thumb" src="${finalThumbUrl}" alt="" loading="lazy" decoding="async">
      <div class="cover-picker-overlay">${post.isVideo ? 'Видеообложка' : 'Сделать обложкой'}</div>
      ${isCurrent ? `<span class="cover-picker-badge-current">Текущая</span>` : ''}
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

  // 1. Оптимистично обновляем в локальном состоянии state.favoriteAuthors
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
  showToast(`Обложка автора ${author.displayName || author.name} обновлена!`);
  if (onCoverUpdatedCallback) onCoverUpdatedCallback();

  // 2. Отправляем обновление на сервер
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

export function openAddAuthorModal() {
  const modalAddAuthorBackdrop = document.getElementById('modalAddAuthorBackdrop');
  const inputAuthorName = document.getElementById('inputAuthorName');
  if (modalAddAuthorBackdrop) modalAddAuthorBackdrop.style.display = 'flex';
  if (inputAuthorName) {
    inputAuthorName.value = '';
    setTimeout(() => inputAuthorName.focus(), 60);
  }
}

export function closeAddAuthorModal() {
  const modalAddAuthorBackdrop = document.getElementById('modalAddAuthorBackdrop');
  if (modalAddAuthorBackdrop) modalAddAuthorBackdrop.style.display = 'none';
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

  // Делегирование клика для динамических кнопок добавления автора
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

      try {
        const res = await toggleFavoriteAuthor({
          name: cleanTag,
          displayName: rawName,
          site
        });

        if (res.success) {
          const authData = await fetchFavoriteAuthors();
          if (authData.authors) {
            setFavoriteAuthors(authData.authors);
          }
          closeAddAuthorModal();
          showToast(`Автор ${rawName} сохранён в любимые`);
          if (onAuthorSaved) onAuthorSaved();
        } else {
          showToast(res.message || 'Ошибка сохранения автора');
        }
      } catch (err) {
        console.error('Ошибка добавления автора:', err);
        showToast('Ошибка сохранения автора');
      }
    });
  }
}
