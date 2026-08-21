import { normalizeSurvey, PostAnswerPayload } from '../types';

export const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

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
            // Local dev falls back to :3001, otherwise extract from the API URL
            const baseUrl = API_BASE_URL === '/api' ? 'http://localhost:3001' : API_BASE_URL.replace(/\/api\/?$/, '');
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

export const authFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const token = localStorage.getItem('si_token');
    const headers = new Headers(init?.headers);
    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }
    
    // Default Content-Type if body exists and no content-type is set
    if (init?.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    const modifiedInit = {
        ...init,
        headers
    };

    let fetchUrl = input;
    if (typeof input === 'string') {
        if (input.startsWith('/api')) {
            fetchUrl = input.replace(/^\/api/, API_BASE_URL);
        } else if (input.startsWith('/') && !input.startsWith('http')) {
            fetchUrl = `${API_BASE_URL}${input}`;
        }
    }

    const response = await fetch(fetchUrl, modifiedInit);
    
    if (response.status === 401) {
        // Handle unauthorized (expired token or invalid)
        console.error('Authentication expired. Logging out...');
        localStorage.removeItem('si_token');
        localStorage.removeItem('si_user');
        window.dispatchEvent(new Event('auth_expired'));
    }
    
    // Intercept .json() to resolve asset paths automatically
    const originalJson = response.json.bind(response);
    response.json = async () => {
        const data = await originalJson();
        return resolveAssets(data);
    };
    
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
    getSurveys: async (userId?: string, cursor?: string, limit: number = 10, authorId?: string, authorHandle?: string) => {
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
        const response = await authFetch(url);
        if (!response.ok) throw new Error('Failed to fetch posts');
        const json = await response.json();
        return {
            data: json.data.map(normalizeSurvey),
            nextCursor: json.nextCursor
        };
    },

    getSurveyById: async (id: string, userId?: string) => {
        const guestId = !userId ? getGuestId() : undefined;
        const url = userId ? `${API_BASE_URL}/posts/${id}?userId=${userId}` : `${API_BASE_URL}/posts/${id}?guestId=${guestId}`;
        const response = await authFetch(url);
        if (!response.ok) throw new Error('Failed to fetch post');
        const data = await response.json();
        return normalizeSurvey(data);
    },

    getDrafts: async (userId: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/drafts?userId=${userId}`);
        if (!response.ok) throw new Error('Failed to fetch drafts');
        const data = await response.json();
        return data.map(normalizeSurvey);
    },

    getSavedPosts: async (userId: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/saved?userId=${userId}`);
        if (!response.ok) throw new Error('Failed to fetch saved posts');
        const data = await response.json();
        return data.map(normalizeSurvey);
    },

    deletePost: async (postId: string, userId: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/${postId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
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

    getParticipants: async (postId: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/${postId}/participants`);
        if (!response.ok) throw new Error('Failed to fetch participants');
        return response.json();
    },

    getPostResults: async (postId: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/${postId}/results`);
        if (!response.ok) throw new Error('Failed to fetch post results');
        return response.json();
    },

    getUsers: async () => {
        const response = await authFetch(`${API_BASE_URL}/users`);
        if (!response.ok) throw new Error('Failed to fetch users');
        return response.json();
    },

    getSuggestedUsers: async (userId: string) => {
        const response = await authFetch(`${API_BASE_URL}/users/${userId}/suggested`);
        if (!response.ok) throw new Error('Failed to fetch suggested users');
        return response.json();
    },

    searchUsers: async (query: string, signal?: AbortSignal) => {
        if (!query) return [];
        const response = await authFetch(`${API_BASE_URL}/users/search?q=${encodeURIComponent(query)}`, { signal });
        if (!response.ok) await throwApiError(response, 'Failed to search users');
        return response.json();
    },

    searchAll: async (query: string) => {
        if (!query) return { surveys: [], people: [], groups: [], categories: [] };
        const response = await authFetch(`${API_BASE_URL}/search?q=${encodeURIComponent(query)}`);
        if (!response.ok) throw new Error('Failed to fetch search results');
        return response.json();
    },

    getGroups: async () => {
        const response = await authFetch(`${API_BASE_URL}/groups`);
        if (!response.ok) throw new Error('Failed to fetch groups');
        return response.json();
    },

    getTrends: async (params: { period?: string; type?: string; country?: string; limit?: number; category?: string }) => {
        const queryParams = new URLSearchParams();
        if (params.period) queryParams.append('period', params.period);
        if (params.type) queryParams.append('type', params.type);
        if (params.country) queryParams.append('country', params.country);
        if (params.limit) queryParams.append('limit', params.limit.toString());
        if (params.category) queryParams.append('category', params.category);

        const response = await authFetch(`${API_BASE_URL}/posts/trends?${queryParams.toString()}`);
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

    getComments: async (postId: string, userId?: string) => {
        const url = userId ? `${API_BASE_URL}/posts/${postId}/comments?userId=${userId}` : `${API_BASE_URL}/posts/${postId}/comments`;
        console.log("api.getComments called with userId:", userId);
        const response = await authFetch(url);
        if (!response.ok) throw new Error('Failed to fetch comments');
        return response.json();
    },

    createComment: async (postId: string, text: string, parentId?: string, authorId?: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/${postId}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, parentId, userId: authorId })
        });
        if (!response.ok) await throwApiError(response, 'Failed to create comment');
        return response.json();
    },

    updateComment: async (commentId: string, text: string, userId: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/comments/${commentId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, userId })
        });
        if (!response.ok) throw new Error('Failed to update comment');
        return response.json();
    },

    deleteComment: async (commentId: string, userId: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/comments/${commentId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
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
        if (!response.ok) throw new Error('Failed to update user');
        return response.json();
    },

    getUser: async (userId: string) => {
        const response = await authFetch(`${API_BASE_URL}/users/${userId}`);
        if (!response.ok) throw new Error('Failed to fetch user');
        return response.json();
    },

    getUserByHandle: async (handle: string) => {
        let cleanHandle = handle.startsWith('@') ? handle.substring(1) : handle;
        const response = await authFetch(`${API_BASE_URL}/users/handle/${cleanHandle}`);
        if (!response.ok) throw new Error('Failed to fetch user by handle');
        return response.json();
    },

    getUserAnalytics: async (userId: string) => {
        const response = await authFetch(`${API_BASE_URL}/users/${userId}/analytics`);
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

    likeSurvey: async (postId: string, userId: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/${postId}/like`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        if (!response.ok) throw new Error('Failed to like post');
        return response.json();
    },

    getPostLikers: async (postId: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/${postId}/likes`);
        if (!response.ok) throw new Error('Failed to fetch post likers');
        return response.json();
    },

    likeComment: async (commentId: string, userId: string) => {
        console.log("api.likeComment called with:", { commentId, userId });
        const response = await authFetch(`${API_BASE_URL}/posts/comments/${commentId}/like`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        if (!response.ok) throw new Error('Failed to like comment');
        return response.json();
    },

    getCommentLikers: async (commentId: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/comments/${commentId}/likes`);
        if (!response.ok) throw new Error('Failed to fetch comment likers');
        return response.json();
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
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Login failed');
        }
        const responseData = await response.json();
        if (responseData.token) {
            localStorage.setItem('si_token', responseData.token);
        }
        return responseData;
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
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to send OTP');
        }
        return response.json();
    },

    completeRegistration: async (pendingId: string, code: string) => {
        const response = await authFetch(`${API_BASE_URL}/auth/register/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pendingId, code })
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to complete registration');
        }
        const responseData = await response.json();
        if (responseData.token) {
            localStorage.setItem('si_token', responseData.token);
        }
        return responseData;
    },

    getUserFollowers: async (userId: string, currentUserId?: string) => {
        const url = currentUserId
            ? `${API_BASE_URL}/users/${userId}/followers?currentUserId=${currentUserId}`
            : `${API_BASE_URL}/users/${userId}/followers`;
        const response = await authFetch(url);
        if (!response.ok) throw new Error('Failed to fetch followers');
        return response.json();
    },

    getUserFollowing: async (userId: string, currentUserId?: string) => {
        const url = currentUserId
            ? `${API_BASE_URL}/users/${userId}/following?currentUserId=${currentUserId}`
            : `${API_BASE_URL}/users/${userId}/following`;
        const response = await authFetch(url);
        if (!response.ok) throw new Error('Failed to fetch following');
        return response.json();
    },

    savePost: async (postId: string, userId: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/${postId}/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        if (!response.ok) throw new Error('Failed to save post');
        return response.json();
    },

    hidePost: async (postId: string, userId: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/${postId}/hide`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        if (!response.ok) throw new Error('Failed to hide post');
        return response.json();
    },

    reportPost: async (postId: string, userId: string, reason: string, description?: string) => {
        const response = await authFetch(`${API_BASE_URL}/posts/${postId}/report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, reason, description })
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

    getNotifications: async (userId: string) => {
        const response = await authFetch(`${API_BASE_URL}/users/${userId}/notifications`);
        if (!response.ok) throw new Error('Failed to fetch notifications');
        return response.json();
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

    getGroupById: async (groupId: string) => {
        const response = await authFetch(`${API_BASE_URL}/groups/${groupId}`);
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

    getUserGroups: async (userId: string) => {
        const response = await authFetch(`${API_BASE_URL}/users/${userId}/groups`);
        if (!response.ok) throw new Error('Failed to fetch user groups');
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

    setupPushNotifications: async (token?: string) => {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
        try {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') return false;

            const registration = await navigator.serviceWorker.ready;
            const res = await fetch(`${API_BASE_URL}/push/vapid-public-key`);
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

            const headers = new Headers({ 'Content-Type': 'application/json' });
            const authToken = token || localStorage.getItem('si_token');
            if (authToken) headers.set('Authorization', `Bearer ${authToken}`);

            await fetch(`${API_BASE_URL}/push/subscribe`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ subscription })
            });
            return true;
        } catch (e) {
            console.error('Failed to setup push notifications', e);
            return false;
        }
    }
};
