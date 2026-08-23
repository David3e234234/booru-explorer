import { state } from '../state.js';
import { t } from '../i18n.js';

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

export function updateDateFilterUI() {
  const dateMap = {
    'all': t('date.all', 'За всё время'),
    '24h': t('date.24h', 'За 24 часа'),
    '1d': t('date.24h', 'За 24 часа'),
    '2d': t('date.2d', 'За 2 дня'),
    '7d': t('date.7d', 'За неделю'),
    'week': t('date.7d', 'За неделю'),
    '30d': t('date.30d', 'За месяц'),
    'month': t('date.30d', 'За месяц'),
    '90d': t('date.90d', 'За 3 месяца'),
    '3months': t('date.90d', 'За 3 месяца'),
    '365d': t('date.365d', 'За год'),
    'year': t('date.365d', 'За год')
  };

  const dateFilterLabel = document.getElementById('dateFilterLabel');
  if (dateFilterLabel) {
    dateFilterLabel.textContent = dateMap[state.dateFilter] || t('date.all', 'За всё время');
  }

  document.querySelectorAll('#dateFilterMenu .dropdown-item').forEach(item => {
    const isCurrent = item.dataset.date === state.dateFilter || (state.dateFilter === 'all' && item.dataset.date === 'all');
    item.classList.toggle('active', isCurrent);
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
                   (state.dateFilter && state.dateFilter !== 'all') ||
                   !state.hideFurry ||
                   !state.hidePregnant ||
                   state.hideLgbt ||
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

  const btnHeaderAuth = document.getElementById('btnHeaderAuth');
  if (btnHeaderAuth) {
    btnHeaderAuth.classList.toggle('active', state.currentCategory === 'profile');
  }

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
      'new': t('cat.new', 'Свежие'),
      'views': t('cat.views', 'Просматриваемые'),
      'top': t('cat.top', 'По рейтингу'),
      'popular': t('cat.popular', 'Популярное'),
      'recommended': t('cat.recommended', 'Для вас'),
      'random': t('cat.random', 'Случайно'),
      'favorites': t('cat.favorites', 'Избранное')
    };
    if (state.currentCategory !== 'profile') {
      mobileNavFeedLabel.textContent = catMap[state.currentCategory] || t('cat.feed', 'Лента');
    }
  }
}
