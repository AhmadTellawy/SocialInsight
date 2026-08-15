import { MediaCropSelection, MediaPresentation, MediaPurpose } from '../types';
import { authFetch } from './api';

export type MediaConfig = {
  enabled: boolean;
  maxPostImages: number;
  maxInputBytes: number;
  maxDecodedPixels: number;
  maxUploadConcurrency: number;
  minAspectRatio: number;
  maxAspectRatio: number;
  allowedMimeTypes: string[];
};

type SignedUploadSession = {
  assetId: string;
  bucket: string;
  path: string;
  token: string;
  signedUrl: string;
  expiresInSeconds: number;
};

export class MediaUploadError extends Error {
  constructor(message: string, public readonly assetId?: string, public readonly phase?: 'upload' | 'processing') {
    super(message);
    this.name = 'MediaUploadError';
  }
}

const parseError = async (response: Response, fallback: string): Promise<Error> => {
  try {
    const payload = await response.json();
    return new Error(payload.error || fallback);
  } catch {
    return new Error(fallback);
  }
};

const uploadToSignedUrl = (
  session: SignedUploadSession,
  file: File,
  onProgress: (progress: number) => void,
  signal?: AbortSignal
): Promise<void> => new Promise((resolve, reject) => {
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!publishableKey) {
    reject(new Error('Supabase upload key is not configured.'));
    return;
  }

  const xhr = new XMLHttpRequest();
  const abort = () => xhr.abort();
  signal?.addEventListener('abort', abort, { once: true });
  xhr.open('PUT', session.signedUrl);
  xhr.setRequestHeader('apikey', publishableKey);
  xhr.setRequestHeader('Authorization', `Bearer ${publishableKey}`);
  xhr.setRequestHeader('x-upsert', 'false');
  xhr.upload.onprogress = (event) => {
    if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
  };
  xhr.onerror = () => reject(new Error('Image upload failed.'));
  xhr.onabort = () => reject(new DOMException('Upload canceled.', 'AbortError'));
  xhr.onload = () => {
    signal?.removeEventListener('abort', abort);
    if (xhr.status >= 200 && xhr.status < 300) resolve();
    else reject(new Error('Image upload was rejected.'));
  };

  const body = new FormData();
  body.append('cacheControl', '0');
  body.append('', file);
  xhr.send(body);
});

export const mediaApi = {
  getConfig: async (): Promise<MediaConfig> => {
    const response = await authFetch('/api/media/config');
    if (!response.ok) throw await parseError(response, 'Failed to load media configuration.');
    return response.json();
  },

  startUpload: async (file: File, purpose: MediaPurpose, altText?: string): Promise<SignedUploadSession> => {
    const response = await authFetch('/api/media/uploads', {
      method: 'POST',
      body: JSON.stringify({ purpose, mime: file.type, size: file.size, altText })
    });
    if (!response.ok) throw await parseError(response, 'Could not start image upload.');
    return response.json();
  },

  finalize: async (assetId: string, crop: MediaCropSelection): Promise<{ id: string; aspectRatio: number; width: number; height: number }> => {
    const response = await authFetch(`/api/media/${assetId}/finalize`, {
      method: 'POST',
      body: JSON.stringify(crop)
    });
    if (!response.ok) throw await parseError(response, 'Could not process image.');
    return response.json();
  },

  upload: async (
    file: File,
    purpose: MediaPurpose,
    crop: MediaCropSelection,
    onProgress: (progress: number) => void,
    signal?: AbortSignal
  ) => {
    if (signal?.aborted) throw new DOMException('Upload canceled.', 'AbortError');
    const session = await mediaApi.startUpload(file, purpose, crop.altText);
    if (signal?.aborted) {
      await mediaApi.cancel(session.assetId).catch(() => undefined);
      throw new DOMException('Upload canceled.', 'AbortError');
    }
    try {
      await uploadToSignedUrl(session, file, onProgress, signal);
    } catch (error) {
      await mediaApi.cancel(session.assetId).catch(() => undefined);
      throw new MediaUploadError(error instanceof Error ? error.message : 'Image upload failed.', undefined, 'upload');
    }
    try {
      onProgress(100);
      return await mediaApi.finalize(session.assetId, crop);
    } catch (error) {
      throw new MediaUploadError(error instanceof Error ? error.message : 'Image processing failed.', session.assetId, 'processing');
    }
  },

  retryFinalize: (assetId: string, crop: MediaCropSelection) => mediaApi.finalize(assetId, crop),

  get: async (assetId: string): Promise<MediaPresentation> => {
    const response = await authFetch(`/api/media/${assetId}`);
    if (!response.ok) throw await parseError(response, 'Image is unavailable.');
    return response.json();
  },

  cancel: async (assetId: string): Promise<void> => {
    const response = await authFetch(`/api/media/${assetId}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404 && response.status !== 409) {
      throw await parseError(response, 'Could not remove image.');
    }
  }
};
