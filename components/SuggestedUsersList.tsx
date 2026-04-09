import React from 'react';
import { UserPlus } from 'lucide-react';
import { UserProfile } from '../types';

interface SuggestedUser extends UserProfile {
    suggestionReason?: string;
}

interface SuggestedUsersListProps {
    users: SuggestedUser[];
    onFollow: (userId: string) => void;
    onUserClick?: (user: { id: string, name: string, avatar: string }) => void;
}

export const SuggestedUsersList: React.FC<SuggestedUsersListProps> = ({ users, onFollow, onUserClick }) => {
    if (!users || users.length === 0) return null;

    return (
        <div className="bg-white border-b border-gray-100 py-4 my-2">
            <div className="px-4 mb-4 flex items-center justify-between">
                <h3 className="font-bold text-gray-900 text-[15px] tracking-tight">Suggested for you</h3>
            </div>
            
            <div className="flex overflow-x-auto hide-scrollbar px-4 pb-4 gap-3" style={{ scrollSnapType: 'x mandatory' }}>
                {users.map(user => (
                    <div 
                        key={user.id} 
                        className="flex-none w-[140px] border border-gray-200 rounded-2xl p-4 flex flex-col items-center justify-center text-center shadow-sm relative group bg-white hover:bg-gray-50 transition-colors"
                        style={{ scrollSnapAlign: 'start' }}
                    >
                        <button 
                         className="absolute top-2 right-2 text-gray-300 hover:text-gray-500 transition-colors bg-white rounded-full p-0.5"
                         onClick={(e) => { e.stopPropagation(); /* optional dismiss handler */ }}
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>

                        <div 
                           className="w-[72px] h-[72px] rounded-full mb-3 overflow-hidden cursor-pointer shadow-sm pointer-events-auto ring-2 ring-transparent group-hover:ring-gray-200 transition-all duration-300"
                           onClick={() => onUserClick && onUserClick(user)}
                        >
                            <img 
                                src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || 'U')}&background=0A0A0A&color=fff`} 
                                alt={user.name} 
                                className="w-full h-full object-cover"
                            />
                        </div>
                        <h4 
                          className="font-bold text-[14px] text-gray-900 line-clamp-1 w-full cursor-pointer hover:underline decoration-gray-400 decoration-1 underline-offset-2"
                          onClick={() => onUserClick && onUserClick(user)}
                        >
                            {user.name}
                        </h4>
                        <p className="text-[12px] text-gray-500 mb-4 line-clamp-1 w-full font-medium">
                            {user.suggestionReason || `@${user.handle}`}
                        </p>
                        <button 
                            onClick={() => onFollow(user.id)}
                            className="w-full bg-gray-900 hover:bg-black text-white text-[13px] font-bold py-1.5 rounded-full transition-transform active:scale-95 shadow-sm"
                        >
                            Follow
                        </button>
                    </div>
                ))}
            </div>

            <style>{`
                .hide-scrollbar::-webkit-scrollbar {
                    display: none;
                }
                .hide-scrollbar {
                    -ms-overflow-style: none;
                    scrollbar-width: none;
                }
            `}</style>
        </div>
    );
};
