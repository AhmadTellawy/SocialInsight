import { ApiError, authFetch, CursorPage } from './api';
import { MediaPresentation } from '../types';

export type PageRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'ANALYST';
export interface BusinessPage {
  id: string; kind: 'PAGE'; handle: string; name: string; category: string; bio: string; description: string;
  country: string; city: string; website: string | null; publicEmail: string | null; publicPhone: string | null;
  links: Array<{ title: string; url: string }>; cta: 'WEBSITE' | 'EMAIL' | 'PHONE' | null;
  avatarMediaId: string | null; coverMediaId: string | null; avatarMedia?: MediaPresentation; coverMedia?: MediaPresentation;
  createdAt: string; followersCount?: number; following?: boolean; muted?: boolean; managesPage?: boolean;
  canonicalHandle?: string; redirected?: boolean; role?: PageRole; capabilities?: string[];
  publicationState?: 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED'; platformState?: 'NONE' | 'RESTRICTED' | 'SUSPENDED';
  safetyHidden?: boolean; deletionRequestedAt?: string | null; deletionDueAt?: string | null; lastHandleChangedAt?: string | null;
}
export type PageInvitation = { id: string; role?: PageRole; expiresAt: string; page: Pick<BusinessPage, 'id' | 'name' | 'handle'> };
export type BlockedPage = Pick<BusinessPage, 'id' | 'name' | 'handle'>;
export type PageInfo = Pick<BusinessPage, 'name' | 'category' | 'bio' | 'description' | 'country' | 'city' | 'website' | 'links' | 'publicEmail' | 'publicPhone' | 'cta'>;

export async function pageRequest<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await authFetch('/api/pages' + path, { method, cache: 'no-store', signal, timeoutMs: 20000,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new ApiError(result.error || 'Unable to complete the request', response.status, result.code, result);
  return result;
}

export const pagesApi = {
  explore: (query: URLSearchParams, signal?: AbortSignal) => pageRequest<CursorPage<BusinessPage>>('?' + query.toString(), 'GET', undefined, signal),
  mine: (cursor = '', signal?: AbortSignal) => pageRequest<CursorPage<BusinessPage>>('/mine' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''), 'GET', undefined, signal),
  get: (handle: string, signal?: AbortSignal) => pageRequest<BusinessPage>('/' + encodeURIComponent(handle), 'GET', undefined, signal),
  manage: (id: string, signal?: AbortSignal) => pageRequest<BusinessPage>('/manage/' + encodeURIComponent(id), 'GET', undefined, signal),
  create: (input: PageInfo & { handle: string; representationConfirmed: boolean; requestId: string }) => pageRequest<BusinessPage>('', 'POST', input),
  update: (id: string, input: Partial<PageInfo>) => pageRequest<BusinessPage>('/manage/' + id, 'PATCH', input),
  lifecycle: (id: string, action: string) => pageRequest<BusinessPage>('/manage/' + id + '/lifecycle', 'POST', { action }),
  invitations: (cursor = '', signal?: AbortSignal) => pageRequest<CursorPage<PageInvitation>>('/invitations'+(cursor?'?cursor='+encodeURIComponent(cursor):''), 'GET', undefined, signal),
  transfers: (cursor = '', signal?: AbortSignal) => pageRequest<CursorPage<PageInvitation>>('/transfers'+(cursor?'?cursor='+encodeURIComponent(cursor):''), 'GET', undefined, signal),
  blocked: (cursor = '', signal?: AbortSignal) => pageRequest<CursorPage<BlockedPage>>('/blocks'+(cursor?'?cursor='+encodeURIComponent(cursor):''), 'GET', undefined, signal),
  staffAccess: (signal?: AbortSignal) => pageRequest<{review:boolean;ownership:boolean}>('/staff/access','GET',undefined,signal),
  invitation: (id: string, action: 'accept' | 'reject' | 'withdraw') => pageRequest<{ status: string; pageId: string }>('/invitations/' + id + '/' + action, 'POST', {}),
  transferResponse: (id: string, action: 'accept' | 'reject' | 'withdraw') => pageRequest<{ status: string; pageId: string }>('/transfers/' + id + '/' + action, 'POST', {}),
  follow: (id: string, action: 'follow' | 'unfollow' | 'mute' | 'unmute') => pageRequest<{ following: boolean; followersCount: number }>('/' + id + '/follow', 'POST', { action }),
  block: (id: string, blocked: boolean) => pageRequest<{ blocked: boolean }>('/' + id + '/block', 'POST', { blocked }),
};

export function syncPageFollowState(pageId:string,viewerId:string,following:boolean) {
  window.dispatchEvent(new CustomEvent('onFollowStateChange',{detail:{isPage:true,targetUserId:pageId,viewerId,followStatus:following?'ACTIVE':'NONE'}}));
}
