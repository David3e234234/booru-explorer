import { 
  state, 
  setFavorites, 
  setFavoriteAuthors, 
  addSearchTag,
  loadLocalSettings,
  saveLocalSettings,
  loadLocalFavorites,
  loadLocalFavoriteAuthors,
  setLikes,
  loadLocalLikes,
  loadLocalDislikes,
  setDislikes,
  loadLocalViewed,
  loadLocalAuth,
  saveLocalAuth,
  clearLocalAuth,
  getUserInterestTags,
  getUserInterestSeedPairs,
  getRecommendationSeeds,
  calculatePostMatchPercent
} from './state.js';
import { 
  fetchPosts, 
  fetchFavorites, 
  syncFavorites,
  fetchLikes,
  syncLikes,
  fetchDislikes,
  syncDislikes,
  fetchFavoriteAuthors, 
  syncFavoriteAuthors,
  fetchSettings, 
  saveSettings,
  fetchPawchiveServices,
  apiGetMe
} from './api.js';
import { initAutocomplete } from './autocomplete.js';
import { initGallery } from './gallery.js';
import { initViewer } from './viewer.js';
import { findSimilarPosts, calculateUserTasteVector, scoreCandidatesByVisualTaste, showAiStatus, hideAiStatus } from './modules/aiVision.js';
import { isMyLiveDemoHost, isVercelHost, showToast, haptic } from './modules/uiUtils.js';
import { openDrawer, closeAllDrawers, setDrawerCallbacks } from './modules/drawers.js';
import { 
  updateSiteCapabilitiesUI,
  updateAiFilterUI, 
  updateRatingFilterUI, 
  updateTypeFilterUI, 
  updateAgeFilterUI, 
  updateDateFilterUI,
  updatePawchiveServiceUI,
  getPawchiveServiceLabel,
  updateCategoryTabsUI,
  updateFilterActiveDot
} from './modules/filtersUI.js';
import { 
  loadBooruSites, 
  renderSitesBar, 
  renderMobileSourcesSheet,
  initCustomSourcesModal,
  updateCurrentSiteLabel
} from './modules/navigationUI.js';
import { 
  switchFavoritesSubTab, 
  renderFavoriteAuthorsList, 
  initAddAuthorModal,
  initCoverPickerModal
} from './modules/favoriteAuthorsUI.js';
import { 
  initSettingsModal, 
  applySettingsToUIAndState, 
  persistSettings, 
  openSettingsModal, 
  closeSettingsModal 
} from './modules/settingsModal.js';
import { renderSidebarPageTags } from './modules/sidebarTags.js';
import { initAuthModal, updateHeaderAuthUI } from './modules/authModal.js';
import { initWikiModal } from './modules/wikiModal.js';
import { initProfileUI } from './modules/profileUI.js';
import { initDownloadManager } from './modules/downloadManager.js';
import { consumeInitialUrl, initRouter, syncSearchUrl } from './router.js';
import { t, applyStaticTranslations } from './i18n.js';

export { isMyLiveDemoHost, isVercelHost, showToast, openDrawer, closeAllDrawers };

let autocompleteInstance = null;
let galleryInstance = null;
let viewerInstance = null;
let authModalInstance = null;
let profileUIInstance = null;
let deferredInstallPrompt = null;
let pendingPostId = null;

// Monotonic token: responses from superseded searches are discarded on arrival
let searchSeq = 0;

