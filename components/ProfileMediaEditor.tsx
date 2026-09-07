import React, { useEffect, useRef, useState } from 'react';
import { Camera, Crop, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useBlocker } from 'react-router-dom';
import type { MediaCropSelection, UserProfile } from '../types';
import { api } from '../services/api';
import { mediaApi, MediaUploadError } from '../services/mediaApi';
import { validateAndNormalizeImageFile, PROFILE_COVER_MAX_INPUT_BYTES, DEFAULT_MEDIA_MAX_INPUT_BYTES } from '../utils/mediaFileValidation';
import { BottomSheet } from './BottomSheet';
import { MediaCropEditor } from './media/MediaCropEditor';

type Source = { file: File; url: string };

// This editor creates a new owned asset, then attaches it with optimistic concurrency.
// It never mutates the currently published image while the user is still cropping.
export const ProfileMediaEditor: React.FC<{
  kind: 'avatar' | 'cover';
  profile: UserProfile;
  onSaved: (profile: UserProfile) => void;
  onClose: () => void;
}> = ({ kind, profile, onSaved, onClose }) => {
  const { t, i18n } = useTranslation();
  const purpose = kind === 'avatar' ? 'PROFILE_AVATAR' : 'PROFILE_COVER';
  const ratio = kind === 'avatar' ? 1 : 3;
  const input = useRef<HTMLInputElement>(null);
  const [loadedProfile, setLoadedProfile] = useState(profile);
  const [source, setSource] = useState<Source | null>(null);
  const sourceRef = useRef<Source | null>(null);
  const [cropping, setCropping] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [pendingCrop, setPendingCrop] = useState<MediaCropSelection | null>(null);
  const saveLatch = useRef(false);
  const temporaryAsset = useRef<string | null>(null);
  const active = useRef(true);
  const assetId = kind === 'avatar' ? loadedProfile.avatarMediaId : loadedProfile.coverMediaId;
  const hasLegacyAvatar = kind === 'avatar' && !assetId && loadedProfile.hasLegacyAvatar === true;
  const hasCurrentImage = Boolean(assetId || hasLegacyAvatar || (kind === 'avatar' && loadedProfile.avatar));
  const title = t(`mediaEdit.${kind}`, { defaultValue: kind === 'avatar' ? 'Edit profile photo' : 'Edit cover photo' });
  const blocker = useBlocker(() => saveLatch.current);
  useEffect(() => { if (blocker.state === 'blocked') blocker.reset(); }, [blocker]);
  useEffect(() => {
    if (!saving) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [saving]);

  const prepare = async (file: File): Promise<Source> => {
    const validated = await validateAndNormalizeImageFile(file, { maxInputBytes: kind === 'cover' ? PROFILE_COVER_MAX_INPUT_BYTES : DEFAULT_MEDIA_MAX_INPUT_BYTES });
    return { file: validated.file, url: URL.createObjectURL(validated.file) };
  };
  const publishSource = (next: Source) => {
    if (!active.current) { URL.revokeObjectURL(next.url); return; }
    if (sourceRef.current) URL.revokeObjectURL(sourceRef.current.url);
    sourceRef.current = next;
    setSource(next);
    setCropping(true);
    setPendingCrop(null);
    setError(null);
  };

  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const fresh = { ...profile, ...await api.getMe({ signal: controller.signal, timeoutMs: 15_000 }) } as UserProfile;
        if (controller.signal.aborted) return;
        setLoadedProfile(fresh);
        const currentId = kind === 'avatar' ? fresh.avatarMediaId : fresh.coverMediaId;
        if (!currentId) return;
        // get() is authenticated; its presentation supplies a limited image URL.
        const presentation = await mediaApi.get(currentId, true);
        if (!presentation.src || controller.signal.aborted) return;
        const response = await fetch(presentation.src, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!response.ok) throw new Error('IMAGE_READ_FAILED');
        const blob = await response.blob();
        const next = await prepare(new File([blob], `${kind}.image`, { type: blob.type }));
        if (controller.signal.aborted) { URL.revokeObjectURL(next.url); return; }
        publishSource(next);
      } catch {
        if (!controller.signal.aborted) setError(t('mediaEdit.loadFailed', { defaultValue: 'The current image could not be opened. Retry or choose another image.' }));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [profile.id, kind, retryKey]);

  useEffect(() => () => {
    active.current = false;
    if (sourceRef.current) URL.revokeObjectURL(sourceRef.current.url);
    if (temporaryAsset.current) void mediaApi.cancel(temporaryAsset.current).catch(() => undefined);
  }, []);

  const saveCrop = async (crop: MediaCropSelection) => {
    if (!source || !loadedProfile.id || !loadedProfile.updatedAt || saveLatch.current) return;
    saveLatch.current = true;
    setCropping(false);
    setPendingCrop(crop);
    setSaving(true);
    setError(null);
    setProgress(0);
    try {
      if (temporaryAsset.current) {
        await mediaApi.cancel(temporaryAsset.current).catch(() => undefined);
        temporaryAsset.current = null;
      }
      const uploaded = await mediaApi.upload(source.file, purpose, crop, (value) => { if (active.current) setProgress(value); });
      temporaryAsset.current = uploaded.id;
      const updated = await api.updateUser(loadedProfile.id, { [`${kind}MediaId`]: uploaded.id, expectedUpdatedAt: loadedProfile.updatedAt });
      temporaryAsset.current = null;
      onSaved({ ...loadedProfile, ...updated });
      onClose();
    } catch (error) {
      if (error instanceof MediaUploadError && error.assetId) temporaryAsset.current = error.assetId;
      if (temporaryAsset.current) {
        try {
          const reconciled = await api.getMe({ timeoutMs: 15_000 });
          if (reconciled[`${kind}MediaId`] === temporaryAsset.current) {
            temporaryAsset.current = null;
            onSaved({ ...loadedProfile, ...reconciled });
            onClose();
            return;
          }
        } catch { /* Keep the uncertain draft for an explicit retry. */ }
      }
      setError(t('mediaEdit.saveFailed', { defaultValue: 'The photo save could not be confirmed. Reopen the editor to check the current photo, or retry your change.' }));
    } finally {
      saveLatch.current = false;
      if (active.current) setSaving(false);
    }
  };

  const remove = async () => {
    if (!loadedProfile.id || !loadedProfile.updatedAt || saveLatch.current) return;
    saveLatch.current = true;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateUser(loadedProfile.id, { [`${kind}MediaId`]: null, expectedUpdatedAt: loadedProfile.updatedAt });
      onSaved({ ...loadedProfile, ...updated });
      onClose();
    } catch {
      setError(t('mediaEdit.removeFailed', { defaultValue: 'The photo could not be removed. Please try again.' }));
    } finally {
      saveLatch.current = false;
      if (active.current) setSaving(false);
    }
  };
  const chooseFile = async (file?: File) => {
    if (!file || saveLatch.current) return;
    setLoading(true);
    try {
      publishSource(await prepare(file));
    } catch {
      setError(t('mediaEdit.invalidImage', { defaultValue: 'Choose a valid JPEG, PNG or WebP image within the image size limit.' }));
    } finally { setLoading(false); }
  };

  return <>
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label={t('mediaEdit.choose', { defaultValue: 'Choose image' })} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void chooseFile(file); }} />
    {cropping && source && <MediaCropEditor imageSrc={source.url} purpose={purpose} lockedAspectRatio={ratio} onApply={(crop) => void saveCrop(crop)} onCancel={() => setCropping(false)} />}
    {!cropping && <BottomSheet isOpen onClose={() => { if (!saving && !loading) onClose(); }} title={title}>
      <div className="space-y-3 pb-4" dir={i18n.dir()}>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm leading-relaxed text-red-800">{error}</p>}
        {(loading || saving) && <p role="status" className="flex min-h-16 items-center justify-center gap-2 text-sm font-semibold text-gray-700"><Loader2 className="animate-spin" size={20} />{loading ? t('mediaEdit.loading', { defaultValue: 'Opening photo editor...' }) : t('mediaEdit.saving', { progress, defaultValue: `Saving photo, ${progress}%` })}</p>}
        {!loading && !saving && <>
          {hasLegacyAvatar && !source && <p role="status" className="rounded-xl bg-blue-50 p-3 text-sm leading-relaxed text-blue-950">{t('mediaEdit.legacyUnavailable', { defaultValue: 'Your existing photo cannot be opened in the editor. You can replace it or remove it.' })}</p>}
          {confirmRemove ? <>
            <p className="text-sm leading-relaxed text-gray-700">{t('mediaEdit.removeConfirm', { defaultValue: 'Remove this photo? Your profile will use the default image.' })}</p>
            <button type="button" onClick={() => void remove()} className="min-h-12 w-full rounded-xl bg-red-600 px-4 font-bold text-white">{t('mediaEdit.remove', { defaultValue: 'Remove photo' })}</button>
            <button type="button" onClick={() => setConfirmRemove(false)} className="min-h-12 w-full rounded-xl border border-gray-200 px-4 font-bold">{t('Cancel', { defaultValue: 'Cancel' })}</button>
          </> : <>
            {pendingCrop && <button type="button" onClick={() => void saveCrop(pendingCrop)} className="flex min-h-12 w-full items-center gap-3 rounded-xl bg-blue-600 px-4 font-bold text-white"><RefreshCw size={20} />{t('mediaEdit.retrySave', { defaultValue: 'Retry saving photo' })}</button>}
            {source && <button type="button" onClick={() => setCropping(true)} className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-gray-200 px-4 text-sm font-bold text-gray-800"><Crop size={20} />{t('mediaEdit.crop', { defaultValue: 'Adjust crop' })}</button>}
            <button type="button" onClick={() => input.current?.click()} className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-gray-200 px-4 text-sm font-bold text-gray-800"><Camera size={20} />{hasLegacyAvatar ? t('mediaEdit.replace', { defaultValue: 'Replace photo' }) : t('mediaEdit.choose', { defaultValue: 'Choose image' })}</button>
            {hasCurrentImage && <button type="button" onClick={() => setConfirmRemove(true)} className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-gray-200 px-4 text-sm font-bold text-red-700"><Trash2 size={20} />{t('mediaEdit.remove', { defaultValue: 'Remove photo' })}</button>}
            {error && !source && <button type="button" onClick={() => setRetryKey((value) => value + 1)} className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-gray-200 px-4 text-sm font-bold"><RefreshCw size={20} />{t('common.retry', { defaultValue: 'Retry' })}</button>}
            <button type="button" onClick={onClose} className="min-h-12 w-full rounded-xl bg-gray-100 px-4 text-sm font-bold text-gray-700">{t('Cancel', { defaultValue: 'Cancel' })}</button>
          </>}
        </>}
      </div>
    </BottomSheet>}
  </>;
};
