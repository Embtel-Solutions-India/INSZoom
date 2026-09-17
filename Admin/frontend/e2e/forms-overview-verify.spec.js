import { test, expect } from '@playwright/test'
import { loginAs } from './fixtures.js'

// One-off manual verification spec for the registry-driven forms-overview
// feature (Phase 1/2) - a REAL Chromium tab against the real backend/DB,
// per the implementation plan's mandatory "observe real behavior in a real
// browser" acceptance bar. Pinned to a real, pre-existing O-1A case (this
// DB has exactly one) rather than creating a new one.
const O1A_CASE_ID = '6a8f1cfc8dd95fb60a0b4607'

test('Forms tab shows the full registry-resolved overview for a real O-1A case', async ({ page }) => {
  await loginAs(page, 'admin')
  await page.goto(`/crm-cases/${O1A_CASE_ID}?tab=forms`)

  const otherFormsHeading = page.getByRole('heading', { name: 'Other Forms for This Visa' })
  await expect(otherFormsHeading).toBeVisible({ timeout: 60_000 })

  const disclaimer = page.getByText(/Autofill covers biographic identity, contact, and address fields only/i)
  await expect(disclaimer).toBeVisible()

  // Real registry rows, not placeholders.
  await expect(page.getByText('I-129', { exact: true }).first()).toBeVisible()

  await page.screenshot({ path: 'e2e/screenshots/forms-overview-o1a.png', fullPage: true })
})

test('Fetch from USCIS click completes live against a real registry row', async ({ page }) => {
  await loginAs(page, 'admin')
  await page.goto(`/crm-cases/${O1A_CASE_ID}?tab=forms`)

  const row = page.locator('tr').filter({ has: page.getByText('I-129 O/P Classification Supplement', { exact: true }) })
  await expect(row).toBeVisible({ timeout: 60_000 })

  await row.getByRole('button', { name: 'Fetch from USCIS' }).click()

  // This specific row is a FORM_COMPONENT/SUPPLEMENT - no standalone
  // uscis.gov page of its own - so the real, live, expected outcome is the
  // typed USCIS_FORM_NOT_STANDALONE error surfacing cleanly in the UI, not
  // a crash/hang/silent failure.
  const banner = page.getByText(/not a standalone USCIS form/i)
  await expect(banner).toBeVisible({ timeout: 30_000 })

  await page.screenshot({ path: 'e2e/screenshots/forms-overview-acquire-error.png', fullPage: true })
})
