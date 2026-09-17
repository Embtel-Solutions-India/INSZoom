import { test, expect } from '@playwright/test'
import { loginAs } from '../fixtures.js'

// Proves the generic, schema-driven <CategoryPage> actually round-trips a
// real value through the live /api/settings-v2 REST API — change, save,
// hard reload, still there. Restores the original value afterward so this
// spec never leaves firm.name mutated for other tests/specs.

test.describe('Settings — Firm Profile', () => {
  test('changing and saving the firm name persists across a reload', async ({ page }) => {
    await loginAs(page, 'admin')
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'Firm Profile' })).toBeVisible()

    const nameInput = page.locator('#firm\\.name')
    await expect(nameInput).toBeVisible()
    const originalValue = await nameInput.inputValue()

    await nameInput.fill('Playwright Test Firm')
    await expect(page.getByText('You have unsaved changes.')).toBeVisible()

    const [saveResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/settings-v2') && r.request().method() === 'PATCH'),
      page.getByRole('button', { name: 'Save Changes' }).click(),
    ])
    expect(saveResponse.status(), `save PATCH returned ${saveResponse.status()}`).toBe(200)
    await expect(page.getByText('Settings saved.')).toBeVisible()

    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.locator('#firm\\.name')).toHaveValue('Playwright Test Firm')

    // Restore.
    await page.locator('#firm\\.name').fill(originalValue)
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/settings-v2') && r.request().method() === 'PATCH'),
      page.getByRole('button', { name: 'Save Changes' }).click(),
    ])
  })

  test('discard reverts a change without saving', async ({ page }) => {
    await loginAs(page, 'admin')
    await page.goto('/settings')

    const phoneInput = page.locator('#firm\\.phone')
    const original = await phoneInput.inputValue()
    await phoneInput.fill('555-000-9999')
    await expect(page.getByText('You have unsaved changes.')).toBeVisible()

    await page.getByRole('button', { name: 'Discard' }).click()
    await expect(page.getByText('You have unsaved changes.')).toHaveCount(0)
    await expect(page.locator('#firm\\.phone')).toHaveValue(original)
  })
})
