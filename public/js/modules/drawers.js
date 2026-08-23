const sidebarSearch = document.getElementById('sidebarSearch');
const categoriesSheet = document.getElementById('categoriesSheet');
const sourcesSheet = document.getElementById('sourcesSheet');
const drawerBackdrop = document.getElementById('drawerBackdrop');

let onCategoryUIUpdateCallback = null;
let onCloseSettingsModalCallback = null;

export function setDrawerCallbacks({ onCategoryUIUpdate, onCloseSettingsModal }) {
  if (onCategoryUIUpdate) onCategoryUIUpdateCallback = onCategoryUIUpdate;
  if (onCloseSettingsModal) onCloseSettingsModalCallback = onCloseSettingsModal;
}

export function openDrawer(drawerEl) {
  if (!drawerEl) return;
  const isOpen = drawerEl.classList.contains('open');
  closeAllDrawers();
  if (!isOpen) {
    drawerEl.classList.add('open');
    if (drawerBackdrop) drawerBackdrop.classList.add('active');

    // Highlight the matching tab in the bottom bar
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
  if (onCloseSettingsModalCallback) {
    onCloseSettingsModalCallback();
  }
  if (onCategoryUIUpdateCallback) {
    onCategoryUIUpdateCallback();
  }
}
