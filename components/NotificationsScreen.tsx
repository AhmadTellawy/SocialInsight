
import React, { useState } from 'react';
import { ArrowLeft, Trash2, User, PieChart, FileText, Users, Clock, Trophy, Bell, Heart, UserPlus } from 'lucide-react';
import { Notification } from '../types';
import { api } from '../services/api';
import { UserAvatar } from './UserAvatar';
import { useTranslation } from 'react-i18next';

interface NotificationsScreenProps {
  notifications: Notification[];
  onNotificationsChange: (notifications: Notification[]) => void;
  onBack: () => void;
  onItemClick: (notification: Notification) => void;
  currentUserId?: string;
  hasMore?: boolean;
  isInitialLoading?: boolean;
  isLoadingMore?: boolean;
  loadError?: string | null;
  onLoadMore?: () => void;
  onRetry?: () => void;
}

export const NotificationsScreen: React.FC<NotificationsScreenProps> = ({
  notifications,
  onNotificationsChange,
  onBack,
  onItemClick,
  currentUserId,
  hasMore = false,
  isInitialLoading = false,
  isLoadingMore = false,
  loadError = null,
  onLoadMore,
  onRetry,
}) => {
  const { t } = useTranslation();
  const getTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return `${diffInDays}d ago`;
    const diffInWeeks = Math.floor(diffInDays / 7);
    return `${diffInWeeks}w ago`;
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  const handleMarkAllRead = () => {
    onNotificationsChange(notifications.map(n => ({ ...n, isRead: true })));
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onNotificationsChange(notifications.filter(n => n.id !== id));
  };

  const handleItemClick = (notification: Notification) => {
    if (!notification.isRead) {
      onNotificationsChange(notifications.map(n => n.id === notification.id ? { ...n, isRead: true } : n));
    }
    onItemClick(notification);
  };

  const handleAcceptRequest = async (id: string, actorId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.acceptFollowRequest(actorId);
      onNotificationsChange(notifications.filter(n => n.id !== id));
    } catch (err) {
      console.error('Failed to accept request', err);
    }
  };

  const handleRejectRequest = async (id: string, actorId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.rejectFollowRequest(actorId);
      onNotificationsChange(notifications.filter(n => n.id !== id));
    } catch (err) {
      console.error('Failed to reject request', err);
    }
  };

  const handleAcceptPeopleTag = async (notification: Notification, event: React.MouseEvent) => {
    event.stopPropagation();
    const tagId = notification.payload?.peopleTagId;
    if (!tagId) return;
    try {
      await api.acceptPeopleTag(tagId);
      onNotificationsChange(notifications.map((item) => item.id === notification.id ? {
        ...item,
        isRead: true,
        payload: { ...item.payload, peopleTagStatus: 'ACCEPTED' }
      } : item));
    } catch (error) {
      console.error('Failed to accept people tag', error);
    }
  };

  const handleRejectPeopleTag = async (notification: Notification, event: React.MouseEvent) => {
    event.stopPropagation();
    const tagId = notification.payload?.peopleTagId;
    if (!tagId) return;
    try {
      await api.rejectPeopleTag(tagId);
      onNotificationsChange(notifications.filter((item) => item.id !== notification.id));
    } catch (error) {
      console.error('Failed to reject people tag', error);
    }
  };

  // ── Group Invite Actions ─────────────────────────────────────────
  const handleAcceptGroupInvite = async (notif: Notification, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!notif.targetId) return;
    try {
      await api.joinGroup(notif.targetId);
      if (currentUserId) {
        api.markNotificationRead(currentUserId, notif.id).catch(console.error);
      }
      onNotificationsChange(
        notifications.map(n =>
          n.id === notif.id ? { ...n, isRead: true, message: 'You joined the group ✓' } : n
        )
      );
    } catch (err) {
      console.error('Failed to accept group invite', err);
    }
  };

  const handleDeclineGroupInvite = async (notif: Notification, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!notif.targetId) return;
    try {
      await api.declineGroupInvite(notif.targetId);
      if (currentUserId) {
        api.markNotificationRead(currentUserId, notif.id).catch(console.error);
      }
      onNotificationsChange(
        notifications.map(n =>
          n.id === notif.id ? { ...n, isRead: true, message: 'Invite declined' } : n
        )
      );
    } catch (err) {
      console.error('Failed to decline group invite', err);
    }
  };

  const getIcon = (type: Notification['type'], actor?: Notification['actor']) => {
    if ((actor?.avatar || actor?.avatarMediaId || actor?.avatarMedia) && type !== 'group_invite' && type !== 'milestone') {
      return <UserAvatar src={actor.avatar} mediaId={actor.avatarMediaId} media={actor.avatarMedia} name={actor.name} alt={actor.name || 'User'} size={40} className="border border-gray-100" />;
    }

    let icon;
    let bgClass = 'bg-gray-100 text-gray-600';

    switch (type) {
      case 'vote': icon = <PieChart size={18} />; bgClass = 'bg-green-100 text-green-600'; break;
      case 'response': icon = <FileText size={18} />; bgClass = 'bg-blue-100 text-blue-600'; break;
      case 'result': icon = <PieChart size={18} />; bgClass = 'bg-purple-100 text-purple-600'; break;
      case 'following_post': icon = <User size={18} />; bgClass = 'bg-indigo-100 text-indigo-600'; break;
      case 'group_invite': icon = <Users size={18} />; bgClass = 'bg-orange-100 text-orange-600'; break;
      case 'expiry': icon = <Clock size={18} />; bgClass = 'bg-red-100 text-red-600'; break;
      case 'milestone': icon = <Trophy size={18} />; bgClass = 'bg-yellow-100 text-yellow-600'; break;
      case 'like': icon = <Heart size={18} />; bgClass = 'bg-pink-100 text-pink-600'; break;
      case 'follow': icon = <UserPlus size={18} />; bgClass = 'bg-teal-100 text-teal-600'; break;
      case 'follow_request': icon = <UserPlus size={18} />; bgClass = 'bg-teal-100 text-teal-600'; break;
      case 'follow_accept': icon = <User size={18} />; bgClass = 'bg-teal-100 text-teal-600'; break;
      case 'mention': icon = <User size={18} />; bgClass = 'bg-pink-100 text-pink-600'; break;
      case 'people_tag': icon = <UserPlus size={18} />; bgClass = 'bg-blue-100 text-blue-600'; break;
      default: icon = <Bell size={18} />; break;
    }

    return (
      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${bgClass}`}>
        {icon}
      </div>
    );
  };

  const filteredList = notifications;

  return (
    <div className="bg-white min-h-[100dvh] flex flex-col">
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-sm border-b border-gray-100">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="p-2 -ml-2 hover:bg-gray-50 rounded-full text-gray-600 transition-colors"
            >
              <ArrowLeft size={24} />
            </button>
            <h1 className="text-xl font-bold text-gray-900">Notifications</h1>
            {unreadCount > 0 && (
              <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {unreadCount}
              </span>
            )}
          </div>
          <button
            onClick={handleMarkAllRead}
            disabled={unreadCount === 0}
            className={`text-sm font-bold px-3 py-1.5 rounded-lg transition-colors ${unreadCount === 0
              ? 'text-gray-400 bg-gray-100 cursor-not-allowed'
              : 'text-blue-600 hover:bg-blue-50'
              }`}
          >
            Mark all read
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-20 no-scrollbar bg-gray-50">
        {isInitialLoading && filteredList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[50vh] text-center px-6" role="status">
            <div className="w-12 h-12 rounded-full border-4 border-gray-200 border-t-blue-600 animate-spin mb-4" />
            <p className="text-gray-600 text-sm font-semibold">Loading notifications…</p>
          </div>
        ) : loadError && filteredList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[50vh] text-center px-6" role="alert">
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-4 text-red-500">
              <Bell size={32} />
            </div>
            <h3 className="text-gray-900 font-bold text-lg mb-2">Couldn't load notifications</h3>
            <p className="text-gray-500 text-sm mb-5">{loadError}</p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-60"
              >
                Try again
              </button>
            )}
          </div>
        ) : filteredList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[50vh] text-center px-6">
            <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mb-4 text-gray-500">
              <Bell size={32} />
            </div>
            <h3 className="text-gray-900 font-bold text-lg mb-2">No notifications yet</h3>
            <p className="text-gray-500 text-sm">When there's activity on your surveys or polls, it will show up here.</p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-gray-100">
              {[...filteredList].sort((a, b) => {
                const timeA = (a as any).createdAt || new Date(a.timestamp).getTime();
                const timeB = (b as any).createdAt || new Date(b.timestamp).getTime();
                return timeB - timeA;
              }).map((notification) => (
              <div
                key={notification.id}
                data-notification-id={notification.id}
                onClick={() => handleItemClick(notification)}
                className={`flex gap-4 p-4 transition-colors cursor-pointer active:bg-gray-100 ${notification.isRead ? 'bg-white' : 'bg-blue-50/40'
                  }`}
              >
                <div className="shrink-0 relative">
                  {getIcon(notification.type, notification.actor)}
                  {(notification.actor?.avatar || notification.actor?.avatarMediaId || notification.actor?.avatarMedia) && (
                    <div className="absolute -bottom-1 -right-1 bg-white rounded-full p-0.5 shadow-sm">
                      {notification.type === 'vote' && <div className="bg-green-100 text-green-600 rounded-full p-0.5"><PieChart size={10} /></div>}
                      {notification.type === 'response' && <div className="bg-blue-100 text-blue-600 rounded-full p-0.5"><FileText size={10} /></div>}
                      {notification.type === 'group_invite' && <div className="bg-orange-100 text-orange-600 rounded-full p-0.5"><Users size={10} /></div>}
                      {notification.type === 'like' && <div className="bg-pink-100 text-pink-600 rounded-full p-0.5"><Heart size={10} /></div>}
                      {(notification.type === 'follow' || notification.type === 'follow_request' || notification.type === 'follow_accept') && <div className="bg-teal-100 text-teal-600 rounded-full p-0.5"><UserPlus size={10} /></div>}
                      {notification.type === 'people_tag' && <div className="bg-blue-100 text-blue-600 rounded-full p-0.5"><UserPlus size={10} /></div>}
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="mb-0.5">
                    <span className={`text-sm ${notification.isRead ? 'font-semibold text-gray-900' : 'font-bold text-black'}`}>
                      {notification.actor?.name ?? (['vote', 'response'].includes(notification.type) ? 'ضيف' : 'النظام')}
                    </span>
                    <span className={`text-sm ${notification.isRead ? 'text-gray-600' : 'text-gray-800 font-medium'}`}>
                      {' '}{notification.type === 'people_tag' ? t('peopleTags.notificationMessage') : notification.message}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs ${notification.isRead ? 'text-gray-400' : 'text-blue-600 font-semibold'}`}>
                      {getTimeAgo(notification.timestamp)}
                    </span>
                  </div>

                  {/* Follow Request Actions */}
                  {notification.type === 'follow_request' && notification.actor?.id && (
                    <div className="flex gap-2 mt-3 mb-1">
                      <button
                        onClick={(e) => handleAcceptRequest(notification.id, notification.actor!.id, e)}
                        className="flex-1 bg-blue-600 text-white text-xs font-bold py-2 rounded-lg active:scale-95 transition-transform"
                      >
                        Accept
                      </button>
                      <button
                        onClick={(e) => handleRejectRequest(notification.id, notification.actor!.id, e)}
                        className="flex-1 bg-gray-200 text-gray-800 text-xs font-bold py-2 rounded-lg active:scale-95 transition-transform"
                      >
                        Reject
                      </button>
                    </div>
                  )}

                  {/* Group Invite Actions — shown only while the invite is still pending (unread) */}
                  {notification.type === 'group_invite' && !notification.isRead && notification.targetId && (
                    <div className="flex gap-2 mt-3 mb-1">
                      <button
                        onClick={(e) => handleAcceptGroupInvite(notification, e)}
                        className="flex-1 bg-blue-600 text-white text-xs font-bold py-2 rounded-xl active:scale-95 transition-all hover:bg-blue-700"
                      >
                        Accept
                      </button>
                      <button
                        onClick={(e) => handleDeclineGroupInvite(notification, e)}
                        className="flex-1 bg-gray-100 text-gray-700 text-xs font-bold py-2 rounded-xl active:scale-95 transition-all hover:bg-gray-200"
                      >
                        Decline
                      </button>
                    </div>
                  )}

                  {notification.type === 'people_tag' && notification.payload?.peopleTagStatus === 'PENDING' && notification.payload.peopleTagId && (
                    <div className="flex gap-2 mt-3 mb-1">
                      <button
                        onClick={(event) => handleAcceptPeopleTag(notification, event)}
                        className="flex-1 bg-blue-600 text-white text-xs font-bold py-2 rounded-lg active:scale-95 transition-transform"
                      >
                        {t('peopleTags.accept')}
                      </button>
                      <button
                        onClick={(event) => handleRejectPeopleTag(notification, event)}
                        className="flex-1 bg-gray-200 text-gray-800 text-xs font-bold py-2 rounded-lg active:scale-95 transition-transform"
                      >
                        {t('peopleTags.reject')}
                      </button>
                    </div>
                  )}
                </div>

                <div className="shrink-0 flex flex-col justify-between items-end">
                  {!notification.isRead && (
                    <div className="w-2.5 h-2.5 bg-blue-600 rounded-full mb-2" />
                  )}
                  <button
                    onClick={(e) => handleDelete(notification.id, e)}
                    className="text-gray-300 hover:text-red-500 p-1.5 rounded-full hover:bg-gray-100 transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              ))}
            </div>

            <div className="px-4 py-6 text-center">
              {loadError && (
                <p className="text-sm text-red-600 mb-3" role="alert">{loadError}</p>
              )}
              {hasMore ? (
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={isLoadingMore || !onLoadMore}
                  aria-busy={isLoadingMore}
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-800 shadow-sm hover:bg-gray-50 disabled:cursor-wait disabled:opacity-60"
                >
                  {isLoadingMore ? 'Loading more…' : loadError ? 'Try loading more again' : 'Load more notifications'}
                </button>
              ) : (
                <p className="text-xs font-medium text-gray-400">You're all caught up</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
