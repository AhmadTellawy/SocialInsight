
import React, { useState, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft, User, Mail, Globe, Lock, Eye, Search, Activity,
  Share2, Users, Bell, Palette, Shield, LifeBuoy, LogOut,
  Trash2, ChevronRight, Check, AlertTriangle, Smartphone,
  Languages, Type, MessageSquare, UserPlus, Camera, Edit3, Save,
  X, Briefcase, GraduationCap, Heart, UserCircle, MapPin, Hash
} from 'lucide-react';
import { ImageCropper } from './ImageCropper';
import { BottomSheet } from './BottomSheet';
import { UserProfile } from '../types';
import { NotificationSettingsScreen } from './NotificationSettingsScreen';
import { api } from '../services/api';
import { useTranslation } from 'react-i18next';

interface ProfileSettingsScreenProps {
  userProfile: UserProfile;
  onUpdateProfile: (profile: UserProfile) => void;
  onBack: () => void;
  onLogout: () => void;
}

type SubPage = 'main' | 'edit-profile' | 'username' | 'email-phone' | 'language' | 'privacy' | 'content-visibility' | 'demographics' | 'notifications-detailed' | 'group-privacy';

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

export const ProfileSettingsScreen: React.FC<ProfileSettingsScreenProps> = ({
  userProfile,
  onUpdateProfile,
  onBack,
  onLogout
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { i18n } = useTranslation();
  const subPageMatch = location.pathname.split('/settings/profile/')[1];
  const currentSubPage = (subPageMatch as SubPage) || 'main';

  const setCurrentSubPage = (page: SubPage) => {
    if (page === 'main') {
      navigate('/settings/profile');
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

  // Image Flow State
  const [croppingImage, setCroppingImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeDemographicSelector, setActiveDemographicSelector] = useState<{
    id: keyof NonNullable<UserProfile['demographics']>;
    title: string;
    options: string[];
  } | null>(null);

  const getCalculatedAgeGroup = (profile: UserProfile): string => {
    let ageGroup = profile.demographics?.ageGroup || '';
    if (!ageGroup && profile.birthday) {
      const bd = new Date(profile.birthday);
      if (!isNaN(bd.getTime())) {
        let age = new Date().getFullYear() - bd.getFullYear();
        const m = new Date().getMonth() - bd.getMonth();
        if (m < 0 || (m === 0 && new Date().getDate() < bd.getDate())) age--;
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
    setProfileForm({
      ...userProfile,
      demographics: userProfile.demographics || {
        gender: '',
        ageGroup: getCalculatedAgeGroup(userProfile),
        maritalStatus: '',
        education: '',
        employment: '',
        nationality: ''
      }
    });
  }, [userProfile]);

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

  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (!userProfile.id) return;

      const payload = deepStripUndefined({
        avatar: profileForm.avatar,
        name: profileForm.name,
        bio: profileForm.bio,
        language: profileForm.language,
        location: profileForm.location,
        website: profileForm.website,
        email: profileForm.email,
        phone: profileForm.phone,
        groupPrivacy: profileForm.groupPrivacy,
        demographics: {
          ...(userProfile.demographics || {}),
          ...(profileForm.demographics || {})
        }
      });

      await api.updateUser(userProfile.id, payload);

      // Update parent with merged object (not the payload only)
      const merged: UserProfile = {
        ...userProfile,
        ...payload,
        demographics: payload.demographics
      };

      onUpdateProfile(merged);
    } catch (error) {
      console.error("Failed to update profile", error);
      alert("Failed to save profile changes");
    } finally {
      setIsSaving(false);
      setCurrentSubPage('main');
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

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const img = new Image();
      const objUrl = URL.createObjectURL(file);
      img.onload = () => {
        const MAX_DIMENSION = 1200;
        let width = img.width;
        let height = img.height;

        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
            const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            setCroppingImage(canvas.toDataURL('image/jpeg', 0.8));
        } else {
            // fallback
            const reader = new FileReader();
            reader.onloadend = () => setCroppingImage(reader.result as string);
            reader.readAsDataURL(file);
        }
        URL.revokeObjectURL(objUrl);
        if (fileInputRef.current) fileInputRef.current.value = '';
      };
      img.src = objUrl;
    }
  };

  const handleCropComplete = (croppedImg: string) => {
    setProfileForm(prev => ({ ...prev, avatar: croppedImg }));
    setCroppingImage(null);
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
      className="w-full flex items-center gap-4 px-5 py-3.5 bg-white hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0 text-left"
    >
      <div className={`p-2 rounded-xl ${type === 'danger' ? 'bg-red-50 text-red-500' : 'bg-gray-100 text-gray-500'}`}>
        <Icon size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-bold ${type === 'danger' ? 'text-red-600' : 'text-gray-900'}`}>{label}</p>
        {value && <p className="text-[10px] text-gray-400 font-medium truncate">{value}</p>}
      </div>
      {type === 'navigate' && <ChevronRight size={16} className="text-gray-300" />}
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
        <button onClick={() => setCurrentSubPage('main')} className="p-2 -ml-2 text-gray-600 hover:bg-gray-50 rounded-full transition-colors">
          <ArrowLeft size={24} />
        </button>
        <span className="font-bold text-lg ml-2">{title}</span>
      </div>
      {showSave && (
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="bg-blue-600 text-white px-5 py-1.5 rounded-full text-xs font-black uppercase tracking-widest shadow-md shadow-blue-200 active:scale-95 transition-all disabled:opacity-50"
        >
          {isSaving ? '...' : 'Save'}
        </button>
      )}
    </div>
  );

  if (currentSubPage === 'notifications-detailed') {
    return <NotificationSettingsScreen userId={userProfile.id} onBack={() => setCurrentSubPage('main')} />;
  }

  if (currentSubPage === 'demographics') {
    return (
      <div className="flex flex-col h-full bg-gray-50 animate-in slide-in-from-right duration-300">
        <PageHeader title="Demographic Info" />
        <div className="flex-1 overflow-y-auto pb-20 no-scrollbar">
          <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm m-5 mb-6">
            <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Why we ask?</h4>
            <p className="text-sm text-gray-600 leading-relaxed">
              Providing demographic information helps survey creators understand the context of your responses. Your personal data is always anonymized when participating in surveys.
            </p>
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
        <PageHeader title="Edit Profile" />
        <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6">
          <div className="flex flex-col items-center">
            <div className="relative">
              <div className="w-24 h-24 rounded-full border-4 border-white shadow-sm overflow-hidden bg-gray-100">
                <img src={profileForm.avatar} alt="Profile" className="w-full h-full object-cover" />
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute bottom-0 right-0 p-2 bg-blue-600 text-white rounded-full border-2 border-white shadow-md active:scale-90 transition-transform"
              >
                <Camera size={14} />
              </button>
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/*"
                onChange={handleImageUpload}
              />
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Display Name</label>
              <input
                type="text"
                value={profileForm.name}
                onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                className="w-full bg-white border border-gray-100 rounded-2xl px-4 py-3.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 transition-all shadow-sm"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Bio</label>
              <textarea
                rows={4}
                value={profileForm.bio}
                onChange={(e) => setProfileForm({ ...profileForm, bio: e.target.value })}
                className="w-full bg-white border border-gray-100 rounded-2xl px-4 py-3.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 transition-all shadow-sm resize-none"
              />
            </div>
          </div>
        </div>
        {croppingImage && (
          <ImageCropper
            imageSrc={croppingImage}
            onCrop={handleCropComplete}
            onCancel={() => setCroppingImage(null)}
          />
        )}
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
                  setProfileForm({ ...profileForm, language: lang.code });
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
        <span className="font-bold text-lg ml-2">Settings</span>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar pb-10">
        <SectionHeader title="Account" />
        <div className="bg-white border-y border-gray-100 shadow-sm">
          <SettingItem
            icon={User}
            label="Edit Profile"
            value={`${profileForm.name}, Bio, Links`}
            onClick={() => setCurrentSubPage('edit-profile')}
          />
          <SettingItem
            icon={MapPin}
            label="Demographic Info"
            value="Gender, Age, Education, Status"
            onClick={() => setCurrentSubPage('demographics')}
          />
          <SettingItem
            icon={Bell}
            label="Notification Settings"
            value="Likes, Comments, Shares, Activity"
            onClick={() => setCurrentSubPage('notifications-detailed')}
          />
          <SettingItem
            icon={Languages}
            label="Language"
            value={profileForm.language}
            onClick={() => setCurrentSubPage('language')}
          />
        </div>

        <SectionHeader title="Privacy & Social" />
        <div className="bg-white border-y border-gray-100 shadow-sm">
          <SettingItem
            icon={Search}
            label="Show my profile in search"
            type="toggle"
            active={settings.searchVisibility}
            onClick={() => toggleSetting('searchVisibility')}
          />
          <SettingItem
            icon={Activity}
            label="Show my activity status"
            type="toggle"
            active={settings.activityStatus}
            onClick={() => toggleSetting('activityStatus')}
          />
        </div>

        <SectionHeader title="Content & Groups" />
        <div className="bg-white border-y border-gray-100 shadow-sm">
          <SettingItem
            icon={Share2}
            label="Allow others to share my content"
            type="toggle"
            active={settings.allowSharing}
            onClick={() => toggleSetting('allowSharing')}
          />
          <SettingItem
            icon={Mail}
            label="Allow group invitations"
            type="toggle"
            active={settings.groupInvites}
            onClick={() => toggleSetting('groupInvites')}
          />
          <SettingItem
            icon={Smartphone}
            label="Show my groups on profile"
            value={(profileForm.groupPrivacy === 'Followers' ? 'Followers Only' : profileForm.groupPrivacy) || 'Public'}
            onClick={() => setCurrentSubPage('group-privacy')}
          />
        </div>

        <SectionHeader title="Support & Legal" />
        <div className="bg-white border-y border-gray-100 shadow-sm">
          <SettingItem icon={LifeBuoy} label="Help Center" />
          <SettingItem icon={Shield} label="Privacy Policy" onClick={() => navigate('/privacy')} />
        </div>

        <SectionHeader title="Danger Zone" />
        <div className="bg-white border-y border-gray-100 shadow-sm">
          <SettingItem
            icon={Trash2}
            label="Delete account"
            type="danger"
            onClick={() => setShowDeleteModal(true)}
          />
        </div>

        <div className="mt-8 px-4 pb-12">
          <button
            onClick={() => setShowLogoutConfirm(true)}
            className="w-full bg-white border border-gray-200 text-red-600 py-4 rounded-2xl font-black uppercase tracking-widest text-[10px] active:scale-95 transition-all flex items-center justify-center gap-2 shadow-sm"
          >
            <LogOut size={14} /> Log Out
          </button>
        </div>
      </div>

      {showLogoutConfirm && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-white rounded-[2.5rem] p-8 w-full max-sm shadow-2xl animate-in zoom-in-95 duration-200 text-center">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <LogOut size={32} />
            </div>
            <h3 className="text-xl font-black text-gray-900 mb-2">Log out?</h3>
            <p className="text-sm text-gray-500 mb-8 leading-relaxed">
              Are you sure you want to log out of your account?
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={onLogout}
                className="w-full py-4 bg-red-600 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] active:scale-95 transition-all"
              >
                Log Out
              </button>
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="w-full py-4 bg-gray-100 text-gray-600 rounded-2xl font-black uppercase tracking-widest text-[10px] active:scale-95 transition-all"
              >
                Cancel
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
