export type TriOption = 'everyone' | 'following' | 'off';
export interface NotificationPreferences {
  myPosts: { likes: TriOption; comments: TriOption; shares: TriOption };
  toggles: { newFollowers: boolean; invitations: boolean; commentInteractions: boolean; mentions: boolean; peopleTags: boolean; pushNotifications: boolean };
  quietHours: { enabled: boolean; start: string; end: string; timeZone: string };
}
export const validQuietHours = (quiet: NotificationPreferences['quietHours']): boolean => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(quiet.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(quiet.end)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: quiet.timeZone }).format(); } catch { return false; }
  return !quiet.enabled || quiet.start !== quiet.end;
};
export const validNotificationPreferences = (value: unknown): value is NotificationPreferences => {
  if (!value || typeof value !== 'object') return false;
  const record = value as NotificationPreferences;
  return ['likes', 'comments', 'shares'].every((key) => ['everyone', 'following', 'off'].includes(record.myPosts?.[key as keyof typeof record.myPosts]))
    && ['newFollowers', 'invitations', 'commentInteractions', 'mentions', 'peopleTags', 'pushNotifications'].every((key) => typeof record.toggles?.[key as keyof typeof record.toggles] === 'boolean')
    && typeof record.quietHours?.enabled === 'boolean' && typeof record.quietHours.timeZone === 'string' && validQuietHours(record.quietHours);
};
export const notificationPreferencesDirty = (draft: NotificationPreferences, saved: NotificationPreferences): boolean =>
  Object.keys(draft.myPosts).some((key) => draft.myPosts[key as keyof typeof draft.myPosts] !== saved.myPosts[key as keyof typeof draft.myPosts])
  || Object.keys(draft.toggles).some((key) => draft.toggles[key as keyof typeof draft.toggles] !== saved.toggles[key as keyof typeof draft.toggles])
  || Object.keys(draft.quietHours).some((key) => draft.quietHours[key as keyof typeof draft.quietHours] !== saved.quietHours[key as keyof typeof draft.quietHours]);
