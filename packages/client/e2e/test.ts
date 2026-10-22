import { test as base } from '@playwright/test';
import { closeOpened } from './helpers';

export * from '@playwright/test';

/**
 * `test` with one addition: every browser context a test opened for its players (`openPlayer`) is closed when the
 * test ends. They were never closed, so a long run piled up dozens of open pages, and the late tests of a run
 * started hanging for minutes while they waited for a page that was starved of memory.
 */
export const test = base.extend<{ closePlayers: void }>({
  closePlayers: [
    async ({}, use) => {
      await use();
      await closeOpened();
    },
    { auto: true },
  ],
});
