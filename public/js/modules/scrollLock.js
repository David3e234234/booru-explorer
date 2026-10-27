// Reference-counted body scroll lock. Viewer, feed and settings can layer on
// top of each other; closing the top one must not unlock the page while
// another surface still owns the viewport.
let lockCount = 0;
let previousOverflow = '';

export function lockBodyScroll() {
  lockCount += 1;
  if (lockCount > 1) return;
  previousOverflow = document.body.style.overflow || '';
  document.body.style.overflow = 'hidden';
}

export function unlockBodyScroll() {
  if (lockCount === 0) return;
  lockCount -= 1;
  if (lockCount > 0) return;
  document.body.style.overflow = previousOverflow;
  previousOverflow = '';
}
