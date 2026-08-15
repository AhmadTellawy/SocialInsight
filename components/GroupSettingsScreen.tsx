import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Shield, Users, UserPlus, Link, Mail,
  MessageSquare, Trash2, AlertTriangle, Check, UserMinus,
  Globe, Info, UserCheck, X, Ban
} from 'lucide-react';
import { Group, MediaDraft, Survey } from '../types';
import { useGroupMembers, useGroupPendingRequests, useGroupPendingPosts } from '../hooks/useGroup';
import { MediaPicker } from './media/MediaPicker';
import { createPersistedMediaDraftFromId, mediaDraftsAreReady, mediaDraftsHaveErrors, readyMediaAssetIds } from '../utils/mediaDrafts';
import { UserAvatar } from './UserAvatar';

export type JoinPolicy = 'OPEN' | 'REQUEST' | 'INVITE_ONLY';
export type PostingPerms = 'AdminsOnly' | 'AllMembers' | 'ApprovalNeeded';

export interface GroupUpdatePayload {
  joinPolicy?: JoinPolicy;
  postingPermissions?: PostingPerms;
  name?: string;
  description?: string;
  category?: string;
  image?: string;
  imageMediaId?: string | null;
  rules?: string;
}

export type GroupRole = 'Owner' | 'Admin' | 'Member';

interface GroupSettingsScreenProps {
  group: Group;
  currentUserId: string;
  onBack: () => void;
  onUpdateGroup: (id: string, updates: GroupUpdatePayload) => Promise<Group | void>;
  onDeleteGroup: (id: string) => Promise<void>;
  onManageRoles?: (memberId: string, newRole: GroupRole) => Promise<void>;
  onInviteManager?: () => void;
  onKickMember?: (memberId: string) => Promise<void>;
  onBanMember?: (memberId: string) => Promise<void>;
  onUnbanMember?: (memberId: string) => Promise<void>;
  onApproveJoinRequest?: (memberId: string) => Promise<void>;
  onRejectJoinRequest?: (memberId: string) => Promise<void>;
  onApprovePendingPost?: (postId: string) => Promise<void>;
  onRejectPendingPost?: (postId: string, reason: string) => Promise<void>;
}

