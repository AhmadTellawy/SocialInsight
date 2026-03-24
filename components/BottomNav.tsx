
import React from 'react';
import { Home, Search, Plus, TrendingUp, Bell, FileText, PieChart, HelpCircle, Users, Building2, Zap } from 'lucide-react';

interface BottomNavProps {
  activeTab: string;
  onTabChange: (tab: 'home' | 'search' | 'add' | 'trends' | 'profile' | 'notifications' | 'messages') => void;
  onAddClick: () => void;
  isVisible: boolean;
  isAddMenuOpen: boolean;
  onAddMenuOption: (option: 'survey' | 'poll' | 'quiz' | 'challenge' | 'group' | 'business') => void;
  unreadNotificationsCount?: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({ 
  activeTab, 
  onTabChange, 
  onAddClick, 
  isVisible,
  isAddMenuOpen,
  onAddMenuOption,
  unreadNotificationsCount = 0
}) => {
  return (
    <nav className={`fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-100 pb-safe h-[60px] max-w-md mx-auto shadow-[0_-5px_10px_rgba(0,0,0,0.02)] transition-transform duration-300 ease-in-out ${
      isVisible ? 'translate-y-0' : 'translate-y-[110%]'
    }`}>
      
      {isAddMenuOpen && (
        <>
        <div className="fixed inset-0 z-40" onClick={onAddClick} />
        
        <div className="absolute bottom-[75px] left-1/2 -translate-x-1/2 w-56 bg-white rounded-2xl shadow-xl border border-gray-100 z-50 overflow-hidden animate-in slide-in-from-bottom-2 fade-in duration-200 origin-bottom">
           <div className="p-1">
             <button 
               onClick={() => onAddMenuOption('poll')}
               className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 rounded-xl transition-colors text-left"
             >
               <div className="w-8 h-8 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
                 <PieChart size={16} />
               </div>
               <span className="font-semibold text-gray-700 text-sm">Create Poll</span>
             </button>

             <button 
               onClick={() => onAddMenuOption('quiz')}
               className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 rounded-xl transition-colors text-left"
             >
               <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center">
                 <HelpCircle size={16} />
               </div>
               <span className="font-semibold text-gray-700 text-sm">Create Quiz</span>
             </button>

             <button 
               onClick={() => onAddMenuOption('challenge')}
               className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 rounded-xl transition-colors text-left"
             >
               <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center">
                 <Zap size={16} />
               </div>
               <span className="font-semibold text-gray-700 text-sm">Create Challenge</span>
             </button>

             <button 
               onClick={() => onAddMenuOption('survey')}
               className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 rounded-xl transition-colors text-left"
             >
               <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                 <FileText size={16} />
               </div>
               <span className="font-semibold text-gray-700 text-sm">Create Survey</span>
             </button>

             <div className="h-px bg-gray-100 my-1 mx-2" />

             <button 
               onClick={() => onAddMenuOption('group')}
               className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 rounded-xl transition-colors text-left"
             >
               <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center">
                 <Users size={16} />
               </div>
               <span className="font-semibold text-gray-700 text-sm">Create Group</span>
             </button>

             <button 
               onClick={() => onAddMenuOption('business')}
               className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 rounded-xl transition-colors text-left"
             >
               <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center">
                 <Building2 size={16} />
               </div>
               <span className="font-semibold text-gray-700 text-sm">Create Business Page</span>
             </button>
           </div>
        </div>
        </>
      )}

      <div className="relative flex items-center justify-between px-6 h-full z-50 bg-white">
        
        <button 
          onClick={() => onTabChange('home')}
          className={`flex flex-col items-center justify-center w-12 h-full transition-colors ${activeTab === 'home' ? 'text-blue-600' : 'text-gray-400'}`}
        >
          <Home size={24} strokeWidth={activeTab === 'home' ? 2.5 : 2} />
        </button>

        <button 
          onClick={() => onTabChange('search')}
          className={`flex flex-col items-center justify-center w-12 h-full transition-colors ${activeTab === 'search' ? 'text-blue-600' : 'text-gray-400'}`}
        >
          <Search size={24} strokeWidth={activeTab === 'search' ? 2.5 : 2} />
        </button>

        <div className="relative -top-5">
          <button 
            onClick={onAddClick}
            className={`w-14 h-14 bg-gradient-to-tr from-blue-600 to-green-500 rounded-full flex items-center justify-center shadow-lg shadow-blue-500/30 transform transition-all active:scale-95 ${isAddMenuOpen ? 'rotate-45 scale-105' : 'hover:scale-105'}`}
          >
            <Plus size={32} color="white" strokeWidth={3} />
          </button>
        </div>

        <button 
          onClick={() => onTabChange('trends')}
          className={`flex flex-col items-center justify-center w-12 h-full transition-colors ${activeTab === 'trends' ? 'text-blue-600' : 'text-gray-400'}`}
        >
          <TrendingUp size={24} strokeWidth={activeTab === 'trends' ? 2.5 : 2} />
        </button>

        <button 
          onClick={() => onTabChange('notifications')}
          className={`relative flex flex-col items-center justify-center w-12 h-full transition-colors ${activeTab === 'notifications' ? 'text-blue-600' : 'text-gray-400'}`}
        >
          <Bell size={24} strokeWidth={activeTab === 'notifications' ? 2.5 : 2} />
          {unreadNotificationsCount > 0 && (
            <span className="absolute top-2 right-1 bg-red-500 text-white text-[8px] font-black px-1 rounded-full border-2 border-white">
              {unreadNotificationsCount}
            </span>
          )}
        </button>

      </div>
    </nav>
  );
};
