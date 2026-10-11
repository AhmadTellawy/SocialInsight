import {readResume} from '../utils/appResume';
import {peekRead,seedRead} from '../utils/readCache';
import {interactionGeneration} from '../utils/interactionCache';
import { useState, useEffect, useCallback, useRef } from 'react';
import { MembershipStatus, Survey, normalizeSurvey } from '../types';
import { authFetch, api } from '../services/api';

export interface GroupStats {
    postsCount: number;
    votesCount: number;
    membersCount: number;
}

// ------------------------------------------------------------------
// 1. Membership Hook
// ------------------------------------------------------------------
export function useGroupMembership(
    groupId: string,
    userId?: string,
    initial?: { status?: MembershipStatus; role?: string | null }
) {
    const hasInitialState = Boolean(initial?.status);
    const [membershipStatus, setMembershipStatus] = useState<MembershipStatus>(initial?.status || 'NOT_JOINED');
    const [role, setRole] = useState<string | null>(initial?.role || null);
    const [isLoading, setIsLoading] = useState(!hasInitialState);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (hasInitialState) {
            setMembershipStatus(initial?.status || 'NOT_JOINED');
            setRole(initial?.role || null);
            setIsLoading(false);
            return;
        }
        let isMounted = true;
        const controller = new AbortController();
        setIsLoading(true);

        if (!groupId) {
            setIsLoading(false);
            return;
        }

        // Fetch initial membership status
        const url = `/api/groups/${groupId}/membership`;
        authFetch(url, { signal: controller.signal, timeoutMs: 10_000 })
            .then((res) => {
                if (!res.ok) {
                    if (res.status === 403) return { status: 'NOT_JOINED' };
                    throw new Error('Failed to fetch membership status');
                }
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
                if (isMounted) {
                    setError(err.message);
                    setMembershipStatus('NOT_JOINED');
                    setRole(null);
                }
            })
            .finally(() => {
                if (isMounted) setIsLoading(false);
            });

        return () => {
            isMounted = false;
            controller.abort();
        };
    }, [groupId, userId, hasInitialState, initial?.status, initial?.role]);

    const joinGroup = async () => {
        try {
            if (!userId) throw new Error('Must be logged in to join');
            setIsLoading(true);
            const res = await authFetch(`/api/groups/${groupId}/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            if (!res.ok) {
                if (res.status === 403) setMembershipStatus('NOT_JOINED');
                throw new Error('Failed to join group');
            }
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
            const res = await authFetch(`/api/groups/${groupId}/leave`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            if (!res.ok) {
                if (res.status === 403) setMembershipStatus('NOT_JOINED');
                throw new Error('Failed to leave group');
            }
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
            const res = await authFetch(`/api/groups/${groupId}/request-join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            if (!res.ok) {
                if (res.status === 403) setMembershipStatus('NOT_JOINED');
                throw new Error('Failed to request to join group');
            }
            setMembershipStatus('PENDING');
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const declineInvite = async () => {
        try {
            if (!userId) throw new Error('Must be logged in to decline invite');
            setIsLoading(true);
            const res = await authFetch(`/api/groups/${groupId}/invite/decline`, { method: 'POST' });
            if (!res.ok) throw new Error('Failed to decline invite');
            setMembershipStatus('NOT_JOINED');
            setRole(null);
        } catch (err: any) {
            setError(err.message);
            throw err;
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
        declineInvite,
    };
}

// ------------------------------------------------------------------
// 2. Posts Hook (Pagination / Infinite Scroll)
// ------------------------------------------------------------------
export function useGroupPosts(groupId: string, userId?: string) {
    const cacheKey='/api/posts?collection=group:'+groupId+':'+(userId||'guest');
    const snapshot=peekRead<{posts:Survey[];nextCursor:string|null;anchorId?:string}>(cacheKey);
    const saved=readResume(userId||'guest');
    const anchor=useRef({key:cacheKey,id:saved?.path==='/group/'+groupId?saved.anchor?.id:undefined});
    if(anchor.current.key!==cacheKey)anchor.current={key:cacheKey,id:undefined};
    const [hasEarlier,setHasEarlier]=useState(!!snapshot?.anchorId);
    const [posts, setPosts] = useState<Survey[]>(snapshot?.posts||[]);
    const [isLoading, setIsLoading] = useState(false);
    const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [nextCursor, setNextCursor] = useState<string | null>(snapshot?.nextCursor||null);
    const [hasMore, setHasMore] = useState(true);
    const activeRequestRef = useRef<AbortController | null>(null);

    const fetchPosts = useCallback(async (cursor: string | null, isInitial = false, latest=false) => {
        if (!groupId) {
            setIsLoading(false);
            setIsFetchingNextPage(false);
            return;
        }

        const controller = new AbortController(),epoch=interactionGeneration();
        if(activeRequestRef.current && !isInitial)return;
        if(isInitial)activeRequestRef.current?.abort();
        activeRequestRef.current=controller;
        try {
            if (isInitial) setIsLoading(true);
            else setIsFetchingNextPage(true);
            setError(null);

            const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
            if(latest)anchor.current.id=undefined;
            const requestedAnchor=isInitial&&!latest?anchor.current.id:undefined;
            const url = `/api/posts?groupId=${encodeURIComponent(groupId)}&limit=10${cursorParam}`+(requestedAnchor?'&anchorId='+encodeURIComponent(requestedAnchor):'');
            const res = await authFetch(url, { memoryTTL:20000, signal: controller.signal, timeoutMs: 15_000 });
            if (!res.ok) {
                if (res.status === 403) throw new Error('Private group posts are hidden.');
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'Failed to fetch posts');
            }
            const data: { data: any[]; nextCursor: string | null;anchorId?:string } = await res.json();
            
            if (!data || !Array.isArray(data.data)) {
                console.error('[useGroupPosts] Unexpected group posts response:', data);
                throw new Error('Unexpected server response format');
            }
            
            const rawPosts = data.data;
            
            const normalizedPosts = rawPosts.map(post => {
                try {
                    return normalizeSurvey(post);
                } catch (e) {
                    console.error(`[useGroupPosts] Failed to normalize post:`, post?.id, e, post);
                    return null;
                }
            }).filter(Boolean) as Survey[];

            if(controller.signal.aborted||epoch!==interactionGeneration())return;
            setPosts(prev=>{const rows=isInitial?normalizedPosts:Array.from(new Map([...prev,...normalizedPosts].map(p=>[p.id,p])).values());seedRead(cacheKey,{posts:rows,nextCursor:data.nextCursor||null,anchorId:data.anchorId||(hasEarlier?anchor.current.id:undefined)});return rows;});
            if(isInitial){setHasEarlier(!!data.anchorId);if(requestedAnchor&&!data.anchorId)window.dispatchEvent(new Event('opiniup:anchor-unavailable'));}
            setNextCursor(data.nextCursor || null);
            setHasMore(Boolean(data.nextCursor));
        } catch (err: any) {
            if (!controller.signal.aborted && epoch===interactionGeneration() && err?.name !== 'AbortError') {setError(err.message);setPosts([]);}
        } finally {
            if(activeRequestRef.current===controller){activeRequestRef.current=null;setIsLoading(false);setIsFetchingNextPage(false);}
        }
    }, [groupId,userId]);

    const [isCheckingAccess,setIsCheckingAccess]=useState(false);
    const live=useRef(posts);live.current=posts;
    const refreshPost=async(id:string)=>{
      const epoch=interactionGeneration();
      const targets=live.current.filter(post=>post.id===id||post.sharedFrom?.id===id);
      for(const target of targets){
        try{const raw=await api.getSurveyById(target.id);if(epoch!==interactionGeneration())return;const fresh=raw;setPosts(rows=>rows.map(post=>post.id===fresh.id?fresh:post));}
        catch(error){if(epoch===interactionGeneration())setPosts(rows=>rows.filter(post=>post.id!==target.id));}
      }
    };
    useEffect(()=>{
      const controller=new AbortController();
      const resume=async(event:Event)=>{if(!(event as CustomEvent).detail?.stale)return;const current=live.current;if(!current.length)return;const epoch=interactionGeneration();setIsCheckingAccess(true);
        try{const allowed=new Set(await api.getPostAccess(current.map(post=>post.id),controller.signal));if(!controller.signal.aborted&&epoch===interactionGeneration())setPosts(rows=>rows.filter(post=>allowed.has(post.id)));}
        catch{if(!controller.signal.aborted){setPosts([]);setError('Could not verify access. Please reopen the group.');}}
        finally{if(!controller.signal.aborted)setIsCheckingAccess(false);}
      };
      window.addEventListener('opiniup:resume',resume);return()=>{controller.abort();window.removeEventListener('opiniup:resume',resume);};
    },[groupId,userId]);
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

    const removePosts = useCallback((postIds: string[]) => {
        const ids = new Set(postIds);
        setPosts(prev => prev.filter(post => !ids.has(post.id)));
    }, []);

    useEffect(() => {
        const cached=peekRead<{posts:Survey[];nextCursor:string|null;anchorId?:string}>(cacheKey);
        if(cached){setPosts(cached.posts);setNextCursor(cached.nextCursor);setHasMore(!!cached.nextCursor);setHasEarlier(!!cached.anchorId);anchor.current.id=cached.anchorId;}
        else {setPosts([]);setNextCursor(null);void fetchPosts(null,true);}
        return () => activeRequestRef.current?.abort();
    }, [fetchPosts]);

    const fetchNextPage = () => {
        if (!isLoading && !isFetchingNextPage && hasMore && nextCursor) {
            fetchPosts(nextCursor);
        }
    };

    return {
        posts,
        isLoading,
        isFetchingNextPage,
        error,
        hasMore,
        fetchNextPage,
        updatePostLikeStatus, isCheckingAccess, refreshPost, hasEarlier, loadLatest:()=>void fetchPosts(null,true,true),
        removePosts,
    };
}

// ------------------------------------------------------------------
// 3. Stats Hook
// ------------------------------------------------------------------
export function useGroupStats(groupId: string, initialStats?: GroupStats | null) {
    const [stats, setStats] = useState<GroupStats | null>(initialStats || null);
    const [isLoading, setIsLoading] = useState(!initialStats);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (initialStats) {
            setStats(initialStats);
            setIsLoading(false);
            return;
        }
        let isMounted = true;
        const controller = new AbortController();
        setIsLoading(true);
        if (!groupId) {
            setIsLoading(false);
            return;
        }

        authFetch(`/api/groups/${groupId}/stats`, { signal: controller.signal, timeoutMs: 10_000 })
            .then(async (res) => {
                if (!res.ok) {
                    if (res.status === 403) throw new Error('Private group stats are hidden.');
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(errData.error || 'Failed to fetch group stats');
                }
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
            controller.abort();
        };
    }, [groupId, initialStats]);

    return { stats, isLoading, error };
}

// ------------------------------------------------------------------
// 4. Members Hook
// ------------------------------------------------------------------
export function useGroupMembers(groupId: string, enabled = true) {
    const [members, setMembers] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isFetchingNextPage, setIsFetchingNextPage] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);

    const fetchMembers = useCallback(async (pageNum: number, isInitial = false) => {
        if (!groupId) {
            setIsLoading(false);
            setIsFetchingNextPage(false);
            return;
        }

        try {
            if (isInitial) setIsLoading(true);
            else setIsFetchingNextPage(true);
            setError(null);

            const res = await authFetch(`/api/groups/${groupId}/members?page=${pageNum}&limit=20`, { timeoutMs: 10_000 });
            if (!res.ok) {
                if (res.status === 403) throw new Error('Private group members are hidden.');
                throw new Error('Failed to fetch members');
            }
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
        if (!enabled) return;
        setPage(1);
        fetchMembers(1, true);
    }, [enabled, fetchMembers]);

    const fetchNextPage = () => {
        if (!isLoading && !isFetchingNextPage && hasMore) {
            const nextPage = page + 1;
            setPage(nextPage);
            fetchMembers(nextPage);
        }
    };

    const refresh = useCallback(() => {
        setPage(1);
        fetchMembers(1, true);
    }, [fetchMembers]);

    return {
        members,
        isLoading,
        isFetchingNextPage,
        error,
        hasMore,
        fetchNextPage,
        refresh,
    };
}

