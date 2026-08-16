import { state, setFavorites, setFavoriteAuthors, isAuthorFavorite, addSearchTag } from './state.js';
import { fetchSites, fetchPosts, fetchFavorites, fetchFavoriteAuthors, toggleFavoriteAuthor, deleteFavoriteAuthor, fetchSettings, saveSettings, fetchCacheInfo, clearCache } from './api.js';
import { initAutocomplete } from './autocomplete.js';
import { initGallery } from './gallery.js';
import { initViewer } from './viewer.js';

// DOM элементы
const sourcesList = document.getElementById('sourcesList');
const badgeFavCount = document.getElementById('badgeFavCount');
const toastContainer = document.getElementById('toastContainer');
const checkHideFurry = document.getElementById('checkHideFurry');
const checkHidePregnant = document.getElementById('checkHidePregnant');
const sidebarTagsList = document.getElementById('sidebarTagsList');
const sidebarTagsCount = document.getElementById('sidebarTagsCount');
const btnRefreshSearch = document.getElementById('btnRefreshSearch');

// Элементы подвкладки Избранного и Любимых авторов
const favoritesHeaderBar = document.getElementById('favoritesHeaderBar');
const btnFavSubPosts = document.getElementById('btnFavSubPosts');
const btnFavSubAuthors = document.getElementById('btnFavSubAuthors');
const favPostsCountBadge = document.getElementById('favPostsCountBadge');
const favAuthorsCountBadge = document.getElementById('favAuthorsCountBadge');
const favAuthorsActions = document.getElementById('favAuthorsActions');
const favAuthorsSearchInput = document.getElementById('favAuthorsSearchInput');
const btnAddAuthorModalOpen = document.getElementById('btnAddAuthorModalOpen');
const modalAddAuthorBackdrop = document.getElementById('modalAddAuthorBackdrop');
const formAddAuthor = document.getElementById('formAddAuthor');
const inputAuthorName = document.getElementById('inputAuthorName');
const selectAuthorSite = document.getElementById('selectAuthorSite');
const btnCloseAddAuthorModal = document.getElementById('btnCloseAddAuthorModal');
const btnCancelAddAuthor = document.getElementById('btnCancelAddAuthor');

// Модалка настроек
const settingsModal = document.getElementById('settingsModal');
const settingsBackdrop = document.getElementById('settingsBackdrop');
const btnSettings = document.getElementById('btnSettings');
const btnCloseSettings = document.getElementById('btnCloseSettings');
const btnSaveSettings = document.getElementById('btnSaveSettings');
const btnResetSettings = document.getElementById('btnResetSettings');
const blacklistWrapper = document.getElementById('blacklistWrapper');
const blacklistInput = document.getElementById('blacklistInput');
const aiTagsWrapper = document.getElementById('aiTagsWrapper');
const aiTagsInput = document.getElementById('aiTagsInput');
const inputRule34ApiKey = document.getElementById('inputRule34ApiKey');
const inputRule34UserId = document.getElementById('inputRule34UserId');
const inputGelbooruApiKey = document.getElementById('inputGelbooruApiKey');
const inputGelbooruUserId = document.getElementById('inputGelbooruUserId');
const inputDanbooruApiKey = document.getElementById('inputDanbooruApiKey');
const inputDanbooruLogin = document.getElementById('inputDanbooruLogin');
const selectItemsPerPage = document.getElementById('selectItemsPerPage');
const selectPreviewQuality = document.getElementById('selectPreviewQuality');
const checkVideoAutoplayHover = document.getElementById('checkVideoAutoplayHover');
const checkVideoAutoplayMobile = document.getElementById('checkVideoAutoplayMobile');
const checkVideoAutoplayViewer = document.getElementById('checkVideoAutoplayViewer');
const checkProxyVideoDefault = document.getElementById('checkProxyVideoDefault');
const checkShowVideoStatusBanner = document.getElementById('checkShowVideoStatusBanner');
const drawerBackdrop = document.getElementById('drawerBackdrop');
const sidebarSearch = document.getElementById('sidebarSearch');
const categoriesSheet = document.getElementById('categoriesSheet');
const sourcesSheet = document.getElementById('sourcesSheet');
const pwaInstallGroup = document.getElementById('pwaInstallGroup');
const btnInstallPwa = document.getElementById('btnInstallPwa');

let deferredInstallPrompt = null;

function haptic(pattern = 12) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch (e) {}
  }
}

export function openDrawer(drawerEl) {
  if (!drawerEl) return;
  const isOpen = drawerEl.classList.contains('open');
  closeAllDrawers();
  if (!isOpen) {
    drawerEl.classList.add('open');
    if (drawerBackdrop) drawerBackdrop.classList.add('active');

    // Подсветка соответствующей вкладки в нижнем баре
    document.querySelectorAll('.mobile-nav-item').forEach(item => {
      if (drawerEl === categoriesSheet) item.classList.toggle('active', item.dataset.nav === 'feed');
      else if (drawerEl === sidebarSearch) item.classList.toggle('active', item.dataset.nav === 'filters');
      else if (drawerEl === sourcesSheet) item.classList.toggle('active', item.dataset.nav === 'sources');
      else item.classList.remove('active');
    });
  }
}

export function closeAllDrawers() {
  if (sidebarSearch) sidebarSearch.classList.remove('open');
  if (categoriesSheet) categoriesSheet.classList.remove('open');
  if (sourcesSheet) sourcesSheet.classList.remove('open');
  if (drawerBackdrop) drawerBackdrop.classList.remove('active');
  if (settingsModal && settingsModal.style.display === 'flex') {
    closeSettingsModal();
  }
  updateCategoryTabsUI();
}

let tempBlacklist = [];
let tempAiTags = [];

