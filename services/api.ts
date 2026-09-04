import { normalizeSurvey } from '../types.ts';
import type { Notification, PostAnswerPayload, UserProfile } from '../types.ts';

// Production HTTP auth is deliberately same-origin. Vercel proxies /api to the
// Render service, so session cookies are first-party even when browsers block
// third-party cookies. VITE_API_URL remains available for local development.
export const API_BASE_URL = import.meta.env?.PROD ? '/api' : (import.meta.env?.VITE_API_URL || '/api');
export const AUTH_REQUEST_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly code?: string,
        public readonly details?: Record<string, unknown>
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

export type ApiRequestOptions = {
    signal?: AbortSignal;
    timeoutMs?: number;
};

export type SurveyRequestOptions = ApiRequestOptions & {
    normalize?: boolean;
};

export type NotificationPage = {
    items: Notification[];
    nextCursor: string | null;
};

export type CursorPage<T> = {
    items: T[];
    nextCursor: string | null;
};

const nextCursorFrom = (response: Response): string | null =>
    response.headers.get('X-Next-Cursor')?.trim() || null;

export type ProfileLink = {
    id: string;
    title: string;
    url: string;
    normalizedUrl?: string;
    sortOrder: number;
    createdAt: string;
    updatedAt: string;
};

export type ProfileLinkInput = {
    title: string;
    url: string;
};

const PROFILE_LINK_REQUEST_TIMEOUT_MS = 15_000;

export type CurrentUserProfile = Omit<UserProfile, 'birthday'> & {
    birthday?: string | null;
    profileLinks?: ProfileLink[];
    updatedAt?: string;
};

export type AuthSessionPayload = {
    user: CurrentUserProfile;
    csrfToken?: string;
};

const throwApiError = async (response: Response, fallbackMessage: string): Promise<never> => {
    let details: Record<string, unknown> = {};
    try {
        details = await response.json();
    } catch {
        // The fallback below keeps non-JSON upstream errors user-safe.
    }
    throw new ApiError(
        typeof details.error === 'string' ? details.error : fallbackMessage,
        response.status,
        typeof details.code === 'string' ? details.code : undefined,
        details
    );
};

export const getGuestId = () => {
    let guestId = localStorage.getItem('si_guest_id');
    if (!guestId) {
        guestId = typeof crypto !== 'undefined' && crypto.randomUUID 
            ? crypto.randomUUID() 
            : Math.random().toString(36).substring(2, 15);
        localStorage.setItem('si_guest_id', guestId);
    }
    return guestId;
};

const resolveAssets = (obj: any): any => {
    if (!obj) return obj;
    if (typeof obj === 'string') {
        if (obj.startsWith('/uploads/')) {
            // Same-origin production assets pass through the /uploads proxy;
            // local development keeps the standalone API server fallback.
            const baseUrl = API_BASE_URL === '/api'
                ? (import.meta.env?.PROD ? window.location.origin : 'http://localhost:3001')
                : API_BASE_URL.replace(/\/api\/?$/, '');
            return `${baseUrl}${obj}`;
        }
        return obj;
    }
    if (Array.isArray(obj)) return obj.map(resolveAssets);
    if (typeof obj === 'object') {
        const newObj: any = {};
        for (const key in obj) {
            newObj[key] = resolveAssets(obj[key]);
        }
        return newObj;
    }
    return obj;
};

type AuthFetchInit = RequestInit & {
    timeoutMs?: number;
    suppressAuthExpired?: boolean;
};

const CSRF_SESSION_KEY = 'si_csrf_token';
const AUTH_IDENTITY_SESSION_KEY = 'si_auth_identity';
let csrfTokenInMemory: string | null = null;
let authIdentityInMemory: string | null = null;

const getSessionStorage = (): Storage | null => {
    try {
        return typeof sessionStorage === 'undefined' ? null : sessionStorage;
    } catch {
        return null;
    }
};

const getCsrfToken = (): string | null => {
    if (csrfTokenInMemory) return csrfTokenInMemory;
    csrfTokenInMemory = getSessionStorage()?.getItem(CSRF_SESSION_KEY) || null;
    return csrfTokenInMemory;
};

const rememberCsrfToken = (value: unknown): void => {
    if (typeof value !== 'string' || value.length < 16 || value.length > 512) return;
    csrfTokenInMemory = value;
    getSessionStorage()?.setItem(CSRF_SESSION_KEY, value);
};

const rememberSessionPayload = (payload: unknown): void => {
    if (!payload || typeof payload !== 'object') return;
    const record = payload as Record<string, unknown>;
    rememberCsrfToken(record.csrfToken);
    if (record.user && typeof record.user === 'object') {
        const nestedUser = record.user as Record<string, unknown>;
        if (typeof nestedUser.id === 'string') {
            authIdentityInMemory = nestedUser.id;
            getSessionStorage()?.setItem(AUTH_IDENTITY_SESSION_KEY, nestedUser.id);
        }
    }
};

export const getAuthSessionIdentity = (): string | null => {
    if (authIdentityInMemory) return authIdentityInMemory;
    authIdentityInMemory = getSessionStorage()?.getItem(AUTH_IDENTITY_SESSION_KEY) || null;
    return authIdentityInMemory;
};

const clearSessionMetadata = (): void => {
    csrfTokenInMemory = null;
    authIdentityInMemory = null;
    const storage = getSessionStorage();
    storage?.removeItem(CSRF_SESSION_KEY);
    storage?.removeItem(AUTH_IDENTITY_SESSION_KEY);
};

const isUnsafeMethod = (method?: string): boolean =>
    !['GET', 'HEAD', 'OPTIONS'].includes((method || 'GET').toUpperCase());

