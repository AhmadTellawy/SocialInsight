import React, { useState, useEffect } from 'react';
import { Users, Check, X, Clock } from 'lucide-react';
import { BottomSheet } from './BottomSheet';
import { UserAvatar } from './UserAvatar';
import { api } from '../services/api';
import { useTranslation } from 'react-i18next';

interface FollowRequestsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
}

export const FollowRequestsSheet: React.FC<FollowRequestsSheetProps> = ({
  isOpen,
  onClose,
  userId
}) => {
  const { t } = useTranslation();
  const [requests, setRequests] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadRequests();
    }
  }, [isOpen]);

  const loadRequests = async () => {
    setIsLoading(true);
    try {
      const data = await api.getFollowRequests(userId);
      setRequests(data);
    } catch (error) {
      console.error('Failed to load follow requests:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAccept = async (followerId: string) => {
    setActionLoading(`accept-${followerId}`);
    try {
      await api.acceptFollowRequest(followerId);
      setRequests(prev => prev.filter(r => r.follower.id !== followerId));
    } catch (error) {
      console.error('Failed to accept request:', error);
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (followerId: string) => {
    setActionLoading(`reject-${followerId}`);
    try {
      await api.rejectFollowRequest(followerId);
      setRequests(prev => prev.filter(r => r.follower.id !== followerId));
    } catch (error) {
      console.error('Failed to reject request:', error);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={t('Follow Requests')}>
      <div className="flex flex-col h-[70vh] bg-white rounded-t-3xl overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 no-scrollbar">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-sm font-semibold">{t('Loading requests...')}</p>
            </div>
          ) : requests.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-6 text-gray-400">
              <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                <Clock size={32} className="text-gray-300" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">{t('No Follow Requests')}</h3>
              <p className="text-sm">{t('When people request to follow you, they will appear here.')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {requests.map((request: any) => (
                <div key={request.id} className="flex items-center gap-3 p-3 bg-white rounded-2xl border border-gray-100 shadow-sm">
                  <UserAvatar src={request.follower.avatar} name={request.follower.name} size="lg" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate flex items-center gap-1">
                      {request.follower.name}
                    </p>
                    <p className="text-xs text-gray-500 truncate">@{request.follower.handle}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleAccept(request.follower.id)}
                      disabled={actionLoading !== null}
                      className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center hover:bg-blue-100 transition-colors disabled:opacity-50"
                    >
                      {actionLoading === `accept-${request.follower.id}` ? (
                        <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Check size={20} strokeWidth={3} />
                      )}
                    </button>
                    <button
                      onClick={() => handleReject(request.follower.id)}
                      disabled={actionLoading !== null}
                      className="w-10 h-10 rounded-full bg-gray-50 text-gray-400 flex items-center justify-center hover:bg-gray-100 hover:text-red-500 transition-colors disabled:opacity-50"
                    >
                      {actionLoading === `reject-${request.follower.id}` ? (
                        <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <X size={20} strokeWidth={3} />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </BottomSheet>
  );
};
