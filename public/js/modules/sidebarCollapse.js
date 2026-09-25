import { loadSidebarCollapsed, saveSidebarCollapsed } from '../state.js';
import { t } from '../i18n.js';

const COLLAPSE_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>';
const EXPAND_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg>';

// Typing in a field must not trigger the shortcut.
function isTypingTarget(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return !!target.isContentEditable;
}

/**
 * Desktop-only collapse for the search/filters sidebar.
 *
 * The panel slides out on `margin-left` rather than `width` so its blocks keep
 * their width during the transition instead of re-wrapping, and the gallery
 * picks up the freed space through the ResizeObserver in gallery.js.
 * Below 801px the panel is the mobile drawer, so this class stays inert there.
 */
export function initSidebarCollapse() {
  const appLayout = document.querySelector('.app-layout');
  const sidebar = document.getElementById('sidebarSearch');
  const toggleBtn = document.getElementById('btnToggleSidebar');
  if (!appLayout || !sidebar || !toggleBtn) return;

  const isCollapsed = () => appLayout.classList.contains('sidebar-collapsed');

  function apply(collapsed) {
    appLayout.classList.toggle('sidebar-collapsed', collapsed);
    toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggleBtn.setAttribute('aria-label', collapsed
      ? t('sidebar.expand', 'Развернуть панель поиска и фильтров')
      : t('sidebar.collapse', 'Свернуть панель поиска и фильтров'));
    toggleBtn.title = collapsed
      ? t('sidebar.expand', 'Развернуть панель поиска и фильтров')
      : t('sidebar.collapse', 'Свернуть панель поиска и фильтров');
    // A hidden panel must not keep keyboard focus or expose its controls to a
    // screen reader, so the icon swap is the only thing that stays visible.
    toggleBtn.innerHTML = collapsed ? EXPAND_ICON : COLLAPSE_ICON;
  }

  function setCollapsed(collapsed) {
    // A control inside a panel that is about to become visibility:hidden would
    // keep focus and the tab position on an invisible element, so hand the
    // focus to the toggle that performed the action.
    if (collapsed && sidebar.contains(document.activeElement)) {
      toggleBtn.focus();
    }
    apply(collapsed);
    saveSidebarCollapsed(collapsed);
  }

  apply(loadSidebarCollapsed());

  toggleBtn.addEventListener('click', () => {
    setCollapsed(!isCollapsed());
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'b' && e.key !== 'B') return;
    if (!e.ctrlKey || e.altKey || e.metaKey) return;
    if (isTypingTarget(e.target)) return;
    e.preventDefault();
    setCollapsed(!isCollapsed());
  });

  // The title is rebuilt from t(), so a language switch has to re-apply it.
  document.addEventListener('booru:langchange', () => {
    apply(isCollapsed());
  });
}