export function showToast(message) {
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

let autocompleteInstance = null;
let galleryInstance = null;
let viewerInstance = null;

async function init() {
  // 1. Инициализация подсистем
  autocompleteInstance = initAutocomplete({
    onSearch: () => performSearch(true)
  });

  galleryInstance = initGallery({
    onOpenViewer: (index) => viewerInstance.openViewer(index),
    onFavoriteToggle: updateFavoritesBadge,
    onTagClick: (tag) => {
      autocompleteInstance.selectTag(tag);
    },
    onLoadMore: () => {
      if (!state.isLoading && state.hasMore) {
        state.page++;
        galleryInstance.showScrollLoading();
        performSearch(false);
      }
    },
    onRefresh: () => {
      performSearch(true);
    }
  });

  viewerInstance = initViewer({
    onFavoriteToggle: () => {
      galleryInstance.renderGallery(false);
      updateFavoritesBadge();
    },
    onFavoriteAuthorToggle: () => {
      updateFavoritesBadge();
      if (state.currentCategory === 'favorites' && state.favoritesSubTab === 'authors') {
        renderFavoriteAuthors();
      }
    },
    onTagSelect: (tag) => {
      autocompleteInstance.selectTag(tag);
    },
    showToast
  });

  // Рендерим источники сразу (десктоп и мобильные)
  renderSitesBar();
  renderMobileSourcesSheet();

  // 2. СРАЗУ настраиваем слушатели всех кнопок (не блокируя UI)
  setupEventListeners();

  // 3. Загрузка настроек, избранного и сайтов параллельно
  await Promise.allSettled([
    loadUserSettings(),
    loadFavorites(),
    loadFavoriteAuthors(),
    loadBooruSites()
  ]);

  // 4. Первичный поиск
  await performSearch(true);
}

async function loadUserSettings() {
  try {
    const data = await fetchSettings();
    if (data.settings) {
      state.settings = data.settings;
      if (data.settings.theme) {
        document.documentElement.setAttribute('data-theme', data.settings.theme);
      }
      const savedSite = data.settings.defaultSite || localStorage.getItem('booru_selected_site');
      if (savedSite) {
        state.currentSite = savedSite;
      }
      if (data.settings.aiFilter) {
        state.aiFilter = data.settings.aiFilter;
        updateAiFilterUI();
      }
      if (data.settings.ratingFilter) {
        state.ratingFilter = data.settings.ratingFilter;
        updateRatingFilterUI();
      }
      if (data.settings.typeFilter) {
        state.typeFilter = data.settings.typeFilter;
        updateTypeFilterUI();
      }
      if (data.settings.ageFilter) {
        state.ageFilter = data.settings.ageFilter;
        updateAgeFilterUI();
      }
      if (typeof data.settings.hideFurry === 'boolean') {
        state.hideFurry = data.settings.hideFurry;
        checkHideFurry.checked = state.hideFurry;
      }
      if (typeof data.settings.hidePregnant === 'boolean') {
        state.hidePregnant = data.settings.hidePregnant;
        checkHidePregnant.checked = state.hidePregnant;
      }
      if (data.settings.rule34ApiKey) {
        inputRule34ApiKey.value = data.settings.rule34ApiKey;
      }
      if (data.settings.rule34UserId) {
        inputRule34UserId.value = data.settings.rule34UserId;
      }
      if (data.settings.itemsPerPage) {
        state.limit = data.settings.itemsPerPage;
        if (selectItemsPerPage) selectItemsPerPage.value = String(data.settings.itemsPerPage);
      }
      if (typeof data.settings.proxyVideoDefault === 'boolean') {
        if (checkProxyVideoDefault) checkProxyVideoDefault.checked = data.settings.proxyVideoDefault;
      }
      if (data.settings.previewQuality && selectPreviewQuality) {
        selectPreviewQuality.value = data.settings.previewQuality;
      }
      if (typeof data.settings.videoAutoplayHover === 'boolean' && checkVideoAutoplayHover) {
        checkVideoAutoplayHover.checked = data.settings.videoAutoplayHover;
      }
      if (typeof data.settings.videoAutoplayMobile === 'boolean' && checkVideoAutoplayMobile) {
        checkVideoAutoplayMobile.checked = data.settings.videoAutoplayMobile;
      }
      if (typeof data.settings.videoAutoplayViewer === 'boolean' && checkVideoAutoplayViewer) {
        checkVideoAutoplayViewer.checked = data.settings.videoAutoplayViewer;
      }
      if (typeof data.settings.enablePaheal === 'boolean') {
        const checkEnablePaheal = document.getElementById('checkEnablePaheal');
        if (checkEnablePaheal) checkEnablePaheal.checked = data.settings.enablePaheal;
      }
    }
  } catch (err) {
    console.error('Ошибка настроек:', err);
  }
}

async function loadFavorites() {
  try {
    const data = await fetchFavorites();
    setFavorites(data.favorites || []);
    updateFavoritesBadge();
  } catch (err) {
    console.error('Ошибка избранного:', err);
  }
}

async function loadFavoriteAuthors() {
  try {
    const data = await fetchFavoriteAuthors();
    setFavoriteAuthors(data.authors || []);
    updateFavoritesBadge();
  } catch (err) {
    console.error('Ошибка любимых авторов:', err);
  }
}

function updateFavoritesBadge() {
  const postsCount = state.favorites ? state.favorites.length : 0;
  const authorsCount = state.favoriteAuthors ? state.favoriteAuthors.length : 0;
  const totalCount = postsCount + authorsCount;
  const countStr = String(totalCount);

  if (badgeFavCount) badgeFavCount.textContent = countStr;
  const badgeFavCountMobile = document.getElementById('badgeFavCountMobile');
  if (badgeFavCountMobile) badgeFavCountMobile.textContent = countStr;

  if (favPostsCountBadge) favPostsCountBadge.textContent = String(postsCount);
  if (favAuthorsCountBadge) favAuthorsCountBadge.textContent = String(authorsCount);
}

function switchFavoritesSubTab(tab) {
  state.favoritesSubTab = tab;
  if (btnFavSubPosts) btnFavSubPosts.classList.toggle('active', tab === 'posts');
  if (btnFavSubAuthors) btnFavSubAuthors.classList.toggle('active', tab === 'authors');
  if (favAuthorsActions) favAuthorsActions.style.display = tab === 'authors' ? 'flex' : 'none';

  if (tab === 'authors') {
    renderFavoriteAuthors();
  } else {
    performSearch(true);
  }
}

function renderFavoriteAuthors() {
  const query = (favAuthorsSearchInput?.value || '').trim().toLowerCase();
  let authors = [...state.favoriteAuthors];
  if (query) {
    authors = authors.filter(a =>
      (a.name || '').toLowerCase().includes(query) ||
      (a.displayName || '').toLowerCase().includes(query)
    );
  }
  galleryInstance.renderAuthorCards(authors, {
    onExplore: handleExploreAuthor,
    onDelete: handleDeleteAuthor
  });
}

function handleExploreAuthor(author) {
  if (!author || !author.name) return;
  if (author.site && state.sites.some(s => s.id === author.site)) {
    state.currentSite = author.site;
    renderSitesBar();
  }
  state.searchTags = [];
  addSearchTag(author.name);
  if (autocompleteInstance) {
    autocompleteInstance.renderTagsChips();
  }
  selectCategory('new');
  showToast(`Поиск работ автора: ${author.displayName || author.name} 🎨`);
}

async function handleDeleteAuthor(author) {
  if (!author || !author.name) return;
  try {
    const res = await deleteFavoriteAuthor(author.name);
    if (res.success) {
      const cleanName = (author.name || '').toLowerCase().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_');
      state.favoriteAuthorNames.delete(cleanName);
      state.favoriteAuthors = res.authors || state.favoriteAuthors.filter(a => (a.name || '').toLowerCase() !== cleanName);
      updateFavoritesBadge();
      renderFavoriteAuthors();
      showToast(`Автор ${author.displayName || author.name} удален из любимых`);
    }
  } catch (err) {
    console.error('Ошибка удаления автора:', err);
    showToast('Не удалось удалить автора', 'error');
  }
}

async function loadBooruSites() {
  try {
    const data = await fetchSites();
    state.sites = data.sites || [];
    renderSitesBar();
    renderMobileSourcesSheet();
  } catch (err) {
    console.error('Ошибка сайтов:', err);
  }
}

function renderSitesBar() {
  sourcesList.innerHTML = '';

  const allItem = document.createElement('div');
  allItem.className = `source-item ${state.currentSite === 'all' ? 'active' : ''}`;
  allItem.innerHTML = `
    <span class="source-dot" style="background-color: var(--accent-primary)"></span>
    <span>⚡ Все сразу</span>
  `;
  allItem.addEventListener('click', () => selectSite('all'));
  sourcesList.appendChild(allItem);

  state.sites.forEach(site => {
    const item = document.createElement('div');
    item.className = `source-item ${state.currentSite === site.id ? 'active' : ''}`;
    item.innerHTML = `
      <span class="source-dot" style="background-color: ${site.accentColor || 'var(--text-muted)'}"></span>
      <span>${site.name}</span>
    `;
    item.addEventListener('click', () => selectSite(site.id));
    sourcesList.appendChild(item);
  });
}

function renderMobileSourcesSheet() {
  const sourcesListMobile = document.getElementById('sourcesListMobile');
  if (!sourcesListMobile) return;
  sourcesListMobile.innerHTML = '';

  const allCard = document.createElement('div');
  allCard.className = `source-mobile-card ${state.currentSite === 'all' ? 'active' : ''}`;
  allCard.innerHTML = `
    <div class="source-mobile-title-wrap">
      <span class="source-dot" style="background-color: var(--accent-primary)"></span>
      <span class="source-mobile-name">⚡ Все сразу</span>
    </div>
    <span class="source-mobile-badge">ALL</span>
  `;
  allCard.addEventListener('click', () => {
    selectSite('all');
    closeAllDrawers();
  });
  sourcesListMobile.appendChild(allCard);

  state.sites.forEach(site => {
    const card = document.createElement('div');
    card.className = `source-mobile-card ${state.currentSite === site.id ? 'active' : ''}`;
    card.innerHTML = `
      <div class="source-mobile-title-wrap">
        <span class="source-dot" style="background-color: ${site.accentColor || 'var(--text-muted)'}"></span>
        <span class="source-mobile-name" title="${site.name}">${site.name}</span>
      </div>
      <span class="source-mobile-badge">${(site.id || '').toUpperCase()}</span>
    `;
    card.addEventListener('click', () => {
      selectSite(site.id);
      closeAllDrawers();
    });
    sourcesListMobile.appendChild(card);
  });
}

function selectSite(siteId) {
  if (state.currentSite === siteId && state.currentCategory !== 'favorites') return;
  state.currentSite = siteId;
  try {
    localStorage.setItem('booru_selected_site', siteId);
    saveSettings({ defaultSite: siteId }).catch(() => {});
  } catch {}
  if (state.currentCategory === 'favorites') {
    state.currentCategory = 'new';
    updateCategoryTabsUI();
  }
  const currentSiteLabel = document.getElementById('currentSiteLabel');
  if (currentSiteLabel) {
    if (siteId === 'all') {
      currentSiteLabel.textContent = 'Все сразу';
    } else {
      const siteObj = state.sites.find(s => s.id === siteId);
      currentSiteLabel.textContent = siteObj ? siteObj.name : siteId;
    }
  }
  renderSitesBar();
  renderMobileSourcesSheet();
  performSearch(true);
}

function updateAiFilterUI() {
  document.querySelectorAll('.ai-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.ai === state.aiFilter);
  });
  updateFilterActiveDot();
}

