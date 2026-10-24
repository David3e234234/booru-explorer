import { state, clearLocalAuth, clearViewHistory, getUserInterestTags, excludeInterestTag, restoreInterestTag, resetExcludedInterestTags, saveLocalSettings, clearDislikesLocally } from '../state.js';
import { markAuthHeadersDirty, shouldProxyMedia, getProxiedUrl } from '../api.js';
import { apiLogout, saveSettings, clearDislikesApi } from '../api.js';
import { showToast, escapeHtml, toSafeImageUrl } from './uiUtils.js';
import { t } from '../i18n.js';

export function initProfileUI({ onOpenAuth, onTabChange, onReloadState, onOpenHistoryPost }) {
  const profileSection = document.getElementById('userProfileSection');
  const profileUsername = document.getElementById('profileUsername');
  const profileBadgeStatus = document.getElementById('profileBadgeStatus');
  const profileJoinedDate = document.getElementById('profileJoinedDate');
  const profileAvatar = document.getElementById('profileAvatar');
  const profileHeaderActions = document.getElementById('profileHeaderActions');

  const btnTabLikes = document.getElementById('btnProfileTabLikes');
  const btnTabFavs = document.getElementById('btnProfileTabFavs');
  const btnTabAuthors = document.getElementById('btnProfileTabAuthors');
  const btnTabAnalytics = document.getElementById('btnProfileTabAnalytics');
  const analyticsPane = document.getElementById('profileAnalyticsPane');
  const btnEditInterests = document.getElementById('btnEditInterests');

  const statLikesEl = document.getElementById('profileStatLikes');
  const statFavsEl = document.getElementById('profileStatFavs');
  const statAuthorsEl = document.getElementById('profileStatAuthors');
  const statViewsEl = document.getElementById('profileStatViews');
  const historyGrid = document.getElementById('profileViewHistoryGrid');
  const btnClearHistory = document.getElementById('btnClearViewHistory');

  let isEditingInterests = false;

  btnEditInterests?.addEventListener('click', () => {
    isEditingInterests = !isEditingInterests;
    btnEditInterests.classList.toggle('active', isEditingInterests);
    btnEditInterests.setAttribute('title', isEditingInterests ? t('prof.editDone.title', 'Завершить редактирование') : t('profile.editInterests.title', 'Редактировать интересы'));
    renderInterestsCloud();
  });

  function renderProfile() {
    const isAuth = Boolean(state.currentUser);
    const user = state.currentUser;

    if (profileUsername) {
      profileUsername.textContent = isAuth ? `@${user.username}` : t('prof.guestMode', 'Гостевой режим');
    }

    if (profileBadgeStatus) {
      profileBadgeStatus.textContent = isAuth ? t('prof.authorized', 'Авторизован') : t('prof.localGuest', 'Локальный гость');
      profileBadgeStatus.className = `profile-badge ${isAuth ? 'badge-auth' : 'badge-guest'}`;
    }

    if (profileJoinedDate) {
      if (isAuth && user.createdAt) {
        try {
          const date = new Date(user.createdAt);
          profileJoinedDate.textContent = t('prof.memberSince', 'В клубе с {date}').replace('{date}', date.toLocaleDateString(document.documentElement.lang === 'en' ? 'en-US' : 'ru-RU', { month: 'long', year: 'numeric' }));
        } catch {
          profileJoinedDate.textContent = t('prof.member', 'В клубе');
        }
      } else {
        profileJoinedDate.textContent = t('prof.localDataHint', 'Данные сохраняются локально в вашем браузере');
      }
    }

    if (profileAvatar) {
      if (isAuth && user.username) {
        profileAvatar.textContent = user.username.charAt(0).toUpperCase();
      } else {
        profileAvatar.innerHTML = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
      }
    }

    if (profileHeaderActions) {
      if (isAuth) {
        profileHeaderActions.innerHTML = `
          <button type="button" class="btn-profile-logout" id="btnProfileLogout" title="${t('prof.logout.title', 'Выйти из текущего аккаунта')}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            <span>${t('prof.logout', 'Выйти')}</span>
          </button>
        `;
        document.getElementById('btnProfileLogout')?.addEventListener('click', handleLogout);
      } else {
        profileHeaderActions.innerHTML = `
          <button type="button" class="btn-primary btn-profile-login" id="btnProfileLoginAction">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
            <span>${t('prof.loginOrRegister', 'Войти / Регистрация')}</span>
          </button>
        `;
        document.getElementById('btnProfileLoginAction')?.addEventListener('click', () => {
          if (typeof onOpenAuth === 'function') onOpenAuth('login');
        });
      }
    }

    const statViews = state.viewedIds?.size || 0;
    if (statLikesEl) statLikesEl.textContent = state.likes?.length || 0;
    if (statFavsEl) statFavsEl.textContent = state.favorites?.length || 0;
    if (statAuthorsEl) statAuthorsEl.textContent = state.favoriteAuthors?.length || 0;
    if (statViewsEl) statViewsEl.textContent = statViews;

    applySubTabUi(state.profileSubTab || 'likes');

    renderInterestsCloud();
    renderViewHistory();
  }

  function renderInterestsCloud() {
    const cloud = document.getElementById('profileInterestsCloud');
    if (!cloud) return;

    const interestTags = getUserInterestTags ? getUserInterestTags(35) : [];
    const excludedCount = state.settings?.excludedInterestTags?.length || 0;

    if (!interestTags || interestTags.length === 0) {
      cloud.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 8px; align-items: flex-start;">
          <span style="color: var(--text-muted); font-size: 13px;">
            ${excludedCount > 0 ? t('prof.interestsAllExcluded', 'Все основные теги исключены из карты.') : t('prof.interestsHint', 'Оценивайте работы лайками, чтобы сформировать карту интересов для персональных рекомендаций.')}
          </span>
          ${excludedCount > 0 ? `
            <button type="button" class="btn-restore-interests" id="btnRestoreInterests">
              ${t('prof.restoreExcluded', 'Восстановить исключенные теги ({n})').replace('{n}', excludedCount)}
            </button>
          ` : ''}
        </div>
      `;
      document.getElementById('btnRestoreInterests')?.addEventListener('click', () => {
        resetExcludedInterestTags();
        saveSettings(state.settings).catch(() => {});
        saveLocalSettings(state.settings);
        showToast(t('prof.excludedRestored', 'Исключенные теги восстановлены'), 'info');
        renderInterestsCloud();
      });
      return;
    }

    cloud.innerHTML = `
      <div class="interests-tags-grid">
        ${interestTags.map(item => {
          const displayScore = typeof item.score === 'number' ? item.score.toFixed(1) : (typeof item.weight === 'number' ? item.weight.toFixed(1) : '');
          return `
            <div class="interest-tag-chip ${isEditingInterests ? 'editing' : ''}" data-tag="${escapeHtml(item.tag)}">
              <span class="interest-tag-name">${escapeHtml(item.tag)}</span>
              ${displayScore ? `<span class="interest-tag-weight">${escapeHtml(displayScore)}</span>` : ''}
              ${isEditingInterests ? `
                <button type="button" class="btn-chip-delete" data-tag="${escapeHtml(item.tag)}" title="${escapeHtml(t('prof.removeTag.title', 'Удалить тег из интересов'))}">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
      <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px;">
        ${(isEditingInterests && excludedCount > 0) ? `
          <button type="button" class="btn-restore-interests" id="btnRestoreInterests">
            ${t('prof.restoreDeleted', 'Восстановить удаленные теги ({n})').replace('{n}', excludedCount)}
          </button>
        ` : ''}
        ${(state.dislikes && state.dislikes.length > 0) ? `
          <button type="button" class="btn-restore-interests" id="btnClearDislikesProfile" title="${t('prof.clearDislikes.title', 'Сбросить список скрытых постов и вернуть их в рекомендации')}">
            ${t('prof.clearDislikes', 'Сбросить скрытые посты ({n})').replace('{n}', state.dislikes.length)}
          </button>
        ` : ''}
      </div>
    `;

    cloud.querySelectorAll('.interest-tag-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        const tag = chip.getAttribute('data-tag');
        if (!tag) return;

        if (isEditingInterests) {
          e.stopPropagation();
          excludeInterestTag(tag);
          saveSettings(state.settings).catch(() => {});
          saveLocalSettings(state.settings);
          showToast(t('prof.tagRemoved', 'Тег "{tag}" удален из интересов').replace('{tag}', tag), 'info');
          renderInterestsCloud();
        } else {
          if (typeof onTabChange === 'function') {
            onTabChange('search-tag', tag);
          }
        }
      });
    });

    document.getElementById('btnRestoreInterests')?.addEventListener('click', () => {
      resetExcludedInterestTags();
      saveSettings(state.settings).catch(() => {});
      saveLocalSettings(state.settings);
      showToast(t('prof.deletedRestored', 'Удаленные теги восстановлены'), 'info');
      renderInterestsCloud();
    });

    document.getElementById('btnClearDislikesProfile')?.addEventListener('click', async () => {
      clearDislikesLocally();
      try {
        await clearDislikesApi();
      } catch (err) {}
      showToast(t('prof.dislikesCleared', 'Список скрытых постов сброшен'), 'info');
      renderInterestsCloud();
    });
  }

  // The history list is a recency view: render only the newest slice so the
  // profile pane never holds hundreds of thumbnail nodes at once
  const HISTORY_RENDER_LIMIT = 60;
  let historyEntriesCache = [];

  function formatHistoryWhen(ts) {
    const mins = Math.floor((Date.now() - (ts || 0)) / 60000);
    if (mins < 1) return t('profile.historyJustNow', 'только что');
    if (mins < 60) return t('profile.historyMinsAgo', '{n} мин. назад').replace('{n}', mins);
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t('profile.historyHoursAgo', '{n} ч. назад').replace('{n}', hours);
    return t('profile.historyDaysAgo', '{n} дн. назад').replace('{n}', Math.floor(hours / 24));
  }

  function renderViewHistory() {
    if (!historyGrid) return;
    const entries = Array.isArray(state.viewHistory) ? state.viewHistory.slice(0, HISTORY_RENDER_LIMIT) : [];
    historyEntriesCache = entries;

    if (btnClearHistory) btnClearHistory.disabled = entries.length === 0;

    if (entries.length === 0) {
      historyGrid.innerHTML = `<div class="history-empty">${escapeHtml(t('profile.historyEmpty', 'История пуста. Открытые вами посты появятся здесь.'))}</div>`;
      return;
    }

    historyGrid.innerHTML = entries.map((entry) => {
      const site = (state.sites || []).find((s) => s.id === entry.s);
      const siteName = (site && site.name) || entry.s;
      const raw = entry.t || '';
      const mediaSrc = raw && !raw.startsWith('/api/') && shouldProxyMedia({ site: entry.s, url: raw, type: 'thumbnail' })
        ? getProxiedUrl(raw)
        : raw;
      const safeSrc = escapeHtml(toSafeImageUrl(mediaSrc));
      const when = formatHistoryWhen(entry.ts);
      return `
        <button type="button" class="history-card" data-i="${escapeHtml(String(entry.i))}" title="${escapeHtml(siteName)} · ${escapeHtml(when)}">
          ${safeSrc ? `<img class="history-thumb" src="${safeSrc}" alt="" loading="lazy" decoding="async">` : ''}
          ${entry.v ? '<span class="history-video-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="6 3 20 12 6 21 6 3"/></svg></span>' : ''}
          <span class="history-site-badge">${escapeHtml(siteName)}</span>
        </button>
      `;
    }).join('');
  }

  async function handleLogout() {
    await apiLogout();
    clearLocalAuth();
    markAuthHeadersDirty();
    showToast(t('prof.loggedOut', 'Вы вышли из аккаунта'), 'info');
    if (typeof onReloadState === 'function') onReloadState();
  }

  // Shared by setProfileSubTab() and renderProfile(): URL restores land in
  // renderProfile() without a tab click, so the pane and the active button
  // must sync from state.profileSubTab there too
  function applySubTabUi(subTab) {
    [btnTabLikes, btnTabFavs, btnTabAuthors, btnTabAnalytics].forEach(btn => btn?.classList.remove('active'));

    const profileAuthorsToolbar = document.getElementById('profileAuthorsToolbar');
    if (profileAuthorsToolbar) {
      profileAuthorsToolbar.style.display = subTab === 'authors' ? 'flex' : 'none';
    }

    if (analyticsPane) analyticsPane.style.display = subTab === 'analytics' ? 'block' : 'none';

    const activeBtn = subTab === 'favorites' ? btnTabFavs
      : subTab === 'authors' ? btnTabAuthors
        : subTab === 'analytics' ? btnTabAnalytics
          : btnTabLikes;
    activeBtn?.classList.add('active');
  }

  function setProfileSubTab(subTab) {
    state.profileSubTab = subTab;
    applySubTabUi(subTab);

    if (subTab === 'analytics') {
      renderViewHistory();
    }

    if (typeof onTabChange === 'function') {
      onTabChange('profile-subtab', subTab);
    }
  }

  const profileAuthorsSearchInput = document.getElementById('profileAuthorsSearchInput');
  if (profileAuthorsSearchInput) {
    profileAuthorsSearchInput.addEventListener('input', () => {
      if (typeof onTabChange === 'function') {
        onTabChange('profile-authors-search', profileAuthorsSearchInput.value);
      }
    });
  }

  btnTabLikes?.addEventListener('click', () => setProfileSubTab('likes'));
  btnTabFavs?.addEventListener('click', () => setProfileSubTab('favorites'));
  btnTabAuthors?.addEventListener('click', () => setProfileSubTab('authors'));
  btnTabAnalytics?.addEventListener('click', () => setProfileSubTab('analytics'));

  if (historyGrid) {
    historyGrid.addEventListener('click', (e) => {
      const card = e.target.closest('.history-card');
      if (!card) return;
      const entry = historyEntriesCache.find((en) => en.i === card.dataset.i);
      if (entry && typeof onOpenHistoryPost === 'function') onOpenHistoryPost(entry);
    });
  }

  btnClearHistory?.addEventListener('click', () => {
    clearViewHistory();
    showToast(t('profile.historyCleared', 'История просмотров очищена'), 'info');
    renderViewHistory();
  });

  return {
    renderProfile,
    setProfileSubTab
  };
}
