import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Search, Users } from 'lucide-react';

export interface PostableGroup {
  id: string;
  name: string;
  image?: string;
  role?: string;
  postingPermissions?: string;
  memberCount?: number;
}

interface Props {
  groups: PostableGroup[];
  selectedIds: string[];
  onSave: (ids: string[]) => void;
  onClose: () => void;
  accent: 'blue' | 'purple' | 'amber';
}

export const GroupSelectionPage: React.FC<Props> = ({ groups, selectedIds, onSave, onClose, accent }) => {
  const [draftIds, setDraftIds] = useState(() => selectedIds.filter(id => groups.some(group => group.id === id)));
  const [search, setSearch] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(() => {});
  const selected = draftIds.filter(id => groups.some(group => group.id === id));
  const visibleGroups = groups.filter(group => group.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const colors = {
    blue: { button: 'bg-blue-600', check: 'accent-blue-600' },
    purple: { button: 'bg-purple-600', check: 'accent-purple-600' },
    amber: { button: 'bg-amber-600', check: 'accent-amber-600' },
  }[accent];

  const requestClose = () => {
    if (draftIds.length > 0 || selectedIds.some(id => !draftIds.includes(id))) setConfirmDiscard(true);
    else onClose();
  };
  closeRef.current = confirmDiscard ? () => setConfirmDiscard(false) : requestClose;

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const background = Array.from(document.body.children).filter(element => element !== page) as HTMLElement[];
    const priorInert = background.map(element => element.inert);
    background.forEach(element => { element.inert = true; });
    document.body.style.overflow = 'hidden';
    backRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const scope = page.querySelector('[role="alertdialog"]') || page;
      const focusable = Array.from(scope.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      background.forEach((element, index) => { element.inert = priorInert[index]; });
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  useEffect(() => {
    if (confirmDiscard) keepEditingRef.current?.focus();
    else backRef.current?.focus();
  }, [confirmDiscard]);

  return createPortal(
    <div ref={pageRef} role="dialog" aria-modal="true" aria-labelledby="group-selection-title" className="fixed inset-0 z-[150] bg-gray-100 flex justify-center">
      <div className="w-full max-w-2xl bg-white flex flex-col min-h-0" inert={confirmDiscard || undefined}>
        <header className="flex items-center gap-3 border-b border-gray-100 px-3 py-2 shrink-0">
          <button ref={backRef} type="button" aria-label="Back from selected groups" onClick={requestClose} className="p-3 rounded-full hover:bg-gray-50"><ArrowLeft size={20} className="rtl:rotate-180" /></button>
          <h2 id="group-selection-title" className="text-sm font-bold text-gray-900">Selected Groups</h2>
        </header>
        <div className="p-4 shrink-0">
          <label className="flex items-center gap-2 rounded-xl bg-gray-50 border border-gray-200 px-3">
            <Search size={18} className="text-gray-400 shrink-0" />
            <input autoComplete="off" dir="auto" aria-label="Search groups" placeholder="Search groups" value={search} onChange={event => setSearch(event.target.value)} className="w-full min-w-0 min-h-11 text-start text-[12px] font-normal bg-transparent focus:outline-none" />
          </label>
          <p role="status" className="text-xs text-gray-500 mt-3">{selected.length} selected</p>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4">
          {visibleGroups.map(group => <label key={group.id} className="flex items-center gap-3 min-h-14 py-3 border-b border-gray-100 cursor-pointer">
            <Users size={22} className="text-gray-400 shrink-0" />
            <span dir="auto" className="flex-1 min-w-0 break-words text-start text-[12px] font-normal text-gray-900">{group.name}</span>
            <input type="checkbox" aria-label={group.name} checked={draftIds.includes(group.id)} onChange={() => setDraftIds(ids => ids.includes(group.id) ? ids.filter(id => id !== group.id) : [...ids, group.id])} className={`w-5 h-5 shrink-0 ${colors.check}`} />
          </label>)}
          {!visibleGroups.length && <p className="text-xs text-gray-500 py-6 text-center">{groups.length ? 'No groups match your search.' : "You don't have permission to post in any groups."}</p>}
        </div>
        <footer className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-gray-100 shrink-0">
          <button type="button" disabled={selected.length === 0} onClick={() => onSave(selected)} className={`w-full min-h-11 rounded-xl text-white text-sm font-bold disabled:opacity-40 ${colors.button}`}>Save</button>
        </footer>
      </div>
      {confirmDiscard && <div className="absolute inset-0 bg-black/40 flex items-center justify-center p-4">
        <div role="alertdialog" aria-modal="true" aria-labelledby="discard-groups-title" aria-describedby="discard-groups-description" className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-xl">
          <h3 id="discard-groups-title" className="text-sm font-bold text-gray-900">Discard group changes?</h3>
          <p id="discard-groups-description" className="text-xs leading-relaxed text-gray-600 mt-2">If you leave, your unsaved group selections will be discarded. Your saved selections will be kept.</p>
          <div className="flex flex-wrap gap-2 mt-5">
            <button ref={keepEditingRef} type="button" onClick={() => setConfirmDiscard(false)} className={`flex-1 min-h-11 px-3 rounded-xl text-xs font-bold text-white ${colors.button}`}>Keep Editing</button>
            <button type="button" onClick={onClose} className="flex-1 min-h-11 px-3 rounded-xl border border-gray-200 text-xs font-bold text-gray-700">Discard</button>
          </div>
        </div>
      </div>}
    </div>, document.body
  );
};
