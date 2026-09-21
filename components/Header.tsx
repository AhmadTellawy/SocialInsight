import React from 'react';
import { Building2 } from 'lucide-react';
import { UserProfile } from '../types';
import { UserAvatar } from './UserAvatar';
import { useTranslation } from 'react-i18next';

interface HeaderProps {
  onPagesClick?: () => void;
  onProfileClick?: () => void;
  onMessagesClick?: () => void;
  userProfile?: UserProfile;
  onLoginClick?: () => void;
  onSignUpClick?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onProfileClick, onPagesClick, userProfile, onLoginClick, onSignUpClick }) => {
  const { t, i18n } = useTranslation();
  const BRAND_BLUE = '#0070BA';
  const BRAND_GREEN = '#00A67E';

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-b border-gray-100 h-16 px-2 sm:px-4 flex items-center justify-between gap-1 max-w-md mx-auto shadow-sm transition-all">
      <div className="flex min-w-0 items-center gap-1 sm:gap-3">
        {/* Custom Logo with Fallback */}
        <div className="relative w-9 h-9 sm:w-12 sm:h-12 shrink-0 transform active:scale-90 transition-transform cursor-pointer">
          <img
            src="/logo.png"
            alt="Opiniup Logo"
            className="w-full h-full object-contain"
          />
        </div>

        {/* App Name */}
        <div className="flex flex-col justify-center">
          <h1 dir="ltr" className="text-xl font-black tracking-tighter leading-none">
            <span style={{ color: BRAND_BLUE }}>Opini</span>
            <span style={{ color: BRAND_GREEN }}>up</span>
          </h1>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 text-gray-500">
        {onPagesClick && <button onClick={onPagesClick} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#0070BA] hover:bg-blue-50" aria-label={i18n.language.startsWith('ar') ? 'الصفحات' : 'Pages'}><Building2 size={22}/></button>}
        {userProfile ? (
          <button
            onClick={onProfileClick}
            className="relative ml-1 active:scale-95 transition-transform"
          >
            <UserAvatar src={userProfile.avatar} mediaId={userProfile.avatarMediaId} media={userProfile.avatarMedia} name={userProfile.name} size={32} className="border border-gray-100 shadow-sm" />
          </button>
        ) : (
          <div className="flex items-center gap-1 sm:gap-3">
            <button onClick={onLoginClick} className="min-h-11 px-1 text-xs sm:text-[15px] font-bold text-[#0070BA] hover:text-blue-700 transition-colors">
              {t('auth.login', 'Login')}
            </button>
            <button onClick={onSignUpClick} className="min-h-11 bg-[#0070BA] hover:bg-[#005ea3] text-white text-xs sm:text-[15px] font-bold py-1.5 px-2 sm:px-5 rounded-full transition-all active:scale-95 shadow-sm">
              {t('auth.signup', 'Sign Up')}
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
