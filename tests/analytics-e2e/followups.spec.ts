import { test, expect, type Page } from '@playwright/test';
import { AggregateResults } from '../../server/src/services/aggregateResults';
import { AnalysisResults, parseAnalysisQuery } from '../../server/src/services/analysisResults';

async function setup(page: Page, scope: 'all' | 'own' | 'none', ar = false, privatePage = false) {
  let denied = false;
  const requests: string[] = [];
  await page.addInitScript(language => localStorage.setItem('i18nextLng', language), ar ? 'ar' : 'en');
  await page.setViewportSize({ width: 384, height: 832 });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()); requests.push(url.pathname + url.search);
    let body: any;
    if (url.pathname.endsWith('/follow-up-answers')) {
      if (denied) { await route.fulfill({ status: 403, json: { error: 'Access revoked' } }); return; }
      body = url.searchParams.has('optionId') ? {
        version: 1, scope, items: url.searchParams.has('cursor') ? [{ id: 'last', text: 'Another private answer', isAnonymous: false, displayName: 'Alex' }] : [{ id: 'first', text: 'I chose it because it is easy to use.\nA second line.', isAnonymous: true, displayName: null }], nextCursor: scope === 'all' && !url.searchParams.has('cursor') ? 'next' : null,
      } : { version: 1, scope, totalAnswers: scope === 'none' ? 0 : 2, groups: scope === 'none' ? [] : ['q1', 'q2'].map(questionId => ({ questionId, questionText: 'Question', optionId: questionId + 'a', optionText: 'Ease of use', followUpLabel: 'What made you choose this option?', answerCount: 2 })) };
    } else {
      const aggregate = new AggregateResults(), analysis = new AnalysisResults();
      for (let i = 0; i < 10; i++) { const row = { answers: [{ questionId: 'q1', optionId: 'q1a' }, { questionId: 'q2', optionId: 'q2a' }], user: null }; aggregate.add(row); analysis.add(row); }
      body = analysis.toJSON(parseAnalysisQuery(Object.fromEntries(url.searchParams))!, aggregate.toJSON());
    }
    await route.fulfill({ json: body });
  });
  await page.goto(`/tests/analytics-e2e/index.html?followups=1${privatePage ? '&private=1' : ''}`);
  return { requests, revoke: () => { denied = true; } };
}

