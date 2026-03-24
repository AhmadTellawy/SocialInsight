import React, { useState } from 'react';
import { User, PieChart } from 'lucide-react';
import { UserProfile } from '../types';

interface HeaderProps {
  onProfileClick?: () => void;
  onMessagesClick?: () => void;
  userProfile?: UserProfile;
}

export const Header: React.FC<HeaderProps> = ({ onProfileClick, userProfile }) => {
  // Brand colors derived from the logo
  const BRAND_BLUE = '#0070BA';
  const BRAND_GREEN = '#00A67E';

  const [imageError, setImageError] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-b border-gray-100 h-16 px-4 flex items-center justify-between max-w-md mx-auto shadow-sm transition-all">
      <div className="flex items-center gap-3">
        {/* Custom Logo with Fallback */}
        <div className="relative w-12 h-12 shrink-0 transform active:scale-90 transition-transform cursor-pointer">
          <img
            src="logo.png"
            alt="SocialInsight Logo"
            className="w-full h-full object-contain"
          />
        </div>

        {/* App Name */}
        <div className="flex flex-col justify-center">
          <h1 className="text-xl font-black tracking-tighter leading-none">
            <span style={{ color: BRAND_BLUE }}>Social</span>
            <span style={{ color: BRAND_GREEN }}>Insight</span>
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-1 text-gray-500">
        <button
          onClick={onProfileClick}
          className="relative ml-1 active:scale-95 transition-transform"
        >
          {userProfile?.avatar ? (
            <img
              src={userProfile.avatar}
              alt="Profile"
              className="w-8 h-8 rounded-full object-cover border border-gray-100 shadow-sm"
            />
          ) : (
            <div className="p-2 hover:bg-gray-50 rounded-full text-gray-500">
              <User size={20} />
            </div>
          )}
        </button>
      </div>
    </header>
  );
};