import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../prisma';

if (!process.env.JWT_SECRET) {
    throw new Error('FATAL ERROR: JWT_SECRET environment variable is not set. This is a critical security vulnerability.');
}
export const JWT_SECRET = process.env.JWT_SECRET;

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
      };
    }
  }
}

const activeUserExists = async (userId: string): Promise<boolean> => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { status: true }
    });
    return user?.status === 'ACTIVE';
};

export const requireAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({
            error: 'Unauthorized: No token provided',
            code: 'AUTH_TOKEN_REQUIRED',
            requestId: (req as Request & { requestId?: string }).requestId
        });
        return;
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (typeof decoded !== 'object' || typeof decoded.userId !== 'string' || !decoded.userId.trim()) {
            throw new jwt.JsonWebTokenError('Token is missing a valid userId claim');
        }
        if (!(await activeUserExists(decoded.userId))) {
            res.status(401).json({
                error: 'Unauthorized: Account is inactive',
                code: 'AUTH_ACCOUNT_INACTIVE',
                requestId: (req as Request & { requestId?: string }).requestId
            });
            return;
        }
        req.user = { userId: decoded.userId };
        next();
    } catch (error) {
        res.status(401).json({
            error: 'Unauthorized: Invalid or expired token',
            code: 'AUTH_TOKEN_INVALID',
            requestId: (req as Request & { requestId?: string }).requestId
        });
    }
};

export const optionalAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            if (typeof decoded === 'object'
                && typeof decoded.userId === 'string'
                && decoded.userId.trim()
                && await activeUserExists(decoded.userId)) {
                req.user = { userId: decoded.userId };
            }
        } catch (error) {
            // It's optional, so we ignore expired tokens
        }
    }
    next();
};
