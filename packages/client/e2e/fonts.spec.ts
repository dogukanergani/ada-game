import { expect, test } from '@playwright/test';
import { MOBILE, SHOTS, openPlayer } from './helpers';
import { join } from 'node:path';

/**
 * Asks Chromium which fonts it really used to draw some text. A font that
 * failed to load, or a missing glyph, would show up as a system fallback.
 */
test('Turkish letters are drawn with our own fonts, in the heading and in the body', async ({ browser }) => {
  const { page } = await openPlayer(browser, MOBILE);
  await page.evaluate(async () => {
    const letters = 'ı İ ş Ş ğ Ğ ç Ç ö Ö ü Ü — Şükrü Iğdır İpek Çağla Öğüt';
    const make = (id: string, tag: string, family: string, weight: number) => {
      const el = document.createElement(tag);
      el.id = id;
      el.textContent = letters;
      el.style.cssText = `font-family:${family};font-weight:${weight};font-size:28px;position:absolute;top:0;left:0;margin:0`;
      document.body.appendChild(el);
    };
    make('probe-head', 'h2', "'Bricolage Grotesque Variable'", 700);
    make('probe-body', 'p', "'Instrument Sans Variable'", 400);
    make('probe-body-bold', 'p', "'Instrument Sans Variable'", 700);
    await document.fonts.ready;
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const used: Record<string, { family: string; custom: boolean; glyphs: number }[]> = {};
  for (const id of ['probe-head', 'probe-body', 'probe-body-bold']) {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `#${id}` });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    used[id] = fonts.map((f) => ({ family: f.familyName, custom: f.isCustomFont, glyphs: f.glyphCount }));
  }

  // everything was drawn by one of our two fonts; nothing fell back to a system font
  expect(used['probe-head'].every((f) => f.custom && /Bricolage/.test(f.family)), JSON.stringify(used['probe-head'])).toBe(true);
  for (const id of ['probe-body', 'probe-body-bold']) {
    expect(used[id].every((f) => f.custom && /Instrument Sans/.test(f.family)), JSON.stringify(used[id])).toBe(true);
  }
  // and the app's real heading and text use them too
  const real = await page.evaluate(() => ({
    h1: getComputedStyle(document.querySelector('h1')!).fontFamily,
    body: getComputedStyle(document.body).fontFamily,
  }));
  expect(real.h1).toContain('Bricolage Grotesque Variable');
  expect(real.body).toContain('Instrument Sans Variable');

  // a picture of the probe, to look at
  await page.locator('#probe-head').evaluate((el) => ((el as HTMLElement).style.top = '60px'));
  await page.locator('#probe-body').evaluate((el) => ((el as HTMLElement).style.top = '120px'));
  await page.locator('#probe-body-bold').evaluate((el) => ((el as HTMLElement).style.top = '180px'));
  await page.evaluate(() => (document.body.style.background = '#0b2530'));
  await page.screenshot({ path: join(SHOTS, '00-fonts-mobile.png'), clip: { x: 0, y: 50, width: 390, height: 200 } });
});
