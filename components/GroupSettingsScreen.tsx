
import React, { useState, useRef, useEffect } from 'react';
import {
  ArrowLeft, Shield, Users, UserPlus, Link, Mail,
  MessageSquare, Trash2, AlertTriangle, Check, UserMinus,
  Globe, Info, UserCheck
} from 'lucide-react';
import { Group, UserProfile } from '../types';
import { useGroupMembers } from '../hooks/useGroup';

export type JoinPolicy = 'OPEN' | 'REQUEST' | 'INVITE_ONLY';
export type PostingPerms = 'AdminsOnly' | 'AllMembers' | 'ApprovalNeeded';

export interface GroupUpdatePayload {
  joinPolicy?: JoinPolicy;
  postingPermissions?: PostingPerms;
  // include other group fields as needed
}

export type GroupRole = 'Owner' | 'Admin' | 'Moderator' | 'Member';

export interface GroupMember {
  id: string;
  name: string;
  avatar: string;
  role: GroupRole;
}

interface GroupSettingsScreenProps {
  group: Group;
  currentUserId: string;
  onBack: () => void;
  onUpdateGroup: (id: string, updates: GroupUpdatePayload) => Promise<void>;
  onDeleteGroup: (id: string) => Promise<void>;
  onManageRoles?: (memberId: string, newRole: GroupRole) => Promise<void>;
  onInviteManager?: () => void;
}

export const GroupSettingsScreen: React.FC<GroupSettingsScreenProps> = ({
  group,
  currentUserId,
  onBack,
  onUpdateGroup,
  onDeleteGroup,
  onManageRoles,
  onInviteManager
}) => {
  const [activeJoinPolicy, setActiveJoinPolicy] = useState<JoinPolicy>((group.joinPolicy as JoinPolicy) || 'OPEN');
  const [activePostingPerms, setActivePostingPerms] = useState<PostingPerms>((group.postingPermissions as PostingPerms) || 'AllMembers');

  const { members, isLoading: isMembersLoading, error: membersError } = useGroupMembers(group.id);

  useEffect(() => {
    setActiveJoinPolicy((group.joinPolicy as JoinPolicy) || 'OPEN');
    setActivePostingPerms((group.postingPermissions as PostingPerms) || 'AllMembers');
  }, [group.id, group.joinPolicy, group.postingPermissions]);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [confirmName, setConfirmName] = useState('');

  const [isSavingJoin, setIsSavingJoin] = useState(false);
  const [isSavingPosting, setIsSavingPosting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const permissions = group.permissions || {
    canManageSettings: false,
    canManageRoles: false,
    canDeleteGroup: false,
    canInviteMembers: false,
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
    } catch (e) {
      showToast('Failed to update role', 'error');
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
        <div className="mt-4 px-4">
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
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden divide-y divide-gray-50">
            {isMembersLoading ? (
              <div className="p-8 text-center text-gray-400 text-xs font-bold animate-pulse">Loading members...</div>
            ) : membersError ? (
              <div className="p-8 text-center text-red-500 text-xs font-bold">Failed to load members</div>
            ) : members.map(member => {
              const isMe = member.id === currentUserId;
              const isOwnerRole = member.role === 'Owner';
              const isAdminRole = member.role === 'Admin';

              return (
                <div key={member.id} className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <img
                      src={member.avatar || 'https://picsum.photos/100'}
                      className="w-10 h-10 rounded-full border border-gray-200"
                      alt=""
                      onError={(e) => (e.currentTarget.src = 'https://picsum.photos/100')}
                    />
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

                  {permissions.canManageRoles && !isOwnerRole && !isMe && (
                    <button
                      onClick={() => toggleAdmin(member.id, member.role as GroupRole)}
                      className={`p-2 rounded-xl transition-all ${isAdminRole ? 'bg-red-50 text-red-500 hover:bg-red-100' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
                      title={isAdminRole ? "Remove Admin" : "Make Admin"}
                    >
                      {isAdminRole ? <UserMinus size={18} /> : <UserCheck size={18} />}
                    </button>
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
