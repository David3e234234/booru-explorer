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
  apiGetMe
} from './api.js';
import { initAutocomplete } from './autocomplete.js';
import { initGallery } from './gallery.js';
import { initViewer } from './viewer.js';
import { isMyLiveDemoHost, isVercelHost, showToast, haptic } from './modules/uiUtils.js';
import { openDrawer, closeAllDrawers, setDrawerCallbacks } from './modules/drawers.js';
import { 
  updateAiFilterUI, 
  updateRatingFilterUI, 
  updateTypeFilterUI, 
  updateAgeFilterUI, 
  updateDateFilterUI,
  updateCategoryTabsUI 
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
import { initProfileUI } from './modules/profileUI.js';

export { isMyLiveDemoHost, isVercelHost, showToast, openDrawer, closeAllDrawers };

let autocompleteInstance = null;
let galleryInstance = null;
let viewerInstance = null;
let authModalInstance = null;
let profileUIInstance = null;
let deferredInstallPrompt = null;

async function init() {
  setDrawerCallbacks({
    onCategoryUIUpdate: updateCategoryTabsUI,
    onCloseSettingsModal: closeSettingsModal
  });

  // 1. Инициализация подсистем и валидация токена
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
      autocompleteInstance.selectTag(tag, true);
    },
    showToast
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

  renderSitesBar({ onSelectSite: selectSite });
  renderMobileSourcesSheet({ onSelectSite: selectSite });

  // 2. Настройка слушателей кнопок
  setupEventListeners();

  // 3. Загрузка настроек, избранного, лайков и сайтов параллельно
  await Promise.allSettled([
    loadUserSettings(),
    loadFavorites(),
    loadFavoriteAuthors(),
    loadLikes(),
    loadLocalViewed(),
    loadBooruSites({ onSelectSite: selectSite })
  ]);

  updateCategoryTabsUI();
  updateDateFilterUI();

  // 4. Первичный поиск
  await performSearch(true);
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
  showToast(`Поиск работ автора: ${author.displayName || author.name}`);
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
    updateCategoryTabsUI();
  }
  updateCurrentSiteLabel();
  renderSitesBar({ onSelectSite: selectSite });
  renderMobileSourcesSheet({ onSelectSite: selectSite });
  performSearch(true);
}

function selectCategory(category) {
  if (state.currentCategory === category && category !== 'favorites') return;
  state.currentCategory = category;
  updateCategoryTabsUI();
  performSearch(true);
}

