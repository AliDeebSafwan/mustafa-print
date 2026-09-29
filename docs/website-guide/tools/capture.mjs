// Photographs every page of the customer website for docs/website-guide, by walking it the way a customer does:
// browsing, opening the menu and the showroom, signing up, confirming the email, buying, and finding the order again.
// Needs the demo shop running (docs/design/tools/demo-up.sh, seed_flows.py, web-up.sh).
// usage: node capture.mjs SITE OUT_DIR ORDER_CODE QUOTE_CODE PROOF_CODE API_LOG DESIGN_FILE
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync } from 'node:fs';

const [site, out, orderCode, quoteCode, proofCode, apiLog, designFile] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESK = { width: 1360, height: 860, deviceScaleFactor: 1 };
const b = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
const p = await b.newPage();
await p.setViewport(PHONE);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const go = async (path) => { await p.goto(site + path, { waitUntil: 'load', timeout: 45000 }); await pause(1200); };
const ok = (n) => console.log('shot', n);
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log('FAIL', name, String(e.message).slice(0, 110)); } };
const screen = async (name) => { await p.screenshot({ path: `${out}/${name}.png` }); ok(name); };
const element = async (name, selector) => {
  const el = await p.$(selector); if (!el) throw new Error(`no element ${selector}`);
  await el.scrollIntoView(); await pause(400);
  // a close-up of one section: the floating WhatsApp button would sit on top of it, so it steps aside for the photo
  await p.evaluate(() => document.querySelectorAll('a.fixed').forEach((a) => { a.style.visibility = 'hidden'; }));
  await el.screenshot({ path: `${out}/${name}.png`, captureBeyondViewport: true }); ok(name);
  await p.evaluate(() => document.querySelectorAll('a.fixed').forEach((a) => { a.style.visibility = ''; }));
};
const clickText = async (selector, text) => {
  const handle = await p.evaluateHandle((s, t) => [...document.querySelectorAll(s)].find((e) => e.textContent.includes(t)), selector, text);
  const el = handle.asElement(); if (!el) throw new Error(`nothing matching "${text}"`);
  await el.click();
};
const type = async (selector, text) => { await p.click(selector, { clickCount: 3 }); await p.type(selector, text); };

// ---- home, section by section
await step('home', async () => {
  await go('/ar'); await screen('01-home');
  await p.click('[aria-controls="phone-menu"]'); await pause(300); await screen('02-menu'); await p.keyboard.press('Escape');
  await element('03-promises', 'main > section:nth-of-type(2)');
  await element('04-services', 'main #services');
  await element('05-work', 'main > section:nth-of-type(4)');
  await element('06-how', 'main > section.bg-cyan');
  await element('07-track-form', 'main #track');
  await element('08-cta', 'main > section.bg-magenta');
  await element('09-footer', 'footer');
});
// ---- catalogue
await step('services', async () => { await go('/ar/services'); await screen('10-services'); });
await step('service', async () => {
  await go('/ar/services/business-cards'); await screen('11-service');
  await element('12-service-order', 'article section');
});
await step('products', async () => {
  await go('/ar/products'); await screen('13-products');
  await p.evaluate(() => localStorage.removeItem('mpe.cart.v1'));
  await go('/ar/products');
  // the flyers: sold per sheet with a minimum of 100, so the live total is worth showing
  const card = (await p.evaluateHandle(() => [...document.querySelectorAll('main ul > li')].find((li) => li.textContent.includes('منشورات A5')))).asElement();
  if (!card) throw new Error('flyers not found');
  const qty = await card.$('input[inputmode="decimal"]');
  await qty.evaluate((e) => e.select()); await p.keyboard.type('500'); await pause(300);   // a triple click does not select under touch emulation
  const shootCard = async (name) => { await card.scrollIntoView(); await pause(400); await card.screenshot({ path: `${out}/${name}.png` }); ok(name); };
  await shootCard('14-product-quantity');
  await (await card.$('button.btn-order')).click(); await pause(500);
  await shootCard('15-product-added');
});
await step('gallery', async () => {
  await go('/ar/gallery'); await screen('16-gallery');
  await p.click('main ul > li:first-child button'); await pause(700); await screen('17-gallery-open');
});
await step('contact', async () => { await go('/ar/contact'); await screen('18-contact'); });
// ---- pages a customer reaches from a link
await step('track', async () => { await go(`/ar/track/${orderCode}`); await screen('19-track'); });
await step('quote', async () => { await go(`/ar/quote/${quoteCode}`); await screen('20-quote'); });
await step('proof', async () => { await go(`/ar/proof/${proofCode}`); await screen('21-proof'); });
// ---- a new customer: sign up, confirm, buy, and find the order again
const email = `samira.${Date.now()}@example.com`, password = 'a good long password 2026';
await step('account', async () => {
  await go('/ar/account'); await screen('22-sign-in');
  await clickText('[role="tab"]', 'حساب جديد'); await pause(300);
  await type('#name', 'سميرة حداد'); await type('#email', email); await type('#password', password); await type('#phone', '70 123 987');
  await screen('23-sign-up');
  await p.click('form button[type="submit"]'); await pause(1500); await screen('24-sign-up-sent');
});
await step('verify', async () => {
  let link = '';
  for (const line of readFileSync(apiLog, 'utf8').split('\n')) {
    try { const d = JSON.parse(line); if (d.channel === 'email' && d.to === email) link = (d.body.match(/https?:\/\/\S+/) ?? [''])[0]; } catch { /* not JSON */ }
  }
  if (!link) throw new Error('no confirmation email in the API log');
  await p.goto(link.replace(/^https?:\/\/[^/]+/, site), { waitUntil: 'load' }); await pause(1500); await screen('25-verified');
});
await step('sign in', async () => {
  await go('/ar/account');
  if (await p.$('#password')) { await type('#email', email); await type('#password', password); await p.click('form button[type="submit"]'); await pause(1500); }
});
await step('cart', async () => { await go('/ar/cart'); await screen('26-cart'); });
await step('checkout', async () => {
  await go('/ar/checkout'); await screen('27-checkout');
  await clickText('label', 'توصيل'); await pause(300);
  await type('#address', 'الهرمل، حي السرايا، بناية الخطيب'); await type('#city', 'الهرمل');
  const file = await p.$('input[type="file"]'); await file.uploadFile(designFile); await pause(2500);
  await screen('28-checkout-delivery');
  await element('29-checkout-summary', 'main div.h-fit');
  await Promise.all([p.waitForNavigation({ waitUntil: 'load', timeout: 45000 }), clickText('button', 'إرسال الطلب')]);
  await pause(1500); await screen('30-order-placed');
});
await step('my orders', async () => { await go('/ar/account'); await screen('31-my-orders'); });
await step('legal', async () => { await go('/ar/privacy'); await screen('32-privacy'); await go('/ar/terms'); await screen('33-terms'); });
await step('english', async () => { await go('/en'); await screen('34-home-en'); });
// ---- a computer screen
await step('desktop', async () => {
  await p.setViewport(DESK);
  await go('/ar'); await screen('35-home-desktop');
  await go('/ar/products'); await screen('36-products-desktop');
  await go('/ar/gallery'); await screen('37-gallery-desktop');
});
await b.close();
