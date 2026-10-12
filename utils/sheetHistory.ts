const marker = '__opiniupSheet';
type SheetEntry = { id: string; close: () => void; element: () => HTMLElement | null; disabled: () => boolean; consumed: boolean };
const stack: SheetEntry[] = [];
const retired = new Set<string>();
let installed = false;
let pendingBack = false;
let lastRouteIndex = 0;
const routeIndex = (state: any): number => Number.isInteger(state?.idx) ? state.idx : 0;

export const dismissSheetKeyboard = (element: HTMLElement | null) => {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !element?.contains(active) || !active.matches('input,textarea,[contenteditable="true"]')) return false;
  active.blur();
  element.focus({ preventScroll: true });
  return true;
};

// Install before the router. Consumed sheet pops must not remount route content.
export function installSheetHistory() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  lastRouteIndex = routeIndex(history.state);
  window.addEventListener('popstate', event => {
    const top = stack[stack.length - 1];
    // Several nested sheets can unmount together on logout/navigation. Drain
    // only their own entries, never the route entry underneath them.
    if (retired.has(event.state?.[marker])) {
      event.stopImmediatePropagation();
      // Router indexes exclude our sheet entries. Equal indexes mean Forward
      // from the underlying route; a lower index means Back from a later route.
      // In-place dismissal always drains backward and keeps its silent pop.
      if (pendingBack || routeIndex(event.state) < lastRouteIndex) history.back();
      else history.forward();
      return;
    }
    lastRouteIndex = routeIndex(event.state);
    if (pendingBack) {
      pendingBack = false;
      event.stopImmediatePropagation();
      return;
    }
    if (!top || top.consumed || event.state?.[marker] === top.id) return;
    event.stopImmediatePropagation();
    if (top.disabled() || dismissSheetKeyboard(top.element())) {
      // Replace the single consumed entry. There is never a keyboard entry.
      history.pushState({ ...history.state, [marker]: top.id }, '');
      return;
    }
    top.consumed = true;
    top.close();
  }, true);
  // A discarded renderer cannot restore an open dialog from history alone.
  if (history.state?.[marker]) {
    const state = { ...history.state };
    delete state[marker];
    history.replaceState(state, '');
  }
}

export function registerSheetHistory(entry: Omit<SheetEntry, 'consumed'>) {
  installSheetHistory();
  const item: SheetEntry = { ...entry, consumed: false };
  lastRouteIndex = routeIndex(history.state);
  retired.delete(item.id);
  stack.push(item);
  history.pushState({ ...history.state, [marker]: item.id }, '');
  return () => {
    lastRouteIndex = routeIndex(history.state);
    const index = stack.indexOf(item);
    if (index !== -1) stack.splice(index, 1);
    retired.add(item.id);
    // Navigation to an author/new route has already removed our marker.
    if (!item.consumed && history.state?.[marker] === item.id) {
      pendingBack = true;
      history.back();
    }
  };
}
