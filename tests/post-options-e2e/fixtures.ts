import { test as base, expect, type Page, type Route } from '@playwright/test';
import path from 'node:path';
import en from '../../locales/en/translation.json' with { type: 'json' };
import ar from '../../locales/ar/translation.json' with { type: 'json' };

export const OWNER = 'post-options-owner';
export const VIEWER = 'post-options-viewer';
export const POST = 'post-options-poll';
export const ORIGINAL = 'Synthetic original poll title';
const tailwindAsset = path.resolve('tests/post-options-e2e/assets/tailwind.js');
const user = (id: string) => ({ id, name: id === OWNER ? 'Synthetic Author' : 'Synthetic Viewer', handle: id,
  avatar: '', type: 'Personal', groups: [], interests: [], isPrivate: id === OWNER,
  email: `${id}@example.test`, language: 'en', demographics: {}, profileLinks: [],
  stats: { followers: 0, following: 0, posts: 1, responses: 0 } });

export type State = {
  actor: string; expired: boolean; failSave: boolean; failDelete: boolean; failShare: boolean;
  failAction: boolean; follow: 'NONE' | 'PENDING'; saved: boolean; hidden: boolean; tagged: boolean;
  deleted: boolean; title: string; holdShare?: Promise<void>; holdSave?: Promise<void>; unshare: boolean;
  holdFollow?: Promise<void>; holdFollowRead?: Promise<void>;
  calls: { method: string; path: string; body: any }[]; unexpected: string[];
};
const makeState = (): State => ({ actor: OWNER, expired: false, failSave: false, failDelete: false,
  failShare: false, failAction: false, follow: 'NONE', saved: false, hidden: false, tagged: false,
  deleted: false, unshare: false, title: ORIGINAL, calls: [], unexpected: [] });

export const post = (s: State) => ({ id: POST, title: s.title, description: '', type: 'Poll',
  status: 'PUBLISHED', authorId: OWNER, author: user(OWNER), participants: 0, likes: 0,
  commentsCount: 0, repostCount: 0, createdAt: new Date(Date.now() - (s.expired ? 86400000 : 60000)).toISOString(),
  targetAudience: 'Public', targetGroups: [], demographics: [], media: [], category: '',
  resultsWho: 'Public', resultsTiming: 'Immediately', allowComments: true, pollChoiceType: 'multiple',
  options: [{ id: 'synthetic-option-a', text: 'Synthetic choice A', votes: 0 }, { id: 'synthetic-option-b', text: 'Synthetic choice B', votes: 0 }],
  isSaved: s.saved, taggedUsers: s.tagged ? [{ id: 'synthetic-people-tag', status: 'ACCEPTED', taggedUserId: VIEWER, taggedUser: user(VIEWER) }] : [],
});
const json = (r: Route, data: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });

async function install(page: Page, s: State, language: 'ar' | 'en', baseURL: string) {
  const origin = new URL(baseURL).origin;
  if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Only isolated localhost is supported');
  await page.addInitScript(({ profile, language }) => {
    localStorage.clear();
    localStorage.setItem('si_user', JSON.stringify(profile));
    localStorage.setItem('i18nextLng', language);
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  }, { profile: { ...user(s.actor), language }, language });
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.route('**/*', async route => {
    const req = route.request(); const url = new URL(req.url()); const path = url.pathname; const method = req.method();
    if (url.origin === 'https://cdn.tailwindcss.com' && method === 'GET') {
      return route.fulfill({ path: process.env.POST_OPTIONS_TAILWIND || tailwindAsset, contentType: 'application/javascript' });
    }
    if (url.origin !== origin) {
      // Static third party fonts are deliberately unavailable in this isolated run.
      if (!['font', 'stylesheet', 'image'].includes(req.resourceType())) s.unexpected.push(`${method} ${url.origin}${path}`);
      return route.abort('blockedbyclient');
    }
    if (!path.startsWith('/api/') && !path.startsWith('/socket.io/')) {
      if (method === 'GET') return route.continue();
      s.unexpected.push(`${method} ${path}`); return route.abort('blockedbyclient');
    }
    const body = req.postData() ? (() => { try { return req.postDataJSON(); } catch { return null; } })() : null;
    s.calls.push({ method, path, body });
    if (path.startsWith('/socket.io/')) return route.abort('blockedbyclient');
    if (method === 'GET' && path === '/api/auth/session') {
      return json(route, { user: { ...user(s.actor), language }, csrfToken: 'synthetic-csrf-token-at-least-16' });
    }
    if (method === 'GET' && path === '/api/users/me') return json(route, { ...user(s.actor), language });
    if (method === 'GET' && [OWNER, VIEWER].some(id => path === `/api/users/${id}`)) {
      return json(route, { ...user(path.split('/').at(-1)!), language });
    }
    if (method === 'GET' && path === '/api/posts') return json(route, { data: s.deleted || s.hidden ? [] : [post(s)], nextCursor: null });
    if (method === 'GET' && path === `/api/posts/${POST}`) return json(route, post(s));
    if (method === 'GET' && path === `/api/users/${OWNER}/follow-status`) {
      const viewer = url.searchParams.get('currentUserId');
      const capturedStatus = s.follow;
      if (viewer === VIEWER) await s.holdFollowRead;
      return json(route, { isFollowing: false, followStatus: viewer === 'synthetic-switched-viewer' ? 'NONE' : capturedStatus });
    }
    if (method === 'POST' && path === `/api/users/${OWNER}/follow`) {
      await s.holdFollow;
      s.follow = s.follow === 'PENDING' ? 'NONE' : 'PENDING';
      return json(route, { isFollowing: false, followStatus: s.follow });
    }
    if ((method === 'PUT' && path === `/api/posts/${POST}`) || (method === 'POST' && path === '/api/posts')) {
      await s.holdSave;
      if (s.failSave) return json(route, { error: 'Synthetic unavailable save', code: 'TEST_SAVE_FAILURE' }, 503);
      if (body.status !== 'DRAFT') s.title = body.title;
      return json(route, { ...post(s), ...body, id: method === 'POST' ? 'synthetic-new-draft' : POST });
    }
    if (method === 'DELETE' && path === `/api/posts/${POST}`) {
      if (s.failDelete) return json(route, { error: 'Synthetic delete failure' }, 503);
      s.deleted = true; return json(route, { deletedPostIds: [POST], success: true });
    }
    if (method === 'POST' && path === `/api/posts/${POST}/share`) {
      await s.holdShare;
      if (s.failShare) return json(route, { error: 'Synthetic share failure' }, 503);
      if (s.unshare) return json(route, { action: 'unshared', postId: 'synthetic-repost' });
      return json(route, { ...post(s), id: 'synthetic-repost', author: user(s.actor), sharedFrom: post(s), sharedCaption: body.caption });
    }
    if (path === `/api/posts/${POST}/save` && ['POST', 'DELETE'].includes(method)) {
      if (s.failAction) return json(route, { error: 'Synthetic save failure' }, 503);
      s.saved = method === 'POST'; return json(route, { isSaved: s.saved });
    }
    if (path === `/api/posts/${POST}/hide` && ['POST', 'DELETE'].includes(method)) {
      s.hidden = method === 'POST'; return json(route, { hidden: s.hidden });
    }
    if (path === `/api/posts/${POST}/report` && method === 'POST') {
      if (s.failAction) return json(route, { error: 'Synthetic report failure' }, 503);
      return json(route, { success: true });
    }
    if (path === '/api/posts/people-tags/synthetic-people-tag' && method === 'DELETE') {
      s.tagged = false; return json(route, { success: true });
    }
    if (method === 'POST' && (path === '/api/analytics/interactions/batch' || path === `/api/posts/${POST}/views`)) return json(route, { success: true });
    if (method === 'GET' && (/^\/api\/users\/[^/]+\/(groups|notifications|suggested|followers|following|follow-requests)$/.test(path)
      || ['/api/groups', '/api/posts/saved', '/api/posts/drafts', '/api/users/me/profile-links', '/api/hashtags/trending'].includes(path))) return json(route, []);
    if (method === 'GET' && path === '/api/push/vapid-public-key') return json(route, { publicKey: null });
    s.unexpected.push(`${method} ${path}`); return route.abort('blockedbyclient');
  });
}

export const test = base.extend<{ state: State; words: typeof en; boot: (path?: string) => Promise<void> }>({
  state: async ({}, use) => { await use(makeState()); },
  words: async ({}, use, info) => { await use((info.project.name.startsWith('ar') ? ar : en) as typeof en); },
  boot: async ({ page, state, baseURL }, use, info) => {
    await use(async (path = '/') => {
      await install(page, state, info.project.name.startsWith('ar') ? 'ar' : 'en', baseURL!);
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 120000 });
    });
    expect(state.unexpected, 'Unexpected outbound requests are blocked and fail the test').toEqual([]);
    await info.attach('synthetic-api-calls', { body: JSON.stringify(state.calls, null, 2), contentType: 'application/json' });
  },
});
export { expect };
