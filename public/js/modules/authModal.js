import { state, saveLocalAuth, clearLocalAuth, loadLocalFavorites, loadLocalLikes, loadLocalFavoriteAuthors, loadLocalSettings } from '../state.js';
import { apiLogin, apiRegister, apiLogout } from '../api.js';
import { showToast } from './uiUtils.js';

export function initAuthModal({ onAuthSuccess, onLogout }) {
  const modalBackdrop = document.getElementById('modalAuthBackdrop');
  const btnClose = document.getElementById('btnCloseAuthModal');
  const btnTabLogin = document.getElementById('btnAuthTabLogin');
  const btnTabRegister = document.getElementById('btnAuthTabRegister');
  const formLogin = document.getElementById('formLogin');
  const formRegister = document.getElementById('formRegister');
  const loginErrorMsg = document.getElementById('loginErrorMsg');
  const regErrorMsg = document.getElementById('regErrorMsg');
  const btnHeaderAuth = document.getElementById('btnHeaderAuth');

  function openAuthModal(mode = 'login') {
    if (!modalBackdrop) return;
    switchTab(mode);
    clearErrors();
    modalBackdrop.style.display = 'flex';
  }

  function closeAuthModal() {
    if (!modalBackdrop) return;
    modalBackdrop.style.display = 'none';
    clearErrors();
  }

  function clearErrors() {
    if (loginErrorMsg) {
      loginErrorMsg.style.display = 'none';
      loginErrorMsg.textContent = '';
    }
    if (regErrorMsg) {
      regErrorMsg.style.display = 'none';
      regErrorMsg.textContent = '';
    }
  }

  function switchTab(mode) {
    clearErrors();
    if (mode === 'login') {
      btnTabLogin?.classList.add('active');
      btnTabRegister?.classList.remove('active');
      if (formLogin) formLogin.style.display = 'flex';
      if (formRegister) formRegister.style.display = 'none';
    } else {
      btnTabRegister?.classList.add('active');
      btnTabLogin?.classList.remove('active');
      if (formRegister) formRegister.style.display = 'flex';
      if (formLogin) formLogin.style.display = 'none';
    }
  }

  // Обработчики вкладок и закрытия
  btnTabLogin?.addEventListener('click', () => switchTab('login'));
  btnTabRegister?.addEventListener('click', () => switchTab('register'));
  btnClose?.addEventListener('click', closeAuthModal);
  
  modalBackdrop?.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) closeAuthModal();
  });

  btnHeaderAuth?.addEventListener('click', () => {
    if (state.currentUser) {
      // Если уже залогинен, переходим во вкладку Профиль
      const navTabProfile = document.getElementById('navTabProfile');
      if (navTabProfile) {
        navTabProfile.click();
      }
    } else {
      openAuthModal('login');
    }
  });

  // Отправка формы логина
  formLogin?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();
    const username = document.getElementById('inputLoginUsername')?.value.trim();
    const password = document.getElementById('inputLoginPassword')?.value;
    const btnSubmit = document.getElementById('btnSubmitLogin');

    if (!username || !password) return;

    try {
      if (btnSubmit) btnSubmit.disabled = true;
      const res = await apiLogin(username, password);
      if (res.success && res.token && res.user) {
        saveLocalAuth(res.token, res.user);
        showToast(`С возвращением, ${res.user.username}!`, 'success');
        closeAuthModal();
        if (typeof onAuthSuccess === 'function') onAuthSuccess(res.user);
      } else {
        if (loginErrorMsg) {
          loginErrorMsg.textContent = res.message || 'Ошибка авторизации';
          loginErrorMsg.style.display = 'block';
        }
      }
    } catch (err) {
      if (loginErrorMsg) {
        loginErrorMsg.textContent = err.message || 'Ошибка соединения с сервером';
        loginErrorMsg.style.display = 'block';
      }
    } finally {
      if (btnSubmit) btnSubmit.disabled = false;
    }
  });

  // Отправка формы регистрации
  formRegister?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();
    const username = document.getElementById('inputRegUsername')?.value.trim();
    const password = document.getElementById('inputRegPassword')?.value;
    const passwordConfirm = document.getElementById('inputRegPasswordConfirm')?.value;
    const shouldMigrate = document.getElementById('checkMigrateLocalData')?.checked;
    const btnSubmit = document.getElementById('btnSubmitRegister');

    if (!username || !password) return;

    if (password !== passwordConfirm) {
      if (regErrorMsg) {
        regErrorMsg.textContent = 'Пароли не совпадают';
        regErrorMsg.style.display = 'block';
      }
      return;
    }

    // Собираем локальные данные для миграции, если флажок включен
    const initialData = {};
    if (shouldMigrate) {
      initialData.favorites = state.favorites || [];
      initialData.likes = state.likes || [];
      initialData.favoriteAuthors = state.favoriteAuthors || [];
      initialData.settings = state.settings || {};
    }

    try {
      if (btnSubmit) btnSubmit.disabled = true;
      const res = await apiRegister(username, password, initialData);
      if (res.success && res.token && res.user) {
        saveLocalAuth(res.token, res.user);
        showToast(`Аккаунт ${res.user.username} успешно создан!`, 'success');
        closeAuthModal();
        if (typeof onAuthSuccess === 'function') onAuthSuccess(res.user);
      } else {
        if (regErrorMsg) {
          regErrorMsg.textContent = res.message || 'Ошибка при регистрации';
          regErrorMsg.style.display = 'block';
        }
      }
    } catch (err) {
      if (regErrorMsg) {
        regErrorMsg.textContent = err.message || 'Ошибка соединения с сервером';
        regErrorMsg.style.display = 'block';
      }
    } finally {
      if (btnSubmit) btnSubmit.disabled = false;
    }
  });

  return {
    openAuthModal,
    closeAuthModal
  };
}

export function updateHeaderAuthUI() {
  const headerUserName = document.getElementById('headerUserName');
  const headerUserAvatar = document.getElementById('headerUserAvatar');
  const mobileNavProfileLabel = document.getElementById('mobileNavProfileLabel');

  if (state.currentUser) {
    const name = state.currentUser.username;
    if (headerUserName) headerUserName.textContent = `@${name}`;
    if (headerUserAvatar) {
      headerUserAvatar.textContent = name.charAt(0).toUpperCase();
    }
    if (mobileNavProfileLabel) {
      mobileNavProfileLabel.textContent = `@${name}`;
    }
  } else {
    if (headerUserName) headerUserName.textContent = 'Войти';
    if (headerUserAvatar) {
      headerUserAvatar.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    }
    if (mobileNavProfileLabel) {
      mobileNavProfileLabel.textContent = 'Профиль';
    }
  }
}
