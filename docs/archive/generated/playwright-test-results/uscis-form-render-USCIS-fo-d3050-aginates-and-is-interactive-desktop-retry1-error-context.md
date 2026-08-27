# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: uscis-form-render.spec.js >> USCIS form rendering - all supported forms >> I-129 renders visibly, paginates, and is interactive
- Location: e2e\uscis-form-render.spec.js:45:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('tr').filter({ has: getByText('I-129', { exact: true }) })
Expected: visible
Timeout: 90000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 90000ms
  - waiting for locator('tr').filter({ has: getByText('I-129', { exact: true }) })

```

```yaml
- complementary:
  - text: I
  - heading "Immigratia" [level=1]
  - paragraph: Internal CRM
  - navigation:
    - button "Dashboard":
      - img
      - text: Dashboard
    - button "Cases":
      - img
      - text: Cases
    - button "Tasks":
      - img
      - text: Tasks
    - button "Messages":
      - img
      - text: Messages
    - button "EOD Reports":
      - img
      - text: EOD Reports
    - button "Documents":
      - img
      - text: Documents
    - button "Questionnaires":
      - img
      - text: Questionnaires
  - button "Logout":
    - img
    - text: Logout
- banner:
  - heading "Cases" [level=2]
  - img
  - textbox "Search cases, clients, companies…"
  - text: Snapshot · Aug 12, 2026
  - button "Refresh":
    - img
    - text: Refresh
  - button "99+":
    - img
    - text: 99+
  - paragraph: John Case Manager
  - paragraph: case manager
  - text: J