async function init() {
  if ('scrollRestoration' in history) {
    try { history.scrollRestoration = 'manual'; } catch {}
  }

  // Apply the saved language to all static markup before anything renders
  applyStaticTranslations();

  setDrawerCallbacks({
    onCategoryUIUpdate: updateCategoryTabsUI,
    onCloseSettingsModal: closeSettingsModal
  });

  // 1. Initialize subsystems and validate the token
  loadLocalAuth();
  if (state.authToken) {
    try {
      const me = await apiGetMe();
      if (me && me.user) {
        state.currentUser = me.user;
        saveLocalAuth(state.authToken, me.user);
      } else {
        clearLocalAuth();
      }
    } catch (e) {
      clearLocalAuth();
    }
  }
  updateHeaderAuthUI();

  authModalInstance = initAuthModal({
    onAuthSuccess: async (user) => {
      updateHeaderAuthUI();
      await refreshAllUserData();
      if (profileUIInstance) profileUIInstance.renderProfile();
      selectCategory('profile');
    },
    onLogout: async () => {
      updateHeaderAuthUI();
      await refreshAllUserData();
      if (profileUIInstance) profileUIInstance.renderProfile();
      selectCategory('new');
    },
    onOpenProfile: () => {
      selectCategory('profile');
    }
  });

  profileUIInstance = initProfileUI({
    onOpenAuth: (mode) => authModalInstance?.openAuthModal(mode),
    onTabChange: (type, val) => {
      if (type === 'search-tag') {
        state.searchTags = [];
        addSearchTag(val);
        autocompleteInstance?.renderTagsChips();
        selectCategory('new');
      } else if (type === 'profile-subtab') {
        if (val === 'authors') {
          renderFavoriteAuthors();
        } else {
          performSearch(true);
        }
      } else if (type === 'profile-authors-search') {
        renderFavoriteAuthors();
      }
    },
    onReloadState: async () => {
      updateHeaderAuthUI();
      await refreshAllUserData();
      if (profileUIInstance) profileUIInstance.renderProfile();
      selectCategory('new');
    }
  });

  autocompleteInstance = initAutocomplete({
    onSearch: () => performSearch(true)
  });

  let lastLoadMoreTime = 0;

  async function handleFindVisuallySimilar(targetPost) {
    if (!targetPost) return;

    if (state.settings.aiVisualEngine === 'off') {
      showToast(t('ai.disabledInSettings', 'Нейросетевой анализ выключен в Настройках -> ИИ'));
      return;
    }

    showToast(t('ai.scanningSimilar', '✨ Сканирование нейросетью и поиск похожих артов...'));
    try {
      state.isLoading = true;
      galleryInstance.showScrollLoading();

      // Gather candidates from current posts + fetch additional candidates if pool is small
      const poolLimit = state.settings?.aiCandidatePool || 40;
      let candidates = [...(state.posts || [])];
      if (candidates.length < poolLimit) {
        try {
          const res = await fetchPosts({
            site: targetPost.site || state.currentSite,
            category: 'new',
            page: 1,
            limit: Math.max(80, poolLimit + 20),
            aiFilter: state.aiFilter,
            ratingFilter: state.ratingFilter,
            typeFilter: state.typeFilter
          });
          if (res.success && Array.isArray(res.posts)) {
            const existing = new Set(candidates.map(p => p.id));
            for (const p of res.posts) {
              if (!existing.has(p.id)) candidates.push(p);
            }
          }
        } catch {}
      }

      const similarResults = await findSimilarPosts(targetPost, candidates, {
        modelType: state.settings.aiVisualModel || 'dinov2',
        engine: state.settings.aiVisualEngine || 'browser',
        candidateLimit: poolLimit,
        minSimilarity: 0.30
      });

      state.isLoading = false;
      galleryInstance.hideScrollLoading();

      if (similarResults.length === 0) {
        showToast(t('ai.noSimilarFound', 'Похожих артов среди загруженных постов не найдено'));
        return;
      }

      // Add target post at the top followed by similar matches
      const targetWithBadge = { ...targetPost, similarityPercent: 100 };
      const rankedPosts = [
        targetWithBadge,
        ...similarResults.map(r => ({ ...r.post, similarityPercent: r.matchPercent, similarityScore: r.similarity }))
      ];

      state.posts = rankedPosts;
      state.displayedPosts = rankedPosts;
      state.hasMore = false;
      galleryInstance.renderGallery(false);
      const mainContent = document.getElementById('mainContent');
      if (mainContent) mainContent.scrollTop = 0;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showToast(t('ai.similarFoundCount', 'Найдено {n} визуально похожих артов!').replace('{n}', similarResults.length));
    } catch (err) {
      state.isLoading = false;
      galleryInstance.hideScrollLoading();
      console.error('[AIVision] Find similar failed:', err);
      showToast(err.message || t('ai.findSimilarError', 'Не удалось выполнить поиск похожих'));
    }
  }

  galleryInstance = initGallery({
    onOpenViewer: (index) => viewerInstance.openViewer(index),
    onFavoriteToggle: updateFavoritesBadge,
    onTagClick: (tag) => {
      autocompleteInstance.selectTag(tag, true);
    },
    onTagSelect: (tag) => {
      autocompleteInstance.selectTag(tag, true);
    },
    onLoadMore: () => {
      const now = Date.now();
      if (now - lastLoadMoreTime < 450) return;
      if (!state.isLoading && state.hasMore) {
        lastLoadMoreTime = now;
        state.page++;
        galleryInstance.showScrollLoading();
        performSearch(false);
      }
    },
    onRefresh: () => {
      performSearch(true);
    },
    onFindSimilar: handleFindVisuallySimilar
  });

  viewerInstance = initViewer({
    onFavoriteToggle: () => {
      galleryInstance.renderGallery(false, { preserveScroll: true });
      updateFavoritesBadge();
    },
    onFavoriteAuthorToggle: () => {
      updateFavoritesBadge();
      if (state.currentCategory === 'favorites' && state.favoritesSubTab === 'authors') {
        renderFavoriteAuthors();
      }
    },
    onTagSelect: (tag) => {
      autocompleteInstance.selectTag(tag, true);
    },
    onDislikeToggle: () => {
      galleryInstance.renderGallery(false, { preserveScroll: true });
    },
    onFindSimilar: handleFindVisuallySimilar,
    showToast
  });

  initRouter({
    onCloseViewerUi: () => {
      if (viewerInstance) viewerInstance.closeViewer();
    },
    onOpenPost: (postId) => {
      openPostById(postId);
    },
    onSearchParams: (changed) => {
      if (!changed) return;
      refreshSearchUiFromState();
      performSearch(true);
    }
  });

  initAddAuthorModal({
    onAuthorSaved: () => {
      updateFavoritesBadge();
      if ((state.currentCategory === 'favorites' && state.favoritesSubTab === 'authors') ||
          (state.currentCategory === 'profile' && state.profileSubTab === 'authors')) {
        renderFavoriteAuthors();
      }
    }
  });

  initCoverPickerModal({
    onCoverUpdated: () => {
      if ((state.currentCategory === 'favorites' && state.favoritesSubTab === 'authors') ||
          (state.currentCategory === 'profile' && state.profileSubTab === 'authors')) {
        renderFavoriteAuthors();
      }
    }
  });

  initSettingsModal({
    onSettingsChanged: () => {
      updateSiteCapabilitiesUI();
      updateCategoryTabsUI();
      if ((state.currentCategory === 'favorites' && state.favoritesSubTab === 'authors') ||
          (state.currentCategory === 'profile' && state.profileSubTab === 'authors')) {
        renderFavoriteAuthors();
      } else {
        performSearch(true);
      }
    },
    onDataImported: () => {
      updateFavoritesBadge();
      performSearch(true);
    },
    onUpdateFavoritesBadge: updateFavoritesBadge
  });

  initCustomSourcesModal({
    onApply: () => {
      selectSite('custom');
    }
  });

  initWikiModal({
    onSelectTag: (tag) => {
      addSearchTag(tag);
      if (autocompleteInstance) autocompleteInstance.renderTagsChips();
      performSearch(true);
    },
    onSwitchSite: (site) => {
      selectSite(site);
    }
  });

  initDownloadManager();

  renderSitesBar({ onSelectSite: selectSite });
  renderMobileSourcesSheet({ onSelectSite: selectSite });

  // 2. Set up button listeners
  setupEventListeners();

  // 3. Load settings, favorites, likes, and sites in parallel
  await Promise.allSettled([
    loadUserSettings(),
    loadFavorites(),
    loadFavoriteAuthors(),
    loadLikes(),
    loadDislikes(),
    loadLocalViewed(),
    loadBooruSites({ onSelectSite: selectSite })
  ]);

  updateCategoryTabsUI();
  updateDateFilterUI();

  // 4. Restore search/viewer state from the URL before the initial load
  const urlParams = consumeInitialUrl();
  pendingPostId = urlParams.post || null;
  refreshSearchUiFromState();

  // 5. Initial search
  await performSearch(true);

  if (pendingPostId) {
    const pid = pendingPostId;
    pendingPostId = null;
    await openPostById(pid);
  }
}

// Re-render all UI bits that visualize the URL-restorable state fields
function refreshSearchUiFromState() {
  if (autocompleteInstance) autocompleteInstance.renderTagsChips();
  updateCurrentSiteLabel();
  renderSitesBar({ onSelectSite: selectSite });
  renderMobileSourcesSheet({ onSelectSite: selectSite });
  updateSiteCapabilitiesUI(state.currentSite);
  if (state.currentSite === 'pawchive') ensurePawchiveServiceOptions();
}

// Opens a post by its original site id: fast path searches the loaded feed,
// slow path fetches it with the `id:` metatag (bypassing content filters).
async function openPostById(postId) {
  if (!postId || !viewerInstance) return;

  const list = (state.displayedPosts && state.displayedPosts.length > 0) ? state.displayedPosts : state.posts;
  const idx = list.findIndex(p => p && String(p.originalId) === String(postId));
  if (idx >= 0) {
    viewerInstance.openViewer(idx);
    return;
  }

  try {
    const res = await fetchPosts({
      site: state.currentSite,
      tags: `id:${postId}`,
      page: 1,
      limit: 1,
      category: 'new',
      aiFilter: 'all',
      ratingFilter: 'all',
      typeFilter: 'all',
      ageFilter: 'all',
      dateFilter: 'all',
      hideFurry: false,
      hidePregnant: false,
      hideLgbt: false
    });
    const posts = res && res.success && Array.isArray(res.posts) ? res.posts : [];
    const post = posts.find(p => String(p.originalId) === String(postId)) || posts[0];
    if (post) {
      viewerInstance.openViewer(-1, { directPost: post });
    } else {
      showToast(t('router.postNotFound', 'Пост не найден'));
    }
  } catch (e) {
    showToast(t('router.postNotFound', 'Пост не найден'));
  }
}

function updateFavoritesBadge() {
  const badgeFavCount = document.getElementById('badgeFavCount');
  const badgeFavCountMobile = document.getElementById('badgeFavCountMobile');
  const favPostsCountBadge = document.getElementById('favPostsCountBadge');
  const favAuthorsCountBadge = document.getElementById('favAuthorsCountBadge');

  const postsCount = state.favorites ? state.favorites.length : 0;
  const authorsCount = state.favoriteAuthors ? state.favoriteAuthors.length : 0;
  const totalCount = postsCount + authorsCount;
  const countStr = String(totalCount);

  if (badgeFavCount) badgeFavCount.textContent = countStr;
  if (badgeFavCountMobile) badgeFavCountMobile.textContent = countStr;
  if (favPostsCountBadge) favPostsCountBadge.textContent = String(postsCount);
  if (favAuthorsCountBadge) favAuthorsCountBadge.textContent = String(authorsCount);
}

function renderFavoriteAuthors() {
  renderFavoriteAuthorsList(galleryInstance, {
    onExploreAuthor: handleExploreAuthor,
    onUpdateBadge: updateFavoritesBadge
  });
}

