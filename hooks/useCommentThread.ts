import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Comment } from '../types';
import { api, ApiError } from '../services/api';
import { freshInteraction, interactionGeneration, interactionKey, readInteraction, subscribeInteractions, writeInteraction, evictInteraction } from '../utils/interactionCache';

export function useCommentCount(viewer: string | undefined, postId: string, fallback: number) {
  const key = interactionKey(viewer, 'comments', postId);
  return useSyncExternalStore(subscribeInteractions, () => readInteraction<Comment>(key)?.totalCount ?? fallback);
}

export function useCommentThread(viewer: string | undefined, postId: string, initialCount: number, focusId?: string) {
  const key = interactionKey(viewer, 'comments', postId);
  const [comments, setLocalComments] = useState<Comment[]>(() => freshInteraction<Comment>(key)?.items || []);
  const [nextCursor, setNextCursor] = useState<string | null>(() => freshInteraction<Comment>(key)?.nextCursor || null);
  const [isLoading, setIsLoading] = useState(!freshInteraction(key));
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const activeKey = useRef(key);
  activeKey.current = key;
  const loadCommentsPage = useCallback(async (cursor: string | null, append: boolean) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const epoch = interactionGeneration();
    const version = readInteraction(key)?.version;
    append ? setIsLoadingMore(true) : setIsLoading(!freshInteraction(key));
    setLoadError(null);
    try {
      const page = await api.getCommentsPage(postId, cursor, 30, controller.signal, append ? undefined : focusId);
      if (controller.signal.aborted || activeKey.current !== key || epoch !== interactionGeneration()) return;
      // A read started before an edit/create/delete must never undo that write.
      if (readInteraction(key)?.version !== version) return;
      const previous = readInteraction<Comment>(key);
      const items = Array.from(new Map([...(append ? previous?.items || [] : []), ...page.items].map(c => [c.id, c])).values());
      writeInteraction(key, { items, nextCursor: page.nextCursor, totalCount: page.totalCount ?? Math.max(initialCount, items.reduce((n, c) => n + 1 + (c.replies?.length || 0), 0)) });
      setLocalComments(items);
      setNextCursor(page.nextCursor);
    } catch (error: any) {
      if (controller.signal.aborted || activeKey.current !== key) return;
      if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
        evictInteraction(key);
        setLocalComments([]);
        setNextCursor(null);
      }
      setLoadError('Failed to load comments. Please try again.');
    } finally {
      if (abort.current === controller) { setIsLoading(false); setIsLoadingMore(false); }
    }
  }, [key, postId, focusId]);

  useEffect(() => {
    const cached = freshInteraction<Comment>(key);
    setLocalComments(cached?.items || []);
    setNextCursor(cached?.nextCursor || null);
    setIsLoading(!cached);
    // Reopening within five seconds needs no network roundtrip.
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled && (!cached || focusId || Date.now() - cached.updatedAt >= 5_000)) void loadCommentsPage(null, false);
    });
    return () => { cancelled = true; abort.current?.abort(); };
  }, [key, focusId, loadCommentsPage]);

  useEffect(() => subscribeInteractions(() => {
    // Revocation/session changes discard mounted data too, not just the cache.
    if (!readInteraction(key)) { abort.current?.abort(); setLocalComments([]); setNextCursor(null); }
  }), [key]);

  useEffect(() => {
    const resume = () => { void loadCommentsPage(null, false); };
    window.addEventListener('opiniup:resume', resume);
    return () => window.removeEventListener('opiniup:resume', resume);
  }, [loadCommentsPage]);

  const updateComments = (update: (previous: Comment[]) => Comment[], delta = 0, totalCount?: number) => {
    const previous = readInteraction<Comment>(key);
    const items = update(previous?.items || comments);
    writeInteraction(key, { items, nextCursor: previous?.nextCursor ?? nextCursor,
      totalCount: totalCount ?? Math.max(0, (previous?.totalCount ?? initialCount) + delta) });
    setLocalComments(items);
    setIsLoading(false);
    setLoadError(null);
  };
  return { comments, setComments: updateComments, isLoading, isLoadingMore, nextCursor, loadError, loadCommentsPage };
}
