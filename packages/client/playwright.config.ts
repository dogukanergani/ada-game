import { defineConfig } from '@playwright/test';

const PLAY = 4300;
const FINISH = 4301;
const DEMOLISH = 4302;
const OFFERS = 4303;
const OFFERS_RES = 4304;
const TIMED = 4305;

/**
 * End-to-end tests run against the real thing: a server process that also
 * serves the built client (`npm run build` first). NODE_ENV=test enables the
 * test-only switches (a fixed seed for dice and decks, and a low target score).
 * Three servers: the usual one plays games at the real target score; the second
 * lowers the target to 3 points so a whole game ends within a minute; the third deals every
 * player six cards of each resource (ADA_TEST_RESOURCES=6) so the Soldier's demolition can be played at once.
 * The sixth lets a host pick a 4-second turn and a 60-second game (ADA_TEST_TURN_SECONDS, ADA_TEST_GAME_SECONDS: added to the
 * lists of the lobby, test servers only) so the timed mode can be watched running out.
 * The seed belongs to the server, so every game on a server draws from one dice stream: a spec that opens many
 * games gets servers of its own (the fourth and fifth), or it would shift the dice of the specs that run after it.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'play', testIgnore: /rules-forced\.spec|timer(-shots)?\.spec|finish\.spec|demolish\.spec|offer-visibility\.spec|hintline\.spec|edge-pick\.spec|seats\.spec|seats-full\.spec/, use: { baseURL: `http://localhost:${PLAY}` } },
    { name: 'timed', testMatch: /timer(-shots)?\.spec/, use: { baseURL: `http://localhost:${TIMED}` } },
    { name: 'finish', testMatch: /finish\.spec/, use: { baseURL: `http://localhost:${FINISH}` } },
    { name: 'demolish', testMatch: /demolish\.spec/, use: { baseURL: `http://localhost:${DEMOLISH}` } },
    { name: 'offers', testMatch: /offer-visibility\.spec|hintline\.spec|seats\.spec/, use: { baseURL: `http://localhost:${OFFERS}` } },
    { name: 'offers-res', testMatch: /offer-visibility\.spec|edge-pick\.spec|seats-full\.spec|rules-forced\.spec/, use: { baseURL: `http://localhost:${OFFERS_RES}` } },
  ],
  webServer: [
    {
      command: 'npm run start -w @ada/server',
      cwd: '../..',
      url: `http://localhost:${PLAY}/`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PORT: String(PLAY), NODE_ENV: 'test', ADA_TEST_CREATE_LIMIT: '1000', ADA_TEST_SEED: '20261020', SERVER_SECRET: 'e2e-secret' },
    },
    {
      command: 'npm run start -w @ada/server',
      cwd: '../..',
      url: `http://localhost:${FINISH}/`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PORT: String(FINISH), NODE_ENV: 'test', ADA_TEST_CREATE_LIMIT: '1000', ADA_TEST_SEED: '20261021', ADA_TEST_VP: '3', SERVER_SECRET: 'e2e-secret' },
    },
    {
      command: 'npm run start -w @ada/server',
      cwd: '../..',
      url: `http://localhost:${DEMOLISH}/`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PORT: String(DEMOLISH), NODE_ENV: 'test', ADA_TEST_CREATE_LIMIT: '1000', ADA_TEST_SEED: '20261022', ADA_TEST_RESOURCES: '6', SERVER_SECRET: 'e2e-secret' },
    },
    {
      command: 'npm run start -w @ada/server',
      cwd: '../..',
      url: `http://localhost:${OFFERS}/`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PORT: String(OFFERS), NODE_ENV: 'test', ADA_TEST_CREATE_LIMIT: '1000', ADA_TEST_SEED: '20261023', SERVER_SECRET: 'e2e-secret' },
    },
    {
      command: 'npm run start -w @ada/server',
      cwd: '../..',
      url: `http://localhost:${OFFERS_RES}/`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PORT: String(OFFERS_RES), NODE_ENV: 'test', ADA_TEST_CREATE_LIMIT: '1000', ADA_TEST_SEED: '20261024', ADA_TEST_RESOURCES: '6', SERVER_SECRET: 'e2e-secret' },
    },
    {
      command: 'npm run start -w @ada/server',
      cwd: '../..',
      url: `http://localhost:${TIMED}/`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PORT: String(TIMED), NODE_ENV: 'test', ADA_TEST_CREATE_LIMIT: '1000', ADA_TEST_SEED: '20261025', ADA_TEST_TURN_SECONDS: '4', ADA_TEST_GAME_SECONDS: '60', SERVER_SECRET: 'e2e-secret' },
    },
  ],
});