function handleExploreAuthor(author) {
  if (!author || !author.name) return;
  if (author.site && state.sites.some(s => s.id === author.site)) {
    state.currentSite = author.site;
    updateCurrentSiteLabel();
    renderSitesBar({ onSelectSite: selectSite });
    renderMobileSourcesSheet({ onSelectSite: selectSite });
  }
  state.searchTags = [];
  const tagToAdd = (state.currentSite === 'rule34video' && !author.name.includes(':'))
    ? `artist:${author.name}`
    : author.name;
  addSearchTag(tagToAdd);
  if (autocompleteInstance) {
    autocompleteInstance.renderTagsChips();
  }
  selectCategory('new');
  showToast(`${t('app.authorSearch', 'Поиск работ автора:')} ${author.displayName || author.name}`);
}

function selectSite(siteId) {
  if (state.currentSite === siteId && state.currentCategory !== 'favorites') {
    if (siteId === 'custom') {
      performSearch(true);
    }
    return;
  }
  state.currentSite = siteId;
  persistSettings({ defaultSite: siteId });
  if (state.currentCategory === 'favorites') {
    state.currentCategory = 'new';
  }
  updateSiteCapabilitiesUI(siteId);
  updateCurrentSiteLabel();
  renderSitesBar({ onSelectSite: selectSite });
  renderMobileSourcesSheet({ onSelectSite: selectSite });
  if (siteId === 'pawchive') ensurePawchiveServiceOptions();
  performSearch(true);
}

// Pawchive platform dropdown: options are loaded once from the server
let pawchiveServicesLoaded = false;
let pawchiveServicesLoading = null;

async function ensurePawchiveServiceOptions() {
  if (pawchiveServicesLoaded) return;
  if (pawchiveServicesLoading) return pawchiveServicesLoading;

  pawchiveServicesLoading = (async () => {
    try {
      const data = await fetchPawchiveServices();
      const services = Array.isArray(data?.services) ? data.services.filter(s => s && s !== 'all') : [];
      const menu = document.getElementById('pawchiveServiceMenu');
      if (!menu) return;

      menu.querySelectorAll('.dropdown-item[data-dynamic="1"]').forEach(el => el.remove());
      for (const svc of services) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dropdown-item';
        btn.dataset.service = svc;
        btn.dataset.dynamic = '1';
        btn.setAttribute('role', 'option');
        btn.textContent = getPawchiveServiceLabel(svc);
        menu.appendChild(btn);
      }
      if (services.length > 0) pawchiveServicesLoaded = true;
      updatePawchiveServiceUI();
    } catch (e) {
      console.warn('Не удалось загрузить список платформ Pawchive:', e);
    } finally {
      pawchiveServicesLoading = null;
    }
  })();

  return pawchiveServicesLoading;
}

function selectCategory(category) {
  if (state.currentCategory === category && category !== 'favorites') return;
  state.currentCategory = category;
  updateCategoryTabsUI();
  performSearch(true);
}

async function loadUserSettings() {
  try {
    const local = loadLocalSettings() || {};
    if (Object.keys(local).length > 0) {
      applySettingsToUIAndState(local);
    }
    const data = await fetchSettings();
    const serverSettings = data?.settings || {};
    const merged = { ...serverSettings, ...local };
    applySettingsToUIAndState(merged);
    saveLocalSettings(merged);
  } catch (err) {
    console.error('Ошибка настроек:', err);
  }
}

async function loadFavorites() {
  try {
    if (state.currentUser) {
      const data = await fetchFavorites();
      const serverFavs = Array.isArray(data?.favorites) ? data.favorites : [];
      setFavorites(serverFavs);
      updateFavoritesBadge();
    } else {
      const localFavs = loadLocalFavorites() || [];
      if (localFavs.length > 0) {
        setFavorites(localFavs);
        updateFavoritesBadge();
      }
      const data = await fetchFavorites();
      const serverFavs = data?.favorites || [];
      const map = new Map();
      serverFavs.forEach(f => { if (f && f.id) map.set(f.id, f); });
      localFavs.forEach(f => { if (f && f.id) map.set(f.id, f); });
      const merged = Array.from(map.values());

      setFavorites(merged);
      updateFavoritesBadge();

      if (localFavs.length > serverFavs.length) {
        syncFavorites(merged).catch(() => {});
      }
    }
  } catch (err) {
    console.error('Ошибка избранного:', err);
  }
}

async function loadFavoriteAuthors() {
  try {
    const localAuthors = loadLocalFavoriteAuthors() || [];
    if (localAuthors.length > 0) {
      setFavoriteAuthors(localAuthors);
      updateFavoritesBadge();
    }

    const data = await fetchFavoriteAuthors();
    const serverAuthors = Array.isArray(data?.authors) ? data.authors : [];

    const map = new Map();
    serverAuthors.forEach(a => { if (a && a.name) map.set((a.name || '').toLowerCase(), a); });
    localAuthors.forEach(a => {
      if (a && a.name) {
        const key = (a.name || '').toLowerCase();
        const s = map.get(key);
        if (s) {
          map.set(key, { ...s, ...a, previewUrl: a.previewUrl || s.previewUrl });
        } else {
          map.set(key, a);
        }
      }
    });
    const merged = Array.from(map.values());

    setFavoriteAuthors(merged);
    updateFavoritesBadge();

    syncFavoriteAuthors(merged).catch(() => {});
  } catch (err) {
    console.error('Ошибка любимых авторов:', err);
  }
}

async function loadLikes() {
  try {
    if (state.currentUser) {
      const data = await fetchLikes();
      const serverLikes = Array.isArray(data?.likes) ? data.likes : [];
      setLikes(serverLikes);
    } else {
      const localLikes = loadLocalLikes() || [];
      if (localLikes.length > 0) {
        setLikes(localLikes);
      }
      const data = await fetchLikes();
      const serverLikes = data?.likes || [];
      const map = new Map();
      serverLikes.forEach(l => { if (l && l.id) map.set(l.id, l); });
      localLikes.forEach(l => { if (l && l.id) map.set(l.id, l); });
      const merged = Array.from(map.values());

      setLikes(merged);

      if (localLikes.length > serverLikes.length) {
        syncLikes(merged).catch(() => {});
      }
    }
  } catch (err) {
    console.error('Ошибка лайков:', err);
  }
}

async function loadDislikes() {
  try {
    if (state.currentUser) {
      const data = await fetchDislikes();
      const serverDislikes = Array.isArray(data?.dislikes) ? data.dislikes : [];
      setDislikes(serverDislikes);
    } else {
      const localDislikes = loadLocalDislikes() || [];
      if (localDislikes.length > 0) {
        setDislikes(localDislikes);
      }
      const data = await fetchDislikes();
      const serverDislikes = data?.dislikes || [];
      const map = new Map();
      serverDislikes.forEach(d => { if (d && d.id) map.set(d.id, d); });
      localDislikes.forEach(d => { if (d && d.id) map.set(d.id, d); });
      const merged = Array.from(map.values());

      setDislikes(merged);

      if (localDislikes.length > serverDislikes.length) {
        syncDislikes(merged).catch(() => {});
      }
    }
  } catch (err) {
    console.error('Ошибка загрузки скрытых постов:', err);
  }
}

async function refreshAllUserData() {
  await Promise.allSettled([
    loadUserSettings(),
    loadFavorites(),
    loadFavoriteAuthors(),
    loadLikes(),
    loadDislikes()
  ]);
  updateFavoritesBadge();
  if (profileUIInstance) profileUIInstance.renderProfile();
}

