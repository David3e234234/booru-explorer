// Lazy loader subsystem: owns the importOnce registry, the lazily initialized
// heavy UI modules (settings, auth, profile, viewer, feed, wiki, downloads) and
// the shared component instances they produce. app.js wires the actions these
// callbacks need once via initLazyLoaders(); everything importable is imported
// directly.
import {
  state,
  addSearchTag
} from '../state.js';
import { resolvePostById } from '../api.js';
import { showToast, haptic } from './uiUtils.js';
import { openDrawer } from './drawers.js';
import { persistSettings } from './settingsPersist.js';
import {
  updateSiteCapabilitiesUI,
  updateCategoryTabsUI,
  updatePostSortUI,
  updateAiFilterUI,
  updateRatingFilterUI,
  updateTypeFilterUI,
  updateAgeFilterUI,
  updateVideoSortUI,
  updatePawchiveServiceUI,
  updateKemonoServiceUI,
  updateFilterActiveDot
} from './filtersUI.js';
import {
  renderSitesBar,
  renderMobileSourcesSheet,
  updateCurrentSiteLabel
} from './navigationUI.js';
import { ensurePawchiveServiceOptions, ensureKemonoServiceOptions } from './serviceOptions.js';
import { bumpAccountGeneration, refreshAllUserData } from './accountData.js';
import { renderPresetsList } from './searchPresetsUI.js';

// Heavy subsystems (settings modal, profile, downloads, viewer) load lazily so
// the gallery can paint without waiting for ~150 KB of viewer/modal code.
// Lazy loaders must use literal specifiers so esbuild can split chunks.
const lazyModules = new Map();
function importOnce(key, loader) {
  let p = lazyModules.get(key);
  if (!p) {
    p = loader().catch((err) => { lazyModules.delete(key); throw err; });
    lazyModules.set(key, p);
  }
  return p;
}

// Shared component instances. They live here so the search engine, event
// bindings and lazy module callbacks all see the same refs.
let autocompleteInstance = null;
let galleryInstance = null;
let viewerInstance = null;
let authModalInstance = null;
let profileUIInstance = null;
let feedInstance = null;

export function setAutocompleteInstance(v) { autocompleteInstance = v; }
export function getAutocompleteInstance() { return autocompleteInstance; }
export function setGalleryInstance(v) { galleryInstance = v; }
export function getGalleryInstance() { return galleryInstance; }
export function getViewerInstance() { return viewerInstance; }
export function getAuthModalInstance() { return authModalInstance; }
export function getProfileUIInstance() { return profileUIInstance; }
export function getFeedInstance() { return feedInstance; }

// Actions owned by app.js, injected at boot
let deps = {
  performSearch: async () => {},
  selectCategory: () => {},
  selectSite: () => {},
  renderFavoriteAuthors: () => {},
  updateFavoritesBadge: () => {},
  openPostOverlay: () => {},
  handleAuthorSelect: () => {},
  handleFindSimilarPost: () => {},
  switchSiteAndSearchForFeed: () => {},
  isPhoneViewport: () => false
};

export function initLazyLoaders(d) {
  deps = { ...deps, ...d };
}

let settingsModalPromise = null;
export function ensureSettingsModal() {
  if (!settingsModalPromise) {
    settingsModalPromise = importOnce('settingsModal', () => import('./settingsModal.js')).then((m) => {
      m.initSettingsModal({
        onSettingsChanged: () => {
          updateSiteCapabilitiesUI();
          updateCategoryTabsUI();
          whenViewerLoaded((v) => v.refreshSimilarState?.());
          if ((state.currentCategory === 'favorites' && state.favoritesSubTab === 'authors') ||
              (state.currentCategory === 'profile' && state.profileSubTab === 'authors')) {
            deps.renderFavoriteAuthors();
          } else {
            deps.performSearch(true);
          }
        },
        onDataImported: () => {
          deps.updateFavoritesBadge();
          deps.performSearch(true);
        },
        onUpdateFavoritesBadge: () => deps.updateFavoritesBadge()
      });
      return m;
    }).catch((err) => { settingsModalPromise = null; throw err; });
  }
  return settingsModalPromise;
}
export function applySettingsToUIAndState(s) {
  return ensureSettingsModal().then((m) => m.applySettingsToUIAndState(s));
}
export function openSettingsModal() {
  ensureSettingsModal().then((m) => m.openSettingsModal()).catch(() => {});
}
export function closeSettingsModal() {
  ensureSettingsModal().then((m) => m.closeSettingsModal()).catch(() => {});
}