function updateRatingFilterUI() {
  document.querySelectorAll('.rating-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.rating === state.ratingFilter);
  });
  updateFilterActiveDot();
}

function updateTypeFilterUI() {
  document.querySelectorAll('.type-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === state.typeFilter);
  });
  updateFilterActiveDot();
}

function updateAgeFilterUI() {
  document.querySelectorAll('.age-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.age === state.ageFilter);
  });
  updateFilterActiveDot();
}

function updateFilterActiveDot() {
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

function updateCategoryTabsUI() {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.category === state.currentCategory);
  });
  document.querySelectorAll('.category-card').forEach(card => {
    card.classList.toggle('active', card.dataset.category === state.currentCategory);
  });
  document.querySelectorAll('.mobile-nav-item').forEach(item => {
    if (state.currentCategory === 'favorites') {
      item.classList.toggle('active', item.dataset.nav === 'favorites');
    } else {
      item.classList.toggle('active', item.dataset.nav === 'feed');
    }
  });

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
      'popular': 'Популярное',
      'top': 'Топ',
      'random': 'Случайно',
      'favorites': 'Избранное'
    };
    mobileNavFeedLabel.textContent = catMap[state.currentCategory] || 'Лента';
  }
}

function renderSidebarPageTags() {
  if (!state.posts || state.posts.length === 0) {
    sidebarTagsList.innerHTML = '<span class="empty-tags-hint">Теги отсутствуют</span>';
    sidebarTagsCount.textContent = '0';
    return;
  }

  const tagFrequency = {};
  const tagCategories = {};

  state.posts.forEach(post => {
    const tags = Array.isArray(post.tags) ? post.tags : [];
    tags.forEach(t => {
      const clean = typeof t === 'string' ? t.toLowerCase().trim() : String(t || '').toLowerCase().trim();
      if (!clean) return;
      tagFrequency[clean] = (tagFrequency[clean] || 0) + 1;

      if (post.tagDetails) {
        if (post.tagDetails.artist?.includes(clean)) tagCategories[clean] = 'artist';
        else if (post.tagDetails.character?.includes(clean)) tagCategories[clean] = 'character';
        else if (post.tagDetails.copyright?.includes(clean)) tagCategories[clean] = 'copyright';
        else if (post.tagDetails.meta?.includes(clean)) tagCategories[clean] = 'meta';
      }
    });
  });

  const sortedTags = Object.entries(tagFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40);

  sidebarTagsCount.textContent = String(sortedTags.length);
  sidebarTagsList.innerHTML = '';

  sortedTags.forEach(([tag, count]) => {
    const category = tagCategories[tag] || 'general';
    const tagEl = document.createElement('div');
    tagEl.className = 'sidebar-tag-item';
    tagEl.title = `Искать по тегу: ${tag}`;
    tagEl.innerHTML = `
      <span class="s-tag-name category-${category}">${tag.replace(/_/g, ' ')}</span>
      <span class="s-tag-count">${count}</span>
    `;

    tagEl.addEventListener('click', () => {
      autocompleteInstance.selectTag(tag);
    });

    sidebarTagsList.appendChild(tagEl);
  });
}

