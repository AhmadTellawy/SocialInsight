import { test, expect } from '@playwright/test';

test('built PWA installs the shell without caching API responses', async ({ page }, info) => {
  test.skip(!info.config.metadata.builtPwa, 'Requires the production build with a real service worker.');
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(
      path === '/api/auth/session' ? { user: null, csrfToken: 'synthetic-session-csrf-123456789' } : path === '/api/posts' ? { data: [], nextCursor: null } : []
    ) });
  });
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  const result = await page.evaluate(async () => {
    await fetch('/api/posts');
    const registration = await navigator.serviceWorker.ready;
    const names = await caches.keys();
    const paths: string[] = [];
    for (const name of names) paths.push(...(await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname));
    return { active: registration.active?.state, paths };
  });
  expect(result.active).toBe('activated');
  expect(result.paths).toContain('/index.html');
  expect(result.paths.filter(path => path.startsWith('/api/'))).toEqual([]);
  await info.attach('pwa-cache-boundary', { body: JSON.stringify({ active: result.active, shellEntries: result.paths.length, apiEntries: 0, nativeInstalledPwa: false }), contentType: 'application/json' });
});
