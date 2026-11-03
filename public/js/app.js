import {
  state,
  addSearchTag,
  loadLocalViewed,
  loadViewHistory,
  loadLocalAuth,
  saveLocalAuth,
  clearLocalAuth,
  recordSessionInteraction
} from './state.js';
import {
  fetchPosts,
  apiGetMe
} from './api.js';
import { initAutocomplete } from './autocomplete.js';
import { initGallery } from './gallery.js';
import {
  consumeInitialUrl,
  initRouter
} from './router.js';
import { showToast, haptic } from './modules/uiUtils.js';
import {
  setDrawerCallbacks
} from './modules/drawers.js';
import {
  updateSiteCapabilitiesUI,
  updatePostSortUI,
  updateAiFilterUI,
  updateRatingFilterUI,
  updateTypeFilterUI,
  updateAgeFilterUI,
  updateCategoryTabsUI,
  updateFilterActiveDot,
  updateVideoSortUI
} from './modules/filtersUI.js';
import { 
  loadBooruSites, 
  renderSitesBar, 
  renderMobileSourcesSheet,
  initCustomSourcesModal,
  updateCurrentSiteLabel
} from './modules/navigationUI.js';
import {
  renderFavoriteAuthorsList,
  initAddAuthorModal,
  initCoverPickerModal,
  initAuthorNotifSourcesModal,
  openAddAuthorModal
} from './modules/favoriteAuthorsUI.js';
import {
  persistSettings,
} from './modules/settingsPersist.js';

import { ensurePawchiveServiceOptions, ensureKemonoServiceOptions } from './modules/serviceOptions.js';
import {
  initAccountData,
  loadUserSettings,
  loadFavorites,
  loadFavoriteAuthors,
  loadAuthorAliasesMap,
  loadLikes,
  loadDislikes,
  refreshAllUserData
} from './modules/accountData.js';
import { initSearchPresets, renderPresetsList, updatePresetActiveState } from './modules/searchPresetsUI.js';
import { initSidebarCollapse } from './modules/sidebarCollapse.js';
import { initModalAccessibility } from './modules/modalAccessibility.js';

import { setupEventListeners, initEventBindings } from './modules/eventBindings.js';
import { performSearch, initSearchEngine } from './search/searchEngine.js';
import { t, applyStaticTranslations } from './i18n.js';
import {
  initLazyLoaders,
  ensureSettingsModal,
  applySettingsToUIAndState,
  closeSettingsModal,
  ensureAuthModal,
  updateHeaderAuthUI,
  ensureProfileUI,
  ensureDownloadManager,
  ensureAliasManagerModal,
  ensureWikiModal,
  ensureViewer,
  whenViewerLoaded,
  ensureFeed,
  throttledLoadMore,
  setAutocompleteInstance,
  setGalleryInstance,
  getAutocompleteInstance,
  getGalleryInstance,
  getFeedInstance,
  getProfileUIInstance
} from './modules/lazyLoader.js';

function isPhoneViewport() {
  return window.matchMedia('(max-width: 800px)').matches;
}

function isArchiveLikePost(post) {
  return Boolean(post && (post.isArchive === true || String(post.fileExt || '').toLowerCase() === 'zip' ||
    (Array.isArray(post.archiveUrls) && post.archiveUrls.length > 0)));
}

// One routing point for "open this post fullscreen": phones get the immersive
// feed, desktops keep the classic viewer. Archive posts stay on the viewer
// everywhere: the feed cannot host the archive inspection UI.
function openPostOverlay(index, opts = {}) {
  const list = (state.displayedPosts && state.displayedPosts.length > 0) ? state.displayedPosts : state.posts;
  const post = opts.directPost || list[index];
  const useViewer = opts.forceViewer || !isPhoneViewport() || isArchiveLikePost(post);
  if (useViewer) {
    ensureViewer().then((v) => v.openViewer(index, opts)).catch(() => {});
  } else {
    ensureFeed().then((f) => f.openFeed(index, opts)).catch(() => {
      ensureViewer().then((v) => v.openViewer(index, opts)).catch(() => {});
    });
  }
}

// URL-restore markers for the initial load: a post id (and feed flag) read
// from the URL in init() and consumed once the first search has rendered.
let pendingPostId = null;
let pendingFeedView = false;

