import { state } from '../state.js';
import { 
  fetchNotifications, 
  markNotificationRead, 
  markAllNotificationsRead, 
  deleteNotificationApi, 
  clearNotificationsApi, 
  checkNotificationsApi,
  saveSettings
} from '../api.js';
import { t } from '../i18n.js';
import { showToast } from './uiUtils.js';

let activeFilter = 'all'; // 'all' | 'unread'
let isChecking = false;
let openPostCallback = null;
let switchTabCallback = null;
let previousUnreadIds = new Set();
let isFirstLoad = true;

/**
 * Format timestamp into human-readable relative time
 */
export function formatRelativeTime(isoString) {
  if (!isoString) return '';
  const now = Date.now();
  const date = new Date(isoString).getTime();
  if (isNaN(date)) return '';
  const diffSec = Math.max(0, Math.floor((now - date) / 1000));

  if (diffSec < 60) {
    return t('notifications.justNow', 'Только что');
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return t('notifications.minutesAgo', '{n} мин назад').replace('{n}', diffMin);
  }
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    return t('notifications.hoursAgo', '{n} ч назад').replace('{n}', diffHours);
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) {
    return t('notifications.yesterday', 'Вчера');
  }
  if (diffDays < 7) {
    return `${diffDays} дн назад`;
  }
  return new Date(date).toLocaleDateString();
}

/**
 * Updates the bell badge and header unread count
 */
export function updateNotificationsBadge() {
  const badge = document.getElementById('notificationsBadge');
  const unreadPill = document.getElementById('notificationsUnreadPill');
  const unreadCount = state.unreadNotificationsCount || 0;

  if (badge) {
    if (unreadCount > 0) {
      badge.style.display = 'inline-flex';
      badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
      badge.classList.add('has-unread');
    } else {
      badge.style.display = 'none';
      badge.textContent = '0';
      badge.classList.remove('has-unread');
    }
  }

  if (unreadPill) {
    if (unreadCount > 0) {
      unreadPill.style.display = 'inline-flex';
      unreadPill.textContent = `${unreadCount} ${t('notifications.unread', 'непрочитанных')}`;
    } else {
      unreadPill.style.display = 'none';
    }
  }
}

/**
 * Renders the notification items inside the dropdown
 */