async function performSearch(reset = false, options = {}) {
  if (favoritesHeaderBar) {
    favoritesHeaderBar.style.display = state.currentCategory === 'favorites' ? 'flex' : 'none';
  }

  if (reset) {
    state.page = 1;
    state.posts = [];
    state.hasMore = true;
    galleryInstance.showLoading();
  }

  if (state.currentCategory === 'favorites') {
    if (state.favoritesSubTab === 'authors') {
      renderFavoriteAuthors();
      return;
    }
    state.posts = [...state.favorites];
    if (state.searchTags.length > 0) {
      state.posts = state.posts.filter(p => {
        const postTags = Array.isArray(p.tags) ? p.tags.map(t => t.toLowerCase()) : [];
        return state.searchTags.every(st => postTags.some(pt => pt.includes(st)));
      });
    }
    state.hasMore = false;
    galleryInstance.renderGallery(false);
    renderSidebarPageTags();
    return;
  }

  try {
    state.isLoading = true;
    const btnRefreshSearch = document.getElementById('btnRefreshSearch');
    if (btnRefreshSearch) btnRefreshSearch.classList.add('refreshing');

    const currentLimit = state.settings.itemsPerPage || state.limit || 100;
    const res = await fetchPosts({
      site: state.currentSite,
      tags: state.searchTags.join(' '),
      page: state.page,
      limit: currentLimit,
      category: state.currentCategory,
      aiFilter: state.aiFilter,
      ratingFilter: state.ratingFilter,
      typeFilter: state.typeFilter,
      ageFilter: state.ageFilter,
      hideFurry: state.hideFurry,
      hidePregnant: state.hidePregnant,
      bustCache: options.bustCache || false
    });

    if (res.success && Array.isArray(res.posts)) {
      if (reset) {
        state.posts = res.posts;
      } else {
        const existingIds = new Set(state.posts.map(p => p.id));
        const newPosts = res.posts.filter(p => !existingIds.has(p.id));
        state.posts.push(...newPosts);
      }
      state.hasMore = res.posts.length > 0;
    } else {
      if (reset) state.posts = [];
      state.hasMore = false;
    }

    galleryInstance.renderGallery(!reset);
    renderSidebarPageTags();
  } catch (err) {
    console.error('Ошибка поиска:', err);
    if (reset) state.posts = [];
    galleryInstance.renderGallery(false);
  } finally {
    state.isLoading = false;
    const btnRefreshSearch = document.getElementById('btnRefreshSearch');
    if (btnRefreshSearch) btnRefreshSearch.classList.remove('refreshing');
  }
}

function selectCategory(category) {
  if (state.currentCategory === category && category !== 'favorites') return;
  state.currentCategory = category;
  updateCategoryTabsUI();
  performSearch(true);
}

