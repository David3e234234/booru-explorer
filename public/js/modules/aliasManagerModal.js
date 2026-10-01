/**
 * Discovered Aliases Manager Modal
 * Allows viewing, editing, deleting and banning auto-discovered author aliases.
 */
import {
  fetchDiscoveredAliasesList,
  updateDiscoveredAliasApi,
  deleteDiscoveredAliasApi,
  saveSettings
} from '../api.js';
import { state, saveLocalSettings } from '../state.js';
import { showToast, escapeHtml } from './uiUtils.js';
import { t } from '../i18n.js';
import { renderSettingsChips, updateDiscoveredAliasesUI, addIgnoredAliasTag } from './settingsModal.js';

let discoveredList = [];
let filteredList = [];
let searchQuery = '';

export function openDiscoveredAliasesModal() {
  const backdrop = document.getElementById('modalDiscoveredAliasesBackdrop');
  if (!backdrop) return;
  backdrop.style.display = 'flex';
  const searchInput = document.getElementById('inputSearchDiscoveredAliases');
  if (searchInput) {
    searchInput.value = '';
    searchQuery = '';
  }
  loadAndRenderDiscoveredAliases();
}

export function closeDiscoveredAliasesModal() {
  const backdrop = document.getElementById('modalDiscoveredAliasesBackdrop');
  if (!backdrop) return;
  backdrop.style.display = 'none';
  updateDiscoveredAliasesUI();
}

export async function loadAndRenderDiscoveredAliases() {
  const container = document.getElementById('discoveredAliasesListContainer');
  const statusEl = document.getElementById('discoveredAliasesTotalStatus');
  if (container) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 24px 0;">${escapeHtml(t('aliasManager.loading', 'Загрузка списка...'))}</div>`;
  }

  const res = await fetchDiscoveredAliasesList();
  if (res && res.success && Array.isArray(res.list)) {
    discoveredList = res.list;
  } else {
    discoveredList = [];
  }

  applyFilterAndRender();
}

function applyFilterAndRender() {
  const query = searchQuery.trim().toLowerCase();
  if (!query) {
    filteredList = [...discoveredList];
  } else {
    filteredList = discoveredList.filter(item => {
      if ((item.id || '').toLowerCase().includes(query)) return true;
      if (Array.isArray(item.aliases) && item.aliases.some(a => a.toLowerCase().includes(query))) return true;
      if (item.sites && Object.values(item.sites).some(s => String(s).toLowerCase().includes(query))) return true;
      return false;
    });
  }

  const statusEl = document.getElementById('discoveredAliasesTotalStatus');
  if (statusEl) {
    statusEl.textContent = t('aliasManager.total', 'Всего групп: {n}').replace('{n}', String(filteredList.length));
  }

  renderList();
}

