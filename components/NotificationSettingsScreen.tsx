import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft, MessageSquare, Repeat, Users, Mail } from 'lucide-react';

export interface NotificationSettingsScreenProps {
  userId: string;
  onBack: () => void;
}

export type TriOption = 'everyone' | 'following' | 'off';

export interface NotificationSettings {
  myPosts: {
    likes: TriOption;
    comments: TriOption;
    shares: TriOption;
  };
  sharedPosts: {
    likes: TriOption;
    comments: TriOption;
    shares: TriOption;
  };
  toggles: {
    activityFollowed: boolean;
    invitations: boolean;
    commentInteractions: boolean;
    newFollowers: boolean;
    emailNotifications: boolean;
  };
}

const DEFAULT_SETTINGS: NotificationSettings = {
  myPosts: {
    likes: 'everyone',
    comments: 'everyone',
    shares: 'following',
  },
  sharedPosts: {
    likes: 'following',
    comments: 'following',
    shares: 'off',
  },
  toggles: {
    activityFollowed: true,
    invitations: true,
    commentInteractions: true,
    newFollowers: true,
    emailNotifications: false,
  },
};

const CACHE_KEY = 'notif_settings_v1';
const META_KEY = 'notif_settings_meta_v1';

const isValidSettings = (parsed: any): parsed is NotificationSettings => {
  if (!parsed || typeof parsed !== 'object') return false;
  if (!parsed.myPosts || typeof parsed.myPosts !== 'object') return false;
  if (!parsed.sharedPosts || typeof parsed.sharedPosts !== 'object') return false;
  if (!parsed.toggles || typeof parsed.toggles !== 'object') return false;

  const validTri = (val: any) => ['everyone', 'following', 'off'].includes(val);
  // ... (basic shape validation is enough)

  return true;
};

const saveLocal = (userId: string, settings: NotificationSettings, updatedAt: string) => {
  try {
    localStorage.setItem(`${CACHE_KEY}_${userId}`, JSON.stringify(settings));
    localStorage.setItem(`${META_KEY}_${userId}`, JSON.stringify({ updatedAt }));
  } catch (err) {
    // Ignore storage errors
  }
};

const getLocalUpdatedAt = (userId: string): string | null => {
  try {
    const meta = JSON.parse(localStorage.getItem(`${META_KEY}_${userId}`) || '{}');
    return meta.updatedAt || null;
  } catch {
    return null;
  }
};

async function apiGetSettings(userId: string): Promise<{ settings: NotificationSettings; updatedAt: string } | null> {
  const res = await fetch('http://localhost:3001/api/notification-settings', {
    headers: { 'x-user-id': userId },
    credentials: 'omit'
  });
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) throw new Error('Failed to fetch settings');
  return res.json();
}

async function apiPutSettings(userId: string, payload: { settings: NotificationSettings; updatedAt: string }): Promise<{ settings: NotificationSettings; updatedAt: string }> {
  const res = await fetch('http://localhost:3001/api/notification-settings', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': userId
    },
    body: JSON.stringify(payload),
    credentials: 'omit' // use internal handling, omit avoids some local dev CORS issues depending on setup
  });
  if (!res.ok) throw new Error('Failed to update settings');
  return res.json();
}

interface TriChoiceProps {
  label: string;
  description: string;
  value: TriOption;
  onChange: (val: TriOption) => void;
}

