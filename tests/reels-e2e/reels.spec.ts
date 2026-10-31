import { readFileSync } from 'node:fs';
import { test, expect, Page } from '@playwright/test';

async function call(page: Page, path: string, method = 'GET', body?: unknown) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': sessionStorage.getItem('si_csrf_token') || '' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }, { path, method, body });
}
async function sampleVideo(_page: Page, label: string) {
  const index = label.match(/[123]/)?.[0] || '1';
  return readFileSync(`tests/reels-e2e/fixtures/reel-${index}.webm`).toString('base64');
}
async function upload(page: Page, base64: string) {
  const begin = await call(page, '/api/reels/uploads', 'POST', { size: Buffer.from(base64, 'base64').length, mime: 'video/webm', requestKey: crypto.randomUUID() });
  expect(begin.status).toBe(201);
  await page.evaluate(async ({ url, base64 }) => { const bytes = Uint8Array.from(atob(base64), ch => ch.charCodeAt(0)); const response = await fetch(url, { method: 'PATCH', headers: { 'Tus-Resumable': '1.0.0', 'Upload-Offset': '0', 'Content-Type': 'application/offset+octet-stream' }, body: bytes }); if (!response.ok) throw new Error('Test upload failed'); }, { url: begin.body.uploadUrl, base64 });
  await call(page, `/__test/provider/${begin.body.id}`, 'POST', {});
  const ready = await call(page, `/api/reels/videos/${begin.body.id}`); expect(ready.body.status).toBe('READY');
  return begin.body.id as string;
}
const options = () => [{ id: crypto.randomUUID(), text: 'First choice' }, { id: crypto.randomUUID(), text: 'Second choice' }];
async function publish(page: Page, videoAssetId: string, type = 'Poll', title = 'A Reel question', overrides: Record<string, unknown> = {}) {
  const first = options(), second = options();
  const data = { title, description: 'Real component and API verification', type, presentationFormat: 'REEL', videoAssetId, targetAudience: 'Public', allowComments: true, allowAnonymous: true, allowMultipleSelection: false, allowUserOptions: false, resultsWho: 'Public', resultsTiming: 'AnyTime', demographics: [], expiresAt: new Date(Date.now() + 86400000).toISOString(), ...(type === 'Poll' ? { options: first } : { sections: [{ title: '', questions: [{ id: 'q1', text: 'Question one?', type: 'multiple_choice', options: first, correctOptionId: first[0].id }, { id: 'q2', text: 'Question two?', type: 'multiple_choice', options: second, correctOptionId: second[0].id }] }] }) };
  const result = await call(page, '/api/posts', 'POST', { ...data, ...overrides }); expect(result.status, JSON.stringify(result.body)).toBe(200); return result.body;
}

