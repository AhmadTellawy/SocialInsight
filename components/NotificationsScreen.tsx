
import React, { useState } from 'react';
import { ArrowLeft, Trash2, User, PieChart, FileText, Users, Clock, Trophy, Bell } from 'lucide-react';
import { Notification } from '../types';

interface NotificationsScreenProps {
  notifications: Notification[];
  onNotificationsChange: (notifications: Notification[]) => void;
  onBack: () => void;
  onItemClick: (targetId: string, type?: 'survey' | 'profile' | 'group', actor?: any) => void;
}

export const NotificationsScreen: React.FC<NotificationsScreenProps> = ({
  notifications,
  onNotificationsChange,
  onBack,
  onItemClick
}) => {
  const [filter, setFilter] = useState<'All' | 'Mentions' | 'Groups'>('All');

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
    if (notification.targetId) {
      onItemClick(notification.targetId, notification.targetType, notification.actor);
    }
  };

  const getIcon = (type: Notification['type'], avatar?: string) => {
    if (avatar && type !== 'group_invite' && type !== 'milestone') {
      return <img src={avatar} alt="" className="w-10 h-10 rounded-full object-cover border border-gray-100" />;
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
      default: icon = <Bell size={18} />; break;
    }

    return (
      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${bgClass}`}>
        {icon}
      </div>
    );
  };

  const filteredList = notifications.filter(n => {
    if (filter === 'All') return true;
    if (filter === 'Mentions') return n.type === 'response' || n.type === 'vote' || n.type === 'following_post';
    if (filter === 'Groups') return n.type === 'group_invite';
    return true;
  });

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

        <div className="flex px-4 pb-0 space-x-6 overflow-x-auto no-scrollbar">
          {['All', 'Mentions', 'Groups'].map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab as any)}
              className={`pb-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${filter === tab
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-20 no-scrollbar bg-gray-50">
        {filteredList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[50vh] text-center px-6">
            <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mb-4 text-gray-500">
              <Bell size={32} />
            </div>
            <h3 className="text-gray-900 font-bold text-lg mb-2">No notifications yet</h3>
            <p className="text-gray-500 text-sm">When there's activity on your surveys or polls, it will show up here.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {[...filteredList].sort((a, b) => {
              const timeA = (a as any).createdAt || new Date(a.timestamp).getTime();
              const timeB = (b as any).createdAt || new Date(b.timestamp).getTime();
              return timeB - timeA;
            }).map((notification) => (
              <div
                key={notification.id}
                onClick={() => handleItemClick(notification)}
                className={`flex gap-4 p-4 transition-colors cursor-pointer active:bg-gray-100 ${notification.isRead ? 'bg-white' : 'bg-blue-50/40'
                  }`}
              >
                <div className="shrink-0 relative">
                  {getIcon(notification.type, notification.actor?.avatar)}
                  {notification.actor?.avatar && (
                    <div className="absolute -bottom-1 -right-1 bg-white rounded-full p-0.5 shadow-sm">
                      {notification.type === 'vote' && <div className="bg-green-100 text-green-600 rounded-full p-0.5"><PieChart size={10} /></div>}
                      {notification.type === 'response' && <div className="bg-blue-100 text-blue-600 rounded-full p-0.5"><FileText size={10} /></div>}
                      {notification.type === 'group_invite' && <div className="bg-orange-100 text-orange-600 rounded-full p-0.5"><Users size={10} /></div>}
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="mb-0.5">
                    <span className={`text-sm ${notification.isRead ? 'font-semibold text-gray-900' : 'font-bold text-black'}`}>
                      {notification.actor?.name ?? 'System'}
                    </span>
                    <span className={`text-sm ${notification.isRead ? 'text-gray-600' : 'text-gray-800 font-medium'}`}>
                      {' '}{notification.message}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs ${notification.isRead ? 'text-gray-400' : 'text-blue-600 font-semibold'}`}>
                      {getTimeAgo(notification.timestamp)}
                    </span>
                  </div>
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
        )}
      </div>
    </div>
  );
};
