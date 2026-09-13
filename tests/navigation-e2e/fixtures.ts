import path from 'node:path';
import { test as base, expect, type Page, type Route } from '@playwright/test';
import en from '../../locales/en/translation.json' with { type: 'json' };
import ar from '../../locales/ar/translation.json' with { type: 'json' };

export const profile = { id: 'navigation-user', handle: 'navigation_user', name: 'Navigation Fixture', avatar: '', email: 'navigation@example.test',
  type: 'Personal', language: 'en', bio: '', birthday: '2000-01-01', country: 'Jordan', demographics: {}, profileLinks: [], groups: [], interests: [],
  isPrivate: false, groupPrivacy: 'Public', peopleTagPermission: 'EVERYONE', updatedAt: '2026-09-13T00:00:00.000Z',
  stats: { followers: 0, following: 0, posts: 1, responses: 0 } };
export const group = { id: 'navigation-group', name: 'Navigation Group', description: 'Synthetic group description', image: '', category: 'General', privacy: 'Public',
  createdById: profile.id, ownerId: profile.id, role: 'Owner', membershipStatus: 'JOINED', memberCount: 1, members: [], rules: [],
  stats: { membersCount: 1, postsCount: 0, votesCount: 0 } };
export const post = { id: 'navigation-post', title: 'Navigation fixture poll', type: 'Poll', status: 'PUBLISHED', authorId: profile.id, author: profile,
  description: '', participants: 0, likes: 0, commentsCount: 0, repostCount: 0, createdAt: '2026-09-13T00:00:00.000Z', targetAudience: 'Public',
  targetGroups: [], demographics: [], media: [], category: '', resultsWho: 'Public', resultsTiming: 'Immediately', allowComments: true,
  options: [{ id: 'option-a', text: 'Choice A', votes: 0 }, { id: 'option-b', text: 'Choice B', votes: 0 }] };
export const otherProfile = { ...profile, id: 'other-navigation-user', handle: 'other_navigation_user', name: 'Other Navigation Fixture', isPrivate: false, isFollowing: false, followStatus: 'NONE' };
export const privateProfile = { ...otherProfile, id: 'private-navigation-user', handle: 'private_navigation_user', name: 'Private Navigation Fixture', isPrivate: true };
type State = { calls: string[]; unexpected: string[]; errors: string[]; denyGroupMembers?: boolean; holdProfile?: Promise<void>; profileRequested?: () => void };
const json = (r: Route, value: unknown, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });

async function install(page: Page, state: State, baseURL: string, language: 'ar' | 'en') {
  const origin = new URL(baseURL).origin;
  if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('Navigation tests require isolated localhost');
  page.on('pageerror', error => state.errors.push(error.message));
  await page.addInitScript(({ profile, language }) => {
    localStorage.setItem('si_user', JSON.stringify({ ...profile, language }));
    localStorage.setItem('si_token', 'synthetic-navigation-token');
    localStorage.setItem('i18nextLng', language);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as any).__copiedNavigationUrl = text; } } });
  }, { profile, language });
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.route('**/*', async r => {
    const request = r.request(), url = new URL(request.url()), p = url.pathname, method = request.method();
    if (url.hostname === 'cdn.tailwindcss.com') return r.fulfill({ path: process.env.NAVIGATION_TAILWIND || path.resolve('tests/navigation-e2e/assets/tailwind.js'), contentType: 'application/javascript' });
    if (url.origin !== origin) return r.abort('blockedbyclient');
    if (p.startsWith('/socket.io')) return r.abort('blockedbyclient');
    // Vite preview throws before its SPA fallback for malformed URI encoding.
    // Serve the unchanged production entry document only for this router-guard
    // fixture; hosting-server malformed-URL behavior requires separate live smoke.
    if (request.isNavigationRequest() && p === '/post/%E0%A4%A') {
      return r.fulfill({ path: path.resolve('dist/index.html'), contentType: 'text/html' });
    }
    if (!p.startsWith('/api/')) return r.continue();
    state.calls.push(`${method} ${p}`);
    if (method === 'POST' && (p === '/api/analytics/interactions/batch' || p.endsWith('/views') || p.endsWith('/notifications/read'))) return json(r, { success: true });
    if (method === 'GET') {
      for (const target of [otherProfile, privateProfile]) {
        if (p === `/api/users/${target.id}` || p === `/api/users/handle/${target.handle}`) return json(r, target);
      }
      if (p === '/api/users/me' || p === `/api/users/${profile.id}` || p === `/api/users/handle/${profile.handle}`) {
        if (p.includes('/handle/')) { state.profileRequested?.(); await state.holdProfile; }
        return json(r, { ...profile, language });
      }
      if (p === '/api/posts') return json(r, { data: [post], nextCursor: null });
      if (p === `/api/posts/${post.id}`) return json(r, post);
      if (p.endsWith('/results')) return json(r, []);
      if (p.endsWith('/analytics')) return json(r, { posts: [], responses: [] });
      if (p === `/api/groups/${group.id}`) return json(r, state.denyGroupMembers ? { ...group, permissions: { canViewGroup: true, canViewMembers: false, canManageSettings: true, canInviteMembers: false } } : group);
      if (p.endsWith('/membership')) return json(r, { status: 'JOINED', role: 'Owner' });
      if (p.endsWith('/stats')) return json(r, group.stats);
      if (p.endsWith('/members')) return json(r, { members: [], hasMore: false });
      if (p === `/api/groups/${group.id}/posts`) return json(r, { data: [], nextCursor: null });
      if (p.endsWith('/notification-settings')) return json(r, { settings: { myPosts: { likes: 'everyone', comments: 'everyone', shares: 'following' }, sharedPosts: { likes: 'following', comments: 'following', shares: 'off' }, toggles: {} }, updatedAt: profile.updatedAt });
      if (p === '/api/push/vapid-public-key') return json(r, { publicKey: null });
      if (p === '/api/groups' || p === `/api/users/${profile.id}/groups`) return json(r, [group]);
      if (/\/(notifications|suggested|followers|following|follow-requests|profile-links|saved|drafts|trending|banned)$/.test(p)) return json(r, []);
      if (p.startsWith('/api/search')) return json(r, { topics: [], surveys: [], people: [], users: [], groups: [], posts: [] });
    }
    state.unexpected.push(`${method} ${p}`);
    return json(r, { error: 'Unmocked navigation fixture endpoint' }, 503);
  });
}

export const test = base.extend<{ state: State; word: (key: string) => string; boot: (route?: string) => Promise<void> }>({
  state: async ({}, use) => { await use({ calls: [], unexpected: [], errors: [] }); },
  word: async ({}, use, info) => { const words = (info.project.name.startsWith('ar') ? ar : en) as Record<string, any>; await use(key => words[key] || key.split('.').reduce((obj, part) => obj?.[part], words) || key); },
  boot: async ({ page, state, baseURL }, use, info) => {
    await use(async (route = '/') => { await install(page, state, baseURL!, info.project.name.startsWith('ar') ? 'ar' : 'en'); await page.goto(route); });
    await info.attach('navigation-api-calls', { body: JSON.stringify(state.calls), contentType: 'application/json' });
    expect(state.unexpected, 'Every API request must be explicitly mocked').toEqual([]);
    expect(state.errors, 'No uncaught application errors').toEqual([]);
  },
});
export { expect };
export const back = (page: Page) => page.locator('button').filter({ has: page.locator('svg.lucide-arrow-left') }).first().click();
export const profilePath = `/@${profile.handle}`;
