
import React, { useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft, User, Mail, Globe, Lock, Eye, Search, Activity,
  Share2, Users, Bell, Palette, Shield, LifeBuoy, LogOut,
  Trash2, ChevronRight, Check, AlertTriangle, Smartphone,
  Languages, Type, MessageSquare, UserPlus, Camera, Edit3, Save,
  X, Briefcase, GraduationCap, Heart, UserCircle, MapPin, Hash,
  CalendarDays, Link2, Image as ImageIcon, Loader2, Info
} from 'lucide-react';
import { BottomSheet } from './BottomSheet';
import { MediaDraft, UserProfile } from '../types';
import { NotificationSettingsScreen } from './NotificationSettingsScreen';
import { api } from '../services/api';
import { useTranslation } from 'react-i18next';
import { MediaPicker, MediaPickerControls, MediaPickerHandle } from './media/MediaPicker';
import { createPersistedMediaDraftFromId, mediaDraftsAreReady, mediaDraftsHaveErrors, readyMediaAssetIds, cancelTemporaryMediaDrafts } from '../utils/mediaDrafts';
import { RichMentionInput } from './RichMentionInput';
import { MediaImage } from './media/MediaImage';
import { ProfileLinksManager } from './ProfileLinksManager';
import { PROFILE_MAX_AGE, PROFILE_MIN_AGE, calculateAgeFromDateOnly, serializeDateOnly, todayAsDateOnly, validateDateOfBirth } from '../utils/profileValidation';

interface ProfileSettingsScreenProps {
  userProfile: UserProfile;
  onUpdateProfile: (profile: UserProfile) => void;
  onBack: () => void;
  onLogout: () => void;
}

type SubPage = 'main' | 'edit-profile' | 'links' | 'username' | 'email-phone' | 'language' | 'privacy' | 'content-visibility' | 'demographics' | 'notifications-detailed' | 'group-privacy' | 'account-privacy';

const NATIONALITIES = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan',
  'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan', 'Bolivia', 'Bosnia and Herzegovina',
  'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi', 'Cambodia', 'Cameroon', 'Canada', 'Cape Verde',
  'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Congo', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czech Republic',
  'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea',
  'Estonia', 'Ethiopia', 'Fiji', 'Finland', 'France', 'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana',
  'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guyana', 'Haiti', 'Honduras', 'Hungary', 'Iceland', 'India', 'Indonesia',
  'Iran', 'Iraq', 'Ireland', 'Italy', 'Ivory Coast', 'Jamaica', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kuwait', 'Kyrgyzstan',
  'Laos', 'Latvia', 'Lebanon', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Madagascar',
  'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Mauritania', 'Mauritius', 'Mexico', 'Moldova', 'Monaco', 'Mongolia',
  'Morocco', 'Mozambique', 'Namibia', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Nigeria', 'Norway', 'Oman', 'Pakistan',
  'Panama', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania', 'Russia', 'Rwanda', 'Saint Lucia',
  'Samoa', 'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia',
  'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa', 'South Korea', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname',
  'Sweden', 'Switzerland', 'Syria', 'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Togo', 'Tonga', 'Tunisia', 'Turkey',
  'Turkmenistan', 'Tuvalu', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay', 'Uzbekistan', 'Vanuatu', 'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe'
];

const shiftDateOnlyYears = (value: string, years: number): string => {
  const [year, month, day] = value.split('-').map(Number);
  const targetYear = year + years;
  const maxDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  return `${String(targetYear).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(Math.min(day, maxDay)).padStart(2, '0')}`;
};

