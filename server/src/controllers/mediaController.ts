import { Request, Response } from 'express';
import { MediaPurpose } from '@prisma/client';
import { z } from 'zod';
import {
  createMediaUpload,
  deleteMediaAsset,
  finalizeMediaUpload,
  getMediaConfigResponse,
  getMediaReadPresentation,
  prepareMediaUpload
} from '../services/mediaService';
import { MediaValidationError } from '../services/mediaProcessor';

const uploadSchema = z.object({
  purpose: z.nativeEnum(MediaPurpose),
  mime: z.string(),
  size: z.number().int().positive(),
  altText: z.string().trim().max(1000).optional()
});

const normalizedCropSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1)
});

const finalizeSchema = z.object({
  aspectRatio: z.number().optional(),
  crop: normalizedCropSchema.optional(),
  focalX: z.number().min(0).max(1).optional(),
  focalY: z.number().min(0).max(1).optional(),
  altText: z.string().trim().max(1000).optional()
});

const respondWithMediaError = (req: Request, res: Response, error: unknown): void => {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid media request.', code: 'INVALID_MEDIA_REQUEST' });
    return;
  }
  if (error instanceof MediaValidationError) {
    res.status(error.statusCode).json({ error: error.message, code: error.code });
    return;
  }
  const errorCode = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code || 'UNKNOWN')
    : 'UNKNOWN';
  const requestId = (req as Request & { requestId?: string }).requestId;
  console.error(JSON.stringify({ event: 'media_operation_failed', requestId, errorCode }));
  res.status(503).json({
    error: 'Media service is temporarily unavailable.',
    code: 'MEDIA_SERVICE_UNAVAILABLE',
    requestId
  });
};

export const getMediaConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    res.json(await getMediaConfigResponse());
  } catch (error) {
    respondWithMediaError(req, res, error);
  }
};

export const startMediaUpload = async (req: Request, res: Response): Promise<void> => {
  try {
    const ownerId = req.user!.userId;
    const input = uploadSchema.parse(req.body);
    const upload = await createMediaUpload(ownerId, input.purpose, input.mime, input.size, input.altText);
    res.status(201).json(upload);
  } catch (error) {
    respondWithMediaError(req, res, error);
  }
};

export const finalizeMedia = async (req: Request, res: Response): Promise<void> => {
  try {
    const input = finalizeSchema.parse(req.body);
    const result = await finalizeMediaUpload(req.user!.userId, req.params.id as string, input);
    res.json(result);
  } catch (error) {
    respondWithMediaError(req, res, error);
  }
};

export const prepareMedia = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await prepareMediaUpload(req.user!.userId, req.params.id as string);
    res.json(result);
  } catch (error) {
    respondWithMediaError(req, res, error);
  }
};

export const getMedia = async (req: Request, res: Response): Promise<void> => {
  try {
    const presentation = await getMediaReadPresentation(req.params.id as string, req.user?.userId);
    res.setHeader('Cache-Control', presentation.access === 'PUBLIC' ? 'public, max-age=300' : 'private, no-store');
    res.json(presentation);
  } catch (error) {
    respondWithMediaError(req, res, error);
  }
};

export const cancelMedia = async (req: Request, res: Response): Promise<void> => {
  try {
    await deleteMediaAsset(req.user!.userId, req.params.id as string);
    res.status(204).send();
  } catch (error) {
    respondWithMediaError(req, res, error);
  }
};
