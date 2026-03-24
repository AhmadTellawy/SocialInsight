import { useState, useEffect, useCallback } from 'react';
import { MembershipStatus, Survey, normalizeSurvey } from '../types';

export interface GroupStats {
    postsCount: number;
    votesCount: number;
    membersCount: number;
}

// ------------------------------------------------------------------
// 1. Membership Hook
// ------------------------------------------------------------------
export function useGroupMembership(groupId: string, userId?: string) {
    const [membershipStatus, setMembershipStatus] = useState<MembershipStatus>('NOT_JOINED');
    const [role, setRole] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let isMounted = true;
        setIsLoading(true);

        // Fetch initial membership status
        const url = userId ? `/api/groups/${groupId}/membership?currentUserId=${userId}` : `/api/groups/${groupId}/membership`;
        fetch(url)
            .then((res) => {
                if (!res.ok) throw new Error('Failed to fetch membership status');
                return res.json();
            })
            .then((data: { status: MembershipStatus, role?: string }) => {
                if (isMounted) {
                    setMembershipStatus(data.status);
                    setRole(data.role || null);
                    setError(null);
                }
            })
            .catch((err) => {
                if (isMounted) setError(err.message);
            })
            .finally(() => {
                if (isMounted) setIsLoading(false);
            });

        return () => {
            isMounted = false;
        };
    }, [groupId]);

    const joinGroup = async () => {
        try {
            if (!userId) throw new Error('Must be logged in to join');
            setIsLoading(true);
            const res = await fetch(`/api/groups/${groupId}/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentUserId: userId })
            });
            if (!res.ok) throw new Error('Failed to join group');
            const data = await res.json();
            setMembershipStatus(data.status);
            setRole(data.role || 'Member');
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const leaveGroup = async () => {
        try {
            if (!userId) throw new Error('Must be logged in to leave');
            setIsLoading(true);
            const res = await fetch(`/api/groups/${groupId}/leave`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentUserId: userId })
            });
            if (!res.ok) throw new Error('Failed to leave group');
            setMembershipStatus('NOT_JOINED');
            setRole(null);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const requestToJoin = async () => {
        try {
            if (!userId) throw new Error('Must be logged in to request join');
            setIsLoading(true);
            const res = await fetch(`/api/groups/${groupId}/request-join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentUserId: userId })
            });
            if (!res.ok) throw new Error('Failed to request to join group');
            setMembershipStatus('PENDING');
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    return {
        membershipStatus,
        role,
        isLoading,
        error,
        joinGroup,
        leaveGroup,
        requestToJoin,
    };
}

// ------------------------------------------------------------------
// 2. Posts Hook (Pagination / Infinite Scroll)
// ------------------------------------------------------------------
export function useGroupPosts(groupId: string, userId?: string) {
    const [posts, setPosts] = useState<Survey[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);

    const fetchPosts = useCallback(async (pageNum: number, isInitial = false) => {
        try {
            if (isInitial) setIsLoading(true);
            else setIsFetchingNextPage(true);
            setError(null);

            const url = `/api/groups/${groupId}/posts?page=${pageNum}&limit=10${userId ? `&currentUserId=${userId}` : ''}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('Failed to fetch posts');
            const data: { posts: any[]; hasMore: boolean } = await res.json();
            const normalizedPosts = data.posts.map(normalizeSurvey);

            setPosts((prev) => (isInitial ? normalizedPosts : [...prev, ...normalizedPosts]));
            setHasMore(data.hasMore);
        } catch (err: any) {
            setError(err.message);
        } finally {
            if (isInitial) setIsLoading(false);
            else setIsFetchingNextPage(false);
        }
    }, [groupId, userId]);

    const updatePostLikeStatus = useCallback((postId: string, isLiked: boolean) => {
        setPosts(prev => prev.map(p => {
            if (p.id !== postId) return p;
            return {
                ...p,
                isLiked,
                likes: isLiked ? (p.likes || 0) + 1 : Math.max(0, (p.likes || 1) - 1)
            };
        }));
    }, []);

    useEffect(() => {
        setPage(1);
        fetchPosts(1, true);
    }, [fetchPosts]);

    const fetchNextPage = () => {
        if (!isLoading && !isFetchingNextPage && hasMore) {
            const nextPage = page + 1;
            setPage(nextPage);
            fetchPosts(nextPage);
        }
    };

    return {
        posts,
        isLoading,
        isFetchingNextPage,
        error,
        hasMore,
        fetchNextPage,
        updatePostLikeStatus,
    };
}

// ------------------------------------------------------------------
// 3. Stats Hook
// ------------------------------------------------------------------
export function useGroupStats(groupId: string) {
    const [stats, setStats] = useState<GroupStats | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let isMounted = true;
        setIsLoading(true);

        fetch(`/api/groups/${groupId}/stats`)
            .then((res) => {
                if (!res.ok) throw new Error('Failed to fetch group stats');
                return res.json();
            })
            .then((data: GroupStats) => {
                if (isMounted) {
                    setStats(data);
                    setError(null);
                }
            })
            .catch((err) => {
                if (isMounted) setError(err.message);
            })
            .finally(() => {
                if (isMounted) setIsLoading(false);
            });

        return () => {
            isMounted = false;
        };
    }, [groupId]);

    return { stats, isLoading, error };
}

// ------------------------------------------------------------------
// 4. Members Hook
// ------------------------------------------------------------------
export function useGroupMembers(groupId: string) {
    const [members, setMembers] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);

    const fetchMembers = useCallback(async (pageNum: number, isInitial = false) => {
        try {
            if (isInitial) setIsLoading(true);
            else setIsFetchingNextPage(true);
            setError(null);

            const res = await fetch(`/api/groups/${groupId}/members?page=${pageNum}&limit=20`);
            if (!res.ok) throw new Error('Failed to fetch members');
            const data: { members: any[]; hasMore: boolean } = await res.json();

            setMembers((prev) => (isInitial ? data.members : [...prev, ...data.members]));
            setHasMore(data.hasMore);
        } catch (err: any) {
            setError(err.message);
        } finally {
            if (isInitial) setIsLoading(false);
            else setIsFetchingNextPage(false);
        }
    }, [groupId]);

    useEffect(() => {
        setPage(1);
        fetchMembers(1, true);
    }, [fetchMembers]);

    const fetchNextPage = () => {
        if (!isLoading && !isFetchingNextPage && hasMore) {
            const nextPage = page + 1;
            setPage(nextPage);
            fetchMembers(nextPage);
        }
    };

    return {
        members,
        isLoading,
        isFetchingNextPage,
        error,
        hasMore,
        fetchNextPage,
    };
}
