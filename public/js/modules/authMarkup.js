// Markup for the modalAuthBackdrop dialog, injected on first use of the owning module.
// Kept out of index.html so the initial shell stays small; data-i18n
// attributes are translated right after injection.
import { applyStaticTranslations } from '../i18n.js';

const MARKUP = `
  <!-- Account login and registration modal -->
  <div class="modal-backdrop" id="modalAuthBackdrop" style="display: none;">
    <div class="modal-dialog modal-dialog-auth" role="dialog" aria-modal="true" aria-label="Вход и регистрация">
      <div class="modal-header">
        <div class="auth-modal-header-tabs">
          <button type="button" class="auth-header-tab active" id="btnAuthTabLogin" data-i18n="auth.loginTab">Вход</button>
          <button type="button" class="auth-header-tab" id="btnAuthTabRegister" data-i18n="auth.registerTab">Регистрация</button>
        </div>
        <button class="btn-icon btn-modal-close" id="btnCloseAuthModal" title="Закрыть" data-i18n-title="modal.close.title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <!-- Login form -->
      <form id="formLogin" class="modal-body modal-form">
        <div class="form-group">
          <label for="inputLoginUsername" class="form-label" data-i18n="auth.loginName">Логин / Имя пользователя:</label>
          <input type="text" id="inputLoginUsername" class="form-input" placeholder="Введите имя..." data-i18n-placeholder="auth.loginName.placeholder" required autocomplete="username" spellcheck="false">
        </div>
        <div class="form-group">
          <label for="inputLoginPassword" class="form-label" data-i18n="auth.loginPassword">Пароль:</label>
          <input type="password" id="inputLoginPassword" class="form-input" placeholder="Введите пароль..." data-i18n-placeholder="auth.loginPassword.placeholder" required autocomplete="current-password">
        </div>
        <div class="auth-error-msg" id="loginErrorMsg" style="display: none;"></div>
        <div class="modal-footer auth-footer">
          <button type="submit" class="btn-primary btn-auth-submit" id="btnSubmitLogin" data-i18n="auth.loginSubmit">Войти в аккаунт</button>
        </div>
      </form>

      <!-- Registration form -->
      <form id="formRegister" class="modal-body modal-form" style="display: none;">
        <div class="form-group">
          <label for="inputRegUsername" class="form-label" data-i18n="auth.regName">Придумайте логин:</label>
          <input type="text" id="inputRegUsername" class="form-input" placeholder="От 3 до 30 символов..." data-i18n-placeholder="auth.regName.placeholder" required autocomplete="username" spellcheck="false">
        </div>
        <div class="form-group">
          <label for="inputRegPassword" class="form-label" data-i18n="auth.regPassword">Придумайте пароль:</label>
          <input type="password" id="inputRegPassword" class="form-input" placeholder="Не менее 4 символов..." data-i18n-placeholder="auth.regPassword.placeholder" required autocomplete="new-password">
        </div>
        <div class="form-group">
          <label for="inputRegPasswordConfirm" class="form-label" data-i18n="auth.regConfirm">Повторите пароль:</label>
          <input type="password" id="inputRegPasswordConfirm" class="form-input" placeholder="Повторите пароль..." data-i18n-placeholder="auth.regConfirm.placeholder" required autocomplete="new-password">
        </div>

        <div class="form-group-checkbox">
          <label class="toggle-switch">
            <input type="checkbox" id="checkMigrateLocalData" checked>
            <span class="toggle-slider"></span>
            <span class="toggle-name" data-i18n="auth.migrate">Перенести текущие закладки, лайки и настройки в новый аккаунт</span>
          </label>
        </div>

        <div class="auth-error-msg" id="regErrorMsg" style="display: none;"></div>
        <div class="modal-footer auth-footer">
          <button type="submit" class="btn-primary btn-auth-submit" id="btnSubmitRegister" data-i18n="auth.registerSubmit">Создать аккаунт</button>
        </div>
      </form>
    </div>
  </div>
`;

export function ensureAuthMarkup() {
  if (document.getElementById('modalAuthBackdrop')) return;
  document.body.insertAdjacentHTML('beforeend', MARKUP);
  applyStaticTranslations(document);
}
