import { defineConfig, devices } from '@playwright/test'

// Real-browser visual/regression coverage for the USCIS form viewer
// (USCISFormRenderer.jsx) - vitest+jsdom (USCISFormRenderer.test.jsx) proves
// the render logic with react-pdf mocked out; this proves the actual PDF
// rasterizes, paginates, and displays fields in a real Chromium tab against
// the real backend/DB, which jsdom cannot do (no canvas/PDF.js worker).
// Points at an already-running dev server by default (this app is normally
// developed with a long-lived `npm run dev`); set E2E_BASE_URL to target a
// different instance.
export default defineConfig({
  testDir: './e2e',
  // Golden-path specs log in as throwaway staff accounts this run creates and
  // destroys, rather than requiring a real person's credentials in the env.
  globalSetup: './e2e/global-setup.js',
  globalTeardown: './e2e/global-teardown.js',
  // Generous: the backend's case-detail load fans out to ~16 concurrent
  // DB populate queries, making it disproportionately exposed to
  // intermittent Atlas connectivity blips (observed this session -
  // most single queries are fast, but 16-way fan-out has many more
  // chances to hit a bad window per request).
  timeout: 150_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  // One retry absorbs a transient network blip without masking a real
  // rendering regression - a genuine app bug fails the same way twice.
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3002',
    screenshot: 'on',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'laptop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } },
  ],
})
