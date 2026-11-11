// Search engine: the single entry point that produces a feed for the current
// category (feed, following, recommended, favorites, profile) and writes it
// into state. Superseded responses are dropped via a monotonic sequence token.
import { state } from '../state.js';
import { fetchPosts } from '../api.js';
import { syncSearchUrl } from '../router.js';
import { showToast } from '../modules/uiUtils.js';
import { t } from '../i18n.js';
import { renderSidebarPageTags } from '../modules/sidebarTags.js';
import { updatePresetActiveState } from '../modules/searchPresetsUI.js';
import {
  getGalleryInstance,
  getFeedInstance,
  getAutocompleteInstance,
  getProfileUIInstance
} from '../modules/lazyLoader.js';
import { runFollowingSearch } from './following.js';
import { runRecommendedSearch } from './recommendations.js';

// app.js-owned renderers, wired at boot
let deps = { renderFavoriteAuthors: () => {} };
export function initSearchEngine(d) {
  deps = { ...deps, ...d };
}

// ApiError carries the HTTP status; parser messages are free-form Russian
// text. Reading `status` first keeps a URL that merely contains "429" from
// being reported as a rate limit.
export function isRateLimitError(err) {
  if (!err) return false;
  if (err.status === 429) return true;
  return /\b429\b/.test(String(err.message || ''));
}

// Monotonic token: responses from superseded searches are discarded on arrival
let searchSeq = 0;

