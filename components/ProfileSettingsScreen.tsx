
import React, { useState } from 'react';
import { useBlocker, useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft, User, Mail, Globe, Lock, Eye, Search, Activity,
  Share2, Users, Bell, Palette, Shield, LifeBuoy, LogOut,
  Trash2, ChevronRight, Check, AlertTriangle, Smartphone,
  Languages, Type, MessageSquare, UserPlus, Camera, Edit3, Save,
  X, Briefcase, GraduationCap, Heart, UserCircle, MapPin, Hash,
  CalendarDays, Link2, Image as ImageIcon, Loader2, Info, RefreshCw
} from 'lucide-react';
import { BottomSheet } from './BottomSheet';
import { MediaDraft, UserProfile } from '../types';
import { NotificationSettingsScreen } from './NotificationSettingsScreen';
import { api } from '../services/api';
import { useProtectedAccountAction, securityErrorText } from './ReauthenticationDialog';
import { useTranslation } from 'react-i18next';
import { MediaPicker, MediaPickerControls, MediaPickerHandle } from './media/MediaPicker';
import { createPersistedMediaDraftFromId, mediaDraftsAreReady, mediaDraftsHaveErrors, readyMediaAssetIds, cancelTemporaryMediaDrafts } from '../utils/mediaDrafts';
import { RichMentionInput } from './RichMentionInput';
import { MediaImage } from './media/MediaImage';
import { ProfileLinksManager } from './ProfileLinksManager';
import { PROFILE_MAX_AGE, PROFILE_MIN_AGE, calculateAgeGroupFromDateOnly, serializeDateOnly, todayAsDateOnly, validateDateOfBirth } from '../utils/profileValidation';
import { OAuthFeedback } from '../utils/authUi';
import { AccountAccessScreen } from './AccountAccessScreen';
import { DemographicSettingsScreen } from './settings/DemographicSettingsScreen';
import { AccountPreferencesScreen } from './settings/AccountPreferencesScreen';
import { SettingsHelpScreen } from './settings/SettingsHelpScreen';
import { PublicProfilePreviewScreen } from './settings/PublicProfilePreviewScreen';
import { AccountSecurityScreen } from './AccountSecurityScreen';
import { AccountDataScreen } from './AccountDataScreen';
import { BlockedAccountsScreen } from './BlockedAccountsScreen';
import { profileEditHasChanges, profileMediaDraftHasChanged } from '../utils/profileEditState';

interface ProfileSettingsScreenProps {
  userProfile: UserProfile;
  onUpdateProfile: (profile: UserProfile) => void;
  onBack: () => void;
  onLogout: () => void | Promise<void>;
  onSessionEnded: () => void;
  oauthFeedback?: OAuthFeedback | null;
}

type SubPage = 'main' | 'edit-profile' | 'links' | 'username' | 'email-phone' | 'account-access' | 'language' | 'privacy' | 'content-visibility' | 'demographics' | 'notifications-detailed' | 'group-privacy' | 'account-privacy' | 'help' | 'theme' | 'security' | 'data' | 'blocked' | 'view-as';

const shiftDateOnlyYears = (value: string, years: number): string => {
  const [year, month, day] = value.split('-').map(Number);
  const targetYear = year + years;
  const maxDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  return `${String(targetYear).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(Math.min(day, maxDay)).padStart(2, '0')}`;
};

const normalizeEditableProfile = (profile: UserProfile): UserProfile => ({
  ...profile,
  name: profile.name || '',
  bio: profile.bio || ''
});

