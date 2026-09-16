import { test, expect } from '@playwright/test'
import { loginAs } from '../fixtures.js'

// New left-rail Settings UI (replaces the old 4-tab page). Proves the
// left-rail renders, every admin-visible category is reachable, and
// role-gating (a case_manager cannot see Security/AI) is enforced in the
// actual rendered UI, not just assumed from the backend permission check.

test.describe('Settings — navigation', () => {
  test('admin sees the 8 admin-level categories (Security stays super_admin-only, matching this app\'s pre-existing convention) and can navigate between them', async ({ page }) => {
    await loginAs(page, 'admin')
    await page.goto('/settings')

    const categories = ['Firm Profile', 'Users & Permissions', 'Client Portal', 'Notifications', 'Questionnaires & Intake', 'Email & Templates', 'Invoice & Billing', 'AI Platform']
    for (const label of categories) {
      await expect(page.getByRole('button', { name: label })).toBeVisible()
    }
    await expect(page.getByRole('button', { name: 'Security' })).toHaveCount(0)

    // Default landing tab.
    await expect(page.getByRole('heading', { name: 'Firm Profile' })).toBeVisible()

    // Navigate to another one and confirm the heading actually changes.
    await page.getByRole('button', { name: 'AI Platform' }).click()
    await expect(page.getByRole('heading', { name: 'AI Platform' })).toBeVisible()
    await expect(page.getByText('AI Providers')).toBeVisible()
  })

  test('super_admin additionally sees Security', async ({ page }) => {
    await loginAs(page, 'superAdmin')
    await page.goto('/settings')
    await page.getByRole('button', { name: 'Security' }).click()
    await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible()
  })

  test('case_manager cannot see Security or AI Platform in the settings nav', async ({ page }) => {
    await loginAs(page, 'caseManager')
    await page.goto('/settings')

    await expect(page.getByRole('button', { name: 'Security' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'AI Platform' })).toHaveCount(0)
  })
})
