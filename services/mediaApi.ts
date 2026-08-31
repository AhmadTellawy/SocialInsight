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

const presentationCache = new Map<string, { value: MediaPresentation; expiresAt: number }>();
const presentationRequests = new Map<string, Promise<MediaPresentation>>();
const PRESENTATION_CACHE_LIMIT = 200;
const PUBLIC_PRESENTATION_TTL_MS = 10 * 60 * 1000;
const RESTRICTED_PRESENTATION_TTL_MS = 4 * 60 * 1000;
let presentationCacheAuthToken: string | null | undefined;

const synchronizePresentationCacheIdentity = (): void => {
  const authToken = typeof localStorage === 'undefined' ? null : localStorage.getItem('si_token');
  if (presentationCacheAuthToken !== undefined && presentationCacheAuthToken !== authToken) {
    presentationCache.clear();
    presentationRequests.clear();
  }
  presentationCacheAuthToken = authToken;
};

const cachePresentation = (assetId: string, value: MediaPresentation): void => {
  presentationCache.delete(assetId);
  presentationCache.set(assetId, {
    value,
    expiresAt: Date.now() + (value.access === 'RESTRICTED' ? RESTRICTED_PRESENTATION_TTL_MS : PUBLIC_PRESENTATION_TTL_MS)
  });
  while (presentationCache.size > PRESENTATION_CACHE_LIMIT) {
    const oldest = presentationCache.keys().next().value;
    if (!oldest) break;
    presentationCache.delete(oldest);
  }
};

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
  const xhr = new XMLHttpRequest();
  const abort = () => xhr.abort();
  signal?.addEventListener('abort', abort, { once: true });
  xhr.open('PUT', session.signedUrl);
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

  get: async (assetId: string, forceRefresh = false): Promise<MediaPresentation> => {
    synchronizePresentationCacheIdentity();
    const cached = presentationCache.get(assetId);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.value;
    const inFlight = presentationRequests.get(assetId);
    if (!forceRefresh && inFlight) return inFlight;

    presentationCache.delete(assetId);
    const request = (async () => {
      const response = await authFetch(`/api/media/${assetId}`);
      if (!response.ok) throw await parseError(response, 'Image is unavailable.');
      const presentation = await response.json() as MediaPresentation;
      cachePresentation(assetId, presentation);
      return presentation;
    })();

    if (!forceRefresh) presentationRequests.set(assetId, request);
    try {
      return await request;
    } finally {
      if (presentationRequests.get(assetId) === request) presentationRequests.delete(assetId);
    }
  },

  cancel: async (assetId: string): Promise<void> => {
    const response = await authFetch(`/api/media/${assetId}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404 && response.status !== 409) {
      throw await parseError(response, 'Could not remove image.');
    }
  }
};
