import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Separate from vite-options.mjs (dev/build use createServer/build with
// configFile: false, so this file never affects those) - vitest's CLI reads
// vite.config first; scoping the name to vitest.config avoids any ambiguity.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    // e2e/ holds Playwright specs (real-browser tests, run via `npx
    // playwright test`) - vitest's default glob also matches *.spec.js, so
    // without this it tries to import them into jsdom and errors on
    // playwright/test's own runtime checks.
    exclude: ['**/node_modules/**', 'e2e/**'],
  },
})
