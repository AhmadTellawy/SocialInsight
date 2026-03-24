import { api } from '../services/api';

const SESSION_ID = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
const DEVICE_TYPE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ? (navigator.userAgent.includes('Android') ? 'ANDROID' : 'IOS') : 'WEB';

let eventQueue: any[] = [];
let flushInterval: any = null;

export const trackEvent = (event: any) => {
    const fullEvent = {
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
        ...event,
        sessionId: SESSION_ID,
        deviceType: DEVICE_TYPE,
        timestamp: new Date().toISOString()
    };

    eventQueue.push(fullEvent);

    if (eventQueue.length >= 10) {
        flushEvents();
    }
};

export const flushEvents = async () => {
    if (eventQueue.length === 0) return;

    const batch = [...eventQueue];
    eventQueue = [];

    await api.trackInteractionsBatch(batch);
};

// Auto-flush every 10 seconds
if (typeof window !== 'undefined') {
    flushInterval = setInterval(flushEvents, 10000);
    window.addEventListener('beforeunload', flushEvents);
}

export const Analytics = {
    track: trackEvent,
    flush: flushEvents,
    getSessionId: () => SESSION_ID,
    getDeviceType: () => DEVICE_TYPE
};
