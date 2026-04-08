import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export const JWT_SECRET = process.env.JWT_SECRET || 'fallback_socialinsight_secret_2026';

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
