import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

  await page.goto('http://localhost:3000');
  
  // Give it a bit of time to render and for us to see logs from useMemo
  await new Promise(r => setTimeout(r, 5000));
  
  await browser.close();
})();
