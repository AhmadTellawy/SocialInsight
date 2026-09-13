import React, { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/** Keep the pending editor and the content behind it isolated until saving settles. */
export function PostSaveStatus({ active, label }: { active: boolean; label: string }) {
  const layerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!active || !layer) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const editor = document.querySelector<HTMLElement>('[data-post-editor]');
    const previousOverflow = document.body.style.overflow;
    const siblings = Array.from(document.body.children).filter(element => element !== layer) as HTMLElement[];
    const previousInert = siblings.map(element => element.inert);
    siblings.forEach(element => { element.inert = true; });
    document.body.style.overflow = 'hidden';
    layer.focus({ preventScroll: true });
    const keepFocus = (event: KeyboardEvent) => {
      if (['Tab', 'Escape', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        layer.focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', keepFocus, true);
    return () => {
      document.removeEventListener('keydown', keepFocus, true);
      siblings.forEach((element, index) => { element.inert = previousInert[index]; });
      document.body.style.overflow = previousOverflow;
      queueMicrotask(() => {
        if (previousFocus?.isConnected && previousFocus !== document.body && !previousFocus.closest('[inert]')) {
          previousFocus.focus({ preventScroll: true });
        } else if (editor?.isConnected && !editor.closest('[inert]')) {
          editor.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled])')?.focus({ preventScroll: true });
        }
      });
    };
  }, [active]);

  if (!active) return null;
  return createPortal(
    <div ref={layerRef} role="status" tabIndex={-1}
      className="fixed inset-0 z-[1000] flex items-start justify-center p-4 outline-none"
      style={{ touchAction: 'none' }} onClick={event => event.stopPropagation()}>
      <div className="w-full max-w-md rounded-xl bg-gray-900 p-3 text-center text-sm text-white">{label}</div>
    </div>, document.body
  );
}
