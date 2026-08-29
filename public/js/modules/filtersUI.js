import { state, getSiteCapabilities } from '../state.js';
import { t } from '../i18n.js';

const PAWCHIVE_SERVICE_LABELS = {
  patreon: 'Patreon',
  fanbox: 'Pixiv Fanbox',
  fantia: 'Fantia',
  boosty: 'Boosty',
  gumroad: 'Gumroad',
  discord: 'Discord',
  subscribe: 'SubscribeStar',
  onlyfans: 'OnlyFans'
};

export function getPawchiveServiceLabel(service) {
  if (!service || service === 'all') return t('sidebar.pawchiveServiceAll', 'Все платформы');
  return PAWCHIVE_SERVICE_LABELS[service] || (service.charAt(0).toUpperCase() + service.slice(1));
}

export function updateSiteCapabilitiesUI(siteId) {
  const caps = getSiteCapabilities(siteId || state.currentSite);
  const currentSiteId = siteId || state.currentSite;

  // 1. Categories & navigation tabs (desktop & mobile)
  const supportedCats = new Set(caps.supportedCategories || ['new', 'views', 'top', 'random', 'following', 'recommended']);
  if (state.settings?.recommendationMode === 'off' || state.settings?.enableRecommendations === false) {
    supportedCats.delete('recommended');
  }
  
  document.querySelectorAll('.nav-tab').forEach(tab => {
    const cat = tab.dataset.category;
    if (cat) {
      tab.style.display = supportedCats.has(cat) ? '' : 'none';
    }
  });

  document.querySelectorAll('.category-card').forEach(card => {
    const cat = card.dataset.category;
    if (cat) {
      card.style.display = supportedCats.has(cat) ? '' : 'none';
    }
  });

  if (state.currentCategory !== 'favorites' && state.currentCategory !== 'profile') {
    if (!supportedCats.has(state.currentCategory)) {
      state.currentCategory = (caps.supportedCategories && caps.supportedCategories[0]) || 'new';
    }
  }

  // 2. AI filter block
  const aiFilterBlock = document.getElementById('aiFilterBlock');
  if (aiFilterBlock) {
    aiFilterBlock.style.display = caps.supportsAiFilter ? '' : 'none';
  }
  if (!caps.supportsAiFilter && state.aiFilter !== 'all') {
    state.aiFilter = 'all';
  }

  // 3. Rating filter block (hide on sites with fixed rating e.g. Safebooru or Rule34/Pawchive)
  const ratingFilterBlock = document.getElementById('ratingFilterBlock');
  const hasMultipleRatings = caps.rating === 'all';
  if (ratingFilterBlock) {
    ratingFilterBlock.style.display = hasMultipleRatings ? '' : 'none';
  }
  if (!hasMultipleRatings) {
    state.ratingFilter = 'all';
  }

  // 4. Date filter block
  const dateFilterBlock = document.getElementById('dateFilterBlock');
  if (dateFilterBlock) {
    dateFilterBlock.style.display = caps.supportsDateFilter ? '' : 'none';
  }
  if (!caps.supportsDateFilter && state.dateFilter !== 'all') {
    state.dateFilter = 'all';
  }

  // 5. Content type filter block & pills
  const typeFilterBlock = document.getElementById('typeFilterBlock');
  const typePillVideo = document.querySelector('.type-pill[data-type="video"]');
  const typePillAudio = document.querySelector('.type-pill[data-type="audio"]');
  const typePillImage = document.querySelector('.type-pill[data-type="image"]');

  if (typePillVideo) typePillVideo.style.display = caps.supportsVideo ? '' : 'none';
  if (typePillAudio) typePillAudio.style.display = caps.supportsVideo ? '' : 'none';
  if (typePillImage) typePillImage.style.display = caps.supportsImages ? '' : 'none';

  if (!caps.supportsVideo && (state.typeFilter === 'video' || state.typeFilter === 'audio')) {
    state.typeFilter = 'all';
  }
  if (!caps.supportsImages && state.typeFilter === 'image') {
    state.typeFilter = 'all';
  }

  if (typeFilterBlock) {
    const hasMultipleMediaTypes = caps.supportsVideo && caps.supportsImages;
    typeFilterBlock.style.display = hasMultipleMediaTypes ? '' : 'none';
  }

  // 6. Video duration sort block
  const videoSortBlock = document.getElementById('videoSortBlock');
  if (videoSortBlock) {
    videoSortBlock.style.display = caps.supportsVideo ? '' : 'none';
  }
  if (!caps.supportsVideo && state.videoDurationSort !== 'none') {
    state.videoDurationSort = 'none';
  }

  // 7. Shapes / Body type filter block
  const shapesFilterBlock = document.getElementById('shapesFilterBlock');
  if (shapesFilterBlock) {
    shapesFilterBlock.style.display = caps.supportsShapesFilter ? '' : 'none';
  }
  if (!caps.supportsShapesFilter && state.ageFilter !== 'all') {
    state.ageFilter = 'all';
  }

  // 8. Content hiding block (Furry, Pregnant, LGBT)
  const contentHidingBlock = document.getElementById('contentHidingBlock');
  if (contentHidingBlock) {
    contentHidingBlock.style.display = caps.supportsContentHiding ? '' : 'none';
  }

  // 9. Page dynamic tags block
  const pageTagsBlock = document.getElementById('pageTagsBlock');
  if (pageTagsBlock) {
    pageTagsBlock.style.display = caps.supportsTags ? '' : 'none';
  }

  // 9.1 Pawchive platform filter block (exclusive to the Pawchive source)
  const pawchiveServiceBlock = document.getElementById('pawchiveServiceBlock');
  if (pawchiveServiceBlock) {
    pawchiveServiceBlock.style.display = currentSiteId === 'pawchive' ? '' : 'none';
  }

  // 10. Search input placeholder
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    if (!caps.supportsTags) {
      searchInput.placeholder = t('sidebar.search.placeholderPawchive', 'Поиск по автору или названию...');
    } else {
      searchInput.placeholder = t('sidebar.search.placeholder', 'Введите тег (1girl, video)...');
    }
  }

  // 11. Update active pill indicators
  updateCategoryTabsUI();
  updateAiFilterUI();
  updateRatingFilterUI();
  updateTypeFilterUI();
  updateAgeFilterUI();
  updateDateFilterUI();
  updatePawchiveServiceUI();
  updateVideoSortUI();
  updateFilterActiveDot();
}

