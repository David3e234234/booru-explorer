import { state } from '../state.js';
import {
  fetchSubscriptions,
  createSubscription,
  deleteSubscription,
  checkSubscription,
  markSubscriptionSeen,
  sendTestPush
} from '../api.js';
import { showToast, haptic } from './uiUtils.js';
import { enablePushNotifications, disablePushNotifications, getActivePushSubscription } from './pushManager.js';

export function initSubscriptionsUI({ onRunSearch }) {
  const pane = document.getElementById('profileSearchesPane');
  const listEl = document.getElementById('subscriptionsList');
  const queryInput = document.getElementById('subscriptionQueryInput');
  const siteSelect = document.getElementById('subscriptionSiteSelect');
  const btnSaveCurrent = document.getElementById('btnSaveCurrentSearch');
  const btnCreate = document.getElementById('btnCreateSubscription');
  const btnPush = document.getElementById('btnTogglePushNotifications');
  const tabBtn = document.getElementById('btnProfileTabSearches');

  if (siteSelect) {
    siteSelect.innerHTML = [
      '<option value="all">Все сайты</option>',
      ...state.sites.map(s => `<option value="${s.id}">${s.name}</option>`)
    ].join('');
  }

  function formatCheckedAt(iso) {
    if (!iso) return 'еще не проверялась';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return `проверено в ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
    } catch {
      return '';
    }
  }

  function unreadCount(sub) {
    return Array.isArray(sub.newIds) ? sub.newIds.length : (sub.newCount || 0);
  }

  function totalUnread() {
    return state.subscriptions.reduce((sum, s) => sum + unreadCount(s), 0);
  }

  function refreshBadge() {
    if (!tabBtn) return;
    let badge = tabBtn.querySelector('.profile-tab-badge');
    const count = totalUnread();
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'profile-tab-badge';
        tabBtn.appendChild(badge);
      }
      badge.textContent = String(count);
    } else if (badge) {
      badge.remove();
    }
  }

  function render() {
    refreshBadge();
    if (!listEl) return;

    if (!state.subscriptions || state.subscriptions.length === 0) {
      listEl.innerHTML = `
        <div class="subscriptions-empty">
          <span>Пока нет сохраненных поисков. Введите теги выше или сохраните текущий запрос одной кнопкой.</span>
        </div>
      `;
      return;
    }

    listEl.innerHTML = state.subscriptions.map(sub => {
      const siteObj = state.sites.find(s => s.id === sub.site);
      const siteLabel = sub.site === 'all' ? 'Все сайты' : (siteObj ? siteObj.name : sub.site);
      const fresh = unreadCount(sub);
      return `
        <div class="subscription-item" data-id="${sub.id}">
          <div class="subscription-main">
            ${fresh > 0 ? `<span class="subscription-badge" title="Новых постов">${fresh}</span>` : ''}
            <span class="subscription-query" title="${sub.query}">${sub.query}</span>
            <span class="subscription-site">${siteLabel}</span>
          </div>
          <div class="subscription-meta">
            <span>${formatCheckedAt(sub.lastCheckedAt)}</span>
          </div>
          <div class="subscription-actions">
            <button type="button" class="btn-sub-action" data-action="open" title="Открыть выдачу">Открыть</button>
            <button type="button" class="btn-sub-action" data-action="check" title="Проверить новые посты сейчас">Проверить</button>
            <button type="button" class="btn-sub-icon" data-action="delete" title="Удалить подписку">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  async function load() {
    try {
      const res = await fetchSubscriptions();
      state.subscriptions = Array.isArray(res.subscriptions) ? res.subscriptions : [];
    } catch {
      state.subscriptions = [];
    }
    render();
    updatePushButton();
  }

  function updatePushButton() {
    if (!btnPush) return;
    getActivePushSubscription().then(active => {
      btnPush.classList.toggle('active', Boolean(active));
      btnPush.setAttribute('title', active ? 'Push-уведомления включены (нажмите, чтобы отключить)' : 'Включить push-уведомления о новых постах');
    });
  }

  async function create(queryOverride) {
    const rawQuery = queryOverride !== undefined ? queryOverride : (queryInput ? queryInput.value : '');
    const query = String(rawQuery || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!query) {
      showToast('Введите поисковый запрос');
      return;
    }
    const site = siteSelect ? siteSelect.value : 'all';

    try {
      const res = await createSubscription(query, site);
      if (!res.success) {
        showToast(res.message || 'Не удалось сохранить поиск');
        return;
      }
      if (res.subscription) {
        state.subscriptions.unshift(res.subscription);
      } else {
        await load();
      }
      render();
      if (queryInput) queryInput.value = '';
      haptic(15);
      showToast(`Подписка «${query}» сохранена`);
    } catch {
      showToast('Ошибка соединения с сервером');
    }
  }

  if (btnCreate) {
    btnCreate.addEventListener('click', () => create());
  }
  if (queryInput) {
    queryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') create();
    });
  }
  if (btnSaveCurrent) {
    btnSaveCurrent.addEventListener('click', () => {
      const currentQuery = [...state.searchTags].join(' ');
      if (!currentQuery.trim()) {
        showToast('Сначала задайте теги в строке поиска');
        return;
      }
      create(currentQuery);
    });
  }

  if (btnPush) {
    btnPush.addEventListener('click', async () => {
      haptic(15);
      const active = await getActivePushSubscription();
      if (active) {
        const res = await disablePushNotifications();
        if (res.ok) showToast('Уведомления отключены');
      } else {
        const res = await enablePushNotifications();
        if (res.ok) {
          showToast('Уведомления о новых постах включены');
          sendTestPush().catch(() => {});
        } else {
          showToast(res.reason || 'Не удалось включить уведомления');
        }
      }
      updatePushButton();
    });
  }

  if (listEl) {
    listEl.addEventListener('click', async (e) => {
      const item = e.target.closest('.subscription-item');
      if (!item) return;
      const subId = item.dataset.id;
      const sub = state.subscriptions.find(s => s.id === subId);
      if (!sub) return;

      const actionBtn = e.target.closest('[data-action]');
      if (!actionBtn) return;
      const action = actionBtn.dataset.action;

      if (action === 'open') {
        haptic(15);
        if (unreadCount(sub) > 0) {
          markSubscriptionSeen(subId).then(() => {
            sub.newIds = [];
            render();
          }).catch(() => {});
        }
        if (typeof onRunSearch === 'function') onRunSearch(sub);

      } else if (action === 'check') {
        actionBtn.disabled = true;
        actionBtn.textContent = '...';
        try {
          const res = await checkSubscription(subId);
          if (res.success && res.subscription) {
            const idx = state.subscriptions.findIndex(s => s.id === subId);
            if (idx !== -1) state.subscriptions[idx] = res.subscription;
            const fresh = unreadCount(res.subscription);
            showToast(fresh > 0 ? `Новых постов: ${fresh}` : 'Новых постов нет');
          } else {
            showToast(res.message || 'Ошибка проверки');
          }
        } catch {
          showToast('Ошибка соединения');
        }
        render();

      } else if (action === 'delete') {
        haptic([10, 20]);
        try {
          await deleteSubscription(subId);
          state.subscriptions = state.subscriptions.filter(s => s.id !== subId);
          render();
          showToast('Подписка удалена');
        } catch {
          showToast('Не удалось удалить подписку');
        }
      }
    });
  }

  render();

  return {
    load,
    render,
    refreshBadge
  };
}
