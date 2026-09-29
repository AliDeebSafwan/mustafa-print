// Builds docs/website-guide/website-guide.pdf from guide.md and the screenshots in img/: A4, right-to-left,
// in the website's own look (Kufam headings, Cairo text, the four process inks).
// usage: node build-pdf.mjs   (after `npm install` here, or with NODE_PATH pointing at docs/training/tools/node_modules)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { marked } from 'marked';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOC = resolve(HERE, '..');
const WEB = resolve(HERE, '../../../apps/web/public');
const url = (p) => pathToFileURL(p).href;
const AR = 'unicode-range:U+0600-06FF,U+0750-077F,U+08A0-08FF,U+200C-200F,U+FB50-FDFF,U+FE70-FEFC;';
const LA = 'unicode-range:U+0000-00FF,U+2000-206F,U+20AC,U+2212;';
const fonts = `
  @font-face{font-family:Cairo;font-weight:200 1000;src:url(${url(join(WEB, 'fonts/cairo-arabic-wght-normal.woff2'))}) format('woff2');${AR}}
  @font-face{font-family:Cairo;font-weight:200 1000;src:url(${url(join(WEB, 'fonts/cairo-latin-wght-normal.woff2'))}) format('woff2');${LA}}
  @font-face{font-family:Kufam;font-weight:800;src:url(${url(join(WEB, 'fonts/kufam-arabic-800.woff2'))}) format('woff2');${AR}}
  @font-face{font-family:Kufam;font-weight:800;src:url(${url(join(WEB, 'fonts/kufam-latin-800.woff2'))}) format('woff2');${LA}}`;
const css = `${fonts}
  :root { --ink:#0e1726; --muted:#55606e; --rule:#dde3ea; --stock:#eef2f6; --c:#00a3e0; --m:#e5006d; --y:#ffd500; }
  @page { size: A4; margin: 15mm 16mm 17mm; }
  @page :first { margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Cairo, sans-serif; color: var(--ink); font-size: 10.4pt; line-height: 1.8; }
  h1, h2, h3 { font-family: Kufam, Cairo, sans-serif; font-weight: 800; line-height: 1.35; break-after: avoid; }
  h2, h3 { break-inside: avoid; }                       /* never leave a heading's colour bar alone at a page foot */
  p:has(+ div.shots), h2:has(+ div.shots) { break-after: avoid; }   /* the text stays with the screenshots it introduces */
  h2 { font-size: 18pt; margin: 9mm 0 3mm; padding-top: 3mm; }
  h2::before { content: ''; display: block; width: 26mm; height: 2.2mm; margin-bottom: 3mm;
    background: linear-gradient(90deg, var(--ink) 0 25%, var(--y) 25% 50%, var(--m) 50% 75%, var(--c) 75%); }
  p, li { margin: 1.6mm 0; } ol, ul { padding-inline-start: 6mm; margin: 1.5mm 0; }
  strong { font-weight: 800; }
  a { color: inherit; text-decoration: none; }
  blockquote { margin: 4mm 0; padding: 3mm 5mm; border-inline-start: 4px solid var(--m); background: var(--stock); border-radius: 0 3mm 3mm 0; }
  blockquote p { margin: 0; }
  table { border-collapse: collapse; width: 100%; margin: 3mm 0; font-size: 9.6pt; break-inside: avoid; }
  th { background: var(--ink); color: #fff; font-weight: 700; }
  td, th { border: 1px solid var(--rule); padding: 1.8mm 3mm; text-align: start; vertical-align: top; }
  tr:nth-child(even) td { background: #f7f9fb; }
  /* screenshots: phones sit side by side, a computer screen takes the width; each has its caption */
  div.shots { display: flex; justify-content: center; align-items: flex-start; gap: 9mm; margin: 4mm 0 5mm; break-inside: avoid; }
  figure { margin: 0; text-align: center; break-inside: avoid; }
  figure img { display: block; margin: 0 auto; width: auto; height: auto; max-width: 60mm; max-height: 128mm;
    border-radius: 3mm; border: 1px solid #d3d9e0; box-shadow: 0 2mm 5mm -2mm rgba(14,23,38,.25); }
  figure.tall img { max-height: 150mm; }
  figure.wide { width: 100%; } figure.wide img { max-width: 100%; max-height: 105mm; border-radius: 2mm; }
  figcaption { margin-top: 2mm; font-size: 8.6pt; color: var(--muted); font-weight: 600; }
  /* cover */
  .cover { height: 297mm; position: relative; overflow: hidden; break-after: page; background: #fff; padding: 22mm 20mm; }
  .cover .bar { position: absolute; inset: 0 0 auto 0; height: 4mm; display: flex; } .cover .bar span { flex: 1; }
  .cover .mark { display: grid; grid-template-columns: 1fr 1fr; width: 16mm; height: 16mm; border-radius: 3.5mm; overflow: hidden; }
  .cover .brand { display: flex; align-items: center; gap: 5mm; font-family: Kufam; font-weight: 800; font-size: 20pt; }
  .cover h1 { font-size: 40pt; margin: 30mm 0 5mm; max-width: 120mm; }
  .cover .sub { font-size: 13pt; color: var(--muted); max-width: 105mm; line-height: 1.9; }
  .cover .date { position: absolute; bottom: 20mm; inset-inline-start: 20mm; color: var(--muted); font-size: 10pt; }
  .cover .art { position: absolute; width: 150mm; height: 150mm; inset-inline-end: -28mm; bottom: 26mm; }
  .cover .art img.ink { position: absolute; inset: 0; width: 100%; height: 100%; mix-blend-mode: multiply; }
  .cover .art img.phone { position: absolute; width: 58mm; inset-inline-start: 16mm; top: 28mm; border-radius: 5mm; transform: rotate(-4deg);
    box-shadow: 0 10mm 16mm -6mm rgba(14,23,38,.45); border: 1.2mm solid var(--ink); }`;

