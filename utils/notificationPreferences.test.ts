import assert from 'node:assert/strict';
import test from 'node:test';
import { notificationPreferencesDirty, validNotificationPreferences, validQuietHours } from './notificationPreferences.ts';
import type { NotificationPreferences } from './notificationPreferences.ts';
const defaults = (): NotificationPreferences => ({ myPosts: { likes: 'everyone', comments: 'everyone', shares: 'following' }, toggles: { newFollowers: true, invitations: true, commentInteractions: true, mentions: true, peopleTags: true, pushNotifications: false }, quietHours: { enabled: false, start: '22:00', end: '08:00', timeZone: 'UTC' } });
test('notification preferences only enable save for net event or channel changes', () => {
  const saved = defaults(); const draft = defaults();
  assert.equal(notificationPreferencesDirty(draft, saved), false);
  draft.toggles.pushNotifications = true;
  assert.equal(notificationPreferencesDirty(draft, saved), true);
  draft.toggles.pushNotifications = false;
  assert.equal(notificationPreferencesDirty(draft, saved), false);
  draft.quietHours.timeZone = 'Asia/Amman';
  assert.equal(notificationPreferencesDirty(draft, saved), true);
});
test('notification settings reject partial server payloads instead of inventing saved defaults', () => {
  assert.equal(validNotificationPreferences({}), false);
  assert.equal(validNotificationPreferences(defaults()), true);
  const missing = defaults(); delete (missing.toggles as any).mentions;
  assert.equal(validNotificationPreferences(missing), false);
});
test('quiet hours validate local times, overnight windows and IANA time zones', () => {
  assert.equal(validQuietHours({ enabled: true, start: '22:00', end: '08:00', timeZone: 'Asia/Amman' }), true);
  assert.equal(validQuietHours({ enabled: true, start: '08:00', end: '08:00', timeZone: 'UTC' }), false);
  assert.equal(validQuietHours({ enabled: true, start: '25:00', end: '08:00', timeZone: 'UTC' }), false);
  assert.equal(validQuietHours({ enabled: true, start: '22:00', end: '08:00', timeZone: 'Not/AZone' }), false);
});
