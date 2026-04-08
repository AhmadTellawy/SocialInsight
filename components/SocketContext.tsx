import React, { createContext, useContext, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { Bell } from 'lucide-react';

interface SocketContextType {
    socket: Socket | null;
    isConnected: boolean;
}

const SocketContext = createContext<SocketContextType>({ socket: null, isConnected: false });

export const useSocket = () => useContext(SocketContext);

// Simple Toast Component
const Toast = ({ notification, onClose }: { notification: any, onClose: () => void }) => {
    useEffect(() => {
        const timer = setTimeout(onClose, 4000);
        return () => clearTimeout(timer);
    }, [onClose]);

    return (
        <div style={{
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
            animation: 'slideIn 0.3s ease-out forwards'
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
                onClick={onClose}
                style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', marginLeft: 'auto', padding: '4px' }}
            >
                ✕
            </button>
        </div>
    );
};

export const SocketProvider: React.FC<{ children: React.ReactNode, user?: any }> = ({ children, user }) => {
    const [socket, setSocket] = useState<Socket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [lastNotification, setLastNotification] = useState<any>(null);

    useEffect(() => {
        // Disconnect if no user
        if (!user || user.isGuest) {
            if (socket) {
                socket.disconnect();
                setSocket(null);
                setIsConnected(false);
            }
            return;
        }

        // Connect if user exists
        const socketInstance = io(import.meta.env.VITE_API_URL || 'http://localhost:3001', {
            query: { userId: user.id },
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

        socketInstance.on('newNotification', (data) => {
            console.log('Received real-time notification:', data);
            setLastNotification(data);
            
            // Dispatch a custom window event so other components (like Notification menu) can update instantly
            window.dispatchEvent(new CustomEvent('app:newNotification', { detail: data }));
        });

        setSocket(socketInstance);

        return () => {
            socketInstance.disconnect();
        };
    }, [user]); // Re-run if user changes

    return (
        <SocketContext.Provider value={{ socket, isConnected }}>
            {children}
            {lastNotification && (
                <Toast 
                    notification={lastNotification} 
                    onClose={() => setLastNotification(null)} 
                />
            )}
        </SocketContext.Provider>
    );
};