export async function performSearch(reset = false, options = {}) {
  const seq = ++searchSeq;
  const galleryInstance = getGalleryInstance();
  const feedInstance = getFeedInstance();
  const autocompleteInstance = getAutocompleteInstance();
  const profileUIInstance = getProfileUIInstance();

  // A fresh search supersedes the feed session: close it without polluting
  // history (the search itself rewrites the URL right after).
  if (reset && feedInstance?.isFeedOpen?.()) {
    feedInstance.closeFeed({ skipHistoryBack: true });
  }

  const favoritesHeaderBar = document.getElementById('favoritesHeaderBar');
  if (favoritesHeaderBar) {
    favoritesHeaderBar.style.display = state.currentCategory === 'favorites' ? 'flex' : 'none';
  }

  // The profile stats tab fills the page with its own cards; the gallery
  // surface below (grid, search empty state, load-more) must not show there
  const galleryContainer = document.querySelector('.gallery-container');
  if (galleryContainer) {
    const hideGalleryChrome = state.currentCategory === 'profile' && state.profileSubTab === 'analytics';
    galleryContainer.style.display = hideGalleryChrome ? 'none' : '';
  }

  if (reset) {
    state.page = 1;
    state.posts = [];
    state.hasMore = true;
    galleryInstance.showLoading();
  }

  // Remember which source this feed belongs to. A later settings write can
  // change state.currentSite without a new fetch; recording it here keeps the
  // sources panel able to tell "already showing this" from "highlight is stale".
  if (state.currentCategory !== 'favorites' && state.currentCategory !== 'profile') {
    state.loadedSite = state.currentSite;
  }

  syncSearchUrl(reset ? 'push' : 'replace');
  updatePresetActiveState();

  // Profile section (TikTok style)
  if (state.currentCategory === 'profile') {
    state.isLoading = false;
    const btnRefreshSearch = document.getElementById('btnRefreshSearch');
    if (btnRefreshSearch) btnRefreshSearch.classList.remove('refreshing');
    if (profileUIInstance) profileUIInstance.renderProfile();
    
    if (state.profileSubTab === 'authors') {
      deps.renderFavoriteAuthors();
      return { success: true };
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
    return { success: true };
  }

  if (state.currentCategory === 'favorites') {
    state.isLoading = false;
    const btnRefreshSearch = document.getElementById('btnRefreshSearch');
    if (btnRefreshSearch) btnRefreshSearch.classList.remove('refreshing');
    if (state.favoritesSubTab === 'authors') {
      deps.renderFavoriteAuthors();
      return { success: true };
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
    return { success: true };
  }

  if (state.currentCategory === 'following') {
    return await runFollowingSearch({
      reset,
      options,
      isSuperseded: () => seq !== searchSeq,
      renderFavoriteAuthors: () => deps.renderFavoriteAuthors()
    });
  }

  if (state.currentCategory === 'recommended') {
    return await runRecommendedSearch({
      reset,
      options,
      isSuperseded: () => seq !== searchSeq
    });
  }

  try {
    state.isLoading = true;
    const btnRefreshSearch = document.getElementById('btnRefreshSearch');
    if (btnRefreshSearch) btnRefreshSearch.classList.add('refreshing');

    const currentLimit = state.settings.itemsPerPage || state.limit || 40;
    const res = await fetchPosts({
      site: state.currentSite,
      tags: state.searchTags.join(' '),
      page: state.page,
      limit: currentLimit,
      category: (state.currentCategory === 'feed' || state.currentCategory === 'new' || !state.currentCategory) ? (state.postSort || 'new') : state.currentCategory,
      aiFilter: state.aiFilter,
      ratingFilter: state.ratingFilter,
      typeFilter: state.typeFilter,
      ageFilter: state.ageFilter,
      hideFurry: state.hideFurry,
      hidePregnant: state.hidePregnant,
      hideLgbt: state.hideLgbt,
      customSites: state.currentSite === 'custom' ? state.settings.customSources : '',
      pawchiveService: state.currentSite === 'pawchive' ? (state.pawchiveService || 'all') : '',
      kemonoService: state.currentSite === 'kemono' ? (state.kemonoService || 'all') : '',
      bustCache: options.bustCache || false
    });

    if (seq !== searchSeq) return { success: false, superseded: true };

    // The server rewrites author tokens through discovered aliases; surface that
    // so a bad alias is visible instead of silently shaping the feed
    if (res.success && res.aliasInfo?.substitutions?.length) {
      const sub = res.aliasInfo.substitutions[0];
      if (res.aliasInfo.fallbackUsed) {
        showToast(
          t('app.aliasFallback', 'Алиас «{a}» не дал результатов, искали по запросу «{b}»').replace('{a}', sub.resolved).replace('{b}', sub.token),
          'warning'
        );
      } else {
        showToast(t('app.aliasUsed', 'Поиск по алиасу: «{a}» → «{b}»').replace('{a}', sub.token).replace('{b}', sub.resolved));
      }
    }

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

    // Speculatively prefetch next page into server cache during idle for seamless infinite scroll
    if (state.hasMore && state.currentCategory !== 'random' && state.currentCategory !== 'favorites' && state.currentCategory !== 'following') {
      if (state.currentSite !== 'rule34' || state.settings?.rule34ApiKey) {
        scheduleNextPagePrefetch();
      }
    }
    return { success: true };
  } catch (err) {
    console.error('Ошибка поиска:', err);
    if (seq !== searchSeq) return { success: false, superseded: true };
    state.lastSearchFailed = true;
    if (reset) {
      state.posts = [];
      state.lastSearchFailed = true;
      if (isRateLimitError(err)) {
        showToast(t('app.rateLimitSearch', 'Превышен лимит запросов к источнику. Пожалуйста, подождите немного.'), 'warning');
      }
    } else {
      // Roll the page back so infinite scroll does not keep a permanent gap
      state.page--;
      state.hasMore = true;
      if (isRateLimitError(err) || state.currentSite === 'rule34') {
        showToast(t('app.rateLimitScroll', 'Лимит запросов Rule34. Подождите пару секунд и продолжите прокрутку.'), 'warning');
      }
    }
    galleryInstance.renderGallery(false);
    return { success: false, error: err };
  } finally {
    if (seq === searchSeq) {
      state.isLoading = false;
      const btnRefreshSearch = document.getElementById('btnRefreshSearch');
      if (btnRefreshSearch) btnRefreshSearch.classList.remove('refreshing');
    }
  }
}

let prefetchTimer = null;
export function scheduleNextPagePrefetch() {
  if (prefetchTimer) clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => {
    if (state.isLoading || !state.hasMore) return;
    const currentLimit = state.settings?.itemsPerPage || state.limit || 40;
    fetchPosts({
      site: state.currentSite,
      tags: state.searchTags.join(' '),
      page: state.page + 1,
      limit: currentLimit,
      category: (state.currentCategory === 'feed' || state.currentCategory === 'new' || !state.currentCategory) ? (state.postSort || 'new') : state.currentCategory,
      aiFilter: state.aiFilter,
      ratingFilter: state.ratingFilter,
      typeFilter: state.typeFilter,
      ageFilter: state.ageFilter,
      hideFurry: state.hideFurry,
      hidePregnant: state.hidePregnant,
      hideLgbt: state.hideLgbt,
      customSites: state.currentSite === 'custom' ? state.settings?.customSources : '',
      pawchiveService: state.currentSite === 'pawchive' ? (state.pawchiveService || 'all') : '',
      kemonoService: state.currentSite === 'kemono' ? (state.kemonoService || 'all') : '',
      bustCache: false
    }).catch(() => {});
  }, 1200);
}
