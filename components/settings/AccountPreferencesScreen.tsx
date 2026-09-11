import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { UserProfile } from '../../types';
import { api } from '../../services/api';
import { accountApi } from '../../services/accountApi';
import { BottomSheet } from '../BottomSheet';

type PreferencesPage = 'account-privacy' | 'group-privacy' | 'language' | 'theme';
const LANGUAGES = [{ code: 'ar', name: 'العربية' }, { code: 'en', name: 'English' }];

export const AccountPreferencesScreen: React.FC<{
  page: PreferencesPage;
  userProfile: UserProfile;
  onUpdateProfile: (profile: UserProfile) => void;
  onBack: () => void;
}> = ({ page, userProfile, onUpdateProfile, onBack }) => {
  const { t, i18n } = useTranslation();
  const [profile, setProfile] = useState(userProfile);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [saved, setSaved] = useState(false);
  const [retry, setRetry] = useState(0);
  const [confirmPublic, setConfirmPublic] = useState(false);
  const lock = useRef(false);
  const update = useRef(onUpdateProfile);
  useEffect(() => { update.current = onUpdateProfile; }, [onUpdateProfile]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(false);
    api.getMe({ signal: controller.signal, timeoutMs: 15_000 }).then((value) => {
      if (controller.signal.aborted) return;
      const next = { ...userProfile, ...value } as UserProfile;
      setProfile(next);
      update.current(next);
      setNeedsReload(false);
      setSaveError(false);
      setSaved(false);
    }).catch(() => { if (!controller.signal.aborted) setLoadError(true); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [userProfile.id, retry]);
  const save = async (changes: Partial<UserProfile>) => {
    if (lock.current || loading || loadError || needsReload) return;
    lock.current = true;
    setBusy(true);
    setSaveError(false);
    setSaved(false);
    try {
      const updated = 'isPrivate' in changes || 'peopleTagPermission' in changes
        ? await api.updateUser(profile.id, { ...changes, expectedUpdatedAt: profile.updatedAt })
        : await accountApi.updateSettings(changes, profile.updatedAt);
      const next = { ...profile, ...updated } as UserProfile;
      setProfile(next);
      update.current(next);
      if (changes.language) await i18n.changeLanguage(changes.language);
      setSaved(true);
      setConfirmPublic(false);
    } catch {
      setSaveError(true);
      setConfirmPublic(false);
      // A failed response can follow a committed save. Read the authoritative
      // state before allowing another versioned write or claiming a rollback.
      setNeedsReload(true);
      try {
        const next = { ...profile, ...await api.getMe({ timeoutMs: 15_000 }) } as UserProfile;
        setProfile(next);
        update.current(next);
        setNeedsReload(false);
        const cancellationConfirmed = !(changes.isPrivate === true && profile.mediaPrivacyTarget === false) || next.mediaPrivacyTarget !== false;
        const confirmed = cancellationConfirmed && Object.entries(changes).every(([key, value]) => next[key as keyof UserProfile] === value);
        if (confirmed) {
          if (changes.language) await i18n.changeLanguage(changes.language);
          setSaved(true);
          setSaveError(false);
        }
      } catch { /* Explicit reload remains available while the result is uncertain. */ }
    }
    finally { lock.current = false; setBusy(false); }
  };
  const disabled = loading || loadError || busy || needsReload;
  const privacyPending = typeof profile.mediaPrivacyTarget === 'boolean';
  const titleKey = page === 'account-privacy' ? 'privacy.title' : page === 'group-privacy' ? 'privacy.groups' : page;
  const radio = (value: string, label: string, selected: boolean, onClick: () => void) => <button key={value} type="button" role="radio" aria-checked={selected} disabled={disabled} onClick={onClick} className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-start text-sm font-bold focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-60 ${selected ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-gray-200 bg-white text-gray-800'}`}><span>{label}</span>{selected && <Check size={20} />}</button>;
  const toggle = (field: 'searchVisibility' | 'allowSharing' | 'groupInvites', fallback = true) => {
    const enabled = (profile as UserProfile & Record<typeof field, boolean>)[field] ?? fallback;
    return <div key={field} className="flex items-start gap-4 border-b border-gray-100 py-4 last:border-0"><div className="flex-1"><p className="text-sm font-bold text-gray-900">{t(`settingsV2.privacy.${field}`)}</p><p className="mt-1 text-sm leading-relaxed text-gray-600">{t(`settingsV2.privacy.${field}Hint`)}</p></div><button type="button" role="switch" aria-checked={enabled} aria-label={t(`settingsV2.privacy.${field}`)} disabled={disabled} onClick={() => void save({ [field]: !enabled } as Partial<UserProfile>)} className="flex min-h-11 min-w-12 shrink-0 items-center justify-center rounded-lg focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-50"><span className={`relative h-6 w-11 rounded-full ${enabled ? 'bg-blue-600' : 'bg-gray-300'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white ${enabled ? 'right-1' : 'left-1'}`} /></span></button></div>;
  };
  return <section className="flex h-full min-h-0 flex-col bg-gray-50" dir={i18n.dir()}>
    <header className="flex min-h-16 items-center gap-2 border-b border-gray-100 bg-white px-3"><button type="button" onClick={onBack} disabled={busy} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-700 focus-visible:ring-2 focus-visible:ring-blue-600" aria-label={t('common.back', { defaultValue: 'Back' })}><ArrowLeft size={23} className="rtl:rotate-180" /></button><h1 className="text-base font-bold">{t(`settingsV2.${titleKey}`)}</h1></header>
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-24 pt-5"><div className="mx-auto max-w-lg space-y-4">
      {(loading || busy) && <p role="status" className="flex items-center gap-2 text-sm text-gray-600"><Loader2 className="animate-spin" size={18} />{t(loading ? 'settingsV2.loading' : 'profile.edit.saving')}</p>}
      {loadError && <div role="alert" className="rounded-2xl bg-red-50 p-4 text-sm text-red-800"><p>{t('settingsV2.loadFailed')}</p><button type="button" onClick={() => setRetry((value) => value + 1)} className="mt-2 flex min-h-11 items-center gap-2 font-bold"><RefreshCw size={17} />{t('common.retry', { defaultValue: 'Retry' })}</button></div>}
      {saveError && <div role="alert" className="rounded-2xl bg-red-50 p-4 text-sm text-red-800"><p>{t('settingsV2.saveFailed', { defaultValue: 'The save could not be confirmed. Reload settings to check the current value, then try again.' })}</p><button type="button" disabled={busy || loading} onClick={() => setRetry((value) => value + 1)} className="mt-2 flex min-h-11 items-center gap-2 font-bold disabled:opacity-50"><RefreshCw size={17} />{t('settingsV2.reload', { defaultValue: 'Reload settings' })}</button></div>}
      {saved && <p role="status" className="rounded-2xl bg-green-50 p-3 text-sm font-semibold text-green-800">{t('settingsV2.saved')}</p>}
      {page === 'account-privacy' && <>
        {privacyPending && <div role="status" className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-relaxed text-blue-950"><p>{t(profile.mediaPrivacyTarget ? 'settingsV2.privacy.pendingPrivate' : 'settingsV2.privacy.pendingPublic')}</p><div className="mt-3 flex flex-wrap gap-3">{profile.mediaPrivacyTarget === false && <button type="button" disabled={disabled} onClick={() => void save({ isPrivate: true })} className="min-h-11 rounded-xl border border-blue-300 px-4 font-bold disabled:opacity-50">{t('settingsV2.privacy.cancelPublic')}</button>}<button type="button" disabled={disabled} onClick={() => setRetry(value => value + 1)} className="min-h-11 rounded-xl px-4 font-bold underline disabled:opacity-50">{t('settingsV2.privacy.refreshStatus')}</button></div></div>}
        <div className="rounded-2xl border border-gray-200 bg-white p-4"><div className="flex items-center gap-3"><h2 className="flex-1 text-sm font-bold">{t('settingsV2.privacy.privateAccount')}</h2><button type="button" role="switch" aria-checked={Boolean(profile.isPrivate)} aria-label={t('settingsV2.privacy.privateAccount')} disabled={disabled || privacyPending} onClick={() => profile.isPrivate ? setConfirmPublic(true) : void save({ isPrivate: true })} className="flex h-11 w-12 items-center justify-center rounded-lg focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-50"><span className={`relative h-6 w-11 rounded-full ${profile.isPrivate ? 'bg-blue-600' : 'bg-gray-300'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white ${profile.isPrivate ? 'right-1' : 'left-1'}`} /></span></button></div><p className="mt-3 text-sm leading-relaxed text-gray-600">{t('settingsV2.privacy.privateHint')}</p></div>
        <div className="rounded-2xl border border-gray-200 bg-white px-4">{toggle('searchVisibility')}{toggle('allowSharing')}{toggle('groupInvites')}</div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4"><h2 className="mb-2 text-sm font-bold">{t('settingsV2.privacy.tags')}</h2><p className="mb-4 text-sm leading-relaxed text-gray-600">{t('settingsV2.privacy.tagsHint')}</p><div role="radiogroup" aria-label={t('settingsV2.privacy.tags')} className="space-y-2">{(['EVERYONE', 'FOLLOWING', 'NO_ONE'] as const).map((value) => radio(value, t(`settingsV2.privacy.tagsOptions.${value}`), (profile.peopleTagPermission || 'EVERYONE') === value, () => { if ((profile.peopleTagPermission || 'EVERYONE') !== value) void save({ peopleTagPermission: value }); }))}</div></div>
      </>}
      {page === 'group-privacy' && <><p className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm leading-relaxed text-blue-950">{t('settingsV2.privacy.groupsHint')}</p><div role="radiogroup" aria-label={t('settingsV2.privacy.groups')} className="space-y-3">{(['Public', 'Followers', 'Off'] as const).map((value) => radio(value, t(`settingsV2.privacy.groupOptions.${value}`), (profile.groupPrivacy || 'Public') === value, () => { if ((profile.groupPrivacy || 'Public') !== value) void save({ groupPrivacy: value }); }))}</div></>}
      {page === 'language' && <><p className="text-sm leading-relaxed text-gray-600">{t('settingsV2.languageHint')}</p><div role="radiogroup" aria-label={t('settingsV2.language')} className="space-y-3">{LANGUAGES.map(({ code, name }) => radio(code, name, profile.language === code, () => { if (profile.language !== code) void save({ language: code }); }))}</div></>}
      {page === 'theme' && <><p className="text-sm leading-relaxed text-gray-600">{t('settingsV2.themeHint')}</p><div role="radiogroup" aria-label={t('settingsV2.theme')} className="space-y-3">{(['system', 'light', 'dark'] as const).map((value) => radio(value, t(`settingsV2.themes.${value}`), ((profile as any).theme || 'system') === value, () => { if (((profile as any).theme || 'system') !== value) void save({ theme: value } as Partial<UserProfile>); }))}</div></>}
    </div></div>
    <BottomSheet isOpen={confirmPublic} onClose={() => { if (!busy) setConfirmPublic(false); }} title={t('settingsV2.privacy.makePublic')}><div dir={i18n.dir()} className="space-y-4 pb-4"><p className="text-sm leading-relaxed text-gray-700">{t('settingsV2.privacy.makePublicHint')}</p><button type="button" disabled={busy} onClick={() => void save({ isPrivate: false })} className="min-h-12 w-full rounded-xl bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-50">{t('settingsV2.privacy.makePublic')}</button><button type="button" disabled={busy} onClick={() => setConfirmPublic(false)} className="min-h-12 w-full rounded-xl border border-gray-200 px-4 text-sm font-bold">{t('Cancel', { defaultValue: 'Cancel' })}</button></div></BottomSheet>
  </section>;
};
