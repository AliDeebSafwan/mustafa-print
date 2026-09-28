// Turns the training Markdown into print-ready A4 PDFs: Cairo font, right-to-left, one screenshot per block.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { marked } from 'marked';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(HERE, '..');
const FONTS = resolve(HERE, '../../../apps/web/public/fonts');
const face = (subset, range) => `@font-face{font-family:Cairo;font-weight:200 1000;src:url(${pathToFileURL(join(FONTS, `cairo-${subset}-wght-normal.woff2`))}) format('woff2');${range}}`;
const css = (quick) => `
  ${face('arabic', '')}${face('latin', 'unicode-range:U+0000-00FF,U+2000-206F;')}
  @page { size: A4; margin: ${quick ? '14mm 16mm' : '16mm 18mm 18mm'}; }
  body { font-family: Cairo, sans-serif; color: #101418; font-size: ${quick ? '12.5pt' : '10.5pt'}; line-height: 1.75; }
  h1 { font-size: ${quick ? '20pt' : '22pt'}; margin: 0 0 6mm; border-bottom: 3px solid #101418; padding-bottom: 2mm; }
  h2 { font-size: ${quick ? '13.5pt' : '15pt'}; margin: ${quick ? '4mm' : '8mm'} 0 2mm; break-after: avoid; }
  h3 { font-size: 12pt; margin: 5mm 0 1mm; break-after: avoid; }
  p, li { margin: 1mm 0; } ol, ul { padding-inline-start: 6mm; margin: 1mm 0; }
  img { display: block; margin: 3mm auto; max-height: ${quick ? '0' : '118mm'}; max-width: 62mm; border: 1px solid #d9dde3; break-inside: avoid; }
  p:has(> img) { break-inside: avoid; }
  blockquote { margin: 3mm 0; padding: 2mm 4mm; border-inline-start: 4px solid #e5006d; background: #f4f6f8; }
  table { border-collapse: collapse; width: 100%; margin: 2mm 0; } td, th { border: 1px solid #d9dde3; padding: 1.5mm 2.5mm; text-align: start; }
  code { font-family: monospace; background: #f4f6f8; padding: 0 1mm; }
  a { color: inherit; text-decoration: none; }
  .footer { position: fixed; bottom: -12mm; inset-inline: 0; text-align: center; color: #5b6470; font-size: 8pt; }`;

const docs = [['staff', false], ['owner', false], ['quick-staff', true], ['quick-owner', true]];
const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--allow-file-access-from-files'], headless: true });
for (const [name, quick] of docs) {
  const md = readFileSync(join(DOCS, `${name}.md`), 'utf8').replace(/\]\(img\//g, `](${pathToFileURL(join(DOCS, 'img'))}/`);
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>${css(quick)}</style></head><body>${marked.parse(md)}</body></html>`;
  const tmp = join(DOCS, `.${name}.html`); writeFileSync(tmp, html);
  const page = await browser.newPage();
  await page.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: join(DOCS, `${name}.pdf`), format: 'A4', printBackground: true, preferCSSPageSize: true,
    displayHeaderFooter: !quick, headerTemplate: '<span></span>',
    footerTemplate: '<div style="width:100%;text-align:center;font-size:8pt;color:#5b6470;font-family:sans-serif"><span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
  await page.close();
  console.log('pdf', name);
}
await browser.close();
