// Markup for the modalDiscoveredAliasesBackdrop dialog, injected on first use of the owning module.
// Kept out of index.html so the initial shell stays small; data-i18n
// attributes are translated right after injection.
import { applyStaticTranslations } from '../i18n.js';

const MARKUP = `
  <!-- Discovered Aliases Manager Modal -->
  <div class="modal-backdrop" id="modalDiscoveredAliasesBackdrop" style="display: none;">
    <div class="modal-dialog" style="max-width: 680px; max-height: 85vh; display: flex; flex-direction: column;" role="dialog" aria-modal="true" aria-label="Управление обнаруженными алиасами">
      <div class="modal-header">
        <div class="modal-title-wrap">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <h3 class="modal-title" data-i18n="aliasManager.title">Обнаруженные алиасы авторов</h3>
        </div>
        <button class="btn-icon btn-modal-close" id="btnCloseDiscoveredAliasesModal" title="Закрыть" data-i18n-title="modal.close.title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body" style="padding: 16px 20px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 14px;">
        <div style="display: flex; gap: 10px; align-items: center;">
          <input type="text" id="inputSearchDiscoveredAliases" class="form-input" style="flex: 1;" placeholder="Поиск по автору или тегу..." data-i18n-placeholder="aliasManager.searchPlaceholder" spellcheck="false">
          <button type="button" class="btn-secondary btn-sm" id="btnRefreshDiscoveredAliases" title="Обновить список" data-i18n-title="aliasManager.refresh">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
            <span data-i18n="aliasManager.refresh">Обновить</span>
          </button>
        </div>
        <div id="discoveredAliasesListContainer" style="display: flex; flex-direction: column; gap: 10px; min-height: 120px;">
          <!-- Dynamically populated rows -->
        </div>
      </div>
      <div class="modal-footer" style="padding: 12px 20px; border-top: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 12px; color: var(--text-muted);" id="discoveredAliasesTotalStatus">Загрузка...</span>
        <button type="button" class="btn-secondary" id="btnCloseDiscoveredAliasesModalFooter" data-i18n="modal.close">Закрыть</button>
      </div>
    </div>
  </div>
`;

export function ensureAliasManagerMarkup() {
  if (document.getElementById('modalDiscoveredAliasesBackdrop')) return;
  document.body.insertAdjacentHTML('beforeend', MARKUP);
  applyStaticTranslations(document);
}