- main: Case not found
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test'
  2   | 
  3   | // Phase 2/3 acceptance test: the USCIS form viewer is a visual product, not
  4   | // just an API, and "one form works" must never stand in for "all forms
  5   | // work" - this drives a REAL Chromium tab against the real backend/DB (only
  6   | // this can prove the official PDF actually rasterizes; USCISFormRenderer.test.jsx
  7   | // mocks react-pdf out entirely because jsdom has no canvas/PDF.js worker),
  8   | // once per supported form code.
  9   | //
  10  | // Case IDs are pinned rather than discovered through GET /uscis-forms/case
  11  | // (the unfiltered "list all case forms" endpoint): that specific route
  12  | // reproducibly times out against this Atlas cluster (confirmed via backend
  13  | // logs - MongoNetworkTimeoutError to one specific shard member,
  14  | // 159.41.196.112:27017 - independent of app code; the per-case route
  15  | // GET /uscis-forms/case/:caseId, which the app itself uses and which this
  16  | // test still exercises via the real "Forms" tab load, has never shown this
  17  | // issue all session). Each ID below is a real, verified CaseForm in this
  18  | // dev DB (confirmed to have a live template + case) - not fabricated.
  19  | const CASE_MANAGER_EMAIL = 'casemanager@inszoom.com'
  20  | const CASE_MANAGER_PASSWORD = 'CaseManager123'
  21  | 
  22  | const CASE_ID_BY_FORM_CODE = {
  23  |   'I-129': '6a720bec10a0b7740072d8ab',
  24  |   'I-129F': '6a74bfe3bbec82d3647476f7',
  25  |   'I-130': '6a67eb59093e002d62cad815',
  26  |   'I-134': '6a74bfe3bbec82d3647476f7',
  27  |   'I-539': '6a7b860765aadcb329cad887',
  28  |   'I-539A': '6a7b860765aadcb329cad887',
  29  |   'I-907': '6a727ef124b33bd1cd261c46',
  30  | }
  31  | 
  32  | async function loginAsCaseManager(page) {
  33  |   await page.goto('/login')
  34  |   await page.getByPlaceholder('Username').fill(CASE_MANAGER_EMAIL)
  35  |   await page.getByPlaceholder('Password').fill(CASE_MANAGER_PASSWORD)
  36  |   await page.getByRole('button', { name: /login/i }).click()
  37  |   await page.waitForURL(/\/dashboard/, { timeout: 20_000 })
  38  |   const token = await page.evaluate(() => localStorage.getItem('token'))
  39  |   expect(token, 'login must produce a stored access token').toBeTruthy()
  40  |   return token
  41  | }
  42  | 
  43  | test.describe('USCIS form rendering - all supported forms', () => {
  44  |   for (const formCode of Object.keys(CASE_ID_BY_FORM_CODE)) {
  45  |     test(`${formCode} renders visibly, paginates, and is interactive`, async ({ page }) => {
  46  |       const consoleErrors = []
  47  |       const pageErrors = []
  48  |       const failedApiCalls = []
  49  |       page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
  50  |       page.on('pageerror', (error) => pageErrors.push(error.message))
  51  |       page.on('response', (response) => {
  52  |         if (response.url().includes('/api/uscis-forms/') && response.status() >= 400) {
  53  |           failedApiCalls.push(`${response.status()} ${response.url()}`)
  54  |         }
  55  |       })
  56  | 
  57  |       await loginAsCaseManager(page)
  58  |       const caseId = CASE_ID_BY_FORM_CODE[formCode]
  59  | 
  60  |       await page.goto(`/crm-cases/${caseId}?tab=forms`)
  61  | 
  62  |       // The case-forms table (not the viewer) must load first, and the row
  63  |       // for THIS form code specifically - a case can have several forms,
  64  |       // and e.g. a plain substring/hasText match on 'I-539' also matches
  65  |       // the 'I-539A' row (its text contains 'I-539' as a prefix) - the form
  66  |       // code is rendered as its own standalone paragraph, so match that
  67  |       // exactly rather than the row's full (subtitle-including) text.
  68  |       const row = page.locator('tr').filter({ has: page.getByText(formCode, { exact: true }) })
  69  |       // Generous timeout: the case-detail load fans out to ~16 concurrent
  70  |       // populate queries server-side (case.service.js), so it's disproportionately
  71  |       // exposed to the intermittent Atlas connectivity blips observed this
  72  |       // session (most direct single-query timings are fine; this one just
  73  |       // has many more chances to hit a bad window per request).
> 74  |       await expect(row).toBeVisible({ timeout: 90_000 })
      |                         ^ Error: expect(locator).toBeVisible() failed
  75  | 
  76  |       // The Download button must produce the real official USCIS PDF - not
  77  |       // a React/HTML rendering of the questionnaire. This drives the ACTUAL
  78  |       // application download workflow (not the backend service directly:
  79  |       // that's already covered by form-generation-http.integration.test.js)
  80  |       // and inspects the real downloaded bytes.
  81  |       const [download] = await Promise.all([
  82  |         page.waitForEvent('download'),
  83  |         row.getByRole('button', { name: 'Download PDF' }).click(),
  84  |       ])
  85  |       const downloadPath = await download.path()
  86  |       expect(downloadPath, `${formCode}: download produced no file`).toBeTruthy()
  87  |       const fs = await import('node:fs/promises')
  88  |       const downloadedBytes = await fs.readFile(downloadPath)
  89  |       expect(downloadedBytes.subarray(0, 5).toString('latin1'), `${formCode}: downloaded file is not a real PDF (got a React/HTML page instead?)`).toBe('%PDF-')
  90  |       expect(downloadedBytes.length, `${formCode}: downloaded PDF is suspiciously small to be the real multi-page official form`).toBeGreaterThan(50_000)
  91  | 
  92  |       await row.getByRole('button', { name: 'Open Form' }).click()
  93  | 
  94  |       // Never a blank viewer / spinner-only state.
  95  |       const header = page.locator('h2', { hasText: formCode })
  96  |       await expect(header).toBeVisible({ timeout: 30_000 })
  97  |       await expect(page.getByText('Unable to load this form.')).toHaveCount(0)
  98  |       await expect(page.getByText("incomplete and can't be displayed")).toHaveCount(0)
  99  | 
  100 |       // The actual official PDF page image must rasterize - not just the
  101 |       // field-overlay skeleton.
  102 |       const pageCanvases = page.locator('canvas.react-pdf__Page__canvas')
  103 |       await expect(pageCanvases.first()).toBeVisible({ timeout: 30_000 })
  104 |       const firstCanvasBox = await pageCanvases.first().boundingBox()
  105 |       expect(firstCanvasBox?.width, `${formCode}: first PDF page canvas has no visible width - it did not actually render`).toBeGreaterThan(200)
  106 |       expect(firstCanvasBox?.height, `${formCode}: first PDF page canvas has no visible height - it did not actually render`).toBeGreaterThan(200)
  107 | 
  108 |       // Field overlays must be present and aligned on top of the page.
  109 |       const fieldOverlays = page.locator('button[id^="uscis-field-"]')
  110 |       await expect(fieldOverlays.first()).toBeVisible()
  111 |       expect(await fieldOverlays.count(), `${formCode}: no field overlays rendered on top of the PDF`).toBeGreaterThan(0)
  112 | 
  113 |       // Page count: self-consistent invariant between the sidebar's own
  114 |       // count and the actually-rendered canvases - never zero.
  115 |       await page.getByRole('button', { name: 'Expand page navigation' }).click()
  116 |       const pageNavButtons = page.getByRole('button', { name: /^Pg \d+/ })
  117 |       const navPageCount = await pageNavButtons.count()
  118 |       expect(navPageCount, `${formCode}: page navigation sidebar reports zero pages`).toBeGreaterThan(0)
  119 |       await expect(pageCanvases).toHaveCount(navPageCount, { timeout: 30_000 })
  120 | 
  121 |       await page.screenshot({ path: `e2e/screenshots/${formCode}-page-1.png`, fullPage: false })
  122 | 
  123 |       // Multi-page navigation, only meaningful when there's more than one page.
  124 |       if (navPageCount > 1) {
  125 |         await pageNavButtons.nth(1).click()
  126 |         await expect(page.locator('#uscis-page-2')).toBeInViewport({ timeout: 10_000 })
  127 |         await page.screenshot({ path: `e2e/screenshots/${formCode}-page-2.png`, fullPage: false })
  128 |       }
  129 | 
  130 |       // The page-nav panel is an absolutely-positioned overlay (z-30) that
  131 |       // stays open and intercepts clicks on the toolbar underneath it.
  132 |       await page.getByRole('button', { name: 'Collapse page navigation' }).click()
  133 | 
  134 |       // Zoom controls must not crash or blank the viewer.
  135 |       await page.getByRole('button', { name: '100%', exact: true }).click()
  136 |       await expect(pageCanvases.first()).toBeVisible()
  137 |       const zoomReadout = page.locator('span.w-12.text-center')
  138 |       await page.getByRole('button', { name: 'Zoom in' }).click()
  139 |       await expect(zoomReadout).toHaveText(/^\d+%$/)
  140 |       await expect(pageCanvases.first()).toBeVisible()
  141 |       await page.getByRole('button', { name: 'Zoom out' }).click()
  142 |       await expect(pageCanvases.first()).toBeVisible()
  143 | 
  144 |       // No uncaught exceptions, no console errors, no failed USCIS-forms API calls.
  145 |       expect(pageErrors, `${formCode}: uncaught JS exception(s): ${pageErrors.join('; ')}`).toHaveLength(0)
  146 |       expect(failedApiCalls, `${formCode}: failed USCIS-forms API call(s): ${failedApiCalls.join('; ')}`).toHaveLength(0)
  147 |       const unexpectedConsoleErrors = consoleErrors.filter((text) => !text.includes('Download the React DevTools'))
  148 |       expect(unexpectedConsoleErrors, `${formCode}: console error(s): ${unexpectedConsoleErrors.join('; ')}`).toHaveLength(0)
  149 |     })
  150 |   }
  151 | })
  152 | 
```