import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, Expand, ImagePlus, Layers, Maximize, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MediaCropSelection, MediaDraft } from '../../types';
import { cropFromOriginal } from '../../utils/mediaCrop';
import { registerSheetHistory } from '../../utils/sheetHistory';
import { acquireBodyScrollLock } from '../../utils/bodyScrollLock';
import { MediaSourcePreview } from './MediaSourcePreview';

type Props = {
  drafts: MediaDraft[]; purpose: 'POST' | 'OPTION_IMAGE'; initialId?: string;
  initialStage: 'select' | 'adjust'; canAdd: boolean; preparing: boolean; error?: string | null;
  onAdd: () => void; onCancel: () => void; onRetry: (id: string) => void; onRemove: (id: string) => void;
  onApply: (items: Array<{ id: string; crop: MediaCropSelection }>) => void;
};

const sourceRatio = (draft: MediaDraft) => draft.sourceAspectRatio || draft.aspectRatio || 1;
const initialCrop = (draft: MediaDraft) => draft.crop || cropFromOriginal(sourceRatio(draft), 1);

export function MediaPhotoFlow({ drafts, purpose, initialId, initialStage, canAdd, preparing, error, onAdd, onCancel, onRetry, onRemove, onApply }: Props) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onCancel);
  close.current = onCancel;
  const [stage, setStage] = useState(initialStage);
  const [selected, setSelected] = useState(() => drafts.map(d => d.clientId));
  const known = useRef(new Set(selected));
  const [activeId, setActiveId] = useState(initialId || selected[0]);
  const [crops, setCrops] = useState<Record<string, MediaCropSelection>>({});
  const [multi, setMulti] = useState(drafts.length > 1);
  const [compact, setCompact] = useState(false);
  const [ratioSheet, setRatioSheet] = useState(false);
  const [ratioChoice, setRatioChoice] = useState<'square' | 'portrait' | 'original'>('square');
  const [applyAll, setApplyAll] = useState(false);
  const gallery = useRef<HTMLDivElement>(null);
  const escapeAction = useRef(() => {});
  escapeAction.current = () => {
    if (ratioSheet) setRatioSheet(false);
    else if (stage === 'adjust') setStage('select');
    else close.current();
  };

  useEffect(() => {
    const ids = new Set(drafts.map(d => d.clientId));
    const added = drafts.filter(d => !known.current.has(d.clientId)).map(d => d.clientId);
    known.current = ids;
    setSelected(previous => [...previous.filter(id => ids.has(id)), ...added]);
    if (added.length > 1) setMulti(true);
    setActiveId(previous => ids.has(previous) ? previous : drafts[0]?.clientId);
  }, [drafts]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const unlockScroll = acquireBodyScrollLock();
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); escapeAction.current();
      } else if (event.key === 'Tab' && !dialog.current?.contains(document.activeElement)) {
        event.preventDefault(); event.stopImmediatePropagation();
        dialog.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    // Give any closing parent sheet time to retire its own history entry.
    let unregister: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      unregister = registerSheetHistory({ id: titleId, close: () => close.current(), element: () => dialog.current, disabled: () => false });
    }, 0);
    return () => {
      window.clearTimeout(timer); unregister?.();
      window.removeEventListener('keydown', onKey, true);
      unlockScroll();
      previousFocus?.focus({ preventScroll: true });
    };
  }, [titleId]);

  const ordered = selected.map(id => drafts.find(d => d.clientId === id)).filter((d): d is MediaDraft => Boolean(d));
  const active = drafts.find(d => d.clientId === activeId) || ordered[0] || drafts[0];
  const selection = active && (crops[active.clientId] || initialCrop(active));
  const available = (draft: MediaDraft) => Boolean(draft.previewUrl) && ['editing', 'ready', 'error'].includes(draft.status);
  const canContinue = ordered.length > 0 && ordered.every(available);
  const changeCrop = (draft: MediaDraft, crop: MediaCropSelection) => setCrops(previous => ({ ...previous, [draft.clientId]: crop }));
  const setRatio = (choice: typeof ratioChoice, all: boolean) => {
    setCrops(previous => {
      const next = { ...previous };
      (all ? ordered : active ? [active] : []).forEach(draft => {
        next[draft.clientId] = cropFromOriginal(sourceRatio(draft), choice === 'original' ? sourceRatio(draft) : choice === 'portrait' ? .8 : 1, previous[draft.clientId] || initialCrop(draft));
      });
      return next;
    });
  };
  const photoLabel = (index: number) => t('media.photoFlow.photo', { number: index + 1 });
  const next = () => {
    if (!canContinue) return;
    if (stage === 'select') { setStage('adjust'); setActiveId(ordered[0].clientId); }
    else onApply(ordered.map(d => ({ id: d.clientId, crop: crops[d.clientId] || initialCrop(d) })));
  };
  const select = (draft: MediaDraft) => {
    setActiveId(draft.clientId);
    if (!multi) setSelected([draft.clientId]);
    else setSelected(previous => previous.includes(draft.clientId) ? previous.filter(id => id !== draft.clientId) : [...previous, draft.clientId]);
  };
  const label = stage === 'adjust' ? t('media.photoFlow.adjust') : t(purpose === 'POST' ? 'media.photoFlow.postPhotos' : 'media.photoFlow.optionPhotos');
  return createPortal(
    <div className="fixed inset-0 z-[10000] flex justify-center bg-black/60 sm:items-center sm:p-4">
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="media-photo-flow"
        dir={i18n.dir()} className="relative flex h-[100dvh] w-full max-w-lg flex-col overflow-hidden bg-white text-gray-900 shadow-2xl dark:bg-gray-950 dark:text-gray-50 sm:h-[min(900px,95dvh)] sm:rounded-2xl"
        onTouchStart={event => event.stopPropagation()} onTouchMove={event => event.stopPropagation()} onTouchEnd={event => event.stopPropagation()}
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (ratioSheet) setRatioSheet(false); else if (stage === 'adjust') setStage('select'); else onCancel(); }
          if (event.key !== 'Tab') return;
          event.stopPropagation();
          const root = ratioSheet ? dialog.current?.querySelector('[data-ratio-sheet]') : dialog.current;
          const elements = (Array.from(root?.querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]') || []) as HTMLElement[]).filter(el => el.getClientRects().length);
          const first = elements[0]; const last = elements[elements.length - 1];
          if (!root?.contains(document.activeElement)) { event.preventDefault(); first?.focus(); }
          else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}>
        <header className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-3 pb-3 pt-[max(12px,env(safe-area-inset-top))] dark:border-gray-800">
          <button type="button" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={() => stage === 'adjust' ? setStage('select') : onCancel()} aria-label={stage === 'adjust' ? t('media.photoFlow.back') : t('common.cancel')}>
            {stage === 'adjust' ? <ArrowLeft className="rtl:rotate-180" size={22} /> : <X size={22} />}
          </button>
          <div className="min-w-0 flex-1"><h2 id={titleId} className="truncate text-base font-bold">{label}</h2><p className="text-xs text-gray-500">{t('media.photoFlow.selected', { count: ordered.length })}</p></div>
          <button type="button" onClick={next} disabled={!canContinue} className="min-h-11 rounded-full bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40">{t('media.photoFlow.next')}</button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col" inert={ratioSheet || undefined}>
          {stage === 'select' ? <>
            <div className={`relative shrink-0 bg-gray-950 transition-[height] motion-reduce:transition-none ${compact ? 'h-28' : 'h-[min(45dvh,480px)]'}`} data-testid="photo-selection-preview">
              {active && selection && active.previewUrl && <MediaSourcePreview src={active.previewUrl} selection={selection} onChange={crop => changeCrop(active, crop)} label={t('media.photoFlow.move')} />}
              {active && !active.previewUrl && <div className="flex h-full items-center justify-center text-sm text-white" role="status">{t(active.status === 'error' ? 'media.photoFlow.unavailable' : 'media.photoFlow.preparing')}</div>}
              {active?.previewUrl && <button type="button" className="absolute bottom-3 start-3 flex min-h-11 items-center gap-2 rounded-full bg-black/65 px-3 text-xs font-semibold text-white"
                aria-label={t('media.photoFlow.toggleOriginal')} onClick={() => setRatio(Math.abs(selection!.aspectRatio - 1) < .001 ? 'original' : 'square', false)}><Expand size={18}/>{Math.abs(selection!.aspectRatio - 1) < .001 ? t('media.photoFlow.original') : t('media.photoFlow.square')}</button>}
              <button type="button" className="absolute bottom-3 end-3 min-h-11 rounded-full bg-black/65 px-3 text-xs text-white" onClick={() => { setCompact(v => !v); gallery.current?.scrollTo({ top: 0 }); }}>{t(compact ? 'media.photoFlow.expand' : 'media.photoFlow.collapse')}</button>
            </div>
            <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-2">
              <h3 className="text-sm font-bold">{t('media.photoFlow.yourPhotos')}</h3>
              <button type="button" aria-pressed={multi} onClick={() => {
                if (multi) setSelected(active ? [active.clientId] : []);
                setMulti(!multi);
              }} className={`flex min-h-11 items-center gap-2 rounded-full px-3 text-xs font-semibold ${multi ? 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200' : 'bg-gray-100 text-gray-700'}`}><Layers size={16}/>{t(multi ? 'media.photoFlow.multipleOn' : 'media.photoFlow.selectMultiple')}</button>
            </div>
            <div ref={gallery} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" onScroll={event => { if (event.currentTarget.scrollTop > 24) setCompact(true); }}>
              <div className="grid grid-cols-4 gap-0.5">
                <button type="button" onClick={onAdd} disabled={!canAdd} className="flex aspect-square flex-col items-center justify-center gap-2 bg-gray-100 text-xs text-blue-600 disabled:opacity-40 dark:bg-gray-900"><ImagePlus size={24}/>{t('media.photoFlow.add')}</button>
                {drafts.map((draft, index) => {
                  const position = selected.indexOf(draft.clientId);
                  return <div key={draft.clientId} className="relative aspect-square bg-gray-100 dark:bg-gray-900">
                    <button type="button" className={`relative h-full w-full overflow-hidden focus-visible:z-10 focus-visible:outline focus-visible:outline-blue-600 ${position >= 0 ? 'ring-2 ring-inset ring-blue-600' : ''}`}
                      aria-label={photoLabel(index)} aria-pressed={position >= 0} onClick={() => select(draft)}>
                      {draft.previewUrl ? <img src={draft.previewUrl} alt="" className="h-full w-full object-cover"/> : <span className="px-1 text-xs">{t(draft.status === 'error' ? 'media.photoFlow.unavailable' : 'media.photoFlow.preparing')}</span>}
                      <span className={`absolute end-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white shadow ${position >= 0 ? 'bg-blue-600' : 'bg-black/25'}`}>{position >= 0 ? position + 1 : ''}</span>
                    </button>
                    {!draft.previewUrl && <button type="button" aria-label={t('media.photoFlow.removePhoto', { number: index + 1 })} onClick={() => onRemove(draft.clientId)} className="absolute bottom-0 end-0 flex h-11 w-11 items-center justify-center text-gray-600"><X size={16}/></button>}
                  </div>;
                })}
              </div>
            </div>
          </> : <>
            <div className="flex min-h-0 flex-1 flex-col bg-gray-950 p-4">
              <div className="min-h-0 flex-1">{active?.previewUrl && selection && <MediaSourcePreview src={active.previewUrl} selection={selection} onChange={crop => changeCrop(active, crop)} label={t('media.photoFlow.move')}/>}</div>
              <p className="pt-3 text-center text-xs text-gray-300">{t('media.photoFlow.drag')}</p>
            </div>
            <div className="flex shrink-0 items-center justify-between px-4 py-2">
              <span className="text-sm text-gray-500">{Math.max(1, selected.indexOf(active?.clientId || '') + 1)} / {ordered.length}</span>
              <button type="button" onClick={() => { const r = selection?.aspectRatio; setRatioChoice(r === 1 ? 'square' : r === .8 ? 'portrait' : 'original'); setApplyAll(false); setRatioSheet(true); requestAnimationFrame(() => dialog.current?.querySelector<HTMLButtonElement>('[data-ratio-sheet] button')?.focus()); }} className="flex min-h-11 items-center gap-2 rounded-full bg-blue-50 px-4 text-sm font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-200"><Maximize size={18}/>{t('media.photoFlow.ratio')}</button>
            </div>
            <div className="flex shrink-0 gap-2 overflow-x-auto px-4 pb-4">
              {ordered.map((draft, index) => <div key={draft.clientId} className="relative shrink-0">
                <button type="button" aria-label={photoLabel(index)} aria-current={active?.clientId === draft.clientId ? 'true' : undefined} onClick={() => setActiveId(draft.clientId)} className={`h-20 w-16 overflow-hidden rounded-lg bg-gray-100 ${active?.clientId === draft.clientId ? 'ring-2 ring-blue-600 ring-offset-2' : ''}`}>
                  <MediaSourcePreview src={draft.previewUrl} selection={crops[draft.clientId] || initialCrop(draft)}/>
                </button>
                <button type="button" className="absolute -end-2 -top-2 flex h-11 w-11 items-center justify-center" aria-label={t('media.photoFlow.removePhoto', { number: index + 1 })} onClick={() => { setSelected(previous => previous.filter(id => id !== draft.clientId)); setActiveId(ordered.find(d => d.clientId !== draft.clientId)?.clientId); if (ordered.length === 1) setStage('select'); }}><span className="rounded-full bg-black/75 p-1 text-white"><X size={12}/></span></button>
              </div>)}
              {canAdd && <button type="button" onClick={() => { setStage('select'); onAdd(); }} className="flex h-20 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-gray-300 text-blue-600" aria-label={t('media.photoFlow.add')}><ImagePlus size={22}/></button>}
            </div>
          </>}
          {(error || drafts.some(d => d.error)) && <div className="max-h-24 shrink-0 overflow-y-auto px-4 py-2 text-xs text-red-600" role="alert">
            {error && <p>{error}</p>}
            {drafts.filter(d => d.error).map(d => <p key={d.clientId} className="flex items-center gap-2"><span className="flex-1">{d.error}</span><button type="button" disabled={preparing} className="flex min-h-11 items-center gap-1 disabled:opacity-40" onClick={() => onRetry(d.clientId)}><RefreshCw size={14}/>{t('common.retry')}</button></p>)}
          </div>}
          <div className="shrink-0 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-2 text-center text-xs text-gray-500">{t(stage === 'select' ? 'media.photoFlow.selectionHint' : 'media.photoFlow.originalKept')}</div>
        </div>
        {ratioSheet && <div className="absolute inset-0 z-10 flex items-end bg-black/50" onClick={() => setRatioSheet(false)}>
          <div data-ratio-sheet role="group" aria-label={t('media.photoFlow.ratio')} className="w-full rounded-t-3xl bg-white px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-4 dark:bg-gray-900" onClick={event => event.stopPropagation()}>
            <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-gray-300"/>
            <h3 className="mb-1 text-lg font-bold">{t('media.photoFlow.ratio')}</h3>
            <p className="mb-5 text-xs text-gray-500">{t('media.photoFlow.originalKept')}</p>
            <div className="grid grid-cols-3 gap-3">
              {(['portrait', 'square', 'original'] as const).map(choice => <button type="button" key={choice} aria-pressed={ratioChoice === choice} onClick={() => setRatioChoice(choice)} className={`flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl border-2 text-sm ${ratioChoice === choice ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200' : 'border-gray-100 dark:border-gray-700'}`}>
                <span className={`relative block border-2 border-current ${choice === 'portrait' ? 'h-9 w-7' : choice === 'square' ? 'h-8 w-8' : 'h-7 w-9'} rounded-sm`}>{ratioChoice === choice && <Check size={15} className="absolute inset-0 m-auto"/>}</span>
                <span>{t(`media.photoFlow.${choice}`)}</span><span className="text-[10px] opacity-70">{choice === 'portrait' ? '4:5' : choice === 'square' ? '1:1' : t('media.photoFlow.fullPhoto')}</span>
              </button>)}
            </div>
            {ordered.length > 1 && <label className="my-4 flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={applyAll} onChange={e => setApplyAll(e.target.checked)} className="h-5 w-5 accent-blue-600"/>{t('media.photoFlow.applyAll')}</label>}
            <div className="mt-4 flex items-center justify-between"><button type="button" className="min-h-11 px-2 text-sm" onClick={() => setRatioSheet(false)}>{t('common.cancel')}</button><button type="button" className="min-h-11 rounded-full bg-blue-600 px-7 font-semibold text-white" onClick={() => { setRatio(ratioChoice, applyAll); setRatioSheet(false); }}>{t('media.photoFlow.done')}</button></div>
          </div>
        </div>}
      </div>
    </div>, document.body
  );
}