function setupEventListeners() {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const cat = tab.dataset.category;
      if (cat) selectCategory(cat);
    });
  });

  // Фильтр ИИ
  document.querySelectorAll('.ai-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const filter = pill.dataset.ai;
      if (state.aiFilter === filter) return;
      state.aiFilter = filter;
      updateAiFilterUI();
      saveSettings({ aiFilter: filter });
      performSearch(true);
    });
  });

  // Фильтр Возрастного Рейтинга (SFW / NSFW)
  document.querySelectorAll('.rating-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const rating = pill.dataset.rating;
      if (state.ratingFilter === rating) return;
      state.ratingFilter = rating;
      updateRatingFilterUI();
      saveSettings({ ratingFilter: rating });
      performSearch(true);
    });
  });

  // Переключатель Типа контента (Все / Видео / Фото)
  document.querySelectorAll('.type-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const type = pill.dataset.type;
      if (state.typeFilter === type) return;
      state.typeFilter = type;
      updateTypeFilterUI();
      saveSettings({ typeFilter: type });
      performSearch(true);
    });
  });

  // Фильтр Возраста (Все / Взрослые / Молодые)
  document.querySelectorAll('.age-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const age = pill.dataset.age;
      if (state.ageFilter === age) return;
      state.ageFilter = age;
      updateAgeFilterUI();
      saveSettings({ ageFilter: age });
      performSearch(true);
    });
  });

  // Тумблеры фурри и беременности
  checkHideFurry.addEventListener('change', () => {
    state.hideFurry = checkHideFurry.checked;
    saveSettings({ hideFurry: state.hideFurry });
    performSearch(true);
  });

  checkHidePregnant.addEventListener('change', () => {
    state.hidePregnant = checkHidePregnant.checked;
    saveSettings({ hidePregnant: state.hidePregnant });
    performSearch(true);
  });

  // Логотип
  document.getElementById('btnLogo').addEventListener('click', () => {
    state.searchTags = [];
    state.currentCategory = 'new';
    state.currentSite = 'danbooru';
    autocompleteInstance.renderTagsChips();
    updateCategoryTabsUI();
    renderSitesBar();
    performSearch(true);
  });

  // Кнопка Обновить поиск (сброс кеша)
  if (btnRefreshSearch) {
    btnRefreshSearch.addEventListener('click', async () => {
      if (btnRefreshSearch.classList.contains('refreshing')) return;
      btnRefreshSearch.classList.add('refreshing');
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        await performSearch(true, { bustCache: true });
        showToast('Поиск обновлен 🔄');
      } catch (e) {
        showToast('Ошибка при обновлении поиска');
      } finally {
        setTimeout(() => {
          btnRefreshSearch.classList.remove('refreshing');
        }, 350);
      }
    });
  }

  // Кнопка Перемешать
  const btnShuffleGallery = document.getElementById('btnShuffleGallery');
  if (btnShuffleGallery) {
    btnShuffleGallery.addEventListener('click', () => {
      if (!state.posts || state.posts.length <= 1) {
        showToast('Недостаточно постов для перемешивания');
        return;
      }
      // Fisher-Yates shuffle
      for (let i = state.posts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.posts[i], state.posts[j]] = [state.posts[j], state.posts[i]];
      }
      galleryInstance.renderGallery(false);
      renderSidebarPageTags();
      showToast('Лента перемешана вразнобой 🔀');
    });
  }

  // Модалка настроек
  btnSettings.addEventListener('click', openSettingsModal);
  btnCloseSettings.addEventListener('click', closeSettingsModal);
  settingsBackdrop.addEventListener('click', closeSettingsModal);
  btnSaveSettings.addEventListener('click', handleSaveSettings);
  btnResetSettings.addEventListener('click', handleResetSettings);

  blacklistInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && blacklistInput.value.trim()) {
      e.preventDefault();
      const val = blacklistInput.value.trim().toLowerCase().replace(/\s+/g, '_');
      if (!tempBlacklist.includes(val)) {
        tempBlacklist.push(val);
        renderSettingsChips();
      }
      blacklistInput.value = '';
    }
  });

  aiTagsInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && aiTagsInput.value.trim()) {
      e.preventDefault();
      const val = aiTagsInput.value.trim().toLowerCase().replace(/\s+/g, '_');
      if (!tempAiTags.includes(val)) {
        tempAiTags.push(val);
        renderSettingsChips();
      }
      aiTagsInput.value = '';
    }
  });

  // Управление памятью и кэшем
  const btnRefreshStorage = document.getElementById('btnRefreshStorage');
  if (btnRefreshStorage) {
    btnRefreshStorage.addEventListener('click', async () => {
      btnRefreshStorage.style.transform = 'rotate(360deg)';
      await updateStorageUsageInfo();
      setTimeout(() => { btnRefreshStorage.style.transform = ''; }, 400);
      showToast('Данные о памяти обновлены 💾');
    });
  }

  const btnClearStorageBtn = document.getElementById('btnClearStorageBtn');
  if (btnClearStorageBtn) {
    btnClearStorageBtn.addEventListener('click', handleClearStorageCache);
  }

  document.querySelectorAll('.btn-theme').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-theme').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const themeVal = btn.dataset.themeVal;
      document.documentElement.setAttribute('data-theme', themeVal);
    });
  });

  // Управление мобильными шторками и сайдбаром
  const btnCloseSidebar = document.getElementById('btnCloseSidebar');
  const btnCloseCategoriesSheet = document.getElementById('btnCloseCategoriesSheet');
  const btnCloseSourcesSheet = document.getElementById('btnCloseSourcesSheet');
  const headerStatusBox = document.getElementById('headerStatusBox');

  if (drawerBackdrop) drawerBackdrop.addEventListener('click', closeAllDrawers);
  if (btnCloseSidebar) btnCloseSidebar.addEventListener('click', closeAllDrawers);
  if (btnCloseCategoriesSheet) btnCloseCategoriesSheet.addEventListener('click', closeAllDrawers);
  if (btnCloseSourcesSheet) btnCloseSourcesSheet.addEventListener('click', closeAllDrawers);

  // Тапы по нижнему мобильному бару
  const btnNavFeed = document.getElementById('btnNavFeed');
  const btnNavFilters = document.getElementById('btnNavFilters');
  const btnNavSources = document.getElementById('btnNavSources');
  const btnNavFavorites = document.getElementById('btnNavFavorites');
  const btnNavSettings = document.getElementById('btnNavSettings');

  if (btnNavFeed) {
    btnNavFeed.addEventListener('click', () => {
      haptic(15);
      openDrawer(categoriesSheet);
    });
  }

  if (btnNavFilters) {
    btnNavFilters.addEventListener('click', () => {
      haptic(15);
      openDrawer(sidebarSearch);
    });
  }

  if (btnNavSources) {
    btnNavSources.addEventListener('click', () => {
      haptic(15);
      openDrawer(sourcesSheet);
    });
  }

  if (btnNavFavorites) {
    btnNavFavorites.addEventListener('click', () => {
      haptic(20);
      closeAllDrawers();
      selectCategory('favorites');
    });
  }

  // Переключение подвкладок в разделе Избранное (Посты / Авторы)
  if (btnFavSubPosts) {
    btnFavSubPosts.addEventListener('click', () => {
      haptic(10);
      switchFavoritesSubTab('posts');
    });
  }

  if (btnFavSubAuthors) {
    btnFavSubAuthors.addEventListener('click', () => {
      haptic(10);
      switchFavoritesSubTab('authors');
    });
  }

  if (favAuthorsSearchInput) {
    favAuthorsSearchInput.addEventListener('input', () => {
      renderFavoriteAuthors();
    });
  }

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
          await loadFavoriteAuthors();
          closeAddAuthorModal();
          showToast(`Автор ${rawName} сохранён в любимые ⭐`);
          if (state.currentCategory === 'favorites' && state.favoritesSubTab === 'authors') {
            renderFavoriteAuthors();
          }
        } else {
          showToast(res.message || 'Ошибка сохранения автора', 'error');
        }
      } catch (err) {
        console.error('Ошибка добавления автора:', err);
        showToast('Ошибка сохранения автора', 'error');
      }
    });
  }

  if (btnNavSettings) {
    btnNavSettings.addEventListener('click', () => {
      haptic(15);
      closeAllDrawers();
      openSettingsModal();
    });
  }

  if (headerStatusBox) {
    headerStatusBox.addEventListener('click', () => {
      haptic(15);
      if (window.innerWidth <= 800) {
        openDrawer(sourcesSheet);
      }
    });
  }

  // Клик по категориям в мобильной шторке
  document.querySelectorAll('.category-card').forEach(card => {
    card.addEventListener('click', () => {
      const cat = card.dataset.category;
      if (cat) {
        selectCategory(cat);
        closeAllDrawers();
      }
    });
  });

  // Мобильный переключатель сетки (1 или 2 колонки)
  const btnMobileGridToggle = document.getElementById('btnMobileGridToggle');
  const galleryGrid = document.getElementById('galleryGrid');
  let isMobile1Col = localStorage.getItem('booru_grid_mobile') === '1col';

  function applyMobileGrid() {
    if (!galleryGrid) return;
    if (isMobile1Col) {
      galleryGrid.classList.add('grid-1col');
      if (btnMobileGridToggle) {
        btnMobileGridToggle.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`;
        btnMobileGridToggle.title = 'Режим 1 колонка (нажмите для 2 колонок)';
      }
    } else {
      galleryGrid.classList.remove('grid-1col');
      if (btnMobileGridToggle) {
        btnMobileGridToggle.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`;
        btnMobileGridToggle.title = 'Режим 2 колонки (нажмите для 1 колонки)';
      }
    }
  }

  if (btnMobileGridToggle) {
    applyMobileGrid();
    btnMobileGridToggle.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      isMobile1Col = !isMobile1Col;
      localStorage.setItem('booru_grid_mobile', isMobile1Col ? '1col' : '2col');
      applyMobileGrid();
      showToast(isMobile1Col ? 'Сетка: 1 колонка (крупная лента)' : 'Сетка: 2 колонки (компактно)');
    });
  }

  // Десктопный переключатель размера колонок сетки (small, medium, large)
  const desktopGridButtons = document.querySelectorAll('#desktopGridSizeSelector .btn-size');
  let savedDesktopGrid = localStorage.getItem('booru_grid_desktop') || 'medium';

  function applyDesktopGrid(mode) {
    if (!galleryGrid) return;
    galleryGrid.classList.remove('grid-small', 'grid-large');
    if (mode === 'small') galleryGrid.classList.add('grid-small');
    else if (mode === 'large') galleryGrid.classList.add('grid-large');

    desktopGridButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.cols === mode);
    });
  }

  if (desktopGridButtons.length > 0) {
    applyDesktopGrid(savedDesktopGrid);
    desktopGridButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.cols || 'medium';
        savedDesktopGrid = mode;
        localStorage.setItem('booru_grid_desktop', mode);
        applyDesktopGrid(mode);
      });
    });
  }

  // Кнопка «Наверх»
  const btnScrollToTop = document.getElementById('btnScrollToTop');
  if (btnScrollToTop) {
    window.addEventListener('scroll', () => {
      if (window.scrollY > 350) {
        btnScrollToTop.classList.add('visible');
      } else {
        btnScrollToTop.classList.remove('visible');
      }
    }, { passive: true });

    btnScrollToTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }



  // PWA Установка приложения
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (pwaInstallGroup) pwaInstallGroup.style.display = 'block';
  });

  if (btnInstallPwa) {
    btnInstallPwa.addEventListener('click', async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') {
          showToast('Приложение Booru Explorer устанавливается! 🚀');
          if (pwaInstallGroup) pwaInstallGroup.style.display = 'none';
        }
        deferredInstallPrompt = null;
      } else {
        showToast('Для установки нажмите «На экран "Домой"» в меню браузера 📱');
      }
    });
  }

  // Регистрация Service Worker для PWA и оффлайн-кэша
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        console.log('[PWA ServiceWorker] Успешно зарегистрирован:', reg.scope);
        // Принудительно проверяем обновления при запуске
        reg.update();
      }).catch(err => {
        console.warn('[PWA ServiceWorker] Ошибка регистрации:', err);
      });
    });

    // При возврате пользователя в PWA из фона - проверяем обновления
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(reg => reg.update()).catch(() => {});
      }
    });
  }

  if (btnSaveSettings) btnSaveSettings.addEventListener('click', handleSaveSettings);
  if (btnResetSettings) btnResetSettings.addEventListener('click', handleResetSettings);

  if (selectPreviewQuality) {
    selectPreviewQuality.addEventListener('change', () => {
      state.settings.previewQuality = selectPreviewQuality.value;
      if (galleryInstance) {
        galleryInstance.renderGallery(false);
      }
    });
  }

  // Закрытие модальных окон по Escape
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (settingsModal && settingsModal.style.display === 'flex') {
        closeSettingsModal();
      }
    }
  });
}

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes <= 0) return '0.0 МБ';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  if (i === 0) return bytes + ' ' + sizes[i];
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

