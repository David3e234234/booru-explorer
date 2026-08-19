import { state, addSearchTag, setFavoriteAuthors } from '../state.js';
import { deleteFavoriteAuthor, toggleFavoriteAuthor, fetchFavoriteAuthors } from '../api.js';
import { showToast, haptic } from './uiUtils.js';

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
  const query = (favAuthorsSearchInput?.value || '').trim().toLowerCase();
  let authors = [...state.favoriteAuthors];
  if (query) {
    authors = authors.filter(a =>
      (a.name || '').toLowerCase().includes(query) ||
      (a.displayName || '').toLowerCase().includes(query)
    );
  }
  galleryInstance.renderAuthorCards(authors, {
    onExplore: onExploreAuthor,
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

export function initAddAuthorModal({ onAuthorSaved }) {
  const modalAddAuthorBackdrop = document.getElementById('modalAddAuthorBackdrop');
  const formAddAuthor = document.getElementById('formAddAuthor');
  const inputAuthorName = document.getElementById('inputAuthorName');
  const selectAuthorSite = document.getElementById('selectAuthorSite');
  const btnCloseAddAuthorModal = document.getElementById('btnCloseAddAuthorModal');
  const btnCancelAddAuthor = document.getElementById('btnCancelAddAuthor');
  const btnAddAuthorModalOpen = document.getElementById('btnAddAuthorModalOpen');

  function openAddAuthorModal() {
    if (modalAddAuthorBackdrop) modalAddAuthorBackdrop.style.display = 'flex';
    if (inputAuthorName) {
      inputAuthorName.value = '';
      setTimeout(() => inputAuthorName.focus(), 60);
    }
  }

  function closeAddAuthorModal() {
    if (modalAddAuthorBackdrop) modalAddAuthorBackdrop.style.display = 'none';
  }

  if (btnAddAuthorModalOpen) {
    btnAddAuthorModalOpen.addEventListener('click', () => {
      haptic(10);
      openAddAuthorModal();
    });
  }

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
          showToast(`Автор ${rawName} сохранён в любимые ⭐`);
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