const ProfileSettingsContent: React.FC<ProfileSettingsScreenProps> = ({
  userProfile,
  onUpdateProfile,
  onBack,
  onLogout,
  oauthFeedback
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const { run: runProtected, dialog: reauthenticationDialog } = useProtectedAccountAction();
  const subPageMatch = location.pathname.split('/settings/profile/')[1];
  const currentSubPage = (subPageMatch as SubPage) || 'main';

  const setCurrentSubPage = (page: SubPage) => {
    if (page === 'main') {
      // A global history length cannot prove that the previous entry belongs
      // to Opiniup. Profile subpages always return to their known parent.
      navigate('/settings/profile', { replace: true });
    } else {
      navigate(`/settings/profile/${page}`);
    }
  };
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [avatarMedia, setAvatarMedia] = useState<MediaDraft[]>(() => userProfile.avatarMediaId
    ? [createPersistedMediaDraftFromId(userProfile.avatarMediaId, 'PROFILE_AVATAR', userProfile.avatar)]
    : []);
  const [coverMedia, setCoverMedia] = useState<MediaDraft[]>(() => userProfile.coverMediaId
    ? [createPersistedMediaDraftFromId(userProfile.coverMediaId, 'PROFILE_COVER', userProfile.coverMedia?.src || '', 3)]
    : []);
  const avatarMediaRef = React.useRef(avatarMedia);
  const coverMediaRef = React.useRef(coverMedia);
  const coverPickerRef = React.useRef<MediaPickerHandle>(null);
  const coverControlsRef = React.useRef<MediaPickerControls | null>(null);
  const [showCoverActions, setShowCoverActions] = useState(false);
  const [confirmCoverRemoval, setConfirmCoverRemoval] = useState(false);
  const [linkCount, setLinkCount] = useState(userProfile.profileLinks?.length || 0);
  const [linkDraftDirty, setLinkDraftDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [privacySaveError, setPrivacySaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; birthday?: string; handle?: string }>({});
  const [isPrivateProfileLoading, setIsPrivateProfileLoading] = useState(false);
  const [privateProfileLoadError, setPrivateProfileLoadError] = useState<string | null>(null);
  const [privateProfileRetryKey, setPrivateProfileRetryKey] = useState(0);
  const saveLatchRef = React.useRef(false);
  const allowNextProfileNavigationRef = React.useRef(false);

  const getCalculatedAgeGroup = (profile: UserProfile): string => {
    if (profile.birthday) return calculateAgeGroupFromDateOnly(profile.birthday) || '';
    return profile.demographics?.ageGroup || '';
  };

  // Form state initialized from props
  const [profileForm, setProfileForm] = useState<UserProfile>(() => ({
    ...normalizeEditableProfile(userProfile),
    demographics: userProfile.demographics || {
      gender: '',
      ageGroup: getCalculatedAgeGroup(userProfile),
      maritalStatus: '',
      education: '',
      employment: '',
      nationality: ''
    }
  }));

  // Sync form state when userProfile external prop updates
  React.useEffect(() => {
    const nextProfile = {
      ...normalizeEditableProfile(userProfile),
      demographics: userProfile.demographics || {
        gender: '',
        ageGroup: getCalculatedAgeGroup(userProfile),
        maritalStatus: '',
        education: '',
        employment: '',
        nationality: ''
      }
    };
    const preserveEditDraft = currentSubPage === 'edit-profile' || currentSubPage === 'links';
    setProfileForm((current) => preserveEditDraft
      ? {
          ...nextProfile,
          ...current,
          avatarMediaId: nextProfile.avatarMediaId,
          avatarMedia: nextProfile.avatarMedia,
          coverMediaId: nextProfile.coverMediaId,
          coverMedia: nextProfile.coverMedia,
          updatedAt: nextProfile.updatedAt,
          profileLinks: userProfile.profileLinks
        }
      : nextProfile);
    if (!preserveEditDraft) {
      setAvatarMedia(userProfile.avatarMediaId
        ? [createPersistedMediaDraftFromId(userProfile.avatarMediaId, 'PROFILE_AVATAR', userProfile.avatar)]
        : []);
      setCoverMedia(userProfile.coverMediaId
        ? [createPersistedMediaDraftFromId(userProfile.coverMediaId, 'PROFILE_COVER', userProfile.coverMedia?.src || '', 3)]
        : []);
    }
    setLinkCount(userProfile.profileLinks?.length || 0);
  }, [userProfile]);

  React.useEffect(() => { avatarMediaRef.current = avatarMedia; }, [avatarMedia]);
  React.useEffect(() => { coverMediaRef.current = coverMedia; }, [coverMedia]);
  React.useEffect(() => () => {
    void cancelTemporaryMediaDrafts([...avatarMediaRef.current, ...coverMediaRef.current]);
  }, []);

  React.useEffect(() => {
    if (!userProfile.id) return;
    let active = true;
    const controller = new AbortController();
    setIsPrivateProfileLoading(true);
    setPrivateProfileLoadError(null);
    api.getMe({ signal: controller.signal, timeoutMs: 15_000 })
      .then((privateProfile) => {
        if (!active) return;
        const merged = normalizeEditableProfile({
          ...userProfile,
          ...privateProfile,
          demographics: privateProfile.demographics || userProfile.demographics || {}
        } as UserProfile);
        setProfileForm((current) => ({
          ...merged,
          handle: current.handle !== userProfile.handle ? current.handle : merged.handle,
          name: (current.name || '') !== (userProfile.name || '') ? current.name : merged.name,
          bio: (current.bio || '') !== (userProfile.bio || '') ? current.bio : merged.bio,
          birthday: (current.birthday || null) !== (userProfile.birthday || null)
            ? current.birthday
            : merged.birthday
        }));
        const freshAvatarMedia = merged.avatarMediaId
          ? [createPersistedMediaDraftFromId(merged.avatarMediaId, 'PROFILE_AVATAR', merged.avatar)]
          : [];
        const freshCoverMedia = merged.coverMediaId
          ? [createPersistedMediaDraftFromId(merged.coverMediaId, 'PROFILE_COVER', merged.coverMedia?.src || '', 3)]
          : [];
        setAvatarMedia((current) => {
          const next = current.some((draft) => !draft.persisted)
            || profileMediaDraftHasChanged(current, userProfile.avatarMediaId)
            ? current
            : freshAvatarMedia;
          avatarMediaRef.current = next;
          return next;
        });
        setCoverMedia((current) => {
          const next = current.some((draft) => !draft.persisted)
            || profileMediaDraftHasChanged(current, userProfile.coverMediaId)
            ? current
            : freshCoverMedia;
          coverMediaRef.current = next;
          return next;
        });
        setLinkCount(merged.profileLinks?.length || 0);
        onUpdateProfile(merged);
      })
      .catch((error: any) => {
        if (error?.name === 'AbortError') return;
        if (active) setPrivateProfileLoadError(t('profile.edit.loadFailed', { defaultValue: 'Some private profile details could not be loaded.' }));
      })
      .finally(() => {
        if (active) setIsPrivateProfileLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [userProfile.id, privateProfileRetryKey]);

  const deepStripUndefined = (value: any): any => {
    if (Array.isArray(value)) return value.map(deepStripUndefined);
    if (value && typeof value === 'object') {
      const out: any = {};
      Object.keys(value).forEach((k) => {
        const v = value[k];
        if (v === undefined) return;
        const cleaned = deepStripUndefined(v);
        if (cleaned !== undefined) out[k] = cleaned;
      });
      return out;
    }
    return value;
  };

  const nextAvatarMediaId = readyMediaAssetIds(avatarMedia)[0] || null;
  const nextCoverMediaId = readyMediaAssetIds(coverMedia)[0] || null;
  const avatarMediaChanged = profileMediaDraftHasChanged(avatarMedia, userProfile.avatarMediaId);
  const coverMediaChanged = profileMediaDraftHasChanged(coverMedia, userProfile.coverMediaId);
  const birthdayValidation = validateDateOfBirth(profileForm.birthday || null, {
    required: Boolean(userProfile.birthday),
    minimumAge: PROFILE_MIN_AGE,
    maximumAge: PROFILE_MAX_AGE
  });
  const hasProfileChanges = profileEditHasChanges(profileForm, userProfile, avatarMedia, coverMedia)
    || profileForm.handle !== userProfile.handle
    || (profileForm.location || '') !== (userProfile.location || '')
    || (profileForm.website || '') !== (userProfile.website || '');
  const resetProfileEditDraft = React.useCallback((): void => {
    void cancelTemporaryMediaDrafts([...avatarMediaRef.current, ...coverMediaRef.current]);
    setSaveError(null);
    setFieldErrors({});
    setShowCoverActions(false);
    setConfirmCoverRemoval(false);
    setProfileForm(normalizeEditableProfile(userProfile));
    const resetAvatarMedia = userProfile.avatarMediaId
      ? [createPersistedMediaDraftFromId(userProfile.avatarMediaId, 'PROFILE_AVATAR', userProfile.avatar)]
      : [];
    const resetCoverMedia = userProfile.coverMediaId
      ? [createPersistedMediaDraftFromId(userProfile.coverMediaId, 'PROFILE_COVER', userProfile.coverMedia?.src || '', 3)]
      : [];
    avatarMediaRef.current = resetAvatarMedia;
    coverMediaRef.current = resetCoverMedia;
    setAvatarMedia(resetAvatarMedia);
    setCoverMedia(resetCoverMedia);
    allowNextProfileNavigationRef.current = false;
  }, [userProfile]);
  const shouldBlockProfileNavigation = React.useCallback(({ currentLocation, nextLocation }: {
    currentLocation: { pathname: string };
    nextLocation: { pathname: string };
  }): boolean => {
    if (allowNextProfileNavigationRef.current) {
      allowNextProfileNavigationRef.current = false;
      return false;
    }
    if (linkDraftDirty && currentLocation.pathname === '/settings/profile/links') return currentLocation.pathname !== nextLocation.pathname;
    if (!hasProfileChanges) return false;
    const editTransactionPaths = ['/settings/profile/edit-profile', '/settings/profile/links'];
    if (!editTransactionPaths.includes(currentLocation.pathname)) return false;
    // Links is a nested part of the same edit transaction. Moving between the
    // two screens retains the draft; every route outside it requires consent.
    return !editTransactionPaths.includes(nextLocation.pathname)
      && nextLocation.pathname !== currentLocation.pathname;
  }, [hasProfileChanges, linkDraftDirty]);
  const profileNavigationBlocker = useBlocker(shouldBlockProfileNavigation);
  const profileMediaReady = mediaDraftsAreReady(avatarMedia)
    && mediaDraftsAreReady(coverMedia)
    && !mediaDraftsHaveErrors(avatarMedia)
    && !mediaDraftsHaveErrors(coverMedia);
  const profileFormIsValid = profileForm.name.trim().length > 0 && birthdayValidation.valid;
  const canSaveProfile = hasProfileChanges
    && profileFormIsValid
    && profileMediaReady
    && !isPrivateProfileLoading
    && !privateProfileLoadError
    && (!coverMediaChanged || Boolean(profileForm.updatedAt || userProfile.updatedAt));
  const todayDateOnly = serializeDateOnly(todayAsDateOnly());
  const maximumBirthday = shiftDateOnlyYears(todayDateOnly, -PROFILE_MIN_AGE);
  const minimumBirthday = shiftDateOnlyYears(todayDateOnly, -PROFILE_MAX_AGE);

  const birthdayErrorMessage = (error: string): string => {
    const keyByError: Record<string, string> = {
      required: 'profile.dateOfBirth.required',
      invalidFormat: 'profile.dateOfBirth.invalid',
      invalidDate: 'profile.dateOfBirth.invalid',
      future: 'profile.dateOfBirth.future',
      underage: 'profile.dateOfBirth.underage',
      tooOld: 'profile.dateOfBirth.tooOld'
    };
    return t(keyByError[error] || 'profile.dateOfBirth.invalid', {
      minAge: PROFILE_MIN_AGE,
      maxAge: PROFILE_MAX_AGE,
      defaultValue: 'Enter a valid date of birth.'
    });
  };

  React.useEffect(() => {
    if ((currentSubPage !== 'edit-profile' && currentSubPage !== 'links') || !hasProfileChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [currentSubPage, hasProfileChanges]);

  React.useEffect(() => {
    if (profileNavigationBlocker.state !== 'blocked') return;
    const discard = window.confirm(t('profile.edit.discardConfirm', { defaultValue: 'Discard your unsaved profile changes?' }));
    if (discard) {
      resetProfileEditDraft();
      profileNavigationBlocker.proceed();
    } else {
      profileNavigationBlocker.reset();
    }
  }, [profileNavigationBlocker, resetProfileEditDraft, t]);

  const leaveEditProfile = (): void => {
    if (hasProfileChanges && !window.confirm(t('profile.edit.discardConfirm', { defaultValue: 'Discard your unsaved profile changes?' }))) return;
    resetProfileEditDraft();
    allowNextProfileNavigationRef.current = true;
    setCurrentSubPage('main');
  };

  const handleSave = async () => {
    const nextErrors: { name?: string; birthday?: string; handle?: string } = {};
    if (currentSubPage === 'edit-profile' && !profileForm.name.trim()) {
      nextErrors.name = t('profile.edit.nameRequired', { defaultValue: 'Name is required.' });
    }
    if (currentSubPage === 'edit-profile' && 'error' in birthdayValidation) {
      nextErrors.birthday = birthdayErrorMessage(birthdayValidation.error);
    }
    if (profileForm.handle !== userProfile.handle && !/^[a-z0-9_.]{3,30}$/i.test(profileForm.handle.trim())) {
      nextErrors.handle = i18n.language.startsWith('ar') ? 'استخدم من 3 إلى 30 حرفًا إنجليزيًا أو رقمًا أو نقطة أو شرطة سفلية.' : 'Use 3–30 English letters, numbers, dots or underscores.';
    }
    setFieldErrors(nextErrors);
    if (
      Object.keys(nextErrors).length > 0
      || privateProfileLoadError
      || isPrivateProfileLoading
      || (currentSubPage === 'edit-profile' && !canSaveProfile)
      || isSaving
      || saveLatchRef.current
      || !userProfile.id
    ) return;

    saveLatchRef.current = true;
    setIsSaving(true);
    setSaveError(null);
    try {
      const profileEditPayload = {
        ...(avatarMediaChanged ? { avatarMediaId: nextAvatarMediaId || null } : {}),
        ...(coverMediaChanged ? { coverMediaId: nextCoverMediaId || null } : {}),
        ...((profileForm.birthday || null) !== (userProfile.birthday || null) ? { birthday: profileForm.birthday || null } : {}),
        expectedUpdatedAt: profileForm.updatedAt || userProfile.updatedAt,
        name: profileForm.name.trim(),
        ...(profileForm.handle !== userProfile.handle ? { handle: profileForm.handle.trim().toLowerCase() } : {}),
        bio: profileForm.bio,
        location: profileForm.location || '',
        website: profileForm.website || ''
      };
      const payload = deepStripUndefined(profileEditPayload);

      let updatedProfile: UserProfile | undefined;
      if (!(await runProtected(async () => { updatedProfile = await api.updateUser(userProfile.id, payload); })) || !updatedProfile) return;

      const merged: UserProfile = {
        ...userProfile,
        ...profileForm,
        ...updatedProfile,
        demographics: updatedProfile.demographics || userProfile.demographics
      };

      const persistedAvatarMedia = avatarMedia.map((draft) => draft.assetId === merged.avatarMediaId
        ? { ...draft, persisted: true }
        : draft);
      const persistedCoverMedia = coverMedia.map((draft) => draft.assetId === merged.coverMediaId
        ? { ...draft, persisted: true }
        : draft);
      avatarMediaRef.current = persistedAvatarMedia;
      coverMediaRef.current = persistedCoverMedia;
      setAvatarMedia(persistedAvatarMedia);
      setCoverMedia(persistedCoverMedia);

      setProfileForm(merged);
      onUpdateProfile(merged);
      setFieldErrors({});
      allowNextProfileNavigationRef.current = true;
      setCurrentSubPage('main');
    } catch (error) {
      console.error("Failed to update profile", error);
      const code = (error as { code?: string })?.code;
      if (code && ['INVALID_HANDLE', 'HANDLE_RESERVED', 'HANDLE_UNAVAILABLE'].includes(code)) {
        setFieldErrors(current => ({ ...current, handle: code === 'INVALID_HANDLE' ? (i18n.language.startsWith('ar') ? 'صيغة اسم المستخدم غير صالحة.' : 'The username format is invalid.') : (i18n.language.startsWith('ar') ? 'اسم المستخدم غير متاح. اختر اسمًا آخر.' : 'This username is unavailable. Choose another.') }));
        return;
      }
      if (code === 'AUTH_REQUIRED' || code === 'REAUTHENTICATION_REQUIRED') { setSaveError(securityErrorText(error, i18n.language.startsWith('ar'))); return; }
      const message = error instanceof Error ? error.message : '';
      setSaveError(message.toLowerCase().includes('conflict') || message.toLowerCase().includes('changed')
        ? t('profile.edit.conflict', { defaultValue: 'Your profile changed elsewhere. Reload and try again.' })
        : t('profile.edit.saveFailed', { defaultValue: 'Your profile changes could not be saved. Check your connection and try again.' }));
    } finally {
      saveLatchRef.current = false;
      setIsSaving(false);
    }
  };

  const SectionHeader = ({ title }: { title: string }) => (
    <h3 className="px-5 pt-6 pb-2 text-sm font-bold text-gray-600">{title}</h3>
  );

  const SettingItem = ({
    icon: Icon,
    label,
    value,
    onClick,
    type = 'navigate',
    active = false
  }: {
    icon: any,
    label: string,
    value?: string,
    onClick?: () => void,
    type?: 'navigate' | 'toggle' | 'danger',
    active?: boolean
  }) => (
    <button
      onClick={onClick}
      className="w-full min-h-14 flex items-center gap-4 px-5 py-3.5 bg-white hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
    >
      <div className={`p-2 rounded-xl ${type === 'danger' ? 'bg-red-50 text-red-500' : 'bg-gray-100 text-gray-500'}`}>
        <Icon size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-bold ${type === 'danger' ? 'text-red-600' : 'text-gray-900'}`}>{label}</p>
        {value && <p className="text-sm text-gray-600 font-medium leading-relaxed">{value}</p>}
      </div>
      {type === 'navigate' && <ChevronRight size={16} className="text-gray-300 rtl:rotate-180" />}
      {type === 'toggle' && (
        <div className={`w-10 h-5 rounded-full relative transition-colors ${active ? 'bg-blue-600' : 'bg-gray-200'}`}>
          <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${active ? 'left-6' : 'left-1'}`} />
        </div>
      )}
    </button>
  );

  const PageHeader = ({ title, showSave = true }: { title: string, showSave?: boolean }) => (
    <div className="bg-white border-b border-gray-100 flex items-center justify-between px-4 h-14 sticky top-0 z-30">
      <div className="flex items-center">
        <button
          type="button"
          onClick={currentSubPage === 'edit-profile' ? leaveEditProfile : () => setCurrentSubPage('main')}
          className="flex h-11 w-11 items-center justify-center -ms-2 text-gray-600 hover:bg-gray-50 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          aria-label={t('common.back', { defaultValue: 'Back' })}
        >
          <ArrowLeft size={24} className="rtl:rotate-180" />
        </button>
        <h1 className="font-bold text-lg ms-2">{title}</h1>
      </div>
      {showSave && (
        <button
          onClick={handleSave}
          disabled={isSaving || isPrivateProfileLoading || Boolean(privateProfileLoadError) || (currentSubPage === 'edit-profile' && !canSaveProfile)}
          className="flex min-h-11 min-w-20 items-center justify-center gap-2 bg-blue-600 text-white px-5 py-2 rounded-full text-xs font-black uppercase tracking-widest shadow-md shadow-blue-200 active:scale-95 transition-all disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          {isSaving && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
          {isSaving ? t('profile.edit.saving', { defaultValue: 'Saving...' }) : t('profile.edit.save', { defaultValue: 'Save' })}
        </button>
      )}
    </div>
  );

  if (currentSubPage === 'links') {
    return (
      <ProfileLinksManager
        onDirtyChange={setLinkDraftDirty}
        onBack={() => navigate('/settings/profile/edit-profile', { replace: true })}
        onLinksChange={(links) => {
          setLinkCount(links.length);
          setProfileForm((current) => ({ ...current, profileLinks: links }));
          onUpdateProfile({ ...userProfile, profileLinks: links });
        }}
      />
    );
  }

  if (currentSubPage === 'edit-profile') {
    return (
      <div className="flex flex-col h-full bg-gray-50 animate-in slide-in-from-right duration-300">
        {reauthenticationDialog}
        <PageHeader title={t('profile.edit.title', { defaultValue: 'Edit Profile' })} />
        <div className="flex-1 overflow-y-auto pb-10 no-scrollbar">
          <div className="relative">
            <MediaPicker
              ref={coverPickerRef}
              purpose="PROFILE_COVER"
              value={coverMedia}
              onChange={(next) => {
                coverMediaRef.current = next;
                setCoverMedia(next);
              }}
              aspectRatio={3}
              disabled={isSaving || isPrivateProfileLoading}
              showAddButton={false}
              renderContent={(controls) => {
                coverControlsRef.current = controls;
                const current = coverMedia[0];
                const isBusy = Boolean(current && ['editing', 'queued', 'uploading', 'processing'].includes(current.status));
                const objectPosition = current?.crop
                  ? `${current.crop.focalX * 100}% ${current.crop.focalY * 100}%`
                  : '50% 50%';
                return (
                  <div className={`relative aspect-[3/1] w-full overflow-hidden bg-gray-100 ${current?.status === 'error' ? 'ring-2 ring-inset ring-red-500' : ''}`}>
                    {current?.status === 'ready' && current.assetId ? (
                      <MediaImage
                        mediaId={current.assetId}
                        media={current.presentation}
                        alt=""
                        sizes="(max-width: 768px) 100vw, 768px"
                        useFocalPoint
                        className="h-full w-full object-cover"
                      />
                    ) : current?.previewUrl ? (
                      <img
                        src={current.previewUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        style={{ objectPosition }}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-gray-100 via-gray-50 to-blue-50 text-gray-400" aria-hidden="true">
                        <ImageIcon size={34} strokeWidth={1.6} />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmCoverRemoval(false);
                        setShowCoverActions(true);
                      }}
                      disabled={isSaving || isPrivateProfileLoading || isBusy}
                      className="absolute inset-0 flex items-end justify-end p-3 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-blue-500/70 disabled:cursor-wait"
                      aria-label={t('profile.cover.edit', { defaultValue: 'Edit cover photo' })}
                    >
                      <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/70 bg-white/90 text-gray-700 shadow-lg backdrop-blur-sm" aria-hidden="true">
                        {isBusy ? <Loader2 size={19} className="animate-spin" /> : <Camera size={19} />}
                      </span>
                    </button>
                    {isBusy && current && (
                      <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/20" role="status" aria-live="polite">
                        <div className="h-full bg-blue-600 transition-[width]" style={{ width: `${current.status === 'processing' ? 100 : current.progress}%` }} />
                        <span className="sr-only">
                          {current.status === 'processing'
                            ? t('profile.cover.processing', { defaultValue: 'Processing cover photo' })
                            : t('profile.cover.uploadProgress', { progress: current.progress, defaultValue: `Uploading cover photo, ${current.progress}%` })}
                        </span>
                      </div>
                    )}
                  </div>
                );
              }}
            />

            <div className="relative z-10 -mt-12 flex justify-center">
            <MediaPicker
              purpose="PROFILE_AVATAR"
              value={avatarMedia}
              onChange={(next) => {
                avatarMediaRef.current = next;
                setAvatarMedia(next);
              }}
              disabled={isSaving || isPrivateProfileLoading}
              renderContent={({ open, retry, busy, canSelect }) => {
                const current = avatarMedia[0];
                const previewUrl = current?.previewUrl || profileForm.avatar;
                return (
                  <div className="relative">
                    <div className={`w-24 h-24 rounded-full border-4 border-white shadow-lg overflow-hidden bg-gray-100 ${current?.status === 'error' ? 'ring-2 ring-red-400' : ''}`}>
                      {current?.status === 'ready' && current.assetId ? (
                        <MediaImage mediaId={current.assetId} media={current.presentation} alt={profileForm.name || t('profile.avatar.alt', { defaultValue: 'Profile photo' })} sizes="96px" className="h-full w-full object-cover" />
                      ) : previewUrl ? (
                        <img src={previewUrl} alt={profileForm.name || t('profile.avatar.alt', { defaultValue: 'Profile photo' })} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xl font-bold text-gray-500">
                          {(profileForm.name || 'U').trim().charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => current?.status === 'error' ? retry(current.clientId) : open()}
                      disabled={busy || !canSelect}
                      className="absolute -bottom-1 -end-1 flex h-11 w-11 items-center justify-center bg-blue-600 text-white rounded-full border-[3px] border-white shadow-md active:scale-90 transition-transform disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                      aria-label={current?.status === 'error' ? t('common.retry', { defaultValue: 'Retry' }) : t('profile.avatar.change', { defaultValue: 'Change profile photo' })}
                      title={current?.status === 'error' ? t('common.retry', { defaultValue: 'Retry' }) : t('profile.avatar.change', { defaultValue: 'Change profile photo' })}
                    >
                      {busy ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
                    </button>
                  </div>
                );
              }}
            />
            </div>
          </div>

          <div className="space-y-5 px-5 pt-7">
            {privateProfileLoadError && (
              <div role="alert" className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <Info size={18} className="shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1">{privateProfileLoadError}</span>
                <button
                  type="button"
                  onClick={() => setPrivateProfileRetryKey((current) => current + 1)}
                  className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-white px-3 text-xs font-bold text-amber-900 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
                >
                  <RefreshCw size={14} aria-hidden="true" />
                  {t('common.retry', { defaultValue: 'Retry' })}
                </button>
              </div>
            )}
            {saveError && (
              <div role="alert" aria-live="assertive" className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
                {saveError}
              </div>
            )}
            <div>
              <label htmlFor="profile-display-name" className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ms-1">{t('profile.edit.displayName', { defaultValue: 'Display name' })}</label>
              <input
                id="profile-display-name"
                type="text"
                value={profileForm.name}
                maxLength={100}
                aria-invalid={Boolean(fieldErrors.name)}
                aria-describedby={fieldErrors.name ? 'profile-name-error' : undefined}
                onChange={(e) => {
                  setProfileForm({ ...profileForm, name: e.target.value });
                  setFieldErrors((current) => ({ ...current, name: undefined }));
                  setSaveError(null);
                }}
                className={`min-h-12 w-full bg-white border rounded-2xl px-4 py-3.5 text-sm font-semibold focus:outline-none focus:ring-2 transition-all shadow-sm ${fieldErrors.name ? 'border-red-400 focus:ring-red-200' : 'border-gray-100 focus:ring-blue-500/10 focus:border-blue-500'}`}
              />
              {fieldErrors.name && <p id="profile-name-error" role="alert" className="mt-1.5 ms-1 text-xs font-semibold text-red-600">{fieldErrors.name}</p>}
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-3 px-1">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t('profile.edit.bio', { defaultValue: 'Bio' })}</label>
                <span className="text-[10px] tabular-nums text-gray-400" aria-hidden="true">{profileForm.bio.length}/500</span>
              </div>
              <RichMentionInput
                value={profileForm.bio}
                onChange={(bio) => { setProfileForm({ ...profileForm, bio: bio.slice(0, 500) }); setSaveError(null); }}
                className="w-full bg-white border border-gray-100 rounded-2xl px-4 py-3.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 transition-all shadow-sm resize-none"
                minRows={4}
                ariaLabel={t('profile.edit.bio', { defaultValue: 'Bio' })}
              />
            </div>

            <button
              type="button"
              onClick={() => setCurrentSubPage('links')}
              className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3 text-start shadow-sm transition-colors hover:border-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600" aria-hidden="true"><Link2 size={19} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-gray-900">{t('profile.links.sheetTitle', { defaultValue: 'Links' })}</span>
                <span className="block text-xs text-gray-500">{linkCount > 0
                  ? t('profileLinks.count', { count: linkCount, max: 5 })
                  : t('profileLinks.empty.description')}</span>
              </span>
              <ChevronRight size={18} className="shrink-0 text-gray-300 rtl:rotate-180" aria-hidden="true" />
            </button>

            <div>
              <label htmlFor="profile-date-of-birth" className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ms-1">{t('profile.dateOfBirth.label', { defaultValue: 'Date of birth' })}</label>
              <div className="relative">
                <CalendarDays size={18} className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                <input
                  id="profile-date-of-birth"
                  type="date"
                  dir="ltr"
                  value={profileForm.birthday || ''}
                  min={minimumBirthday}
                  max={maximumBirthday}
                  aria-invalid={Boolean(fieldErrors.birthday)}
                  aria-describedby={`profile-date-privacy${fieldErrors.birthday ? ' profile-date-error' : ''}`}
                  onChange={(event) => {
                    const value = event.target.value || null;
                    setProfileForm({ ...profileForm, birthday: value });
                    const validation = validateDateOfBirth(value, { required: Boolean(userProfile.birthday), minimumAge: PROFILE_MIN_AGE, maximumAge: PROFILE_MAX_AGE });
                    setFieldErrors((current) => ({ ...current, birthday: 'error' in validation ? birthdayErrorMessage(validation.error) : undefined }));
                    setSaveError(null);
                  }}
                  className={`min-h-12 w-full rounded-2xl border bg-white py-3.5 ps-11 pe-4 text-sm font-semibold shadow-sm focus:outline-none focus:ring-2 ${fieldErrors.birthday ? 'border-red-400 focus:ring-red-200' : 'border-gray-100 focus:border-blue-500 focus:ring-blue-500/10'}`}
                />
              </div>
              {fieldErrors.birthday && <p id="profile-date-error" role="alert" className="mt-1.5 ms-1 text-xs font-semibold text-red-600">{fieldErrors.birthday}</p>}
              <p id="profile-date-privacy" className="mt-2 flex items-start gap-1.5 px-1 text-xs leading-relaxed text-gray-500">
                <Lock size={14} className="mt-px shrink-0" aria-hidden="true" />
                {t('profile.dateOfBirth.privacy', { defaultValue: 'Your date of birth is not visible to others' })}
              </p>
            </div>

            <div>
              <label htmlFor="profile-fixed-handle" className="mb-2 block text-sm font-semibold text-gray-700">{t('settingsV2.profile.handle')}</label>
              <input id="profile-fixed-handle" value={profileForm.handle} onChange={event => { setProfileForm({ ...profileForm, handle: event.target.value.replace(/^@/, '') }); setFieldErrors(current => ({ ...current, handle: undefined })); setSaveError(null); }} maxLength={30} autoCapitalize="none" autoCorrect="off" autoComplete="username" spellCheck={false} aria-invalid={Boolean(fieldErrors.handle)} dir="ltr" aria-describedby="profile-fixed-handle-hint profile-handle-error" className="min-h-12 w-full rounded-2xl border border-gray-200 bg-gray-100 px-4 py-3 text-sm text-gray-700" />
              {fieldErrors.handle && <p id="profile-handle-error" role="alert" className="mt-2 text-sm text-red-700">{fieldErrors.handle}</p>}
              <p id="profile-fixed-handle-hint" className="mt-2 text-sm leading-relaxed text-gray-600">{i18n.language.startsWith('ar') ? 'يبقى اسمك السابق محجوزًا لك، وتصل روابطه إلى ملفك الحالي.' : 'Your previous username stays reserved for you, and its links lead to your current profile.'}</p>
            </div>
            {(['location', 'website'] as const).map((field) => (
              <div key={field}>
                <label htmlFor={`profile-${field}`} className="mb-2 block text-sm font-semibold text-gray-700">{t(`settingsV2.profile.${field}`)}</label>
                <input id={`profile-${field}`} value={profileForm[field] || ''} onChange={(event) => { setProfileForm({ ...profileForm, [field]: event.target.value }); setSaveError(null); }} maxLength={field === 'location' ? 100 : 2048} type={field === 'website' ? 'url' : 'text'} dir={field === 'website' ? 'ltr' : undefined} autoComplete={field === 'website' ? 'url' : 'address-level2'} className="min-h-12 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-600" />
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{t(`settingsV2.profile.${field}Hint`)}</p>
              </div>
            ))}

            {!hasProfileChanges && !isPrivateProfileLoading && (
              <p className="text-center text-xs text-gray-400" role="status">{t('profile.edit.noChanges', { defaultValue: 'Make a change to enable Save.' })}</p>
            )}
          </div>
        </div>

        <BottomSheet
          isOpen={showCoverActions}
          onClose={() => {
            setShowCoverActions(false);
            setConfirmCoverRemoval(false);
          }}
          title={t('profile.cover.actionsTitle', { defaultValue: 'Cover photo' })}
          ariaLabel={t('profile.cover.actionsTitle', { defaultValue: 'Cover photo' })}
        >
          {confirmCoverRemoval ? (
            <div className="py-2 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-600" aria-hidden="true"><Trash2 size={25} /></div>
              <h3 className="text-base font-bold text-gray-900">{t('profile.cover.removeConfirmTitle', { defaultValue: 'Remove cover photo?' })}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-500">{t('profile.cover.removeConfirmDescription', { defaultValue: 'The current photo remains until you save these changes.' })}</p>
              <div className="mt-6 space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    void cancelTemporaryMediaDrafts(coverMedia.filter((draft) => !draft.persisted));
                    coverMediaRef.current = [];
                    setCoverMedia([]);
                    setConfirmCoverRemoval(false);
                    setShowCoverActions(false);
                  }}
                  className="min-h-12 w-full rounded-2xl bg-red-600 px-4 font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
                >
                  {t('profile.cover.remove', { defaultValue: 'Remove cover photo' })}
                </button>
                <button type="button" onClick={() => setConfirmCoverRemoval(false)} className="min-h-12 w-full rounded-2xl bg-gray-100 px-4 font-bold text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
                  {t('common.cancel', { defaultValue: 'Cancel' })}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2 pt-2">
              {coverMedia[0]?.status === 'error' && (
                <button
                  type="button"
                  onClick={() => {
                    coverControlsRef.current?.retry(coverMedia[0].clientId);
                    setShowCoverActions(false);
                  }}
                  className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 text-start font-bold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50" aria-hidden="true"><Loader2 size={19} /></span>
                  {t('common.retry', { defaultValue: 'Retry' })}
                </button>
              )}
              <button
                type="button"
                onClick={() => { setShowCoverActions(false); coverPickerRef.current?.open(); }}
                className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 text-start font-bold text-gray-900 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600" aria-hidden="true"><Camera size={19} /></span>
                {coverMedia.length > 0
                  ? t('profile.cover.change', { defaultValue: 'Change cover photo' })
                  : t('profile.cover.upload', { defaultValue: 'Upload cover photo' })}
              </button>
              {coverMedia.length > 0 && (
                <button type="button" onClick={() => setConfirmCoverRemoval(true)} className="flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 text-start font-bold text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50" aria-hidden="true"><Trash2 size={19} /></span>
                  {t('profile.cover.remove', { defaultValue: 'Remove cover photo' })}
                </button>
              )}
              <button type="button" onClick={() => setShowCoverActions(false)} className="min-h-12 w-full rounded-2xl bg-gray-100 px-4 font-bold text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </button>
            </div>
          )}
        </BottomSheet>
      </div>
    );
  }

  if (currentSubPage === 'email-phone' || currentSubPage === 'account-access') return <AccountAccessScreen userProfile={userProfile} onUpdateProfile={onUpdateProfile} onBack={() => setCurrentSubPage('main')} oauthFeedback={oauthFeedback} />;

  return (
    <section dir={i18n.dir()} className="flex h-full min-h-0 flex-col bg-gray-50">
      <header className="flex min-h-16 items-center gap-2 border-b border-gray-100 bg-white px-3">
        <button type="button" onClick={onBack} aria-label={t('common.back', { defaultValue: 'Back' })} className="flex h-11 w-11 items-center justify-center rounded-full text-gray-700 focus-visible:ring-2 focus-visible:ring-blue-600"><ArrowLeft size={23} className="rtl:rotate-180" /></button>
        <h1 className="text-lg font-bold text-gray-900">{t('Settings')}</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto pb-24">
        <SectionHeader title={t('settingsV2.sections.profile')} />
        <div className="border-y border-gray-100 bg-white">
          <SettingItem icon={User} label={t('Edit Profile')} value={t('settingsV2.profile.summary')} onClick={() => setCurrentSubPage('edit-profile')} />
          <SettingItem icon={Eye} label={t('settingsV2.viewAs')} onClick={() => setCurrentSubPage('view-as')} />
        </div>
        <SectionHeader title={t('settingsV2.sections.security')} />
        <div className="border-y border-gray-100 bg-white">
          <SettingItem icon={Mail} label={t('settingsV2.access')} value={t('settingsV2.accessHint')} onClick={() => setCurrentSubPage('account-access')} />
          <SettingItem icon={Shield} label={t('settingsV2.security')} value={t('settingsV2.securityHint')} onClick={() => setCurrentSubPage('security')} />
        </div>
        <SectionHeader title={t('settingsV2.sections.privacy')} />
        <div className="border-y border-gray-100 bg-white">
          <SettingItem icon={Lock} label={t('settingsV2.privacy.title')} value={t('settingsV2.privacy.summary')} onClick={() => setCurrentSubPage('account-privacy')} />
          <SettingItem icon={Users} label={t('settingsV2.privacy.groups')} value={t(`settingsV2.privacy.groupOptions.${userProfile.groupPrivacy || 'Public'}`)} onClick={() => setCurrentSubPage('group-privacy')} />
          <SettingItem icon={UserPlus} label={t('settingsV2.blocked')} onClick={() => setCurrentSubPage('blocked')} />
        </div>
        <SectionHeader title={t('settingsV2.sections.notifications')} />
        <div className="border-y border-gray-100 bg-white"><SettingItem icon={Bell} label={t('Notification Settings')} value={t('settingsV2.notificationsHint')} onClick={() => setCurrentSubPage('notifications-detailed')} /></div>
        <SectionHeader title={t('settingsV2.sections.preferences')} />
        <div className="border-y border-gray-100 bg-white">
          <SettingItem icon={Languages} label={t('settingsV2.language')} value={new Intl.DisplayNames([i18n.language], { type: 'language' }).of(userProfile.language || 'en')} onClick={() => setCurrentSubPage('language')} />
          <SettingItem icon={Palette} label={t('settingsV2.theme')} onClick={() => setCurrentSubPage('theme')} />
          <SettingItem icon={MapPin} label={t('settingsV2.demographics.title')} value={t('settingsV2.demographics.optionalLabel')} onClick={() => setCurrentSubPage('demographics')} />
          <SettingItem icon={UserCircle} label={t('settingsV2.data')} value={t('settingsV2.dataHint')} onClick={() => setCurrentSubPage('data')} />
        </div>
        <SectionHeader title={t('settingsV2.sections.help')} />
        <div className="border-y border-gray-100 bg-white">
          <SettingItem icon={LifeBuoy} label={t('settingsV2.help.title')} onClick={() => setCurrentSubPage('help')} />
          <SettingItem icon={Shield} label={t('Privacy Policy')} onClick={() => navigate('/privacy')} />
        </div>
        <div className="px-4 pt-8"><button type="button" onClick={() => setShowLogoutConfirm(true)} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white text-sm font-bold text-red-700 focus-visible:ring-2 focus-visible:ring-red-600"><LogOut size={19} />{t('Log Out')}</button></div>
      </div>
      <BottomSheet isOpen={showLogoutConfirm} onClose={() => { if (!isSaving) { setShowLogoutConfirm(false); setSaveError(null); } }} title={t('Log out of your account?')}>
        <div dir={i18n.dir()} className="space-y-4 pb-4">
          <p className="text-sm leading-relaxed text-gray-600">{t('Are you sure you want to log out?')}</p>
          {saveError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{saveError}</p>}
          <button type="button" disabled={isSaving} onClick={async () => { if (saveLatchRef.current) return; saveLatchRef.current = true; setIsSaving(true); setSaveError(null); try { await onLogout(); } catch { setSaveError(t('settingsV2.logoutFailed')); } finally { setIsSaving(false); saveLatchRef.current = false; } }} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-red-600 text-sm font-bold text-white disabled:opacity-50">{isSaving && <Loader2 size={18} className="animate-spin" />}{t('Log Out')}</button>
          <button type="button" disabled={isSaving} onClick={() => setShowLogoutConfirm(false)} className="min-h-12 w-full rounded-xl border border-gray-200 text-sm font-bold">{t('Cancel')}</button>
        </div>
      </BottomSheet>
    </section>
  );
};

export const ProfileSettingsScreen: React.FC<ProfileSettingsScreenProps> = (props) => {
  const location = useLocation();
  const navigate = useNavigate();
  const page = location.pathname.split('/settings/profile/')[1];
  const onBack = () => navigate('/settings/profile', { replace: true });
  if (page === 'demographics') return <DemographicSettingsScreen userProfile={props.userProfile} onUpdateProfile={props.onUpdateProfile} onBack={onBack} />;
  if (page === 'account-privacy' || page === 'group-privacy' || page === 'language' || page === 'theme') return <AccountPreferencesScreen page={page} userProfile={props.userProfile} onUpdateProfile={props.onUpdateProfile} onBack={onBack} />;
  if (page === 'help') return <SettingsHelpScreen onBack={onBack} />;
  if (page === 'notifications-detailed') return <NotificationSettingsScreen userId={props.userProfile.id} onBack={onBack} />;
  if (page === 'security') return <AccountSecurityScreen onBack={onBack} onSignedOut={props.onSessionEnded} />;
  if (page === 'data') return <AccountDataScreen userProfile={props.userProfile} onBack={onBack} onSessionEnded={props.onSessionEnded} />;
  if (page === 'blocked') return <BlockedAccountsScreen onBack={onBack} />;
  if (page === 'view-as' && props.userProfile.id) return <PublicProfilePreviewScreen userId={props.userProfile.id} onBack={onBack} />;
  return <ProfileSettingsContent {...props} />;
};
