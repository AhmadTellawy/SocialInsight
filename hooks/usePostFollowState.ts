import { useEffect, useRef, useSyncExternalStore } from 'react';
import { api } from '../services/api';
import { syncFollowState } from './useFollowState';
import { pageRequest, pagesApi } from '../services/pagesApi';

type FollowStatus = 'NONE' | 'PENDING' | 'ACTIVE';
type Snapshot = { status: FollowStatus; loading: boolean; ready: boolean };
const entries = new Map<string, { snapshot: Snapshot; listeners: Set<() => void>; revision: number; refreshQueued: boolean }>();

// Scope both cached state and asynchronous completion to the signed-in viewer.
export function usePostFollowState(viewerId: string | undefined, targetId: string | undefined, initialFollowing: boolean, menuOpen = false, isPage = false) {
  const key = JSON.stringify([viewerId, targetId, isPage]);
  const readStatus = () => isPage
    ? pageRequest<{followStatus:string;isFollowing:boolean}>('/' + targetId + '/follow')
    : api.getFollowStatus(targetId!, viewerId!);
  const scopeRef = useRef({ key, active: true });
  if (scopeRef.current.key !== key) {
    scopeRef.current.active = false;
    scopeRef.current = { key, active: true };
  }
  const scope = scopeRef.current;
  useEffect(() => {
    scope.active = true;
    return () => { scope.active = false; };
  }, [scope]);

  if (!entries.has(key)) entries.set(key, { snapshot: { status: initialFollowing ? 'ACTIVE' : 'NONE', loading: false, ready: false }, listeners: new Set(), revision: 0, refreshQueued: false });
  const entry = entries.get(key)!;
  const publish = (patch: Partial<Snapshot>) => {
    entry.snapshot = { ...entry.snapshot, ...patch };
    entry.listeners.forEach(listener => listener());
  };
  const state = useSyncExternalStore(listener => {
    entry.listeners.add(listener);
    return () => { entry.listeners.delete(listener); };
  }, () => entry.snapshot);

  const refresh = () => {
      if (!viewerId || !targetId || viewerId === targetId || !scope.active || entry.snapshot.loading) return;
      entry.refreshQueued = false;
      const revision = entry.revision;
      publish({ loading: true });
      readStatus().then(result => {
        if (!scope.active || entry.revision !== revision) return;
        const status = result.followStatus === 'ACTIVE' || result.followStatus === 'PENDING' ? result.followStatus : 'NONE';
        publish({ status, ready: true });
      }).catch(() => {
        if (scope.active && entry.revision === revision) publish({ ready: false });
      }).finally(() => {
        publish({ loading: false, ...(!scope.active ? { ready: false } : {}) });
        if (scope.active && entry.refreshQueued) refresh();
      });
  };

  useEffect(() => {
    if (!viewerId || !targetId || viewerId === targetId) return;
    const listener = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!!detail.isPage !== isPage) return;
      if (!scope.active || detail.targetUserId !== targetId) return;
      if (detail.viewerId && detail.viewerId !== viewerId) return;
      if (detail.viewerId === viewerId && detail.followStatus) {
        entry.revision++;
        entry.refreshQueued = false;
        publish({ status: detail.followStatus, ready: true });
      } else {
        // Unscoped/boolean events are invalidation hints, never another viewer's state.
        // A newer mutation must invalidate any older read, even while it is in flight.
        entry.revision++;
        entry.refreshQueued = true;
        publish({ ready: false });
        refresh();
      }
    };
    window.addEventListener('onFollowStateChange', listener);
    if (!entry.snapshot.ready || menuOpen) refresh();
    return () => window.removeEventListener('onFollowStateChange', listener);
  }, [key, menuOpen, scope]);

  const toggle = async () => {
    if (!viewerId || !targetId || !scope.active || entry.snapshot.loading) return false;
    const revision = ++entry.revision;
    publish({ loading: true });
    try {
      if (!entry.snapshot.ready) {
        const result = await readStatus();
        if (!scope.active || entry.revision !== revision) return false;
        const status = result.followStatus === 'ACTIVE' || result.followStatus === 'PENDING' ? result.followStatus : 'NONE';
        publish({ status, ready: true });
        return false;
      }
      const result = isPage ? await pagesApi.follow(targetId, entry.snapshot.status === 'ACTIVE' ? 'unfollow' : 'follow')
        .then(value => ({isFollowing:value.following,followStatus:value.following?'ACTIVE':'NONE'})) : await api.followUser(targetId, viewerId);
      if (!scope.active || entry.revision !== revision) return false;
      const status: FollowStatus = result.followStatus === 'PENDING' ? 'PENDING' : result.isFollowing ? 'ACTIVE' : 'NONE';
      publish({ status, ready: true });
      if (isPage) window.dispatchEvent(new CustomEvent('onFollowStateChange', {detail:{isPage:true,targetUserId:targetId,viewerId,followStatus:status}}));
      else syncFollowState(targetId, status === 'ACTIVE', status, viewerId);
      return true;
    } catch (error) {
      if (!scope.active) return false;
      throw error;
    } finally {
      publish({ loading: false, ...(!scope.active ? { ready: false } : {}) });
      if (scope.active && entry.refreshQueued) refresh();
    }
  };
  return { ...state, toggle };
}
