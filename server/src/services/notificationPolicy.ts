import { z } from 'zod';

const tri = z.enum(['everyone', 'following', 'off']);
const validTimezone = (value: string) => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; } catch { return false; }
};
export const notificationSettingsSchema = z.object({
  myPosts: z.object({ likes: tri, comments: tri, shares: tri }).strict(),
  toggles: z.object({ newFollowers: z.boolean(), invitations: z.boolean(), commentInteractions: z.boolean(),
    mentions: z.boolean(), peopleTags: z.boolean(), pushNotifications: z.boolean() }).strict(),
  quietHours: z.object({ enabled: z.boolean(), start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), timeZone: z.string().min(1).max(100).refine(validTimezone) }).strict()
}).strict().refine(s => !s.quietHours.enabled || s.quietHours.start !== s.quietHours.end, { message: 'Quiet hours must have a distinct start and end' });
export type NotificationPreferences = z.infer<typeof notificationSettingsSchema>;
export const defaultNotificationSettings: NotificationPreferences = {
  myPosts: { likes: 'everyone', comments: 'everyone', shares: 'following' },
  toggles: { newFollowers: true, invitations: true, commentInteractions: true, mentions: true, peopleTags: true, pushNotifications: false },
  quietHours: { enabled: false, start: '22:00', end: '08:00', timeZone: 'UTC' }
};

// Migrate only known, well-typed legacy values. Removed controls are never echoed.
export function readNotificationSettings(stored?: string | null): NotificationPreferences {
  let old: any; try { old = JSON.parse(stored || '{}'); } catch { old = {}; }
  const value = structuredClone(defaultNotificationSettings);
  for (const key of ['likes', 'comments', 'shares'] as const) {
    if (tri.safeParse(old?.myPosts?.[key]).success) value.myPosts[key] = old.myPosts[key];
  }
  for (const key of Object.keys(value.toggles) as (keyof typeof value.toggles)[]) {
    if (typeof old?.toggles?.[key] === 'boolean') value.toggles[key] = old.toggles[key];
  }
  const parsed = notificationSettingsSchema.safeParse({ ...value, quietHours: old?.quietHours || value.quietHours });
  return parsed.success ? parsed.data : value;
}

export function isQuietTime(settings: NotificationPreferences, now = new Date()): boolean {
  const quiet = settings.quietHours;
  if (!quiet.enabled) return false;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: quiet.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const local = `${parts.find(p => p.type === 'hour')!.value}:${parts.find(p => p.type === 'minute')!.value}`;
  return quiet.start < quiet.end ? local >= quiet.start && local < quiet.end : local >= quiet.start || local < quiet.end;
}

export function eventAllowed(settings: NotificationPreferences, type: string, following: boolean, payload?: Record<string, any>): boolean {
  let option: 'everyone' | 'following' | 'off' | undefined;
  if (type === 'like' && payload?.commentId || type === 'response' && payload?.replyId) return settings.toggles.commentInteractions;
  if (type === 'like') option = settings.myPosts.likes;
  if (['comment', 'response', 'vote'].includes(type)) option = settings.myPosts.comments;
  if (type === 'share') option = settings.myPosts.shares;
  if (option) return option === 'everyone' || option === 'following' && following;
  if (['follow', 'follow_request', 'follow_accept'].includes(type)) return settings.toggles.newFollowers;
  if (type === 'group_invite') return settings.toggles.invitations;
  if (type === 'mention') return settings.toggles.mentions;
  if (['people_tag', 'tag', 'tag_request'].includes(type)) return settings.toggles.peopleTags;
  return true; // Group moderation decisions have no misleading optional control.
}

export async function canCreateNotification(db: any, userId: string, actorId: string | null | undefined, type: string, payload?: Record<string, any>): Promise<boolean> {
  if (userId === actorId) return false;
  const user = await db.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!user || user.status !== 'ACTIVE') return false;
  if (actorId) {
    const blocked = await db.userBlock.findFirst({ where: { OR: [{ blockerId: userId, blockedId: actorId }, { blockerId: actorId, blockedId: userId }] }, select: { id: true } });
    if (blocked) return false;
  }
  const record = await db.notificationSettings.findUnique({ where: { userId } });
  const settings = readNotificationSettings(record?.settings);
  const needsFollowing = Object.values(settings.myPosts).includes('following');
  const follow = needsFollowing && actorId ? await db.follow.findUnique({ where: { followerId_followingId: { followerId: userId, followingId: actorId } }, select: { status: true } }) : null;
  return eventAllowed(settings, type, follow?.status === 'ACTIVE', payload);
}
