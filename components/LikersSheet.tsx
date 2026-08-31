import React, { useEffect, useState } from 'react';
import { UserProfile } from '../types';
import { BottomSheet } from './BottomSheet';
import { Loader2, ThumbsUp, X } from 'lucide-react';
import { api } from '../services/api';
import { UserAvatar } from './UserAvatar';

interface LikersSheetProps {
    isOpen: boolean;
    onClose: () => void;
    targetId: string;
    type: 'post' | 'comment';
    onAuthorClick?: (author: { id: string; name: string; avatar: string }) => void;
    currentUser?: UserProfile | null;
    isLikedLocally?: boolean;
}

export const LikersSheet: React.FC<LikersSheetProps> = ({ isOpen, onClose, targetId, type, onAuthorClick, currentUser, isLikedLocally }) => {
    const [likers, setLikers] = useState<UserProfile[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    const loadPage = React.useCallback(async (cursor: string | null, append: boolean, signal?: AbortSignal) => {
        append ? setIsLoadingMore(true) : setIsLoading(true);
        setLoadError(null);
        try {
            const page = type === 'post'
                ? await api.getPostLikersPage(targetId, cursor, 30, signal)
                : await api.getCommentLikersPage(targetId, cursor, 30, signal);
            let incoming = [...page.items];
            if (!append && currentUser && isLikedLocally !== undefined) {
                const existsIndex = incoming.findIndex(user => user.id === currentUser.id);
                if (isLikedLocally && existsIndex === -1) incoming.unshift(currentUser);
                if (!isLikedLocally && existsIndex !== -1) incoming.splice(existsIndex, 1);
            }
            setLikers(previous => {
                const byId = new Map<string, UserProfile>();
                (append ? previous : []).forEach(user => byId.set(user.id, user));
                incoming.forEach(user => byId.set(user.id, user));
                return Array.from(byId.values());
            });
            setNextCursor(page.nextCursor);
        } catch (error: any) {
            if (error?.name !== 'AbortError') setLoadError('Failed to load likes.');
        } finally {
            append ? setIsLoadingMore(false) : setIsLoading(false);
        }
    }, [currentUser, isLikedLocally, targetId, type]);

    useEffect(() => {
        if (isOpen && targetId) {
            const controller = new AbortController();
            setLikers([]);
            setNextCursor(null);
            void loadPage(null, false, controller.signal);
            return () => controller.abort();
        } else {
            setLikers([]);
            setNextCursor(null);
        }
    }, [isOpen, loadPage, targetId]);

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
                    ) : loadError && likers.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-center py-20">
                            <p className="text-sm text-gray-500 mb-3">{loadError}</p>
                            <button onClick={() => void loadPage(null, false)} className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white">Retry</button>
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
                                    <UserAvatar src={user.avatar} mediaId={user.avatarMediaId} media={user.avatarMedia} name={user.name} alt={user.name || 'User'} size={40} className="border border-gray-100" />
                                    <div className="min-w-0 flex-1">
                                        <h3 className="text-sm font-bold text-gray-900 truncate group-hover:text-blue-600 transition-colors">{user.name}</h3>
                                        {user.handle && <p className="text-[10px] text-gray-400 truncate uppercase font-bold tracking-widest">@{user.handle}</p>}
                                    </div>
                                </div>
                            ))}
                            {nextCursor && (
                                <button
                                    onClick={() => void loadPage(nextCursor, true)}
                                    disabled={isLoadingMore}
                                    className="mx-auto flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-xs font-bold text-gray-600 disabled:opacity-60"
                                >
                                    {isLoadingMore && <Loader2 size={14} className="animate-spin" />}
                                    Load more
                                </button>
                            )}
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
