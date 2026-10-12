const marker = '__opiniupSheet';
type SheetEntry = { id: string; close: () => void; element: () => HTMLElement | null; disabled: () => boolean; consumed: boolean };
const stack: SheetEntry[] = [];
const retired = new Set<string>();
let installed = false;
let pendingBack = false;
type HistoryPosition = { index: number; key: unknown; depth: number };
const sheetDepths = new Map<string, number>();
const position = (state: any): HistoryPosition => ({
  index: Number.isInteger(state?.idx) ? state.idx : 0,
  key: state?.key,
  depth: sheetDepths.get(state?.[marker]) || 0,
});
let lastPosition: HistoryPosition = { index: 0, key: undefined, depth: 0 };

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
  lastPosition = position(history.state);
  window.addEventListener('popstate', event => {
    const top = stack[stack.length - 1];
    // Several nested sheets can unmount together on logout/navigation. Drain
    // only their own entries, never the route entry underneath them.
    if (retired.has(event.state?.[marker])) {
      event.stopImmediatePropagation();
      // Sheet entries share the router index and key of their underlying route.
      // Depth tracks direction inside that run, including a closed forward tail.
      // A changed key at the same index is a replacement of the later entry.
      const next = position(event.state);
      const backward = pendingBack || (next.index !== lastPosition.index
        ? next.index < lastPosition.index
        : next.key !== lastPosition.key || next.depth < lastPosition.depth);
      lastPosition = next;
      if (backward) history.back(); else history.forward();
      return;
    }
    lastPosition = position(event.state);
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
  lastPosition = position(history.state);
  sheetDepths.set(item.id, lastPosition.depth + 1);
  retired.delete(item.id);
  stack.push(item);
  history.pushState({ ...history.state, [marker]: item.id }, '');
  lastPosition = position(history.state);
  return () => {
    lastPosition = position(history.state);
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
