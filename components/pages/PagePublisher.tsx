import React, { useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Survey, UserProfile } from '../../types';
import { BusinessPage, pagesApi } from '../../services/pagesApi';
import { PageAvatar, usePageText } from './PageUi';
import { usePagesAvailability } from '../../hooks/usePagesAvailability';
import './pages.css';

/** One publisher context shared by the existing editors; no duplicate post settings. */
export function usePagePublisher(user: UserProfile, draft: Survey | undefined,
  submit: (value: Partial<Survey>) => void | Promise<void>,
  save?: (value: Partial<Survey>) => void | Promise<void>) {
  const location = useLocation();
  const availability = usePagesAvailability(user.id);
  const { text: translate } = usePageText();
  const text = (arabic: string, english: string) => translate(english, arabic);
  const initial = draft?.pageId || new URLSearchParams(location.search).get('pageId') || '';
  const [pageId, setPageId] = useState(initial);
  const [pages, setPages] = useState<BusinessPage[]>([]);
  const [pagesLoading, setLoading] = useState(true);
  const loading = availability.loading || (availability.available && pagesLoading);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [next,setNext]=useState<string|null>(null);
  const [moreBusy,setMoreBusy]=useState(false);
  const requestKey = useRef(crypto.randomUUID());
  const requests = useRef<AbortController | null>(null);
  useEffect(() => {
    if(!user.id || !availability.available){setPages([]);setNext(null);setError(false);setLoading(false);return;}
    const controller = new AbortController();
    requests.current = controller;
    setPages([]); setLoading(true); setError(false);
    (async () => {
      const result=await pagesApi.mine('',controller.signal);
      const collected=result.items.filter(page=>page.capabilities?.includes('manageContent'));
      if(initial&&!collected.some(page=>page.id===initial)){
        const selected=await pagesApi.manage(initial,controller.signal);
        if(selected.capabilities?.includes('manageContent'))collected.unshift(selected);
      }
      if (!controller.signal.aborted){setPages(collected);setNext(result.nextCursor);}
    })().catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [user.id, retry, availability.available, initial]);
  const page = availability.available ? pages.find(item => item.id === pageId) : undefined;
  useEffect(()=>{
    if(!pageId || !availability.available)return;const controller=new AbortController();
    const refresh=async()=>{try{const current=await pagesApi.manage(pageId,controller.signal);
      if(!controller.signal.aborted)setPages(previous=>current.capabilities?.includes('manageContent')?previous.map(value=>value.id===pageId?current:value):previous.filter(value=>value.id!==pageId));
    }catch{if(!controller.signal.aborted)setPages(previous=>previous.filter(value=>value.id!==pageId));}};
    const timer=setInterval(()=>void refresh(),30000);window.addEventListener('focus',refresh);
    return()=>{controller.abort();clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[pageId,user.id,availability.available]);
  const loadMore=async()=>{const controller=requests.current;if(!next||moreBusy||!availability.available||!controller||controller.signal.aborted)return;setMoreBusy(true);try{const result=await pagesApi.mine(next,controller.signal);if(!controller.signal.aborted){setPages(previous=>[...previous,...result.items.filter(value=>value.capabilities?.includes('manageContent')&&!previous.some(item=>item.id===value.id))]);setNext(result.nextCursor);}}catch{if(!controller.signal.aborted)setError(true);}finally{setMoreBusy(false);}};
  const enrich = (data: Partial<Survey>) => {
    if (pageId && (!availability.available || loading || !page)) throw new Error(text('تحقق من صلاحية النشر باسم الصفحة ثم أعد المحاولة.', 'Verify your Page publishing access and try again.'));
    if (pageId && (data.groupId || data.targetGroups?.length || ['Groups', 'ProfileAndGroups'].includes(data.targetAudience || ''))) {
      throw new Error(text('لا يمكن النشر باسم صفحة داخل مجموعة. غيّر وجهة النشر أو اختر حسابك الشخصي.', 'Pages cannot publish in groups. Change the destination or select your personal account.'));
    }
    return { ...data, pageId: pageId || null, pageCreateKey: requestKey.current };
  };
  return { pageId, page, pages: availability.available ? pages : [], available: availability.available, loading, error: availability.available && error, next, moreBusy, loadMore, accessLost:!!pageId&&!loading&&!page, writeBlocked:!!pageId&&(loading||!availability.available||!page), locked: !!draft?.id,
    select: (id: string) => { if (!draft?.id && (!id || availability.available)) setPageId(id); }, retry: () => { availability.retry(); setRetry(value => value + 1); },
    submit: async (data: Partial<Survey>) => submit(enrich(data)),
    save: save ? async (data: Partial<Survey>) => save(enrich(data)) : undefined };
}

export function PagePublisher({ publisher, user, groupDestination }: {
  publisher: ReturnType<typeof usePagePublisher>; user: UserProfile; groupDestination: boolean;
}) {
  const { text: translate } = usePageText();
  const text = (arabic: string, english: string) => translate(english, arabic);
  if (!publisher.available && !publisher.pageId) return null;
  return <section className="space-y-2 rounded-2xl border border-gray-200 bg-gray-50 p-3">
    {publisher.page&&<div className="flex items-center gap-3"><PageAvatar page={publisher.page} small/><strong>{publisher.page.name}</strong></div>}
    <label className="block text-sm font-semibold">{text('النشر باسم', 'Publishing as')}
      <select className="mt-2 min-h-11 w-full rounded-xl border border-[#7c8f9d] bg-white px-3 text-sm"
        value={publisher.pageId} disabled={publisher.locked}
        onChange={event => publisher.select(event.target.value)}>
        <option value="">{user.name} · {text('حساب شخصي', 'Personal account')}</option>
        {publisher.pageId && !publisher.page && <option value={publisher.pageId}>{publisher.loading?text('جارٍ التحقق من الصفحة', 'Verifying Page'):text('صلاحية الصفحة غير متاحة', 'Page access unavailable')}</option>}
        {publisher.pages.map(page => <option key={page.id} value={page.id} disabled={groupDestination && page.id !== publisher.pageId}>
          {page.name} · {text('صفحة', 'Page')}
        </option>)}
      </select>
    </label>
    {publisher.next&&<button type="button" className="min-h-11 text-sm text-blue-700 underline" disabled={publisher.moreBusy} onClick={()=>void publisher.loadMore()}>{text('تحميل المزيد من الصفحات','Load more Pages')}</button>}
    {publisher.accessLost&&<p role="alert" className="text-sm text-red-700">{publisher.locked
      ? text('صلاحية إدارة هذه الصفحة غير متاحة. تحقق من الاتصال ثم أعد التحقق من الصلاحية.','Page management access is unavailable. Check your connection, then check access again.')
      : text('صلاحية إدارة هذه الصفحة غير متاحة. تحقق من الاتصال أو اختر ناشراً متاحاً.','Page management access is unavailable. Check your connection or choose an available publisher.')}</p>}
    {publisher.pageId && <p className="text-xs text-gray-600">{text('يظهر اسم الصفحة للجمهور. يبقى منفّذ النشر في سجل الإدارة فقط.', 'The public sees the Page name. The publishing team member is recorded only in management history.')}</p>}
    {groupDestination && <p className="text-xs text-gray-600">{text('النشر داخل المجموعات متاح باسم حسابك الشخصي.', 'Group publishing uses your personal account.')}</p>}
    {publisher.error && <p role="alert" className="text-xs text-red-700">{text('تعذر تحميل صفحاتك.', 'Unable to load your Pages.')} <button type="button" className="min-h-11 underline" onClick={publisher.retry}>{text('إعادة المحاولة', 'Retry')}</button></p>}
  </section>;
}

export function PagePublisherRecovery({publisher,user,onClose}:{publisher:ReturnType<typeof usePagePublisher>;user:UserProfile;onClose:()=>void}) {
  const {text,ar}=usePageText();
  const dialogRef=useRef<HTMLDialogElement>(null);
  const closeRef=useRef<HTMLButtonElement>(null);
  const titleId=useId(),descriptionId=useId();
  useEffect(()=>{
    const dialog=dialogRef.current;
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    if(dialog&&!dialog.open)dialog.showModal();
    closeRef.current?.focus();
    return()=>{
      dialog?.close();
      requestAnimationFrame(()=>{
        const editorControl=document.querySelector<HTMLElement>('[data-post-editor] button:not(:disabled), [data-post-editor] input:not(:disabled), [data-post-editor] [contenteditable="true"]');
        if(editorControl)editorControl.focus();
        else if(previous?.isConnected&&previous!==document.body&&previous!==document.documentElement)previous.focus();
      });
    };
  },[]);
  useEffect(()=>{
    const dialog=dialogRef.current;
    if(!publisher.loading&&dialog?.open&&!dialog.contains(document.activeElement))closeRef.current?.focus();
  },[publisher.loading]);
  return <dialog ref={dialogRef} aria-labelledby={titleId} aria-describedby={descriptionId} dir={ar?'rtl':'ltr'}
    onCancel={event=>{event.preventDefault();closeRef.current?.focus();}}
    className="pages-shell rounded-2xl border border-gray-200 bg-white shadow-xl backdrop:bg-slate-900/40"
    style={{margin:'auto',minHeight:0,background:'#fff',width:'calc(100% - 2rem)',maxWidth:'32rem',maxHeight:'calc(100dvh - 2rem)',overflowY:'auto',padding:'max(1.5rem, env(safe-area-inset-top)) 1.5rem max(1.5rem, env(safe-area-inset-bottom))'}}>
    <div className="space-y-4">
    <h2 id={titleId} className="text-lg font-bold">{text('Check Page access','التحقق من صلاحية الصفحة')}</h2>
    <p id={descriptionId} className="text-sm text-gray-600">{text('Your saved draft remains available. Check access to resume editing. Closing the editor discards only unsaved changes.','المسودة المحفوظة باقية. أعد التحقق لاستئناف التحرير. إغلاق المحرر يزيل التعديلات غير المحفوظة فقط.')}</p>
    <PagePublisher publisher={publisher} user={user} groupDestination={false}/>
    <div className="flex flex-wrap gap-3">
      <button ref={closeRef} type="button" className="pages-button" onClick={onClose}>{text('Close editor','إغلاق المحرر')}</button>
      <button type="button" className="pages-button primary" aria-disabled={publisher.loading}
        onClick={()=>{if(!publisher.loading)publisher.retry();}}>
        {publisher.loading?text('Checking access…','جارٍ التحقق من الصلاحية…'):text('Check access again','التحقق من الصلاحية مجدداً')}
      </button>
    </div>
    </div>
  </dialog>;
}
