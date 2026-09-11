import React, { useEffect, useState } from 'react';
import { ArrowLeft, Loader2, Lock, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { accountApi } from '../../services/accountApi';
import type { UserProfile } from '../../types';

// Render the visitor DTO only. Never fall back to the owner's private profile or
// resolve missing media through the authenticated media component.
export const PublicProfilePreviewScreen: React.FC<{ userId: string; onBack: () => void }> = ({ userId, onBack }) => {
  const { t, i18n } = useTranslation();
  const [profile, setProfile] = useState<Partial<UserProfile> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(false);
    accountApi.getPublicProfile(userId).then((value) => { if (active) setProfile(value); }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, retry]);
  const safeUrl = (value?: string) => {
    if (!value) return undefined;
    try { const url = new URL(value, window.location.origin); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
  };
  return <section className="flex h-full min-h-0 flex-col bg-gray-50" dir={i18n.dir()}>
    <header className="flex min-h-16 items-center gap-2 border-b border-gray-100 bg-white px-3"><button type="button" onClick={onBack} aria-label={t('common.back', { defaultValue: 'Back' })} className="flex h-11 w-11 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-blue-600"><ArrowLeft size={23} className="rtl:rotate-180" /></button><h1 className="text-base font-bold">{t('settingsV2.viewAs')}</h1></header>
    <div className="min-h-0 flex-1 overflow-y-auto pb-24">
      <p className="m-4 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm leading-relaxed text-blue-950">{t('settingsV2.previewHint', { defaultValue: 'This preview shows your profile details as a visitor who is not signed in. Followers and group members may have different access to your content.' })}</p>
      {loading ? <p role="status" className="flex items-center justify-center gap-2 p-6 text-sm"><Loader2 size={18} className="animate-spin" />{t('settingsV2.loading')}</p> : error ? <div role="alert" className="m-4 rounded-xl bg-red-50 p-4 text-sm text-red-800"><p>{t('settingsV2.loadFailed')}</p><button type="button" onClick={() => setRetry((value) => value + 1)} className="flex min-h-11 items-center gap-2 font-bold"><RefreshCw size={18} />{t('common.retry', { defaultValue: 'Retry' })}</button></div> : profile && <div className="mx-auto max-w-lg overflow-hidden border-y border-gray-200 bg-white pb-8">
        {safeUrl(profile.coverMedia?.src) ? <img src={safeUrl(profile.coverMedia?.src)} alt="" className="aspect-[3/1] w-full object-cover" /> : <div className="aspect-[3/1] bg-gray-100" />}
        <div className="relative -mt-10 flex flex-col items-center px-5 text-center">
          {safeUrl(profile.avatarMedia?.src || profile.avatar) ? <img src={safeUrl(profile.avatarMedia?.src || profile.avatar)} alt="" className="mb-4 h-24 w-24 rounded-2xl border-4 border-white object-cover" /> : <div className="mb-4 flex h-24 w-24 items-center justify-center rounded-2xl border-4 border-white bg-gray-100 text-2xl font-bold text-gray-500">{profile.name?.charAt(0)}</div>}
          <h2 className="text-xl font-bold text-gray-900">{profile.name}</h2><p dir="ltr" className="mt-1 text-sm text-blue-700">@{profile.handle}</p>
          {profile.bio && <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-700">{profile.bio}</p>}
          {profile.location && <p className="mt-3 text-sm text-gray-600">{profile.location}</p>}
          {safeUrl(profile.website) && <a href={safeUrl(profile.website)} target="_blank" rel="noopener noreferrer" className="mt-3 break-all text-sm text-blue-700 underline" dir="ltr">{profile.website}</a>}
          {profile.profileLinks?.map((link) => safeUrl(link.url) && <a key={link.id} href={safeUrl(link.url)} target="_blank" rel="noopener noreferrer" className="mt-3 min-h-11 text-sm font-bold text-blue-700 underline">{link.title}</a>)}
          {profile.isPrivate && <p className="mt-6 flex items-center gap-2 rounded-xl bg-gray-50 p-4 text-sm text-gray-700"><Lock size={18} />{t('settingsV2.privacy.privateAccount')}</p>}
        </div>
      </div>}
    </div>
  </section>;
};