// ------------------------------------------------------------------
// 5. Pending Requests Hook
// ------------------------------------------------------------------
export function useGroupPendingRequests(groupId: string, enabled = true) {
    const [requests, setRequests] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchRequests = useCallback(async (signal?: AbortSignal) => {
        if (!groupId) return;
        try {
            setIsLoading(true);
            setError(null);
            const res = await authFetch(`/api/groups/${groupId}/pending-requests`, { signal, timeoutMs: 10_000 });
            if (!res.ok) {
                throw new Error('Failed to fetch pending requests');
            }
            const data = await res.json();
            setRequests(data);
        } catch (err: any) {
            if (err?.name === 'AbortError') return;
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [groupId]);

    useEffect(() => {
        if (!enabled) return;
        const controller = new AbortController();
        void fetchRequests(controller.signal);
        return () => controller.abort();
    }, [enabled, fetchRequests]);

    return {
        requests,
        isLoading,
        error,
        refresh: () => { void fetchRequests(); }
    };
}

// ------------------------------------------------------------------
// 6. Pending Posts Hook
// ------------------------------------------------------------------
export function useGroupPendingPosts(groupId: string, enabled = true) {
    const [pendingPosts, setPendingPosts] = useState<Survey[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchPendingPosts = useCallback(async (signal?: AbortSignal) => {
        if (!groupId) return;
        try {
            setIsLoading(true);
            setError(null);
            const res = await authFetch(`/api/groups/${groupId}/pending-posts`, { signal, timeoutMs: 10_000 });
            if (!res.ok) {
                throw new Error('Failed to fetch pending posts');
            }
            const data = await res.json();
            const normalized = (data || []).map((post: any) => {
                try {
                    return normalizeSurvey(post);
                } catch (e) {
                    console.error(`[useGroupPendingPosts] Failed to normalize post:`, post?.id, e);
                    return null;
                }
            }).filter(Boolean) as Survey[];
            setPendingPosts(normalized);
        } catch (err: any) {
            if (err?.name === 'AbortError') return;
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, [groupId]);

    useEffect(() => {
        if (!enabled) return;
        const controller = new AbortController();
        void fetchPendingPosts(controller.signal);
        return () => controller.abort();
    }, [enabled, fetchPendingPosts]);

    return {
        pendingPosts,
        isLoading,
        error,
        refresh: () => { void fetchPendingPosts(); }
    };
}
