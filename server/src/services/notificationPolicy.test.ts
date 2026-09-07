import assert from 'node:assert/strict';
import test from 'node:test';
import { canCreateNotification, defaultNotificationSettings, eventAllowed, isQuietTime, notificationSettingsSchema, readNotificationSettings } from './notificationPolicy';

test('push off preserves each in-app event category; pending follows are not following', async () => {
  const settings = structuredClone(defaultNotificationSettings);
  settings.myPosts.likes = 'following';
  assert.equal(eventAllowed(settings,'like', false), false);
  assert.equal(eventAllowed(settings,'like', true), true);
  settings.toggles.commentInteractions = false;
  assert.equal(eventAllowed(settings,'like', true,{commentId:'comment'}), false);
  assert.equal(eventAllowed(settings,'response', true,{replyId:'reply'}), false);
  assert.equal(eventAllowed(settings,'vote', false), true);
  const db = { user:{findUnique:async()=>({status:'ACTIVE'})}, userBlock:{findFirst:async()=>null}, notificationSettings:{findUnique:async()=>({settings:JSON.stringify(settings)})}, follow:{findUnique:async()=>({status:'PENDING'})} };
  assert.equal(await canCreateNotification(db,'recipient','actor','like'),false);
  assert.equal(await canCreateNotification(db,'recipient','actor','vote'),true);
});
test('every visible event toggle suppresses its event and block/inactive is authoritative', async () => {
  const settings = structuredClone(defaultNotificationSettings);
  for (const [key,type] of [['newFollowers','follow'],['invitations','group_invite'],['mentions','mention'],['peopleTags','people_tag']] as const) {
    settings.toggles[key] = false; assert.equal(eventAllowed(settings,type,true),false);
  }
  const db = { user:{findUnique:async()=>({status:'DEACTIVATED'})} };
  assert.equal(await canCreateNotification(db,'recipient','actor','mention'),false);
  assert.equal(await canCreateNotification({},'same','same','mention'),false);
});
test('quiet hours use explicit timezone, midnight boundaries and DST local time', () => {
  const settings = structuredClone(defaultNotificationSettings);
  settings.quietHours = {enabled:true,start:'22:00',end:'08:00',timeZone:'America/New_York'};
  assert.equal(isQuietTime(settings,new Date('2026-07-01T02:00:00Z')),true);
  assert.equal(isQuietTime(settings,new Date('2026-07-01T12:00:00Z')),false);
  assert.equal(isQuietTime(settings,new Date('2026-01-01T02:30:00Z')),false);
  assert.equal(isQuietTime(settings,new Date('2026-11-01T05:30:00Z')),true);
  assert.equal(isQuietTime(settings,new Date('2026-11-01T06:30:00Z')),true);
  settings.quietHours.enabled = false;
  assert.equal(isQuietTime(settings,new Date('2026-07-01T02:00:00Z')),false);
});
test('settings reject untyped controls and invalid timezones, migrate legacy safely', () => {
  assert.equal(notificationSettingsSchema.safeParse({...defaultNotificationSettings,unexpected:true}).success,false);
  assert.equal(notificationSettingsSchema.safeParse({...defaultNotificationSettings,toggles:{...defaultNotificationSettings.toggles,mentions:'false'}}).success,false);
  assert.equal(notificationSettingsSchema.safeParse({...defaultNotificationSettings,quietHours:{enabled:true,start:'10:00',end:'10:00',timeZone:'UTC'}}).success,false);
  assert.equal(notificationSettingsSchema.safeParse({...defaultNotificationSettings,quietHours:{enabled:true,start:'10:00',end:'11:00',timeZone:'invalid'}}).success,false);
  assert.deepEqual(readNotificationSettings('{bad'),defaultNotificationSettings);
  assert.equal(readNotificationSettings('{"toggles":{"mentions":false,"emailNotifications":true}}').toggles.mentions,false);
  assert.equal('emailNotifications' in readNotificationSettings('{"toggles":{"emailNotifications":true}}').toggles,false);
});