const md = readFileSync(join(DOC, 'guide.md'), 'utf8');
const [, title] = md.match(/^# (.+)$/m);
let body = marked.parse(md.replace(/^# .+\n/m, '').replace(/\]\(img\//g, `](${url(join(DOC, 'img'))}/`));
// every screenshot becomes a captioned figure; a paragraph of screenshots becomes a row
body = body.replace(/<img src="([^"]+)" alt="([^"]*)"(?: title="([^"]*)")?>/g, (_, src, alt, kind) => {
  const tall = /0[56]-|09-|12-/.test(src) ? ' tall' : '';
  return `<figure class="${kind === 'wide' ? 'wide' : 'phone'}${tall}"><img src="${src}" alt="${alt}"><figcaption>${alt}</figcaption></figure>`;
});
// a <div>, not a <p>: the HTML parser closes a <p> at the first <figure>, which would split the row apart
body = body.replace(/<p>((?:\s*<figure[\s\S]*?<\/figure>\s*)+)<\/p>/g, '<div class="shots">$1</div>');

const now = new Intl.DateTimeFormat('ar-LB-u-nu-latn', { month: 'long', year: 'numeric' }).format(new Date());
const cover = `<section class="cover">
  <div class="bar"><span style="background:var(--ink)"></span><span style="background:var(--y)"></span><span style="background:var(--m)"></span><span style="background:var(--c)"></span></div>
  <div class="brand"><span class="mark"><span style="background:var(--c)"></span><span style="background:var(--m)"></span><span style="background:var(--y)"></span><span style="background:var(--ink)"></span></span>مطبعة المصطفى</div>
  <h1>${title.replace('دليل موقع مطبعة المصطفى', 'دليل الموقع')}</h1>
  <p class="sub">كل صفحات موقع الزبائن بالصور: ما يراه الزبون، وما يفعله فيها، ومن أين تُعدِّل محتواها.</p>
  <div class="art">${['c', 'm', 'y'].map((i) => `<img class="ink" src="${url(join(WEB, `art/halftone-${i}.svg`))}">`).join('')}
    <img class="phone" src="${url(join(DOC, 'img/01-home.png'))}"></div>
  <p class="date">${now}</p>
</section>`;

const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head><body>${cover}${body}</body></html>`;
const tmp = join(DOC, '.guide.html'); writeFileSync(tmp, html);
const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--allow-file-access-from-files'], headless: true });
const page = await browser.newPage();
await page.goto(url(tmp), { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
const faces = await page.evaluate(() => [...document.fonts].map((f) => `${f.family}:${f.status}`).join(' '));
await page.pdf({ path: join(DOC, 'website-guide.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true,
  displayHeaderFooter: true, headerTemplate: '<span></span>',
  footerTemplate: '<div style="width:100%;padding:0 16mm;display:flex;justify-content:space-between;font-size:7.5pt;color:#55606e;font-family:sans-serif"><span>Al-Mustafa Print · Website guide</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>' });
await browser.close();
console.log('fonts:', faces); console.log('pdf: website-guide.pdf');
