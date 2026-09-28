import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
const [appUrl, outDir, planJson] = process.argv.slice(2);
const plan = JSON.parse(planJson);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (const role of plan) {
  // One whole browser per role, like each person on their own phone (and single-process Chromium has no second context).
  const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
  const page = await browser.newPage();
  // An Arabic phone: the app picks its language from the device before anyone signs in.
  await page.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'language', { get: () => 'ar' }); Object.defineProperty(navigator, 'languages', { get: () => ['ar'] }); });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'ar' });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(appUrl, { waitUntil: 'networkidle0' });
  if (role.loginShot) await page.screenshot({ path: `${outDir}/${role.loginShot}.png` });
  await page.type('input[autocomplete="username"], input[type="text"], input[type="email"]', role.user);
  await page.type('input[type="password"]', role.password);
  await page.keyboard.press('Enter');
  const ok = await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 30000 }, role.waitFor).then(() => true, () => false);
  await wait(1500);
  if (!ok) { await page.screenshot({ path: `${outDir}/_debug-${role.user.split('@')[0]}.png` }); console.log('  (after sign-in, not found)', role.waitFor, '| url', page.url(), '| text:', (await page.evaluate(() => document.body.innerText)).slice(0, 300).replace(/\n/g, ' / ')); }
  if (role.readyShot) await page.screenshot({ path: `${outDir}/${role.readyShot}.png` });
  // The one-time "works offline" notice, dismissed as the person would, so it does not cover the screens below.
  const [later] = await page.$$('xpath/.//button[contains(., "لاحقاً")]');
  if (later) { await later.click(); await wait(500); }
  for (const s of role.shots) {
    // Moving inside the app, as a tap would: a full reload would start the app over.
    await page.evaluate((path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }, s.path);
    await wait(1200);
    if (s.waitFor) await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 15000 }, s.waitFor).catch(() => console.log('  (text not found)', s.name, s.waitFor));
    for (const step of s.steps ?? []) {
      if (step.type) { await page.type(step.type, step.text); await wait(600); }
      if (step.clickText) { const [el] = await page.$$(`xpath/.//button[contains(., "${step.clickText}")]`); if (el) { await el.click(); await wait(700); } else console.log('  (no button)', step.clickText); }
      if (step.scrollText) { await page.evaluate((t) => { const el = [...document.querySelectorAll('h1,h2,h3,legend,label,button,a')].find((e) => e.textContent.trim().includes(t)); el?.scrollIntoView({ block: 'start' }); }, step.scrollText); await wait(500); }
      if (step.selectFirst) { const v = await page.$eval(step.selectFirst, (el) => el.options[1]?.value); if (v) { await page.select(step.selectFirst, v); await wait(700); } }
    }
    await wait(500);
    await page.screenshot({ path: `${outDir}/${s.name}.png`, fullPage: Boolean(s.full) });
    console.log('  shot', s.name);
    // Further down the same screen, in the same visit: the same order, as a person scrolling would see it.
    for (const more of s.then ?? []) {
      await page.evaluate((t) => { const el = [...document.querySelectorAll('h1,h2,h3,legend,label,button,a')].find((e) => e.textContent.trim().includes(t)); el?.scrollIntoView({ block: 'start' }); }, more.scrollText);
      await wait(500);
      await page.screenshot({ path: `${outDir}/${more.name}.png` });
      console.log('  shot', more.name);
    }
  }
  await browser.close();
}
