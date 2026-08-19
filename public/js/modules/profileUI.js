import { state, clearLocalAuth, getUserInterestTags } from '../state.js';
import { apiLogout } from '../api.js';
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

  function renderProfile() {
    const isAuth = Boolean(state.currentUser);
    const user = state.currentUser;

    if (isAuth && user) {
      if (profileUsername) profileUsername.textContent = `@${user.username}`;
      if (profileBadgeStatus) {
        profileBadgeStatus.textContent = 'Авторизован';
        profileBadgeStatus.style.background = 'rgba(16, 185, 129, 0.15)';
        profileBadgeStatus.style.color = '#10b981';
        profileBadgeStatus.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      }
      if (profileJoinedDate) {
        const dateStr = user.createdAt ? new Date(user.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Недавно';
        profileJoinedDate.textContent = `В клубе с ${dateStr}`;
      }
      if (profileAvatar) {
        profileAvatar.textContent = user.username.charAt(0).toUpperCase();
      }

      if (profileHeaderActions) {
        profileHeaderActions.innerHTML = `
          <button class="btn-secondary" id="btnProfileLogout" style="font-size: 13px; padding: 8px 14px; gap: 6px;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            <span>Выйти</span>
          </button>
        `;
        document.getElementById('btnProfileLogout')?.addEventListener('click', handleLogout);
      }
    } else {
      if (profileUsername) profileUsername.textContent = 'Гостевой режим';
      if (profileBadgeStatus) {
        profileBadgeStatus.textContent = 'Локальный гость';
        profileBadgeStatus.style.background = 'rgba(245, 158, 11, 0.15)';
        profileBadgeStatus.style.color = '#f59e0b';
        profileBadgeStatus.style.borderColor = 'rgba(245, 158, 11, 0.3)';
      }
      if (profileJoinedDate) {
        profileJoinedDate.textContent = 'Данные сохраняются локально в вашем браузере';
      }
      if (profileAvatar) {
        profileAvatar.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
      }

      if (profileHeaderActions) {
        profileHeaderActions.innerHTML = `
          <button class="btn-primary" id="btnProfileLoginAction" style="font-size: 13px; padding: 8px 16px; gap: 6px;">
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

    renderInterestsCloud();
  }

  function renderInterestsCloud() {
    const cloud = document.getElementById('profileInterestsCloud');
    if (!cloud) return;

    const interestTags = getUserInterestTags ? getUserInterestTags(30) : [];
    if (!interestTags || interestTags.length === 0) {
      cloud.innerHTML = '<span style="color: var(--text-muted); font-size: 13px;">Оценивайте работы лайками, чтобы сформировать карту интересов для персональных рекомендаций.</span>';
      return;
    }

    cloud.innerHTML = interestTags.map(item => {
      const displayScore = typeof item.score === 'number' ? item.score.toFixed(1) : (typeof item.weight === 'number' ? item.weight.toFixed(1) : '');
      return `
        <div class="interest-tag-chip" data-tag="${item.tag}">
          <span>${item.tag}</span>
          ${displayScore ? `<span class="interest-tag-weight">${displayScore}</span>` : ''}
        </div>
      `;
    }).join('');

    cloud.querySelectorAll('.interest-tag-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const tag = chip.getAttribute('data-tag');
        if (tag && typeof onTabChange === 'function') {
          onTabChange('search-tag', tag);
        }
      });
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
