import { test, expect } from '@playwright/test'

// Phase 2/3 acceptance test: the USCIS form viewer is a visual product, not
// just an API, and "one form works" must never stand in for "all forms
// work" - this drives a REAL Chromium tab against the real backend/DB (only
// this can prove the official PDF actually rasterizes; USCISFormRenderer.test.jsx
// mocks react-pdf out entirely because jsdom has no canvas/PDF.js worker),
// once per supported form code.
//
// Case IDs are pinned rather than discovered through GET /uscis-forms/case
// (the unfiltered "list all case forms" endpoint): that specific route
// reproducibly times out against this Atlas cluster (confirmed via backend
// logs - MongoNetworkTimeoutError to one specific shard member,
// 159.41.196.112:27017 - independent of app code; the per-case route
// GET /uscis-forms/case/:caseId, which the app itself uses and which this
// test still exercises via the real "Forms" tab load, has never shown this
// issue all session). Each ID below is a real, verified CaseForm in this
// dev DB (confirmed to have a live template + case) - not fabricated.
const CASE_MANAGER_EMAIL = 'casemanager@inszoom.com'
const CASE_MANAGER_PASSWORD = 'CaseManager123'

const CASE_ID_BY_FORM_CODE = {
  'I-129': '6a720bec10a0b7740072d8ab',
  'I-129F': '6a74bfe3bbec82d3647476f7',
  'I-130': '6a67eb59093e002d62cad815',
  'I-134': '6a74bfe3bbec82d3647476f7',
  'I-539': '6a7b860765aadcb329cad887',
  'I-539A': '6a7b860765aadcb329cad887',
  'I-907': '6a727ef124b33bd1cd261c46',
}

async function loginAsCaseManager(page) {
  await page.goto('/login')
  await page.getByPlaceholder('Username').fill(CASE_MANAGER_EMAIL)
  await page.getByPlaceholder('Password').fill(CASE_MANAGER_PASSWORD)
  await page.getByRole('button', { name: /login/i }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 })
  const token = await page.evaluate(() => localStorage.getItem('token'))
  expect(token, 'login must produce a stored access token').toBeTruthy()
  return token
}

