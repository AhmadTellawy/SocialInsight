import { Request, Response } from 'express';
import { ProfileValidationError } from '../utils/profileValidation';
import {
  createProfileLink,
  deleteProfileLink,
  listProfileLinks,
  updateProfileLink
} from '../services/profileLinkService';

const respondWithProfileLinkError = (res: Response, error: unknown): void => {
  if (error instanceof ProfileValidationError) {
    res.status(error.statusCode).json({ error: error.message, code: error.code });
    return;
  }
  console.error('Profile link operation failed:', error instanceof Error ? error.message : 'unknown error');
  res.status(500).json({ error: 'Profile link operation failed.', code: 'PROFILE_LINK_OPERATION_FAILED' });
};

export const getMyProfileLinks = async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await listProfileLinks(req.user!.userId));
  } catch (error) {
    respondWithProfileLinkError(res, error);
  }
};

export const addMyProfileLink = async (req: Request, res: Response): Promise<void> => {
  try {
    res.status(201).json(await createProfileLink(req.user!.userId, req.body || {}));
  } catch (error) {
    respondWithProfileLinkError(res, error);
  }
};

export const editMyProfileLink = async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await updateProfileLink(req.user!.userId, req.params.linkId as string, req.body || {}));
  } catch (error) {
    respondWithProfileLinkError(res, error);
  }
};

export const removeMyProfileLink = async (req: Request, res: Response): Promise<void> => {
  try {
    await deleteProfileLink(req.user!.userId, req.params.linkId as string);
    res.status(204).send();
  } catch (error) {
    respondWithProfileLinkError(res, error);
  }
};