async function updateStorageUsageInfo() {
  const usageText = document.getElementById('storageUsageText');
  const quotaText = document.getElementById('storageQuotaText');
  const progressBar = document.getElementById('storageProgressBar');
  const mediaCacheText = document.getElementById('storageMediaCacheText');
  const serverCacheText = document.getElementById('storageServerCacheText');

  if (!usageText) return;

  // 1. Клиентское хранилище устройства (Storage Manager API)
  let totalUsageBytes = 0;
  let totalQuotaBytes = 0;
  let clientMediaCacheBytes = 0;

  if (navigator.storage && navigator.storage.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      totalUsageBytes = estimate.usage || 0;
      totalQuotaBytes = estimate.quota || 0;
    } catch (e) {
      console.warn('[Storage] Ошибка оценки хранилища:', e);
    }
  }

  // Расчет кэша Service Worker / CacheStorage
  if ('caches' in window) {
    try {
      const keys = await caches.keys();
      for (const key of keys) {
        const cache = await caches.open(key);
        const requests = await cache.keys();
        clientMediaCacheBytes += requests.length * 32000;
      }
    } catch (e) {
      console.warn('[Storage] Ошибка подсчета CacheStorage:', e);
    }
  }

  // 2. Серверный кэш
  let serverMB = '0.0';
  let serverRam = 0;
  try {
    const info = await fetchCacheInfo();
    serverMB = info.diskCacheMB || '0.0';
    serverRam = info.ramCacheEntries || 0;
  } catch (e) {
    console.warn('[Storage] Ошибка получения серверного кэша:', e);
  }

  // Обновление UI
  const displayUsage = totalUsageBytes > 0 
    ? formatBytes(totalUsageBytes) 
    : (clientMediaCacheBytes > 0 ? formatBytes(clientMediaCacheBytes) : `${serverMB} МБ`);
  
  usageText.textContent = displayUsage;
  
  if (quotaText) {
    quotaText.textContent = totalQuotaBytes > 0 ? formatBytes(totalQuotaBytes, 0) : 'Доступно';
  }

  if (mediaCacheText) {
    mediaCacheText.textContent = clientMediaCacheBytes > 0 
      ? formatBytes(clientMediaCacheBytes) 
      : (totalUsageBytes > 0 ? formatBytes(totalUsageBytes * 0.85) : '0.0 МБ');
  }

  if (serverCacheText) {
    serverCacheText.textContent = `${serverMB} МБ (${serverRam} в RAM)`;
  }

  if (progressBar) {
    let percent = 1;
    if (totalQuotaBytes > 0 && totalUsageBytes > 0) {
      percent = Math.min(100, Math.max(1, (totalUsageBytes / totalQuotaBytes) * 100));
    } else if (parseFloat(serverMB) > 0) {
      percent = Math.min(100, Math.max(2, (parseFloat(serverMB) / 500) * 100));
    }
    progressBar.style.width = `${percent.toFixed(1)}%`;
  }
}

