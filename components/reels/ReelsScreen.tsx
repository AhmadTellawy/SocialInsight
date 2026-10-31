import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Video, ChevronUp, ChevronDown, RotateCcw } from 'lucide-react';
import { Survey, UserProfile } from '../../types';
import { reelsApi } from '../../services/reelsApi';
import { api } from '../../services/api';
import { SurveyCard } from '../SurveyCard';
import { ReelPlayer } from './ReelPlayer';
import { UserAvatar } from '../UserAvatar';

type CardProps = React.ComponentProps<typeof SurveyCard>;
type ReelsScreenProps = { userProfile?: UserProfile; onAuthorClick: NonNullable<CardProps['onAuthorClick']>; onShareToFeed: CardProps['onShareToFeed']; onLike: CardProps['onLike']; onAnalysisClick: (id: string) => void; onDelete: CardProps['onDelete']; onEditDraft?: CardProps['onEditDraft'] };
export function ReelsScreen(props: ReelsScreenProps) {
  const location = useLocation();
  // App retains the active tab behind creation and detail overlays.
  // Unmount requests/player/navigation effects as soon as this route is inactive.
  return location.pathname === '/reels' ? <ActiveReelsScreen {...props} /> : null;
}
function ActiveReelsScreen({ userProfile, onAuthorClick, onShareToFeed, onLike, onAnalysisClick, onDelete, onEditDraft }: ReelsScreenProps) {
  const { i18n } = useTranslation(); const ar = i18n.language.startsWith('ar');
  const navigate = useNavigate(); const location = useLocation();
  const initialId = useRef(new URLSearchParams(location.search).get('reel'));
  const navigatedId = useRef(initialId.current);
  const [items, setItems] = useState<Survey[]>([]); const [cursor, setCursor] = useState<string | null>(null);
  const [active, setActive] = useState(0); const [sheet, setSheet] = useState(false);
  const [hiddenItem, setHiddenItem] = useState<Survey>(); const [restoring, setRestoring] = useState(false);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [enabled, setEnabled] = useState(true);
  const [retry, setRetry] = useState(0); const loadingMore = useRef(false); const scrolling = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null); const alive = useRef(true);
  const settleTimer = useRef<ReturnType<typeof setTimeout>>();
  const mutationVersion = useRef(0);
  const activeRef = useRef(active); activeRef.current = active;
  const sheetRef = useRef(sheet); sheetRef.current = sheet;
  const onSheetChange = useCallback((open: boolean) => {
    sheetRef.current = open; clearTimeout(settleTimer.current);
    const node = scrolling.current;
    if (node) node.scrollTo({ top: activeRef.current * node.clientHeight, behavior: 'instant' });
    setSheet(open);
  }, []);
  useEffect(() => () => clearTimeout(settleTimer.current), []);
  useEffect(() => { if (!hiddenItem) return; const timer = setTimeout(() => setHiddenItem(undefined), 8000); return () => clearTimeout(timer); }, [hiddenItem]);
  const hide = (id: string) => {
    setHiddenItem(items.find(item => item.id === id));
    setItems(list => list.filter(item => item.id !== id)); setActive(0); setSheet(false);
    scrolling.current?.scrollTo({ top: 0, behavior: 'instant' });
  };
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get('reel');
    if (requested && requested !== navigatedId.current) {
      initialId.current = requested; navigatedId.current = requested; setRetry(value => value + 1);
    }
  }, [location.search]);
  useEffect(() => {
    alive.current = true; const abort = new AbortController(); setLoading(true); setError(''); setItems([]); setActive(0);
    const load = async () => {
      try {
        const config = await reelsApi.config(abort.signal); if (abort.signal.aborted) return;
        setEnabled(config.enabled); if (!config.enabled) return;
        const page = await reelsApi.feed(null, abort.signal, initialId.current || undefined);
        if (abort.signal.aborted) return;
        if (initialId.current && !page.data.some(item => item.id === initialId.current)) throw new Error(ar ? 'هذا الريل غير متاح.' : 'This Reel is unavailable.');
        setItems(page.data); setCursor(page.nextCursor);
      } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'Unable to load Reels'); }
      finally { if (!abort.signal.aborted) setLoading(false); }
    }; void load();
    return () => { alive.current = false; abort.abort(); };
  }, [userProfile?.id, retry]);
  useEffect(() => {
    if (!items[active]) return;
    navigatedId.current = items[active].id;
    navigate(`/reels?reel=${encodeURIComponent(items[active].id)}`, { replace: true });
    setSheet(false);
  }, [active, items[active]?.id]);
  useEffect(() => {
    const id = items[active]?.id; if (!id) return;
    const abort = new AbortController();
    const version = mutationVersion.current;
    void api.getSurveyById(id, userProfile?.id, abort.signal).then(fresh => {
      if (!abort.signal.aborted && mutationVersion.current === version) setItems(list => list.map(item => item.id === id ? fresh : item));
    }).catch(() => {});
    return () => abort.abort();
  }, [items[active]?.id, userProfile?.id]);
  const like: NonNullable<CardProps['onLike']> = async (id, selected) => {
    mutationVersion.current++;
    const result = onLike ? await onLike(id, selected) : await api.likeSurvey(id);
    if (result === false) return false;
    if (alive.current) setItems(list => list.map(item => item.id !== id ? item : {
      ...item, isLiked: result && typeof result === 'object' ? result.isLiked : selected,
      likes: result && typeof result === 'object' ? result.likes : Math.max(0, item.likes + (item.isLiked === selected ? 0 : selected ? 1 : -1))
    }));
    return result;
  };
  const share: CardProps['onShareToFeed'] = onShareToFeed ? async (...args) => {
    mutationVersion.current++;
    const result = await onShareToFeed(...args);
    if (alive.current && (result === 'shared' || result === 'unshared')) setItems(list => list.map(item => item.id !== args[0].id ? item : { ...item, hasReposted: result === 'shared', repostCount: Math.max(0, (item.repostCount || 0) + (result === 'shared' ? 1 : -1)) }));
    return result;
  } : undefined;
  const more = useCallback(async () => {
    if (!cursor || loadingMore.current) return;
    loadingMore.current = true;
    try { const page = await reelsApi.feed(cursor); if (alive.current) { setItems(current => [...current, ...page.data.filter(item => !current.some(known => known.id === item.id))]); setCursor(page.nextCursor); setError(''); } }
    catch { if (alive.current) setError(ar ? 'تعذر تحميل الريلز التالية.' : 'Unable to load more Reels.'); }
    finally { loadingMore.current = false; }
  }, [cursor, ar]);
  useEffect(() => { if (items.length && active >= items.length - 2) void more(); }, [active, items.length, more]);
  const move = (delta: number) => { if (sheet) return; const node = scrolling.current; if (node) node.scrollTo({ top: Math.max(0, Math.min(items.length - 1, active + delta)) * node.clientHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); };
  return <section className="fixed top-0 bottom-[60px] inset-x-0 z-30 max-w-md mx-auto bg-gray-950 text-white" aria-label={ar ? 'الريلز' : 'Reels'}>
    <header className="absolute top-0 inset-x-0 z-20 flex justify-between items-center px-5 py-5 bg-gradient-to-b from-black/60 to-transparent pointer-events-none"><h1 className="text-xl font-bold">{ar ? 'الريلز' : 'Reels'}</h1><button disabled={!enabled} aria-label={ar ? 'إنشاء ريل' : 'Create Reel'} className="rounded-full bg-black/20 p-2 pointer-events-auto disabled:opacity-40" onClick={() => navigate(userProfile ? '/create/reel' : '/login')}><Plus size={25} /></button></header>
    {loading ? <div className="h-full grid place-items-center" role="status">{ar ? 'تحميل الريلز…' : 'Loading Reels…'}</div> : !items.length ? <div className="h-full flex flex-col justify-center items-center px-8 text-center gap-4"><Video size={42} className="text-blue-400" /><h2 className="font-bold">{!enabled ? (ar ? 'الريلز قريبًا' : 'Reels are coming soon') : error || (ar ? 'كن أول من ينشر ريل' : 'Be the first to share a Reel')}</h2>{error ? <button onClick={() => setRetry(x => x + 1)} className="flex gap-2 rounded-xl bg-white/10 px-5 py-3"><RotateCcw size={18} />{ar ? 'حاول مجددًا' : 'Try again'}</button> : enabled && <button className="rounded-xl bg-blue-600 px-5 py-3" onClick={() => navigate(userProfile ? '/create/reel' : '/login')}>{ar ? 'إنشاء ريل' : 'Create Reel'}</button>}</div> : <>
      <div ref={scrolling} tabIndex={0} aria-label={ar ? 'اسحب للأعلى أو للأسفل لتغيير الريل، ولليمين لزيارة المنشئ' : 'Swipe up or down for Reels; swipe right for the creator'} className={`h-full snap-y snap-mandatory overscroll-contain no-scrollbar outline-none ${sheet ? 'overflow-hidden' : 'overflow-y-auto'}`} style={{ touchAction: 'pan-y' }}
        onScroll={e => { const node = e.currentTarget; clearTimeout(settleTimer.current); if (sheetRef.current) return; settleTimer.current = setTimeout(() => { if (sheetRef.current || !node.clientHeight) return; const index = Math.round(node.scrollTop / node.clientHeight); if (index !== activeRef.current && items[index]) setActive(index); }, 120); }}
        onKeyDown={e => { if ((e.target as HTMLElement).closest('button,input,textarea')) return; if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); move(e.key === 'ArrowDown' ? 1 : -1); } else if (e.key === 'ArrowRight' && !sheet) onAuthorClick(items[active].author); }}
        onTouchStart={e => { touch.current = !(e.target as HTMLElement).closest('button,input,textarea') && e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null; }}
        onTouchEnd={e => { const start = touch.current; touch.current = null; if (!start || sheet) return; const dx = e.changedTouches[0].clientX - start.x, dy = e.changedTouches[0].clientY - start.y; if (dx > 80 && dx > Math.abs(dy) * 1.5) onAuthorClick(items[active].author); }}>
        {items.map((item, index) => <article key={item.id} className="relative h-full snap-start snap-always overflow-hidden" aria-label={`${ar ? 'ريل' : 'Reel'} ${index + 1}`}>
          {index === active && <ReelPlayer id={item.id} active={!sheet} />}
          <div className="absolute inset-x-0 bottom-0 h-1/2 pointer-events-none bg-gradient-to-t from-black/80 to-transparent" />
          <div className="absolute bottom-6 left-5 right-24 space-y-3" dir={ar ? 'rtl' : 'ltr'}><button onClick={() => onAuthorClick(item.author)} className="flex items-center gap-2 text-start"><UserAvatar src={item.author.avatar} mediaId={item.author.avatarMediaId} media={item.author.avatarMedia} name={item.author.name} className="w-10 h-10 rounded-full border border-white/30" /><span className="font-bold text-sm">{item.author.name}</span></button><p dir="auto" className="text-sm line-clamp-2">{item.title}</p><p dir="auto" className="text-xs text-white/80 line-clamp-2">{item.description}</p></div>
          {index === active && <div className="absolute right-2 bottom-4 w-16"><SurveyCard key={item.id} survey={item} userProfile={userProfile} reelOverlay onReelSheetChange={onSheetChange} onReelHidden={hide} onEditDraft={onEditDraft} onAuthorClick={onAuthorClick} onShareToFeed={share} onLike={like} onAnalysisClick={() => onAnalysisClick(item.id)} onDelete={(id, deleted) => { setItems(list => list.filter(post => post.id !== id && !deleted?.includes(post.id))); setActive(0); scrolling.current?.scrollTo({ top: 0, behavior: 'instant' }); onDelete?.(id, deleted); }} /></div>}
        </article>)}
      </div>
      <div className="absolute left-2 top-1/2 -translate-y-1/2 hidden sm:flex flex-col gap-3"><button className="p-2 bg-black/25 rounded-full disabled:opacity-30" disabled={active === 0 || sheet} aria-label={ar ? 'الريل السابق' : 'Previous Reel'} onClick={() => move(-1)}><ChevronUp size={20} /></button><button className="p-2 bg-black/25 rounded-full disabled:opacity-30" disabled={active === items.length - 1 || sheet} aria-label={ar ? 'الريل التالي' : 'Next Reel'} onClick={() => move(1)}><ChevronDown size={20} /></button></div>
      {error && <button role="alert" className="absolute bottom-1 inset-x-20 text-xs rounded-xl bg-red-700 p-2" onClick={() => void more()}>{error} · {ar ? 'حاول مجددًا' : 'Try again'}</button>}
    </>}
    {hiddenItem && <div role="status" className="absolute bottom-4 inset-x-4 z-30 flex justify-between items-center gap-3 rounded-xl bg-white p-4 text-sm text-gray-900 shadow-lg"><span>{ar ? 'تم إخفاء الريل' : 'Reel hidden'}</span><button disabled={restoring} className="font-bold text-blue-600 p-2" onClick={async () => {
      setRestoring(true); const item = hiddenItem;
      try { await api.unhidePost(item.id); if (alive.current) { setItems(list => [item, ...list.filter(post => post.id !== item.id)]); setActive(0); scrolling.current?.scrollTo({top:0,behavior:'instant'}); setHiddenItem(undefined); } }
      catch { if (alive.current) setError(ar ? 'تعذر استعادة الريل.' : 'Unable to restore this Reel.'); }
      finally { if (alive.current) setRestoring(false); }
    }}>{ar ? 'تراجع' : 'Undo'}</button></div>}
  </section>;
}
