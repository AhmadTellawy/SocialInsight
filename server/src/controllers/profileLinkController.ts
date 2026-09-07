import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { AccountSecurityError, lockAccountSecurity } from '../services/mfaService';
import { assertActiveAccountSession } from '../services/accountSecurityPolicy';
import { ProfileValidationError } from '../utils/profileValidation';
import {
  createProfileLink,
  deleteProfileLink,
  listProfileLinks,
  updateProfileLink
} from '../services/profileLinkService';

const authorizeMutation = (req: Request) => async (tx: Prisma.TransactionClient) => {
  await lockAccountSecurity(tx, req.user!.userId);
  await assertActiveAccountSession(tx, req, false);
};

const respondWithProfileLinkError = (req: Request, res: Response, error: unknown): void => {
  if (error instanceof AccountSecurityError) {
    res.status(error.status).json({ error: 'Sign in again to continue.', code: error.code });
    return;
  }
  if (error instanceof ProfileValidationError) {
    res.status(error.statusCode).json({ error: error.message, code: error.code });
    return;
  }
  const errorCode = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code || 'UNKNOWN')
    : 'UNKNOWN';
  const requestId = (req as Request & { requestId?: string }).requestId;
  console.error(JSON.stringify({
    event: 'profile_link_operation_failed',
    requestId,
    errorCode
  }));
  res.status(500).json({
    error: 'Profile link operation failed.',
    code: 'PROFILE_LINK_OPERATION_FAILED',
    requestId
  });
};

export const getMyProfileLinks = async (req: Request, res: Response): Promise<void> => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.vary('Authorization');
  try {
    res.json(await listProfileLinks(req.user!.userId));
  } catch (error) {
    respondWithProfileLinkError(req, res, error);
  }
};

export const addMyProfileLink = async (req: Request, res: Response): Promise<void> => {
  try {
    res.status(201).json(await createProfileLink(req.user!.userId, req.body || {}, undefined, authorizeMutation(req)));
  } catch (error) {
    respondWithProfileLinkError(req, res, error);
  }
};

export const editMyProfileLink = async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await updateProfileLink(req.user!.userId, req.params.linkId as string, req.body || {}, undefined, authorizeMutation(req)));
  } catch (error) {
    respondWithProfileLinkError(req, res, error);
  }
};

export const removeMyProfileLink = async (req: Request, res: Response): Promise<void> => {
  try {
    await deleteProfileLink(req.user!.userId, req.params.linkId as string, undefined, authorizeMutation(req));
    res.status(204).send();
  } catch (error) {
    respondWithProfileLinkError(req, res, error);
  }
};
