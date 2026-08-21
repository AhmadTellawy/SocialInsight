import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Users, Settings, Plus, Globe, Share2, Info, Lock,
  UserPlus, Crown, Shield, X, Check, BarChart2, ClipboardList, Brain, Zap, Clock,
  ChevronDown
} from 'lucide-react';
import { Group, PostAnswerPayload, Survey, UserProfile } from '../types';
import { SurveyCard } from './SurveyCard';
import { useGroupMembership, useGroupPosts, useGroupStats, useGroupMembers } from '../hooks/useGroup';
import { api } from '../services/api';
import { UserAvatar } from './UserAvatar';
import { MediaImage } from './media/MediaImage';

const CREATE_CHIPS = [
  { type: 'Poll' as const,      color: '#3B82F6', bg: '#EFF6FF', border: '#BFDBFE', icon: BarChart2 },
  { type: 'Survey' as const,    color: '#10B981', bg: '#F0FDF4', border: '#A7F3D0', icon: ClipboardList },
  { type: 'Quiz' as const,      color: '#8B5CF6', bg: '#F5F3FF', border: '#DDD6FE', icon: Brain },
  { type: 'Challenge' as const, color: '#F97316', bg: '#FFF7ED', border: '#FED7AA', icon: Zap },
];

interface GroupScreenProps {
  group: Group;
  userProfile: UserProfile;
  onBack: () => void;
  onPostClick: (id: string, surface?: string, tab?: 'post' | 'analysis') => void;
  onVote: (surveyId: string, optionIds: string[], isAnonymous?: boolean, newOption?: any, followUpAnswers?: Record<string, string>, answers?: PostAnswerPayload[]) => void | boolean | Promise<void | boolean>;
  onSurveyProgress?: (surveyId: string, progress: any) => void;
  onSettingsClick?: () => void;
  onCreatePost?: (type: 'Poll' | 'Survey' | 'Quiz' | 'Challenge') => void;
  onShareToFeed?: (survey: Survey, caption: string) => void;
  onUpdateDemographics?: (demographics: Partial<NonNullable<UserProfile['demographics']>>) => void;
  getGroupShareUrl?: (groupId: string) => string;
  onLike?: (surveyId: string, isLiked: boolean) => void;
  onInviteUser?: (groupId: string, userId: string) => Promise<void>;
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
  onLike,
  onInviteUser,
}) => {
  const [activeTab, setActiveTab] = useState<'posts' | 'about' | 'members'>('posts');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Membership status UI state
  const [showLeaveConfirm, setShowLeaveConfirm]   = useState(false);
  const [showAdminMenu, setShowAdminMenu]          = useState(false);

  // Invite modal state
  const [showInviteModal, setShowInviteModal]     = useState(false);
  const [inviteQuery, setInviteQuery]             = useState('');
  const [inviteResults, setInviteResults]         = useState<any[]>([]);
  const [inviteSearching, setInviteSearching]     = useState(false);
  const [inviteLoadingId, setInviteLoadingId]     = useState<string | null>(null);
  const [invitedIds, setInvitedIds]               = useState<Set<string>>(new Set());
  const [selectedInviteIds, setSelectedInviteIds] = useState<Set<string>>(new Set());
  const [isBulkInviting, setIsBulkInviting]       = useState(false);

  const {
    membershipStatus, role, joinGroup, leaveGroup, requestToJoin, declineInvite,
    isLoading: isMembershipLoading
  } = useGroupMembership(group.id, userProfile.id);

  const {
    posts, isLoading: isPostsLoading, isFetchingNextPage: isPostsFetchingNextPage,
    error: postsError, hasMore, fetchNextPage, updatePostLikeStatus
  } = useGroupPosts(group.id, userProfile?.id);

  const { stats, isLoading: isStatsLoading } = useGroupStats(group.id);

  const {
    members, isLoading: isMembersLoading, isFetchingNextPage: isMembersFetchingNextPage,
    error: membersError, hasMore: hasMoreMembers, fetchNextPage: fetchNextPageMembers
  } = useGroupMembers(group.id);

  const isJoined = membershipStatus === 'JOINED';

  const permissions = group.permissions || {
    canViewGroup: true,
    canViewMembers: true,
    postRequiresApproval: false,
    canManageSettings: role === 'Owner' || role === 'Admin',
    canManageRoles: role === 'Owner',
    canManageMembers: role === 'Owner' || role === 'Admin',
    canDeleteGroup: role === 'Owner',
    canInviteMembers: isJoined && group.joinPolicy !== 'INVITE_ONLY',
    canApproveRequests: role === 'Owner' || role === 'Admin',
    canPost: true,
  };
  const isAdmin = permissions.canManageSettings || role === 'Owner' || role === 'Admin';

  const handleLike = (surveyId: string, isLiked: boolean) => {
    updatePostLikeStatus(surveyId, isLiked);
    if (onLike) onLike(surveyId, isLiked);
  };

  useEffect(() => {
    if (activeTab === 'members' && !permissions.canViewMembers) setActiveTab('posts');
  }, [activeTab, permissions.canViewMembers]);

  useEffect(() => {
    return () => { if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current); };
  }, []);

  // Close admin dropdown when clicking outside
  useEffect(() => {
    if (!showAdminMenu) return;
    const handler = () => setShowAdminMenu(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showAdminMenu]);

  const showToast = (message: string) => {
    setToastMessage(message);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => { setToastMessage(null); toastTimeoutRef.current = null; }, 3000);
  };

  const errorToText = (e: unknown) => {
    if (!e) return '';
    if (typeof e === 'string') return e;
    if (e instanceof Error) return e.message;
    return String(e);
  };

  const copyText = async (text: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        showToast('Link copied to clipboard');
        return true;
      }
      return false;
    } catch {
      showToast('Failed to copy link');
      return false;
    }
  };

  const handleJoinClick = () => {
    if (group.joinPolicy === 'OPEN') joinGroup();
    else if (group.joinPolicy === 'REQUEST') requestToJoin();
  };

  const handleCancelRequest = async () => {
    try {
      await api.cancelGroupJoinRequest(group.id);
      showToast('Join request cancelled');
      // force membership refetch by triggering leaveGroup logic on client only
      window.location.reload();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to cancel request');
    }
  };

  // ── Invite search with debounce ──────────────────────────────────
  // useMemo so memberIdSet is not recreated on every render
  const memberIdSet = React.useMemo(
    () => new Set(members.map((m: any) => m.userId || m.id)),
    [members]
  );

  useEffect(() => {
    if (!showInviteModal) return;
    if (inviteQuery.trim().length < 2) { setInviteResults([]); return; }
    const t = setTimeout(async () => {
      setInviteSearching(true);
      try {
        // Pass userId so backend excludes blocked users; also exclude current user & existing members
        const results: any[] = await api.searchUsers(inviteQuery);
        setInviteResults(
          results.filter((u: any) => u.id !== userProfile.id && !memberIdSet.has(u.id))
        );
      } catch { setInviteResults([]); }
      finally { setInviteSearching(false); }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteQuery, showInviteModal, memberIdSet]);

  const handleInviteUser = async (userId: string) => {
    if (inviteLoadingId) return;
    setInviteLoadingId(userId);
    try {
      await (onInviteUser ? onInviteUser(group.id, userId) : api.inviteToGroup(group.id, userId));
      setInvitedIds(prev => new Set([...prev, userId]));
      showToast('Invite sent ✓');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to send invite');
    } finally { setInviteLoadingId(null); }
  };

  const toggleSelectUser = (userId: string) => {
    setSelectedInviteIds(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    const uninvitedVisible = inviteResults.filter(user => !invitedIds.has(user.id));
    const allSelected = uninvitedVisible.length > 0 && uninvitedVisible.every(user => selectedInviteIds.has(user.id));
    setSelectedInviteIds(prev => {
      const next = new Set(prev);
      if (allSelected) {
        uninvitedVisible.forEach(user => next.delete(user.id));
      } else {
        uninvitedVisible.forEach(user => next.add(user.id));
      }
      return next;
    });
  };

  const handleBulkInvite = async () => {
    if (selectedInviteIds.size === 0 || isBulkInviting) return;
    setIsBulkInviting(true);
    const ids: string[] = Array.from(selectedInviteIds);
    let successCount = 0;
    for (const userId of ids) {
      try {
        await (onInviteUser ? onInviteUser(group.id, userId) : api.inviteToGroup(group.id, userId));
        setInvitedIds(prev => new Set([...prev, userId]));
        successCount++;
      } catch (err) {
        console.error(`Failed to invite user ${userId}:`, err);
      }
    }
    showToast(`Invited ${successCount} user(s) successfully!`);
    setSelectedInviteIds(new Set());
    setIsBulkInviting(false);
  };

  const resetInviteModal = () => {
    setShowInviteModal(false);
    setInviteQuery('');
    setInviteResults([]);
    setInvitedIds(new Set());
    setSelectedInviteIds(new Set());
    setIsBulkInviting(false);
  };

  // ── Membership Status Button ─────────────────────────────────────
  const renderMembershipButton = () => {
    if (isMembershipLoading) {
      return <div className="px-5 py-2.5 rounded-full bg-gray-200 animate-pulse w-24 h-9" />;
    }

    if (role === 'Owner') {
      return (
        <div className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-gradient-to-r from-yellow-400 to-orange-400 text-white text-xs font-black shadow-md select-none">
          <Crown size={12} strokeWidth={3} /> Owner
        </div>
      );
    }

    if (role === 'Admin') {
      return (
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setShowAdminMenu(prev => !prev); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-xs font-black shadow-md"
          >
            <Shield size={12} strokeWidth={3} /> Admin <ChevronDown size={10} />
          </button>
          {showAdminMenu && (
            <div className="absolute right-0 top-10 bg-white rounded-xl shadow-xl border border-gray-100 z-30 min-w-[140px] overflow-hidden">
              <button
                onClick={() => { setShowAdminMenu(false); setShowLeaveConfirm(true); }}
                className="w-full text-left px-4 py-3 text-sm text-red-500 font-semibold hover:bg-red-50 transition-colors"
              >
                Leave Group
              </button>
            </div>
          )}
        </div>
      );
    }

    if (membershipStatus === 'JOINED') {
      return (
        <button
          onClick={() => setShowLeaveConfirm(true)}
          className="group relative px-5 py-2 rounded-full text-xs font-bold transition-all duration-200 overflow-hidden bg-green-50 border border-green-200 text-green-700 hover:bg-red-50 hover:border-red-200 hover:text-red-600"
        >
          <span className="group-hover:hidden flex items-center gap-1">
            <Check size={11} strokeWidth={3} /> Joined
          </span>
          <span className="hidden group-hover:flex items-center gap-1">
            Leave Group
          </span>
        </button>
      );
    }

    if (membershipStatus === 'INVITED') {
      return (
        <div className="flex gap-1.5">
          <button
            onClick={() => joinGroup()}
            className="px-4 py-2 rounded-full bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 shadow-md active:scale-95 transition-all"
          >
            Accept
          </button>
          <button
            onClick={() => declineInvite().catch(e => showToast(e.message))}
            className="px-4 py-2 rounded-full bg-gray-100 text-gray-600 text-xs font-bold hover:bg-gray-200 active:scale-95 transition-all"
          >
            Decline
          </button>
        </div>
      );
    }

    if (membershipStatus === 'PENDING') {
      return (
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 px-4 py-2 rounded-full bg-amber-50 text-amber-600 text-xs font-bold border border-amber-200">
            <Clock size={11} /> Pending
          </span>
          <button
            onClick={handleCancelRequest}
            className="px-4 py-2 rounded-full bg-gray-100 text-gray-600 text-xs font-bold hover:bg-red-50 hover:text-red-500 border border-gray-200 hover:border-red-200 active:scale-95 transition-all"
          >
            Cancel
          </button>
        </div>
      );
    }

    if (membershipStatus === 'BANNED') {
      return (
        <button disabled className="px-5 py-2 rounded-full bg-gray-100 text-gray-400 text-xs font-bold cursor-not-allowed border border-gray-200">
          Banned
        </button>
      );
    }

    if (group.joinPolicy === 'INVITE_ONLY') {
      return (
        <button disabled className="flex items-center gap-1 px-5 py-2 rounded-full bg-gray-100 text-gray-400 text-xs font-bold border border-gray-200 cursor-not-allowed">
          <Lock size={11} /> Invite Only
        </button>
      );
    }

    // NOT_JOINED
    return (
      <button
        onClick={handleJoinClick}
        className="px-5 py-2 rounded-full bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 shadow-md active:scale-95 transition-all"
      >
        {group.joinPolicy === 'REQUEST' ? 'Request to Join' : 'Join Group'}
      </button>
    );
  };

  // ── Tab Content ──────────────────────────────────────────────────
  const renderTabContent = () => {
    switch (activeTab) {
      case 'posts':
        return (
          <div className="space-y-1">
            {/* Create Post Bar */}
            {isJoined && permissions.canPost && (
              <div className="bg-white mx-4 mt-4 mb-2 p-3.5 rounded-2xl border border-gray-100 shadow-sm">
                <div className="flex items-center gap-3 flex-wrap">
                  <UserAvatar
                    src={userProfile?.avatar}
                    mediaId={userProfile?.avatarMediaId}
                    media={userProfile?.avatarMedia}
                    name={userProfile?.name}
                    alt={userProfile?.name || 'You'}
                    size={32}
                    className="border border-gray-100"
                  />
                  <span className="text-xs font-bold text-gray-400 shrink-0">Create:</span>
                  <div className="flex gap-2 flex-wrap">
                    {CREATE_CHIPS.map(({ type, color, bg, border, icon: Icon }) => (
                      <button
                        key={type}
                        onClick={() => onCreatePost?.(type)}
                        style={{ backgroundColor: bg, color, borderColor: border }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold border transition-all hover:scale-105 active:scale-95 shadow-sm"
                      >
                        <Icon size={11} strokeWidth={2.5} />
                        {type}
                      </button>
                    ))}
                  </div>
                </div>
                {permissions.postRequiresApproval && (
                  <p className="text-[10px] text-amber-500 mt-2 ml-11 flex items-center gap-1 font-medium">
                    <Clock size={9} strokeWidth={2.5} />
                    Posts require admin approval before publishing
                  </p>
                )}
              </div>
            )}

            {/* Private group guard for non-members */}
            {!group.isPublic && !isJoined && membershipStatus !== 'INVITED' ? (
              <div className="flex flex-col items-center justify-center py-24 px-8 text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                  <Lock size={28} className="text-gray-400" />
                </div>
                <h3 className="text-gray-900 font-black text-base mb-2">Private Group</h3>
                <p className="text-gray-400 text-sm leading-relaxed">
                  {group.joinPolicy === 'INVITE_ONLY'
                    ? 'This group is invite-only. You need an invitation to view its content.'
                    : 'Join this group to see posts and participate in discussions.'}
                </p>
                {group.joinPolicy !== 'INVITE_ONLY' && membershipStatus !== 'PENDING' && (
                  <button
                    onClick={handleJoinClick}
                    className="mt-6 px-6 py-2.5 rounded-full bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 shadow-md active:scale-95 transition-all"
                  >
                    {group.joinPolicy === 'REQUEST' ? 'Request to Join' : 'Join Group'}
                  </button>
                )}
              </div>
            ) : isPostsLoading && posts.length === 0 ? (
              <div className="flex flex-col gap-4 p-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm animate-pulse space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gray-200 rounded-full" />
                      <div className="space-y-2 flex-1">
                        <div className="h-3.5 bg-gray-200 rounded-md w-1/3" />
                        <div className="h-2.5 bg-gray-200 rounded-md w-1/4" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="h-4 bg-gray-200 rounded-md w-3/4" />
                      <div className="h-3 bg-gray-200 rounded-md w-full" />
                      <div className="h-3 bg-gray-200 rounded-md w-5/6" />
                    </div>
                    <div className="h-28 bg-gray-200 rounded-2xl w-full" />
                    <div className="flex gap-4 pt-2">
                      <div className="h-8 bg-gray-200 rounded-full w-20" />
                      <div className="h-8 bg-gray-200 rounded-full w-20" />
                    </div>
                  </div>
                ))}
              </div>
            ) : postsError ? (
              <div className="py-10 text-center text-red-500 text-sm">Error: {postsError}</div>
            ) : posts.length > 0 ? (
              <>
                {posts.map(post => (
                  <SurveyCard
                    key={post.clientKey || post.id}
                    survey={post}
                    userProfile={userProfile}
                    contextGroups={[group]}
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
                    onClick={() => onCreatePost?.('Poll')}
                    className="mt-6 flex items-center gap-2 px-6 py-2 rounded-full font-bold text-sm shadow-lg active:scale-95 transition-all bg-blue-600 text-white shadow-blue-100"
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
                {group.description || 'No description provided for this group.'}
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
              <div className="p-4 bg-white border border-gray-100 rounded-2xl shadow-sm">
                <div className="text-[10px] font-black text-gray-400 uppercase mb-1">Membership</div>
                <div className="flex items-center gap-1.5 text-sm font-bold text-gray-900">
                  {group.joinPolicy === 'OPEN' && <><Globe size={13} className="text-green-600" /> Open</>}
                  {group.joinPolicy === 'REQUEST' && <><UserPlus size={13} className="text-blue-600" /> Request</>}
                  {group.joinPolicy === 'INVITE_ONLY' && <><Lock size={13} className="text-orange-600" /> Invite Only</>}
                  {!group.joinPolicy && <span className="text-gray-400">—</span>}
                </div>
              </div>
              <div className="p-4 bg-white border border-gray-100 rounded-2xl shadow-sm">
                <div className="text-[10px] font-black text-gray-400 uppercase mb-1">Members</div>
                <div className="text-sm font-bold text-gray-900">{isStatsLoading ? '—' : (stats?.membersCount || 0).toLocaleString()}</div>
              </div>
            </div>
            <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 flex items-start gap-3">
              <Info size={18} className="text-blue-600 mt-0.5" />
              <div className="flex-1">
                <h5 className="text-xs font-bold text-blue-900">Rules &amp; Guidelines</h5>
                <p className="text-[11px] text-blue-700 mt-1 leading-relaxed whitespace-pre-wrap">
                  {group.rules || `Respect all members, no spamming, and ensure polls are relevant to ${group.category}.`}
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
              <div className="flex flex-col">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex items-center gap-3 p-4 border-b border-gray-50 bg-white animate-pulse">
                    <div className="w-10 h-10 bg-gray-200 rounded-full shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 bg-gray-200 rounded-md w-1/4" />
                      <div className="h-2.5 bg-gray-200 rounded-md w-1/6" />
                    </div>
                  </div>
                ))}
              </div>
            ) : membersError ? (
              <div className="py-10 text-center text-red-500 text-sm">Error: {errorToText(membersError)}</div>
            ) : members.length > 0 ? (
              <div className="flex flex-col">
                {members.map((member: any) => (
                  <div key={member.id} className="flex items-center gap-3 p-4 border-b border-gray-50 bg-white">
                    <UserAvatar src={member.avatar} mediaId={member.avatarMediaId} media={member.avatarMedia} name={member.name} alt={member.name || 'Member'} size={40} className="border border-gray-100" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-gray-900 truncate">{member.name}</div>
                      <div className="text-xs text-gray-400">@{member.handle || '—'}</div>
                    </div>
                    {member.role === 'Owner' && (
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-yellow-100 to-orange-100 text-orange-600 text-[10px] font-black border border-orange-200 shrink-0">
                        <Crown size={9} strokeWidth={3} /> Owner
                      </div>
                    )}
                    {member.role === 'Admin' && (
                      <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-[10px] font-black border border-blue-100 shrink-0">
                        <Shield size={9} strokeWidth={3} /> Admin
                      </div>
                    )}
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
              <div className="p-10 text-center text-gray-400">No members found.</div>
            )}
          </div>
        );
    }
  };

  return (
    <div className="flex flex-col h-full bg-white animate-in slide-in-from-right duration-300 relative">
      {/* Toast */}
      {toastMessage && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white px-4 py-2 rounded-full shadow-lg text-sm font-medium animate-in slide-in-from-top fade-in duration-200 whitespace-nowrap">
          {toastMessage}
        </div>
      )}

      {/* Leave Confirm Bottom Sheet */}
      {showLeaveConfirm && (
        <div className="absolute inset-0 bg-black/50 z-40 flex items-end" onClick={() => setShowLeaveConfirm(false)}>
          <div className="w-full bg-white rounded-t-3xl p-6 animate-in slide-in-from-bottom" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-black text-gray-900 mb-1">Leave {group.name}?</h3>
            <p className="text-sm text-gray-500 mb-5">You may need to request to rejoin later.</p>
            <div className="flex gap-3">
              <button
                onClick={() => { setShowLeaveConfirm(false); leaveGroup(); }}
                className="flex-1 py-3 rounded-2xl bg-red-500 text-white font-bold text-sm hover:bg-red-600 active:scale-95 transition-all"
              >
                Leave
              </button>
              <button
                onClick={() => setShowLeaveConfirm(false)}
                className="flex-1 py-3 rounded-2xl bg-gray-100 text-gray-700 font-bold text-sm hover:bg-gray-200 active:scale-95 transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="absolute inset-0 bg-black/50 z-40 flex items-end" onClick={resetInviteModal}>
          <div
            className="w-full bg-white rounded-t-3xl flex flex-col max-h-[80vh] animate-in slide-in-from-bottom"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100 shrink-0">
              <div>
                <h3 className="text-base font-black text-gray-900">Invite to {group.name}</h3>
                <p className="text-xs text-gray-400 mt-0.5">Search for people to invite</p>
              </div>
              <button onClick={resetInviteModal} className="p-2 rounded-full hover:bg-gray-100 text-gray-500 transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="px-4 py-3 shrink-0">
              <input
                autoFocus
                type="text"
                placeholder="Search by name or @handle..."
                value={inviteQuery}
                onChange={e => setInviteQuery(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-gray-50 border border-gray-200 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all"
              />
            </div>

            {inviteResults.some(user => !invitedIds.has(user.id)) && (
              <div className="px-5 py-2 flex items-center justify-between border-b border-gray-50 shrink-0 bg-gray-50/50">
                <span className="text-[10px] font-bold text-gray-400 uppercase">Select multiple users to bulk invite</span>
                <button 
                  onClick={toggleSelectAllVisible}
                  className="text-xs font-bold text-blue-600 hover:text-blue-700"
                >
                  {inviteResults.filter(user => !invitedIds.has(user.id)).every(user => selectedInviteIds.has(user.id)) 
                    ? 'Deselect All' 
                    : 'Select All'}
                </button>
              </div>
            )}

            <div className="overflow-y-auto flex-1 px-4 pb-8">
              {inviteSearching ? (
                <div className="py-8 text-center text-gray-400 text-sm animate-pulse">Searching...</div>
              ) : inviteQuery.trim().length < 2 ? (
                <div className="py-8 text-center text-gray-400 text-sm">Type at least 2 characters to search</div>
              ) : inviteResults.length === 0 ? (
                <div className="py-8 text-center text-gray-400 text-sm">No users found</div>
              ) : (
                inviteResults.map((user: any) => {
                  const isInvited  = invitedIds.has(user.id);
                  const isSelected = selectedInviteIds.has(user.id);
                  const isLoadingU = inviteLoadingId === user.id;
                  return (
                    <div key={user.id} className="flex items-center gap-3 py-3 border-b border-gray-50 last:border-0">
                      {!isInvited && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectUser(user.id)}
                          className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500/20 border-gray-300"
                        />
                      )}
                      {isInvited && (
                        <div className="w-4 h-4 flex items-center justify-center text-green-600 shrink-0">
                          <Check size={14} strokeWidth={3} />
                        </div>
                      )}

                      <UserAvatar src={user.avatar} mediaId={user.avatarMediaId} media={user.avatarMedia} name={user.name} alt={user.name || 'User'} size={40} />
                      <div className="flex-1 min-w-0" onClick={() => !isInvited && toggleSelectUser(user.id)}>
                        <p className="text-sm font-bold text-gray-900 truncate">{user.name}</p>
                        <p className="text-xs text-gray-400">@{user.handle}</p>
                      </div>
                      <button
                        onClick={() => !isInvited && !isLoadingU && handleInviteUser(user.id)}
                        disabled={isInvited || isLoadingU}
                        className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all shrink-0 ${
                          isInvited
                            ? 'bg-green-50 text-green-600 border border-green-200'
                            : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95 shadow-sm'
                        } disabled:opacity-70`}
                      >
                        {isLoadingU ? '...' : isInvited ? 'Invited' : 'Invite'}
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {selectedInviteIds.size > 0 && (
              <div className="p-4 border-t border-gray-100 shrink-0 bg-white animate-in slide-in-from-bottom">
                <button
                  onClick={handleBulkInvite}
                  disabled={isBulkInviting}
                  className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl text-xs uppercase tracking-widest shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2"
                >
                  {isBulkInviting ? 'Inviting Selected...' : `Send Invites to ${selectedInviteIds.size} Users`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Header Image & Actions */}
      <div className="relative h-48 shrink-0">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-600 to-indigo-700">
          <MediaImage
            media={group.imageMedia}
            mediaId={group.imageMediaId}
            fallbackSrc={group.image?.includes('ui-avatars') ? undefined : group.image}
            fallback={<span className="block h-full w-full" aria-hidden="true" />}
            alt=""
            className="w-full h-full object-cover opacity-60"
          />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

        {/* Navigation Actions */}
        <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between z-10 safe-top">
          <button onClick={onBack} className="p-2 bg-white/20 backdrop-blur-md text-white rounded-full hover:bg-white/30 transition-colors">
            <ArrowLeft size={24} />
          </button>
          <div className="flex items-center gap-2">
            {/* Invite button */}
            {isJoined && permissions.canInviteMembers && (
              <button
                onClick={() => setShowInviteModal(true)}
                className="p-2 bg-white/20 backdrop-blur-md text-white rounded-full hover:bg-white/30 transition-colors"
                title="Invite members"
              >
                <UserPlus size={20} />
              </button>
            )}
            {/* Share button */}
            <button
              onClick={() => {
                const url = getGroupShareUrl
                  ? getGroupShareUrl(group.id)
                  : (typeof window !== 'undefined' ? `${window.location.origin}/groups/${group.id}` : '');
                if (url) copyText(url);
              }}
              className="p-2 bg-white/20 backdrop-blur-md text-white rounded-full hover:bg-white/30 transition-colors"
            >
              <Share2 size={20} />
            </button>
            {/* Settings button */}
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
              <MediaImage
                media={group.imageMedia}
                mediaId={group.imageMediaId}
                fallbackSrc={group.image?.includes('ui-avatars') ? undefined : group.image}
                fallback={<span role="img" aria-label={group.name} className="flex h-full w-full items-center justify-center rounded-[1.25rem] bg-gray-100 text-2xl font-black text-gray-500">{group.name.trim().charAt(0).toUpperCase()}</span>}
                alt={group.name}
                className="w-full h-full rounded-[1.25rem] object-cover"
              />
            </div>
            <div className="pb-1">
              <h1 className="text-xl font-black text-white leading-none mb-1.5 drop-shadow-md">{group.name}</h1>
              <div className="flex items-center gap-2 text-white/90 text-xs font-bold">
                <span className="flex items-center gap-1">
                  <Users size={12} strokeWidth={3} /> {isStatsLoading ? '-' : (stats?.membersCount || 0).toLocaleString()}
                </span>
                <span>•</span>
                <span className="uppercase tracking-widest text-[9px] bg-white/20 px-2 py-0.5 rounded backdrop-blur-sm">{group.category}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats & Actions Row */}
      <div className="px-5 py-4 flex items-center justify-between border-b border-gray-50">
        <div className="flex gap-5">
          <div className="flex flex-col">
            <span className="text-xs font-black text-gray-900">{isStatsLoading ? '-' : (stats?.membersCount || 0).toLocaleString()}</span>
            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Members</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-black text-gray-900">{isStatsLoading ? '-' : (stats?.postsCount || 0)}</span>
            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Posts</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-black text-gray-900">{isStatsLoading ? '-' : (stats?.votesCount || 0).toLocaleString()}</span>
            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Votes</span>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          {renderMembershipButton()}
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
            className={`flex-1 py-3.5 text-xs font-black uppercase tracking-widest transition-all relative ${
              activeTab === tab.id ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'
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
