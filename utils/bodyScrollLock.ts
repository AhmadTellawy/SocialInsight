let locks = 0;
let original = '';

/** Parent and child dialogs may unmount in either order during navigation. */
export function acquireBodyScrollLock(): () => void {
  if (locks++ === 0) original = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--locks === 0) document.body.style.overflow = original;
  };
}
