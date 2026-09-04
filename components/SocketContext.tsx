import React, { createContext, useContext, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useNavigate } from 'react-router-dom';
import { Bell, X } from 'lucide-react';
import { API_BASE_URL } from '../services/api';
import { getNotificationDeepLink } from '../utils/notificationNavigation';

interface SocketContextType {
    socket: Socket | null;
    isConnected: boolean;
}

const SocketContext = createContext<SocketContextType>({ socket: null, isConnected: false });

export const useSocket = () => useContext(SocketContext);

// Simple Toast Component
const Toast = ({ notification, onClose, onOpen }: { notification: any, onClose: () => void, onOpen: () => void }) => {
    useEffect(() => {
        const timer = setTimeout(onClose, 4000);
        return () => clearTimeout(timer);
    }, [onClose]);

    return (
        <div
          role="button"
          tabIndex={0}
          aria-label="Open notification"
          onClick={onOpen}
          onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onOpen();
              }
          }}
          style={{
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            backgroundColor: '#1E293B',
            color: 'white',
            padding: '16px',
            borderRadius: '12px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            zIndex: 9999,
            animation: 'slideIn 0.3s ease-out forwards',
            cursor: 'pointer'
        }}>
            <style>
                {`
                @keyframes slideIn {
                    from { transform: translateY(100px); opacity: 0; }
                    to { transform: translateY(0); opacity: 1; }
                }
                `}
            </style>
            <div style={{ backgroundColor: '#6366F1', padding: '8px', borderRadius: '50%' }}>
                <Bell size={20} color="white" />
            </div>
            <div>
                <p style={{ margin: 0, fontWeight: 600, fontSize: '14px' }}>
                    {notification.actor?.name || 'Someone'} {notification.message}
                </p>
                <p style={{ margin: 0, fontSize: '12px', color: '#94A3B8', marginTop: '4px' }}>
                    Just now
                </p>
            </div>
            <button
                type="button"
                aria-label="Close notification"
                onClick={(event) => {
                    event.stopPropagation();
                    onClose();
                }}
                style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', marginLeft: 'auto', padding: '4px' }}
            >
                <X size={16} aria-hidden="true" />
            </button>
        </div>
    );
};

export const SocketProvider: React.FC<{ children: React.ReactNode, user?: any }> = ({ children, user }) => {
    const navigate = useNavigate();
    const [socket, setSocket] = useState<Socket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [lastNotification, setLastNotification] = useState<any>(null);

    useEffect(() => {
        if (!user || user.isGuest) {
            setSocket(null);
            setIsConnected(false);
            return;
        }

        const socketUrl = API_BASE_URL.startsWith('http')
            ? API_BASE_URL.replace(/\/api\/?$/, '')
            : window.location.origin;
        const socketInstance = io(socketUrl, {
            withCredentials: true,
            transports: ['websocket'],
            reconnectionAttempts: 5,
        });

        socketInstance.on('connect', () => {
            console.log('Socket connected successfully');
            setIsConnected(true);
        });

        socketInstance.on('disconnect', () => {
            console.log('Socket disconnected');
            setIsConnected(false);
        });

        socketInstance.on('connect_error', () => {
            console.warn('Socket authentication or connection failed');
            setIsConnected(false);
        });

        socketInstance.on('newNotification', (data) => {
            setLastNotification(data);
            
            // Dispatch a custom window event so other components (like Notification menu) can update instantly
            window.dispatchEvent(new CustomEvent('app:newNotification', { detail: data }));
        });

        setSocket(socketInstance);

        return () => {
            socketInstance.disconnect();
            setSocket(null);
            setIsConnected(false);
        };
    }, [user?.id, user?.isGuest, user?.email]);

    const openLastNotification = () => {
        if (!lastNotification) return;
        const deepLink = getNotificationDeepLink(lastNotification);
        setLastNotification(null);
        if (deepLink) navigate(deepLink);
    };

    return (
        <SocketContext.Provider value={{ socket, isConnected }}>
            {children}
            {lastNotification && (
                <Toast 
                    notification={lastNotification} 
                    onClose={() => setLastNotification(null)} 
                    onOpen={openLastNotification}
                />
            )}
        </SocketContext.Provider>
    );
};
