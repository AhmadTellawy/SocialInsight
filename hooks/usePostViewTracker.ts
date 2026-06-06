import { useEffect, useRef, useState, MutableRefObject } from 'react';
import { api } from '../services/api';

// A global Set to remember which posts we've tracked in this browser session to avoid spamming the backend
const trackedPostsInSession = new Set<string>();

const getGuestSessionId = () => {
    if (typeof window === 'undefined') return '';
    let sessionId = localStorage.getItem('guest_session_id');
    if (!sessionId) {
        // Fallback random ID generation since uuid is not installed in the client
        sessionId = typeof crypto !== 'undefined' && crypto.randomUUID 
            ? crypto.randomUUID() 
            : 'guest_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('guest_session_id', sessionId);
    }
    return sessionId;
};

export const usePostViewTracker = (
    postId: string, 
    viewRef: MutableRefObject<HTMLElement | null>,
    options?: { sourceSurface?: string; positionInFeed?: number; initialViewCount?: number }
) => {
    const [viewCount, setViewCount] = useState<number>(options?.initialViewCount || 0);
    const viewLogged = useRef(false);
    const isObserving = useRef(false);

    useEffect(() => {
        if (!postId || viewLogged.current || trackedPostsInSession.has(postId)) return;

        let timeoutId: NodeJS.Timeout;
        
        const handleIntersect = (entries: IntersectionObserverEntry[]) => {
            const [entry] = entries;
            
            if (entry.isIntersecting) {
                // Element is at least 50% visible, start 2-second timer
                if (!isObserving.current) {
                    isObserving.current = true;
                    timeoutId = setTimeout(async () => {
                        if (viewLogged.current || trackedPostsInSession.has(postId)) return;
                        
                        viewLogged.current = true;
                        trackedPostsInSession.add(postId);
                        
                        try {
                            const guestSessionId = getGuestSessionId();
                            // Optional: If we still want to log POST_VIEW_END for existing analytics silently, 
                            // we could do it here or let the backend handle it. We rely on the backend endpoint now.
                            
                            const response = await api.recordPostView(postId, {
                                source: options?.sourceSurface || 'FEED',
                                deviceType: 'WEB', // Assuming WEB for now, could be passed dynamically
                                guestSessionId
                            });
                            
                            if (response?.recorded) {
                                setViewCount(response.viewCount);
                            } else if (response?.viewCount !== undefined) {
                                // Update to latest count even if not recorded newly
                                setViewCount(response.viewCount);
                            }
                        } catch (error) {
                            console.error('Failed to log post view:', error);
                            // Revert tracking flag if network failed so it can try again
                            viewLogged.current = false;
                            trackedPostsInSession.delete(postId);
                        }
                    }, 2000); // 2 seconds dwell time
                }
            } else {
                // Element left 50% visibility before 2 seconds elapsed
                isObserving.current = false;
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
            }
        };

        const observer = new IntersectionObserver(handleIntersect, {
            threshold: 0.5 // Require 50% visibility
        });

        if (viewRef.current) {
            observer.observe(viewRef.current);
        }

        return () => {
            if (timeoutId) clearTimeout(timeoutId);
            observer.disconnect();
            isObserving.current = false;
        };
    }, [postId, options?.sourceSurface, viewRef]);

    return { viewCount };
};
