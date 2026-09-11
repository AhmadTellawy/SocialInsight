import { api } from '../services/api';
import { AnalyticsQueue } from './analyticsQueue';
const SESSION_ID = crypto.randomUUID();
const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
const DEVICE_TYPE = /Android/i.test(agent) ? 'ANDROID' : /iPhone|iPad|iPod/i.test(agent) ? 'IOS' : 'WEB';
let storage: Storage | undefined;
try { if (typeof window !== 'undefined') storage = window.localStorage; } catch {}
const queue = new AnalyticsQueue(storage, (batch, signal, expectedActorId) => api.trackInteractionsBatch(batch, signal, expectedActorId));
const clientEvents = new Set(['POST_VIEW_START', 'POST_VIEW_END', 'SHARE_OR_COPY_LINK', 'PROFILE_VISIT', 'MENTION_SUGGESTION_OPENED', 'MENTION_SELECTED', 'MENTION_PROFILE_OPENED', 'HASHTAG_CLICKED', 'HASHTAG_TOPIC_OPENED', 'HASHTAG_SEARCH_SELECTED']);
export const trackEvent = (event: Record<string, unknown>) => {
  if (!clientEvents.has(String(event.event_type || event.eventType))) return;
  queue.enqueue({ ...event, id: crypto.randomUUID(), sessionId: SESSION_ID, deviceType: DEVICE_TYPE, timestamp: new Date().toISOString() });
  if (queue.pending().length >= 10) void queue.flush();
};
export const flushEvents = () => queue.flush();
if (typeof window !== 'undefined') {
  setInterval(() => void queue.flush(), 10000);
  window.addEventListener('storage', event => {
    if (event.storageArea === storage || event.storageArea === null) queue.handleStorageChange(event.key);
  });
  window.addEventListener('online', () => void queue.flush());
  window.addEventListener('pagehide', () => void queue.flush());
}
export const Analytics = { track: trackEvent, flush: flushEvents, setActor: (id: string | null) => queue.setActor(id), getSessionId: () => SESSION_ID, getDeviceType: () => DEVICE_TYPE };