test('retained viewer stops playback and late navigation when the composer opens', async ({ page }) => {
  await page.goto('/reels'); await expect(page.getByRole('button', { name: 'Create Reel' }).first()).toBeVisible();
  const post = await publish(page, await upload(page, await sampleVideo(page, '1')));
  await page.goto(`/reels?reel=${post.id}`);
  await expect.poll(() => page.locator('video').evaluateAll(nodes => nodes.some(node => !(node as HTMLVideoElement).paused))).toBe(true);
  await page.getByRole('button', { name: 'Create Reel', exact: true }).first().click();
  await expect(page).toHaveURL(/\/create\/reel/); await expect(page.locator('video')).toHaveCount(0);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  await page.route('**/api/posts?presentationFormat=REEL**', async route => { entered(); await gate; await route.continue().catch(() => {}); });
  await page.goto('/reels'); await started;
  await page.getByRole('button', { name: 'Create Reel', exact: true }).first().click(); release();
  await expect(page.getByRole('button', { name: 'Upload video', exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/\/create\/reel/); await expect(page.locator('video')).toHaveCount(0);
});

test('upload retry replaces only a confirmed terminal session without reselecting the video', async ({ page }) => {
  const keys: string[] = [];
  await page.route('**/api/reels/uploads', async route => {
    keys.push(route.request().postDataJSON().requestKey);
    if (keys.length === 1) return route.fulfill({ status: 503, json: { code: 'VIDEO_PROVIDER_UNAVAILABLE', error: 'Temporary provider failure' } });
    if (keys.length === 2) return route.fulfill({ status: 409, json: { code: 'UPLOAD_EXPIRED', error: 'Start a new video upload.' } });
    await route.continue();
  });
  await page.goto('/create/reel'); await expect(page.getByRole('button', { name: 'Upload video', exact: true })).toBeEnabled();
  await page.locator('input[type=file]').first().setInputFiles({ name: 'retry.webm', mimeType: 'video/webm', buffer: Buffer.from(await sampleVideo(page, '1'), 'base64') });
  await page.getByRole('button', { name: 'Upload & prepare video' }).click();
  await expect(page.getByRole('alert')).toContainText('Temporary provider failure');
  await page.getByRole('button', { name: 'Upload & prepare video' }).click();
  await expect(page.getByRole('button', { name: 'Next: questions & settings' })).toBeVisible({ timeout: 30000 });
  expect(keys).toHaveLength(3); expect(keys[1]).toBe(keys[0]); expect(keys[2]).not.toBe(keys[0]);
});

test('camera permission has one owner and late camera streams stop after leaving creation', async ({ page }) => {
  await page.addInitScript(() => {
    const state: any = { calls: 0 }; (window as any).__cameraCheck = state;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: () => { state.calls++; return new Promise(resolve => {
      state.release = () => { const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64; canvas.getContext('2d')!.fillRect(0, 0, 64, 64); state.stream = canvas.captureStream(5); resolve(state.stream); };
    }); } });
  });
  await page.goto('/create/reel'); const button = page.getByRole('button', { name: 'Record video', exact: true }); await expect(button).toBeEnabled();
  await button.evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
  await expect(button).toBeDisabled(); expect(await page.evaluate(() => (window as any).__cameraCheck.calls)).toBe(1);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.evaluate(() => (window as any).__cameraCheck.release());
  await expect.poll(() => page.evaluate(() => (window as any).__cameraCheck.stream.getTracks().every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true);
});

test('a lost response during provider preparation resumes the original upload reservation', async ({ page }) => {
  await page.goto('/create/reel'); await expect(page.getByRole('button', { name: 'Upload video', exact: true })).toBeEnabled();
  expect((await call(page, '/__test/hold-upload', 'POST', {})).status).toBe(200);
  const keys: string[] = []; let abortOriginal!: () => void; let providerRequest: Promise<unknown> | undefined;
  const canAbort = new Promise<void>(resolve => { abortOriginal = resolve; });
  await page.route('**/api/reels/uploads', async route => {
    keys.push(route.request().postDataJSON().requestKey);
    if (keys.length === 1) { providerRequest = route.fetch().catch(() => {}); await canAbort; await route.abort('failed'); }
    else await route.continue();
  });
  try {
    await page.locator('input[type=file]').first().setInputFiles({ name: 'interrupted.webm', mimeType: 'video/webm', buffer: Buffer.from(await sampleVideo(page, '1'), 'base64') });
    await page.getByRole('button', { name: 'Upload & prepare video' }).click();
    await expect.poll(async () => (await call(page, '/__test/hold-upload')).body.entered).toBe(true);
    abortOriginal(); await expect(page.getByRole('alert')).toBeVisible();
    const pendingResponse = page.waitForResponse(response => response.url().endsWith('/api/reels/uploads') && response.status() === 409);
    await page.getByRole('button', { name: 'Upload & prepare video' }).click();
    expect((await (await pendingResponse).json()).code).toBe('UPLOAD_PENDING');
    expect(keys).toHaveLength(2); expect(keys[1]).toBe(keys[0]);
    await call(page, '/__test/hold-upload', 'DELETE'); await providerRequest;
    await page.getByRole('button', { name: 'Upload & prepare video' }).click();
    await expect(page.getByRole('button', { name: 'Next: questions & settings' })).toBeVisible({ timeout: 30000 });
    expect(keys).toHaveLength(3); expect(keys.every(key => key === keys[0])).toBe(true);
    expect((await call(page, '/__test/hold-upload')).body.assets).toBe(1);
  } finally { abortOriginal(); await call(page, '/__test/hold-upload', 'DELETE'); await providerRequest; }
});

test('restricted runtime role previews for Page editors and never returns deleted Page video ownership', async ({ page, browser }) => {
  await page.goto('/reels'); await expect(page.getByRole('button', { name: 'Create Reel' }).first()).toBeVisible();
  const created = await call(page, '/api/pages', 'POST', { name: 'Video ownership', category: 'creator', representationConfirmed: true, requestId: crypto.randomUUID() }); expect(created.status).toBe(201);
  const pageId = created.body.id;
  expect((await call(page, `/api/pages/manage/${pageId}/lifecycle`, 'POST', { action: 'publish' })).status).toBe(200);
  const editorContext = await browser.newContext(); const editor = await editorContext.newPage();
  await editor.goto('http://127.0.0.1:4196/reels'); await expect(editor.getByRole('button', { name: 'Create Reel' }).first()).toBeVisible();
  const editorId = (await call(editor, '/__test/session')).body.user.id;
  expect((await call(page, `/__test/team/${pageId}`, 'POST', { userId: editorId })).status).toBe(200);
  const asset = await upload(editor, await sampleVideo(editor, '1'));
  const post = await publish(editor, asset, 'Poll', 'Page editor Reel', { pageId, pageCreateKey: crypto.randomUUID() });
  expect((await call(editor, `/api/reels/preview/${asset}`)).status).toBe(200);
  await expect.poll(async () => (await call(page, `/api/pages/manage/${pageId}/lifecycle`, 'POST', { action: 'unpublish' })).status).toBe(200);
  expect((await call(editor, `/api/reels/preview/${asset}`)).status).toBe(200);
  expect((await call(page, `/api/reels/preview/${asset}`)).status).toBe(200);
  expect((await call(page, `/__test/team/${pageId}`, 'POST', { userId: editorId, remove: true })).status).toBe(200);
  expect((await call(editor, `/api/reels/preview/${asset}`)).status).toBe(404);
  expect((await call(page, `/api/posts/${post.id}`, 'DELETE')).status).toBe(200);
  expect((await call(editor, `/api/reels/preview/${asset}`)).status).toBe(404);
  const reuse = await call(editor, '/api/posts', 'POST', { title: 'Unauthorized reuse', type: 'Poll', presentationFormat: 'REEL', videoAssetId: asset, options: options() });
  expect(reuse.status).toBe(409);
  expect((await call(editor, `/__test/database/${post.id}`)).body.post).toBeNull();
  await editorContext.close();
});

test('real database lock interleavings preserve attached videos and current replacements', async ({ page }) => {
  await page.goto('/reels'); await expect(page.getByRole('button', { name: 'Create Reel' }).first()).toBeVisible();
  const asset = await upload(page, await sampleVideo(page, '1'));
  const race = await call(page, `/__test/cancel-race/${asset}`, 'POST', {});
  expect(race.status, JSON.stringify(race.body)).toBe(200); expect(race.body.cancellation).toBe('VIDEO_UNAVAILABLE'); expect(race.body.asset.status).toBe('READY');
  const original = await upload(page, await sampleVideo(page, '1'));
  const post = await publish(page, original);
  const replacement = await upload(page, await sampleVideo(page, '2'));
  const update = await call(page, `/__test/update-race/${post.id}`, 'POST', { replacement });
  expect(update.status, JSON.stringify(update.body)).toBe(200); expect(update.body.status, JSON.stringify(update.body.body)).toBe(200);
  expect(update.body.post.videoAssetId).toBe(replacement); expect(update.body.post.responseCount).toBe(1);
  expect((await call(page, `/api/posts/${post.id}`, 'PUT', { videoAssetId: original })).status).toBe(409);
});

test('recorded video upload → original poll editor and settings → preview → publish → answer', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/create/reel'); await expect(page.getByRole('button', { name: 'Upload video', exact: true })).toBeEnabled();
  const base64 = await sampleVideo(page, 'Create a Reel');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'reel.webm', mimeType: 'video/webm', buffer: Buffer.from(base64, 'base64') });
  await page.getByRole('button', { name: 'Upload & prepare video' }).click();
  await page.getByRole('button', { name: 'Next: questions & settings' }).click({ timeout: 30000 });
  await page.getByPlaceholder('Ask a question...').fill('Which experience would you choose?');
  await page.getByPlaceholder('Option 1', { exact: true }).fill('An outdoor adventure');
  await page.getByPlaceholder('Option 2', { exact: true }).fill('A creative workshop');
  await expect(page.getByRole('button', { name: 'Add poll images' })).toBeHidden();
  await expect(page.getByRole('radio', { name: 'Image options' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Custom Domain', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Custom Audience', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Unlock Deeper Analytics', { exact: true })).toBeHidden();
  await page.getByTestId('poll-advanced-settings-trigger').click();
  await expect(page.getByText('Allow user options', { exact: true })).toBeHidden();
  const dialog = page.getByRole('dialog').last(); await expect(dialog).toBeVisible();
  await page.screenshot({ path: 'tests/reels-e2e/artifacts/reel-settings.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Which experience would you choose?' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByPlaceholder('Ask a question...')).toHaveValue('Which experience would you choose?');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByRole('button', { name: 'Publish Reel', exact: true }).click();
  await expect(page).toHaveURL(/\/reels/);
  await page.getByRole('button', { name: 'Show questions & answers' }).click();
  await page.getByRole('button', { name: /An outdoor adventure/ }).click();
  await page.getByRole('button', { name: 'Submit answers' }).click();
  await expect(page.getByText('Your answers are recorded')).toBeVisible();
  expect(errors).toEqual([]);
});

test('creation retry uses the original post; draft resumes and publishes; unattached video belongs to its uploader', async ({ page, browser }) => {
  await page.goto('/reels'); await expect(page.getByRole('button', { name: 'Create Reel' }).first()).toBeVisible();
  const asset = await upload(page, await sampleVideo(page, '1'));
  const draft = await publish(page, asset, 'Poll', 'Draft Reel', { status: 'DRAFT' });
  expect((await call(page, `/api/reels/playback/${draft.id}`)).status).toBe(404);
  expect((await call(page, `/api/reels/preview/${asset}`)).status).toBe(200);
  const retry = await publish(page, asset, 'Poll', 'Ignored retry', { status: 'DRAFT' }); expect(retry.id).toBe(draft.id); expect(retry.title).toBe('Draft Reel');
  const update = await call(page, `/api/posts/${draft.id}`, 'PUT', { status: 'PUBLISHED', description: 'Resumed draft' }); expect(update.status, JSON.stringify(update.body)).toBe(200);
  expect((await call(page, `/api/reels/playback/${draft.id}`)).status).toBe(200);
  const other = await browser.newContext(); const otherPage = await other.newPage(); await otherPage.goto('http://127.0.0.1:4196/reels'); await expect(otherPage.getByRole('button', { name: 'Create Reel' }).first()).toBeVisible();
  const denied = await call(otherPage, '/api/posts', 'POST', { type:'Poll',presentationFormat:'REEL',videoAssetId:asset,title:'Wrong owner',options:options() }); expect(denied.status).toBe(409);
  expect((await call(otherPage, `/api/reels/videos/${asset}`)).status).toBe(404);
  expect((await page.request.post('/api/reels/uploads', { data: { size: 100, mime: 'video/webm', requestKey: crypto.randomUUID() } })).status()).toBe(403);
  await other.close();
});

for (const kind of ['Quiz', 'Multiple questions']) test(`original ${kind} editor creates and previews a text-only Reel`, async ({ page }) => {
  await page.goto('/create/reel'); await expect(page.getByRole('button', { name: 'Upload video', exact: true })).toBeEnabled();
  await page.locator('input[type=file]').first().setInputFiles({ name:'reel.webm',mimeType:'video/webm',buffer:Buffer.from(await sampleVideo(page,'2'),'base64') });
  await page.getByRole('button', { name:'Upload & prepare video' }).click();
  await page.getByRole('button', { name:kind, exact:true }).click({timeout:30000});
  await page.getByRole('button', { name:'Next: questions & settings' }).click();
  if (kind !== 'Quiz') await page.getByPlaceholder('Survey Title', { exact:true }).fill('A survey Reel');
  await page.getByPlaceholder(kind === 'Quiz' ? 'Ask a question...' : 'Question Text', { exact:true }).fill('What is your answer?');
  await page.getByPlaceholder('Option 1', { exact:true }).fill('Choice A'); await page.getByPlaceholder('Option 2', { exact:true }).fill('Choice B');
  if (kind === 'Quiz') await page.getByRole('button', { name:'Mark option 1 as correct' }).click();
  else {
    await page.getByRole('button', {name:'Add Question',exact:true}).click();
    await page.getByPlaceholder('Question Text',{exact:true}).fill('A second question?');
    await page.getByPlaceholder('Option 1',{exact:true}).fill('Choice C'); await page.getByPlaceholder('Option 2',{exact:true}).fill('Choice D');
  }
  await expect(page.getByRole('button', { name:'Add question image',exact:true })).toHaveCount(0);
  await page.getByRole('button', { name:'Next',exact:true }).click();
  await page.getByRole('button', { name:'Preview',exact:true }).click();
  await expect(page.getByRole('button', { name:'Publish Reel',exact:true })).toBeVisible();
  await page.screenshot({path:`tests/reels-e2e/artifacts/reel-${kind === 'Quiz' ? 'quiz' : 'survey'}-preview.png`});
  await page.getByRole('button', { name:'Publish Reel',exact:true }).click(); await expect(page).toHaveURL(/\/reels/);
});

test('Page publisher identity is retained and unpublishing the Page revokes new video grants', async ({ page, browser }) => {
  await page.goto('/reels'); await expect(page.getByRole('button', { name:'Create Reel' }).first()).toBeVisible();
  const created = await call(page, '/api/pages', 'POST', { name:'Reel publisher',category:'creator',representationConfirmed:true,requestId:crypto.randomUUID() });
  expect(created.status, JSON.stringify(created.body)).toBe(201); const pageId = created.body.id;
  expect((await call(page, `/api/pages/manage/${pageId}/lifecycle`, 'POST', {action:'publish'})).status).toBe(200);
  const asset = await upload(page, await sampleVideo(page, '3'));
  const post = await publish(page, asset, 'Poll', 'Published as a Page', { pageId, pageCreateKey:crypto.randomUUID() });
  expect(post.pageId).toBe(pageId); expect(post.author.kind).toBe('PAGE'); expect(post.author.id).toBe(pageId);
  expect((await call(page, `/api/reels/playback/${post.id}`)).status).toBe(200);
  const other = await browser.newContext(); const otherPage = await other.newPage(); await otherPage.goto('http://127.0.0.1:4196/reels'); await expect(otherPage.getByRole('button', {name:'Create Reel'}).first()).toBeVisible();
  expect((await call(otherPage, `/api/reels/preview/${asset}`)).status).toBe(404);
  await expect.poll(async () => {
    const result = await call(page, `/api/pages/manage/${pageId}/lifecycle`, 'POST', {action:'unpublish'});
    if (result.status === 409) expect(result.body.code).toBe('PAGE_ACCOUNT_BUSY');
    return result.status;
  }, { intervals:[100,250,500], timeout:5000 }).toBe(200);
  expect((await call(otherPage, `/api/reels/playback/${post.id}`)).status).toBe(404);
  expect((await call(page, `/api/reels/preview/${asset}`)).status).toBe(200);
  await other.close();
});

test('camera permission failure offers upload and non-video files are rejected before transfer', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value:async () => { throw new DOMException('Denied','NotAllowedError'); } }));
  await page.goto('/create/reel'); await page.getByRole('button', {name:'Record video',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Allow camera and microphone');
  await expect(page.getByRole('button',{name:'Upload video',exact:true})).toBeEnabled();
  let uploads=0; page.on('request', req => { if (req.url().endsWith('/api/reels/uploads')) uploads++; });
  await page.locator('input[type=file]').first().setInputFiles({name:'wrong.txt',mimeType:'text/plain',buffer:Buffer.from('not a video')});
  await expect(page.getByRole('alert')).toContainText('Choose an MP4'); expect(uploads).toBe(0);
});

