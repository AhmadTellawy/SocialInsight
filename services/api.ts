import { normalizeSurvey } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

export const api = {
    getSurveys: async (userId?: string) => {
        const url = userId ? `${API_BASE_URL}/posts?userId=${userId}` : `${API_BASE_URL}/posts`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch posts');
        const data = await response.json();
        return data.map(normalizeSurvey);
    },

    getSurveyById: async (id: string, userId?: string) => {
        const url = userId ? `${API_BASE_URL}/posts/${id}?userId=${userId}` : `${API_BASE_URL}/posts/${id}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch post');
        const data = await response.json();
        return normalizeSurvey(data);
    },

    getDrafts: async (userId: string) => {
        const response = await fetch(`${API_BASE_URL}/posts/drafts?userId=${userId}`);
        if (!response.ok) throw new Error('Failed to fetch drafts');
        const data = await response.json();
        return data.map(normalizeSurvey);
    },

    getSavedPosts: async (userId: string) => {
        const response = await fetch(`${API_BASE_URL}/posts/saved?userId=${userId}`);
        if (!response.ok) throw new Error('Failed to fetch saved posts');
        const data = await response.json();
        return data.map(normalizeSurvey);
    },

    deletePost: async (postId: string) => {
        const response = await fetch(`${API_BASE_URL}/posts/${postId}`, {
            method: 'DELETE',
        });
        if (!response.ok) throw new Error('Failed to delete post');
        return response.json();
    },

    updatePost: async (postId: string, data: any) => {
        const response = await fetch(`${API_BASE_URL}/posts/${postId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error('Failed to update post');
        const resData = await response.json();
        return normalizeSurvey(resData);
    },

    vote: async (postId: string, optionId: string, userId: string, isAnonymous: boolean = false) => {
        const response = await fetch(`${API_BASE_URL}/posts/${postId}/vote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ optionId, userId, isAnonymous })
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to vote');
        }
        return response.json();
    },

    getParticipants: async (postId: string) => {
        const response = await fetch(`${API_BASE_URL}/posts/${postId}/participants`);
        if (!response.ok) throw new Error('Failed to fetch participants');
        return response.json();
    },

    getPostResults: async (postId: string) => {
        const response = await fetch(`${API_BASE_URL}/posts/${postId}/results`);
        if (!response.ok) throw new Error('Failed to fetch post results');
        return response.json();
    },

    getUsers: async () => {
        const response = await fetch(`${API_BASE_URL}/users`);
        if (!response.ok) throw new Error('Failed to fetch users');
        return response.json();
    },

    searchUsers: async (query: string) => {
        if (!query) return [];
        const response = await fetch(`${API_BASE_URL}/users/search?q=${encodeURIComponent(query)}`);
        if (!response.ok) throw new Error('Failed to search users');
        return response.json();
    },

    getGroups: async () => {
        const response = await fetch(`${API_BASE_URL}/groups`);
        if (!response.ok) throw new Error('Failed to fetch groups');
        return response.json();
    },

    createSurvey: async (data: any) => {
        const response = await fetch(`${API_BASE_URL}/posts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error('Failed to create post');
        const resData = await response.json();
        return normalizeSurvey(resData);
    },

    sharePost: async (postId: string, userId: string, caption: string) => {
        const response = await fetch(`${API_BASE_URL}/posts/${postId}/share`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, caption })
        });
        if (!response.ok) throw new Error('Failed to share post');
        const resData = await response.json();
        return normalizeSurvey(resData);
    },

    getComments: async (postId: string, userId?: string) => {
        const url = userId ? `${API_BASE_URL}/posts/${postId}/comments?userId=${userId}` : `${API_BASE_URL}/posts/${postId}/comments`;
        console.log("api.getComments called with userId:", userId);
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch comments');
        return response.json();
    },

    createComment: async (postId: string, text: string, parentId?: string, authorId?: string) => {
        const response = await fetch(`${API_BASE_URL}/posts/${postId}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, parentId, userId: authorId })
        });
        if (!response.ok) throw new Error('Failed to create comment');
        return response.json();
    },

    updateUser: async (userId: string, data: any) => {
        const response = await fetch(`${API_BASE_URL}/users/${userId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error('Failed to update user');
        return response.json();
    },

    getUser: async (userId: string) => {
        const response = await fetch(`${API_BASE_URL}/users/${userId}`);
        if (!response.ok) throw new Error('Failed to fetch user');
        return response.json();
    },

    getUserAnalytics: async (userId: string) => {
        const response = await fetch(`${API_BASE_URL}/users/${userId}/analytics`);
        if (!response.ok) throw new Error('Failed to fetch user analytics');
        return response.json();
    },

    likeSurvey: async (postId: string, userId: string) => {
        const response = await fetch(`${API_BASE_URL}/posts/${postId}/like`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        if (!response.ok) throw new Error('Failed to like post');
        return response.json();
    },

    getPostLikers: async (postId: string) => {
        const response = await fetch(`${API_BASE_URL}/posts/${postId}/likes`);
        if (!response.ok) throw new Error('Failed to fetch post likers');
        return response.json();
    },

    likeComment: async (commentId: string, userId: string) => {
        console.log("api.likeComment called with:", { commentId, userId });
        const response = await fetch(`${API_BASE_URL}/posts/comments/${commentId}/like`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        if (!response.ok) throw new Error('Failed to like comment');
        return response.json();
    },

    getCommentLikers: async (commentId: string) => {
        const response = await fetch(`${API_BASE_URL}/posts/comments/${commentId}/likes`);
        if (!response.ok) throw new Error('Failed to fetch comment likers');
        return response.json();
    },

    followUser: async (userId: string, currentUserId: string) => {
        const response = await fetch(`${API_BASE_URL}/users/${userId}/follow`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentUserId })
        });
        if (!response.ok) throw new Error('Failed to follow user');
        return response.json();
    },

    getFollowStatus: async (userId: string, currentUserId: string) => {
        const response = await fetch(`${API_BASE_URL}/users/${userId}/follow-status?currentUserId=${currentUserId}`);
        if (!response.ok) throw new Error('Failed to get follow status');
        return response.json();
    },

    register: async (data: any) => {
        const response = await fetch(`${API_BASE_URL}/auth/register`, {
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
        const response = await fetch(`${API_BASE_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Login failed');
        }
        return response.json();
    },

    sendOTP: async (identifier: string, type: 'email' | 'phone') => {
        const response = await fetch(`${API_BASE_URL}/otp/send`, {
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
        const response = await fetch(`${API_BASE_URL}/otp/verify`, {
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
        const response = await fetch(`${API_BASE_URL}/auth/register/init`, {
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
        const response = await fetch(`${API_BASE_URL}/auth/register/password`, {
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
        const response = await fetch(`${API_BASE_URL}/auth/handle/check?handle=${handle}`);
        if (!response.ok) throw new Error('Check failed');
        return response.json();
    },

    reserveHandle: async (pendingId: string, handle: string) => {
        const response = await fetch(`${API_BASE_URL}/auth/handle/reserve`, {
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
        const response = await fetch(`${API_BASE_URL}/auth/register/otp/send`, {
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
        const response = await fetch(`${API_BASE_URL}/auth/register/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pendingId, code })
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to complete registration');
        }
        return response.json();
    },

    getUserFollowers: async (userId: string, currentUserId?: string) => {
        const url = currentUserId
            ? `${API_BASE_URL}/users/${userId}/followers?currentUserId=${currentUserId}`
            : `${API_BASE_URL}/users/${userId}/followers`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch followers');
        return response.json();
    },

    getUserFollowing: async (userId: string, currentUserId?: string) => {
        const url = currentUserId
            ? `${API_BASE_URL}/users/${userId}/following?currentUserId=${currentUserId}`
            : `${API_BASE_URL}/users/${userId}/following`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch following');
        return response.json();
    },

    savePost: async (postId: string, userId: string) => {
        const response = await fetch(`${API_BASE_URL}/posts/${postId}/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        if (!response.ok) throw new Error('Failed to save post');
        return response.json();
    },

    hidePost: async (postId: string, userId: string) => {
        const response = await fetch(`${API_BASE_URL}/posts/${postId}/hide`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        if (!response.ok) throw new Error('Failed to hide post');
        return response.json();
    },

    reportPost: async (postId: string, userId: string, reason: string, description?: string) => {
        const response = await fetch(`${API_BASE_URL}/posts/${postId}/report`, {
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
            const response = await fetch(`${API_BASE_URL}/analytics/interactions/batch`, {
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
        const response = await fetch(`${API_BASE_URL}/users/${userId}/notifications`);
        if (!response.ok) throw new Error('Failed to fetch notifications');
        return response.json();
    },

    markNotificationsRead: async (userId: string) => {
        const response = await fetch(`${API_BASE_URL}/users/${userId}/notifications/read`, { method: 'POST' });
        if (!response.ok) throw new Error('Failed to mark notifications read');
        return response.json();
    },

    markNotificationRead: async (userId: string, notifId: string) => {
        const response = await fetch(`${API_BASE_URL}/users/${userId}/notifications/${notifId}/read`, { method: 'POST' });
        if (!response.ok) throw new Error('Failed to mark single notification read');
        return response.json();
    },

    getGroupById: async (groupId: string) => {
        const response = await fetch(`${API_BASE_URL}/groups/${groupId}`);
        if (!response.ok) throw new Error('Failed to fetch group');
        return response.json();
    },

    createGroup: async (data: any) => {
        const response = await fetch(`${API_BASE_URL}/groups`, {
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
        const response = await fetch(`${API_BASE_URL}/users/${userId}/groups`);
        if (!response.ok) throw new Error('Failed to fetch user groups');
        return response.json();
    }
};
