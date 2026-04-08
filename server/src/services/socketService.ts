import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';

let io: Server;

export const initSocket = (server: HttpServer) => {
    io = new Server(server, {
        cors: {
            origin: process.env.CLIENT_URL || 'http://localhost:3000',
            methods: ['GET', 'POST'],
            credentials: true,
        }
    });

    io.on('connection', (socket: Socket) => {
        // Users can log in and join their own personal notification room
        const userId = socket.handshake.query.userId as string;
        
        if (userId) {
            socket.join(userId);
            console.log(`User ${userId} joined their personal socket room.`);
        }

        socket.on('disconnect', () => {
            if (userId) {
                console.log(`User ${userId} disconnected from socket room.`);
            }
        });
    });

    return io;
};

// Expose the getter to use io across other services (like controllers)
export const getIO = () => {
    if (!io) {
        // Warning, because it might be called before server starts, theoretically
        console.warn('Socket.io has not been initialized yet!');
    }
    return io;
};