test('three videos, right swipe to creator and return, white comments, keyboard and RTL navigation', async ({ page }) => {
  await page.goto('/reels'); await expect(page.getByRole('button', { name: 'Create Reel' }).first()).toBeVisible();
  const ids: string[] = [];
  for (let index = 1; index <= 3; index++) { const asset = await upload(page, await sampleVideo(page, `Reel ${index}`)); const reel = await publish(page, asset, 'Poll', `Reel ${index}`); ids.push(reel.id); }
  await page.goto(`/reels?reel=${ids[2]}`);
  await expect(page.locator('video')).toHaveCount(1);
  await expect.poll(() => page.locator('video').evaluate((el: HTMLVideoElement) => el.readyState)).toBeGreaterThan(1);
  const question = await page.getByRole('button', { name: 'Show questions & answers' }).boundingBox(); const like = await page.getByRole('button', { name: 'Like', exact: true }).boundingBox(); expect(question!.y).toBeLessThan(like!.y);
  const scroller = page.getByLabel('Swipe up or down for Reels; swipe right for the creator');
  await scroller.focus(); await page.keyboard.press('ArrowDown'); await expect(page).toHaveURL(new RegExp(ids[1]));
  await page.getByRole('button', { name: 'Comment', exact: true }).click(); await expect(page.getByRole('dialog')).toBeVisible();
  await expect.poll(() => page.locator('video').evaluate((el: HTMLVideoElement) => el.paused)).toBe(true);
  await page.screenshot({ path: 'tests/reels-e2e/artifacts/reel-white-comments.png' }); await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page).toHaveURL(new RegExp(ids[1]));
  const touchSession = await page.context().newCDPSession(page);
  await touchSession.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x:70,y:300}]});
  await touchSession.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{x:250,y:310}]});
  await touchSession.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
  await expect(page.getByRole('heading', { name: 'Creator profile' })).toBeVisible(); await page.getByRole('button', { name: 'Back to Reels' }).click();
  await expect(page).toHaveURL(new RegExp(ids[1])); await expect(page.locator('video')).toHaveCount(1);
  await page.screenshot({ path: 'tests/reels-e2e/artifacts/reel-viewer.png' });
  await page.goto(`/reels?reel=${ids[2]}&lang=ar`); await expect(page.getByRole('button', { name: 'إظهار الأسئلة والإجابات' })).toBeVisible(); await page.screenshot({ path: 'tests/reels-e2e/artifacts/reel-viewer-ar.png' });
});