function renderList() {
  const container = document.getElementById('discoveredAliasesListContainer');
  if (!container) return;

  if (filteredList.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 32px 0;">${escapeHtml(t('aliasManager.empty', 'Список обнаруженных алиасов пуст.'))}</div>`;
    return;
  }

  container.innerHTML = '';
  filteredList.forEach(entry => {
    const card = document.createElement('div');
    card.className = 'discovered-alias-card';
    card.style.cssText = 'background: var(--bg-surface-elevated); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 12px 14px; display: flex; flex-direction: column; gap: 8px;';

    const sitesStr = entry.sites ? Object.entries(entry.sites).map(([k, v]) => `${k}:${v}`).join(', ') : '';
    const aliasesList = Array.isArray(entry.aliases) ? entry.aliases : [];

    card.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
        <span style="font-weight: 600; color: var(--accent-primary); font-size: 14px;">${escapeHtml(entry.id)}</span>
        <div style="display: flex; gap: 6px;">
          <button type="button" class="btn-secondary btn-sm btn-edit-alias" style="padding: 3px 8px; font-size: 11px;">${escapeHtml(t('aliasManager.edit', 'Редактировать'))}</button>
          <button type="button" class="btn-danger btn-sm btn-delete-alias" style="padding: 3px 8px; font-size: 11px; background: none; border: 1px solid var(--border-subtle); color: var(--text-danger, #ef4444); cursor: pointer;">${escapeHtml(t('aliasManager.delete', 'Удалить'))}</button>
        </div>
      </div>
      <div class="alias-tags-chips" style="display: flex; flex-wrap: wrap; gap: 4px; align-items: center;">
        ${aliasesList.map(a => `
          <span class="tag-chip" style="font-size: 11px; padding: 2px 6px; display: inline-flex; align-items: center; gap: 4px;" data-tag="${escapeHtml(a)}">
            <span>${escapeHtml(a)}</span>
            <button type="button" class="btn-ban-tag" style="background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 0; line-height: 1;" title="${escapeHtml(t('aliasManager.banTag', 'Запретить тег'))}">⊘</button>
          </span>
        `).join('')}
      </div>
      ${sitesStr ? `<div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(sitesStr)}</div>` : ''}
      <div class="alias-edit-form" style="display: none; flex-direction: column; gap: 8px; margin-top: 6px; padding-top: 8px; border-top: 1px solid var(--border-subtle);">
        <label style="font-size: 11px; color: var(--text-secondary);">${escapeHtml(t('aliasManager.editAliasesLabel', 'Синонимы (через запятую):'))}</label>
        <input type="text" class="form-input input-edit-aliases" value="${escapeHtml(aliasesList.join(', '))}" style="font-size: 12px; padding: 4px 8px;">
        <div style="display: flex; justify-content: flex-end; gap: 6px;">
          <button type="button" class="btn-secondary btn-sm btn-cancel-edit">${escapeHtml(t('aliasManager.cancel', 'Отмена'))}</button>
          <button type="button" class="btn-primary btn-sm btn-save-edit">${escapeHtml(t('aliasManager.save', 'Сохранить'))}</button>
        </div>
      </div>
    `;

    // Edit button click
    const btnEdit = card.querySelector('.btn-edit-alias');
    const editForm = card.querySelector('.alias-edit-form');
    const btnCancelEdit = card.querySelector('.btn-cancel-edit');
    const btnSaveEdit = card.querySelector('.btn-save-edit');
    const inputEditAliases = card.querySelector('.input-edit-aliases');

    if (btnEdit && editForm) {
      btnEdit.addEventListener('click', () => {
        editForm.style.display = editForm.style.display === 'none' ? 'flex' : 'none';
        if (editForm.style.display === 'flex' && inputEditAliases) inputEditAliases.focus();
      });
    }

    if (btnCancelEdit && editForm) {
      btnCancelEdit.addEventListener('click', () => {
        editForm.style.display = 'none';
      });
    }

    if (btnSaveEdit && inputEditAliases) {
      btnSaveEdit.addEventListener('click', async () => {
        const rawText = inputEditAliases.value;
        const newAliases = rawText.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        btnSaveEdit.disabled = true;
        try {
          const res = await updateDiscoveredAliasApi(entry.id, {
            id: entry.id,
            aliases: newAliases,
            sites: entry.sites
          });
          if (res && res.success) {
            showToast(t('aliasManager.updated', 'Алиас обновлен'));
            await loadAndRenderDiscoveredAliases();
          } else {
            showToast(res.error || t('set.errorPrefix', 'Ошибка при обновлении'));
          }
        } finally {
          btnSaveEdit.disabled = false;
        }
      });
    }

    // Delete group
    const btnDelete = card.querySelector('.btn-delete-alias');
    if (btnDelete) {
      btnDelete.addEventListener('click', async () => {
        if (!confirm(t('aliasManager.deleteConfirm', 'Удалить обнаруженную группу для «{id}»?').replace('{id}', entry.id))) {
          return;
        }
        btnDelete.disabled = true;
        try {
          const res = await deleteDiscoveredAliasApi(entry.id);
          if (res && res.success) {
            showToast(t('aliasManager.deleted', 'Алиас удален'));
            await loadAndRenderDiscoveredAliases();
          } else {
            showToast(res.error || t('set.errorPrefix', 'Ошибка при удалении'));
          }
        } finally {
          btnDelete.disabled = false;
        }
      });
    }

    // Ban specific tag: add to ignoredAliases, remove from this group, update
    card.querySelectorAll('.btn-ban-tag').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const chip = btn.closest('.tag-chip');
        const tag = chip?.dataset.tag;
        if (!tag) return;

        // 1. Add to ignoredAliases in settings
        addIgnoredAliasTag(tag);

        // 2. Remove from this entry
        const updatedAliases = aliasesList.filter(a => a !== tag);
        await updateDiscoveredAliasApi(entry.id, {
          id: entry.id === tag && updatedAliases.length > 0 ? updatedAliases[0] : entry.id,
          aliases: updatedAliases,
          sites: entry.sites
        });

        showToast(t('aliasManager.tagBanned', 'Тег «{tag}» добавлен в список запрещённых').replace('{tag}', tag));
        await loadAndRenderDiscoveredAliases();
      });
    });

    container.appendChild(card);
  });
}

export function initDiscoveredAliasesModal() {
  const searchInput = document.getElementById('inputSearchDiscoveredAliases');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value;
      applyFilterAndRender();
    });
  }

  const btnRefresh = document.getElementById('btnRefreshDiscoveredAliases');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      loadAndRenderDiscoveredAliases();
    });
  }

  const btnClose = document.getElementById('btnCloseDiscoveredAliasesModal');
  if (btnClose) {
    btnClose.addEventListener('click', () => {
      closeDiscoveredAliasesModal();
    });
  }

  const btnCloseFooter = document.getElementById('btnCloseDiscoveredAliasesModalFooter');
  if (btnCloseFooter) {
    btnCloseFooter.addEventListener('click', () => {
      closeDiscoveredAliasesModal();
    });
  }

  const backdrop = document.getElementById('modalDiscoveredAliasesBackdrop');
  if (backdrop) {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        closeDiscoveredAliasesModal();
      }
    });
  }

  const btnManage = document.getElementById('btnManageDiscoveredAliases');
  if (btnManage) {
    btnManage.addEventListener('click', () => {
      openDiscoveredAliasesModal();
    });
  }
}
