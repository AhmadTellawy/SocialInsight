import { test, expect } from '@playwright/test';
const name='صفحة الحد الأدنى';
async function fillBasics(page:any){await page.locator('[name="name"]').fill(name);await page.locator('[name="category"]').selectOption('creator');await page.getByRole('checkbox').check();}
async function create(page:any,draft=false){await page.goto('/pages/create?lang=en');await fillBasics(page);await page.getByRole('button',{name:draft?'Save and finish later':'Create and publish',exact:true}).click();await expect(page).toHaveURL(/\/pages\/manage\/.+\?(created|saved)=1/);return new URL(page.url()).pathname.split('/').pop();}
async function state(page:any,id:string){return (await page.request.get('/__test/state/'+id)).json();}
async function details(page:any){await page.getByRole('button',{name:'Page details',exact:true}).click();await expect(page.locator('[name="bio"]')).toBeVisible();}

test('minimal creation publishes and persists with no optional data',async({page})=>{
  const id=await create(page);const result=await state(page,id);
  expect(result.count).toBe(1);expect(result.page.bio).toBe('');expect(result.page.publicationState).toBe('PUBLISHED');
  expect(result.page.handle).toMatch(/^page_[a-f0-9]{24}$/);expect(result.page.publicEmail).toBeNull();
  await page.reload();await expect(page.getByRole('heading',{name})).toBeVisible();
});
test('save later creates private draft; old step URL resumes without clearing optional data',async({page})=>{
  const id=await create(page,true);expect((await state(page,id)).page.publicationState).toBe('DRAFT');
  await details(page);await page.locator('[name="bio"]').fill('نبذة محفوظة\nسطر ثان');await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Changes saved'})).toBeVisible();
  await page.goto('/pages/create?draft='+id+'&step=2&lang=en');await expect(page.locator('[name="bio"]')).toHaveCount(0);
  await page.getByRole('button',{name:'Create and publish',exact:true}).click();await expect(page).toHaveURL(/created=1/);
  const result=await state(page,id);expect(result.count).toBe(1);expect(result.page.bio).toBe('نبذة محفوظة\nسطر ثان');expect(result.page.publicationState).toBe('PUBLISHED');
});
test('later setup accepts Arabic phone, bare website, multiline bio and blank extra link',async({page})=>{
  const id=await create(page);await details(page);
  await page.locator('[name="bio"]').fill('أهلاً\nبكم');await page.locator('[name="website"]').fill('example.com');
  await page.locator('[name="publicPhone"]').fill('+٩٦٢ ۷۹ ١٢٣٤٥٦٧');await page.getByRole('button',{name:'Add a link',exact:true}).click();
  await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Changes saved'})).toBeVisible();
  const result=await state(page,id);expect(result.page.website).toBe('https://example.com');expect(result.page.publicPhone).toBe('+962 79 1234567');expect(result.page.links).toEqual([]);
  await page.reload();await expect(page.locator('[name="bio"]')).toHaveValue('أهلاً\nبكم');
});
test('invalid field explains correction and failed save retains entered data',async({page})=>{
  const id=await create(page);await details(page);await page.locator('[name="publicPhone"]').fill('abcde');await page.locator('[name="description"]').fill('Do not lose this text');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByText('Use at least five digits; +, spaces, parentheses and hyphens are allowed.',{exact:true})).toBeVisible();
  await expect(page.locator('[name="description"]')).toHaveValue('Do not lose this text');expect((await state(page,id)).page.description).toBe('');
  await page.locator('[name="publicPhone"]').fill('');await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Changes saved'})).toBeVisible();
});
test('removing contact clears its action button and blank/partial links are handled separately',async({page})=>{
  const id=await create(page);await details(page);await page.locator('[name="publicEmail"]').fill('test@example.com');await page.locator('[name="cta"]').selectOption('EMAIL');await page.locator('[name="publicEmail"]').fill('');await expect(page.locator('[name="cta"]')).toHaveValue('');
  await page.getByRole('button',{name:'Add a link',exact:true}).click();await page.locator('[name="links.0.title"]').fill('Support');await page.locator('[name="links.0.url"]').fill('javascript:alert(1)');await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.locator('[name="links.0.url"]')).toHaveAttribute('aria-invalid','true');
  await page.locator('[name="links.0.url"]').fill('example.com/help');await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Changes saved'})).toBeVisible();expect((await state(page,id)).page.links[0].url).toBe('https://example.com/help');
});
test('publish failure is recoverable and retry does not create duplicate pages',async({page})=>{
  await page.goto('/pages/create?lang=en');await fillBasics(page);
  await page.route('**/api/pages/manage/*/lifecycle',async route=>{await route.fulfill({status:503,json:{code:'NETWORK_ERROR'}});await page.unroute('**/api/pages/manage/*/lifecycle');});
  await page.getByRole('button',{name:'Create and publish',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.locator('[name="name"]')).toHaveValue(name);
  await page.getByRole('button',{name:'Create and publish',exact:true}).click();await expect(page).toHaveURL(/created=1/);const id=new URL(page.url()).pathname.split('/').pop()!;expect((await state(page,id)).count).toBe(1);
});
test('mobile Arabic minimum form saves a draft without optional controls',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/pages/create?lang=ar');await expect(page.locator('[name="bio"]')).toHaveCount(0);await expect(page.getByRole('textbox')).toHaveCount(1);
  const publish=page.getByRole('button',{name:'إنشاء ونشر الصفحة',exact:true});await expect(publish).toBeVisible();await expect(publish).toHaveCSS('background-color','rgb(0, 112, 186)');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({path:'D:/socialinsight-20261006/.ai-company/memory/tasks/SI-PAGE-CREATION-IMPLEMENTATION-20261024/minimal-create-ar.png',fullPage:true});
  await fillBasics(page);await page.getByRole('button',{name:'حفظ والإكمال لاحقاً',exact:true}).click();await expect(page.getByText('حُفظت مسودتك. أضف التفاصيل أو انشر الصفحة عندما تكون مستعداً.',{exact:true})).toBeVisible();
  await page.screenshot({path:'D:/socialinsight-20261006/.ai-company/memory/tasks/SI-PAGE-CREATION-IMPLEMENTATION-20261024/mobile-draft.png',fullPage:true});
});
test('lost creation response can be retried with edited basics without duplicates or stale name',async({page})=>{
  await page.goto('/pages/create?lang=en');await fillBasics(page);
  await page.route('**/api/pages',async route=>{if(route.request().method()!=='POST')return route.continue();await route.fetch();await route.fulfill({status:503,json:{code:'NETWORK_ERROR'}});await page.unroute('**/api/pages');});
  await page.getByRole('button',{name:'Create and publish',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();
  await page.locator('[name="name"]').fill('اسم جديد بعد المحاولة');await page.getByRole('button',{name:'Create and publish',exact:true}).click();await expect(page).toHaveURL(/created=1/);
  const id=new URL(page.url()).pathname.split('/').pop()!;const result=await state(page,id);expect(result.count).toBe(1);expect(result.page.name).toBe('اسم جديد بعد المحاولة');
});
test('real router still rejects writes without CSRF and management access from another account',async({page,browser})=>{
  const id=await create(page);const denied=await page.request.patch('/api/pages/manage/'+id,{data:{name:'forged'},headers:{Origin:'http://127.0.0.1:4193'}});expect(denied.status()).toBe(403);
  const other=await browser.newContext();const otherPage=await other.newPage();await otherPage.goto('http://127.0.0.1:4193/pages/create?lang=en');await expect(otherPage.locator('[name="name"]')).toBeVisible();const response=await other.request.get('http://127.0.0.1:4193/api/pages/manage/'+id);expect([403,404]).toContain(response.status());await other.close();
});