async function handleClearStorageCache() {
  const statusEl = document.getElementById('storageClearStatus');
  const btn = document.getElementById('btnClearStorageBtn');
  if (statusEl) statusEl.textContent = 'Очистка...';
  if (btn) btn.disabled = true;

  try {
    // 1. Очистка кэша браузера / Service Worker Cache
    if ('caches' in window) {
      const keys = await caches.keys();
      for (const key of keys) {
        await caches.delete(key);
      }
      console.log('[Storage] CacheStorage браузера успешно очищен');
    }

    // 2. Очистка серверного кэша
    try {
      await clearCache();
    } catch (e) {
      console.warn('[Storage] Серверный кэш не удалось очистить:', e);
    }

    showToast('Кэш медиа и запросов успешно очищен 🧹');
    if (statusEl) statusEl.textContent = 'Очищено!';
    
    // Пересчет статистики
    setTimeout(async () => {
      await updateStorageUsageInfo();
      if (statusEl) statusEl.textContent = '';
      if (btn) btn.disabled = false;
    }, 600);
  } catch (err) {
    console.error('[Storage] Ошибка очистки:', err);
    showToast('Ошибка при очистке кэша');
    if (statusEl) statusEl.textContent = 'Ошибка';
    if (btn) btn.disabled = false;
  }
}

function openSettingsModal() {
  tempBlacklist = [...(state.settings.blacklist || [])];
  tempAiTags = [...(state.settings.aiTags || [])];
  renderSettingsChips();
  updateStorageUsageInfo();

  if (inputRule34ApiKey) inputRule34ApiKey.value = state.settings.rule34ApiKey || '';
  if (inputRule34UserId) inputRule34UserId.value = state.settings.rule34UserId || '';
  if (inputGelbooruApiKey) inputGelbooruApiKey.value = state.settings.gelbooruApiKey || '';
  if (inputGelbooruUserId) inputGelbooruUserId.value = state.settings.gelbooruUserId || '';
  if (inputDanbooruApiKey) inputDanbooruApiKey.value = state.settings.danbooruApiKey || '';
  if (inputDanbooruLogin) inputDanbooruLogin.value = state.settings.danbooruLogin || '';

  if (selectItemsPerPage) selectItemsPerPage.value = state.settings.itemsPerPage || 100;
  if (selectPreviewQuality) selectPreviewQuality.value = state.settings.previewQuality || 'medium';
  if (checkVideoAutoplayHover) checkVideoAutoplayHover.checked = state.settings.videoAutoplayHover !== false;
  if (checkVideoAutoplayMobile) checkVideoAutoplayMobile.checked = state.settings.videoAutoplayMobile !== false;
  if (checkVideoAutoplayViewer) checkVideoAutoplayViewer.checked = state.settings.videoAutoplayViewer !== false;
  if (checkProxyVideoDefault) checkProxyVideoDefault.checked = state.settings.proxyVideoDefault !== false;
  if (checkShowVideoStatusBanner) checkShowVideoStatusBanner.checked = state.settings.showVideoStatusBanner !== false;

  const selectDeepFetchPages = document.getElementById('selectDeepFetchPages');
  if (selectDeepFetchPages) selectDeepFetchPages.value = state.settings.deepFetchPages || 2;

  const checkPrioritizeUserTags = document.getElementById('checkPrioritizeUserTags');
  if (checkPrioritizeUserTags) checkPrioritizeUserTags.checked = state.settings.prioritizeUserTags || false;

  const checkEnablePaheal = document.getElementById('checkEnablePaheal');
  if (checkEnablePaheal) checkEnablePaheal.checked = state.settings.enablePaheal !== false;

  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  document.querySelectorAll('.btn-theme').forEach(b => {
    b.classList.toggle('active', b.dataset.themeVal === currentTheme);
  });

  settingsModal.style.display = 'flex';
  document.querySelectorAll('.mobile-nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.nav === 'settings');
  });
}

