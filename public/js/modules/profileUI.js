import { state, clearLocalAuth, getUserInterestTags, excludeInterestTag, restoreInterestTag, resetExcludedInterestTags, saveLocalSettings, clearDislikesLocally } from '../state.js';
import { apiLogout, saveSettings, clearDislikesApi } from '../api.js';
import { showToast } from './uiUtils.js';

export function initProfileUI({ onOpenAuth, onTabChange, onReloadState }) {
  const profileSection = document.getElementById('userProfileSection');
  const profileUsername = document.getElementById('profileUsername');
  const profileBadgeStatus = document.getElementById('profileBadgeStatus');
  const profileJoinedDate = document.getElementById('profileJoinedDate');
  const profileAvatar = document.getElementById('profileAvatar');
  const profileHeaderActions = document.getElementById('profileHeaderActions');
  
  const statLikesCount = document.getElementById('statLikesCount');
  const statFavsCount = document.getElementById('statFavsCount');
  const statAuthorsCount = document.getElementById('statAuthorsCount');
  const statViewsCount = document.getElementById('statViewsCount');
  
  const profileTabLikesCount = document.getElementById('profileTabLikesCount');
  const profileTabFavsCount = document.getElementById('profileTabFavsCount');
  const profileTabAuthorsCount = document.getElementById('profileTabAuthorsCount');

  const btnTabLikes = document.getElementById('btnProfileTabLikes');
  const btnTabFavs = document.getElementById('btnProfileTabFavs');
  const btnTabAuthors = document.getElementById('btnProfileTabAuthors');
  const btnTabAnalytics = document.getElementById('btnProfileTabAnalytics');
  const analyticsPane = document.getElementById('profileAnalyticsPane');
  const btnEditInterests = document.getElementById('btnEditInterests');

  let isEditingInterests = false;

  btnEditInterests?.addEventListener('click', () => {
    isEditingInterests = !isEditingInterests;
    btnEditInterests.classList.toggle('active', isEditingInterests);
    btnEditInterests.setAttribute('title', isEditingInterests ? 'Завершить редактирование' : 'Редактировать интересы');
    renderInterestsCloud();
  });

  function renderProfile() {
    const isAuth = Boolean(state.currentUser);
    const user = state.currentUser;

    if (profileUsername) {
      profileUsername.textContent = isAuth ? `@${user.username}` : 'Гостевой режим';
    }

    if (profileBadgeStatus) {
      profileBadgeStatus.textContent = isAuth ? 'Авторизован' : 'Локальный гость';
      profileBadgeStatus.className = `profile-badge ${isAuth ? 'badge-auth' : 'badge-guest'}`;
    }

    if (profileJoinedDate) {
      if (isAuth && user.createdAt) {
        try {
          const date = new Date(user.createdAt);
          profileJoinedDate.textContent = `В клубе с ${date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}`;
        } catch {
          profileJoinedDate.textContent = 'В клубе';
        }
      } else {
        profileJoinedDate.textContent = 'Данные сохраняются локально в вашем браузере';
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
          <button type="button" class="btn-profile-logout" id="btnProfileLogout" title="Выйти из текущего аккаунта">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            <span>Выйти</span>
          </button>
        `;
        document.getElementById('btnProfileLogout')?.addEventListener('click', handleLogout);
      } else {
        profileHeaderActions.innerHTML = `
          <button type="button" class="btn-primary btn-profile-login" id="btnProfileLoginAction">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
            <span>Войти / Регистрация</span>
          </button>
        `;
        document.getElementById('btnProfileLoginAction')?.addEventListener('click', () => {
          if (typeof onOpenAuth === 'function') onOpenAuth('login');
        });
      }
    }

    // Обновление счетчиков
    const likesCount = state.likes?.length || 0;
    const favsCount = state.favorites?.length || 0;
    const authorsCount = state.favoriteAuthors?.length || 0;
    const viewsCount = state.viewedIds?.size || 0;

    if (statLikesCount) statLikesCount.textContent = likesCount;
    if (statFavsCount) statFavsCount.textContent = favsCount;
    if (statAuthorsCount) statAuthorsCount.textContent = authorsCount;
    if (statViewsCount) statViewsCount.textContent = viewsCount;

    if (profileTabLikesCount) profileTabLikesCount.textContent = likesCount;
    if (profileTabFavsCount) profileTabFavsCount.textContent = favsCount;
    if (profileTabAuthorsCount) profileTabAuthorsCount.textContent = authorsCount;

    const profileAuthorsToolbar = document.getElementById('profileAuthorsToolbar');
    if (profileAuthorsToolbar) {
      profileAuthorsToolbar.style.display = state.profileSubTab === 'authors' ? 'flex' : 'none';
    }

    renderInterestsCloud();
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
            ${excludedCount > 0 ? 'Все основные теги исключены из карты.' : 'Оценивайте работы лайками, чтобы сформировать карту интересов для персональных рекомендаций.'}
          </span>
          ${excludedCount > 0 ? `
            <button type="button" class="btn-restore-interests" id="btnRestoreInterests">
              Восстановить исключенные теги (${excludedCount})
            </button>
          ` : ''}
        </div>
      `;
      document.getElementById('btnRestoreInterests')?.addEventListener('click', () => {
        resetExcludedInterestTags();
        saveSettings(state.settings).catch(() => {});
        saveLocalSettings(state.settings);
        showToast('Исключенные теги восстановлены', 'info');
        renderInterestsCloud();
      });
      return;
    }

    cloud.innerHTML = `
      <div class="interests-tags-grid">
        ${interestTags.map(item => {
          const displayScore = typeof item.score === 'number' ? item.score.toFixed(1) : (typeof item.weight === 'number' ? item.weight.toFixed(1) : '');
          return `
            <div class="interest-tag-chip ${isEditingInterests ? 'editing' : ''}" data-tag="${item.tag}">
              <span class="interest-tag-name">${item.tag}</span>
              ${displayScore ? `<span class="interest-tag-weight">${displayScore}</span>` : ''}
              ${isEditingInterests ? `
                <button type="button" class="btn-chip-delete" data-tag="${item.tag}" title="Удалить тег из интересов">
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
            Восстановить удаленные теги (${excludedCount})
          </button>
        ` : ''}
        ${(state.dislikes && state.dislikes.length > 0) ? `
          <button type="button" class="btn-restore-interests" id="btnClearDislikesProfile" title="Сбросить список скрытых постов и вернуть их в рекомендации">
            Сбросить скрытые посты (${state.dislikes.length})
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
          showToast(`Тег "${tag}" удален из интересов`, 'info');
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
      showToast('Удаленные теги восстановлены', 'info');
      renderInterestsCloud();
    });

    document.getElementById('btnClearDislikesProfile')?.addEventListener('click', async () => {
      clearDislikesLocally();
      try {
        await clearDislikesApi();
      } catch (err) {}
      showToast('Список скрытых постов сброшен', 'info');
      renderInterestsCloud();
    });
  }

  async function handleLogout() {
    await apiLogout();
    clearLocalAuth();
    showToast('Вы вышли из аккаунта', 'info');
    if (typeof onReloadState === 'function') onReloadState();
  }

  function setProfileSubTab(subTab) {
    state.profileSubTab = subTab;
    [btnTabLikes, btnTabFavs, btnTabAuthors, btnTabAnalytics].forEach(btn => btn?.classList.remove('active'));
    
    const profileAuthorsToolbar = document.getElementById('profileAuthorsToolbar');
    if (profileAuthorsToolbar) {
      profileAuthorsToolbar.style.display = subTab === 'authors' ? 'flex' : 'none';
    }

    if (subTab === 'likes') {
      btnTabLikes?.classList.add('active');
      if (analyticsPane) analyticsPane.style.display = 'none';
    } else if (subTab === 'favorites') {
      btnTabFavs?.classList.add('active');
      if (analyticsPane) analyticsPane.style.display = 'none';
    } else if (subTab === 'authors') {
      btnTabAuthors?.classList.add('active');
      if (analyticsPane) analyticsPane.style.display = 'none';
    } else if (subTab === 'analytics') {
      btnTabAnalytics?.classList.add('active');
      if (analyticsPane) analyticsPane.style.display = 'block';
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

  document.getElementById('statLikesItem')?.addEventListener('click', () => setProfileSubTab('likes'));
  document.getElementById('statFavsItem')?.addEventListener('click', () => setProfileSubTab('favorites'));
  document.getElementById('statAuthorsItem')?.addEventListener('click', () => setProfileSubTab('authors'));
  document.getElementById('statViewsItem')?.addEventListener('click', () => setProfileSubTab('analytics'));

  return {
    renderProfile,
    setProfileSubTab
  };
}