for (const ar of [false, true]) test(`private answers and pagination stay inside Analytics ${ar ? 'Arabic' : 'English'}`, async ({ page }) => {
  const state = await setup(page, 'all', ar);
  await expect(page.locator('.an-answer')).toHaveCount(3);
  await expect(page.locator('.an-followup-group')).toHaveCount(1);
  await expect(page.getByText('I chose it because', { exact: false })).toHaveCount(0);
  await page.locator('.an-followup-group').click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toContainText(ar ? 'مشارك مجهول' : 'Anonymous participant');
  await expect(sheet).toContainText('I chose it because');
  await sheet.getByRole('button', { name: ar ? 'عرض المزيد' : 'Load more' }).click();
  await expect(sheet.locator('.an-followup-answer')).toHaveCount(2);
  await expect(sheet).toContainText('Alex');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/analytics/follow-ups-${ar ? 'ar' : 'en'}.png`, fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('I chose it because', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: ar ? 'السؤال 2' : 'Question 2', exact: true }).click();
  await page.locator('.an-followup-group').click();
  await expect(sheet.locator('.an-followup-answer')).toHaveCount(1);
  expect(state.requests.some(value => value.includes('optionId=q2a'))).toBe(true);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain('I chose it because');
});

test('participant sees own answer and unrelated viewer sees no private section', async ({ page }) => {
  await setup(page, 'own');
  await expect(page.getByRole('heading', { name: 'My follow-up answer' })).toBeVisible();
  await page.getByRole('button', { name: /View my answer/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Your answer only');
  await expect(page.getByRole('dialog')).toContainText('Anonymous answer');
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  await page.unrouteAll(); await setup(page, 'none');
  await expect(page.locator('.an-answer')).toHaveCount(3);
  await expect(page.locator('.an-followups')).toHaveCount(0);
});

test('private Page route is used and revoked access clears open raw answers', async ({ page }) => {
  const state = await setup(page, 'all', false, true);
  await page.locator('.an-followup-group').click();
  await expect(page.getByRole('dialog')).toContainText('I chose it because');
  state.revoke();
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.an-followups')).toHaveCount(0);
  expect(state.requests.filter(path => path.includes('follow-up-answers')).every(path => path.startsWith('/api/pages/manage/private-page/content/analysis-fixture/'))).toBe(true);
});

test('authorization expiry clears raw text before revalidating', async ({ page }) => {
  await page.clock.install();
  const state = await setup(page, 'all');
  await page.locator('.an-followup-group').click();
  await expect(page.getByRole('dialog')).toContainText('I chose it because');
  state.revoke();
  await page.clock.fastForward(30_100);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.an-followups')).toHaveCount(0);
});

for (const image of [false, true]) test(`actual participant can open Analytics for own answer with private results, image=${image}`, async ({ page }) => {
  const profile = { id: 'participant', name: 'Participant', handle: 'participant', email: 'test@example.invalid', avatar: '', language: 'en', theme: 'light', demographics: {}, groups: [], interests: [], stats: {} };
  const option = { id: 'q1a', text: 'Beach', votes: 1, withFollowUp: true, followUpLabel: 'Why the beach?' };
  const post = { id: 'analysis-fixture', title: 'Where next?', description: '', type: 'Poll', status: 'PUBLISHED', author: { ...profile, id: 'owner' }, options: [option], sections: [{ id: 's1', questions: [{ id: 'q1', text: 'Where next?', type: 'multiple_choice', options: [option] }] }], hasParticipated: true, userSelectedOptions: ['q1a'], pollChoiceType: 'single', resultsWho: 'OnlyMe', resultsTiming: 'AfterEnd', expiresAt: '2099-01-01T00:00:00Z', createdAt: '2026-10-01T00:00:00Z', participants: 1, commentsCount: 0, likes: 0 };
  if (image) Object.assign(post, { coverImage: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#c7e5f2"/></svg>'), mediaAspectRatio: 0.8 });
  await page.addInitScript(user => { localStorage.setItem('si_user', JSON.stringify(user)); localStorage.setItem('i18nextLng', 'en'); }, profile);
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (path.endsWith('/results')) { await route.fulfill({ status: 403, json: { error: 'Results are private' } }); return; }
    let body: any = [];
    if (path === '/api/auth/session') body = { user: profile, csrfToken: 'synthetic-only' };
    else if (path === '/api/users/me') body = profile;
    else if (path === '/api/posts') body = { data: [post], nextCursor: null };
    else if (path === '/api/posts/analysis-fixture') body = post;
    else if (path.endsWith('/follow-up-answers')) body = url.searchParams.has('optionId')
      ? { version: 1, scope: 'own', items: [{ id: 'mine', text: 'My private answer', isAnonymous: true, displayName: null }], nextCursor: null }
      : { version: 1, scope: 'own', totalAnswers: 1, groups: [{ questionId: 'q1', optionId: 'q1a', optionText: 'Beach', followUpLabel: 'Why the beach?', answerCount: 1 }] };
    else if (path === '/api/analytics/interactions/batch') body = { acceptedIds: route.request().postDataJSON().events.map((event: any) => event.id), rejected: [], retryableIds: [] };
    await route.fulfill({ json: body });
  });
  await page.goto('/post/analysis-fixture');
  await expect(page.getByText('My private answer', { exact: true })).toHaveCount(0);
  await expect(page.locator('.an-followup-group')).toHaveCount(0);
  await page.getByRole('button', { name: 'Analysis', exact: true }).filter({ hasText: 'Analysis' }).click();
  await expect(page).toHaveURL(/tab=analysis/);
  await expect(page.getByText('Results are unavailable under the access and timing settings.')).toBeVisible();
  await page.getByRole('button', { name: /View my answer/ }).click();
  await expect(page.getByRole('dialog')).toContainText('My private answer');
  await expect(page.getByRole('button', { name: 'Share analysis', exact: true })).toBeDisabled();
});
