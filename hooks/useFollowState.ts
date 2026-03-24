import { useEffect, useState, useCallback } from 'react';

// Custom Event Name
const FOLLOW_EVENT = 'onFollowStateChange';

interface FollowEventDetail {
    targetUserId: string;
    isFollowing: boolean;
}

/**
 * Dispatches a global event when a follow state changes.
 */
export const syncFollowState = (targetUserId: string, isFollowing: boolean) => {
    const event = new CustomEvent<FollowEventDetail>(FOLLOW_EVENT, {
        detail: { targetUserId, isFollowing }
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
    initialStatus: boolean
): [boolean, (status: boolean) => void] => {
    const [isFollowing, setIsFollowing] = useState(initialStatus);

    // Update local state if initialStatus prop changes (e.g. on new fetch)
    useEffect(() => {
        setIsFollowing(initialStatus);
    }, [initialStatus, targetUserId]);

    // Listen for global sync events
    useEffect(() => {
        if (!targetUserId) return;

        const handleFollowSync = (e: Event) => {
            const customEvent = e as CustomEvent<FollowEventDetail>;
            if (customEvent.detail.targetUserId === targetUserId) {
                setIsFollowing(customEvent.detail.isFollowing);
            }
        };

        window.addEventListener(FOLLOW_EVENT, handleFollowSync);
        return () => window.removeEventListener(FOLLOW_EVENT, handleFollowSync);
    }, [targetUserId]);

    // Wrapper to update state and dispatch sync event
    const setFollowStatus = useCallback((newStatus: boolean) => {
        if (!targetUserId) return;
        setIsFollowing(newStatus);
        syncFollowState(targetUserId, newStatus);
    }, [targetUserId]);

    return [isFollowing, setFollowStatus];
};