const PendingPostRow: React.FC<{
  post: any;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string, reason: string) => Promise<void>;
}> = ({ post, onApprove, onReject }) => {
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleReject = async () => {
    if (!reason.trim()) return;
    try {
      setIsSubmitting(true);
      await onReject(post.id, reason);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
      setShowRejectForm(false);
    }
  };

  return (
    <div className="p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1.5">
            <UserAvatar src={post.author?.avatar} name={post.author?.name} alt={post.author?.name || 'Anonymous'} size={20} className="border border-gray-100" />
            <span className="text-[10px] font-bold text-gray-500">{post.author?.name || 'Anonymous'}</span>
          </div>
          <h4 className="text-sm font-bold text-gray-900 leading-snug">{post.title}</h4>
          <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">{post.description}</p>
        </div>

        {!showRejectForm && (
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => onApprove(post.id)}
              className="p-1.5 rounded-lg bg-green-50 text-green-600 hover:bg-green-100 transition-all"
              title="Approve & Publish"
            >
              <Check size={16} strokeWidth={2.5} />
            </button>
            <button
              onClick={() => setShowRejectForm(true)}
              className="p-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-all"
              title="Reject"
            >
              <X size={16} strokeWidth={2.5} />
            </button>
          </div>
        )}
      </div>

      {showRejectForm && (
        <div className="bg-gray-50 rounded-xl p-3 border border-gray-100 animate-in fade-in slide-in-from-top duration-200">
          <p className="text-[10px] font-bold text-gray-400 mb-1.5 uppercase tracking-wider">Rejection Reason</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this post is rejected..."
              className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
            />
            <button
              onClick={handleReject}
              disabled={!reason.trim() || isSubmitting}
              className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-bold disabled:opacity-50"
            >
              Send
            </button>
            <button
              onClick={() => { setShowRejectForm(false); setReason(''); }}
              disabled={isSubmitting}
              className="px-3 py-1.5 bg-gray-200 text-gray-600 rounded-lg text-xs font-bold"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export const GroupSettingsScreen: React.FC<GroupSettingsScreenProps> = ({
  group,
  currentUserId,
  onBack,
  onUpdateGroup,
  onDeleteGroup,
  onManageRoles,
  onInviteManager,
  onKickMember,
  onBanMember,
  onUnbanMember,
  onApproveJoinRequest,
  onRejectJoinRequest,
  onApprovePendingPost,
  onRejectPendingPost
}) => {
  const [activeJoinPolicy, setActiveJoinPolicy] = useState<JoinPolicy>((group.joinPolicy as JoinPolicy) || 'OPEN');
  const [activePostingPerms, setActivePostingPerms] = useState<PostingPerms>((group.postingPermissions as PostingPerms) || 'AllMembers');

  const { members, isLoading: isMembersLoading, error: membersError, refresh: refreshMembers } = useGroupMembers(group.id);
  const { requests, isLoading: isRequestsLoading, error: requestsError, refresh: refreshRequests } = useGroupPendingRequests(group.id);
  const { pendingPosts, isLoading: isPostsLoading, error: postsError, refresh: refreshPosts } = useGroupPendingPosts(group.id);
  const [bannedMembers, setBannedMembers] = useState<any[]>([]);
  const [isBannedLoading, setIsBannedLoading] = useState(false);
  const [showBannedSection, setShowBannedSection] = useState(false);

  const [name, setName] = useState(group.name || '');
  const [description, setDescription] = useState(group.description || '');
  const [category, setCategory] = useState(group.category || 'Other');
  const [groupMedia, setGroupMedia] = useState<MediaDraft[]>(() => group.imageMediaId
    ? [createPersistedMediaDraftFromId(group.imageMediaId, 'GROUP_IMAGE', group.image)]
    : []);
  const [rules, setRules] = useState(group.rules || '');
  const [isSavingInfo, setIsSavingInfo] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');

  useEffect(() => {
    setActiveJoinPolicy((group.joinPolicy as JoinPolicy) || 'OPEN');
    setActivePostingPerms((group.postingPermissions as PostingPerms) || 'AllMembers');
    setName(group.name || '');
    setDescription(group.description || '');
    setCategory(group.category || 'Other');
    setGroupMedia(group.imageMediaId
      ? [createPersistedMediaDraftFromId(group.imageMediaId, 'GROUP_IMAGE', group.image)]
      : []);
    setRules(group.rules || '');
  }, [group.id, group.joinPolicy, group.postingPermissions, group.name, group.description, group.category, group.image, group.imageMediaId, group.rules]);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [confirmName, setConfirmName] = useState('');

  const [isSavingJoin, setIsSavingJoin] = useState(false);
  const [isSavingPosting, setIsSavingPosting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const permissions = group.permissions || {
    canViewGroup: true,
    canViewMembers: true,
    postRequiresApproval: false,
    canPost: false,
    canManageSettings: false,
    canManageRoles: false,
    canManageMembers: false,
    canDeleteGroup: false,
    canInviteMembers: false,
    canApproveRequests: false
  };

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToastMessage(null), 3000);
  };

  const handleUpdateJoinPolicy = async (policy: JoinPolicy) => {
    if (!permissions.canManageSettings || isSavingJoin) return;
    const prev = activeJoinPolicy;
    setActiveJoinPolicy(policy);
    try {
      setIsSavingJoin(true);
      await onUpdateGroup(group.id, { joinPolicy: policy });
      showToast('Join policy updated');
    } catch (e) {
      setActiveJoinPolicy(prev);
      showToast('Failed to update join policy', 'error');
    } finally {
      setIsSavingJoin(false);
    }
  };

  const handleUpdatePostingPerms = async (perms: PostingPerms) => {
    if (!permissions.canManageSettings || isSavingPosting) return;
    const prev = activePostingPerms;
    setActivePostingPerms(perms);
    try {
      setIsSavingPosting(true);
      await onUpdateGroup(group.id, { postingPermissions: perms });
      showToast('Posting permissions updated');
    } catch (e) {
      setActivePostingPerms(prev);
      showToast('Failed to update posting permissions', 'error');
    } finally {
      setIsSavingPosting(false);
    }
  };

  const toggleAdmin = async (memberId: string, currentRole: GroupRole) => {
    if (!permissions.canManageRoles || !onManageRoles) return;
    const newRole: GroupRole = currentRole === 'Admin' ? 'Member' : 'Admin';
    try {
      await onManageRoles(memberId, newRole);
      showToast('Role updated');
      refreshMembers();
    } catch (e) {
      showToast('Failed to update role', 'error');
    }
  };

  const handleKick = async (memberId: string) => {
    // ✅ Fixed: use canManageMembers, not canManageRoles
    if (!permissions.canManageMembers || !onKickMember) return;
    try {
      await onKickMember(memberId);
      showToast('Member removed');
      refreshMembers();
    } catch (e) {
      showToast('Failed to remove member', 'error');
    }
  };

  const handleBan = async (memberId: string) => {
    // ✅ Fixed: use canManageMembers, not canManageRoles
    if (!permissions.canManageMembers || !onBanMember) return;
    try {
      await onBanMember(memberId);
      showToast('Member banned');
      refreshMembers();
    } catch (e) {
      showToast('Failed to ban member', 'error');
    }
  };

  const loadBannedMembers = async () => {
    if (!onUnbanMember && !permissions.canManageMembers) return;
    setIsBannedLoading(true);
    try {
      const { api } = await import('../services/api');
      const banned = await api.getBannedMembers(group.id);
      setBannedMembers(banned);
      setShowBannedSection(true);
    } catch (e) {
      showToast('Failed to load banned members', 'error');
    } finally {
      setIsBannedLoading(false);
    }
  };

  const handleUnban = async (memberId: string) => {
    if (!onUnbanMember) return;
    try {
      await onUnbanMember(memberId);
      showToast('Member unbanned');
      setBannedMembers(prev => prev.filter(m => m.id !== memberId));
    } catch (e) {
      showToast('Failed to unban member', 'error');
    }
  };

  const handleApproveRequest = async (memberId: string) => {
    if (!onApproveJoinRequest) return;
    try {
      await onApproveJoinRequest(memberId);
      showToast('Join request approved');
      refreshRequests();
      refreshMembers();
    } catch (e) {
      showToast('Failed to approve join request', 'error');
    }
  };

  const handleRejectRequest = async (memberId: string) => {
    if (!onRejectJoinRequest) return;
    try {
      await onRejectJoinRequest(memberId);
      showToast('Join request rejected');
      refreshRequests();
    } catch (e) {
      showToast('Failed to reject join request', 'error');
    }
  };

  const handleApprovePost = async (postId: string) => {
    if (!onApprovePendingPost) return;
    try {
      await onApprovePendingPost(postId);
      showToast('Post approved');
      refreshPosts();
    } catch (e) {
      showToast('Failed to approve post', 'error');
    }
  };

  const handleRejectPost = async (postId: string, reason: string) => {
    if (!onRejectPendingPost) return;
    try {
      await onRejectPendingPost(postId, reason);
      showToast('Post rejected');
      refreshPosts();
    } catch (e) {
      showToast('Failed to reject post', 'error');
    }
  };

  const handleDelete = async () => {
    if (confirmName !== group.name || isDeleting || !permissions.canDeleteGroup) return;
    try {
      setIsDeleting(true);
      await onDeleteGroup(group.id);
      showToast('Group deleted successfully');
      setShowDeleteModal(false);
    } catch (e) {
      showToast('Failed to delete group', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSaveDetails = async () => {
    if (!name.trim()) {
      showToast('Group name is required', 'error');
      return;
    }
    try {
      setIsSavingInfo(true);
      const nextImageMediaId = readyMediaAssetIds(groupMedia)[0];
      const mediaChanged = nextImageMediaId !== group.imageMediaId;
      const updated = await onUpdateGroup(group.id, {
        name: name.trim(),
        description: description.trim(),
        category,
        ...(mediaChanged ? { imageMediaId: nextImageMediaId || null } : {}),
        rules: rules.trim()
      });
      if (updated?.imageMediaId) {
        setGroupMedia([createPersistedMediaDraftFromId(updated.imageMediaId, 'GROUP_IMAGE', updated.image)]);
      } else if (updated && !updated.imageMediaId) {
        setGroupMedia([]);
      }
      showToast('Group profile updated successfully');
    } catch (e: any) {
      showToast(e.message || 'Failed to update group profile', 'error');
    } finally {
      setIsSavingInfo(false);
    }
  };

  const filteredMembers = members.filter(member => 
    (member.name || '').toLowerCase().includes(memberSearch.toLowerCase()) ||
    (member.handle || '').toLowerCase().includes(memberSearch.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-gray-50 animate-in slide-in-from-right duration-300 relative">
      {/* Toast */}
      {toastMessage && (
        <div className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full shadow-lg text-sm font-medium animate-in slide-in-from-top fade-in duration-200 ${toastMessage.type === 'error' ? 'bg-red-600 text-white' : 'bg-gray-900 text-white'
          }`}>
          {toastMessage.text}
        </div>
      )}

      {/* Header */}
      <div className="bg-white border-b border-gray-100 flex items-center px-4 h-14 sticky top-0 z-20">
        <button onClick={onBack} className="p-2 -ml-2 text-gray-600 hover:bg-gray-50 rounded-full transition-colors">
          <ArrowLeft size={24} />
        </button>
        <span className="font-bold text-lg ml-2">Group Settings</span>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar pb-10">
        {/* Section: Edit Group Profile */}
        {permissions.canManageSettings && (
          <div className="mt-4 px-4">
            <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 px-1">Group Profile</h3>
            <div className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-col gap-4">
              {/* Image Uploader */}
              <div className="flex items-center gap-4">
                <MediaPicker
                  purpose="GROUP_IMAGE"
                  value={groupMedia}
                  onChange={setGroupMedia}
                  renderContent={({ open, retry, busy }) => {
                    const current = groupMedia[0];
                    const previewUrl = current?.previewUrl || group.image;
                    return (
                      <button
                        type="button"
                        onClick={() => current?.status === 'error' ? retry(current.clientId) : open()}
                        disabled={busy}
                        className={`w-16 h-16 rounded-2xl bg-gray-50 border overflow-hidden relative cursor-pointer group shrink-0 disabled:cursor-wait ${current?.status === 'error' ? 'border-red-400' : 'border-gray-100'}`}
                        aria-label={current?.status === 'error' ? 'Retry group image upload' : 'Change group avatar'}
                        title={current?.status === 'error' ? 'Retry' : 'Change group avatar'}
                      >
                        {previewUrl ? (
                          <img src={previewUrl} alt="Group Avatar" className="w-full h-full object-cover" />
                        ) : (
                          <span className="w-full h-full flex items-center justify-center bg-blue-50 text-blue-700 text-lg font-black">
                            {(name || 'G').trim().charAt(0).toUpperCase()}
                          </span>
                        )}
                        <span className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity text-white text-[10px] font-bold ${busy ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                          {busy ? '...' : 'Change'}
                        </span>
                      </button>
                    );
                  }}
                />
                <div className="flex-1">
                  <p className="text-xs font-bold text-gray-900">Group Avatar</p>
                  <p className="text-[10px] text-gray-400 leading-normal mt-0.5">JPEG, PNG, or WebP. Max size 15MB.</p>
                </div>
              </div>

              {/* Name Input */}
              <div>
                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Group Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Group Name"
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              {/* Description Input */}
              <div>
                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe your group..."
                  rows={3}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none"
                />
              </div>

              {/* Category Dropdown */}
              <div>
                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                >
                  {[
                    'Hobby & Interests',
                    'Education & Study',
                    'Non-Profit & Community',
                    'Gaming & Esports',
                    'Health & Wellness',
                    'Professional Networking',
                    'Technology',
                    'Marketing',
                    'Finance',
                    'Consumer Goods',
                    'Retail',
                    'Other'
                  ].map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              {/* Rules Input */}
              <div>
                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Group Rules & Guidelines</label>
                <textarea
                  value={rules}
                  onChange={(e) => setRules(e.target.value)}
                  placeholder="Define guidelines for members..."
                  rows={4}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none"
                />
              </div>

              <button
                onClick={handleSaveDetails}
                disabled={isSavingInfo || !mediaDraftsAreReady(groupMedia) || mediaDraftsHaveErrors(groupMedia)}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-200 transition-all flex items-center justify-center disabled:opacity-50"
              >
                {isSavingInfo ? 'Saving Changes...' : 'Save Profile Details'}
              </button>
            </div>
          </div>
        )}

        <div className="mt-8 px-4">
          <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 px-1">Join Policy</h3>
          <div className={`bg-white rounded-2xl border border-gray-100 overflow-hidden ${!permissions.canManageSettings ? 'opacity-70 pointer-events-none' : ''}`}>
            {[
              { id: 'OPEN', label: 'Open to everyone', desc: 'Anyone can join the group instantly.', icon: Globe },
              { id: 'REQUEST', label: 'Request approval', desc: 'Admins must approve new join requests.', icon: UserPlus },
              { id: 'INVITE_ONLY', label: 'Invitation only', desc: 'Members can only be added by invitation.', icon: Mail },
            ].map((policy) => (
              <button
                key={policy.id}
                onClick={() => handleUpdateJoinPolicy(policy.id as JoinPolicy)}
                disabled={!permissions.canManageSettings || isSavingJoin}
                className="w-full flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0 text-left group disabled:opacity-50"
              >
                <div className={`p-2.5 rounded-xl transition-colors ${activeJoinPolicy === policy.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                  <policy.icon size={20} />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-gray-900">{policy.label}</p>
                  <p className="text-[10px] text-gray-500 leading-tight mt-0.5">{policy.desc}</p>
                </div>
                {activeJoinPolicy === policy.id && (
                  <div className="w-5 h-5 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center">
                    <Check size={14} strokeWidth={3} />
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Section: Posting Permissions */}
        <div className="mt-8 px-4">
          <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 px-1">Posting Permissions</h3>
          <div className={`bg-white rounded-2xl border border-gray-100 overflow-hidden ${!permissions.canManageSettings ? 'opacity-70 pointer-events-none' : ''}`}>
            {[
              { id: 'AdminsOnly', label: 'Owner & Admins only', desc: 'Only managers can publish content.', icon: Shield },
              { id: 'AllMembers', label: 'All members', desc: 'Everyone in the group can share surveys.', icon: Users },
              { id: 'ApprovalNeeded', label: 'Members with admin approval', desc: 'Posts must be reviewed by admins.', icon: MessageSquare },
            ].map((perm) => (
              <button
                key={perm.id}
                onClick={() => handleUpdatePostingPerms(perm.id as PostingPerms)}
                disabled={!permissions.canManageSettings || isSavingPosting}
                className="w-full flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0 text-left group disabled:opacity-50"
              >
                <div className={`p-2.5 rounded-xl transition-colors ${activePostingPerms === perm.id ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
                  <perm.icon size={20} />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-gray-900">{perm.label}</p>
                  <p className="text-[10px] text-gray-500 leading-tight mt-0.5">{perm.desc}</p>
                </div>
                {activePostingPerms === perm.id && (
                  <div className="w-5 h-5 bg-green-50 text-green-600 rounded-full flex items-center justify-center">
                    <Check size={14} strokeWidth={3} />
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Section: Pending Join Requests */}
        {permissions.canApproveRequests && (
          <div className="mt-8 px-4 animate-in fade-in duration-200">
            <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 px-1">Pending Join Requests</h3>
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden divide-y divide-gray-50">
              {isRequestsLoading ? (
                <div className="p-6 text-center text-gray-400 text-xs font-bold animate-pulse">Loading requests...</div>
              ) : requestsError ? (
                <div className="p-6 text-center text-red-500 text-xs font-bold">Failed to load requests</div>
              ) : requests.length === 0 ? (
                <div className="p-6 text-center text-gray-400 text-xs">No pending join requests</div>
              ) : requests.map(req => (
                <div key={req.id} className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <UserAvatar src={req.avatar} name={req.name} alt={req.name || 'User'} size={40} className="border border-gray-200" />
                    <div>
                      <p className="text-sm font-bold text-gray-900">{req.name}</p>
                      <p className="text-[10px] text-gray-400">@{req.handle}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleApproveRequest(req.id)}
                      className="px-3 py-1.5 rounded-lg bg-green-50 text-green-600 hover:bg-green-100 text-xs font-bold transition-all"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleRejectRequest(req.id)}
                      className="px-3 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 text-xs font-bold transition-all"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Section: Pending Posts Queue */}
        {permissions.canApproveRequests && (
          <div className="mt-8 px-4 animate-in fade-in duration-200">
            <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 px-1">Pending Posts Queue</h3>
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden divide-y divide-gray-50">
              {isPostsLoading ? (
                <div className="p-6 text-center text-gray-400 text-xs font-bold animate-pulse">Loading pending posts...</div>
              ) : postsError ? (
                <div className="p-6 text-center text-red-500 text-xs font-bold">Failed to load pending posts</div>
              ) : pendingPosts.length === 0 ? (
                <div className="p-6 text-center text-gray-400 text-xs">No pending posts in queue</div>
              ) : pendingPosts.map(post => (
                <PendingPostRow
                  key={post.id}
                  post={post}
                  onApprove={handleApprovePost}
                  onReject={handleRejectPost}
                />
              ))}
            </div>
          </div>
        )}

        {/* Section: Roles & Management */}
        <div className="mt-8 px-4">
          <div className="flex items-center justify-between mb-3 px-1">
            <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Roles & Management</h3>
            {permissions.canInviteMembers && (
              <button
                onClick={onInviteManager}
                disabled={!onInviteManager}
                className="text-[10px] font-bold text-blue-600 uppercase flex items-center gap-1 disabled:opacity-50"
              >
                <UserPlus size={12} /> Add Manager
              </button>
            )}
          </div>

          {/* Member Search Bar */}
          <div className="mb-3 px-1">
            <input
              type="text"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder="Search members by name or handle..."
              className="w-full bg-white border border-gray-150 rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden divide-y divide-gray-50">
            {isMembersLoading ? (
              <div className="p-8 text-center text-gray-400 text-xs font-bold animate-pulse">Loading members...</div>
            ) : membersError ? (
              <div className="p-8 text-center text-red-500 text-xs font-bold">Failed to load members</div>
            ) : filteredMembers.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-xs">No members found matching "{memberSearch}"</div>
            ) : filteredMembers.map(member => {
              const isMe = member.id === currentUserId;
              const isOwnerRole = member.role === 'Owner';
              const isAdminRole = member.role === 'Admin';

              return (
                <div key={member.id} className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <UserAvatar src={member.avatar} name={member.name} alt={member.name || 'Member'} size={40} className="border border-gray-200" />
                    <div>
                      <p className="text-sm font-bold text-gray-900">
                        {member.name} {isMe && '(You)'}
                      </p>

                      {isOwnerRole ? (
                        <div className="flex items-center gap-1 text-blue-600">
                          <Shield size={10} strokeWidth={3} />
                          <span className="text-[9px] font-black uppercase tracking-wider">Owner</span>
                        </div>
                      ) : (
                        <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${isAdminRole ? 'bg-purple-50 text-purple-600' : 'bg-gray-100 text-gray-500'}`}>
                          {member.role}
                        </span>
                      )}
                    </div>
                  </div>

                  {(permissions.canManageRoles || (permissions.canManageMembers && !isAdminRole)) && !isOwnerRole && !isMe && (
                    <div className="flex items-center gap-1.5">
                      {permissions.canManageRoles && (
                        <button
                          onClick={() => toggleAdmin(member.id, member.role as GroupRole)}
                          className={`p-2 rounded-xl transition-all ${isAdminRole ? 'bg-purple-50 text-purple-600 hover:bg-purple-100' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
                          title={isAdminRole ? "Remove Admin" : "Make Admin"}
                        >
                          {isAdminRole ? <UserMinus size={18} /> : <UserCheck size={18} />}
                        </button>
                      )}
                      {(permissions.canManageRoles || (!isAdminRole && permissions.canManageMembers)) && (
                        <>
                          <button
                            onClick={() => handleKick(member.id)}
                            className="p-2 rounded-xl bg-orange-50 text-orange-500 hover:bg-orange-100 transition-all"
                            title="Kick Member"
                          >
                            <UserMinus size={18} />
                          </button>
                          <button
                            onClick={() => handleBan(member.id)}
                            className="p-2 rounded-xl bg-red-50 text-red-500 hover:bg-red-100 transition-all"
                            title="Ban Member"
                          >
                            <Ban size={18} />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-start gap-2 px-1">
            <Info size={12} className="text-gray-400 mt-0.5 shrink-0" />
            <p className="text-[10px] text-gray-500 leading-tight">Admins can manage content and members but cannot delete the group or transfer ownership.</p>
          </div>
        </div>

        {/* Banned Members Section */}
        {permissions.canManageMembers && (
          <div className="mt-8 px-4">
            <div className="flex items-center justify-between mb-3 px-1">
              <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Banned Members</h3>
              <button
                onClick={showBannedSection ? () => setShowBannedSection(false) : loadBannedMembers}
                disabled={isBannedLoading}
                className="text-[10px] font-bold text-red-500 uppercase flex items-center gap-1 disabled:opacity-50"
              >
                <Ban size={12} /> {isBannedLoading ? 'Loading...' : showBannedSection ? 'Hide' : 'View Banned'}
              </button>
            </div>
            {showBannedSection && (
              <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden divide-y divide-gray-50 animate-in fade-in duration-200">
                {bannedMembers.length === 0 ? (
                  <div className="p-6 text-center text-gray-400 text-xs">No banned members</div>
                ) : bannedMembers.map(member => (
                  <div key={member.id} className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <UserAvatar src={member.avatar} name={member.name} alt={member.name || 'Member'} size={36} className="border border-gray-200 grayscale" />
                      <div>
                        <p className="text-sm font-bold text-gray-700">{member.name}</p>
                        <span className="text-[9px] font-black uppercase tracking-wider text-red-500">Banned</span>
                      </div>
                    </div>
                    {onUnbanMember && (
                      <button
                        onClick={() => handleUnban(member.id)}
                        className="px-3 py-1.5 rounded-lg bg-green-50 text-green-600 hover:bg-green-100 text-xs font-bold transition-all"
                      >
                        Unban
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Danger Zone */}
        {permissions.canDeleteGroup && (
          <div className="mt-12 px-4 pb-12">
            <div className="bg-red-50/50 rounded-3xl border border-red-100 p-6">
              <div className="flex items-center gap-2 mb-4 text-red-600">
                <AlertTriangle size={20} strokeWidth={2.5} />
                <h3 className="font-black text-xs uppercase tracking-[0.2em]">Danger Zone</h3>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed mb-6">
                Deleting this group is permanent and will remove all content, data, and members. This action cannot be undone.
              </p>
              <button
                onClick={() => setShowDeleteModal(true)}
                className="w-full bg-red-600 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-red-200 active:scale-95 transition-all flex items-center justify-center gap-2"
              >
                <Trash2 size={14} /> Delete This Group
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-white rounded-[2.5rem] p-8 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200 text-center">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Trash2 size={32} />
            </div>
            <h3 className="text-xl font-black text-gray-900 mb-2">Are you sure?</h3>
            <p className="text-sm text-gray-500 mb-8 leading-relaxed">
              To confirm deletion, please type the group name <span className="font-black text-gray-900">"{group.name}"</span> below.
            </p>

            <input
              type="text"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder="Type group name..."
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-4 focus:ring-red-500/5 focus:border-red-500 mb-6 text-center"
            />

            <div className="flex flex-col gap-2">
              <button
                onClick={handleDelete}
                disabled={confirmName !== group.name || isDeleting}
                className="w-full py-4 bg-red-600 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                {isDeleting ? 'Deleting...' : 'Delete Permanently'}
              </button>
              <button
                onClick={() => { setShowDeleteModal(false); setConfirmName(''); }}
                disabled={isDeleting}
                className="w-full py-4 bg-gray-100 text-gray-600 rounded-2xl font-black uppercase tracking-widest text-[10px] active:scale-95 transition-all disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
