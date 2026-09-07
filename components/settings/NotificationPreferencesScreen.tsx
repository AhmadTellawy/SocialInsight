import React, { useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { ArrowLeft, Bell, Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../services/api';
import { accountRequest } from '../../services/accountApi';
import { UnsavedChangesDialog } from './UnsavedChangesDialog';
import { notificationPreferencesDirty, validNotificationPreferences, validQuietHours } from '../../utils/notificationPreferences';
import type { NotificationPreferences } from '../../utils/notificationPreferences';

type Snapshot = { settings: NotificationPreferences; updatedAt: string | null };
const ToggleRow: React.FC<{ label: string; hint?: string; active: boolean; disabled: boolean; onChange: () => void }> = ({ label, hint, active, disabled, onChange }) => (
  <div className="flex items-start gap-4 border-b border-gray-100 px-4 py-4 last:border-0">
    <div className="min-w-0 flex-1"><p className="text-sm font-bold text-gray-900">{label}</p>{hint && <p className="mt-1 text-sm leading-relaxed text-gray-600">{hint}</p>}</div>
    <button type="button" role="switch" aria-label={label} aria-checked={active} disabled={disabled} onClick={onChange} className="flex min-h-11 min-w-12 shrink-0 items-center justify-center rounded-lg focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-50"><span className={`relative h-6 w-11 rounded-full ${active ? 'bg-blue-600' : 'bg-gray-300'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white ${active ? 'right-1' : 'left-1'}`} /></span></button>
  </div>
);

export const NotificationPreferencesScreen: React.FC<{ userId?: string; onBack: () => void }> = ({ userId, onBack }) => {
  const { t, i18n } = useTranslation();
  const [saved, setSaved] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(false);
  const [retry, setRetry] = useState(0);
  const [localLeave, setLocalLeave] = useState(false);
  const [deviceEnabled, setDeviceEnabled] = useState(false);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [deviceError, setDeviceError] = useState(false);
  const [deviceKnown, setDeviceKnown] = useState(false);
  const saveLock = useRef(false);
  const allowLeave = useRef(false);
  const deviceLock = useRef(false);
  const dirty = Boolean(saved && draft && notificationPreferencesDirty(draft, saved.settings));
  const deviceSupported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError(false);
    accountRequest<Snapshot>('/notification-settings').then((payload) => {
      if (!validNotificationPreferences(payload.settings) || !(payload.updatedAt === null || typeof payload.updatedAt === 'string')) throw new Error('INVALID_SETTINGS');
      if (active) { setSaved(payload); setDraft(structuredClone(payload.settings)); }
    }).catch(() => { if (active) setLoadError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, retry]);
  useEffect(() => {
    let active = true;
    setDeviceKnown(false);
    void (async () => {
      try {
        const subscription = deviceSupported ? await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription() : null;
        if (active) setDeviceEnabled(Boolean(subscription) && Notification.permission === 'granted');
      } catch { if (active) setDeviceError(true); }
      finally { if (active) setDeviceKnown(true); }
    })();
    return () => { active = false; };
  }, [deviceSupported, userId]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (allowLeave.current) { allowLeave.current = false; return false; }
    return dirty && currentLocation.pathname !== nextLocation.pathname;
  });
  useEffect(() => {
    if (!dirty) return;
    const listener = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [dirty]);
  const change = (next: NotificationPreferences) => { setDraft(next); setNotice(false); setSaveError(false); };
  const save = async () => {
    if (!draft || !saved || !dirty || !validQuietHours(draft.quietHours) || saveLock.current) return;
    saveLock.current = true; setSaving(true); setSaveError(false); setNotice(false);
    try {
      const payload = await accountRequest<Snapshot>('/notification-settings', 'PUT', { settings: draft, expectedUpdatedAt: saved.updatedAt });
      if (!validNotificationPreferences(payload.settings) || typeof payload.updatedAt !== 'string') throw new Error('INVALID_SETTINGS');
      setSaved(payload); setDraft(structuredClone(payload.settings)); setNotice(true);
    } catch { setSaveError(true); }
    finally { setSaving(false); saveLock.current = false; }
  };
  const toggleDevice = async (reconnect = false) => {
    if (!deviceSupported || deviceLock.current) return;
    deviceLock.current = true; setDeviceBusy(true); setDeviceError(false);
    try {
      if (deviceEnabled && !reconnect) {
        const subscription = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
        if (subscription) { await api.unsubscribeFromPush(subscription.endpoint); if (!await subscription.unsubscribe()) throw new Error('UNSUBSCRIBE_FAILED'); }
        setDeviceEnabled(false);
      } else {
        if (!await api.setupPushNotifications()) throw new Error('SUBSCRIBE_FAILED');
        setDeviceEnabled(true);
      }
    } catch { setDeviceError(true); }
    finally { setDeviceBusy(false); deviceLock.current = false; }
  };
  const closeDiscard = () => { setLocalLeave(false); if (blocker.state === 'blocked') blocker.reset(); };
  const discard = () => {
    if (saving) return;
    setDraft(saved ? structuredClone(saved.settings) : null); setLocalLeave(false);
    if (blocker.state === 'blocked') blocker.proceed(); else { allowLeave.current = true; onBack(); }
  };
  const disabled = loading || saving || loadError;
  const quietValid = !draft || validQuietHours(draft.quietHours);
  return (
    <section dir={i18n.dir()} className="flex h-full min-h-0 flex-col bg-gray-50">
      <header className="flex min-h-16 items-center gap-2 border-b border-gray-100 bg-white px-3">
        <button type="button" onClick={() => dirty ? setLocalLeave(true) : onBack()} disabled={saving} aria-label={t('common.back', { defaultValue: 'Back' })} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-blue-600"><ArrowLeft size={23} className="rtl:rotate-180" /></button>
        <h1 className="min-w-0 flex-1 text-base font-bold text-gray-900">{t('settingsV2.notifications.title')}</h1>
        <button type="button" onClick={() => void save()} disabled={disabled || !dirty || !quietValid} className="flex min-h-11 min-w-20 items-center justify-center gap-2 rounded-full bg-blue-600 px-4 text-sm font-bold text-white disabled:bg-gray-100 disabled:text-gray-500 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">{saving && <Loader2 size={16} className="animate-spin" />}{t(saving ? 'profile.edit.saving' : 'profile.edit.save')}</button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-24 pt-5"><div className="mx-auto max-w-lg space-y-5">
        <p className="text-sm leading-relaxed text-gray-600">{t('settingsV2.notifications.intro')}</p>
        {loading && <p role="status" className="flex items-center gap-2 text-sm text-gray-600"><Loader2 size={18} className="animate-spin" />{t('settingsV2.loading')}</p>}
        {loadError && <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800"><p>{t('settingsV2.loadFailed')}</p><button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-2 flex min-h-11 items-center gap-2 font-bold"><RefreshCw size={18} />{t('common.retry', { defaultValue: 'Retry' })}</button></div>}
        {saveError && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{t('settingsV2.notifications.saveFailed')}</p>}
        {notice && <p role="status" className="rounded-xl bg-green-50 p-3 text-sm font-bold text-green-800">{t('settingsV2.saved')}</p>}
        {draft && <>
          <fieldset disabled={disabled} className="overflow-hidden rounded-2xl border border-gray-200 bg-white"><legend className="sr-only">{t('settingsV2.notifications.events')}</legend>
            {(['likes', 'comments', 'shares'] as const).map((field) => <div key={field} className="border-b border-gray-100 p-4 last:border-0">
              <h2 className="text-sm font-bold text-gray-900">{t(`settingsV2.notifications.${field}`)}</h2><p className="mb-3 mt-1 text-sm leading-relaxed text-gray-600">{t(`settingsV2.notifications.${field}Hint`)}</p>
              <div role="radiogroup" aria-label={t(`settingsV2.notifications.${field}`)} className="flex flex-wrap gap-2">{(['everyone', 'following', 'off'] as const).map((value) => <button key={value} type="button" role="radio" aria-checked={draft.myPosts[field] === value} onClick={() => change({ ...draft, myPosts: { ...draft.myPosts, [field]: value } })} className={`min-h-11 flex-1 rounded-xl border px-3 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-blue-600 ${draft.myPosts[field] === value ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-gray-200 text-gray-700'}`}>{t(`settingsV2.notifications.options.${value}`)}</button>)}</div>
            </div>)}
            {(['newFollowers', 'invitations', 'commentInteractions', 'mentions', 'peopleTags'] as const).map((field) => <ToggleRow key={field} label={t(`settingsV2.notifications.${field}`)} hint={t(`settingsV2.notifications.${field}Hint`)} active={draft.toggles[field]} disabled={disabled} onChange={() => change({ ...draft, toggles: { ...draft.toggles, [field]: !draft.toggles[field] } })} />)}
          </fieldset>
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <ToggleRow label={t('settingsV2.notifications.push')} hint={t('settingsV2.notifications.pushHint')} active={draft.toggles.pushNotifications} disabled={disabled} onChange={() => change({ ...draft, toggles: { ...draft.toggles, pushNotifications: !draft.toggles.pushNotifications } })} />
            <div className="space-y-3 border-t border-gray-100 p-4"><h2 className="text-sm font-bold">{t('settingsV2.notifications.device')}</h2><p className="text-sm leading-relaxed text-gray-600">{t(deviceSupported ? deviceEnabled ? 'settingsV2.notifications.deviceOn' : 'settingsV2.notifications.deviceOff' : 'settingsV2.notifications.unsupported')}</p>{deviceError && <p role="alert" className="text-sm text-red-700">{t('settingsV2.notifications.deviceFailed')}</p>}
              <button type="button" onClick={() => void toggleDevice()} disabled={!deviceSupported || !deviceKnown || deviceBusy} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-blue-200 px-3 text-sm font-bold text-blue-800 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-blue-600">{deviceBusy ? <Loader2 size={18} className="animate-spin" /> : <Bell size={18} />}{t(deviceEnabled ? 'settingsV2.notifications.disableDevice' : 'settingsV2.notifications.enableDevice')}</button>
              {deviceEnabled && <button type="button" onClick={() => void toggleDevice(true)} disabled={deviceBusy} className="min-h-11 w-full text-sm font-bold text-blue-700 underline underline-offset-4 disabled:opacity-50">{t('settingsV2.notifications.reconnect')}</button>}
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <ToggleRow label={t('settingsV2.notifications.quiet')} hint={t('settingsV2.notifications.quietHint')} active={draft.quietHours.enabled} disabled={disabled} onChange={() => change({ ...draft, quietHours: { ...draft.quietHours, enabled: !draft.quietHours.enabled } })} />
            <fieldset disabled={disabled || !draft.quietHours.enabled} className="space-y-4 border-t border-gray-100 p-4 disabled:opacity-60">
              <div className="grid grid-cols-2 gap-3">{(['start', 'end'] as const).map((field) => <label key={field} className="block text-sm font-semibold text-gray-700">{t(`settingsV2.notifications.${field}`)}<input type="time" value={draft.quietHours[field]} onChange={(event) => change({ ...draft, quietHours: { ...draft.quietHours, [field]: event.target.value } })} className="mt-2 min-h-12 w-full rounded-xl border border-gray-300 bg-white px-3 text-gray-900" dir="ltr" /></label>)}</div>
              <label className="block text-sm font-semibold text-gray-700">{t('settingsV2.notifications.timeZone')}<input type="text" value={draft.quietHours.timeZone} onChange={(event) => change({ ...draft, quietHours: { ...draft.quietHours, timeZone: event.target.value } })} dir="ltr" placeholder="Asia/Amman" className="mt-2 min-h-12 w-full rounded-xl border border-gray-300 bg-white px-3 text-gray-900" /></label>
              <button type="button" onClick={() => change({ ...draft, quietHours: { ...draft.quietHours, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } })} className="min-h-11 text-sm font-bold text-blue-700 underline underline-offset-4">{t('settingsV2.notifications.useDeviceZone')}</button>
              {!quietValid && <p role="alert" className="text-sm text-red-700">{t('settingsV2.notifications.quietInvalid')}</p>}
            </fieldset>
          </div>
        </>}
      </div></div>
      <UnsavedChangesDialog open={!saving && (localLeave || blocker.state === 'blocked')} onContinue={closeDiscard} onDiscard={discard} />
    </section>
  );
};
