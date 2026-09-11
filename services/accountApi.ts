import { API_BASE_URL, ApiError, authFetch } from './api';
import type { UserProfile } from '../types';

export async function accountRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await authFetch(`${API_BASE_URL}${path}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body), timeoutMs: 15_000
  });
  const payload = response.status === 204 ? undefined : await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(payload?.error || 'Request failed', response.status, payload?.code, payload);
  return payload as T;
}

export const accountApi = {
  updateSettings: (changes: Partial<UserProfile>, expectedUpdatedAt: string) =>
    accountRequest<UserProfile>('/users/me/settings', 'PATCH', { changes, expectedUpdatedAt }),
  getPublicProfile: (id: string) => accountRequest<Partial<UserProfile>>(`/users/${encodeURIComponent(id)}?viewAs=visitor`),
  getBlockedAccounts: (cursor?: string) => accountRequest<{items: Pick<UserProfile, 'id'|'name'|'handle'|'avatar'>[]; nextCursor: string|null}>(`/users/me/blocks${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  unblock: (id: string) => accountRequest<void>(`/users/me/blocks/${encodeURIComponent(id)}`, 'DELETE'),
  blockAccount: (blockedId: string) => accountRequest<void>('/users/me/blocks', 'POST', { blockedId }),
  deactivate: () => accountRequest<void>('/account/deactivate', 'POST'),
  deleteAccount: () => accountRequest<void>('/account', 'DELETE'),
};
