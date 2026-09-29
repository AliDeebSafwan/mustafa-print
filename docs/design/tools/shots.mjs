// Screenshots the customer website's pages at phone and desktop size, in Arabic and English.
// usage: node shots.mjs SITE_URL OUT_DIR [prefix]   (needs puppeteer-core + @sparticuz/chromium; see capture notes)
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
const [site, out, prefix = ''] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const pages = [
  ['home', '/ar'], ['services', '/ar/services'], ['service', '/ar/services/business-cards'], ['gallery', '/ar/gallery'],
  ['products', '/ar/products'], ['contact', '/ar/contact'], ['account', '/ar/account'], ['home-en', '/en'],
];
const views = { m: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, d: { width: 1360, height: 900, deviceScaleFactor: 1 } };
const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
for (const [vname, vp] of Object.entries(views)) {
  const page = await browser.newPage();
  await page.setViewport(vp);
  for (const [name, path] of pages) {
    if (vname === 'd' && name === 'account') continue;
    try {
      await page.goto(site + path, { waitUntil: 'networkidle2', timeout: 60000 });
      await new Promise((r) => setTimeout(r, 600));
      const overflow = await page.evaluate(() => {
        const w = document.documentElement.clientWidth;
        const wide = [...document.querySelectorAll('body *')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > w + 1 || r.left < -1); })
          .slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')}`);
        return { page: document.documentElement.scrollWidth, screen: w, wide };
      });
      if (overflow.page > overflow.screen) console.log('  OVERFLOW', name, vname, JSON.stringify(overflow));
      // Headless Chromium renders at most ~8192 physical pixels per capture and wraps beyond it, so tall pages are taken
      // in slices under that limit and stitched (stitch.py). Each slice is exact; fixed elements appear where they sit.
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      const slice = Math.floor(3600 / (vp.deviceScaleFactor ?? 1));
      const files = [];
      for (let y = 0, i = 0; y < height; y += slice, i++) {
        const file = `${out}/.${prefix}${name}-${vname}.${String(i).padStart(2, '0')}.png`;
        await page.screenshot({ path: file, clip: { x: 0, y, width: vp.width, height: Math.min(slice, height - y) }, captureBeyondViewport: true });
        files.push(file);
      }
      writeFileSync(`${out}/.${prefix}${name}-${vname}.parts`, files.join('\n'));
      console.log('shot', `${prefix}${name}-${vname}`);
    } catch (err) { console.log('FAILED', name, vname, String(err).slice(0, 80)); }
  }
  await page.close();
}
await browser.close();
