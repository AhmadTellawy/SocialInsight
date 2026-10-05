export type ResumePosition = { viewer: string; path: string; top: number; feedLimit: number; at: number; anchor?: { id: string; offset: number } };
const key = 'opiniup_resume_v1';
export function readResume(viewer: string): ResumePosition | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null');
    return value?.viewer === viewer && Date.now() - value.at < 24 * 60 * 60 * 1000
      && /^\/(?:$|post\/[^?#]+$|profile(?:\/[^?#]+)?$|@[^/?#]+$|group\/[^?#]+$|search$)/.test(value.path)
      && Number.isFinite(value.top) && value.top >= 0
      && Number.isInteger(value.feedLimit) && value.feedLimit >= 10 && value.feedLimit <= 1000
      && (!value.anchor || (typeof value.anchor.id === 'string' && Number.isFinite(value.anchor.offset))) ? value : null;
  } catch { return null; }
}
export function saveResume(viewer: string, path: string, top: number, feedLimit: number, anchor?: ResumePosition['anchor']) {
  try { sessionStorage.setItem(key, JSON.stringify({ viewer, path, top, feedLimit: Math.max(10, Math.min(1000, feedLimit)), at: Date.now(), ...(anchor ? { anchor } : {}) })); } catch { /* Storage may be disabled. */ }
}
export function clearResume() { try { sessionStorage.removeItem(key); } catch { /* Best effort. */ } }

/** Restores only location metadata after fresh authorized content has rendered. */
export function restoreScroll(position: ResumePosition | null) {
  if (!position || position.path !== window.location.pathname) return () => {};
  let frame = 0;
  let cancelled = false;
  let observed: HTMLElement | null = null;
  const apply = () => {
    if (cancelled) return;
    const container = document.querySelector<HTMLElement>('[data-app-scroll]');
    if (container) {
      if (observed !== container) {
        observer.disconnect(); observed = container;
        observer.observe(container); Array.from(container.children).forEach(child => observer.observe(child));
      }
      const anchor = position.anchor && Array.from(container.querySelectorAll<HTMLElement>('[data-post-id]')).find(el => el.dataset.postId === position.anchor!.id);
      container.scrollTop = anchor
        ? container.scrollTop + anchor.getBoundingClientRect().top - container.getBoundingClientRect().top - position.anchor!.offset
        : Math.min(position.top, container.scrollHeight - container.clientHeight);
    }
  };
  const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(apply); });
  // Lazy route components may mount after the data promise settles.
  const mounted = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(apply); });
  mounted.observe(document.body, { childList: true, subtree: true });
  const cancel = () => { cancelled = true; observer.disconnect(); mounted.disconnect(); cancelAnimationFrame(frame); };
  window.addEventListener('pointerdown', cancel, { once: true, capture: true });
  window.addEventListener('wheel', cancel, { once: true, capture: true });
  frame = requestAnimationFrame(apply);
  return () => { cancel(); window.removeEventListener('pointerdown', cancel, true); window.removeEventListener('wheel', cancel, true); };
}
