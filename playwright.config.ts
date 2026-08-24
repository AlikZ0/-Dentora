import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'

const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
]
const CHROMIUM = CANDIDATES.find((p) => p && existsSync(p))

/**
 * Browser tests run against the real production build (`nuxt generate`),
 * served statically - the same artefact a user would install as a PWA.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    // The sandbox ships Chromium separately from Playwright's own download,
    // so point at it explicitly. Full Chromium (not the headless shell) is
    // required: the headless shell has no service-worker support.
    launchOptions: { executablePath: CHROMIUM },
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      testMatch: /(app|appointments)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
    {
      // iPhone 13 metrics + touch, to exercise the mobile layout and the
      // bottom navigation. (Real WebKit is verified separately - see README.)
      name: 'mobile',
      testMatch: /mobile\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      },
    },
  ],
  webServer: {
    command: 'node scripts/serve.mjs .output/public 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
