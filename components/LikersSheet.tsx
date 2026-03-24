import React, { useEffect, useState } from 'react';
import { UserProfile } from '../types';
import { BottomSheet } from './BottomSheet';
import { ThumbsUp, X } from 'lucide-react';
import { api } from '../services/api';

interface LikersSheetProps {
    isOpen: boolean;
    onClose: () => void;
    targetId: string;
    type: 'post' | 'comment';
    onAuthorClick?: (author: { id: string; name: string; avatar: string }) => void;
}

export const LikersSheet: React.FC<LikersSheetProps> = ({ isOpen, onClose, targetId, type, onAuthorClick }) => {
    const [likers, setLikers] = useState<UserProfile[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (isOpen && targetId) {
            console.log(`LikersSheet fetching: ${targetId} for ${type}`);
            const fetcher = type === 'post' ? api.getPostLikers : api.getCommentLikers;
            fetcher(targetId)
                .then(data => {
                    console.log("Likers fetched:", data);
                    setLikers(data);
                })
                .catch(err => console.error("Error fetching likers:", err))
                .finally(() => setIsLoading(false));
        } else {
            setLikers([]);
        }
    }, [isOpen, targetId, type]);

    return (
        <BottomSheet isOpen={isOpen} onClose={onClose}>
            <div className="flex flex-col h-[70vh] bg-white rounded-t-3xl">
                <div className="flex items-center justify-between p-4 border-b border-gray-100 sticky top-0 bg-white z-10">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                            <ThumbsUp size={16} />
                        </div>
                        <h2 className="text-lg font-black text-gray-900 tracking-tight">Likes</h2>
                        {!isLoading && <span className="text-sm font-bold text-gray-400 tabular-nums">({likers.length})</span>}
                    </div>
                    <button onClick={onClose} className="p-2 text-gray-400 hover:bg-gray-50 rounded-full transition-colors active:scale-90">
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 no-scrollbar">
                    {isLoading ? (
                        <div className="space-y-4">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="flex items-center gap-3 animate-pulse">
                                    <div className="w-12 h-12 bg-gray-100 rounded-full" />
                                    <div className="flex-1">
                                        <div className="h-4 bg-gray-100 rounded w-1/3 mb-2" />
                                        <div className="h-3 bg-gray-100 rounded w-1/4" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : likers.length > 0 ? (
                        <div className="space-y-4">
                            {likers.map(user => (
                                <div
                                    key={user.id}
                                    className="flex items-center gap-3 cursor-pointer group hover:bg-gray-50 p-2 -mx-2 rounded-xl transition-colors"
                                    onClick={() => {
                                        onClose();
                                        onAuthorClick?.({ id: user.id || '', name: user.name || '', avatar: user.avatar || '' });
                                    }}
                                >
                                    <img src={user.avatar} className="w-10 h-10 rounded-full border border-gray-100 object-cover shrink-0" alt={user.name} />
                                    <div className="min-w-0 flex-1">
                                        <h3 className="text-sm font-bold text-gray-900 truncate group-hover:text-blue-600 transition-colors">{user.name}</h3>
                                        {user.handle && <p className="text-[10px] text-gray-400 truncate uppercase font-bold tracking-widest">@{user.handle}</p>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-center py-20">
                            <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                                <ThumbsUp size={24} className="text-gray-300" />
                            </div>
                            <p className="text-sm font-bold text-gray-500 uppercase tracking-widest">No likes yet</p>
                        </div>
                    )}
                </div>
            </div>
        </BottomSheet>
    );
};
