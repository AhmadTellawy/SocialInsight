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
        <div className="bg-white border-y border-gray-100 py-4 my-2">
            <div className="px-4 mb-3 flex items-center justify-between">
                <h3 className="font-semibold text-gray-800 text-sm">أشخاص قد تعرفهم</h3>
            </div>
            
            <div className="flex overflow-x-auto hide-scrollbar px-4 pb-2 gap-3" style={{ scrollSnapType: 'x mandatory' }}>
                {users.map(user => (
                    <div 
                        key={user.id} 
                        className="flex-none w-36 border border-gray-100 rounded-xl p-4 flex flex-col items-center justify-center text-center shadow-sm"
                        style={{ scrollSnapAlign: 'start' }}
                    >
                        <div 
                           className="w-16 h-16 rounded-full bg-indigo-100 border-2 border-indigo-50 mb-2 overflow-hidden cursor-pointer"
                           onClick={() => onUserClick && onUserClick(user)}
                        >
                            <img 
                                src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || 'U')}&background=6366f1&color=fff`} 
                                alt={user.name} 
                                className="w-full h-full object-cover"
                            />
                        </div>
                        <h4 
                          className="font-semibold text-sm text-gray-800 line-clamp-1 w-full cursor-pointer"
                          onClick={() => onUserClick && onUserClick(user)}
                        >
                            {user.name}
                        </h4>
                        <p className="text-xs text-gray-500 mb-3 line-clamp-1 w-full">
                            {user.suggestionReason || `@${user.handle}`}
                        </p>
                        <button 
                            onClick={() => onFollow(user.id)}
                            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold py-1.5 rounded-full transition-colors flex items-center justify-center gap-1"
                        >
                            <UserPlus size={14} />
                            متابعة
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
