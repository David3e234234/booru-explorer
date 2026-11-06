// Static-page event wiring: category tabs, site and filter controls, grid
// preferences, keyboard shortcuts, scroll buttons, PWA install prompt and
// service-worker registration. Actions owned by app.js arrive via deps.
import { state, saveLocalSettings, invalidateInterestCache } from '../state.js';
import { persistSettings } from './settingsPersist.js';
import {
  ensureFeed,
  ensureViewer,
  whenViewerLoaded,
  getGalleryInstance,
  getAutocompleteInstance,
  openSettingsModal,
  closeSettingsModal
} from './lazyLoader.js';
import { ensurePawchiveServiceOptions, ensureKemonoServiceOptions } from './serviceOptions.js';
import { performSearch } from '../search/searchEngine.js';
import {
  updateCategoryTabsUI,
  updateSiteCapabilitiesUI,
  updatePostSortUI,
  updateVideoSortUI,
  updateTypeFilterUI,
  updateAgeFilterUI,
  updateRatingFilterUI,
  updateAiFilterUI,
  updatePawchiveServiceUI,
  updateKemonoServiceUI,
  updateFilterActiveDot
} from './filtersUI.js';
import { renderSitesBar, renderMobileSourcesSheet, updateCurrentSiteLabel } from './navigationUI.js';
import { renderSidebarPageTags } from './sidebarTags.js';
import { closeAllDrawers, openDrawer } from './drawers.js';
import { showToast, haptic } from './uiUtils.js';
import { switchFavoritesSubTab } from './favoriteAuthorsUI.js';
import { initNotifications } from './notificationsUI.js';
import { t } from '../i18n.js';

// app.js-owned actions, wired at boot
let deps = {
  selectCategory: () => {},
  selectSite: () => {},
  renderFavoriteAuthors: () => {},
  openPostOverlay: () => {}
};

export function initEventBindings(d) {
  deps = { ...deps, ...d };
}

