import { useEffect, useState, MutableRefObject } from 'react';
import { api, ApiError, getAuthSessionIdentity } from '../services/api';

const trackedViews = new Map<string, number>();
const pendingViews = new Set<string>();
const VIEW_WINDOW_MS = 60 * 60 * 1000;

export const usePostViewTracker = (
    postId: string,
    viewRef: MutableRefObject<HTMLElement | null>,
    options?: { sourceSurface?: string; positionInFeed?: number; initialViewCount?: number }
) => {
    const [viewCount, setViewCount] = useState(options?.initialViewCount || 0);
    const actor = getAuthSessionIdentity();
    const source = options?.sourceSurface || 'FEED';
    useEffect(() => { setViewCount(options?.initialViewCount || 0); }, [postId]);
    useEffect(() => {
        // An offscreen share image is not a viewed post.
        if (!postId || source === 'SHARE_CAPTURE') return;
        const key = `${actor || 'guest'}:${postId}`;
        for (const [trackedKey, time] of trackedViews) {
            if (Date.now() - time >= VIEW_WINDOW_MS) trackedViews.delete(trackedKey);
        }
        if (trackedViews.has(key)) return;
        let disposed = false;
        let permanentlyRejected = false;
        let visible = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const schedule = (delay = 2000) => {
            if (timer) clearTimeout(timer);
            if (!disposed && !permanentlyRejected && visible && document.visibilityState === 'visible' && !trackedViews.has(key)) timer = setTimeout(record, delay);
        };
        const record = async () => {
            timer = undefined;
            if (disposed || !visible || document.visibilityState !== 'visible' || getAuthSessionIdentity() !== actor || trackedViews.has(key)) return;
            if (pendingViews.has(key)) { schedule(2000); return; }
            pendingViews.add(key);
            try {
                const response = await api.recordPostView(postId, { source, deviceType: 'WEB' });
                trackedViews.set(key, Date.now());
                if (trackedViews.size > 1000) trackedViews.delete(trackedViews.keys().next().value!);
                if (!disposed && getAuthSessionIdentity() === actor && typeof response?.viewCount === 'number') setViewCount(response.viewCount);
            } catch (error) {
                if (error instanceof ApiError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) {
                    permanentlyRejected = true;
                    return;
                }
                // Lost replies remain retryable; the server deduplicates retries.
                schedule(15_000);
            } finally { pendingViews.delete(key); }
        };
        const observer = new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting && entry.intersectionRatio >= 0.5;
            if (visible) schedule();
            else if (timer) { clearTimeout(timer); timer = undefined; }
        }, { threshold: 0.5 });
        const onOnline = () => schedule();
        const onVisibility = () => schedule();
        if (viewRef.current) observer.observe(viewRef.current);
        window.addEventListener('online', onOnline);
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            disposed = true;
            if (timer) clearTimeout(timer);
            observer.disconnect();
            window.removeEventListener('online', onOnline);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [postId, source, viewRef, actor]);
    return { viewCount };
};
