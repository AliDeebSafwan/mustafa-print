// Draws the three ink layers of the website's hero art: overlapping cyan, magenta and yellow discs built from real
// halftone dots (each ink on its own screen angle, as offset printers do). Stacked with mix-blend-mode: multiply the
// overlaps become red, green and blue by themselves. Static files: cheap to serve and cache, no DOM nodes in the page.
// usage: node halftone.mjs OUT_DIR
import { mkdirSync, writeFileSync } from 'node:fs';
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const S = 1000, R = 285, PITCH = 21;
const inks = [
  { name: 'c', color: '#00a3e0', cx: 385, cy: 385, angle: 15 },
  { name: 'm', color: '#e5006d', cx: 615, cy: 385, angle: 75 },
  { name: 'y', color: '#ffd500', cx: 500, cy: 585, angle: 0 },
];
for (const ink of inks) {
  const rad = (ink.angle * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const dots = [];
  for (let i = -60; i <= 60; i++) for (let j = -60; j <= 60; j++) {
    const x = ink.cx + (i * cos - j * sin) * PITCH, y = ink.cy + (i * sin + j * cos) * PITCH;
    const d = Math.hypot(x - ink.cx, y - ink.cy) / R;
    if (d > 1) continue;
    // full dots inside, shrinking to nothing at the rim: the edge dissolves the way a printed tone does
    const r = (PITCH / 2) * 1.02 * Math.max(0, Math.min(1, 1.35 - Math.pow(d, 2.4) * 1.35));
    if (r > 0.6) dots.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}"/>`);
  }
  writeFileSync(`${out}/halftone-${ink.name}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" fill="${ink.color}">${dots.join('')}</svg>`);
  console.log(ink.name, dots.length, 'dots');
}
