export interface NotificationNavigationInput {
  targetId?: string;
  targetType?: string;
  deepLink?: string;
  payload?: {
    postId?: string;
    commentId?: string;
    replyId?: string;
    deepLink?: string;
  };
}

const safeInternalPath = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
  return value;
};

export const getNotificationDeepLink = (notification: NotificationNavigationInput): string | null => {
  const supplied = safeInternalPath(notification.deepLink) || safeInternalPath(notification.payload?.deepLink);
  if (supplied) return supplied;

  const targetType = notification.targetType?.toLowerCase();
  const postId = notification.payload?.postId
    || (targetType === 'post' || targetType === 'survey' ? notification.targetId : undefined);

  if (postId) {
    const params = new URLSearchParams();
    if (notification.payload?.commentId) params.set('comment', notification.payload.commentId);
    if (notification.payload?.replyId) params.set('reply', notification.payload.replyId);
    const query = params.toString();
    return `/post/${encodeURIComponent(postId)}${query ? `?${query}` : ''}`;
  }

  if ((targetType === 'profile' || targetType === 'user') && notification.targetId) {
    return `/profile/${encodeURIComponent(notification.targetId)}`;
  }
  if (targetType === 'group' && notification.targetId) {
    return `/group/${encodeURIComponent(notification.targetId)}`;
  }

  return null;
};