function closeSettingsModal() {
  settingsModal.style.display = 'none';
  updateCategoryTabsUI();
}

function renderSettingsChips() {
  blacklistWrapper.querySelectorAll('.tag-chip').forEach(c => c.remove());
  tempBlacklist.forEach(tag => {
    const chip = document.createElement('div');
    chip.className = 'tag-chip';
    chip.innerHTML = `
      <span>${tag}</span>
      <span class="tag-chip-remove" data-bl-tag="${tag}">×</span>
    `;
    chip.querySelector('.tag-chip-remove').addEventListener('click', () => {
      tempBlacklist = tempBlacklist.filter(t => t !== tag);
      renderSettingsChips();
    });
    blacklistWrapper.insertBefore(chip, blacklistInput);
  });

  aiTagsWrapper.querySelectorAll('.tag-chip').forEach(c => c.remove());
  tempAiTags.forEach(tag => {
    const chip = document.createElement('div');
    chip.className = 'tag-chip';
    chip.innerHTML = `
      <span>${tag}</span>
      <span class="tag-chip-remove" data-ai-tag="${tag}">×</span>
    `;
    chip.querySelector('.tag-chip-remove').addEventListener('click', () => {
      tempAiTags = tempAiTags.filter(t => t !== tag);
      renderSettingsChips();
    });
    aiTagsWrapper.insertBefore(chip, aiTagsInput);
  });
}

async function handleSaveSettings() {
  const activeThemeBtn = document.querySelector('.btn-theme.active');
  const theme = activeThemeBtn ? activeThemeBtn.dataset.themeVal : 'dark';

  const itemsPerPageVal = selectItemsPerPage ? (parseInt(selectItemsPerPage.value, 10) || 100) : 100;
  const previewQualityVal = selectPreviewQuality ? selectPreviewQuality.value : 'medium';
  const videoAutoplayHoverVal = checkVideoAutoplayHover ? checkVideoAutoplayHover.checked : true;
  const videoAutoplayMobileVal = checkVideoAutoplayMobile ? checkVideoAutoplayMobile.checked : true;
  const videoAutoplayViewerVal = checkVideoAutoplayViewer ? checkVideoAutoplayViewer.checked : true;
  const proxyVideoDefaultVal = checkProxyVideoDefault ? checkProxyVideoDefault.checked : true;
  const showVideoStatusBannerVal = checkShowVideoStatusBanner ? checkShowVideoStatusBanner.checked : true;
  
  const selectDeepFetchPages = document.getElementById('selectDeepFetchPages');
  const deepFetchPagesVal = selectDeepFetchPages ? (parseInt(selectDeepFetchPages.value, 10) || 2) : 2;

  const checkPrioritizeUserTags = document.getElementById('checkPrioritizeUserTags');
  const prioritizeUserTagsVal = checkPrioritizeUserTags ? checkPrioritizeUserTags.checked : false;

  const checkEnablePaheal = document.getElementById('checkEnablePaheal');
  const enablePahealVal = checkEnablePaheal ? checkEnablePaheal.checked : true;

  const updated = {
    ...state.settings,
    theme,
    itemsPerPage: itemsPerPageVal,
    previewQuality: previewQualityVal,
    videoAutoplayHover: videoAutoplayHoverVal,
    videoAutoplayMobile: videoAutoplayMobileVal,
    videoAutoplayViewer: videoAutoplayViewerVal,
    proxyVideoDefault: proxyVideoDefaultVal,
    showVideoStatusBanner: showVideoStatusBannerVal,
    blacklist: tempBlacklist,
    aiTags: tempAiTags,
    rule34ApiKey: inputRule34ApiKey ? inputRule34ApiKey.value.trim() : '',
    rule34UserId: inputRule34UserId ? inputRule34UserId.value.trim() : '',
    gelbooruApiKey: inputGelbooruApiKey ? inputGelbooruApiKey.value.trim() : '',
    gelbooruUserId: inputGelbooruUserId ? inputGelbooruUserId.value.trim() : '',
    danbooruApiKey: inputDanbooruApiKey ? inputDanbooruApiKey.value.trim() : '',
    danbooruLogin: inputDanbooruLogin ? inputDanbooruLogin.value.trim() : '',
    deepFetchPages: deepFetchPagesVal,
    prioritizeUserTags: prioritizeUserTagsVal,
    enablePaheal: enablePahealVal
  };

  try {
    const res = await saveSettings(updated);
    if (res.success) {
      state.settings = res.settings;
      state.limit = itemsPerPageVal;
      closeSettingsModal();
      showToast('Настройки сохранены ✅');
      performSearch(true);
    }
  } catch (err) {
    showToast('Ошибка сохранения настроек');
  }
}

async function handleResetSettings() {
  tempBlacklist = ['guro', 'scat', 'snuff', 'vomit', 'fart'];
  tempAiTags = ['ai_generated', 'novelai', 'stable_diffusion', 'midjourney', 'synthetic', 'ai_assisted'];
  if (inputRule34ApiKey) inputRule34ApiKey.value = '';
  if (inputRule34UserId) inputRule34UserId.value = '';
  if (inputGelbooruApiKey) inputGelbooruApiKey.value = '';
  if (inputGelbooruUserId) inputGelbooruUserId.value = '';
  if (inputDanbooruApiKey) inputDanbooruApiKey.value = '';
  if (inputDanbooruLogin) inputDanbooruLogin.value = '';
  if (selectPreviewQuality) selectPreviewQuality.value = 'medium';
  if (checkVideoAutoplayHover) checkVideoAutoplayHover.checked = true;
  if (checkVideoAutoplayMobile) checkVideoAutoplayMobile.checked = true;
  if (checkVideoAutoplayViewer) checkVideoAutoplayViewer.checked = true;
  const checkEnablePaheal = document.getElementById('checkEnablePaheal');
  if (checkEnablePaheal) checkEnablePaheal.checked = true;
  renderSettingsChips();
  showToast('Значения сброшены к стандартным');
}

init();
