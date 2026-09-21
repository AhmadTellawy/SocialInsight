export const profilePath = (user: { id: string; handle?: string }) => user.handle
  ? `/@${encodeURIComponent(user.handle)}` : `/profile/${encodeURIComponent(user.id)}`;

export const profileSettingsPages = new Set([
  'edit-profile', 'links', 'language', 'demographics', 'notifications-detailed', 'group-privacy', 'account-privacy',
]);

export function decodeRouteSegment(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    return decoded && !/[\s/\\?#\u0000-\u001f]/u.test(decoded) ? decoded : '';
  } catch { return ''; }
}

/** Aliases replace the current entry; they never add another stop to Back. */
export function canonicalPath(path: string): string {
  const trimmed = path.replace(/\/+$/, '') || '/';
  return trimmed.replace(/^\/groups\//, '/group/');
}

export function isKnownPath(path: string): boolean {
  if (path === '/pages') return true;
  if (path.startsWith('/pages/')) {
    const segments = path.slice('/pages/'.length).split('/');
    if (segments.length === 1) return segments[0] !== 'manage' && Boolean(decodeRouteSegment(segments[0]));
    if (segments.length === 2 && ['manage', 'staff', 'cases'].includes(segments[0])) return Boolean(decodeRouteSegment(segments[1]));
    return false;
  }
  if (['/', '/search', '/trends', '/notifications', '/messages', '/profile', '/privacy', '/login', '/signup', '/settings/profile'].includes(path)) return true;
  if (/^\/create\/(poll|survey|quiz|challenge|group|business)$/.test(path)) return true;
  if (path.startsWith('/settings/profile/')) return profileSettingsPages.has(path.slice('/settings/profile/'.length));
  if (path.startsWith('/@')) return Boolean(decodeRouteSegment(path.slice(2)));
  const match = path.match(/^\/(profile|post|group|hashtag)\/([^/]+)(\/settings)?$/);
  return Boolean(match && decodeRouteSegment(match[2]) && (!match[3] || match[1] === 'group'));
}

export function hasAppPredecessor(state: unknown): boolean {
  const idx = (state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' && Number.isInteger(idx) && idx > 0;
}
