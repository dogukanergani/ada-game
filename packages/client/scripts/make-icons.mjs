// Draws public/icon.svg into the PNG sizes a manifest needs, using the Chromium Playwright installed.
// Run: node scripts/make-icons.mjs   (the PNGs are committed; this is only for changing the icon)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const dir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');
const svg = readFileSync(join(dir, 'icon.svg'), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
async function png(file, size, inset = 0) {
  await page.setViewportSize({ width: size, height: size });
  // a maskable icon keeps its picture inside the safe zone (the central 80%) on a full-bleed background
  const pad = Math.round((size * inset) / 2);
  await page.setContent(`<body style="margin:0;background:#0b2530"><div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center"><div style="width:${size - 2 * pad}px;height:${size - 2 * pad}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></div></body>`);
  writeFileSync(join(dir, file), await page.screenshot({ type: 'png' }));
}
await png('icon-192.png', 192);
await png('icon-512.png', 512);
await png('icon-maskable-512.png', 512, 0.2);
await png('apple-touch-icon.png', 180);
await browser.close();
console.log('icons written');