async function performSearch(reset = false, options = {}) {
  const seq = ++searchSeq;

  const favoritesHeaderBar = document.getElementById('favoritesHeaderBar');
  if (favoritesHeaderBar) {
    favoritesHeaderBar.style.display = state.currentCategory === 'favorites' ? 'flex' : 'none';
  }

  if (reset) {
    state.page = 1;
    state.posts = [];
    state.hasMore = true;
    galleryInstance.showLoading();
  }

  syncSearchUrl(reset ? 'push' : 'replace');

  // 👤 Profile section (TikTok style)
  if (state.currentCategory === 'profile') {
    if (profileUIInstance) profileUIInstance.renderProfile();
    
    if (state.profileSubTab === 'authors') {
      renderFavoriteAuthors();
      return;
    }

    if (state.profileSubTab === 'favorites') {
      state.posts = [...state.favorites];
    } else if (state.profileSubTab === 'likes') {
      state.posts = [...state.likes];
    } else if (state.profileSubTab === 'analytics') {
      state.posts = [];
    }

    if (state.searchTags.length > 0 && state.posts.length > 0) {
      state.posts = state.posts.filter(p => {
        const postTags = Array.isArray(p.tags) ? p.tags.map(t => t.toLowerCase()) : [];
        return state.searchTags.every(st => postTags.some(pt => pt.includes(st)));
      });
    }
    
    state.hasMore = false;
    galleryInstance.renderGallery(false);
    renderSidebarPageTags({ onTagSelect: (t) => autocompleteInstance.selectTag(t) });
    return;
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
    renderSidebarPageTags({ onTagSelect: (t) => autocompleteInstance.selectTag(t) });
    return;
  }

  // "Following" / Subscriptions feed (posts strictly from followed favorite authors)
  if (state.currentCategory === 'following') {
    try {
      state.isLoading = true;
      const btnRefreshSearch = document.getElementById('btnRefreshSearch');
      if (btnRefreshSearch) btnRefreshSearch.classList.add('refreshing');

      const followedAuthors = Array.isArray(state.favoriteAuthors) ? state.favoriteAuthors : [];
      const currentLimit = state.settings.itemsPerPage || state.limit || 100;

      if (followedAuthors.length === 0) {
        state.posts = [];
        state.hasMore = false;
        galleryInstance.renderGallery(false);
        renderSidebarPageTags({ onTagSelect: (t) => autocompleteInstance.selectTag(t) });
        return;
      }

      // Collect author queries for search
      const authorQueries = [];
      for (const author of followedAuthors) {
        const rawName = String(author.displayName || author.name || '').trim();
        const fallbackName = String(author.name || '').trim();
        const cleanName = (fallbackName || rawName).replace(/^@/, '').replace(/^pixiv:/i, '').trim();
        if (!cleanName && !rawName) continue;

        let queryTag = '';
        if (state.currentSite === 'pawchive') {
          if (author.service && author.user) {
            queryTag = `service:${author.service} user:${author.user}`;
          } else {
            queryTag = `artist:${cleanName || rawName}`;
          }
        } else {
          queryTag = cleanName || rawName;
        }

        if (queryTag && !authorQueries.includes(queryTag)) {
          authorQueries.push(queryTag);
        }
      }

      if (authorQueries.length === 0) {
        state.posts = [];
        state.hasMore = false;
        galleryInstance.renderGallery(false);
        renderSidebarPageTags({ onTagSelect: (t) => autocompleteInstance.selectTag(t) });
        return;
      }

      const searchQueryStr = state.searchTags.length > 0 ? state.searchTags.join(' ').trim() : '';
      const fetchTasks = [];

      for (const aQuery of authorQueries) {
        const combinedTags = searchQueryStr ? `${aQuery} ${searchQueryStr}` : aQuery;
        fetchTasks.push(
          fetchPosts({
            site: state.currentSite,
            tags: combinedTags,
            page: state.page,
            limit: Math.min(40, currentLimit),
            category: 'new',
            pawchiveService: state.currentSite === 'pawchive' ? (state.pawchiveService || 'all') : '',
            aiFilter: state.aiFilter,
            ratingFilter: state.ratingFilter,
            typeFilter: state.typeFilter,
            ageFilter: state.ageFilter,
            dateFilter: state.dateFilter,
            hideFurry: state.hideFurry,
            hidePregnant: state.hidePregnant,
            hideLgbt: state.hideLgbt,
            bustCache: options.bustCache || false
          }).catch(() => null)
        );
      }

      const results = await Promise.allSettled(fetchTasks);
      if (seq !== searchSeq) return;

      let allFetchedPosts = [];
      for (const res of results) {
        if (res.status === 'fulfilled' && res.value && res.value.success && Array.isArray(res.value.posts)) {
          allFetchedPosts.push(...res.value.posts);
        }
      }

      // Deduplicate posts
      const seenIds = new Set();
      const uniquePosts = [];
      for (const post of allFetchedPosts) {
        if (!post || !post.id || seenIds.has(post.id)) continue;
        seenIds.add(post.id);
        uniquePosts.push(post);
      }

      // Sort by newest first (created_at date or numeric originalId)
      uniquePosts.sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (timeA && timeB && timeA !== timeB) return timeB - timeA;
        const numIdA = Number(String(a.originalId || a.id).replace(/\D/g, '')) || 0;
        const numIdB = Number(String(b.originalId || b.id).replace(/\D/g, '')) || 0;
        return numIdB - numIdA;
      });

      const filteredPosts = uniquePosts.filter(p => p && p.id && !state.dislikedIds.has(p.id));
      const pageSlice = filteredPosts.slice(0, currentLimit);

      if (reset) {
        state.posts = pageSlice;
      } else {
        const existingIds = new Set(state.posts.map(p => p.id));
        const newPosts = pageSlice.filter(p => !existingIds.has(p.id));
        state.posts.push(...newPosts);
      }
      state.hasMore = pageSlice.length > 0;

      galleryInstance.renderGallery(!reset);
      renderSidebarPageTags({ onTagSelect: (t) => autocompleteInstance.selectTag(t) });
    } catch (err) {
      console.error('Ошибка загрузки ленты подписок:', err);
      if (seq !== searchSeq) return;
      if (reset) {
        state.posts = [];
      } else {
        state.page--;
        state.hasMore = true;
      }
      galleryInstance.renderGallery(false);
    } finally {
      if (seq === searchSeq) {
        state.isLoading = false;
        const btnRefreshSearch = document.getElementById('btnRefreshSearch');
        if (btnRefreshSearch) btnRefreshSearch.classList.remove('refreshing');
      }
    }
    return;
  }

  // "For you" recommendations section
  if (state.currentCategory === 'recommended') {
    try {
      state.isLoading = true;
      const btnRefreshSearch = document.getElementById('btnRefreshSearch');
      if (btnRefreshSearch) btnRefreshSearch.classList.add('refreshing');

      const focusMode = state.recommendationFocus || state.settings?.recommendationFocus || 'all';
      const userInterests = getUserInterestTags(null, { focusMode });
      const interestMap = new Map(userInterests.map(i => [i.tag, i.score]));
      const currentLimit = state.settings.itemsPerPage || state.limit || 100;
      let candidatePosts = [];

      if (state.searchTags.length > 0) {
        const res = await fetchPosts({
          site: state.currentSite,
          tags: state.searchTags.join(' '),
          page: state.page,
          limit: currentLimit,
          category: 'recommended',
          aiFilter: state.aiFilter,
          ratingFilter: state.ratingFilter,
          typeFilter: state.typeFilter,
          ageFilter: state.ageFilter,
          dateFilter: state.dateFilter,
          hideFurry: state.hideFurry,
          hidePregnant: state.hidePregnant,
          hideLgbt: state.hideLgbt,
          bustCache: options.bustCache || false
        });
        if (res.success && Array.isArray(res.posts)) {
          candidatePosts = res.posts;
        }
      } else {
        const fetchTasks = [];

        if (state.currentSite === 'pawchive') {
          // Pawchive creator-centric recommendation: extract liked and favorite artists
          const candidateArtists = [];
          if (userInterests.length > 0) {
            const creatorInterests = userInterests.filter(i => i.category === 'artist' || i.score >= 5.0);
            for (const item of creatorInterests) {
              const cleanAuthor = item.tag.replace(/^@/, '').replace(/^artist:/i, '').trim();
              if (cleanAuthor && !candidateArtists.includes(cleanAuthor)) {
                candidateArtists.push(cleanAuthor);
              }
            }
          }
          for (const fa of (state.favoriteAuthors || [])) {
            const raw = (fa.name || '').toLowerCase().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_').trim();
            if (raw && !candidateArtists.includes(raw)) {
              candidateArtists.push(raw);
            }
          }

          if (candidateArtists.length > 0) {
            const authorsPerPage = 5;
            const startIndex = ((state.page - 1) * authorsPerPage) % candidateArtists.length;
            const selectedAuthors = [];
            for (let i = 0; i < Math.min(authorsPerPage, candidateArtists.length); i++) {
              selectedAuthors.push(candidateArtists[(startIndex + i) % candidateArtists.length]);
            }
            const authorPageNum = Math.max(1, Math.ceil(state.page / Math.max(1, Math.ceil(candidateArtists.length / authorsPerPage))));

            for (const creator of selectedAuthors) {
              fetchTasks.push(
                fetchPosts({
                  site: 'pawchive',
                  tags: `artist:${creator}`,
                  page: authorPageNum,
                  limit: 30,
                  category: 'new',
                  aiFilter: state.aiFilter,
                  ratingFilter: state.ratingFilter,
                  typeFilter: state.typeFilter,
                  ageFilter: state.ageFilter,
                  dateFilter: state.dateFilter,
                  hideFurry: state.hideFurry,
                  hidePregnant: state.hidePregnant,
                  hideLgbt: state.hideLgbt,
                  bustCache: options.bustCache || false
                }).catch(() => null)
              );
            }
          }

          fetchTasks.push(
            fetchPosts({
              site: 'pawchive',
              tags: '',
              page: state.page,
              limit: Math.min(currentLimit, 50),
              category: 'new',
              aiFilter: state.aiFilter,
              ratingFilter: state.ratingFilter,
              typeFilter: state.typeFilter,
              ageFilter: state.ageFilter,
              dateFilter: state.dateFilter,
              hideFurry: state.hideFurry,
              hidePregnant: state.hidePregnant,
              hideLgbt: state.hideLgbt,
              bustCache: options.bustCache || false
            }).catch(() => null),
            fetchPosts({
              site: 'pawchive',
              tags: '',
              page: state.page,
              limit: Math.min(currentLimit, 50),
              category: 'random',
              aiFilter: state.aiFilter,
              ratingFilter: state.ratingFilter,
              typeFilter: state.typeFilter,
              ageFilter: state.ageFilter,
              dateFilter: state.dateFilter,
              hideFurry: state.hideFurry,
              hidePregnant: state.hidePregnant,
              hideLgbt: state.hideLgbt,
              bustCache: options.bustCache || false
            }).catch(() => null)
          );
        } else if (userInterests.length > 0) {
          // Dynamic Multi-Tier seeds rotated with page offset
          const selectedSeeds = getRecommendationSeeds({
            limit: 4,
            page: state.page,
            focusMode
          });

          for (const rawSeed of selectedSeeds) {
            const cleanSeedTag = rawSeed.replace(/[()]/g, '').trim();
            if (!cleanSeedTag) continue;
            fetchTasks.push(
              fetchPosts({
                site: state.currentSite,
                tags: cleanSeedTag,
                page: 1 + Math.floor((state.page - 1) / Math.max(1, selectedSeeds.length)),
                limit: 28,
                category: 'new',
                aiFilter: state.aiFilter,
                ratingFilter: state.ratingFilter,
                typeFilter: state.typeFilter,
                ageFilter: state.ageFilter,
                dateFilter: state.dateFilter,
                hideFurry: state.hideFurry,
                hidePregnant: state.hidePregnant,
                hideLgbt: state.hideLgbt,
                bustCache: options.bustCache || false
              }).catch(() => null)
            );
          }

          // Serendipity / discovery stream
          const discoveryCategory = (focusMode === 'discovery') ? 'random' : 'popular';
          fetchTasks.push(
            fetchPosts({
              site: state.currentSite,
              tags: '',
              page: state.page,
              limit: Math.min(currentLimit, 35),
              category: discoveryCategory,
              aiFilter: state.aiFilter,
              ratingFilter: state.ratingFilter,
              typeFilter: state.typeFilter,
              ageFilter: state.ageFilter,
              dateFilter: state.dateFilter,
              hideFurry: state.hideFurry,
              hidePregnant: state.hidePregnant,
              hideLgbt: state.hideLgbt,
              bustCache: options.bustCache || false
            }).catch(() => null)
          );
        } else {
          // Cold start / No interest history
          fetchTasks.push(
            fetchPosts({
              site: state.currentSite,
              tags: '',
              page: state.page,
              limit: 35,
              category: 'popular',
              aiFilter: state.aiFilter,
              ratingFilter: state.ratingFilter,
              typeFilter: state.typeFilter,
              ageFilter: state.ageFilter,
              dateFilter: state.dateFilter,
              hideFurry: state.hideFurry,
              hidePregnant: state.hidePregnant,
              hideLgbt: state.hideLgbt,
              bustCache: options.bustCache || false
            }).catch(() => null),
            fetchPosts({
              site: state.currentSite,
              tags: '',
              page: state.page,
              limit: 35,
              category: 'new',
              aiFilter: state.aiFilter,
              ratingFilter: state.ratingFilter,
              typeFilter: state.typeFilter,
              ageFilter: state.ageFilter,
              dateFilter: state.dateFilter,
              hideFurry: state.hideFurry,
              hidePregnant: state.hidePregnant,
              hideLgbt: state.hideLgbt,
              bustCache: options.bustCache || false
            }).catch(() => null),
            fetchPosts({
              site: state.currentSite,
              tags: '',
              page: state.page,
              limit: 30,
              category: 'random',
              aiFilter: state.aiFilter,
              ratingFilter: state.ratingFilter,
              typeFilter: state.typeFilter,
              ageFilter: state.ageFilter,
              dateFilter: state.dateFilter,
              hideFurry: state.hideFurry,
              hidePregnant: state.hidePregnant,
              hideLgbt: state.hideLgbt,
              bustCache: options.bustCache || false
            }).catch(() => null)
          );
        }

        const results = await Promise.allSettled(fetchTasks);
        if (seq !== searchSeq) return;
        for (const res of results) {
          if (res.status === 'fulfilled' && res.value && res.value.success && Array.isArray(res.value.posts)) {
            candidatePosts.push(...res.value.posts);
          }
        }
      }

      const seen = new Set();
      const filteredCandidates = [];

      candidatePosts.forEach(p => {
        if (!p || !p.id) return;
        if (seen.has(p.id)) return;
        seen.add(p.id);

        if (state.likedIds.has(p.id) || state.favoriteIds.has(p.id) || state.dislikedIds.has(p.id)) {
          return;
        }

        filteredCandidates.push(p);
      });

      const recMode = state.settings?.recommendationMode || 'hybrid';
      const useTags = recMode === 'hybrid' || recMode === 'tags-only';
      const useAi = (recMode === 'hybrid' || recMode === 'ai-only') && state.settings?.aiVisualEngine !== 'off';

      const scoredCandidates = filteredCandidates.map(p => {
        let basePercent = 0;
        let matchedTags = [];
        let matchExplanation = '';
        if (useTags) {
          const matchResult = calculatePostMatchPercent(p, interestMap);
          basePercent = typeof matchResult === 'object' ? matchResult.percent : matchResult;
          matchedTags = typeof matchResult === 'object' ? matchResult.matchedTags : [];
          matchExplanation = typeof matchResult === 'object' ? matchResult.matchExplanation : '';
        }
        const isViewed = state.viewedIds.has(p.id);
        if (isViewed && basePercent > 0) {
          basePercent = Math.round(basePercent * 0.55);
        }
        return {
          ...p,
          matchPercent: basePercent,
          matchedTags,
          matchExplanation,
          isViewed
        };
      });

      // Neural Visual Taste Personalization (Hybrid / AI-Only)
      if (useAi) {
        const likedPool = (state.likes && state.likes.length > 0) ? state.likes : state.favorites;
        if (Array.isArray(likedPool) && likedPool.length > 0) {
          try {
            const tasteVector = await calculateUserTasteVector(likedPool, {
              modelType: state.settings?.aiVisualModel || 'dinov2',
              engine: state.settings?.aiVisualEngine || 'browser'
            });
            if (tasteVector) {
              const poolLimit = state.settings?.aiCandidatePool || 40;
              const visualScored = await scoreCandidatesByVisualTaste(scoredCandidates, tasteVector, {
                modelType: state.settings?.aiVisualModel || 'dinov2',
                engine: state.settings?.aiVisualEngine || 'browser',
                candidateLimit: poolLimit
              });
              for (let i = 0; i < scoredCandidates.length; i++) {
                const vis = visualScored[i]?.visualMatchPercent || 0;
                if (vis > 0) {
                  scoredCandidates[i].visualMatchPercent = vis;
                  if (recMode === 'ai-only') {
                    const isViewed = scoredCandidates[i].isViewed;
                    scoredCandidates[i].matchPercent = isViewed ? Math.round(vis * 0.6) : vis;
                  } else {
                    const aiWeight = state.settings?.aiHybridWeight !== undefined ? Number(state.settings.aiHybridWeight) : 0.4;
                    const tagWeight = Math.max(0, 1 - aiWeight);
                    if (scoredCandidates[i].matchPercent > 0) {
                      scoredCandidates[i].matchPercent = Math.round(scoredCandidates[i].matchPercent * tagWeight + vis * aiWeight);
                    } else {
                      scoredCandidates[i].matchPercent = Math.round(vis * Math.max(0.7, aiWeight + 0.3));
                    }
                  }
                }
              }
            }
          } catch (e) {
            console.warn('[AIVision] Feed personalization error:', e);
          }
        }
      }

      // 🎯 Multi-Attribute MMR Diversification (Authors, Characters, Franchises)
      const finalRecommended = [];
      const authorCountMap = new Map();
      const characterCountMap = new Map();
      const copyrightCountMap = new Map();
      let lastAuthor = null;
      let lastCharacter = null;
      const candidatePool = [...scoredCandidates];

      while (candidatePool.length > 0 && finalRecommended.length < currentLimit) {
        let bestIndex = -1;
        let bestScore = -Infinity;

        for (let i = 0; i < candidatePool.length; i++) {
          const item = candidatePool[i];
          const rawAuthor = item.author || (item.tagDetails?.artist?.[0]) || 'unknown';
          const cleanAuthor = String(rawAuthor).toLowerCase().trim();
          const seenAuthorCount = authorCountMap.get(cleanAuthor) || 0;

          let authorPenalty = 1.0;
          if (cleanAuthor !== 'unknown') {
            if (seenAuthorCount === 1) authorPenalty = 0.65;
            else if (seenAuthorCount === 2) authorPenalty = 0.35;
            else if (seenAuthorCount >= 3) authorPenalty = 0.10;
          }
          const adjacentAuthorPenalty = (cleanAuthor !== 'unknown' && cleanAuthor === lastAuthor) ? 0.35 : 1.0;

          // Character diversity penalty
          const primaryChar = item.tagDetails?.character?.[0] ? String(item.tagDetails.character[0]).toLowerCase().trim() : 'unknown';
          const seenCharCount = characterCountMap.get(primaryChar) || 0;
          let charPenalty = 1.0;
          if (primaryChar !== 'unknown') {
            if (seenCharCount === 1) charPenalty = 0.75;
            else if (seenCharCount === 2) charPenalty = 0.45;
            else if (seenCharCount >= 3) charPenalty = 0.20;
          }
          const adjacentCharPenalty = (primaryChar !== 'unknown' && primaryChar === lastCharacter) ? 0.50 : 1.0;

          // Franchise diversity penalty
          const primaryCp = item.tagDetails?.copyright?.[0] ? String(item.tagDetails.copyright[0]).toLowerCase().trim() : 'unknown';
          const seenCpCount = copyrightCountMap.get(primaryCp) || 0;
          const cpPenalty = (primaryCp !== 'unknown' && seenCpCount >= 3) ? 0.65 : 1.0;

          const effectiveScore = (item.matchPercent || 0) * authorPenalty * adjacentAuthorPenalty * charPenalty * adjacentCharPenalty * cpPenalty;

          if (effectiveScore > bestScore) {
            bestScore = effectiveScore;
            bestIndex = i;
          }
        }

        if (bestIndex !== -1) {
          const [selected] = candidatePool.splice(bestIndex, 1);
          finalRecommended.push(selected);

          const rawAuthor = selected.author || (selected.tagDetails?.artist?.[0]) || 'unknown';
          const cleanAuthor = String(rawAuthor).toLowerCase().trim();
          if (cleanAuthor !== 'unknown') {
            authorCountMap.set(cleanAuthor, (authorCountMap.get(cleanAuthor) || 0) + 1);
            lastAuthor = cleanAuthor;
          } else {
            lastAuthor = null;
          }

          const primaryChar = selected.tagDetails?.character?.[0] ? String(selected.tagDetails.character[0]).toLowerCase().trim() : 'unknown';
          if (primaryChar !== 'unknown') {
            characterCountMap.set(primaryChar, (characterCountMap.get(primaryChar) || 0) + 1);
            lastCharacter = primaryChar;
          } else {
            lastCharacter = null;
          }

          const primaryCp = selected.tagDetails?.copyright?.[0] ? String(selected.tagDetails.copyright[0]).toLowerCase().trim() : 'unknown';
          if (primaryCp !== 'unknown') {
            copyrightCountMap.set(primaryCp, (copyrightCountMap.get(primaryCp) || 0) + 1);
          }
        } else {
          break;
        }
      }

      if (finalRecommended.length < currentLimit && candidatePool.length > 0) {
        finalRecommended.push(...candidatePool.slice(0, currentLimit - finalRecommended.length));
      }

      if (reset) {
        state.posts = finalRecommended;
      } else {
        const existingIds = new Set(state.posts.map(p => p.id));
        const newPosts = finalRecommended.filter(p => !existingIds.has(p.id));
        state.posts.push(...newPosts);
      }
      state.hasMore = candidatePosts.length > 0 || finalRecommended.length > 0;

      galleryInstance.renderGallery(!reset);
      renderSidebarPageTags({ onTagSelect: (t) => autocompleteInstance.selectTag(t) });
    } catch (err) {
      console.error('Ошибка рекомендаций:', err);
      if (seq !== searchSeq) return;
      if (reset) {
        state.posts = [];
      } else {
        state.page--;
        state.hasMore = true;
      }
      galleryInstance.renderGallery(false);
    } finally {
      if (seq === searchSeq) {
        state.isLoading = false;
        const btnRefreshSearch = document.getElementById('btnRefreshSearch');
        if (btnRefreshSearch) btnRefreshSearch.classList.remove('refreshing');
      }
    }
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
      dateFilter: state.dateFilter,
      hideFurry: state.hideFurry,
      hidePregnant: state.hidePregnant,
      hideLgbt: state.hideLgbt,
      customSites: state.currentSite === 'custom' ? state.settings.customSources : '',
      pawchiveService: state.currentSite === 'pawchive' ? (state.pawchiveService || 'all') : '',
      bustCache: options.bustCache || false
    });

    if (seq !== searchSeq) return;

    if (res.success && Array.isArray(res.posts)) {
      state.lastSearchFailed = false;
      const validPosts = res.posts.filter(p => p && p.id && !state.dislikedIds.has(p.id));
      if (reset) {
        state.posts = validPosts;
      } else {
        const existingIds = new Set(state.posts.map(p => p.id));
        const newPosts = validPosts.filter(p => !existingIds.has(p.id));
        state.posts.push(...newPosts);
      }
      state.hasMore = validPosts.length > 0;
    } else {
      if (reset) state.posts = [];
      state.hasMore = false;
    }

    galleryInstance.renderGallery(!reset);
    renderSidebarPageTags({ onTagSelect: (t) => autocompleteInstance.selectTag(t) });
  } catch (err) {
    console.error('Ошибка поиска:', err);
    if (seq !== searchSeq) return;
    if (reset) {
      state.posts = [];
      state.lastSearchFailed = true;
    } else {
      // Roll the page back so infinite scroll does not keep a permanent gap
      state.page--;
      state.hasMore = true;
    }
    galleryInstance.renderGallery(false);
  } finally {
    if (seq === searchSeq) {
      state.isLoading = false;
      const btnRefreshSearch = document.getElementById('btnRefreshSearch');
      if (btnRefreshSearch) btnRefreshSearch.classList.remove('refreshing');
    }
  }
}

