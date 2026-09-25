const MODAL_SELECTOR = '[role="dialog"][aria-modal="true"]';

let returnFocus = null;
let activeModal = null;

function isVisible(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
}

function getFocusable(modal) {
  return [...modal.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter(element => isVisible(element));
}

function getTopModal() {
  return [...document.querySelectorAll(MODAL_SELECTOR)].filter(isVisible).pop() || null;
}

function focusModal(modal) {
  if (activeModal === modal) return;
  if (!activeModal) returnFocus = document.activeElement;
  activeModal = modal;
  const focusable = getFocusable(modal);
  (focusable[0] || modal).focus?.();
}

function restoreFocus() {
  if (returnFocus && document.contains(returnFocus)) returnFocus.focus?.();
  returnFocus = null;
  activeModal = null;
}

export function initModalAccessibility() {
  document.addEventListener('keydown', (event) => {
    const modal = getTopModal();
    if (!modal) return;
    if (event.key !== 'Tab') return;
    const focusable = getFocusable(modal);
    if (focusable.length === 0) {
      event.preventDefault();
      modal.focus?.();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  document.addEventListener('focusin', (event) => {
    const modal = getTopModal();
    if (!modal || modal.contains(event.target)) return;
    const focusable = getFocusable(modal);
    (focusable[0] || modal).focus?.();
  });

  const observer = new MutationObserver(() => {
    const modal = getTopModal();
    if (modal) {
      focusModal(modal);
    } else if (activeModal) {
      restoreFocus();
    }
  });

  const observeTarget = document.body;
  if (observeTarget) {
    observer.observe(observeTarget, { subtree: true, attributes: true, attributeFilter: ['style', 'class', 'aria-hidden'] });
  }
}