export function renderNotificationsList() {
  const container = document.getElementById('notificationsList');
  if (!container) return;

  const allNotifications = Array.isArray(state.notifications) ? state.notifications : [];
  const filtered = activeFilter === 'unread'
    ? allNotifications.filter(n => !n.read)
    : allNotifications;

  if (filtered.length === 0) {
    const isUnreadFilter = activeFilter === 'unread';
    container.innerHTML = `
      <div class="notifications-empty">
        <div class="notifications-empty-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
        </div>
        <div class="notifications-empty-title">
          ${isUnreadFilter ? t('notifications.emptyUnread', 'Нет непрочитанных уведомлений') : t('notifications.emptyTitle', 'Нет новых уведомлений')}
        </div>
        <div class="notifications-empty-desc">
          ${t('notifications.emptyDesc', 'Новые работы отслеживаемых авторов появятся здесь.')}
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(item => {
    const author = item.author || {};
    const post = item.post || {};
    const authorName = author.displayName || author.name || t('viewer.authorNotSpecified', 'Автор');
    const isUnread = !item.read;
    const timeStr = formatRelativeTime(item.createdAt);

    const thumbUrl = post.thumb180 || post.previewUrl || post.thumb360 || author.previewUrl || '';
    const avatarUrl = author.previewUrl || thumbUrl;

    const postSubtitle = post.site ? `${post.site} • ${post.rating ? post.rating.toUpperCase() : 'POST'}` : 'Новая публикация';

    return `
      <div class="notification-item ${isUnread ? 'unread' : ''}" data-id="${item.id}" role="button" tabindex="0">
        <div class="notif-avatar-col">
          ${avatarUrl ? `
            <img src="${avatarUrl}" alt="${authorName}" class="notif-avatar-img" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
            <div class="notif-avatar-placeholder" style="display: none;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/></svg>
            </div>
          ` : `
            <div class="notif-avatar-placeholder">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/></svg>
            </div>
          `}
        </div>

        <div class="notif-content-col">
          <div class="notif-header-line">
            <span class="notif-author-title">${authorName}</span>
            ${isUnread ? '<span class="notif-dot" title="Не прочитано"></span>' : ''}
          </div>
          <div class="notif-desc-line">${t('notifications.newPostFrom', 'Новый пост').replace('{name}', authorName)} • <span class="notif-site-badge">${postSubtitle}</span></div>
          <div class="notif-time-line">${timeStr}</div>
        </div>

        ${thumbUrl ? `
          <div class="notif-thumb-col">
            <img src="${thumbUrl}" alt="Post thumbnail" class="notif-post-thumb" loading="lazy">
          </div>
        ` : ''}

        <button type="button" class="notif-btn-dismiss" data-delete-id="${item.id}" title="${t('modal.close', 'Удалить')}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    `;
  }).join('');

  // Bind clicks on notification cards
  container.querySelectorAll('.notification-item').forEach(el => {
    el.addEventListener('click', (e) => {
      // If clicking delete button, don't open post
      if (e.target.closest('.notif-btn-dismiss')) return;

      const id = el.dataset.id;
      const notif = allNotifications.find(n => n.id === id);
      if (!notif) return;

      // Mark as read
      if (!notif.read) {
        notif.read = true;
        state.unreadNotificationsCount = Math.max(0, (state.unreadNotificationsCount || 1) - 1);
        updateNotificationsBadge();
        markNotificationRead(id).catch(() => {});
      }

      // Close dropdown
      closeNotificationsDropdown();

      // Open post directly
      if (openPostCallback && notif.post) {
        openPostCallback(notif.post);
      }
    });

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        el.click();
      }
    });
  });

  // Bind dismiss/delete buttons
  container.querySelectorAll('.notif-btn-dismiss').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.deleteId;
      if (!id) return;

      const idx = state.notifications.findIndex(n => n.id === id);
      if (idx !== -1) {
        const [removed] = state.notifications.splice(idx, 1);
        if (removed && !removed.read) {
          state.unreadNotificationsCount = Math.max(0, (state.unreadNotificationsCount || 1) - 1);
        }
        updateNotificationsBadge();
        renderNotificationsList();
        deleteNotificationApi(id).catch(() => {});
      }
    });
  });
}

/**
 * Fetch notifications from server and update state
 */
export async function loadNotifications({ silent = false } = {}) {
  try {
    const data = await fetchNotifications();
    if (data && data.success && Array.isArray(data.notifications)) {
      state.notifications = data.notifications;
      state.unreadNotificationsCount = typeof data.unreadCount === 'number' 
        ? data.unreadCount 
        : data.notifications.filter(n => !n.read).length;

      updateNotificationsBadge();

      // Trigger live in-app toast if new unread notifications arrived while viewing
      const currentUnread = data.notifications.filter(n => !n.read);
      if (!isFirstLoad && currentUnread.length > 0) {
        const newlyArrived = currentUnread.filter(n => !previousUnreadIds.has(n.id));
        if (newlyArrived.length > 0) {
          const first = newlyArrived[0];
          const authorName = first.author?.displayName || first.author?.name || 'Автор';
          showLiveNotificationToast(first, authorName);
        }
      }

      previousUnreadIds = new Set(currentUnread.map(n => n.id));
      isFirstLoad = false;

      const dropdown = document.getElementById('notificationsDropdown');
      if (dropdown && dropdown.style.display !== 'none') {
        renderNotificationsList();
      }
    }
  } catch (err) {
    if (!silent) {
      console.warn('[Notifications] Ошибка загрузки уведомлений:', err);
    }
  }
}

