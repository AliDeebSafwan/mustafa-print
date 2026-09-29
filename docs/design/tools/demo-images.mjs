// Draws stand-in product pictures (no real photos exist yet) so the website can be designed and reviewed with
// realistic content. They are placeholders: the owner's own photographs replace them from the staff app.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire(new URL('../../../apps/api/package.json', import.meta.url));
const sharp = require('sharp');
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const W = 1600, H = 1100;

const bg = (a, b) => `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
  <filter id="sh" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="26" stdDeviation="26" flood-color="#000" flood-opacity=".28"/></filter>
  <filter id="sh2" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#000" flood-opacity=".25"/></filter></defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>`;
const bars = (x, y, w, rows, c = '#1b2129', o = .8, gap = 26, h = 10) => Array.from({ length: rows }, (_, i) => `<rect x="${x}" y="${y + i * gap}" width="${i === rows - 1 ? w * .6 : w}" height="${h}" rx="5" fill="${c}" opacity="${o}"/>`).join('');
const rot = (deg, x, y, inner) => `<g transform="rotate(${deg} ${x} ${y})">${inner}</g>`;
const card = (x, y, w, h, fill, inner = '', r = 10) => `<g filter="url(#sh2)"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>${inner}</g>`;

const scenes = {
  hero: `${bg('#e9edf2', '#c9d3df')}
    ${rot(-8, 800, 550, `<g filter="url(#sh)"><rect x="330" y="200" width="760" height="620" rx="8" fill="#fff"/></g>
      <rect x="330" y="200" width="760" height="70" fill="#101418"/>
      ${['#00a3e0', '#e5006d', '#ffd500', '#101418'].map((c, i) => `<rect x="${370 + i * 90}" y="${300}" width="70" height="70" fill="${c}"/>`).join('')}
      ${['#00a3e0', '#e5006d', '#ffd500'].map((c, i) => `<circle cx="${760 + i * 90}" cy="335" r="35" fill="${c}" opacity="${.9 - i * .15}"/>`).join('')}
      <rect x="370" y="410" width="680" height="200" fill="#f1f3f6"/>${bars(400, 440, 620, 5, '#1b2129', .55, 34, 12)}
      <circle cx="1030" cy="740" r="24" fill="none" stroke="#101418" stroke-width="3"/><path d="M1030 700v80M990 740h80" stroke="#101418" stroke-width="3"/>`)}
    ${rot(6, 1130, 700, `<g filter="url(#sh)"><rect x="1000" y="560" width="380" height="260" rx="8" fill="#e5006d"/></g><rect x="1030" y="600" width="140" height="18" rx="9" fill="#fff"/>${bars(1030, 645, 290, 4, '#fff', .8, 30)}`)}
    ${rot(-14, 300, 800, `<g filter="url(#sh)"><rect x="140" y="700" width="330" height="210" rx="8" fill="#ffd500"/></g><circle cx="230" cy="800" r="42" fill="#101418"/>${bars(300, 770, 140, 3, '#101418', .8, 30)}`)}`,
  cards: `${bg('#1b2129', '#0e1216')}
    ${[0, 1, 2, 3, 4].map((i) => rot(-10 + i * 5, 800, 600, card(560 + i * 24, 360 + i * 20, 560, 330, ['#fff', '#f4f6f8', '#e9edf2', '#fff', '#f9fafb'][i]))).join('')}
    ${rot(4, 800, 600, `<rect x="700" y="500" width="120" height="120" rx="14" fill="#e5006d"/><circle cx="760" cy="560" r="28" fill="#fff"/>${bars(860, 520, 250, 3, '#101418', .85, 34, 14)}${bars(700, 680, 400, 2, '#5b6470', .7, 30, 10)}`)}`,
  flyers: `${bg('#fff4cc', '#ffd500')}
    ${[-24, -8, 8, 24].map((d, i) => rot(d, 800, 1000, `<g filter="url(#sh)"><rect x="560" y="200" width="480" height="680" rx="6" fill="${['#fff', '#f4f6f8', '#00a3e0', '#fff'][i]}"/></g>`)).join('')}
    ${rot(24, 800, 1000, `<rect x="600" y="250" width="400" height="300" fill="#e5006d"/><circle cx="800" cy="400" r="90" fill="#ffd500"/>${bars(610, 600, 380, 4, '#101418', .8, 36, 14)}<rect x="610" y="780" width="200" height="50" rx="25" fill="#101418"/>`)}`,
  banner: `${bg('#dbe6f0', '#b6c8da')}
    <rect y="900" width="${W}" height="200" fill="#9fb2c6" opacity=".55"/>
    <g filter="url(#sh)"><rect x="500" y="130" width="600" height="800" rx="6" fill="#101418"/></g>
    <rect x="500" y="130" width="600" height="800" fill="url(#bg)" opacity="0"/>
    <rect x="530" y="160" width="540" height="740" fill="#00a3e0"/>
    <circle cx="800" cy="420" r="150" fill="#ffd500"/><circle cx="880" cy="380" r="110" fill="#e5006d" opacity=".9"/>
    ${bars(580, 650, 440, 4, '#fff', .95, 44, 18)}
    <rect x="740" y="930" width="120" height="24" rx="12" fill="#5b6470"/><rect x="450" y="950" width="700" height="18" rx="9" fill="#5b6470"/>`,
  stickers: `${bg('#f7e4ee', '#efc3d8')}
    <g filter="url(#sh)"><rect x="230" y="160" width="1140" height="780" rx="14" fill="#fff"/></g>
    ${Array.from({ length: 12 }, (_, i) => { const cx = 380 + (i % 4) * 280, cy = 320 + Math.floor(i / 4) * 230; const c = ['#00a3e0', '#e5006d', '#ffd500', '#101418'][(i * 3) % 4]; return `<circle cx="${cx}" cy="${cy}" r="95" fill="${c}"/><circle cx="${cx}" cy="${cy}" r="62" fill="#fff" opacity=".9"/><circle cx="${cx}" cy="${cy}" r="30" fill="${c}"/>`; }).join('')}`,
  menu: `${bg('#efe9e0', '#d8cfc0')}
    ${rot(-6, 800, 550, `<g filter="url(#sh)"><rect x="330" y="140" width="460" height="820" rx="6" fill="#fff"/><rect x="810" y="140" width="460" height="820" rx="6" fill="#faf7f2"/></g>
      <rect x="330" y="140" width="460" height="230" fill="#101418"/><circle cx="560" cy="255" r="70" fill="#ffd500"/>${bars(370, 420, 380, 3, '#101418', .8, 40, 14)}
      ${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="370" y="${560 + i * 55}" width="240" height="10" rx="5" fill="#1b2129" opacity=".7"/><rect x="690" y="${560 + i * 55}" width="60" height="10" rx="5" fill="#e5006d"/>`).join('')}
      ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="850" y="${190 + i * 55}" width="${300 + (i % 3) * 30}" height="10" rx="5" fill="#1b2129" opacity=".7"/><rect x="1180" y="${190 + i * 55}" width="50" height="10" rx="5" fill="#e5006d"/>`).join('')}
      <rect x="850" y="640" width="380" height="240" fill="#00a3e0" opacity=".9"/><circle cx="1040" cy="760" r="70" fill="#fff" opacity=".9"/>`)}`,
  invitation: `${bg('#e6ecdf', '#c8d4bb')}
    ${rot(8, 800, 550, `<g filter="url(#sh)"><rect x="470" y="180" width="560" height="760" rx="6" fill="#fdfcf8"/></g>
      <rect x="500" y="210" width="500" height="700" fill="none" stroke="#c9a24d" stroke-width="3"/>
      <circle cx="750" cy="380" r="70" fill="none" stroke="#c9a24d" stroke-width="3"/><circle cx="750" cy="380" r="52" fill="#c9a24d" opacity=".25"/>
      ${bars(560, 530, 380, 5, '#2b2b2b', .7, 46, 12)}<rect x="640" y="800" width="220" height="44" rx="22" fill="#c9a24d"/>`)}
    ${rot(-10, 420, 800, `<g filter="url(#sh)"><rect x="180" y="700" width="480" height="300" rx="6" fill="#efe6d2"/></g><path d="M180 700 L420 860 L660 700" fill="none" stroke="#c9b98f" stroke-width="4"/><circle cx="420" cy="850" r="34" fill="#a3242f"/>`)}`,
  folders: `${bg('#dcdff3', '#b9bfe6')}
    ${rot(-6, 800, 600, `<g filter="url(#sh)"><rect x="330" y="220" width="760" height="620" rx="14" fill="#2a2f6b"/></g><rect x="330" y="200" width="300" height="60" rx="12" fill="#2a2f6b"/>
      <circle cx="710" cy="470" r="110" fill="#ffd500"/><circle cx="780" cy="440" r="80" fill="#e5006d"/>${bars(400, 640, 420, 3, '#fff', .9, 44, 16)}`)}
    ${rot(9, 1150, 700, `<g filter="url(#sh)"><rect x="960" y="480" width="360" height="460" rx="8" fill="#fff"/></g><rect x="960" y="480" width="360" height="90" fill="#e5006d"/>${bars(990, 620, 300, 6, '#1b2129', .6, 40, 12)}`)}`,
};
for (const [name, body] of Object.entries(scenes)) {
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`)).png().toFile(`${out}/${name}.png`);
}
console.log(Object.keys(scenes).join(','));