const TriChoice = React.memo(({ label, description, value, onChange }: TriChoiceProps) => (
  <div className="py-5 border-b border-gray-50 last:border-0 px-5 bg-white">
    <div className="flex justify-between items-start mb-3">
      <div className="flex-1 pr-4">
        <h4 className="text-sm font-bold text-gray-900">{label}</h4>
        <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">{description}</p>
      </div>
    </div>
    <div className="flex bg-gray-100 p-1 rounded-xl gap-1">
      {[
        { id: 'everyone', label: 'Everyone' },
        { id: 'following', label: 'Following' },
        { id: 'off', label: 'Off' }
      ].map((opt) => (
        <button
          key={opt.id}
          onClick={() => onChange(opt.id as TriOption)}
          aria-pressed={value === opt.id}
          className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${value === opt.id
            ? 'bg-white text-blue-600 shadow-sm'
            : 'text-gray-400 hover:text-gray-600'
            }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  </div>
));

TriChoice.displayName = 'TriChoice';

interface ToggleRowProps {
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
}

const ToggleRow = React.memo(({ label, description, active, onClick }: ToggleRowProps) => (
  <button
    onClick={onClick}
    aria-pressed={active}
    className="w-full flex items-center justify-between py-4 px-5 bg-white border-b border-gray-50 last:border-0 text-left hover:bg-gray-50 transition-colors"
  >
    <div className="flex-1 pr-4">
      <h4 className="text-sm font-bold text-gray-900">{label}</h4>
      <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed whitespace-pre-wrap">{description}</p>
    </div>
    <div className={`w-10 h-5 rounded-full relative transition-colors shrink-0 ${active ? 'bg-blue-600' : 'bg-gray-200'}`}>
      <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all shadow-sm ${active ? 'left-6' : 'left-1'}`} />
    </div>
  </button>
));

ToggleRow.displayName = 'ToggleRow';

interface SectionHeaderProps {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  onApplyAll?: (val: TriOption) => void;
}

const SectionHeader = ({ title, icon: Icon, onApplyAll }: SectionHeaderProps) => (
  <div className="px-5 pt-8 pb-3">
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-2">
        <Icon size={14} className="text-blue-600" />
        <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">{title}</h3>
      </div>
    </div>
    {onApplyAll && (
      <div className="flex items-center gap-2 bg-blue-50/50 p-2 rounded-xl border border-blue-100/50">
        <span className="text-[9px] font-bold text-blue-600 uppercase tracking-tight ml-1 mr-auto">Apply same to all:</span>
        <div className="flex gap-1">
          {(['everyone', 'following', 'off'] as TriOption[]).map((v) => (
            <button
              key={v}
              onClick={() => onApplyAll(v)}
              className="px-2 py-1 bg-white border border-blue-100 rounded-lg text-[9px] font-black text-blue-600 uppercase hover:bg-blue-600 hover:text-white transition-all active:scale-95"
            >
              {v}
            </button>
          ))}
        </div>
      </div>
    )}
  </div>
);

export const NotificationSettingsScreen: React.FC<NotificationSettingsScreenProps> = ({ userId, onBack }) => {
  const [settings, setSettings] = useState<NotificationSettings>(() => {
    try {
      const saved = localStorage.getItem(`${CACHE_KEY}_${userId}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (isValidSettings(parsed)) return parsed;
      }
    } catch { }
    return DEFAULT_SETTINGS;
  });

  const [updatedAt, setUpdatedAt] = useState<string>(() => {
    return getLocalUpdatedAt(userId) || new Date().toISOString();
  });

  const [syncStatus, setSyncStatus] = useState<'idle' | 'saving' | 'saved' | 'offline'>('idle');
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const performSync = useCallback(async (currentSettings: NotificationSettings, currentUpdated: string) => {
    if (!navigator.onLine) {
      setSyncStatus('offline');
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setSyncStatus('saving');
    try {
      await apiPutSettings(userId, { settings: currentSettings, updatedAt: currentUpdated });
      setSyncStatus('saved');
      setTimeout(() => setSyncStatus('idle'), 1500);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setSyncStatus('offline');
      }
    }
  }, []);

  const scheduleSync = useCallback((newSettings: NotificationSettings, timestamp: string) => {
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);

    setSyncStatus('saving');
    syncTimeoutRef.current = setTimeout(() => {
      performSync(newSettings, timestamp);
    }, 700);
  }, [performSync]);

  // Initial Sync Strategy
  useEffect(() => {
    const initializeSync = async () => {
      try {
        const serverData = await apiGetSettings(userId);

        const localUpdated = getLocalUpdatedAt(userId);
        const localTime = localUpdated ? new Date(localUpdated).getTime() : 0;

        if (serverData) {
          const serverTime = new Date(serverData.updatedAt).getTime();

          if (serverTime > localTime) {
            setSettings(serverData.settings);
            setUpdatedAt(serverData.updatedAt);
            saveLocal(userId, serverData.settings, serverData.updatedAt);
          } else if (localTime > serverTime) {
            performSync(settings, localUpdated || new Date().toISOString());
          }
        } else {
          performSync(settings, updatedAt);
        }
      } catch (err) {
        if (!navigator.onLine) setSyncStatus('offline');
      }
    };

    initializeSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleOnline = () => performSync(settings, updatedAt);
    const handleOffline = () => setSyncStatus('offline');

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [settings, updatedAt, performSync]);

  const updateSettings = useCallback((updater: (prev: NotificationSettings) => NotificationSettings) => {
    setSettings(prev => {
      const next = updater(prev);
      const timestamp = new Date().toISOString();
      setUpdatedAt(timestamp);
      saveLocal(userId, next, timestamp);
      scheduleSync(next, timestamp);
      return next;
    });
  }, [scheduleSync]);

  const applyAllToSection = useCallback((section: 'myPosts' | 'sharedPosts', value: TriOption) => {
    updateSettings(prev => ({
      ...prev,
      [section]: { likes: value, comments: value, shares: value }
    }));
  }, [updateSettings]);

  const updateMyPosts = useCallback((key: keyof NotificationSettings['myPosts'], value: TriOption) => {
    updateSettings(prev => ({
      ...prev,
      myPosts: { ...prev.myPosts, [key]: value }
    }));
  }, [updateSettings]);

  const updateSharedPosts = useCallback((key: keyof NotificationSettings['sharedPosts'], value: TriOption) => {
    updateSettings(prev => ({
      ...prev,
      sharedPosts: { ...prev.sharedPosts, [key]: value }
    }));
  }, [updateSettings]);

  const toggleSetting = useCallback((key: keyof NotificationSettings['toggles']) => {
    updateSettings(prev => ({
      ...prev,
      toggles: { ...prev.toggles, [key]: !prev.toggles[key] }
    }));
  }, [updateSettings]);

  return (
    <div className="flex flex-col h-full bg-gray-50 animate-in slide-in-from-right duration-300 z-50">
      <div className="bg-white border-b border-gray-100 flex items-center px-4 h-14 sticky top-0 z-30">
        <button onClick={onBack} aria-label="Back" className="p-2 -ml-2 text-gray-600 hover:bg-gray-50 rounded-full transition-colors">
          <ArrowLeft size={24} />
        </button>
        <span className="font-bold text-lg ml-2">Notifications</span>
      </div>

      <div className="flex-1 overflow-y-auto pb-20 no-scrollbar">
        <SectionHeader
          title="Interactions with My Posts"
          icon={MessageSquare}
          onApplyAll={(v) => applyAllToSection('myPosts', v)}
        />
        <div className="bg-white border-y border-gray-100">
          <TriChoice
            label="Likes"
            description="Notifies you when someone likes your content."
            value={settings.myPosts.likes}
            onChange={(v) => updateMyPosts('likes', v)}
          />
          <TriChoice
            label="Comments"
            description="Stay updated when users comment on your posts."
            value={settings.myPosts.comments}
            onChange={(v) => updateMyPosts('comments', v)}
          />
          <TriChoice
            label="Shares"
            description="Alerts you when your post is shared by others."
            value={settings.myPosts.shares}
            onChange={(v) => updateMyPosts('shares', v)}
          />
        </div>

        <SectionHeader
          title="Interactions with Posts I Shared"
          icon={Repeat}
          onApplyAll={(v) => applyAllToSection('sharedPosts', v)}
        />
        <div className="bg-white border-y border-gray-100">
          <TriChoice
            label="Likes"
            description="Get alerts when your shared content receives likes."
            value={settings.sharedPosts.likes}
            onChange={(v) => updateSharedPosts('likes', v)}
          />
          <TriChoice
            label="Comments"
            description="Know when others comment on your shared posts."
            value={settings.sharedPosts.comments}
            onChange={(v) => updateSharedPosts('comments', v)}
          />
          <TriChoice
            label="Shares"
            description="Alerts when your reshares are shared further."
            value={settings.sharedPosts.shares}
            onChange={(v) => updateSharedPosts('shares', v)}
          />
        </div>

        <SectionHeader title="Other Activity" icon={Users} />
        <div className="bg-white border-y border-gray-100">
          <ToggleRow
            label="Activity Between People I Follow"
            description={`Get notified when people you follow interact with each other’s posts.\nExample: When a profile you follow likes or comments on a post by another profile you follow.`}
            active={settings.toggles.activityFollowed}
            onClick={() => toggleSetting('activityFollowed')}
          />
          <ToggleRow
            label="Invitations"
            description="Alerts you when someone invites you to participate in a poll, challenge, or special engagement."
            active={settings.toggles.invitations}
            onClick={() => toggleSetting('invitations')}
          />
          <ToggleRow
            label="Comment Interactions"
            description="Stay informed when others interact with your comments."
            active={settings.toggles.commentInteractions}
            onClick={() => toggleSetting('commentInteractions')}
          />
          <ToggleRow
            label="New Followers"
            description="Notifies you when a new user follows you."
            active={settings.toggles.newFollowers}
            onClick={() => toggleSetting('newFollowers')}
          />
        </div>

        <SectionHeader title="Email Notifications" icon={Mail} />
        <div className="bg-white border-y border-gray-100">
          <ToggleRow
            label="Receive email notifications"
            description={`Get important updates and activity alerts sent directly to your inbox.\nEmail notifications are sent only for important or high-priority activity.`}
            active={settings.toggles.emailNotifications}
            onClick={() => toggleSetting('emailNotifications')}
          />
        </div>

        <div className="p-8 text-center flex flex-col items-center gap-2">
          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest leading-relaxed">
            Changes are saved automatically and applied immediately.
          </p>
          {syncStatus !== 'idle' && (
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest leading-relaxed">
              {syncStatus === 'saving' && 'Saving...'}
              {syncStatus === 'saved' && 'Saved'}
              {syncStatus === 'offline' && 'Offline — changes will sync when online'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