export function setupEventListeners() {
  const galleryInstance = getGalleryInstance();
  const autocompleteInstance = getAutocompleteInstance();

  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const cat = tab.dataset.category;
      if (cat) deps.selectCategory(cat);
    });
  });

  // Post sorting (new / views / top)
  document.querySelectorAll('.sort-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const sort = pill.dataset.sort;
      if (state.postSort === sort) return;
      state.postSort = sort;
      updatePostSortUI();
      persistSettings({ postSort: sort });
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
    });
  });



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

  // Kemono platform dropdown (only visible for the Kemono source)
  const kemonoServiceDropdown = document.getElementById('kemonoServiceDropdown');
  const btnKemonoServiceToggle = document.getElementById('btnKemonoServiceToggle');
  if (btnKemonoServiceToggle && kemonoServiceDropdown) {
    btnKemonoServiceToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      ensureKemonoServiceOptions();
      const isOpen = kemonoServiceDropdown.classList.toggle('open');
      btnKemonoServiceToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    // Items are populated lazily, so clicks are delegated on the menu
    const kemonoServiceMenu = document.getElementById('kemonoServiceMenu');
    if (kemonoServiceMenu) {
      kemonoServiceMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.dropdown-item');
        if (!item) return;
        e.stopPropagation();
        const serviceVal = item.dataset.service || 'all';
        if (state.kemonoService === serviceVal) {
          kemonoServiceDropdown.classList.remove('open');
          btnKemonoServiceToggle.setAttribute('aria-expanded', 'false');
          return;
        }
        state.kemonoService = serviceVal;
        updateKemonoServiceUI();
        persistSettings({ kemonoService: serviceVal });
        kemonoServiceDropdown.classList.remove('open');
        btnKemonoServiceToggle.setAttribute('aria-expanded', 'false');
      });
    }

    document.addEventListener('click', (e) => {
      if (!kemonoServiceDropdown.contains(e.target)) {
        kemonoServiceDropdown.classList.remove('open');
        btnKemonoServiceToggle.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && kemonoServiceDropdown.classList.contains('open')) {
        kemonoServiceDropdown.classList.remove('open');
        btnKemonoServiceToggle.setAttribute('aria-expanded', 'false');
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

  // Logo - click resets search tags and all sliders/filters to defaults
  const btnLogo = document.getElementById('btnLogo');
  if (btnLogo) {
    btnLogo.addEventListener('click', () => {
      whenViewerLoaded((v) => v.closeViewer({ skipHistoryBack: true }));

      // 1. Clear search tags and input
      if (autocompleteInstance?.clear) {
        autocompleteInstance.clear();
      } else {
        state.searchTags = [];
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = '';
        const btnClearSearch = document.getElementById('btnClearSearch');
        if (btnClearSearch) btnClearSearch.style.display = 'none';
        autocompleteInstance?.renderTagsChips?.();
      }

      // 2. Reset category (keep currently selected site)
      state.currentCategory = 'feed';

      // 3. Reset toggle sliders (content hiding) to defaults
      state.hideFurry = true;
      state.hidePregnant = true;
      state.hideLgbt = true;
      const checkHideFurry = document.getElementById('checkHideFurry');
      if (checkHideFurry) checkHideFurry.checked = true;
      const checkHidePregnant = document.getElementById('checkHidePregnant');
      if (checkHidePregnant) checkHidePregnant.checked = true;
      const checkHideLgbt = document.getElementById('checkHideLgbt');
      if (checkHideLgbt) checkHideLgbt.checked = true;

      // 4. Reset other filters and sorts to defaults
      state.postSort = 'new';
      state.aiFilter = 'no-ai';
      state.ratingFilter = 'all';
      state.typeFilter = 'all';
      state.ageFilter = 'all';
      state.videoDurationSort = 'none';
      state.pawchiveService = 'all';
      state.kemonoService = 'all';

      // 5. Update UI controls
      updateCategoryTabsUI();
      updateSiteCapabilitiesUI(state.currentSite);
      updateCurrentSiteLabel();
      renderSitesBar({ onSelectSite: deps.selectSite });
      renderMobileSourcesSheet({ onSelectSite: deps.selectSite });
      if (state.currentSite === 'pawchive') ensurePawchiveServiceOptions();
      if (state.currentSite === 'kemono') ensureKemonoServiceOptions();
      updatePostSortUI();
      updateAiFilterUI();
      updateRatingFilterUI();
      updateTypeFilterUI();
      updateAgeFilterUI();
      updateVideoSortUI();
      updatePawchiveServiceUI();
      updateKemonoServiceUI();
      updateFilterActiveDot();

      // 6. Persist reset filter settings
      persistSettings({
        hideFurry: true,
        hidePregnant: true,
        hideLgbt: true,
        postSort: 'new',
        aiFilter: 'no-ai',
        ratingFilter: 'all',
        typeFilter: 'all',
        ageFilter: 'all',
        pawchiveService: 'all',
        kemonoService: 'all'
      });

      // 7. Close drawers, scroll to top, and trigger clean search
      closeAllDrawers();
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
        const result = await performSearch(true, { bustCache: true });
        if (result?.success) {
          showToast(t('app.searchRefreshed', 'Поиск обновлен'));
        } else if (!result?.superseded) {
          showToast(t('app.searchRefreshFailed', 'Ошибка при обновлении поиска'), 'error');
        }
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
      invalidateInterestCache();
      recFocusButtons.forEach(b => b.classList.toggle('active', b === btn));
      performSearch(true, { bustCache: false, showLoading: true });
    });
  });

  // Favorites sub-tabs
  const btnFavSubPosts = document.getElementById('btnFavSubPosts');
  const btnFavSubAuthors = document.getElementById('btnFavSubAuthors');
  const favAuthorsSearchInput = document.getElementById('favAuthorsSearchInput');

  if (btnFavSubPosts) {
    btnFavSubPosts.addEventListener('click', () => {
      haptic(10);
      switchFavoritesSubTab('posts', { onSearch: performSearch, onRenderAuthors: deps.renderFavoriteAuthors });
    });
  }

  if (btnFavSubAuthors) {
    btnFavSubAuthors.addEventListener('click', () => {
      haptic(10);
      switchFavoritesSubTab('authors', { onSearch: performSearch, onRenderAuthors: deps.renderFavoriteAuthors });
    });
  }

  if (favAuthorsSearchInput) {
    favAuthorsSearchInput.addEventListener('input', () => {
      deps.renderFavoriteAuthors();
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
      deps.selectCategory('favorites');
    });
  }

  if (btnNavProfile) {
    btnNavProfile.addEventListener('click', () => {
      haptic(15);
      closeAllDrawers();
      deps.selectCategory('profile');
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
        deps.selectCategory(cat);
        closeAllDrawers();
      }
    });
  });

  // Phone feed entry: opens the current results as a fullscreen feed.
  const btnMobileFeedMode = document.getElementById('btnMobileFeedMode');
  if (btnMobileFeedMode) {
    btnMobileFeedMode.addEventListener('click', () => {
      haptic(15);
      const list = (state.displayedPosts && state.displayedPosts.length > 0) ? state.displayedPosts : state.posts;
      if (!Array.isArray(list) || list.length === 0) {
        showToast(t('feed.empty.title', 'Здесь пока пусто'));
        openDrawer(document.getElementById('sidebarSearch'));
        return;
      }
      ensureFeed().then((f) => f.openFeed(0)).catch(() => {});
    });
  }

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

  // Quality selects live in the lazily injected settings markup, so bind via
  // change delegation instead of at init time
  document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'selectPreviewQuality') {
      state.settings.previewQuality = e.target.value;
      const galleryInstance = getGalleryInstance();
      if (galleryInstance) {
        if ((state.currentCategory === 'favorites' && state.favoritesSubTab === 'authors') ||
            (state.currentCategory === 'profile' && state.profileSubTab === 'authors')) {
          deps.renderFavoriteAuthors();
        } else {
          galleryInstance.renderGallery(false, { preserveScroll: true });
        }
      }
    } else if (e.target && e.target.id === 'selectVideoDefaultQuality') {
      state.settings.videoDefaultQuality = e.target.value;
    }
  });

  // In-app notifications subsystem
  initNotifications({
    onOpenPost: (post, opts = {}) => {
      deps.openPostOverlay(-1, { directPost: post, initialAlbumIndex: opts?.initialAlbumIndex ?? 0, forceViewer: opts?.forceViewer });
    },
    onSwitchToFollowing: () => {
      state.currentCategory = 'following';
      updateCategoryTabsUI();
      performSearch(true);
    }
  });

  // Close modals on Escape
  const settingsModal = document.getElementById('settingsModal');
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (settingsModal && settingsModal.style.display === 'flex') {
        closeSettingsModal();
      }
    }
  });
}
