import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export const requestContext = (req: Request, res: Response, next: NextFunction): void => {
  const incoming = req.header('x-request-id')?.trim();
  req.requestId = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};