let authModalPromise = null;
export function ensureAuthModal() {
  if (!authModalPromise) {
    authModalPromise = importOnce('authModal', () => import('./authModal.js')).then((m) => {
      authModalInstance = m.initAuthModal({
        onAuthSuccess: async () => {
          bumpAccountGeneration();
          updateHeaderAuthUI();
          await refreshAllUserData();
          if (profileUIInstance) profileUIInstance.renderProfile();
          deps.selectCategory('profile');
        },
        onLogout: async () => {
          bumpAccountGeneration();
          updateHeaderAuthUI();
          await refreshAllUserData();
          if (profileUIInstance) profileUIInstance.renderProfile();
          deps.selectCategory('feed');
        },
        onOpenProfile: () => {
          deps.selectCategory('profile');
        }
      });
      return m;
    }).catch((err) => { authModalPromise = null; throw err; });
  }
  return authModalPromise;
}
export function updateHeaderAuthUI() {
  ensureAuthModal().then((m) => m.updateHeaderAuthUI()).catch(() => {});
}

let profileUIPromise = null;
export function ensureProfileUI() {
  if (!profileUIPromise) {
    profileUIPromise = importOnce('profileUI', () => import('./profileUI.js')).then((m) => {
      profileUIInstance = m.initProfileUI({
        onOpenAuth: (mode) => authModalInstance?.openAuthModal(mode),
        onOpenHistoryPost: async (entry) => {
          const fallbackPost = {
            id: entry.i,
            originalId: entry.o || entry.i,
            site: entry.s,
            previewUrl: entry.t,
            thumb360: entry.t,
            sampleUrl: entry.t,
            isVideo: Boolean(entry.v)
          };
          const resolved = await resolvePostById(entry.s, entry.o || entry.i);
          deps.openPostOverlay(-1, { directPost: resolved || fallbackPost });
        },
        onTabChange: (type, val) => {
          if (type === 'search-tag') {
            state.searchTags = [];
            addSearchTag(val);
            autocompleteInstance?.renderTagsChips();
            deps.selectCategory('feed');
          } else if (type === 'profile-subtab') {
            if (val === 'authors') {
              deps.renderFavoriteAuthors();
            } else {
              deps.performSearch(true);
            }
          } else if (type === 'profile-authors-search') {
            deps.renderFavoriteAuthors();
          }
        },
        onReloadState: async () => {
          bumpAccountGeneration();
          updateHeaderAuthUI();
          await refreshAllUserData();
          renderPresetsList();
          if (profileUIInstance) profileUIInstance.renderProfile();
          deps.selectCategory('feed');
        }
      });
      return m;
    }).catch((err) => { profileUIPromise = null; throw err; });
  }
  return profileUIPromise;
}

export function ensureDownloadManager() {
  return importOnce('downloadManager', () => import('./downloadManager.js')).then((m) => m.initDownloadManager()).catch(() => {});
}
export function ensureAliasManagerModal() {
  return importOnce('aliasManagerModal', () => import('./aliasManagerModal.js')).then((m) => m.initDiscoveredAliasesModal()).catch(() => {});
}
export function ensureWikiModal() {
  return importOnce('wikiModal', () => import('./wikiModal.js')).then((m) => m.initWikiModal({
    onSelectTag: (tag) => {
      addSearchTag(tag);
      if (autocompleteInstance) autocompleteInstance.renderTagsChips();
      deps.performSearch(true);
    },
    onSwitchSite: (site) => {
      deps.selectSite(site);
    }
  })).catch(() => {});
}

