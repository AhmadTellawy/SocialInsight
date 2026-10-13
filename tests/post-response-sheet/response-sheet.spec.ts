import { test, expect, type Page } from '@playwright/test';

const route = '/tests/post-response-sheet/index.html';
async function open(page: Page, query = '') {
  await page.goto(`${route}?${query}`);
  await page.getByRole('button', { name: /View (options|results)|عرض (الخيارات|النتائج)/ }).click();
  const dialog = page.getByRole('dialog', { name: /Post options|خيارات المنشور/, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function receipt(page: Page) { return JSON.parse(await page.getByTestId('receipt').innerText()); }

for (const width of [320, 390, 1280]) for (const lang of ['en', 'ar']) for (const layout of ['text', 'vertical', 'horizontal']) {
  test(`${width} ${lang} ${layout}: media stays in post, options in sheet, one vote`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${route}?layout=${layout}&lang=${lang}`);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-post-options-body]')).toHaveCount(0);
    const trigger = page.getByRole('button', { name: /View options|عرض الخيارات/ });
    await trigger.click();
    const sheet = page.getByRole('dialog');
    const body = sheet.locator('[data-post-options-body]');
    const names = lang === 'en' ? ['Photo A', 'Photo B', 'Photo C', 'Photo D', 'Photo E'] : ['الخيار 1', 'الخيار 2', 'الخيار 3', 'الخيار 4', 'الخيار 5'];
    for (const name of names) await expect(body.getByRole('button', { name, exact: true })).toHaveCount(1);
    if (layout === 'text') {
      await expect(body.locator('img')).toHaveCount(0);
      const boxes = await body.getByRole('button').evaluateAll(elements => elements.map(el => { const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width}; }));
      expect(boxes.every(b => Math.abs(b.x-boxes[0].x)<1)).toBe(true);
      expect(boxes[4].y).toBeGreaterThan(boxes[0].y);
    } else if (layout === 'vertical') {
      await expect(body.locator('img')).toHaveCount(5);
      await expect(body.locator('img').first()).toHaveCSS('object-fit', 'cover');
      const box=await body.locator('img').first().boundingBox();expect(box!.width).toBeLessThanOrEqual(64);
    } else {
      const row=body.locator('.snap-x');
      expect(await row.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
      const card=await row.locator(':scope > div').first().boundingBox();const rowBox=await row.boundingBox();
      expect(card!.width/rowBox!.width).toBeGreaterThan(.8);expect(card!.width/rowBox!.width).toBeLessThan(.9);
      const image=await row.locator('img').first().boundingBox();expect(Math.abs(image!.width-image!.height)).toBeLessThan(1);
    }
    const bounds=await sheet.boundingBox();expect(bounds!.height).toBeLessThanOrEqual(844*.95+1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await sheet.screenshot({path:info.outputPath('options.png')});
    if (width === 390 && lang === 'en') await page.screenshot({path:info.outputPath('mobile.png')});
    await body.getByRole('button',{name:names[1],exact:true}).click();
    await expect.poll(()=>receipt(page)).toHaveLength(1);
    expect((await receipt(page))[0]).toMatchObject({id:'response-sheet-fixture',selected:['option-1'],anonymous:false});
    await expect(sheet.getByText('24%',{exact:true})).toHaveCount(2);
    await sheet.getByRole('button',{name:lang==='ar'?'إغلاق':'Close',exact:true}).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole('button',{name:/View results|عرض النتائج/})).toBeFocused();
  });
}

test('multiple selection, clarification and anonymity survive closing and reopening',async({page})=>{
  let dialog=await open(page,'multi&followup');
  await dialog.getByRole('button',{name:'Photo A',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Participate',exact:true})).toBeDisabled();
  await dialog.getByRole('textbox').fill('I prefer this scene');
  await dialog.getByRole('button',{name:'Photo C',exact:true}).click();
  await dialog.getByRole('switch').click();
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:/View options/}).click();
  dialog=page.getByRole('dialog');
  await expect(dialog.getByRole('textbox')).toHaveValue('I prefer this scene');
  await expect(dialog.getByRole('switch')).toBeChecked();
  expect(await receipt(page)).toEqual([]);
  await dialog.getByRole('button',{name:'Participate',exact:true}).click();
  await expect.poll(()=>receipt(page)).toHaveLength(1);
  expect((await receipt(page))[0]).toMatchObject({selected:['option-0','option-2'],anonymous:true,followUp:{'option-0':'I prefer this scene'}});
});

test('failed vote remains retryable with error visible inside sheet',async({page})=>{
  const dialog=await open(page,'fail');
  await dialog.getByRole('button',{name:'Photo B',exact:true}).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Photo C',exact:true})).toBeEnabled();
  await dialog.getByRole('button',{name:'Photo C',exact:true}).click();
  await expect.poll(()=>receipt(page)).toHaveLength(2);
});

test('custom option stays in sheet and passes through existing vote callback',async({page})=>{
  const dialog=await open(page,'custom');
  await dialog.getByRole('button',{name:'Add your own choice',exact:true}).click();
  await dialog.getByPlaceholder('Add your own choice...').fill('Another scene');
  await dialog.getByPlaceholder('Add your own choice...').press('Enter');
  await dialog.getByRole('button',{name:'Participate',exact:true}).click();
  await expect.poll(()=>receipt(page)).toHaveLength(1);
  expect((await receipt(page))[0].custom.text).toBe('Another scene');
});

test('private completed results stay hidden and expired polls cannot vote',async({page})=>{
  const dialog=await open(page,'expired&private');
  await expect(dialog.getByRole('button',{name:'Photo A',exact:true})).toBeDisabled();
  expect(await dialog.innerText()).not.toContain('%');
  expect(await receipt(page)).toEqual([]);
});

test('album position and feed route survive browser Back',async({page})=>{
  await page.goto(`${route}?media=album`);
  const carousel=page.getByRole('region',{name:'Post images'});await carousel.focus();await page.keyboard.press('ArrowRight');
  await expect(carousel.getByRole('status')).toHaveText('2/2');
  await page.getByRole('button',{name:/View options/}).click();
  await expect(page.getByRole('dialog')).toBeVisible();await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(carousel.getByRole('status')).toHaveText('2/2');
  expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
});

test('portrait preview closes before options and preserves scroll lock',async({page})=>{
  const dialog=await open(page,'layout=vertical');
  await dialog.locator('[data-post-options-body] img').first().click();
  const preview=page.getByRole('dialog',{name:'Image preview',exact:true});await expect(preview).toBeVisible();
  expect(await receipt(page)).toEqual([]);
  await page.keyboard.press('Escape');await expect(preview).toHaveCount(0);await expect(dialog).toBeVisible();
  expect(await page.evaluate(()=>document.body.style.overflow)).toBe('hidden');
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
});

test('image names remain hidden when disabled by author',async({page})=>{
  const dialog=await open(page,'layout=horizontal&hidden');
  await expect(dialog.getByText('Photo A',{exact:true})).toHaveCount(0);
  await dialog.getByRole('button',{name:'Image option 1',exact:true}).click();
  await expect.poll(()=>receipt(page)).toHaveLength(1);
});

test('posts without post media and share capture retain inline answers',async({page})=>{
  for(const query of ['media=none','media=none&layout=vertical','capture']){
    await page.goto(`${route}?${query}`);
    await expect(page.getByRole('button',{name:/View options|View results/})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Photo A',exact:true})).toBeVisible();
  }
});

test('reposted photo post votes on original post',async({page})=>{
  const dialog=await open(page,'repost&detail');await dialog.getByRole('button',{name:'Photo C',exact:true}).click();
  await expect.poll(()=>receipt(page)).toHaveLength(1);expect((await receipt(page))[0].id).toBe('response-sheet-fixture');
});

test('survey progress survives sheet dismissal',async({page})=>{
  let dialog=await open(page,'mode=survey');
  await dialog.getByRole('button',{name:/Photo A/}).click();await dialog.getByRole('button',{name:/Next/}).click();
  await expect(dialog.getByText('Choose another photo',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:/View options/}).click();dialog=page.getByRole('dialog');
  await expect(dialog.getByText('Choose another photo',{exact:true})).toBeVisible();
});

test('challenge rounds remain available within sheet',async({page})=>{
  const dialog=await open(page,'mode=challenge');
  await expect(dialog.getByRole('button',{name:/Photo/}).first()).toBeVisible();
  await dialog.getByRole('button',{name:/Photo/}).first().click();
  await expect(dialog.getByRole('button',{name:/Photo/}).first()).toBeVisible();
  expect(await receipt(page)).toEqual([]);
});

test('rating still submits through the existing scale',async({page})=>{
  const dialog=await open(page,'rating');
  await dialog.getByTestId('rating-star').nth(3).click();
  await expect(dialog.getByTestId('rating-scale-results')).toBeVisible();
  await expect.poll(()=>receipt(page)).toHaveLength(1);
  expect((await receipt(page))[0].selected).toEqual(['option-3']);
});

test('quiz starts and keeps answer selection within sheet',async({page})=>{
  const dialog=await open(page,'mode=quiz');
  await dialog.getByRole('button',{name:/Photo A/}).click();
  await expect(dialog.getByText('Choose another photo',{exact:true})).toBeVisible();
  await expect(dialog).toBeVisible();
});

test('forced anonymity information stacks above options',async({page})=>{
  const dialog=await open(page,'forced');
  await dialog.getByRole('button',{name:'Anonymous responses',exact:true}).click();
  const info=page.getByRole('dialog',{name:'Anonymous responses',exact:true});await expect(info).toBeVisible();
  await page.goBack();await expect(info).toHaveCount(0);await expect(dialog).toBeVisible();
  await dialog.getByRole('button',{name:'Photo B',exact:true}).click();
  await expect.poll(()=>receipt(page)).toHaveLength(1);expect((await receipt(page))[0].anonymous).toBe(true);
});

test('demographic sheet dismisses before the options sheet',async({page})=>{
  const dialog=await open(page,'demographics');await dialog.getByRole('button',{name:'Photo B',exact:true}).click();
  const demographics=page.getByRole('dialog',{name:'Help Us Improve',exact:true});await expect(demographics).toBeVisible();
  await page.goBack();await expect(demographics).toHaveCount(0);await expect(dialog).toBeVisible();
  expect(await page.evaluate(()=>document.body.style.overflow)).toBe('hidden');
});

test('horizontal touch swipe reaches later choices without dismissing sheet',async({page,context})=>{
  const dialog=await open(page,'layout=horizontal');
  const row=dialog.locator('.snap-x');const bounds=await row.boundingBox();
  const cdp=await context.newCDPSession(page);
  const x=bounds!.x+bounds!.width*.8,y=bounds!.y+80;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for(let step=1;step<=8;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-step*30,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(()=>row.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
  await expect(dialog).toBeVisible();expect(await receipt(page)).toEqual([]);
});
