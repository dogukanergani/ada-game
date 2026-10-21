import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, BrowserContext, Page } from '@playwright/test';

export const MOBILE = { width: 390, height: 844 };
export const DESKTOP = { width: 1280, height: 800 };
export const SMALL = { width: 360, height: 640 };
export const SHOTS = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'docs', 'screenshots');

export interface Player {
  context: BrowserContext;
  page: Page;
}

/** A separate browser context (its own storage, so its own identity). */
export async function openPlayer(browser: Browser, viewport = MOBILE, locale = 'tr-TR', prepare?: (page: Page) => void): Promise<Player> {
  const context = await browser.newContext({ viewport, locale, hasTouch: viewport.width < 600, isMobile: viewport.width < 600, deviceScaleFactor: 2 });
  const page = await context.newPage();
  prepare?.(page);
  await page.goto('/');
  return { context, page };
}

export async function shot(page: Page, name: string, size: 'mobile' | 'desktop' | 'small') {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}-${size}.png`), fullPage: false });
}