/**
 * Show rich interactive live toast when new work is posted while on the site
 */
function showLiveNotificationToast(notif, authorName) {
  const toastMsg = `${t('notifications.newPostFrom', 'Новый пост от {name}').replace('{name}', authorName)}`;
  showToast(toastMsg, {
    actionText: t('notifications.viewPost', 'Смотреть'),
    onAction: () => {
      if (!notif.read) {
        notif.read = true;
        state.unreadNotificationsCount = Math.max(0, (state.unreadNotificationsCount || 1) - 1);
        updateNotificationsBadge();
        markNotificationRead(notif.id).catch(() => {});
      }
      if (openPostCallback && notif.post) {
        openPostCallback(notif.post);
      }
    }
  });
}

/**
 * Trigger manual author check
 */
export async function triggerManualCheck() {
  if (isChecking) return;
  isChecking = true;

  const btnCheck = document.getElementById('btnCheckNotifications');
  const btnSettingsCheck = document.getElementById('btnSettingsCheckNotifications');

  if (btnCheck) btnCheck.classList.add('is-spinning');
  if (btnSettingsCheck) {
    btnSettingsCheck.classList.add('is-spinning');
    btnSettingsCheck.disabled = true;
  }

  showToast(t('notifications.checking', 'Проверяю обновления авторов...'));

  try {
    const authors = Array.isArray(state.favoriteAuthors) && state.favoriteAuthors.length > 0 
      ? state.favoriteAuthors 
      : null;

    const res = await checkNotificationsApi(authors);
    if (res && res.success) {
      if (Array.isArray(res.notifications)) {
        state.notifications = res.notifications;
      }
      state.unreadNotificationsCount = typeof res.unreadCount === 'number'
        ? res.unreadCount
        : (state.notifications || []).filter(n => !n.read).length;

      updateNotificationsBadge();
      renderNotificationsList();

      const newCount = res.newCount || 0;
      if (newCount > 0) {
        showToast(t('notifications.checkSuccess', 'Найдено {n} новых публикаций!').replace('{n}', newCount));
      } else {
        showToast(t('notifications.checkNone', 'Новых публикаций не найдено'));
      }
    } else {
      showToast(res?.message || t('notifications.checkError', 'Не удалось проверить обновления'));
    }
  } catch (err) {
    showToast(t('notifications.checkError', 'Не удалось проверить обновления'));
  } finally {
    isChecking = false;
    if (btnCheck) btnCheck.classList.remove('is-spinning');
    if (btnSettingsCheck) {
      btnSettingsCheck.classList.remove('is-spinning');
      btnSettingsCheck.disabled = false;
    }
  }
}

/**
 * Open / close dropdown
 */
export function toggleNotificationsDropdown() {
  const dropdown = document.getElementById('notificationsDropdown');
  const btn = document.getElementById('btnNotifications');
  if (!dropdown) return;

  const isOpen = dropdown.style.display !== 'none';
  if (isOpen) {
    closeNotificationsDropdown();
  } else {
    openNotificationsDropdown();
  }
}

export function openNotificationsDropdown() {
  const dropdown = document.getElementById('notificationsDropdown');
  const btn = document.getElementById('btnNotifications');
  if (!dropdown) return;

  dropdown.style.display = 'flex';
  if (btn) {
    btn.classList.add('active');
    btn.setAttribute('aria-expanded', 'true');
  }

  renderNotificationsList();
}

export function closeNotificationsDropdown() {
  const dropdown = document.getElementById('notificationsDropdown');
  const btn = document.getElementById('btnNotifications');
  if (!dropdown) return;

  dropdown.style.display = 'none';
  if (btn) {
    btn.classList.remove('active');
    btn.setAttribute('aria-expanded', 'false');
  }
}

/**
 * Initialize notification system
 */