function setupEventListeners() {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const cat = tab.dataset.category;
      if (cat) selectCategory(cat);
    });
  });

  // AI filter
  document.querySelectorAll('.ai-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const filter = pill.dataset.ai;
      if (state.aiFilter === filter) return;
      state.aiFilter = filter;
      updateAiFilterUI();
      persistSettings({ aiFilter: filter });
      syncSearchUrl('replace');
    });
  });

  // Age rating filter (SFW / NSFW)
  document.querySelectorAll('.rating-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const rating = pill.dataset.rating;
      if (state.ratingFilter === rating) return;
      state.ratingFilter = rating;
      updateRatingFilterUI();
      persistSettings({ ratingFilter: rating });
      syncSearchUrl('replace');
    });
  });

  // Content type switch (All / Video / Photo)
  document.querySelectorAll('.type-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const type = pill.dataset.type;
      if (state.typeFilter === type) return;
      state.typeFilter = type;
      updateTypeFilterUI();
      persistSettings({ typeFilter: type });
      syncSearchUrl('replace');
    });
  });

  // Age filter (All / Adult / Young)
  document.querySelectorAll('.age-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const age = pill.dataset.age;
      if (state.ageFilter === age) return;
      state.ageFilter = age;
      updateAgeFilterUI();
      persistSettings({ ageFilter: age });
      syncSearchUrl('replace');
    });
  });

  // Date filter dropdown
  const dateFilterDropdown = document.getElementById('dateFilterDropdown');
  const btnDateFilterToggle = document.getElementById('btnDateFilterToggle');
  if (btnDateFilterToggle && dateFilterDropdown) {
    btnDateFilterToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dateFilterDropdown.classList.toggle('open');
      btnDateFilterToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    document.querySelectorAll('#dateFilterMenu .dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const dateVal = item.dataset.date || 'all';
        if (state.dateFilter === dateVal) {
          dateFilterDropdown.classList.remove('open');
          btnDateFilterToggle.setAttribute('aria-expanded', 'false');
          return;
        }
        state.dateFilter = dateVal;
        updateDateFilterUI();
        persistSettings({ dateFilter: dateVal });
        dateFilterDropdown.classList.remove('open');
        btnDateFilterToggle.setAttribute('aria-expanded', 'false');
        syncSearchUrl('replace');
      });
    });

    document.addEventListener('click', (e) => {
      if (!dateFilterDropdown.contains(e.target)) {
        dateFilterDropdown.classList.remove('open');
        btnDateFilterToggle.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dateFilterDropdown.classList.contains('open')) {
        dateFilterDropdown.classList.remove('open');
        btnDateFilterToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Pawchive platform dropdown (only visible for the Pawchive source)
  const pawchiveServiceDropdown = document.getElementById('pawchiveServiceDropdown');
  const btnPawchiveServiceToggle = document.getElementById('btnPawchiveServiceToggle');
  if (btnPawchiveServiceToggle && pawchiveServiceDropdown) {
    btnPawchiveServiceToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      ensurePawchiveServiceOptions();
      const isOpen = pawchiveServiceDropdown.classList.toggle('open');
      btnPawchiveServiceToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    // Items are populated lazily, so clicks are delegated on the menu
    const pawchiveServiceMenu = document.getElementById('pawchiveServiceMenu');
    if (pawchiveServiceMenu) {
      pawchiveServiceMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.dropdown-item');
        if (!item) return;
        e.stopPropagation();
        const serviceVal = item.dataset.service || 'all';
        if (state.pawchiveService === serviceVal) {
          pawchiveServiceDropdown.classList.remove('open');
          btnPawchiveServiceToggle.setAttribute('aria-expanded', 'false');
          return;
        }
        state.pawchiveService = serviceVal;
        updatePawchiveServiceUI();
        persistSettings({ pawchiveService: serviceVal });
        pawchiveServiceDropdown.classList.remove('open');
        btnPawchiveServiceToggle.setAttribute('aria-expanded', 'false');
      });
    }

    document.addEventListener('click', (e) => {
      if (!pawchiveServiceDropdown.contains(e.target)) {
        pawchiveServiceDropdown.classList.remove('open');
        btnPawchiveServiceToggle.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && pawchiveServiceDropdown.classList.contains('open')) {
        pawchiveServiceDropdown.classList.remove('open');
        btnPawchiveServiceToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Video duration sorting
  document.querySelectorAll('.video-sort-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const sort = pill.dataset.sort;
      if (state.videoDurationSort === sort) return;
      state.videoDurationSort = sort;
      document.querySelectorAll('.video-sort-pill').forEach(p => {
        p.classList.toggle('active', p.dataset.sort === sort);
      });
      galleryInstance.renderGallery(false, { preserveScroll: true });
    });
  });

  const checkHideFurry = document.getElementById('checkHideFurry');
  if (checkHideFurry) {
    checkHideFurry.addEventListener('change', () => {
      state.hideFurry = checkHideFurry.checked;
      persistSettings({ hideFurry: state.hideFurry });
      updateFilterActiveDot();
    });
  }

  const checkHidePregnant = document.getElementById('checkHidePregnant');
  if (checkHidePregnant) {
    checkHidePregnant.addEventListener('change', () => {
      state.hidePregnant = checkHidePregnant.checked;
      persistSettings({ hidePregnant: state.hidePregnant });
      updateFilterActiveDot();
    });
  }

  const checkHideLgbt = document.getElementById('checkHideLgbt');
  if (checkHideLgbt) {
    checkHideLgbt.addEventListener('change', () => {
      state.hideLgbt = checkHideLgbt.checked;
      persistSettings({ hideLgbt: state.hideLgbt });
      updateFilterActiveDot();
    });
  }

  // "Search" button in the sidebar
  const btnApplySearch = document.getElementById('btnApplySearch');
  if (btnApplySearch) {
    btnApplySearch.addEventListener('click', () => {
      const searchInput = document.getElementById('searchInput');
      if (searchInput && searchInput.value.trim() && autocompleteInstance) {
        autocompleteInstance.selectTag(searchInput.value.trim(), false);
      }
      closeAllDrawers();
      performSearch(true);
    });
  }

  // Logo
  const btnLogo = document.getElementById('btnLogo');
  if (btnLogo) {
    btnLogo.addEventListener('click', () => {
      state.searchTags = [];
      state.currentCategory = 'new';
      state.currentSite = 'danbooru';
      autocompleteInstance.renderTagsChips();
      updateCategoryTabsUI();
      renderSitesBar({ onSelectSite: selectSite });
      performSearch(true);
    });
  }

  // Refresh search button
  const btnRefreshSearch = document.getElementById('btnRefreshSearch');
  if (btnRefreshSearch) {
    btnRefreshSearch.addEventListener('click', async () => {
      if (btnRefreshSearch.classList.contains('refreshing')) return;
      btnRefreshSearch.classList.add('refreshing');
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        await performSearch(true, { bustCache: true });
        showToast(t('app.searchRefreshed', 'Поиск обновлен'));
      } catch (e) {
        showToast(t('app.searchRefreshFailed', 'Ошибка при обновлении поиска'));
      } finally {
        setTimeout(() => {
          btnRefreshSearch.classList.remove('refreshing');
        }, 350);
      }
    });
  }

  // Shuffle button
  const btnShuffleGallery = document.getElementById('btnShuffleGallery');
  if (btnShuffleGallery) {
    btnShuffleGallery.addEventListener('click', () => {
      if (!state.posts || state.posts.length <= 1) {
        showToast(t('app.shuffleNotEnough', 'Недостаточно постов для перемешивания'));
        return;
      }
      for (let i = state.posts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.posts[i], state.posts[j]] = [state.posts[j], state.posts[i]];
      }
      galleryInstance.renderGallery(false, { preserveScroll: true });
      renderSidebarPageTags({ onTagSelect: (t) => autocompleteInstance.selectTag(t) });
      showToast(t('app.feedShuffled', 'Лента перемешана'));
    });
  }

  // Recommendation focus toolbar buttons
  const recFocusButtons = document.querySelectorAll('.rec-focus-btn');
  recFocusButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const focus = btn.getAttribute('data-focus') || 'all';
      if (state.recommendationFocus === focus) return;
      haptic(10);
      state.recommendationFocus = focus;
      if (state.settings) state.settings.recommendationFocus = focus;
      saveLocalSettings({ recommendationFocus: focus });
      recFocusButtons.forEach(b => b.classList.toggle('active', b === btn));
      performSearch(1, { bustCache: false, showLoading: true });
    });
  });

  // Favorites sub-tabs
  const btnFavSubPosts = document.getElementById('btnFavSubPosts');
  const btnFavSubAuthors = document.getElementById('btnFavSubAuthors');
  const favAuthorsSearchInput = document.getElementById('favAuthorsSearchInput');

  if (btnFavSubPosts) {
    btnFavSubPosts.addEventListener('click', () => {
      haptic(10);
      switchFavoritesSubTab('posts', { onSearch: performSearch, onRenderAuthors: renderFavoriteAuthors });
    });
  }

  if (btnFavSubAuthors) {
    btnFavSubAuthors.addEventListener('click', () => {
      haptic(10);
      switchFavoritesSubTab('authors', { onSearch: performSearch, onRenderAuthors: renderFavoriteAuthors });
    });
  }

  if (favAuthorsSearchInput) {
    favAuthorsSearchInput.addEventListener('input', () => {
      renderFavoriteAuthors();
    });
  }

  // Mobile drawers and sidebar controls
  const drawerBackdrop = document.getElementById('drawerBackdrop');
  const btnCloseSidebar = document.getElementById('btnCloseSidebar');
  const btnCloseCategoriesSheet = document.getElementById('btnCloseCategoriesSheet');
  const btnCloseSourcesSheet = document.getElementById('btnCloseSourcesSheet');
  const headerStatusBox = document.getElementById('headerStatusBox');
  const sidebarSearch = document.getElementById('sidebarSearch');
  const categoriesSheet = document.getElementById('categoriesSheet');
  const sourcesSheet = document.getElementById('sourcesSheet');

  if (drawerBackdrop) drawerBackdrop.addEventListener('click', closeAllDrawers);
  if (btnCloseSidebar) btnCloseSidebar.addEventListener('click', closeAllDrawers);
  if (btnCloseCategoriesSheet) btnCloseCategoriesSheet.addEventListener('click', closeAllDrawers);
  if (btnCloseSourcesSheet) btnCloseSourcesSheet.addEventListener('click', closeAllDrawers);

  const btnNavFeed = document.getElementById('btnNavFeed');
  const btnNavFilters = document.getElementById('btnNavFilters');
  const btnNavSources = document.getElementById('btnNavSources');
  const btnNavFavorites = document.getElementById('btnNavFavorites');
  const btnNavProfile = document.getElementById('btnNavProfile');
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
      haptic(15);
      closeAllDrawers();
      selectCategory('favorites');
    });
  }

  if (btnNavProfile) {
    btnNavProfile.addEventListener('click', () => {
      haptic(15);
      closeAllDrawers();
      selectCategory('profile');
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

  document.querySelectorAll('.category-card').forEach(card => {
    card.addEventListener('click', () => {
      const cat = card.dataset.category;
      if (cat) {
        selectCategory(cat);
        closeAllDrawers();
      }
    });
  });

  // Mobile grid toggle (1 or 2 columns)
  const btnMobileGridToggle = document.getElementById('btnMobileGridToggle');
  const galleryGrid = document.getElementById('galleryGrid');
  let isMobile1Col = localStorage.getItem('booru_grid_mobile') === '1col';

  function applyMobileGrid() {
    if (!galleryGrid) return;
    if (isMobile1Col) {
      galleryGrid.classList.add('grid-1col');
      if (btnMobileGridToggle) {
        btnMobileGridToggle.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`;
        btnMobileGridToggle.title = t('app.gridMode1.title', 'Режим 1 колонка (нажмите для 2 колонок)');
      }
    } else {
      galleryGrid.classList.remove('grid-1col');
      if (btnMobileGridToggle) {
        btnMobileGridToggle.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`;
        btnMobileGridToggle.title = t('app.gridMode2.title', 'Режим 2 колонки (нажмите для 1 колонки)');
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
      showToast(isMobile1Col ? t('app.gridMode1.toast', 'Сетка: 1 колонка (крупная лента)') : t('app.gridMode2.toast', 'Сетка: 2 колонки (компактно)'));
    });
  }

  // Desktop grid column size selector
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

  // "Scroll to top" button
  const btnScrollToTop = document.getElementById('btnScrollToTop');
  const mainContentEl = document.getElementById('mainContent');
  if (btnScrollToTop) {
    const updateScrollTopBtn = () => {
      const scrollY = (mainContentEl ? mainContentEl.scrollTop : 0) || window.scrollY || 0;
      if (scrollY > 350) {
        btnScrollToTop.classList.add('visible');
      } else {
        btnScrollToTop.classList.remove('visible');
      }
    };

    window.addEventListener('scroll', updateScrollTopBtn, { passive: true });
    if (mainContentEl) {
      mainContentEl.addEventListener('scroll', updateScrollTopBtn, { passive: true });
    }

    btnScrollToTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (mainContentEl) {
        mainContentEl.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }

  // PWA app installation
  const pwaInstallGroup = document.getElementById('pwaInstallGroup');
  const btnInstallPwa = document.getElementById('btnInstallPwa');

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
          showToast(t('app.pwaInstalling', 'Приложение Booru Explorer устанавливается'));
          if (pwaInstallGroup) pwaInstallGroup.style.display = 'none';
        }
        deferredInstallPrompt = null;
      } else {
        showToast(t('app.pwaManualInstall', 'Для установки нажмите «На экран "Домой"» в меню браузера'));
      }
    });
  }

  // Service Worker registration for PWA
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        reg.update();
      }).catch(err => {
        console.warn('[PWA ServiceWorker] Ошибка регистрации:', err);
      });
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(reg => reg.update()).catch(() => {});
      }
    });
  }

  const selectPreviewQuality = document.getElementById('selectPreviewQuality');
  if (selectPreviewQuality) {
    selectPreviewQuality.addEventListener('change', () => {
      state.settings.previewQuality = selectPreviewQuality.value;
      if (galleryInstance) {
        if ((state.currentCategory === 'favorites' && state.favoritesSubTab === 'authors') ||
            (state.currentCategory === 'profile' && state.profileSubTab === 'authors')) {
          renderFavoriteAuthors();
        } else {
          galleryInstance.renderGallery(false, { preserveScroll: true });
        }
      }
    });
  }

  // Close modals on Escape
  const settingsModal = document.getElementById('settingsModal');
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (settingsModal && settingsModal.style.display === 'flex') {
        closeSettingsModal();
      }
    }
  });

  // AI Status Widget close button
  const btnAiStatusClose = document.getElementById('btnAiStatusClose');
  if (btnAiStatusClose) {
    btnAiStatusClose.addEventListener('click', (e) => {
      e.stopPropagation();
      hideAiStatus(true);
    });
  }
}

init();
