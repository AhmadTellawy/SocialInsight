import { useEffect, useState, useCallback, useRef } from 'react';

// Custom Event Name
const FOLLOW_EVENT = 'onFollowStateChange';

interface FollowEventDetail {
    targetUserId: string;
    isFollowing: boolean;
    followStatus?: 'NONE' | 'PENDING' | 'ACTIVE';
    viewerId?: string;
}

/**
 * Dispatches a global event when a follow state changes.
 */
export const syncFollowState = (targetUserId: string, isFollowing: boolean, followStatus?: 'NONE' | 'PENDING' | 'ACTIVE', viewerId?: string) => {
    const event = new CustomEvent<FollowEventDetail>(FOLLOW_EVENT, {
        detail: { targetUserId, isFollowing, followStatus, viewerId }
    });
    window.dispatchEvent(event);
};

/**
 * Hook to listen to global follow state changes for a specific user.
 * 
 * @param targetUserId The ID of the user to track follow status for.
 * @param initialStatus The initial follow status (usually passed from props/API).
 * @returns [isFollowing, setLocalFollowingState]
 */
export const useFollowState = (
    targetUserId: string | undefined,
    initialStatus: boolean,
    viewerId?: string
): [boolean, (status: boolean) => void] => {
    const identity = JSON.stringify([viewerId, targetUserId]);
    const scopeRef = useRef({ identity, active: true });
    if (scopeRef.current.identity !== identity) {
        scopeRef.current.active = false;
        scopeRef.current = { identity, active: true };
    }
    const scope = scopeRef.current;
    useEffect(() => {
        scope.active = true;
        return () => { scope.active = false; };
    }, [scope]);
    const [previousViewerId, setPreviousViewerId] = useState(viewerId);
    const [isFollowing, setIsFollowing] = useState(initialStatus);
    const [prevStatus, setPrevStatus] = useState(initialStatus);
    const [prevUserId, setPrevUserId] = useState(targetUserId);

    // Update state synchronously during render if props change to prevent flickering
    if (viewerId !== previousViewerId || targetUserId !== prevUserId || initialStatus !== prevStatus) {
        setPreviousViewerId(viewerId);
        setPrevUserId(targetUserId);
        setPrevStatus(initialStatus);
        setIsFollowing(initialStatus);
    }

    // Listen for global sync events
    useEffect(() => {
        if (!targetUserId) return;

        const handleFollowSync = (e: Event) => {
            const customEvent = e as CustomEvent<FollowEventDetail>;
            if (scope.active && customEvent.detail.viewerId === viewerId && viewerId && customEvent.detail.targetUserId === targetUserId) {
                setIsFollowing(customEvent.detail.isFollowing);
            }
        };

        window.addEventListener(FOLLOW_EVENT, handleFollowSync);
        return () => window.removeEventListener(FOLLOW_EVENT, handleFollowSync);
    }, [targetUserId, viewerId, scope]);

    // Wrapper to update state and dispatch sync event
    const setFollowStatus = useCallback((newStatus: boolean) => {
        if (!targetUserId || !scope.active) return;
        setIsFollowing(newStatus);
        syncFollowState(targetUserId, newStatus, undefined, viewerId);
    }, [targetUserId, viewerId, scope]);

    return [isFollowing, setFollowStatus];
};