test('server rejects hidden images and incomplete answers; quiz is graded atomically, retry cannot change totals', async ({ page, browser }) => {
  await page.goto('/reels'); await expect(page.getByRole('button', {name:'Create Reel'}).first()).toBeVisible(); const asset = await upload(page, await sampleVideo(page, 'Quiz')); const quiz = await publish(page, asset, 'Quiz', 'A secure quiz');
  const read = await call(page, `/api/posts/${quiz.id}`); expect(JSON.stringify(read.body)).not.toContain('isCorrect'); expect(JSON.stringify(read.body)).not.toContain('correctOptionId');
  const questions = quiz.sections.flatMap((section: any) => section.questions);
  const partial = await call(page, `/api/posts/${quiz.id}/vote`, 'POST', { answers: [{ questionId: questions[0].id, optionId: questions[0].options[0].id }] }); expect(partial.status).toBe(400);
  let db = await call(page, `/__test/database/${quiz.id}`); expect(db.body.post.responseCount).toBe(0); expect(db.body.post.responses).toHaveLength(0);
  const answers = questions.map((question: any) => ({ questionId: question.id, optionId: question.options[0].id }));
  const sent = await call(page, `/api/posts/${quiz.id}/vote`, 'POST', { answers }); expect(sent.status).toBe(200); expect(sent.body.quizResult).toEqual({ correct: 2, total: 2 });
  const retry = await call(page, `/api/posts/${quiz.id}/vote`, 'POST', { answers }); expect(retry.status).toBe(200);
  db = await call(page, `/__test/database/${quiz.id}`); expect(db.body.post.responseCount).toBe(1); expect(db.body.post.responses).toHaveLength(1); expect(db.body.post.responses[0].answers).toHaveLength(2);
  const changed = await call(page, `/api/posts/${quiz.id}/vote`, 'POST', { answers: answers.map((a: any, index: number) => ({ ...a, optionId: questions[index].options[1].id })) }); expect(changed.status).toBe(409);
  const other = await browser.newContext(); const otherPage = await other.newPage(); await otherPage.goto('http://127.0.0.1:4196/reels'); await expect(otherPage.getByRole('button',{name:'Create Reel'}).first()).toBeVisible();
  expect((await call(otherPage, `/api/reels/preview/${asset}`)).status).toBe(404);
  await otherPage.goto(`http://127.0.0.1:4196/reels?reel=${quiz.id}`);
  await otherPage.getByRole('button', {name:'Like',exact:true}).click();
  await expect(otherPage.getByRole('button', {name:'Like',exact:true})).toHaveAttribute('aria-pressed','true');
  await otherPage.getByRole('button', {name:'Post options',exact:true}).click();
  await otherPage.getByRole('button').filter({hasText:"I don't want to see this"}).click();
  await expect(otherPage.getByText('Reel hidden', {exact:true})).toBeVisible();
  await expect(otherPage).not.toHaveURL(new RegExp(quiz.id));
  await otherPage.getByRole('button', {name:'Undo',exact:true}).click();
  await expect(otherPage).toHaveURL(new RegExp(quiz.id));
  await expect(otherPage.getByRole('button', {name:'Like',exact:true})).toHaveAttribute('aria-pressed','true');
  await call(page, `/__test/privacy/${quiz.id}`, 'POST', {}); expect((await call(otherPage, `/api/reels/playback/${quiz.id}`)).status).toBe(404);
  await call(page, `/__test/expire/${quiz.id}`, 'POST', {}); expect((await call(page, `/api/reels/playback/${quiz.id}`)).status).toBe(200);
  expect((await call(page, `/api/posts/${quiz.id}/vote`, 'POST', { answers })).status).toBe(400);
  await other.close();
  const invalid = await call(page, '/api/posts', 'POST', { presentationFormat:'REEL',videoAssetId:asset,type:'Poll',title:'Images forbidden',options:[{text:'A',imageMediaId:'hidden'},{text:'B'}] }); expect(invalid.status).toBe(400);
});