export function initNotifications({ onOpenPost, onSwitchToFollowing } = {}) {
  openPostCallback = onOpenPost;
  switchTabCallback = onSwitchToFollowing;

  const btnNotifications = document.getElementById('btnNotifications');
  const dropdown = document.getElementById('notificationsDropdown');
  const wrapper = document.getElementById('notificationsWrapper');
  const btnCheck = document.getElementById('btnCheckNotifications');
  const btnMarkAll = document.getElementById('btnMarkAllRead');
  const btnClearAll = document.getElementById('btnClearAllNotifications');
  const btnOpenFollowing = document.getElementById('btnOpenFollowingFeed');
  const tabAll = document.getElementById('notifTabAll');
  const tabUnread = document.getElementById('notifTabUnread');

  // Bell click
  if (btnNotifications) {
    btnNotifications.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleNotificationsDropdown();
    });
  }

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (wrapper && !wrapper.contains(e.target)) {
      closeNotificationsDropdown();
    }
  });

  // Close on Escape
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dropdown && dropdown.style.display !== 'none') {
      closeNotificationsDropdown();
    }
  });

  // Check button
  if (btnCheck) {
    btnCheck.addEventListener('click', (e) => {
      e.stopPropagation();
      triggerManualCheck();
    });
  }

  // Mark all read button
  if (btnMarkAll) {
    btnMarkAll.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!state.notifications || state.notifications.length === 0) return;
      state.notifications.forEach(n => { n.read = true; });
      state.unreadNotificationsCount = 0;
      updateNotificationsBadge();
      renderNotificationsList();
      await markAllNotificationsRead().catch(() => {});
    });
  }

  // Clear all button
  if (btnClearAll) {
    btnClearAll.addEventListener('click', async (e) => {
      e.stopPropagation();
      state.notifications = [];
      state.unreadNotificationsCount = 0;
      updateNotificationsBadge();
      renderNotificationsList();
      await clearNotificationsApi().catch(() => {});
    });
  }

  // Switch to following feed
  if (btnOpenFollowing) {
    btnOpenFollowing.addEventListener('click', (e) => {
      e.stopPropagation();
      closeNotificationsDropdown();
      if (switchTabCallback) {
        switchTabCallback('following');
      }
    });
  }

  // Tabs (All vs Unread)
  if (tabAll && tabUnread) {
    tabAll.addEventListener('click', () => {
      activeFilter = 'all';
      tabAll.classList.add('active');
      tabUnread.classList.remove('active');
      renderNotificationsList();
    });

    tabUnread.addEventListener('click', () => {
      activeFilter = 'unread';
      tabUnread.classList.add('active');
      tabAll.classList.remove('active');
      renderNotificationsList();
    });
  }

  // Settings bindings
  const checkEnabled = document.getElementById('checkNotificationsEnabled');
  const selectInterval = document.getElementById('selectNotificationsInterval');
  const btnSettingsCheck = document.getElementById('btnSettingsCheckNotifications');

  if (checkEnabled) {
    checkEnabled.checked = state.settings?.notificationsEnabled !== false;
    checkEnabled.addEventListener('change', () => {
      state.settings.notificationsEnabled = checkEnabled.checked;
      saveSettings(state.settings).catch(() => {});
    });
  }

  if (selectInterval) {
    if (state.settings?.notificationsInterval) {
      selectInterval.value = String(state.settings.notificationsInterval);
    }
    selectInterval.addEventListener('change', () => {
      state.settings.notificationsInterval = Number(selectInterval.value) || 15;
      saveSettings(state.settings).catch(() => {});
    });
  }

  if (btnSettingsCheck) {
    btnSettingsCheck.addEventListener('click', () => {
      triggerManualCheck();
    });
  }

  // Initial load
  loadNotifications({ silent: true });

  // Periodic poll every 60 seconds
  setInterval(() => {
    loadNotifications({ silent: true });
  }, 60 * 1000);

  // Poll when user switches back to this tab
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadNotifications({ silent: true });
    }
  });
}
