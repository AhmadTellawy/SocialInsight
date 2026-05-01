import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));

  await page.goto('http://localhost:3000');
  
  await page.evaluate(() => {
    localStorage.setItem('si_user', JSON.stringify({ id: "123", name: "Test User", handle: "test", email: "test@test.com", password: "123", isVerified: true, hasPassword: true }));
  });

  await page.goto('http://localhost:3000/settings/profile');
  
  await new Promise(r => setTimeout(r, 2000));
  
  const bodyHTML = await page.evaluate(() => document.body.innerHTML);
  console.log("BODY HTML:", bodyHTML.substring(0, 2000));
  
  await browser.close();
})();
