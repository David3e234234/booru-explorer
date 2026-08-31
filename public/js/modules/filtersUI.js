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
  const supportedCats = new Set(caps.supportedCategories || ['feed', 'following', 'recommended']);
  if (state.settings?.recommendationMode === 'off' || state.settings?.enableRecommendations === false) {
    supportedCats.delete('recommended');
  }
  
  document.querySelectorAll('.nav-tab').forEach(tab => {
    const cat = tab.dataset.category;
    if (cat) {
      tab.style.display = (supportedCats.has(cat) || (cat === 'feed' && supportedCats.has('feed'))) ? '' : 'none';
    }
  });

  document.querySelectorAll('.category-card').forEach(card => {
    const cat = card.dataset.category;
    if (cat) {
      card.style.display = (supportedCats.has(cat) || (cat === 'feed' && supportedCats.has('feed'))) ? '' : 'none';
    }
  });

  if (state.currentCategory !== 'favorites' && state.currentCategory !== 'profile') {
    if (!supportedCats.has(state.currentCategory)) {
      state.currentCategory = (caps.supportedCategories && caps.supportedCategories[0]) || 'feed';
    }
  }

  // 1.1 Post sorting block (hide on sites without sorting like Pawchive)
  const postSortBlock = document.getElementById('postSortBlock');
  if (postSortBlock) {
    postSortBlock.style.display = caps.supportsSort ? '' : 'none';
  }
  if (!caps.supportsSort && state.postSort !== 'new') {
    state.postSort = 'new';
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
  updatePostSortUI();
  updateAiFilterUI();
  updateRatingFilterUI();
  updateTypeFilterUI();
  updateAgeFilterUI();
  updatePawchiveServiceUI();
  updateVideoSortUI();
  updateFilterActiveDot();
}

export function updatePostSortUI() {
  document.querySelectorAll('.sort-pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.sort === (state.postSort || 'new'));
  });
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
  const isCustom = (caps.supportsSort && state.postSort && state.postSort !== 'new') ||
                   (caps.supportsAiFilter && state.aiFilter !== 'no-ai' && state.aiFilter !== 'all') ||
                   (caps.rating === 'all' && state.ratingFilter !== 'all') ||
                   (caps.supportsVideo && caps.supportsImages && state.typeFilter !== 'all') ||
                   (caps.supportsShapesFilter && state.ageFilter !== 'all') ||
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
    const tabCat = tab.dataset.category;
    const isFeedActive = (state.currentCategory === 'feed' || state.currentCategory === 'new' || state.currentCategory === 'views' || state.currentCategory === 'top') && (tabCat === 'feed' || tabCat === 'new');
    tab.classList.toggle('active', tabCat === state.currentCategory || isFeedActive);
  });
  document.querySelectorAll('.category-card').forEach(card => {
    const cardCat = card.dataset.category;
    const isFeedActive = (state.currentCategory === 'feed' || state.currentCategory === 'new' || state.currentCategory === 'views' || state.currentCategory === 'top') && (cardCat === 'feed' || cardCat === 'new');
    card.classList.toggle('active', cardCat === state.currentCategory || isFeedActive);
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

  const recommendationsHeaderBar = document.getElementById('recommendationsHeaderBar');
  if (recommendationsHeaderBar) {
    recommendationsHeaderBar.style.display = state.currentCategory === 'recommended' ? 'flex' : 'none';
    if (state.currentCategory === 'recommended') {
      const curFocus = state.recommendationFocus || state.settings?.recommendationFocus || 'all';
      recommendationsHeaderBar.querySelectorAll('.rec-focus-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-focus') === curFocus);
      });
    }
  }

  const mobileNavFeedLabel = document.getElementById('mobileNavFeedLabel');
  if (mobileNavFeedLabel) {
    const catMap = {
      'feed': t('cat.feed', 'Лента'),
      'following': t('cat.following', 'Подписки'),
      'recommended': t('cat.recommended', 'Для вас'),
      'favorites': t('cat.favorites', 'Избранное')
    };
    if (state.currentCategory !== 'profile') {
      mobileNavFeedLabel.textContent = catMap[state.currentCategory] || t('cat.feed', 'Лента');
    }
  }
}
