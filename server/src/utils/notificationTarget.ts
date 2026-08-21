export type MentionNotificationSourceType = 'post' | 'comment' | 'reply';

export interface MentionNotificationTarget {
    postId: string;
    commentId?: string;
    replyId?: string;
    sourceType: MentionNotificationSourceType;
    deepLink: string;
}

export type NotificationPayload = Record<string, unknown> & {
    postId?: string;
    commentId?: string;
    replyId?: string;
    sourceType?: string;
    deepLink?: string;
};

const stringValue = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;

export const parseNotificationPayload = (payload: unknown): NotificationPayload => {
    if (!payload) return {};
    if (typeof payload === 'object' && !Array.isArray(payload)) return payload as NotificationPayload;
    if (typeof payload !== 'string') return {};

    try {
        const parsed = JSON.parse(payload);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
};

export const buildPostDeepLink = (postId: string, commentId?: string, replyId?: string): string => {
    const params = new URLSearchParams();
    if (commentId) params.set('comment', commentId);
    if (replyId) params.set('reply', replyId);
    const query = params.toString();
    return `/post/${encodeURIComponent(postId)}${query ? `?${query}` : ''}`;
};

export const buildNotificationDeepLink = (
    targetType?: string | null,
    targetId?: string | null,
    payload?: unknown
): string | undefined => {
    const parsed = parseNotificationPayload(payload);
    const normalizedTargetType = targetType?.toLowerCase();
    const postId = stringValue(parsed.postId)
        || ((normalizedTargetType === 'post' || normalizedTargetType === 'survey') ? stringValue(targetId) : undefined);

    if (postId) {
        return buildPostDeepLink(postId, stringValue(parsed.commentId), stringValue(parsed.replyId));
    }
    if ((normalizedTargetType === 'profile' || normalizedTargetType === 'user') && targetId) {
        return `/profile/${encodeURIComponent(targetId)}`;
    }
    if (normalizedTargetType === 'group' && targetId) {
        return `/group/${encodeURIComponent(targetId)}`;
    }
    return undefined;
};

export const withNotificationDeepLink = (
    targetType?: string | null,
    targetId?: string | null,
    payload?: unknown
): NotificationPayload | undefined => {
    const parsed = parseNotificationPayload(payload);
    const deepLink = buildNotificationDeepLink(targetType, targetId, parsed);
    if (!deepLink && Object.keys(parsed).length === 0) return undefined;
    return deepLink ? { ...parsed, deepLink } : parsed;
};

export const createMentionNotificationTarget = (input: {
    postId: string;
    commentId?: string;
    replyId?: string;
}): MentionNotificationTarget => {
    const sourceType: MentionNotificationSourceType = input.replyId
        ? 'reply'
        : input.commentId
            ? 'comment'
            : 'post';

    return {
        postId: input.postId,
        ...(input.commentId ? { commentId: input.commentId } : {}),
        ...(input.replyId ? { replyId: input.replyId } : {}),
        sourceType,
        deepLink: buildPostDeepLink(input.postId, input.commentId, input.replyId)
    };
};
