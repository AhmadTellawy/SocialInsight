import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

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

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorized: No token provided' });
        return;
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
        req.user = decoded;
        
        // Retrofit security: override query/body userId with the trusted token userId
        if (req.method === 'GET') {
            req.query.userId = decoded.userId;
        } else {
            req.body.userId = decoded.userId;
        }
        
        next();
    } catch (error) {
        res.status(401).json({ error: 'Unauthorized: Invalid or expired token' });
    }
};

export const optionalAuth = (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
            req.user = decoded;
            
            // Retrofit security: override query/body userId with the trusted token userId
            if (req.method === 'GET') {
                req.query.userId = decoded.userId;
            } else {
                req.body.userId = decoded.userId;
            }
        } catch (error) {
            // It's optional, so we ignore expired tokens
        }
    }
    next();
};