test.describe('USCIS form rendering - all supported forms', () => {
  for (const formCode of Object.keys(CASE_ID_BY_FORM_CODE)) {
    test(`${formCode} renders visibly, paginates, and is interactive`, async ({ page }) => {
      const consoleErrors = []
      const pageErrors = []
      const failedApiCalls = []
      page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
      page.on('pageerror', (error) => pageErrors.push(error.message))
      page.on('response', (response) => {
        if (response.url().includes('/api/uscis-forms/') && response.status() >= 400) {
          failedApiCalls.push(`${response.status()} ${response.url()}`)
        }
      })

      await loginAsCaseManager(page)
      const caseId = CASE_ID_BY_FORM_CODE[formCode]

      await page.goto(`/crm-cases/${caseId}?tab=forms`)

      // The case-forms table (not the viewer) must load first, and the row
      // for THIS form code specifically - a case can have several forms,
      // and e.g. a plain substring/hasText match on 'I-539' also matches
      // the 'I-539A' row (its text contains 'I-539' as a prefix) - the form
      // code is rendered as its own standalone paragraph, so match that
      // exactly rather than the row's full (subtitle-including) text.
      const row = page.locator('tr').filter({ has: page.getByText(formCode, { exact: true }) })
      // Generous timeout: the case-detail load fans out to ~16 concurrent
      // populate queries server-side (case.service.js), so it's disproportionately
      // exposed to the intermittent Atlas connectivity blips observed this
      // session (most direct single-query timings are fine; this one just
      // has many more chances to hit a bad window per request).
      await expect(row).toBeVisible({ timeout: 90_000 })

      // The Download button must produce the real official USCIS PDF - not
      // a React/HTML rendering of the questionnaire. This drives the ACTUAL
      // application download workflow (not the backend service directly:
      // that's already covered by form-generation-http.integration.test.js)
      // and inspects the real downloaded bytes.
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        row.getByRole('button', { name: 'Download PDF' }).click(),
      ])
      const downloadPath = await download.path()
      expect(downloadPath, `${formCode}: download produced no file`).toBeTruthy()
      const fs = await import('node:fs/promises')
      const downloadedBytes = await fs.readFile(downloadPath)
      expect(downloadedBytes.subarray(0, 5).toString('latin1'), `${formCode}: downloaded file is not a real PDF (got a React/HTML page instead?)`).toBe('%PDF-')
      expect(downloadedBytes.length, `${formCode}: downloaded PDF is suspiciously small to be the real multi-page official form`).toBeGreaterThan(50_000)

      await row.getByRole('button', { name: 'Open Form' }).click()

      // Never a blank viewer / spinner-only state.
      const header = page.locator('h2', { hasText: formCode })
      await expect(header).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText('Unable to load this form.')).toHaveCount(0)
      await expect(page.getByText("incomplete and can't be displayed")).toHaveCount(0)

      // The actual official PDF page image must rasterize - not just the
      // field-overlay skeleton.
      const pageCanvases = page.locator('canvas.react-pdf__Page__canvas')
      await expect(pageCanvases.first()).toBeVisible({ timeout: 30_000 })
      const firstCanvasBox = await pageCanvases.first().boundingBox()
      expect(firstCanvasBox?.width, `${formCode}: first PDF page canvas has no visible width - it did not actually render`).toBeGreaterThan(200)
      expect(firstCanvasBox?.height, `${formCode}: first PDF page canvas has no visible height - it did not actually render`).toBeGreaterThan(200)

      // Field overlays must be present and aligned on top of the page.
      const fieldOverlays = page.locator('button[id^="uscis-field-"]')
      await expect(fieldOverlays.first()).toBeVisible()
      expect(await fieldOverlays.count(), `${formCode}: no field overlays rendered on top of the PDF`).toBeGreaterThan(0)

      // Page count: self-consistent invariant between the sidebar's own
      // count and the actually-rendered canvases - never zero.
      await page.getByRole('button', { name: 'Expand page navigation' }).click()
      const pageNavButtons = page.getByRole('button', { name: /^Pg \d+/ })
      const navPageCount = await pageNavButtons.count()
      expect(navPageCount, `${formCode}: page navigation sidebar reports zero pages`).toBeGreaterThan(0)
      await expect(pageCanvases).toHaveCount(navPageCount, { timeout: 30_000 })

      await page.screenshot({ path: `e2e/screenshots/${formCode}-page-1.png`, fullPage: false })

      // Multi-page navigation, only meaningful when there's more than one page.
      if (navPageCount > 1) {
        await pageNavButtons.nth(1).click()
        await expect(page.locator('#uscis-page-2')).toBeInViewport({ timeout: 10_000 })
        await page.screenshot({ path: `e2e/screenshots/${formCode}-page-2.png`, fullPage: false })
      }

      // The page-nav panel is an absolutely-positioned overlay (z-30) that
      // stays open and intercepts clicks on the toolbar underneath it.
      await page.getByRole('button', { name: 'Collapse page navigation' }).click()

      // Zoom controls must not crash or blank the viewer.
      await page.getByRole('button', { name: '100%', exact: true }).click()
      await expect(pageCanvases.first()).toBeVisible()
      const zoomReadout = page.locator('span.w-12.text-center')
      await page.getByRole('button', { name: 'Zoom in' }).click()
      await expect(zoomReadout).toHaveText(/^\d+%$/)
      await expect(pageCanvases.first()).toBeVisible()
      await page.getByRole('button', { name: 'Zoom out' }).click()
      await expect(pageCanvases.first()).toBeVisible()

      // No uncaught exceptions, no console errors, no failed USCIS-forms API calls.
      expect(pageErrors, `${formCode}: uncaught JS exception(s): ${pageErrors.join('; ')}`).toHaveLength(0)
      expect(failedApiCalls, `${formCode}: failed USCIS-forms API call(s): ${failedApiCalls.join('; ')}`).toHaveLength(0)
      const unexpectedConsoleErrors = consoleErrors.filter((text) => !text.includes('Download the React DevTools'))
      expect(unexpectedConsoleErrors, `${formCode}: console error(s): ${unexpectedConsoleErrors.join('; ')}`).toHaveLength(0)
    })
  }
})
