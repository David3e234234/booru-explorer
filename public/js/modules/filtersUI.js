import { state } from '../state.js';

export function updateAiFilterUI() {
  document.querySelectorAll('.ai-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.ai === state.aiFilter);
  });
  updateFilterActiveDot();
}

export function updateRatingFilterUI() {
  document.querySelectorAll('.rating-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.rating === state.ratingFilter);
  });
  updateFilterActiveDot();
}

export function updateTypeFilterUI() {
  document.querySelectorAll('.type-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === state.typeFilter);
  });
  updateFilterActiveDot();
}

export function updateAgeFilterUI() {
  document.querySelectorAll('.age-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.age === state.ageFilter);
  });
  updateFilterActiveDot();
}

export function updateFilterActiveDot() {
  const filterActiveDot = document.getElementById('filterActiveDot');
  if (!filterActiveDot) return;
  const isCustom = state.aiFilter !== 'no-ai' ||
                   state.ratingFilter !== 'all' ||
                   state.typeFilter !== 'all' ||
                   state.ageFilter !== 'all' ||
                   !state.hideFurry ||
                   !state.hidePregnant ||
                   (state.searchTags && state.searchTags.length > 0);
  filterActiveDot.style.display = isCustom ? 'block' : 'none';
}

export function updateCategoryTabsUI() {
  const favoritesHeaderBar = document.getElementById('favoritesHeaderBar');
  const btnFavSubPosts = document.getElementById('btnFavSubPosts');
  const btnFavSubAuthors = document.getElementById('btnFavSubAuthors');
  const favAuthorsActions = document.getElementById('favAuthorsActions');
  const userProfileSection = document.getElementById('userProfileSection');

  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.category === state.currentCategory);
  });
  document.querySelectorAll('.category-card').forEach(card => {
    card.classList.toggle('active', card.dataset.category === state.currentCategory);
  });
  document.querySelectorAll('.mobile-nav-item').forEach(item => {
    if (state.currentCategory === 'favorites') {
      item.classList.toggle('active', item.dataset.nav === 'favorites');
    } else if (state.currentCategory === 'profile') {
      item.classList.toggle('active', item.dataset.nav === 'profile');
    } else {
      item.classList.toggle('active', item.dataset.nav === 'feed');
    }
  });

  if (userProfileSection) {
    userProfileSection.style.display = state.currentCategory === 'profile' ? 'block' : 'none';
  }

  if (favoritesHeaderBar) {
    favoritesHeaderBar.style.display = state.currentCategory === 'favorites' ? 'flex' : 'none';
    if (state.currentCategory === 'favorites') {
      btnFavSubPosts?.classList.toggle('active', state.favoritesSubTab === 'posts');
      btnFavSubAuthors?.classList.toggle('active', state.favoritesSubTab === 'authors');
      if (favAuthorsActions) favAuthorsActions.style.display = state.favoritesSubTab === 'authors' ? 'flex' : 'none';
    }
  }

  const mobileNavFeedLabel = document.getElementById('mobileNavFeedLabel');
  if (mobileNavFeedLabel) {
    const catMap = {
      'new': 'Новое',
      'recommended': 'Для вас',
      'popular': 'Популярное',
      'top': 'Топ',
      'random': 'Случайно',
      'favorites': 'Избранное'
    };
    if (state.currentCategory !== 'profile') {
      mobileNavFeedLabel.textContent = catMap[state.currentCategory] || 'Лента';
    }
  }
}
