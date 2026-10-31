import { API_BASE_URL, authFetch } from './api';
import { normalizeSurvey, Survey } from '../types';
export type VideoUpload = { id: string; uploadUrl: string; status: string };
export type PlaybackGrant = { hls: string; poster: string; expiresAt: number; format?: 'hls' | 'progressive' };
export type ReelsConfig = { enabled: boolean; maxBytes: number; maxSeconds: number; maxQuestions: number };
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await authFetch(`${API_BASE_URL}/reels${path}`, { ...init, timeoutMs: 20_000 });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || 'Unable to load Reels. Try again.'); }
  return response.status === 204 ? undefined as T : response.json();
}
export const reelsApi = {
  config: (signal?: AbortSignal) => request<ReelsConfig>('/config', { signal }),
  result: (id: string, signal?: AbortSignal) => request<{ completed: boolean; quizResult?: { correct: number; total: number } }>(`/result/${encodeURIComponent(id)}`, { signal }),
  upload: (file: File, requestKey: string, signal?: AbortSignal) => request<VideoUpload>('/uploads', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ size: file.size, mime: file.type, requestKey }) }),
  status: (id: string, signal?: AbortSignal) => request<{ id: string; status: string; duration: number; errorCode?: string }>(`/videos/${encodeURIComponent(id)}`, { signal }),
  cancel: (id: string) => request<void>(`/videos/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  playback: (id: string, signal?: AbortSignal, preview = false) => request<PlaybackGrant>(`/${preview ? 'preview' : 'playback'}/${encodeURIComponent(id)}`, { signal }),
  async feed(cursor?: string | null, signal?: AbortSignal, anchorId?: string): Promise<{ data: Survey[]; nextCursor: string | null }> {
    const params = new URLSearchParams({ presentationFormat: 'REEL', limit: '6' });
    if (cursor) params.set('cursor', cursor);
    if (anchorId) params.set('anchorId', anchorId);
    const response = await authFetch(`${API_BASE_URL}/posts?${params}`, { signal, timeoutMs: 20_000 });
    if (!response.ok) throw new Error('Unable to load Reels. Try again.');
    const result = await response.json();
    return { data: result.data.map(normalizeSurvey), nextCursor: result.nextCursor };
  }
};
