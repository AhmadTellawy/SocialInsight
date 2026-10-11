import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError } from '../services/api';
import { evictInteraction, freshInteraction, interactionGeneration, interactionKey, loadInteraction, readInteraction, subscribeInteractions, type InteractionPage } from '../utils/interactionCache';
import { startJourney } from '../utils/journeyPerformance';

export function useInteractionList<T extends { id: string }>(viewer: string | undefined, kind: string, id: string,
  enabled: boolean, fetchPage: (cursor: string | null, signal: AbortSignal) => Promise<InteractionPage<T>>) {
  const key = interactionKey(viewer, kind, id);
  const fetchRef = useRef(fetchPage); fetchRef.current = fetchPage;
  const currentKey = useRef(key); currentKey.current = key;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{key:string; message:string} | null>(null);
  const entry = useSyncExternalStore(subscribeInteractions, () => readInteraction<T>(key));
  const opening=useRef({key,enabled:false,blockedVersion:undefined as number|undefined});
  if(opening.current.key!==key || enabled&&!opening.current.enabled){opening.current={key,enabled,blockedVersion:freshInteraction(key)?undefined:entry?.version};}
  opening.current.enabled=enabled;
  const visibleEntry=entry && (opening.current.blockedVersion===undefined || entry.version!==opening.current.blockedVersion)?entry:undefined;
  const request=useRef<AbortController|null>(null);
  useEffect(()=>()=>request.current?.abort(),[key,enabled]);
  const loadPage = useCallback(async (cursor: string | null, _append = false) => {
    request.current?.abort();const controller=new AbortController();request.current=controller;
    const epoch = interactionGeneration();
    const finish = startJourney(kind + '-content');
    setBusy(key); setError(null);
    try {
      await loadInteraction(key, cursor, signal => fetchRef.current(cursor, signal),controller.signal);
      finish(currentKey.current === key && epoch === interactionGeneration() ? 'ready' : 'cancelled');
    } catch (e) {
      if (currentKey.current !== key || epoch !== interactionGeneration() || (e as Error).name === 'AbortError') { finish('cancelled'); return; }
      if (e instanceof ApiError && [401,403,404].includes(e.status)) evictInteraction(key);
      setError({key,message:'Could not load this list. Please retry.'}); finish('failed');
    } finally { setBusy(previous => previous === key ? null : previous); }
  }, [key,kind]);
  useEffect(() => {
    if (enabled && !freshInteraction(key)) void loadPage(null);
  }, [key,enabled,loadPage,entry]);
  useEffect(() => {
    const resume = () => { if (enabled && !freshInteraction(key)) void loadPage(null); };
    window.addEventListener('opiniup:resume',resume);
    return () => window.removeEventListener('opiniup:resume',resume);
  },[key,enabled,loadPage]);
  return { key, items:visibleEntry?.items || [], totalCount:visibleEntry?.totalCount ?? null, nextCursor:visibleEntry?.nextCursor || null,
    isLoading:enabled && !visibleEntry && error?.key !== key, isLoadingMore:busy === key && !!entry,
    loadError:error?.key === key ? error.message : null, loadPage };
}
