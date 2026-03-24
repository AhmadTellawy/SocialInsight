import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Users, Settings, Plus, Globe, Share2, Info, Lock } from 'lucide-react';
import { Group, Survey, UserProfile } from '../types';
import { SurveyCard } from './SurveyCard';
import { useGroupMembership, useGroupPosts, useGroupStats, useGroupMembers } from '../hooks/useGroup';

const SafeImage = ({ src, fallback, alt, className }: { src?: string, fallback: string, alt?: string, className?: string }) => {
  return <img src={src || fallback} alt={alt || ''} className={className} onError={(e) => {
    if (e.currentTarget.src !== fallback) {
      e.currentTarget.src = fallback;
    }
  }} />;
};

interface GroupScreenProps {
  group: Group;
  userProfile: UserProfile;
  onBack: () => void;
  onPostClick: (id: string, surface?: string, tab?: 'post' | 'analysis') => void;
  onVote: (surveyId: string, optionIds: string[]) => void;
  onSurveyProgress?: (surveyId: string, progress: any) => void;
  onSettingsClick?: () => void;
  onCreatePost?: () => void;
  onShareToFeed?: (survey: Survey, caption: string) => void;
  onUpdateDemographics?: (demographics: Partial<NonNullable<UserProfile['demographics']>>) => void;
  getGroupShareUrl?: (groupId: string) => string;
  onLike?: (surveyId: string, isLiked: boolean) => void;
}