export function updateVideoSortUI() {
  document.querySelectorAll('.video-sort-pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.sort === (state.videoDurationSort || 'none'));
  });
}

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

export function updatePawchiveServiceUI() {
  const pawchiveServiceLabel = document.getElementById('pawchiveServiceLabel');
  if (pawchiveServiceLabel) {
    pawchiveServiceLabel.textContent = getPawchiveServiceLabel(state.pawchiveService);
  }

  document.querySelectorAll('#pawchiveServiceMenu .dropdown-item').forEach(item => {
    const itemService = item.dataset.service || 'all';
    item.classList.toggle('active', itemService === (state.pawchiveService || 'all'));
  });

  updateFilterActiveDot();
}

export function updateFilterActiveDot() {
  const filterActiveDot = document.getElementById('filterActiveDot');
  if (!filterActiveDot) return;
  const caps = getSiteCapabilities(state.currentSite);
  const isCustom = (caps.supportsAiFilter && state.aiFilter !== 'no-ai' && state.aiFilter !== 'all') ||
                   (caps.rating === 'all' && state.ratingFilter !== 'all') ||
                   (caps.supportsVideo && caps.supportsImages && state.typeFilter !== 'all') ||
                   (caps.supportsShapesFilter && state.ageFilter !== 'all') ||
                   (caps.supportsDateFilter && state.dateFilter && state.dateFilter !== 'all') ||
                   (caps.supportsContentHiding && (!state.hideFurry || !state.hidePregnant || state.hideLgbt)) ||
                   (state.currentSite === 'pawchive' && state.pawchiveService && state.pawchiveService !== 'all') ||
                   (caps.supportsTags && state.searchTags && state.searchTags.length > 0);
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
      'following': t('cat.following', 'Подписки'),
      'recommended': t('cat.recommended', 'Для вас'),
      'random': t('cat.random', 'Случайно'),
      'favorites': t('cat.favorites', 'Избранное')
    };
    if (state.currentCategory !== 'profile') {
      mobileNavFeedLabel.textContent = catMap[state.currentCategory] || t('cat.feed', 'Лента');
    }
  }
}