let viewerPromise = null;
export function ensureViewer() {
  if (!viewerPromise) {
    viewerPromise = importOnce('viewer', () => import('../viewer.js')).then((m) => {
      viewerInstance = m.initViewer({
        onFavoriteToggle: () => {
          galleryInstance.renderGallery(false, { preserveScroll: true });
          deps.updateFavoritesBadge();
        },
        onFavoriteAuthorToggle: () => {
          deps.updateFavoritesBadge();
          if (state.currentCategory === 'favorites' && state.favoritesSubTab === 'authors') {
            deps.renderFavoriteAuthors();
          }
        },
        onTagSelect: (tag) => {
          autocompleteInstance.selectTag(tag, true);
        },
        onAuthorSelect: (author) => {
          deps.handleAuthorSelect(author);
        },
        onDislikeToggle: () => {
          galleryInstance.renderGallery(false, { preserveScroll: true });
        },
        onFindSimilar: (post) => deps.handleFindSimilarPost(post),
        onSwitchSiteAndSearch: (site, query) => {
          whenViewerLoaded((v) => v.closeViewer({ skipHistoryBack: true }));
          if (site) {
            state.currentSite = site;
            persistSettings({ defaultSite: site });
            updateSiteCapabilitiesUI(site);
            updateCurrentSiteLabel();
            renderSitesBar({ onSelectSite: deps.selectSite });
            renderMobileSourcesSheet({ onSelectSite: deps.selectSite });
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
          deps.performSearch(true);
        },
        showToast
      });
      return viewerInstance;
    }).catch((err) => { viewerPromise = null; throw err; });
  }
  return viewerPromise;
}
export function whenViewerLoaded(fn) {
  if (viewerInstance) fn(viewerInstance);
}

let feedPromise = null;
export function ensureFeed() {
  if (!feedPromise) {
    feedPromise = importOnce('feed', () => import('../feed/index.js')).then((m) => {
      feedInstance = m.initFeed({
        getList: () => (state.displayedPosts && state.displayedPosts.length > 0) ? state.displayedPosts : state.posts,
        onFavoriteToggle: () => {
          galleryInstance.renderGallery(false, { preserveScroll: true });
          deps.updateFavoritesBadge();
        },
        onDislikeToggle: () => {
          galleryInstance.renderGallery(false, { preserveScroll: true });
        },
        onTagSelect: (tag) => {
          autocompleteInstance.selectTag(tag, true);
        },
        onAuthorSelect: (author) => {
          deps.handleAuthorSelect(author);
        },
        onFavoriteAuthorToggle: () => {
          deps.updateFavoritesBadge();
        },
        onFindSimilar: (post) => {
          deps.handleFindSimilarPost(post);
        },
        onOpenViewer: (index) => {
          deps.openPostOverlay(index, { forceViewer: true });
        },
        onOpenSearchDrawer: () => {
          openDrawer(document.getElementById('sidebarSearch'));
        },
        onSwitchSiteAndSearch: (site, query) => {
          deps.switchSiteAndSearchForFeed(site, query);
        },
        onLoadMore: () => {
          throttledLoadMore();
        }
      });
      return feedInstance;
    }).catch((err) => { feedPromise = null; throw err; });
  }
  return feedPromise;
}

// Infinite scroll throttle shared by the gallery and the phone feed: one
// request at a time, tighter pacing on the rate-limited Rule34 scraper.
let lastLoadMoreTime = 0;
export function throttledLoadMore() {
  const now = Date.now();
  const throttleMs = state.currentSite === 'rule34' ? 650 : 450;
  if (now - lastLoadMoreTime < throttleMs) return;
  if (!state.isLoading && state.hasMore) {
    lastLoadMoreTime = now;
    state.page++;
    galleryInstance?.showScrollLoading();
    deps.performSearch(false).then(() => {
      feedInstance?.onListChanged?.();
    }).catch(() => {});
  }
}