async function loadUserSettings() {
  try {
    if (state.currentUser) {
      const data = await fetchSettings();
      const serverSettings = data?.settings || {};
      applySettingsToUIAndState(serverSettings);
      saveLocalSettings(serverSettings);
    } else {
      const local = loadLocalSettings();
      if (local) {
        applySettingsToUIAndState(local);
      }
      const data = await fetchSettings();
      const serverSettings = data?.settings || {};
      const merged = { ...serverSettings, ...(local || {}) };
      applySettingsToUIAndState(merged);
      saveLocalSettings(merged);
    }
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

  // 👤 Раздел «Профиль» (TikTok style)
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

  // ✨ Раздел рекомендаций «Для вас»
  if (state.currentCategory === 'recommended') {
    try {
      state.isLoading = true;
      const btnRefreshSearch = document.getElementById('btnRefreshSearch');
      if (btnRefreshSearch) btnRefreshSearch.classList.add('refreshing');

      const userInterests = getUserInterestTags();
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

        if (userInterests.length > 0) {
          const selectedSeeds = [];

          // 1. Сначала берем лучшие парные сид-связки (Автор + Персонаж / Персонаж + Франшиза)
          const seedPairs = getUserInterestSeedPairs(8);
          if (seedPairs.length > 0) {
            // Перемешиваем топ-связки для свежести выдачи
            const shuffledPairs = [...seedPairs].sort(() => Math.random() - 0.5);
            for (const pair of shuffledPairs) {
              if (selectedSeeds.length >= 2) break;
              selectedSeeds.push(pair);
            }
          }

          // 2. Дополняем одиночными топ-интересами (топ-15)
          const topInterests = userInterests.slice(0, 15);
          const shuffledTop = [...topInterests].sort(() => Math.random() - 0.5);
          for (const item of shuffledTop) {
            if (selectedSeeds.length >= 4) break;
            if (!selectedSeeds.includes(item.tag) && !selectedSeeds.some(s => s.includes(item.tag))) {
              selectedSeeds.push(item.tag);
            }
          }

          for (const rawSeed of selectedSeeds) {
            const cleanSeedTag = rawSeed.replace(/[()]/g, '').trim();
            if (!cleanSeedTag) continue;
            fetchTasks.push(
              fetchPosts({
                site: state.currentSite,
                tags: cleanSeedTag,
                page: 1 + Math.floor((state.page - 1) / Math.max(1, selectedSeeds.length)),
                limit: 25,
                category: 'new',
                aiFilter: state.aiFilter,
                ratingFilter: state.ratingFilter,
                typeFilter: state.typeFilter,
                ageFilter: state.ageFilter,
                hideFurry: state.hideFurry,
                hidePregnant: state.hidePregnant,
                hideLgbt: state.hideLgbt,
                bustCache: options.bustCache || false
              }).catch(() => null)
            );
          }
        }

        if (userInterests.length > 0) {
          fetchTasks.push(
            fetchPosts({
              site: state.currentSite,
              tags: '',
              page: state.page,
              limit: Math.min(currentLimit, 40),
              category: 'popular',
              aiFilter: state.aiFilter,
              ratingFilter: state.ratingFilter,
              typeFilter: state.typeFilter,
              ageFilter: state.ageFilter,
              hideFurry: state.hideFurry,
              hidePregnant: state.hidePregnant,
              hideLgbt: state.hideLgbt,
              bustCache: options.bustCache || false
            }).catch(() => null)
          );
        } else {
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
              hideFurry: state.hideFurry,
              hidePregnant: state.hidePregnant,
              hideLgbt: state.hideLgbt,
              bustCache: options.bustCache || false
            }).catch(() => null)
          );
        }

        const results = await Promise.allSettled(fetchTasks);
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

      const scoredCandidates = filteredCandidates.map(p => {
        const matchResult = calculatePostMatchPercent(p, interestMap);
        let basePercent = typeof matchResult === 'object' ? matchResult.percent : matchResult;
        const matchedTags = typeof matchResult === 'object' ? matchResult.matchedTags : [];
        const isViewed = state.viewedIds.has(p.id);
        if (isViewed) {
          basePercent = Math.round(basePercent * 0.55);
        }
        return {
          ...p,
          matchPercent: basePercent,
          matchedTags,
          isViewed
        };
      });

      const finalRecommended = [];
      const authorCountMap = new Map();
      let lastAuthor = null;
      const candidatePool = [...scoredCandidates];

      while (candidatePool.length > 0 && finalRecommended.length < currentLimit) {
        let bestIndex = -1;
        let bestScore = -Infinity;

        for (let i = 0; i < candidatePool.length; i++) {
          const item = candidatePool[i];
          const rawAuthor = item.author || (item.tagDetails?.artist?.[0]) || 'unknown';
          const cleanAuthor = String(rawAuthor).toLowerCase().trim();
          const seenCount = authorCountMap.get(cleanAuthor) || 0;

          let authorPenalty = 1.0;
          if (cleanAuthor !== 'unknown') {
            if (seenCount === 1) authorPenalty = 0.65;
            else if (seenCount === 2) authorPenalty = 0.35;
            else if (seenCount >= 3) authorPenalty = 0.10;
          }

          const adjacentPenalty = (cleanAuthor !== 'unknown' && cleanAuthor === lastAuthor) ? 0.3 : 1.0;
          const effectiveScore = (item.matchPercent || 0) * authorPenalty * adjacentPenalty;

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
      state.hasMore = candidatePosts.length > 0;

      galleryInstance.renderGallery(!reset);
      renderSidebarPageTags({ onTagSelect: (t) => autocompleteInstance.selectTag(t) });
    } catch (err) {
      console.error('Ошибка рекомендаций:', err);
      if (reset) state.posts = [];
      galleryInstance.renderGallery(false);
    } finally {
      state.isLoading = false;
      const btnRefreshSearch = document.getElementById('btnRefreshSearch');
      if (btnRefreshSearch) btnRefreshSearch.classList.remove('refreshing');
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
    renderSidebarPageTags({ onTagSelect: (t) => autocompleteInstance.selectTag(t) });
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
      persistSettings({ aiFilter: filter });
    });
  });

  // Фильтр Возрастного Рейтинга (SFW / NSFW)
  document.querySelectorAll('.rating-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const rating = pill.dataset.rating;
      if (state.ratingFilter === rating) return;
      state.ratingFilter = rating;
      updateRatingFilterUI();
      persistSettings({ ratingFilter: rating });
    });
  });

  // Переключатель Типа контента (Все / Видео / Фото)
  document.querySelectorAll('.type-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const type = pill.dataset.type;
      if (state.typeFilter === type) return;
      state.typeFilter = type;
      updateTypeFilterUI();
      persistSettings({ typeFilter: type });
    });
  });

  // Фильтр Возраста (Все / Взрослые / Молодые)
  document.querySelectorAll('.age-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const age = pill.dataset.age;
      if (state.ageFilter === age) return;
      state.ageFilter = age;
      updateAgeFilterUI();
      persistSettings({ ageFilter: age });
    });
  });

  // Выпадающий список фильтра по дате
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
        performSearch(true);
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

  // Сортировка видео по длительности
  document.querySelectorAll('.video-sort-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const sort = pill.dataset.sort;
      if (state.videoDurationSort === sort) return;
      state.videoDurationSort = sort;
      document.querySelectorAll('.video-sort-pill').forEach(p => {
        p.classList.toggle('active', p.dataset.sort === sort);
      });
      galleryInstance.renderGallery(false);
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

  // Кнопка «Искать» в сайдбаре
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

  // Логотип
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

  // Кнопка Обновить поиск
  const btnRefreshSearch = document.getElementById('btnRefreshSearch');
  if (btnRefreshSearch) {
    btnRefreshSearch.addEventListener('click', async () => {
      if (btnRefreshSearch.classList.contains('refreshing')) return;
      btnRefreshSearch.classList.add('refreshing');
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        await performSearch(true, { bustCache: true });
        showToast('Поиск обновлен');
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
      for (let i = state.posts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.posts[i], state.posts[j]] = [state.posts[j], state.posts[i]];
      }
      galleryInstance.renderGallery(false);
      renderSidebarPageTags({ onTagSelect: (t) => autocompleteInstance.selectTag(t) });
      showToast('Лента перемешана');
    });
  }

  // Подвкладки Избранного
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

  // Управление мобильными шторками и сайдбаром
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

  // Десктопный переключатель размера колонок сетки
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
          showToast('Приложение Booru Explorer устанавливается! 🚀');
          if (pwaInstallGroup) pwaInstallGroup.style.display = 'none';
        }
        deferredInstallPrompt = null;
      } else {
        showToast('Для установки нажмите «На экран "Домой"» в меню браузера 📱');
      }
    });
  }

  // Регистрация Service Worker для PWA
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
          galleryInstance.renderGallery(false);
        }
      }
    });
  }

  // Закрытие модальных окон по Escape
  const settingsModal = document.getElementById('settingsModal');
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (settingsModal && settingsModal.style.display === 'flex') {
        closeSettingsModal();
      }
    }
  });
}

init();