export const authFetch = async (input: RequestInfo | URL, init?: AuthFetchInit): Promise<Response> => {
    let fetchUrl = input;
    if (typeof input === 'string') {
        if (input.startsWith('/api')) {
            fetchUrl = input.replace(/^\/api/, API_BASE_URL);
        } else if (input.startsWith('/') && !input.startsWith('http')) {
            fetchUrl = `${API_BASE_URL}${input}`;
        }
    }

    const headers = new Headers(init?.headers);
    const csrfToken = getCsrfToken();
    if (csrfToken && isUnsafeMethod(init?.method) && !headers.has('X-CSRF-Token')) {
        headers.set('X-CSRF-Token', csrfToken);
    }
    
    // Default Content-Type if body exists and no content-type is set
    if (init?.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    const { timeoutMs, suppressAuthExpired, signal: upstreamSignal, ...requestInit } = init || {};
    const effectiveTimeoutMs = timeoutMs ?? AUTH_REQUEST_TIMEOUT_MS;
    const requestController = effectiveTimeoutMs > 0 ? new AbortController() : null;
    let didTimeout = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const abortFromUpstream = () => {
        requestController?.abort(upstreamSignal?.reason);
        cleanupRequestControls();
    };
    const cleanupRequestControls = () => {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
        }
        upstreamSignal?.removeEventListener('abort', abortFromUpstream);
    };

    if (requestController && upstreamSignal?.aborted) {
        abortFromUpstream();
    } else if (requestController) {
        upstreamSignal?.addEventListener('abort', abortFromUpstream, { once: true });
    }

    if (requestController && effectiveTimeoutMs > 0) {
        timeoutId = setTimeout(() => {
            didTimeout = true;
            requestController.abort();
            cleanupRequestControls();
        }, effectiveTimeoutMs);
    }

    const modifiedInit: RequestInit = {
        ...requestInit,
        credentials: requestInit.credentials ?? 'include',
        headers,
        signal: requestController?.signal || upstreamSignal
    };

    let response: Response;
    try {
        response = await fetch(fetchUrl, modifiedInit);
    } catch (error) {
        cleanupRequestControls();
        if (didTimeout) {
            throw new ApiError('Request timed out', 408, 'REQUEST_TIMEOUT');
        }
        if (upstreamSignal?.aborted || (error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError')) {
            throw error;
        }
        if (error instanceof TypeError) {
            throw new ApiError('Network request failed', 0, 'NETWORK_ERROR');
        }
        throw error;
    }
    
    const responseCsrfToken = response.headers.get('X-CSRF-Token');
    if (responseCsrfToken) rememberCsrfToken(responseCsrfToken);

    if (response.status === 401 && !suppressAuthExpired) {
        clearSessionMetadata();
        window.dispatchEvent(new Event('auth_expired'));
    }
    
    const consumeResponse = async <T>(reader: () => Promise<T>): Promise<T> => {
        try {
            return await reader();
        } catch (error) {
            if (didTimeout) {
                throw new ApiError('Request timed out', 408, 'REQUEST_TIMEOUT');
            }
            throw error;
        } finally {
            cleanupRequestControls();
        }
    };

    // Keep asset resolution centralized while ensuring request controls are
    // released regardless of which standard body reader the caller uses.
    const originalJson = response.json.bind(response);
    response.json = async () => {
        const data = await consumeResponse(originalJson);
        if (data && typeof data === 'object') {
            rememberCsrfToken((data as Record<string, unknown>).csrfToken);
        }
        return resolveAssets(data);
    };
    const originalText = response.text.bind(response);
    response.text = () => consumeResponse(originalText);
    const originalArrayBuffer = response.arrayBuffer.bind(response);
    response.arrayBuffer = () => consumeResponse(originalArrayBuffer);
    const originalBlob = response.blob.bind(response);
    response.blob = () => consumeResponse(originalBlob);
    const originalFormData = response.formData.bind(response);
    response.formData = () => consumeResponse(originalFormData);

    if (response.status === 204 || response.status === 205 || modifiedInit.method === 'HEAD') {
        cleanupRequestControls();
    }
    
    return response;
};

export const api = {
    recordPostView: async (postId: string, data: { source: string; deviceType: string; guestSessionId: string }) => {
        const response = await authFetch(`${API_BASE_URL}/posts/${postId}/views`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error('Failed to record view');
        return response.json();
    },
    getSurveys: async (
        userId?: string,
        cursor?: string,
        limit: number = 10,
        authorId?: string,
        authorHandle?: string,
        requestOptions: SurveyRequestOptions = {}
    ) => {
        const guestId = !userId ? getGuestId() : undefined;
        let url = userId ? `${API_BASE_URL}/posts?userId=${userId}&limit=${limit}` : `${API_BASE_URL}/posts?guestId=${guestId}&limit=${limit}`;
        if (cursor) {
            url += `&cursor=${cursor}`;
        }
        if (authorId) {
            url += `&authorId=${authorId}`;
        }
        if (authorHandle) {
            url += `&authorHandle=${authorHandle}`;
        }
        const response = await authFetch(url, {
            signal: requestOptions.signal,
            timeoutMs: requestOptions.timeoutMs
        });
        if (!response.ok) await throwApiError(response, 'Failed to fetch posts');
        const json = await response.json();
        if (!json || !Array.isArray(json.data)) {
            throw new ApiError('Invalid feed response', 502, 'INVALID_FEED_RESPONSE');
        }
        return {
            data: requestOptions.normalize === false ? json.data : json.data.map(normalizeSurvey),
            nextCursor: json.nextCursor
        };
    },

    getSurveyById: async (id: string, userId?: string, signal?: AbortSignal) => {
        const guestId = !userId ? getGuestId() : undefined;
        const url = userId ? `${API_BASE_URL}/posts/${id}?userId=${userId}` : `${API_BASE_URL}/posts/${id}?guestId=${guestId}`;
        const response = await authFetch(url, { signal, timeoutMs: 20_000 });
        if (!response.ok) throw new Error('Failed to fetch post');
        const data = await response.json();
        return normalizeSurvey(data);
    },

    getDraftsPage: async (_userId: string, cursor?: string | null, limit = 20, signal?: AbortSignal): Promise<CursorPage<any>> => {
        const params = new URLSearchParams({ limit: String(limit) });
        if (cursor) params.set('cursor', cursor);
        const response = await authFetch(`${API_BASE_URL}/posts/drafts?${params.toString()}`, { signal, timeoutMs: 15_000 });
        if (!response.ok) throw new Error('Failed to fetch drafts');
        const data = await response.json();
        return { items: data.map(normalizeSurvey), nextCursor: nextCursorFrom(response) };
    },

    getDrafts: async (userId: string) => {
        const page = await api.getDraftsPage(userId);
        return page.items;
    },

    getSavedPostsPage: async (_userId: string, cursor?: string | null, limit = 20, signal?: AbortSignal): Promise<CursorPage<any>> => {
        const params = new URLSearchParams({ limit: String(limit) });
        if (cursor) params.set('cursor', cursor);
        const response = await authFetch(`${API_BASE_URL}/posts/saved?${params.toString()}`, { signal, timeoutMs: 15_000 });
        if (!response.ok) throw new Error('Failed to fetch saved posts');
        const data = await response.json();
        return { items: data.map(normalizeSurvey), nextCursor: nextCursorFrom(response) };
    },

    getSavedPosts: async (userId: string) => {
        const page = await api.getSavedPostsPage(userId);
        return page.items;
    },

    deletePost: async (postId: string, _userId?: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/${postId}`, {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error('Failed to delete post');
        return response.json();
    },

    updatePost: async (postId: string, data: any) => {
        const response = await authFetch(`${API_BASE_URL}/posts/${postId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) await throwApiError(response, 'Failed to update post');
        const resData = await response.json();
        return normalizeSurvey(resData);
    },

    vote: async (
        postId: string,
        optionIds: string | string[],
        userId?: string,
        isAnonymous: boolean = false,
        newOption?: { id?: string; text?: string },
        followUpAnswers?: Record<string, string>,
        answers?: PostAnswerPayload[]
    ) => {
        const payloadOptionIds = Array.isArray(optionIds) ? optionIds : [optionIds];
        const guestId = !userId ? getGuestId() : undefined;
        const response = await authFetch(`${API_BASE_URL}/posts/${postId}/vote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ optionIds: payloadOptionIds, userId, guestId, isAnonymous, newOption, followUpAnswers, answers })
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to vote');
        }
        return response.json();
    },

    getParticipantsPage: async (postId: string, cursor?: string | null, limit = 30, signal?: AbortSignal): Promise<CursorPage<any>> => {
        const params = new URLSearchParams({ limit: String(limit) });
        if (cursor) params.set('cursor', cursor);
        const response = await authFetch(`${API_BASE_URL}/posts/${postId}/participants?${params.toString()}`, { signal, timeoutMs: 15_000 });
        if (!response.ok) throw new Error('Failed to fetch participants');
        return { items: await response.json(), nextCursor: nextCursorFrom(response) };
    },

    getParticipants: async (postId: string) => {
        const page = await api.getParticipantsPage(postId);
        return page.items;
    },

    getPostResults: async (postId: string, signal?: AbortSignal) => {
        const response = await authFetch(`${API_BASE_URL}/posts/${postId}/results`, { signal, timeoutMs: 20_000 });
        if (!response.ok) throw new Error('Failed to fetch post results');
        return response.json();
    },

    getUsers: async (signal?: AbortSignal) => {
        const response = await authFetch(`${API_BASE_URL}/users`, { signal, timeoutMs: 10_000 });
        if (!response.ok) throw new Error('Failed to fetch users');
        return response.json();
    },

    getSuggestedUsers: async (userId: string, signal?: AbortSignal) => {
        const response = await authFetch(`${API_BASE_URL}/users/${userId}/suggested`, { signal, timeoutMs: 15_000 });
        if (!response.ok) throw new Error('Failed to fetch suggested users');
        return response.json();
    },

    searchUsers: async (query: string, signal?: AbortSignal) => {
        if (!query) return [];
        const response = await authFetch(`${API_BASE_URL}/users/search?q=${encodeURIComponent(query)}`, { signal });
        if (!response.ok) await throwApiError(response, 'Failed to search users');
        return response.json();
    },

    searchAll: async (query: string, signal?: AbortSignal) => {
        if (!query) return { topics: [], surveys: [], people: [], groups: [], categories: [] };
        const response = await authFetch(`${API_BASE_URL}/search?q=${encodeURIComponent(query)}`, { signal, timeoutMs: 10_000 });
        if (!response.ok) throw new Error('Failed to fetch search results');
        return response.json();
    },

    searchTaggableUsers: async (query: string, signal?: AbortSignal) => {
        if (!query) return [];
        const response = await authFetch(`${API_BASE_URL}/users/search?q=${encodeURIComponent(query)}&purpose=people-tag`, { signal });
        if (!response.ok) await throwApiError(response, 'Failed to search taggable users');
        return response.json();
    },

    getTrendingHashtags: async (limit: number = 10, signal?: AbortSignal) => {
        const response = await authFetch(`${API_BASE_URL}/hashtags/trending?limit=${limit}`, { signal, timeoutMs: 10_000 });
        if (!response.ok) throw new Error('Failed to fetch trending hashtags');
        return response.json();
    },

    getHashtagPosts: async (name: string, sort: 'top' | 'recent' = 'top', cursor?: string, limit: number = 10, signal?: AbortSignal) => {
        const params = new URLSearchParams({ sort, limit: String(limit) });
        if (cursor) params.set('cursor', cursor);
        const response = await authFetch(`${API_BASE_URL}/hashtags/${encodeURIComponent(name.replace(/^#/, ''))}/posts?${params.toString()}`, { signal, timeoutMs: 15_000 });
        if (!response.ok) throw new Error('Failed to fetch hashtag topic');
        const data = await response.json();
        return {
            ...data,
            data: (data.data || []).map(normalizeSurvey)
        };
    },

    getGroups: async () => {
        const response = await authFetch(`${API_BASE_URL}/groups`);
        if (!response.ok) throw new Error('Failed to fetch groups');
        return response.json();
    },

    getTrends: async (params: { period?: string; type?: string; country?: string; limit?: number; category?: string }, signal?: AbortSignal) => {
        const queryParams = new URLSearchParams();
        if (params.period) queryParams.append('period', params.period);
        if (params.type) queryParams.append('type', params.type);
        if (params.country) queryParams.append('country', params.country);
        if (params.limit) queryParams.append('limit', params.limit.toString());
        if (params.category) queryParams.append('category', params.category);

        const response = await authFetch(`${API_BASE_URL}/posts/trends?${queryParams.toString()}`, { signal, timeoutMs: 15_000 });
        if (!response.ok) throw new Error('Failed to fetch trends');
        return response.json();
    },

    createSurvey: async (data: any) => {
        const response = await authFetch(`${API_BASE_URL}/posts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) await throwApiError(response, 'Failed to create post');
        const resData = await response.json();
        return normalizeSurvey(resData);
    },

    sharePost: async (postId: string, userId: string, caption: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/${postId}/share`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, caption })
        });
        if (!response.ok) throw new Error('Failed to share post');
        const resData = await response.json();
        if (resData.action === 'unshared') return resData;
        return normalizeSurvey(resData);
    },

    acceptPeopleTag: async (tagId: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/people-tags/${tagId}/accept`, { method: 'POST' });
        if (!response.ok) await throwApiError(response, 'Failed to accept people tag');
        return response.json();
    },

    rejectPeopleTag: async (tagId: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/people-tags/${tagId}/reject`, { method: 'POST' });
        if (!response.ok) await throwApiError(response, 'Failed to reject people tag');
        return response.json();
    },

    removePeopleTag: async (tagId: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/people-tags/${tagId}`, { method: 'DELETE' });
        if (!response.ok) await throwApiError(response, 'Failed to remove people tag');
        return response.json();
    },

    getCommentsPage: async (postId: string, cursor?: string | null, limit = 30, signal?: AbortSignal, focusId?: string | null): Promise<CursorPage<any>> => {
        const params = new URLSearchParams({ limit: String(limit) });
        if (cursor) params.set('cursor', cursor);
        if (focusId && !cursor) params.set('focusId', focusId);
        const response = await authFetch(`${API_BASE_URL}/posts/${postId}/comments?${params.toString()}`, { signal, timeoutMs: 15_000 });
        if (!response.ok) throw new Error('Failed to fetch comments');
        return { items: await response.json(), nextCursor: nextCursorFrom(response) };
    },

    getComments: async (postId: string, _userId?: string) => {
        const page = await api.getCommentsPage(postId);
        return page.items;
    },

    createComment: async (postId: string, text: string, parentId?: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/${postId}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, parentId })
        });
        if (!response.ok) await throwApiError(response, 'Failed to create comment');
        return response.json();
    },

    updateComment: async (commentId: string, text: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/comments/${commentId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });
        if (!response.ok) throw new Error('Failed to update comment');
        return response.json();
    },

    deleteComment: async (commentId: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/comments/${commentId}`, {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error('Failed to delete comment');
        return response.json();
    },

    updateUser: async (userId: string, data: any) => {
        const response = await authFetch(`${API_BASE_URL}/users/${userId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) await throwApiError(response, 'Failed to update user');
        return response.json();
    },

    getMe: async (requestOptions: ApiRequestOptions = {}): Promise<CurrentUserProfile> => {
        const response = await authFetch(`${API_BASE_URL}/users/me`, requestOptions);
        if (!response.ok) await throwApiError(response, 'Failed to fetch your profile');
        return response.json();
    },

    getProfileLinks: async (requestOptions: ApiRequestOptions = {}): Promise<ProfileLink[]> => {
        const response = await authFetch(`${API_BASE_URL}/users/me/profile-links`, {
            ...requestOptions,
            timeoutMs: requestOptions.timeoutMs ?? PROFILE_LINK_REQUEST_TIMEOUT_MS
        });
        if (!response.ok) await throwApiError(response, 'Failed to fetch profile links');
        return response.json();
    },

    createProfileLink: async (data: ProfileLinkInput): Promise<ProfileLink> => {
        const response = await authFetch(`${API_BASE_URL}/users/me/profile-links`, {
            method: 'POST',
            body: JSON.stringify(data),
            timeoutMs: PROFILE_LINK_REQUEST_TIMEOUT_MS
        });
        if (!response.ok) await throwApiError(response, 'Failed to add profile link');
        return response.json();
    },

    updateProfileLink: async (linkId: string, data: ProfileLinkInput): Promise<ProfileLink> => {
        const response = await authFetch(`${API_BASE_URL}/users/me/profile-links/${encodeURIComponent(linkId)}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
            timeoutMs: PROFILE_LINK_REQUEST_TIMEOUT_MS
        });
        if (!response.ok) await throwApiError(response, 'Failed to update profile link');
        return response.json();
    },

    deleteProfileLink: async (linkId: string): Promise<void> => {
        const response = await authFetch(`${API_BASE_URL}/users/me/profile-links/${encodeURIComponent(linkId)}`, {
            method: 'DELETE',
            timeoutMs: PROFILE_LINK_REQUEST_TIMEOUT_MS
        });
        if (!response.ok) await throwApiError(response, 'Failed to delete profile link');
        await response.text();
    },

    getUser: async (userId: string, signal?: AbortSignal) => {
        const response = await authFetch(`${API_BASE_URL}/users/${userId}`, { signal, timeoutMs: 15_000 });
        if (!response.ok) await throwApiError(response, 'Failed to fetch user');
        return response.json();
    },

    getUserByHandle: async (handle: string, signal?: AbortSignal) => {
        let cleanHandle = handle.startsWith('@') ? handle.substring(1) : handle;
        const response = await authFetch(`${API_BASE_URL}/users/handle/${cleanHandle}`, { signal, timeoutMs: 15_000 });
        if (!response.ok) throw new Error('Failed to fetch user by handle');
        return response.json();
    },

    getUserAnalytics: async (userId: string, signal?: AbortSignal) => {
        const response = await authFetch(`${API_BASE_URL}/users/${userId}/analytics`, { signal, timeoutMs: 15_000 });
        if (!response.ok) throw new Error('Failed to fetch user analytics');
        return response.json();
    },

    deleteAccount: async (userId: string) => {
        const response = await authFetch(`${API_BASE_URL}/users/${userId}`, {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error('Failed to delete account');
        return response.json();
    },

    likeSurvey: async (postId: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/${postId}/like`, {
            method: 'POST'
        });
        if (!response.ok) throw new Error('Failed to like post');
        return response.json();
    },

    getPostLikersPage: async (postId: string, cursor?: string | null, limit = 30, signal?: AbortSignal): Promise<CursorPage<UserProfile>> => {
        const params = new URLSearchParams({ limit: String(limit) });
        if (cursor) params.set('cursor', cursor);
        const response = await authFetch(`${API_BASE_URL}/posts/${postId}/likes?${params.toString()}`, { signal, timeoutMs: 15_000 });
        if (!response.ok) throw new Error('Failed to fetch post likers');
        return { items: await response.json(), nextCursor: nextCursorFrom(response) };
    },

    getPostLikers: async (postId: string) => {
        const page = await api.getPostLikersPage(postId);
        return page.items;
    },

    likeComment: async (commentId: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/comments/${commentId}/like`, {
            method: 'POST'
        });
        if (!response.ok) throw new Error('Failed to like comment');
        return response.json();
    },

    getCommentLikersPage: async (commentId: string, cursor?: string | null, limit = 30, signal?: AbortSignal): Promise<CursorPage<UserProfile>> => {
        const params = new URLSearchParams({ limit: String(limit) });
        if (cursor) params.set('cursor', cursor);
        const response = await authFetch(`${API_BASE_URL}/posts/comments/${commentId}/likes?${params.toString()}`, { signal, timeoutMs: 15_000 });
        if (!response.ok) throw new Error('Failed to fetch comment likers');
        return { items: await response.json(), nextCursor: nextCursorFrom(response) };
    },

    getCommentLikers: async (commentId: string) => {
        const page = await api.getCommentLikersPage(commentId);
        return page.items;
    },

    followUser: async (userId: string, currentUserId: string) => {
        const response = await authFetch(`${API_BASE_URL}/users/${userId}/follow`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentUserId })
        });
        if (!response.ok) throw new Error('Failed to follow user');
        return response.json();
    },

    getFollowStatus: async (userId: string, currentUserId: string) => {
        const response = await authFetch(`${API_BASE_URL}/users/${userId}/follow-status?currentUserId=${currentUserId}`);
        if (!response.ok) throw new Error('Failed to get follow status');
        return response.json();
    },

    getFollowRequests: async (userId: string) => {
        const response = await authFetch(`${API_BASE_URL}/users/${userId}/follow-requests`);
        if (!response.ok) throw new Error('Failed to fetch follow requests');
        return response.json();
    },

    acceptFollowRequest: async (followerId: string) => {
        const response = await authFetch(`${API_BASE_URL}/users/${followerId}/accept-follow`, { method: 'POST' });
        if (!response.ok) throw new Error('Failed to accept follow request');
        return response.json();
    },

    rejectFollowRequest: async (followerId: string) => {
        const response = await authFetch(`${API_BASE_URL}/users/${followerId}/reject-follow`, { method: 'POST' });
        if (!response.ok) throw new Error('Failed to reject follow request');
        return response.json();
    },

    removeFollower: async (followerId: string) => {
        const response = await authFetch(`${API_BASE_URL}/users/${followerId}/remove-follower`, { method: 'POST' });
        if (!response.ok) throw new Error('Failed to remove follower');
        return response.json();
    },

    register: async (data: any) => {
        const response = await authFetch(`${API_BASE_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Registration failed');
        }
        return response.json();
    },

    login: async (data: any) => {
        const response = await authFetch(`${API_BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
            suppressAuthExpired: true
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Login failed');
        }
        const responseData = await response.json();
        rememberSessionPayload(responseData);
        return responseData;
    },

    getSession: async (requestOptions: ApiRequestOptions & { retryOnce?: boolean } = {}): Promise<AuthSessionPayload | null> => {
        const load = async (): Promise<AuthSessionPayload | null> => {
            const response = await authFetch(`${API_BASE_URL}/auth/session`, {
                signal: requestOptions.signal,
                timeoutMs: requestOptions.timeoutMs ?? 15_000,
                suppressAuthExpired: true
            });
            if (response.status === 401) {
                clearSessionMetadata();
                return null;
            }
            if (!response.ok) await throwApiError(response, 'Failed to restore your session');
            const payload = await response.json() as AuthSessionPayload | CurrentUserProfile;
            const normalized = payload && typeof payload === 'object' && 'user' in payload
                ? payload as AuthSessionPayload
                : { user: payload as CurrentUserProfile };
            rememberSessionPayload(normalized);
            return normalized;
        };

        try {
            return await load();
        } catch (error) {
            const retryable = requestOptions.retryOnce
                && !requestOptions.signal?.aborted
                && (error instanceof ApiError ? error.status === 0 || error.status >= 500 : false);
            if (!retryable) throw error;
            await new Promise<void>((resolve, reject) => {
                const onAbort = () => {
                    clearTimeout(timer);
                    reject(requestOptions.signal?.reason || new DOMException('Aborted', 'AbortError'));
                };
                const timer = setTimeout(() => {
                    requestOptions.signal?.removeEventListener('abort', onAbort);
                    resolve();
                }, 300);
                requestOptions.signal?.addEventListener('abort', onAbort, { once: true });
            });
            return load();
        }
    },

    logout: async (): Promise<void> => {
        const response = await authFetch(`${API_BASE_URL}/auth/logout`, {
            method: 'POST',
            suppressAuthExpired: true
        });
        if (!response.ok && response.status !== 401) await throwApiError(response, 'Failed to log out');
        clearSessionMetadata();
    },

    startOAuth: async (provider: 'google' | 'facebook'): Promise<string> => {
        const response = await authFetch(`${API_BASE_URL}/auth/oauth/${provider}/start`, {
            method: 'POST',
            suppressAuthExpired: true
        });
        if (!response.ok) await throwApiError(response, `Could not start ${provider} sign-in`);
        const payload = await response.json() as { authorizationUrl?: unknown };
        if (typeof payload.authorizationUrl !== 'string') {
            throw new ApiError('The social sign-in provider returned an invalid address', 502, 'INVALID_OAUTH_REDIRECT');
        }
        let authorizationUrl: URL;
        try {
            authorizationUrl = new URL(payload.authorizationUrl);
        } catch {
            throw new ApiError('The social sign-in provider returned an invalid address', 502, 'INVALID_OAUTH_REDIRECT');
        }
        const allowedHost = provider === 'google' ? 'accounts.google.com' : 'www.facebook.com';
        if (authorizationUrl.protocol !== 'https:' || authorizationUrl.hostname !== allowedHost) {
            throw new ApiError('The social sign-in provider returned an unsafe address', 502, 'INVALID_OAUTH_REDIRECT');
        }
        return authorizationUrl.toString();
    },

    requestPasswordReset: async (email: string): Promise<void> => {
        const response = await authFetch(`${API_BASE_URL}/auth/password-reset/request`, {
            method: 'POST',
            body: JSON.stringify({ email }),
            suppressAuthExpired: true
        });
        if (!response.ok) await throwApiError(response, 'We could not process this password reset request');
    },

    confirmPasswordReset: async (email: string, code: string, password: string): Promise<void> => {
        const response = await authFetch(`${API_BASE_URL}/auth/password-reset/confirm`, {
            method: 'POST',
            body: JSON.stringify({ email, code, password }),
            suppressAuthExpired: true
        });
        if (!response.ok) await throwApiError(response, 'The reset code could not be verified');
    },

    requestEmailVerification: async (): Promise<void> => {
        const response = await authFetch(`${API_BASE_URL}/auth/email-verification/request`, { method: 'POST' });
        if (!response.ok) await throwApiError(response, 'Could not send an email verification code');
    },

    confirmEmailVerification: async (code: string): Promise<void> => {
        const response = await authFetch(`${API_BASE_URL}/auth/email-verification/confirm`, {
            method: 'POST',
            body: JSON.stringify({ code })
        });
        if (!response.ok) await throwApiError(response, 'The email verification code could not be verified');
    },

    requestEmailChange: async (email: string): Promise<void> => {
        const response = await authFetch(`${API_BASE_URL}/auth/email-change/request`, {
            method: 'POST',
            body: JSON.stringify({ email })
        });
        if (!response.ok) await throwApiError(response, 'Could not send an email change code');
    },

    confirmEmailChange: async (email: string, code: string): Promise<{ success: boolean; email: string; csrfToken?: string }> => {
        const response = await authFetch(`${API_BASE_URL}/auth/email-change/confirm`, {
            method: 'POST',
            body: JSON.stringify({ email, code })
        });
        if (!response.ok) await throwApiError(response, 'The email change code could not be verified');
        const payload = await response.json() as { success: boolean; email: string; csrfToken?: string };
        rememberSessionPayload(payload);
        return payload;
    },

    startOAuthLink: async (provider: 'google' | 'facebook'): Promise<string> => {
        const response = await authFetch(`${API_BASE_URL}/auth/oauth/${provider}/link`, { method: 'POST' });
        if (!response.ok) await throwApiError(response, `Could not start ${provider} account linking`);
        const payload = await response.json() as { authorizationUrl?: unknown };
        if (typeof payload.authorizationUrl !== 'string') {
            throw new ApiError('The social provider returned an invalid address', 502, 'INVALID_OAUTH_REDIRECT');
        }
        const authorizationUrl = new URL(payload.authorizationUrl);
        const allowedHost = provider === 'google' ? 'accounts.google.com' : 'www.facebook.com';
        if (authorizationUrl.protocol !== 'https:' || authorizationUrl.hostname !== allowedHost) {
            throw new ApiError('The social provider returned an unsafe address', 502, 'INVALID_OAUTH_REDIRECT');
        }
        return authorizationUrl.toString();
    },

    sendOTP: async (identifier: string, type: 'email' | 'phone') => {
        const response = await authFetch(`${API_BASE_URL}/otp/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier, type })
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to send OTP');
        }
        return response.json();
    },

    verifyOTP: async (identifier: string, code: string) => {
        const response = await authFetch(`${API_BASE_URL}/otp/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier, code })
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to verify OTP');
        }
        return response.json();
    },

    // Multi-step Registration
    initRegistration: async (data: { fullName: string; email: string; dob: string }) => {
        const response = await authFetch(`${API_BASE_URL}/auth/register/init`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to start registration');
        }
        return response.json();
    },

    setRegistrationPassword: async (pendingId: string, password: string) => {
        const response = await authFetch(`${API_BASE_URL}/auth/register/password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pendingId, password })
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to set password');
        }
        return response.json();
    },

    checkHandle: async (handle: string) => {
        const response = await authFetch(`${API_BASE_URL}/auth/handle/check?handle=${handle}`);
        if (!response.ok) throw new Error('Check failed');
        return response.json();
    },

    reserveHandle: async (pendingId: string, handle: string) => {
        const response = await authFetch(`${API_BASE_URL}/auth/handle/reserve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pendingId, handle })
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to reserve handle');
        }
        return response.json();
    },

    sendRegistrationOTP: async (pendingId: string) => {
        const response = await authFetch(`${API_BASE_URL}/auth/register/otp/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pendingId })
        });
        if (!response.ok) await throwApiError(response, 'Failed to send verification code');
        return response.json();
    },

    completeRegistration: async (pendingId: string, code: string) => {
        const response = await authFetch(`${API_BASE_URL}/auth/register/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pendingId, otp: code })
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to complete registration');
        }
        const responseData = await response.json();
        rememberSessionPayload(responseData);
        return responseData;
    },

    getUserFollowersPage: async (userId: string, cursor?: string | null, limit = 50, signal?: AbortSignal): Promise<CursorPage<UserProfile>> => {
        const params = new URLSearchParams({ limit: String(limit) });
        if (cursor) params.set('cursor', cursor);
        const response = await authFetch(`${API_BASE_URL}/users/${userId}/followers?${params.toString()}`, { signal, timeoutMs: 15_000 });
        if (!response.ok) throw new Error('Failed to fetch followers');
        return { items: await response.json(), nextCursor: nextCursorFrom(response) };
    },

    getUserFollowers: async (userId: string, _currentUserId?: string) => {
        const page = await api.getUserFollowersPage(userId);
        return page.items;
    },

    getUserFollowingPage: async (userId: string, cursor?: string | null, limit = 50, signal?: AbortSignal): Promise<CursorPage<UserProfile>> => {
        const params = new URLSearchParams({ limit: String(limit) });
        if (cursor) params.set('cursor', cursor);
        const response = await authFetch(`${API_BASE_URL}/users/${userId}/following?${params.toString()}`, { signal, timeoutMs: 15_000 });
        if (!response.ok) throw new Error('Failed to fetch following');
        return { items: await response.json(), nextCursor: nextCursorFrom(response) };
    },

    getUserFollowing: async (userId: string, _currentUserId?: string) => {
        const page = await api.getUserFollowingPage(userId);
        return page.items;
    },

    savePost: async (postId: string, _userId?: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/${postId}/save`, {
            method: 'POST'
        });
        if (!response.ok) throw new Error('Failed to save post');
        return response.json();
    },

    unsavePost: async (postId: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/${postId}/save`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Failed to remove saved post');
        return response.json();
    },

    hidePost: async (postId: string, _userId?: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/${postId}/hide`, {
            method: 'POST'
        });
        if (!response.ok) throw new Error('Failed to hide post');
        return response.json();
    },

    unhidePost: async (postId: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/${postId}/hide`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Failed to restore post');
        return response.json();
    },

    reportPost: async (postId: string, reason: string, description?: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/${postId}/report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason, description })
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to report post');
        }
        return response.json();
    },

    trackInteractionsBatch: async (events: any[]) => {
        try {
            const response = await authFetch(`${API_BASE_URL}/analytics/interactions/batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(events)
            });
            if (!response.ok) throw new Error('Failed to send analytics');
            return response.json();
        } catch (error) {
            console.warn("Analytics failed, but continuing:", error);
            // Non-blocking in frontend
            return null;
        }
    },

    getNotificationsPage: async (
        userId: string,
        cursor?: string,
        limit: number = 50,
        requestOptions: ApiRequestOptions = {}
    ): Promise<NotificationPage> => {
        const query = new URLSearchParams({ limit: String(limit) });
        if (cursor) query.set('cursor', cursor);

        const response = await authFetch(
            `${API_BASE_URL}/users/${userId}/notifications?${query.toString()}`,
            requestOptions
        );
        if (!response.ok) await throwApiError(response, 'Failed to fetch notifications');

        const items = await response.json();
        if (!Array.isArray(items)) {
            throw new ApiError('Invalid notifications response', 502, 'INVALID_NOTIFICATIONS_RESPONSE');
        }

        return {
            items,
            nextCursor: response.headers.get('X-Next-Cursor') || null
        };
    },

    // Preserve the existing array-returning API for callers that do not need pagination.
    getNotifications: async (userId: string): Promise<Notification[]> => {
        const query = new URLSearchParams({ limit: '50' });
        const response = await authFetch(`${API_BASE_URL}/users/${userId}/notifications?${query.toString()}`);
        if (!response.ok) await throwApiError(response, 'Failed to fetch notifications');
        const items = await response.json();
        if (!Array.isArray(items)) {
            throw new ApiError('Invalid notifications response', 502, 'INVALID_NOTIFICATIONS_RESPONSE');
        }
        return items;
    },

    markNotificationsRead: async (userId: string) => {
        const response = await authFetch(`${API_BASE_URL}/users/${userId}/notifications/read`, { method: 'POST' });
        if (!response.ok) throw new Error('Failed to mark notifications read');
        return response.json();
    },

    markNotificationRead: async (userId: string, notifId: string) => {
        const response = await authFetch(`${API_BASE_URL}/users/${userId}/notifications/${notifId}/read`, { method: 'POST' });
        if (!response.ok) throw new Error('Failed to mark single notification read');
        return response.json();
    },

    getGroupById: async (groupId: string, signal?: AbortSignal) => {
        const response = await authFetch(`${API_BASE_URL}/groups/${groupId}`, { signal, timeoutMs: 15_000 });
        if (!response.ok) throw new Error('Failed to fetch group');
        return response.json();
    },

    getMembership: async (groupId: string) => {
        const response = await authFetch(`${API_BASE_URL}/groups/${groupId}/membership`);
        if (!response.ok) throw new Error('Failed to fetch group membership status');
        return response.json();
    },

    joinGroup: async (groupId: string) => {
        const response = await authFetch(`${API_BASE_URL}/groups/${groupId}/join`, {
            method: 'POST'
        });
        if (!response.ok) throw new Error('Failed to join group');
        return response.json();
    },

    leaveGroup: async (groupId: string) => {
        const response = await authFetch(`${API_BASE_URL}/groups/${groupId}/leave`, {
            method: 'POST'
        });
        if (!response.ok) throw new Error('Failed to leave group');
        return response.json();
    },

    requestJoin: async (groupId: string) => {
        const response = await authFetch(`${API_BASE_URL}/groups/${groupId}/request-join`, {
            method: 'POST'
        });
        if (!response.ok) throw new Error('Failed to request joining group');
        return response.json();
    },

    getGroupStats: async (groupId: string) => {
        const response = await authFetch(`${API_BASE_URL}/groups/${groupId}/stats`);
        if (!response.ok) throw new Error('Failed to fetch group statistics');
        return response.json();
    },

    getGroupMembers: async (groupId: string, page = 1, limit = 20) => {
        const response = await authFetch(`${API_BASE_URL}/groups/${groupId}/members?page=${page}&limit=${limit}`);
        if (!response.ok) throw new Error('Failed to fetch group members');
        return response.json();
    },

    getGroupPosts: async (groupId: string, page = 1, limit = 10) => {
        const response = await authFetch(`${API_BASE_URL}/groups/${groupId}/posts?page=${page}&limit=${limit}`);
        if (!response.ok) throw new Error('Failed to fetch group posts');
        return response.json();
    },

    createGroup: async (data: any) => {
        const response = await authFetch(`${API_BASE_URL}/groups`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to create group');
        }
        return response.json();
    },

    getUserGroups: async (userId: string, requestOptions: ApiRequestOptions = {}) => {
        const response = await authFetch(`${API_BASE_URL}/users/${userId}/groups`, requestOptions);
        if (!response.ok) await throwApiError(response, 'Failed to fetch user groups');
        return response.json();
    },

    updateGroup: async (groupId: string, data: any) => {
        const response = await authFetch(`${API_BASE_URL}/groups/${groupId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error('Failed to update group settings');
        return response.json();
    },

    deleteGroup: async (groupId: string) => {
        const response = await authFetch(`${API_BASE_URL}/groups/${groupId}`, {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error('Failed to delete group');
        return response.json();
    },

    updateMemberRole: async (groupId: string, memberId: string, role: string) => {
        const response = await authFetch(`${API_BASE_URL}/groups/${groupId}/members/${memberId}/role`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role })
        });
        if (!response.ok) throw new Error('Failed to update member role');
        return response.json();
    },

    kickMember: async (groupId: string, memberId: string) => {
        const response = await authFetch(`${API_BASE_URL}/groups/${groupId}/members/${memberId}/kick`, {
            method: 'POST'
        });
        if (!response.ok) throw new Error('Failed to kick member');
        return response.json();
    },

    banMember: async (groupId: string, memberId: string) => {
        const response = await authFetch(`${API_BASE_URL}/groups/${groupId}/members/${memberId}/ban`, {
            method: 'POST'
        });
        if (!response.ok) throw new Error('Failed to ban member');
        return response.json();
    },

    getPendingRequests: async (groupId: string) => {
        const response = await authFetch(`${API_BASE_URL}/groups/${groupId}/pending-requests`);
        if (!response.ok) throw new Error('Failed to fetch pending requests');
        return response.json();
    },

    approveJoinRequest: async (groupId: string, memberId: string) => {
        const response = await authFetch(`${API_BASE_URL}/groups/${groupId}/members/${memberId}/approve`, {
            method: 'POST'
        });
        if (!response.ok) throw new Error('Failed to approve join request');
        return response.json();
    },

    rejectJoinRequest: async (groupId: string, memberId: string) => {
        const response = await authFetch(`${API_BASE_URL}/groups/${groupId}/members/${memberId}/reject`, {
            method: 'POST'
        });
        if (!response.ok) throw new Error('Failed to reject join request');
        return response.json();
    },

    getPendingPosts: async (groupId: string) => {
        const response = await authFetch(`${API_BASE_URL}/groups/${groupId}/pending-posts`);
        if (!response.ok) throw new Error('Failed to fetch pending posts');
        return response.json();
    },

    approvePendingPost: async (groupId: string, postId: string) => {
        const response = await authFetch(`${API_BASE_URL}/groups/${groupId}/posts/${postId}/approve`, {
            method: 'POST'
        });
        if (!response.ok) throw new Error('Failed to approve post');
        return response.json();
    },

    rejectPendingPost: async (groupId: string, postId: string, reason: string) => {
        const response = await authFetch(`${API_BASE_URL}/groups/${groupId}/posts/${postId}/reject`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason })
        });
        if (!response.ok) throw new Error('Failed to reject post');
        return response.json();
    },
    inviteToGroup: async (groupId: string, userId: string) => {
        const response = await authFetch(`${API_BASE_URL}/groups/${groupId}/invite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error((err as any).error || 'Failed to invite user');
        }
        return response.json();
    },

    declineGroupInvite: async (groupId: string) => {
        const response = await authFetch(`${API_BASE_URL}/groups/${groupId}/invite/decline`, {
            method: 'POST'
        });
        if (!response.ok) throw new Error('Failed to decline invite');
        return response.json();
    },

    cancelGroupJoinRequest: async (groupId: string) => {
        const response = await authFetch(`${API_BASE_URL}/groups/${groupId}/cancel-request`, {
            method: 'DELETE'
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to cancel join request');
        }
        return response.json();
    },

    getBannedMembers: async (groupId: string) => {
        const response = await authFetch(`${API_BASE_URL}/groups/${groupId}/banned-members`);
        if (!response.ok) throw new Error('Failed to fetch banned members');
        return response.json();
    },

    unbanMember: async (groupId: string, memberId: string) => {
        const response = await authFetch(`${API_BASE_URL}/groups/${groupId}/members/${memberId}/unban`, {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error('Failed to unban member');
        return response.json();
    },

    getVapidPublicKey: async () => {
        const response = await fetch(`${API_BASE_URL}/push/vapid-public-key`);
        if (!response.ok) throw new Error('Failed to get VAPID public key');
        return response.json();
    },

    subscribeToPush: async (subscription: any) => {
        const response = await authFetch(`${API_BASE_URL}/push/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscription })
        });
        if (!response.ok) throw new Error('Failed to subscribe to push notifications');
        return response.json();
    },

    unsubscribeFromPush: async (endpoint?: string) => {
        const response = await authFetch(`${API_BASE_URL}/push/unsubscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint })
        });
        if (!response.ok) throw new Error('Failed to unsubscribe from push notifications');
        return response.json();
    },

    setupPushNotifications: async () => {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
        try {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') return false;

            const registration = await navigator.serviceWorker.ready;
            const res = await authFetch(`${API_BASE_URL}/push/vapid-public-key`);
            if (!res.ok) throw new Error('Failed to fetch vapid key');
            const { publicKey } = await res.json();

            const padding = '='.repeat((4 - publicKey.length % 4) % 4);
            const base64 = (publicKey + padding).replace(/\-/g, '+').replace(/_/g, '/');
            const rawData = window.atob(base64);
            const outputArray = new Uint8Array(rawData.length);
            for (let i = 0; i < rawData.length; ++i) {
                outputArray[i] = rawData.charCodeAt(i);
            }

            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: outputArray
            });

            await authFetch(`${API_BASE_URL}/push/subscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subscription })
            });
            return true;
        } catch (e) {
            console.error('Failed to setup push notifications', e);
            return false;
        }
    }
};