async function init() {
  if ('scrollRestoration' in history) {
    try { history.scrollRestoration = 'manual'; } catch {}
  }

  // Apply the saved language to all static markup before anything renders
  applyStaticTranslations();
  initModalAccessibility();
  initSidebarCollapse();

  setDrawerCallbacks({
    onCategoryUIUpdate: updateCategoryTabsUI,
    onCloseSettingsModal: closeSettingsModal
  });

  initAccountData({
    applySettingsToUIAndState,
    updateFavoritesBadge,
    getProfileUI: () => getProfileUIInstance()
  });

  initLazyLoaders({
    performSearch,
    selectCategory,
    selectSite,
    renderFavoriteAuthors,
    updateFavoritesBadge,
    openPostOverlay,
    handleAuthorSelect,
    handleFindSimilarPost,
    switchSiteAndSearchForFeed,
    isPhoneViewport
  });

  initEventBindings({
    selectCategory,
    selectSite,
    renderFavoriteAuthors,
    openPostOverlay
  });

  initSearchEngine({
    renderFavoriteAuthors
  });

  // 1. Initialize subsystems. Token validation is fired concurrently with the
  // data loaders: if we awaited it, a slow/dead auth endpoint would stall the
  // first feed render. On 401/403 we drop the session and reload as anonymous.
  loadLocalAuth();
  void (async () => {
    if (!state.authToken) return;
    try {
      const me = await apiGetMe();
      if (me && me.user) {
        state.currentUser = me.user;
        saveLocalAuth(state.authToken, me.user);
        document.dispatchEvent(new CustomEvent('booru:user-changed'));
      } else {
        clearLocalAuth();
        await refreshAllUserData();
      }
    } catch (e) {
      if (e?.status === 401 || e?.status === 403) {
        clearLocalAuth();
        await refreshAllUserData();
      } else {
        showToast(t('auth.serverUnavailable', 'Сервер авторизации недоступен. Вход в аккаунт временно не подтвержден.'), 'error');
      }
    }
    updateHeaderAuthUI();
  })();
  updateHeaderAuthUI();

  ensureAuthModal().catch(() => {});
  ensureProfileUI().catch(() => {});

  setAutocompleteInstance(initAutocomplete({
    onSearch: () => performSearch(true),
    onTagsChanged: () => updatePresetActiveState()
  }));

  initSearchPresets({
    onApplyPreset: (preset) => {
      if (!preset || !Array.isArray(preset.tags)) return;
      if (preset.site && preset.site !== state.currentSite && state.sites.some(s => s.id === preset.site)) {
        state.currentSite = preset.site;
        updateSiteCapabilitiesUI(state.currentSite);
        updateCurrentSiteLabel();
        renderSitesBar({ onSelectSite: selectSite });
        renderMobileSourcesSheet({ onSelectSite: selectSite });
        if (preset.site === 'pawchive') ensurePawchiveServiceOptions();
        if (preset.site === 'kemono') ensureKemonoServiceOptions();
      }
      if (preset.filters && typeof preset.filters === 'object') {
        if (typeof preset.filters.hideFurry === 'boolean') state.hideFurry = preset.filters.hideFurry;
        if (typeof preset.filters.hidePregnant === 'boolean') state.hidePregnant = preset.filters.hidePregnant;
        if (typeof preset.filters.hideLgbt === 'boolean') state.hideLgbt = preset.filters.hideLgbt;
        if (preset.filters.aiFilter) state.aiFilter = preset.filters.aiFilter;
        if (preset.filters.ratingFilter) state.ratingFilter = preset.filters.ratingFilter;
        if (preset.filters.typeFilter) state.typeFilter = preset.filters.typeFilter;
        if (preset.filters.ageFilter) state.ageFilter = preset.filters.ageFilter;
        if (preset.filters.postSort) state.postSort = preset.filters.postSort;
        if (preset.filters.videoDurationSort) state.videoDurationSort = preset.filters.videoDurationSort;

        const checkHideFurry = document.getElementById('checkHideFurry');
        if (checkHideFurry) checkHideFurry.checked = state.hideFurry;
        const checkHidePregnant = document.getElementById('checkHidePregnant');
        if (checkHidePregnant) checkHidePregnant.checked = state.hidePregnant;
        const checkHideLgbt = document.getElementById('checkHideLgbt');
        if (checkHideLgbt) checkHideLgbt.checked = state.hideLgbt;

        updatePostSortUI();
        updateAiFilterUI();
        updateRatingFilterUI();
        updateTypeFilterUI();
        updateAgeFilterUI();
        updateVideoSortUI();
        updateFilterActiveDot();

        persistSettings({
          hideFurry: state.hideFurry,
          hidePregnant: state.hidePregnant,
          hideLgbt: state.hideLgbt
        });
      }
      state.searchTags = [...preset.tags];
      getAutocompleteInstance()?.renderTagsChips();
    },
    getCurrentTags: () => [...state.searchTags],
    getCurrentSite: () => state.currentSite,
    getCurrentFilters: () => ({
      hideFurry: Boolean(state.hideFurry),
      hidePregnant: Boolean(state.hidePregnant),
      hideLgbt: Boolean(state.hideLgbt),
      aiFilter: state.aiFilter || 'all',
      ratingFilter: state.ratingFilter || 'all',
      typeFilter: state.typeFilter || 'all',
      ageFilter: state.ageFilter || 'all',
      postSort: state.postSort || 'new',
      videoDurationSort: state.videoDurationSort || 'none'
    })
  });

  setGalleryInstance(initGallery({
    onOpenViewer: (index) => openPostOverlay(index),
    onFavoriteToggle: updateFavoritesBadge,
    onTagClick: (tag) => {
      getAutocompleteInstance()?.selectTag(tag, true);
    },
    onTagSelect: (tag) => {
      getAutocompleteInstance()?.selectTag(tag, true);
    },
    onAuthorSelect: (author) => {
      handleAuthorSelect(author);
    },
    onLoadMore: throttledLoadMore,
    onRefresh: () => {
      performSearch(true);
    },
    onAddAuthor: openAddAuthorModal,
    onSelectSite: (siteId) => selectSite(siteId),
    onFindSimilar: (post) => handleFindSimilarPost(post),
    onCardLongPress: (post) => {
      haptic(20);
      ensureFeed().then((f) => f.openQuickActions(post)).catch(() => {});
    }
  }));

  document.addEventListener('booru:langchange', () => {
    getGalleryInstance()?.renderGallery(false, { preserveScroll: true });
    renderSitesBar({ onSelectSite: selectSite });
    renderMobileSourcesSheet({ onSelectSite: selectSite });
    renderPresetsList();
    getProfileUIInstance()?.renderProfile();
  });

  initRouter({
    onCloseViewerUi: () => {
      whenViewerLoaded((v) => v.closeViewer());
    },
    onCloseFeedUi: () => {
      const feedInstance = getFeedInstance();
      if (feedInstance?.isFeedOpen?.()) feedInstance.closeFeed({ skipHistoryBack: true });
    },
    onOpenPost: (postId) => {
      openPostById(postId);
    },
    onOpenFeedPost: (postId) => {
      // The feed owns the entry now: drop any viewer that was stacked above it.
      whenViewerLoaded((v) => v.closeViewer({ skipHistoryBack: true }));
      if (isPhoneViewport()) {
        openPostById(postId, { overlay: 'feed', fromHistory: true });
      } else {
        openPostById(postId);
      }
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

  initAuthorNotifSourcesModal();

  ensureSettingsModal().catch(() => {});
  ensureAliasManagerModal().catch(() => {});

  initCustomSourcesModal({
    onApply: () => {
      selectSite('custom');
    }
  });

  ensureWikiModal().catch(() => {});

  ensureDownloadManager().catch(() => {});

  renderSitesBar({ onSelectSite: selectSite });
  renderMobileSourcesSheet({ onSelectSite: selectSite });

  // 2. Set up button listeners
  setupEventListeners();

  // 3. Load settings, favorites, likes, sites, and author aliases in parallel
  await Promise.allSettled([
    loadUserSettings(),
    loadFavorites(),
    loadFavoriteAuthors(),
    loadLikes(),
    loadDislikes(),
    loadLocalViewed(),
    loadViewHistory(),
    loadAuthorAliasesMap(),
    loadBooruSites({ onSelectSite: selectSite })
  ]);

  updateCategoryTabsUI();

  // 4. Restore search/viewer state from the URL before the initial load
  const urlParams = consumeInitialUrl();
  pendingPostId = urlParams.post || null;
  pendingFeedView = urlParams.view === 'feed';
  refreshSearchUiFromState();

  // 5. Initial search
  await performSearch(true);

  if (pendingPostId) {
    const pid = pendingPostId;
    const wantFeed = pendingFeedView && isPhoneViewport();
    pendingPostId = null;
    pendingFeedView = false;
    await openPostById(pid, wantFeed ? { overlay: 'feed', fromHistory: true } : {});
  } else if (pendingFeedView && isPhoneViewport()) {
    // A bare view=feed link opens the feed at the top of the current results.
    pendingFeedView = false;
    ensureFeed().then((f) => f.openFeed(0)).catch(() => {});
  }
}

// Re-render all UI bits that visualize the URL-restorable state fields
function refreshSearchUiFromState() {
  const autocompleteInstance = getAutocompleteInstance();
  if (autocompleteInstance) autocompleteInstance.renderTagsChips();
  updatePresetActiveState();
  updateCurrentSiteLabel();
  renderSitesBar({ onSelectSite: selectSite });
  renderMobileSourcesSheet({ onSelectSite: selectSite });
  updateSiteCapabilitiesUI(state.currentSite);
  if (state.currentSite === 'pawchive') ensurePawchiveServiceOptions();
  if (state.currentSite === 'kemono') ensureKemonoServiceOptions();
}

// Opens a post by its original site id: fast path searches the loaded feed,
// slow path fetches it with the `id:` metatag (bypassing content filters).
async function openPostById(postId, opts = {}) {
  if (!postId) return;

  const rawPostId = String(postId);
  const prefixedSite = (state.sites || []).find(site => rawPostId.startsWith(`${site.id}_`));
  const colonSite = rawPostId.includes(':') ? rawPostId.split(':')[0] : '';
  const targetSite = prefixedSite?.id || ((state.sites || []).some(site => site.id === colonSite) ? colonSite : state.currentSite);
  const originalId = prefixedSite ? rawPostId.slice(prefixedSite.id.length + 1) : rawPostId;

  const list = (state.displayedPosts && state.displayedPosts.length > 0) ? state.displayedPosts : state.posts;
  const idx = list.findIndex(p => p && (String(p.id) === rawPostId || String(p.originalId) === originalId));
  if (idx >= 0) {
    if (opts.overlay === 'feed') {
      ensureFeed().then((f) => f.openFeed(idx, opts)).catch(() => {});
    } else {
      openPostOverlay(idx);
    }
    return;
  }

  try {
    const res = await fetchPosts({
      site: targetSite,
      tags: `id:${originalId}`,
      page: 1,
      limit: 5,
      category: 'new',
      aiFilter: 'all',
      ratingFilter: 'all',
      typeFilter: 'all',
      ageFilter: 'all',
      hideFurry: false,
      hidePregnant: false,
      hideLgbt: false
    });
    const posts = res && res.success && Array.isArray(res.posts) ? res.posts : [];
    const post = posts.find(p => String(p.id) === rawPostId || String(p.originalId) === originalId);
    if (post) {
      if (opts.overlay === 'feed') {
        ensureFeed().then((f) => f.openFeed(-1, { directPost: post, fromHistory: Boolean(opts.fromHistory) })).catch(() => {});
      } else {
        openPostOverlay(-1, { directPost: post });
      }
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
  renderFavoriteAuthorsList(getGalleryInstance(), {
    onExploreAuthor: handleExploreAuthor,
    onUpdateBadge: updateFavoritesBadge
  });
}

function handleExploreAuthor(author) {
  if (!author || !author.name) return;
  if (author.site && state.sites.some(s => s.id === author.site)) {
    state.currentSite = author.site;
    updateSiteCapabilitiesUI(state.currentSite);
  }
  if (state.currentSite === 'pawchive') ensurePawchiveServiceOptions();
  if (state.currentSite === 'kemono') ensureKemonoServiceOptions();

  searchAuthorPosts(author);
}

// Global quick search helper to jump to a specific author
function searchAuthorPosts(author) {
  if (!author || !author.name) return;
  if (state.currentSite !== author.site && author.site) {
    state.currentSite = author.site;
    updateSiteCapabilitiesUI(author.site);
    updateCurrentSiteLabel();
    renderSitesBar({ onSelectSite: selectSite });
    renderMobileSourcesSheet({ onSelectSite: selectSite });
  }
  state.searchTags = [];
  if (state.currentSite === 'rule34video' && !author.name.includes(':')) {
    addSearchTag(`artist:${author.name}`);
  } else if (state.currentSite === 'pawchive' || state.currentSite === 'kemono') {
    if (author.service && author.user) {
      addSearchTag(`service:${author.service}`);
      addSearchTag(`user:${author.user}`);
    } else {
      addSearchTag(`artist:${author.name}`);
    }
  } else {
    addSearchTag(author.name);
  }
  const autocompleteInstance = getAutocompleteInstance();
  if (autocompleteInstance) {
    autocompleteInstance.renderTagsChips();
  }
  selectCategory('feed');
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
    state.currentCategory = 'feed';
  }
  updateSiteCapabilitiesUI(siteId);
  updateCurrentSiteLabel();
  renderSitesBar({ onSelectSite: selectSite });
  renderMobileSourcesSheet({ onSelectSite: selectSite });
  if (siteId === 'pawchive') ensurePawchiveServiceOptions();
  if (siteId === 'kemono') ensureKemonoServiceOptions();
  performSearch(true);
}

function selectCategory(category) {
  if (state.currentCategory === category && category !== 'favorites') return;
  state.currentCategory = category;
  updateCategoryTabsUI();
  performSearch(true);
}

function handleAuthorSelect(authorTag) {
  if (!authorTag) return;
  const autocompleteInstance = getAutocompleteInstance();
  state.currentCategory = 'feed';
  updateCategoryTabsUI();

  // Reset filters and sorting to defaults
  state.postSort = 'new';
  state.videoDurationSort = 'none';
  state.typeFilter = 'all';
  state.ageFilter = 'all';
  state.ratingFilter = 'all';
  state.aiFilter = 'no-ai';

  updatePostSortUI();
  updateVideoSortUI();
  updateTypeFilterUI();
  updateAgeFilterUI();
  updateRatingFilterUI();
  updateAiFilterUI();
  updateFilterActiveDot();

  if (autocompleteInstance) {
    if (typeof autocompleteInstance.clear === 'function') {
      autocompleteInstance.clear();
    } else if (typeof autocompleteInstance.clearTags === 'function') {
      autocompleteInstance.clearTags();
    }
    autocompleteInstance.selectTag(authorTag, false);
  } else {
    state.searchTags = [authorTag];
  }
  performSearch(true);
}

// Feed variant of the site-and-search switch: closes the feed, applies the
// site and filter defaults, then runs the new search.
function switchSiteAndSearchForFeed(site, query) {
  const feedInstance = getFeedInstance();
  const autocompleteInstance = getAutocompleteInstance();
  if (feedInstance?.isFeedOpen?.()) feedInstance.closeFeed({ skipHistoryBack: true });
  if (site) {
    state.currentSite = site;
    persistSettings({ defaultSite: site });
    updateSiteCapabilitiesUI(site);
    updateCurrentSiteLabel();
    renderSitesBar({ onSelectSite: selectSite });
    renderMobileSourcesSheet({ onSelectSite: selectSite });
    if (site === 'pawchive') ensurePawchiveServiceOptions();
    if (site === 'kemono') ensureKemonoServiceOptions();
  }
  state.currentCategory = 'feed';
  updateCategoryTabsUI();

  state.postSort = 'new';
  state.videoDurationSort = 'none';
  state.typeFilter = 'all';
  state.ageFilter = 'all';
  state.ratingFilter = 'all';
  state.aiFilter = 'no-ai';

  updatePostSortUI();
  updateVideoSortUI();
  updateTypeFilterUI();
  updateAgeFilterUI();
  updateRatingFilterUI();
  updateAiFilterUI();
  updateFilterActiveDot();

  if (autocompleteInstance) {
    if (typeof autocompleteInstance.clear === 'function') {
      autocompleteInstance.clear();
    } else if (typeof autocompleteInstance.clearTags === 'function') {
      autocompleteInstance.clearTags();
    }
    if (query) {
      autocompleteInstance.selectTag(query, false);
    }
  } else {
    state.searchTags = query ? [query] : [];
  }
  performSearch(true);
}

function handleFindSimilarPost(post) {
  if (!post) return;
  // Record session interaction
  recordSessionInteraction(post, 'similar');

  // Open viewer for this post so user immediately sees the media and its dedicated similar works grid
  const list = (state.displayedPosts && state.displayedPosts.length > 0) ? state.displayedPosts : state.posts;
  const postIdx = (list || []).findIndex(p => p && p.id === post.id);

  ensureViewer().then((v) => {
    if (postIdx !== -1) {
      v.openViewer(postIdx);
    } else {
      v.openViewer(-1, { directPost: post });
    }
  }).catch(() => {});

  // If on mobile, open tags/info drawer so the similar section is immediately visible
  if (window.innerWidth <= 800) {
    const sidebar = document.getElementById('viewerSidebar');
    if (sidebar) sidebar.classList.add('open');
  }

  const similarSection = document.getElementById('viewerSidebarSimilarSection');
  if (similarSection) {
    setTimeout(() => {
      similarSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  }
}

init();
