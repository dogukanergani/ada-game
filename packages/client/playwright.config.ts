import { defineConfig } from '@playwright/test';

const PLAY = 4300;
const FINISH = 4301;
const CAPTURE = 4302;
const OFFERS = 4303;
const OFFERS_RES = 4304;

/**
 * End-to-end tests run against the real thing: a server process that also
 * serves the built client (`npm run build` first). NODE_ENV=test enables the
 * test-only switches (a fixed seed for dice and decks, and a low target score).
 * Three servers: the usual one plays games at the real target score; the second
 * lowers the target to 3 points so a whole game ends within a minute; the third deals every
 * player six cards of each resource (ADA_TEST_RESOURCES=6) so the Soldier's capture can be played at once.
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
    { name: 'play', testIgnore: /finish\.spec|capture\.spec|offer-visibility\.spec|hintline\.spec|edge-pick\.spec|seats\.spec/, use: { baseURL: `http://localhost:${PLAY}` } },
    { name: 'finish', testMatch: /finish\.spec/, use: { baseURL: `http://localhost:${FINISH}` } },
    { name: 'capture', testMatch: /capture\.spec/, use: { baseURL: `http://localhost:${CAPTURE}` } },
    { name: 'offers', testMatch: /offer-visibility\.spec|hintline\.spec|seats\.spec/, use: { baseURL: `http://localhost:${OFFERS}` } },
    { name: 'offers-res', testMatch: /offer-visibility\.spec|edge-pick\.spec/, use: { baseURL: `http://localhost:${OFFERS_RES}` } },
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
      url: `http://localhost:${CAPTURE}/`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PORT: String(CAPTURE), NODE_ENV: 'test', ADA_TEST_CREATE_LIMIT: '1000', ADA_TEST_SEED: '20261022', ADA_TEST_RESOURCES: '6', SERVER_SECRET: 'e2e-secret' },
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
  ],
});