export const GroupScreen: React.FC<GroupScreenProps> = ({
  group,
  userProfile,
  onBack,
  onPostClick,
  onVote,
  onSurveyProgress,
  onSettingsClick,
  onCreatePost,
  onShareToFeed,
  onUpdateDemographics,
  getGroupShareUrl,
  onLike
}) => {
  const [activeTab, setActiveTab] = useState<'posts' | 'about' | 'members'>('posts');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { membershipStatus, role, joinGroup, leaveGroup, requestToJoin, isLoading: isMembershipLoading } = useGroupMembership(group.id, userProfile.id);
  const { posts, isLoading: isPostsLoading, isFetchingNextPage: isPostsFetchingNextPage, error: postsError, hasMore, fetchNextPage, updatePostLikeStatus } = useGroupPosts(group.id, userProfile?.id);
  const { stats, isLoading: isStatsLoading } = useGroupStats(group.id);
  const { members, isLoading: isMembersLoading, isFetchingNextPage: isMembersFetchingNextPage, error: membersError, hasMore: hasMoreMembers, fetchNextPage: fetchNextPageMembers } = useGroupMembers(group.id);

  const isJoined = membershipStatus === 'JOINED';

  const permissions = group.permissions || {
    canViewMembers: false,
    canManageSettings: false,
    canPost: false,
  };
  const isAdmin = permissions.canManageSettings || role === 'Owner' || role === 'Admin';

  const handleLike = (surveyId: string, isLiked: boolean) => {
    updatePostLikeStatus(surveyId, isLiked);
    if (onLike) {
      onLike(surveyId, isLiked);
    }
  };

  useEffect(() => {
    if (activeTab === 'members' && !permissions.canViewMembers) {
      setActiveTab('posts');
    }
  }, [activeTab, permissions.canViewMembers]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  const showToast = (message: string) => {
    setToastMessage(message);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimeoutRef.current = null;
    }, 3000);
  };

  const errorToText = (e: unknown) => {
    if (!e) return '';
    if (typeof e === 'string') return e;
    if (e instanceof Error) return e.message;
    return String(e);
  };

  const handleCreatePost = () => {
    if (onCreatePost) {
      onCreatePost();
    } else {
      showToast('Create post is not available');
    }
  };

  const copyText = async (text: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        showToast('Link copied to clipboard');
        return true;
      }
      return false;
    } catch (err) {
      console.error('Failed to copy', err);
      showToast('Failed to copy link');
      return false;
    }
  };

  const handleJoinClick = () => {
    if (isJoined) {
      leaveGroup();
      return;
    }

    if (group.isPublic) {
      joinGroup();
    } else if (membershipStatus === 'INVITED') {
      joinGroup(); // Accept invite
    } else {
      requestToJoin();
    }
  };

  const getJoinButtonLabel = () => {
    if (isMembershipLoading) return 'Loading...';
    if (membershipStatus === 'JOINED') return 'Joined';
    if (membershipStatus === 'PENDING') return 'Pending';
    if (membershipStatus === 'INVITED') return 'Accept Invite';
    if (!group.isPublic) return 'Request to Join';
    return 'Join Group';
  };

  const isJoinDisabled = isMembershipLoading || membershipStatus === 'PENDING';

  const renderTabContent = () => {
    switch (activeTab) {
      case 'posts':
        return (
          <div className="space-y-1">
            {isJoined && permissions.canPost && (
              <div className="bg-white p-4 border-b border-gray-100 flex items-center gap-3">
                <SafeImage src={userProfile?.avatar} fallback="https://picsum.photos/100" className="w-10 h-10 rounded-full border border-gray-100" />
                <button
                  onClick={handleCreatePost}
                  className={`flex-1 text-left px-4 py-2.5 rounded-full text-sm font-medium transition-colors border border-gray-100 ${onCreatePost
                    ? 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                    : 'bg-gray-50/50 text-gray-400 cursor-not-allowed opacity-70'
                    }`}
                >
                  Post a poll or survey to the group...
                </button>
              </div>
            )}

            {isPostsLoading && posts.length === 0 ? (
              <div className="py-10 text-center text-gray-500 animate-pulse">Loading posts...</div>
            ) : postsError ? (
              <div className="py-10 text-center text-red-500 text-sm">Error: {errorToText(postsError)}</div>
            ) : posts.length > 0 ? (
              <>
                {posts.map(post => (
                  <SurveyCard
                    key={post.id}
                    survey={post}
                    userProfile={userProfile}
                    onContentClick={() => onPostClick(post.id, 'GROUP')}
                    onAnalysisClick={() => onPostClick(post.id, 'GROUP', 'analysis')}
                    onVote={onVote}
                    onSurveyProgress={onSurveyProgress}
                    onShareToFeed={onShareToFeed}
                    onUpdateDemographics={onUpdateDemographics}
                    onLike={handleLike}
                  />
                ))}
                {hasMore && (
                  <div className="py-6 flex justify-center">
                    <button
                      onClick={fetchNextPage}
                      disabled={isPostsFetchingNextPage}
                      className="text-blue-600 text-sm font-bold bg-blue-50 px-6 py-2 rounded-full hover:bg-blue-100 disabled:opacity-50"
                    >
                      {isPostsFetchingNextPage ? 'Loading...' : 'Load More'}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 px-6 text-center text-gray-400">
                <Users size={48} className="opacity-10 mb-4" />
                <h3 className="text-gray-900 font-bold mb-1">No group posts yet</h3>
                <p className="text-sm">Be the first to start a discussion in {group.name}.</p>
                {isJoined && permissions.canPost && (
                  <button
                    onClick={handleCreatePost}
                    className={`mt-6 flex items-center gap-2 px-6 py-2 rounded-full font-bold text-sm shadow-lg active:scale-95 transition-all ${onCreatePost
                      ? 'bg-blue-600 text-white shadow-blue-100'
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed shadow-none'
                      }`}
                  >
                    <Plus size={18} strokeWidth={3} /> Create First Post
                  </button>
                )}
              </div>
            )}
          </div>
        );
      case 'about':
        return (
          <div className="p-5 space-y-6 animate-in fade-in">
            <div className="space-y-2">
              <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Description</h4>
              <p className="text-sm text-gray-700 leading-relaxed bg-gray-50 p-4 rounded-2xl border border-gray-100">
                {group.description || "No description provided for this group."}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-4 bg-white border border-gray-100 rounded-2xl shadow-sm">
                <div className="text-[10px] font-black text-gray-400 uppercase mb-1">Category</div>
                <div className="text-sm font-bold text-gray-900">{group.category}</div>
              </div>
              <div className="p-4 bg-white border border-gray-100 rounded-2xl shadow-sm">
                <div className="text-[10px] font-black text-gray-400 uppercase mb-1">Privacy</div>
                <div className="flex items-center gap-1.5 text-sm font-bold text-gray-900">
                  {group.isPublic ? <Globe size={14} className="text-green-600" /> : <Lock size={14} className="text-orange-600" />}
                  {group.isPublic ? 'Public' : 'Private'}
                </div>
              </div>
            </div>

            <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 flex items-start gap-3">
              <Info size={18} className="text-blue-600 mt-0.5" />
              <div>
                <h5 className="text-xs font-bold text-blue-900">Rules & Guidelines</h5>
                <p className="text-[11px] text-blue-700 mt-1 leading-relaxed">
                  Respect all members, no spamming, and ensure polls are relevant to {group.category}.
                </p>
              </div>
            </div>
          </div>
        );
      case 'members':
        if (!permissions.canViewMembers) return null;

        return (
          <div className="p-0 animate-in fade-in">
            {isMembersLoading && members.length === 0 ? (
              <div className="py-10 text-center text-gray-500 animate-pulse">Loading members...</div>
            ) : membersError ? (
              <div className="py-10 text-center text-red-500 text-sm">Error: {errorToText(membersError)}</div>
            ) : members.length > 0 ? (
              <div className="flex flex-col">
                {members.map(member => (
                  <div key={member.id} className="flex items-center gap-3 p-4 border-b border-gray-50 bg-white">
                    <SafeImage src={member.avatar} fallback="https://picsum.photos/100" className="w-10 h-10 rounded-full" />
                    <div>
                      <div className="text-sm font-bold text-gray-900">{member.name}</div>
                      {member.role && <div className="text-xs text-blue-600 font-medium">{member.role}</div>}
                    </div>
                  </div>
                ))}
                {hasMoreMembers && (
                  <div className="py-6 flex justify-center bg-gray-50/50">
                    <button
                      onClick={fetchNextPageMembers}
                      disabled={isMembersFetchingNextPage}
                      className="text-blue-600 text-sm font-bold bg-blue-50 px-6 py-2 rounded-full hover:bg-blue-100 disabled:opacity-50"
                    >
                      {isMembersFetchingNextPage ? 'Loading...' : 'Load More Members'}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-10 text-center text-gray-400">
                No members found.
              </div>
            )}
          </div>
        );
    }
  };

  return (
    <div className="flex flex-col h-full bg-white animate-in slide-in-from-right duration-300 relative">
      {/* Toast */}
      {toastMessage && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white px-4 py-2 rounded-full shadow-lg text-sm font-medium animate-in slide-in-from-top fade-in duration-200">
          {toastMessage}
        </div>
      )}

      {/* Header Image & Actions */}
      <div className="relative h-48 shrink-0">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-600 to-indigo-700">
          <SafeImage src={group.image} fallback="https://picsum.photos/400/200" className="w-full h-full object-cover opacity-60" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

        {/* Navigation Actions */}
        <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between z-10 safe-top">
          <button onClick={onBack} className="p-2 bg-white/20 backdrop-blur-md text-white rounded-full hover:bg-white/30 transition-colors">
            <ArrowLeft size={24} />
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const url = getGroupShareUrl ? getGroupShareUrl(group.id) : (typeof navigator !== 'undefined' ? `${window.location.origin}/groups/${group.id}` : '');
                if (url) copyText(url);
              }}
              className="p-2 bg-white/20 backdrop-blur-md text-white rounded-full hover:bg-white/30 transition-colors"
            >
              <Share2 size={20} />
            </button>
            {isAdmin && (
              <button
                onClick={onSettingsClick}
                className="p-2 bg-white/20 backdrop-blur-md text-white rounded-full hover:bg-white/30 transition-colors"
              >
                <Settings size={20} />
              </button>
            )}
          </div>
        </div>

        {/* Group Info Overlay */}
        <div className="absolute bottom-4 left-5 right-5 flex items-end justify-between">
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-3xl bg-white p-1 shadow-xl border border-white/20">
              <SafeImage src={group.image} fallback="https://picsum.photos/200/200" className="w-full h-full rounded-[1.25rem] object-cover" />
            </div>
            <div className="pb-1">
              <h1 className="text-xl font-black text-white leading-none mb-1.5 drop-shadow-md">{group.name}</h1>
              <div className="flex items-center gap-2 text-white/90 text-xs font-bold">
                <span className="flex items-center gap-1"><Users size={12} strokeWidth={3} /> {isStatsLoading ? '-' : (stats?.membersCount || 0).toLocaleString()}</span>
                <span>•</span>
                <span className="uppercase tracking-widest text-[9px] bg-white/20 px-2 py-0.5 rounded backdrop-blur-sm">{group.category}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats & Actions Row */}
      <div className="px-5 py-5 flex items-center justify-between border-b border-gray-50">
        <div className="flex gap-4">
          <div className="flex flex-col">
            <span className="text-xs font-black text-gray-900">{isStatsLoading ? '-' : (stats?.postsCount || 0)}</span>
            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Posts</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-black text-gray-900">{isStatsLoading ? '-' : (stats?.votesCount || 0).toLocaleString()}</span>
            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Votes</span>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleJoinClick}
            disabled={isJoinDisabled}
            className={`px-6 py-2 rounded-full font-bold text-xs transition-all active:scale-95 ${isJoined
              ? 'bg-gray-100 text-gray-600 border border-gray-200'
              : isJoinDisabled ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-blue-600 text-white shadow-lg shadow-blue-200'
              }`}
          >
            {getJoinButtonLabel()}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="sticky top-0 bg-white z-20 flex items-center border-b border-gray-100 shadow-sm">
        {[
          { id: 'posts', label: 'Posts' },
          { id: 'about', label: 'About' },
          ...(permissions.canViewMembers ? [{ id: 'members', label: 'Members' }] : [])
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex-1 py-3.5 text-xs font-black uppercase tracking-widest transition-all relative ${activeTab === tab.id ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'
              }`}
          >
            {tab.label}
            {activeTab === tab.id && <div className="absolute bottom-0 left-1/4 right-1/4 h-1 bg-blue-600 rounded-full" />}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto no-scrollbar bg-gray-50/50 pb-20">
        {renderTabContent()}
      </div>
    </div>
  );
};