export const ProfileSettingsScreen: React.FC<ProfileSettingsScreenProps> = ({
  userProfile,
  onUpdateProfile,
  onBack,
  onLogout
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const subPageMatch = location.pathname.split('/settings/profile/')[1];
  const currentSubPage = (subPageMatch as SubPage) || 'main';

  const setCurrentSubPage = (page: SubPage) => {
    if (page === 'main') {
      if (window.history.length > 2) {
        navigate(-1);
      } else {
        navigate('/settings/profile', { replace: true });
      }
    } else {
      navigate(`/settings/profile/${page}`);
    }
  };
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [nationalitySearch, setNationalitySearch] = useState('');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [showFollowRequests, setShowFollowRequests] = useState(false);

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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; birthday?: string }>({});
  const [isPrivateProfileLoading, setIsPrivateProfileLoading] = useState(false);
  const [privateProfileLoadError, setPrivateProfileLoadError] = useState<string | null>(null);

  const [activeDemographicSelector, setActiveDemographicSelector] = useState<{
    id: keyof NonNullable<UserProfile['demographics']>;
    title: string;
    options: string[];
  } | null>(null);

  const getCalculatedAgeGroup = (profile: UserProfile): string => {
    let ageGroup = profile.demographics?.ageGroup || '';
    if (!ageGroup && profile.birthday) {
      const age = calculateAgeFromDateOnly(profile.birthday);
      if (age !== null) {
        if (age < 18) ageGroup = 'Under 18';
        else if (age <= 24) ageGroup = '18-24';
        else if (age <= 34) ageGroup = '25-34';
        else if (age <= 44) ageGroup = '35-44';
        else if (age <= 54) ageGroup = '45-54';
        else ageGroup = '55+';
      }
    }
    return ageGroup;
  };

  // Form state initialized from props
  const [profileForm, setProfileForm] = useState<UserProfile>(() => ({
    ...userProfile,
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
      ...userProfile,
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
      ? { ...nextProfile, ...current, profileLinks: userProfile.profileLinks }
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
    setIsPrivateProfileLoading(true);
    setPrivateProfileLoadError(null);
    api.getMe()
      .then((privateProfile) => {
        if (!active) return;
        const merged = {
          ...userProfile,
          ...privateProfile,
          demographics: privateProfile.demographics || userProfile.demographics || {}
        } as UserProfile;
        setProfileForm(merged);
        setAvatarMedia(merged.avatarMediaId
          ? [createPersistedMediaDraftFromId(merged.avatarMediaId, 'PROFILE_AVATAR', merged.avatar)]
          : []);
        setCoverMedia(merged.coverMediaId
          ? [createPersistedMediaDraftFromId(merged.coverMediaId, 'PROFILE_COVER', merged.coverMedia?.src || '', 3)]
          : []);
        setLinkCount(merged.profileLinks?.length || 0);
        onUpdateProfile(merged);
      })
      .catch(() => {
        if (active) setPrivateProfileLoadError(t('profile.edit.loadFailed', { defaultValue: 'Some private profile details could not be loaded.' }));
      })
      .finally(() => {
        if (active) setIsPrivateProfileLoading(false);
      });
    return () => { active = false; };
  }, [userProfile.id]);

  const filteredNationalities = useMemo(() => {
    if (!nationalitySearch) return NATIONALITIES.slice(0, 5); // Default common/preview
    return NATIONALITIES.filter(n => n.toLowerCase().includes(nationalitySearch.toLowerCase())).slice(0, 10);
  }, [nationalitySearch]);

  const [settings, setSettings] = useState({
    searchVisibility: true,
    activityStatus: true,
    allowSharing: true,
    groupInvites: true,
    showGroups: true,
  });



  // ... inside component ...

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
  const avatarMediaChanged = nextAvatarMediaId !== (userProfile.avatarMediaId || null);
  const coverMediaChanged = nextCoverMediaId !== (userProfile.coverMediaId || null);
  const birthdayValidation = validateDateOfBirth(profileForm.birthday || null, {
    required: Boolean(userProfile.birthday),
    minimumAge: PROFILE_MIN_AGE,
    maximumAge: PROFILE_MAX_AGE
  });
  const hasProfileChanges = profileForm.name !== userProfile.name
    || profileForm.bio !== userProfile.bio
    || (profileForm.birthday || null) !== (userProfile.birthday || null)
    || avatarMediaChanged
    || coverMediaChanged;
  const profileMediaReady = mediaDraftsAreReady(avatarMedia)
    && mediaDraftsAreReady(coverMedia)
    && !mediaDraftsHaveErrors(avatarMedia)
    && !mediaDraftsHaveErrors(coverMedia);
  const profileFormIsValid = profileForm.name.trim().length > 0 && birthdayValidation.valid;
  const canSaveProfile = hasProfileChanges
    && profileFormIsValid
    && profileMediaReady
    && !isPrivateProfileLoading
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
    if (currentSubPage !== 'edit-profile' || !hasProfileChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [currentSubPage, hasProfileChanges]);

  const leaveEditProfile = (): void => {
    if (hasProfileChanges && !window.confirm(t('profile.edit.discardConfirm', { defaultValue: 'Discard your unsaved profile changes?' }))) return;
    setSaveError(null);
    setFieldErrors({});
    setProfileForm({ ...userProfile });
    setAvatarMedia(userProfile.avatarMediaId
      ? [createPersistedMediaDraftFromId(userProfile.avatarMediaId, 'PROFILE_AVATAR', userProfile.avatar)]
      : []);
    setCoverMedia(userProfile.coverMediaId
      ? [createPersistedMediaDraftFromId(userProfile.coverMediaId, 'PROFILE_COVER', userProfile.coverMedia?.src || '', 3)]
      : []);
    setCurrentSubPage('main');
  };

  const handleSave = async () => {
    const nextErrors: { name?: string; birthday?: string } = {};
    if (currentSubPage === 'edit-profile' && !profileForm.name.trim()) {
      nextErrors.name = t('profile.edit.nameRequired', { defaultValue: 'Name is required.' });
    }
    if (currentSubPage === 'edit-profile' && 'error' in birthdayValidation) {
      nextErrors.birthday = birthdayErrorMessage(birthdayValidation.error);
    }
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || (currentSubPage === 'edit-profile' && !canSaveProfile) || isSaving) return;

    setIsSaving(true);
    setSaveError(null);
    try {
      if (!userProfile.id) return;

      const profileEditPayload = {
        ...(avatarMediaChanged ? { avatarMediaId: nextAvatarMediaId || null } : {}),
        ...(coverMediaChanged ? { coverMediaId: nextCoverMediaId || null } : {}),
        ...((profileForm.birthday || null) !== (userProfile.birthday || null) ? { birthday: profileForm.birthday || null } : {}),
        expectedUpdatedAt: profileForm.updatedAt || userProfile.updatedAt,
        name: profileForm.name.trim(),
        bio: profileForm.bio
      };
      const settingsPayload = {
        ...profileEditPayload,
        language: profileForm.language,
        location: profileForm.location,
        website: profileForm.website,
        email: profileForm.email,
        phone: profileForm.phone,
        groupPrivacy: profileForm.groupPrivacy,
        isPrivate: profileForm.isPrivate,
        peopleTagPermission: profileForm.peopleTagPermission,
        demographics: {
          ...(userProfile.demographics || {}),
          ...(profileForm.demographics || {})
        }
      };
      const payload = deepStripUndefined(currentSubPage === 'edit-profile' ? profileEditPayload : settingsPayload);

      const updatedProfile = await api.updateUser(userProfile.id, payload);

      const merged: UserProfile = {
        ...userProfile,
        ...profileForm,
        ...updatedProfile,
        demographics: updatedProfile.demographics || payload.demographics
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
      setCurrentSubPage('main');
    } catch (error) {
      console.error("Failed to update profile", error);
      const message = error instanceof Error ? error.message : '';
      setSaveError(message.toLowerCase().includes('conflict') || message.toLowerCase().includes('changed')
        ? t('profile.edit.conflict', { defaultValue: 'Your profile changed elsewhere. Reload and try again.' })
        : t('profile.edit.saveFailed', { defaultValue: 'Your profile changes could not be saved. Check your connection and try again.' }));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') return;
    setIsDeleting(true);
    try {
      await api.deleteAccount(userProfile.id!);
      localStorage.removeItem('si_user');
      onLogout(); // This will clear session in parent App.tsx
      window.location.href = '/';
    } catch (error) {
      console.error("Failed to delete account:", error);
      alert("Failed to delete account. Please try again.");
    } finally {
      setIsDeleting(false);
      setShowDeleteModal(false);
    }
  };

  const toggleSetting = (key: keyof typeof settings) => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const updateDemographics = (key: keyof NonNullable<UserProfile['demographics']>, value: string) => {
    setProfileForm(prev => {
      const currentVal = prev.demographics?.[key];
      // If the clicked value is already selected, clear it (unselect)
      const newVal = currentVal === value ? '' : value;
      let extraUpdates: any = {};
      if (key === 'employment') {
        if (newVal === 'Unemployed' || newVal === 'Homemaker') {
          extraUpdates = { industry: 'Not Applicable', sector: 'Not Applicable' };
        } else if (currentVal === 'Unemployed' || currentVal === 'Homemaker') {
          if (prev.demographics?.industry === 'Not Applicable') {
            extraUpdates.industry = '';
          }
          if (prev.demographics?.sector === 'Not Applicable') {
            extraUpdates.sector = '';
          }
        }
      }
      return {
        ...prev,
        demographics: {
          ...(prev.demographics || {}),
          [key]: newVal,
          ...extraUpdates
        }
      };
    });
  };

  const SectionHeader = ({ title }: { title: string }) => (
    <h3 className="px-5 pt-6 pb-2 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">{title}</h3>
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
        {value && <p className="text-[10px] text-gray-400 font-medium truncate">{value}</p>}
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
        <span className="font-bold text-lg ms-2">{title}</span>
      </div>
      {showSave && (
        <button
          onClick={handleSave}
          disabled={isSaving || (currentSubPage === 'edit-profile' && !canSaveProfile)}
          className="flex min-h-11 min-w-20 items-center justify-center gap-2 bg-blue-600 text-white px-5 py-2 rounded-full text-xs font-black uppercase tracking-widest shadow-md shadow-blue-200 active:scale-95 transition-all disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          {isSaving && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
          {isSaving ? t('profile.edit.saving', { defaultValue: 'Saving...' }) : t('profile.edit.save', { defaultValue: 'Save' })}
        </button>
      )}
    </div>
  );

  if (currentSubPage === 'notifications-detailed') {
    return <NotificationSettingsScreen userId={userProfile.id} onBack={() => setCurrentSubPage('main')} />;
  }

  if (currentSubPage === 'links') {
    return (
      <ProfileLinksManager
        onBack={() => setCurrentSubPage('edit-profile')}
        onLinksChange={(links) => {
          setLinkCount(links.length);
          setProfileForm((current) => ({ ...current, profileLinks: links }));
          onUpdateProfile({ ...userProfile, profileLinks: links });
        }}
      />
    );
  }

  if (currentSubPage === 'demographics') {
    return (
      <div className="flex flex-col h-full bg-gray-50 animate-in slide-in-from-right duration-300">
        <PageHeader title="Demographic Info" />
        <div className="flex-1 overflow-y-auto pb-20 no-scrollbar">
                      <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm m-5 mb-6">
              <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">{t('Why we ask?')}</h4>
              <div className="text-sm text-gray-600 leading-relaxed space-y-4">
                <p>{t('Sharing demographic information helps you and post creators get more relevant and meaningful insights.')}</p>
                <p>{t('It also improves your experience and helps us keep the platform safe and fair.')}</p>
                <p>{t('Your data is anonymized and used in aggregate — never shared in a way that identifies you.')}</p>
                <p>
                  <button onClick={() => navigate('/privacy')} className="text-blue-600 hover:underline font-medium">
                    {t('Learn more in our Privacy Policy.')}
                  </button>
                </p>
              </div>
            </div>

          <div className="bg-white border-y border-gray-100">
            <SettingItem 
              icon={UserCircle} 
              label="Gender" 
              value={profileForm.demographics?.gender || 'Not specified'} 
              onClick={() => setActiveDemographicSelector({ id: 'gender', title: 'Gender', options: ['Male', 'Female', 'Prefer not to say'] })} 
            />
            
            {/* Age Group - Disabled/Auto calculated */}
            <div className="w-full flex items-center gap-4 px-5 py-3.5 bg-gray-50/50 border-b border-gray-50 text-left">
              <div className="p-2 rounded-xl bg-gray-100 text-gray-400">
                <Lock size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-500 flex items-center gap-2">
                  Age Group 
                  <span className="text-[8px] px-1.5 py-0.5 bg-gray-200 rounded text-gray-500 uppercase tracking-widest">Auto</span>
                </p>
                <p className="text-[10px] text-gray-400 font-medium truncate">{profileForm.demographics?.ageGroup || 'Not specified'}</p>
              </div>
            </div>

            <SettingItem 
              icon={Heart} 
              label="Marital Status" 
              value={profileForm.demographics?.maritalStatus || 'Not specified'} 
              onClick={() => setActiveDemographicSelector({ id: 'maritalStatus', title: 'Marital Status', options: ['Single', 'Engaged', 'Married', 'Widowed', 'Divorced', 'Separated', 'Prefer not to say'] })} 
            />
            
            <SettingItem 
              icon={GraduationCap} 
              label="Education Level" 
              value={profileForm.demographics?.education || 'Not specified'} 
              onClick={() => setActiveDemographicSelector({ id: 'education', title: 'Education Level', options: ['Primary Education', 'Preparatory / Middle School', 'Secondary Education (High School)', 'Diploma', 'Higher Diploma / Postgraduate Diploma', 'Bachelor’s Degree', 'Professional Diploma', 'Master’s Degree', 'Doctorate (PhD)', 'Prefer not to say'] })} 
            />

            <SettingItem 
              icon={Briefcase} 
              label="Employment Status" 
              value={profileForm.demographics?.employment || 'Not specified'} 
              onClick={() => setActiveDemographicSelector({ id: 'employment', title: 'Employment Status', options: ['Employed', 'Unemployed', 'Student', 'Retired', 'Homemaker', 'prefer not to specify'] })} 
            />

            {(profileForm.demographics?.employment !== 'Unemployed' && profileForm.demographics?.employment !== 'Homemaker') && (
              <>
                <SettingItem 
                  icon={Briefcase} 
                  label="Employment Type" 
                  value={profileForm.demographics?.industry || 'Not specified'} 
                  onClick={() => {
                    setActiveDemographicSelector({ id: 'industry', title: 'Employment Type', options: ['Government', 'Private Sector', 'Non-profit / NGO', 'Self-employed / Freelancer', 'Not Applicable', 'Prefer not to say'] });
                  }} 
                />

                <SettingItem 
                  icon={Briefcase} 
                  label="Employment Sector" 
                  value={profileForm.demographics?.sector || 'Not specified'} 
                  onClick={() => {
                    setActiveDemographicSelector({ id: 'sector', title: 'Employment Sector', options: ['Agriculture, Forestry, And Fishing', 'Mining', 'Construction', 'Manufacturing', 'Transportation, Communications, Electric, Gas, And Sanitary Services', 'Wholesale Trade', 'Retail Trade', 'Finance, Insurance, And Real Estate', 'Services', 'Public Administration', 'Not Applicable', 'Prefer Not To Specify'] });
                  }} 
                />
              </>
            )}

            <SettingItem 
              icon={Globe} 
              label="Nationality" 
              value={profileForm.demographics?.nationality || 'Not specified'} 
              onClick={() => setActiveDemographicSelector({ id: 'nationality', title: 'Nationality', options: [] })} 
            />
          </div>

          <div className="px-5 mt-6 pb-6">
             <div className="flex items-start gap-3 bg-blue-50 p-4 rounded-xl border border-blue-100 shadow-sm">
               <Shield size={18} className="shrink-0 text-blue-500 mt-0.5" />
               <p className="text-[10px] text-gray-600 font-medium leading-relaxed">
                 <strong className="text-gray-900 block mb-1 text-xs">Age Group Auto-calculation</strong>
                 Your age group is automatically calculated based on the Date of Birth provided during account registration to ensure context accuracy. It cannot be changed manually.
               </p>
             </div>
          </div>
        </div>

        <BottomSheet isOpen={!!activeDemographicSelector} onClose={() => setActiveDemographicSelector(null)} title={activeDemographicSelector?.title || ''}>
          <div className="flex flex-col h-[70vh] bg-gray-50 rounded-t-3xl border-t border-gray-100 overflow-hidden">
            {activeDemographicSelector?.id === 'nationality' ? (
              <div className="flex flex-col h-full bg-white rounded-t-3xl pb-8">
                <div className="px-4 py-3 border-b border-gray-100 bg-white">
                  <div className="relative">
                    <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={nationalitySearch}
                      onChange={(e) => setNationalitySearch(e.target.value)}
                      placeholder="Search your country..."
                      className="w-full bg-gray-50 border-none rounded-xl pl-11 pr-4 py-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/10 transition-all"
                    />
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-2 no-scrollbar">
                   {profileForm.demographics?.nationality && !nationalitySearch && (
                      <button
                        onClick={() => {
                          updateDemographics('nationality', profileForm.demographics!.nationality!);
                          setActiveDemographicSelector(null);
                        }}
                        className="w-full py-4 px-5 rounded-2xl text-sm font-bold border-2 text-left flex justify-between items-center bg-blue-50 border-blue-600 text-blue-700 mb-4"
                      >
                        {profileForm.demographics.nationality}
                        <Check size={18} strokeWidth={3} />
                      </button>
                    )}
                  {filteredNationalities.map(n => (
                    <button
                      key={n}
                      onClick={() => {
                        updateDemographics('nationality', n);
                        setActiveDemographicSelector(null);
                      }}
                      className={`w-full py-4 px-5 rounded-2xl text-sm font-bold border-2 text-left flex justify-between items-center transition-all ${profileForm.demographics?.nationality === n ? 'hidden' : 'bg-white text-gray-700 border-gray-100 hover:border-gray-200'}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col h-full bg-white rounded-t-3xl pb-8">
                <div className="flex-1 overflow-y-auto p-4 space-y-2 no-scrollbar">
                  {activeDemographicSelector?.options.map(opt => (
                    <button
                      key={opt}
                      onClick={() => {
                        updateDemographics(activeDemographicSelector.id, opt);
                        setActiveDemographicSelector(null);
                      }}
                      className={`w-full py-4 px-5 rounded-2xl text-sm font-bold border-2 text-left flex justify-between items-center transition-all ${profileForm.demographics?.[activeDemographicSelector.id] === opt ? 'bg-blue-50 border-blue-600 text-blue-700' : 'bg-white text-gray-700 border-gray-100 hover:border-gray-200'}`}
                    >
                      {opt}
                      {profileForm.demographics?.[activeDemographicSelector.id] === opt && <Check size={18} strokeWidth={3} />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </BottomSheet>
      </div>
    );
  }

  if (currentSubPage === 'edit-profile') {
    return (
      <div className="flex flex-col h-full bg-gray-50 animate-in slide-in-from-right duration-300">
        <PageHeader title={t('profile.edit.title', { defaultValue: 'Edit Profile' })} />
        <div className="flex-1 overflow-y-auto pb-10 no-scrollbar">
          <div className="relative">
            <MediaPicker
              ref={coverPickerRef}
              purpose="PROFILE_COVER"
              value={coverMedia}
              onChange={setCoverMedia}
              aspectRatio={3}
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
                    {current?.previewUrl ? (
                      <img
                        src={current.previewUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        style={{ objectPosition }}
                      />
                    ) : current?.assetId ? (
                      <MediaImage
                        mediaId={current.assetId}
                        media={current.presentation}
                        alt=""
                        sizes="(max-width: 768px) 100vw, 768px"
                        useFocalPoint
                        className="h-full w-full object-cover"
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
                      disabled={isSaving || isBusy}
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
              onChange={setAvatarMedia}
              renderContent={({ open, retry, busy }) => {
                const current = avatarMedia[0];
                const previewUrl = current?.previewUrl || profileForm.avatar;
                return (
                  <div className="relative">
                    <div className={`w-24 h-24 rounded-[22%] border-4 border-white shadow-lg overflow-hidden bg-gray-100 ${current?.status === 'error' ? 'ring-2 ring-red-400' : ''}`}>
                      {previewUrl ? (
                        <img src={previewUrl} alt={profileForm.name || t('profile.avatar.alt', { defaultValue: 'Profile photo' })} className="w-full h-full object-cover" />
                      ) : current?.assetId ? (
                        <MediaImage mediaId={current.assetId} media={current.presentation} alt={profileForm.name || t('profile.avatar.alt', { defaultValue: 'Profile photo' })} sizes="96px" className="h-full w-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xl font-bold text-gray-500">
                          {(profileForm.name || 'U').trim().charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => current?.status === 'error' ? retry(current.clientId) : open()}
                      disabled={busy}
                      className="absolute -bottom-1 -end-1 flex h-11 w-11 items-center justify-center bg-blue-600 text-white rounded-2xl border-[3px] border-white shadow-md active:scale-90 transition-transform disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
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
              <div role="alert" className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <Info size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{privateProfileLoadError}</span>
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

  if (currentSubPage === 'group-privacy') {
    return (
      <div className="flex flex-col h-full bg-gray-50 animate-in slide-in-from-right duration-300">
        <PageHeader title="Group Privacy" showSave={false} />
        <div className="flex-1 overflow-y-auto px-5 py-6 space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm mb-6">
            <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Who can see your groups?</h4>
            <p className="text-sm text-gray-600 leading-relaxed">
              Choose who can see the groups you've joined on your profile page.
            </p>
          </div>
          {['Public', 'Followers', 'Off'].map(opt => {
            const isSelected = (profileForm.groupPrivacy || 'Public') === opt;
            const label = opt === 'Followers' ? 'Followers Only' : opt;
            return (
              <button
                key={opt}
                onClick={() => {
                  setProfileForm({ ...profileForm, groupPrivacy: opt as any });
                  setCurrentSubPage('main');
                }}
                className={`w-full flex items-center justify-between p-4 bg-white rounded-2xl border transition-all ${isSelected ? 'border-blue-600 shadow-sm' : 'border-gray-100'}`}
              >
                <span className={`font-bold ${isSelected ? 'text-blue-600' : 'text-gray-900'}`}>{label}</span>
                {isSelected && <Check className="text-blue-600" size={20} strokeWidth={3} />}
              </button>
            )
          })}
        </div>
      </div>
    );
  }

  if (currentSubPage === 'account-privacy') {
    const peopleTagOptions: Array<{
      value: NonNullable<UserProfile['peopleTagPermission']>;
      label: string;
    }> = [
      { value: 'EVERYONE', label: t('Everyone') },
      { value: 'FOLLOWING', label: t('People you follow') },
      { value: 'NO_ONE', label: t('No one') }
    ];

    return (
      <div className="flex flex-col h-full bg-gray-50 animate-in slide-in-from-right duration-300">
        <PageHeader title={t('Account privacy')} showSave={false} />
        <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6">
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <span className="text-base font-bold text-gray-900">{t('Private account')}</span>
              <div 
                className={`w-12 h-6 rounded-full transition-colors cursor-pointer relative ${profileForm.isPrivate ? 'bg-blue-600' : 'bg-gray-200'}`}
                onClick={async () => {
                  const newVal = !profileForm.isPrivate;
                  if (!newVal) {
                    const confirmPublic = window.confirm(t('Switching to Public will automatically accept all pending follow requests. Do you want to continue?'));
                    if (!confirmPublic) return;
                  }
                  
                  setProfileForm({ ...profileForm, isPrivate: newVal });
                  try {
                    await api.updateUser(userProfile.id, { isPrivate: newVal });
                    onUpdateProfile({ ...userProfile, isPrivate: newVal });
                  } catch (e) {
                    console.error('Failed to update privacy', e);
                    setProfileForm({ ...profileForm, isPrivate: !newVal }); // revert
                  }
                }}
              >
                <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${profileForm.isPrivate ? 'translate-x-6' : 'translate-x-0'}`} />
              </div>
            </div>
            
            <p className="text-sm text-gray-500 leading-relaxed mb-4">
              {t("When your account is public, your profile and posts can be seen by anyone, on or off SocialInsight, even if they don't have a SocialInsight account.")}
            </p>
            <p className="text-sm text-gray-500 leading-relaxed">
              {t("When your account is private, only the followers you approve can see what you share, including your polls and responses, and your followers and following lists. Certain info on your profile, like your profile picture and username, is visible to everyone on and off SocialInsight.")}
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
            <h2 className="text-base font-bold text-gray-900 mb-2">{t('Who can tag you in posts?')}</h2>
            <p className="text-sm text-gray-500 leading-relaxed mb-4">
              {t('Choose who can add your profile as a people tag. Text mentions are controlled separately.')}
            </p>
            <div role="radiogroup" aria-label={t('Who can tag you in posts?')} className="divide-y divide-gray-100">
              {peopleTagOptions.map((option) => {
                const isSelected = (profileForm.peopleTagPermission || 'EVERYONE') === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    disabled={isSaving}
                    onClick={async () => {
                      if (isSelected || !userProfile.id) return;

                      const previousValue = profileForm.peopleTagPermission || 'EVERYONE';
                      setProfileForm((current) => ({ ...current, peopleTagPermission: option.value }));
                      setIsSaving(true);
                      try {
                        const updatedProfile = await api.updateUser(userProfile.id, {
                          peopleTagPermission: option.value
                        });
                        const merged = {
                          ...userProfile,
                          ...updatedProfile,
                          peopleTagPermission: option.value
                        };
                        setProfileForm((current) => ({ ...current, ...updatedProfile, peopleTagPermission: option.value }));
                        onUpdateProfile(merged);
                      } catch (error) {
                        console.error('Failed to update people tag privacy', error);
                        setProfileForm((current) => ({ ...current, peopleTagPermission: previousValue }));
                        alert(t('Failed to update people tag privacy'));
                      } finally {
                        setIsSaving(false);
                      }
                    }}
                    className="w-full min-h-12 flex items-center justify-between py-3 text-start disabled:opacity-60"
                  >
                    <span className={`text-sm font-semibold ${isSelected ? 'text-blue-600' : 'text-gray-800'}`}>
                      {option.label}
                    </span>
                    <span
                      aria-hidden="true"
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${isSelected ? 'border-blue-600' : 'border-gray-300'}`}
                    >
                      {isSelected && <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (currentSubPage === 'language') {
    const languages = [
      { code: 'en', label: 'English', native: 'English' },
      { code: 'ar', label: 'Arabic', native: 'العربية' },
      { code: 'zh', label: 'Chinese', native: '中文' },
      { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
      { code: 'ur', label: 'Urdu', native: 'اردو' },
      { code: 'tr', label: 'Turkish', native: 'Türkçe' }
    ];

    const currentLang = profileForm.language || 'en';

    return (
      <div className="flex flex-col h-full bg-gray-50 animate-in slide-in-from-right duration-300">
        <PageHeader title="Language" showSave={false} />
        <div className="flex-1 overflow-y-auto px-5 py-6 space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm mb-6">
            <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">App Language</h4>
            <p className="text-sm text-gray-600 leading-relaxed">
              Choose your preferred language for the application interface.
            </p>
          </div>
          {languages.map(lang => {
            const isSelected = currentLang === lang.code;
            return (
              <button
                key={lang.code}
                onClick={() => {
                  const updatedProfile = { ...profileForm, language: lang.code };
                  setProfileForm(updatedProfile);
                  onUpdateProfile(updatedProfile);
                  setCurrentSubPage('main');
                  i18n.changeLanguage(lang.code);
                }}
                className={`w-full flex items-center justify-between p-4 bg-white rounded-2xl border transition-all ${isSelected ? 'border-blue-600 shadow-sm' : 'border-gray-100'}`}
              >
                <div className="flex flex-col items-start">
                   <span className={`font-bold ${isSelected ? 'text-blue-600' : 'text-gray-900'}`}>{lang.native}</span>
                   <span className="text-xs text-gray-400">{lang.label}</span>
                </div>
                {isSelected && <Check className="text-blue-600" size={20} strokeWidth={3} />}
              </button>
            )
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 animate-in slide-in-from-right duration-300 z-50">
      <div className="bg-white border-b border-gray-100 flex items-center px-4 h-14 sticky top-0 z-30">
        <button onClick={onBack} className="p-2 -ml-2 text-gray-600 hover:bg-gray-50 rounded-full transition-colors">
          <ArrowLeft size={24} />
        </button>
        <span className="font-bold text-lg ml-2">{t('Settings')}</span>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar pb-10">
        <SectionHeader title={t('Account')} />
        <div className="bg-white border-y border-gray-100 shadow-sm">
          <SettingItem
            icon={User}
            label={t('Edit Profile')}
            value={`${profileForm.name}, Bio, Links`}
            onClick={() => setCurrentSubPage('edit-profile')}
          />
          <SettingItem
            icon={MapPin}
            label={t('Demographic Info')}
            value="Gender, Age, Education, Status"
            onClick={() => setCurrentSubPage('demographics')}
          />
          <SettingItem
            icon={Bell}
            label={t('Notification Settings')}
            value="Likes, Comments, Shares, Activity"
            onClick={() => setCurrentSubPage('notifications-detailed')}
          />
          <SettingItem
            icon={Languages}
            label={t('Language')}
            value={profileForm.language}
            onClick={() => setCurrentSubPage('language')}
          />
        </div>

        <SectionHeader title={t('Privacy & Social')} />
        <div className="bg-white border-y border-gray-100 shadow-sm">
          <SettingItem
            icon={Lock}
            label={t('Account privacy')}
            value={profileForm.isPrivate ? t('Private') : t('Public')}
            onClick={() => setCurrentSubPage('account-privacy')}
          />
          <SettingItem
            icon={Search}
            label={t('Show my profile in search')}
            type="toggle"
            active={settings.searchVisibility}
            onClick={() => toggleSetting('searchVisibility')}
          />
          <SettingItem
            icon={Activity}
            label={t('Show my activity status')}
            type="toggle"
            active={settings.activityStatus}
            onClick={() => toggleSetting('activityStatus')}
          />
        </div>

        <SectionHeader title={t('Content & Groups')} />
        <div className="bg-white border-y border-gray-100 shadow-sm">
          <SettingItem
            icon={Share2}
            label={t('Allow others to share my content')}
            type="toggle"
            active={settings.allowSharing}
            onClick={() => toggleSetting('allowSharing')}
          />
          <SettingItem
            icon={Mail}
            label={t('Allow group invitations')}
            type="toggle"
            active={settings.groupInvites}
            onClick={() => toggleSetting('groupInvites')}
          />
          <SettingItem
            icon={Smartphone}
            label={t('Show my groups on profile')}
            value={(profileForm.groupPrivacy === 'Followers' ? 'Followers Only' : profileForm.groupPrivacy) || 'Public'}
            onClick={() => setCurrentSubPage('group-privacy')}
          />
        </div>

        <SectionHeader title={t('Support & Legal')} />
        <div className="bg-white border-y border-gray-100 shadow-sm">
          <SettingItem icon={LifeBuoy} label={t('Help Center')} />
          <SettingItem icon={Shield} label={t('Privacy Policy')} onClick={() => navigate('/privacy')} />
        </div>

        <SectionHeader title={t('Danger Zone')} />
        <div className="bg-white border-y border-gray-100 shadow-sm">
          <SettingItem
            icon={Trash2}
            label={t('Delete account')}
            type="danger"
            onClick={() => setShowDeleteModal(true)}
          />
        </div>

        <div className="mt-8 px-4 pb-12">
          <button
            onClick={() => setShowLogoutConfirm(true)}
            className="w-full bg-white border border-gray-200 text-red-600 py-4 rounded-2xl font-black uppercase tracking-widest text-[10px] active:scale-95 transition-all flex items-center justify-center gap-2 shadow-sm"
          >
            <LogOut size={14} /> {t('Log Out')}
          </button>
        </div>
      </div>

      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-white rounded-[2.5rem] p-8 w-full max-sm shadow-2xl animate-in zoom-in-95 duration-200 text-center">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <LogOut size={32} />
            </div>
            <h3 className="text-xl font-black text-gray-900 mb-2">{t('Log out of your account?')}</h3>
            <p className="text-sm text-gray-500 mb-8 leading-relaxed">
              {t('Are you sure you want to log out?')}
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={onLogout}
                className="w-full py-4 bg-red-600 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] active:scale-95 transition-all"
              >
                {t('Log Out')}
              </button>
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="w-full py-4 bg-gray-100 text-gray-600 rounded-2xl font-black uppercase tracking-widest text-[10px] active:scale-95 transition-all"
              >
                {t('Cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteModal && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-white rounded-[2.5rem] p-8 w-full max-sm shadow-2xl animate-in zoom-in-95 duration-200 text-center">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <AlertTriangle size={32} />
            </div>
            <h3 className="text-xl font-black text-gray-900 mb-2">Delete Account?</h3>
            <p className="text-sm text-gray-500 mb-4 leading-relaxed">
              This action is <span className="font-bold text-red-500">irreversible</span>. All your personal data, likes, and follows will be permanently removed. Your posts will remain but will be anonymized.
            </p>
            <div className="mb-6">
              <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mb-2">Type "DELETE" to confirm</p>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE"
                className="w-full text-center bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all uppercase"
              />
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleDeleteAccount}
                disabled={deleteConfirmText !== 'DELETE' || isDeleting}
                className="w-full py-4 bg-red-600 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] active:scale-95 transition-all disabled:opacity-50"
              >
                {isDeleting ? 'Deleting...' : 'Permanently Delete'}
              </button>
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteConfirmText('');
                }}
                disabled={isDeleting}
                className="w-full py-4 bg-gray-100 text-gray-600 rounded-2xl font-black uppercase tracking-widest text-[10px] active:scale-95 transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
