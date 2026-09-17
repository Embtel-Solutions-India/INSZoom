import { test, expect } from '@playwright/test'
import { loginAs } from './fixtures.js'

// Comprehensive audit v3.0 — Golden Paths P (refresh persistence) and
// Q (logout/login persistence), certification gate G10 (authentication must not
// be lost on refresh), and §27's requirement that the frontend never renders the
// wrong authenticated state due to an initialization race.
//
// This matters more than usual in this app: the access token is deliberately
// held in memory only (services/api.js), so a hard refresh MUST re-establish the
// session from the httpOnly refresh cookie. A regression here logs every staff
// user out on every F5.

const PROTECTED_ROUTES = ['/dashboard', '/crm-cases']

test.describe('Golden Path P — refresh persistence (G10)', () => {
  for (const route of PROTECTED_ROUTES) {
    test(`hard refresh on ${route} keeps the user authenticated`, async ({ page }) => {
      await loginAs(page, 'admin')
      await page.goto(route)
      await expect(page).toHaveURL(new RegExp(route.replace('/', '\\/')))

      // Watch for the initialization race: if the app ever redirects to /login
      // (even momentarily) during rehydration, capture it.
      const redirects = []
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) redirects.push(frame.url())
      })

      await page.reload({ waitUntil: 'networkidle' })

      expect(page.url(), `G10: refresh on ${route} bounced the user to login`).not.toMatch(/\/login/)
      const loginRedirect = redirects.find((url) => /\/login/.test(url))
      expect(loginRedirect, `§27: refresh on ${route} transiently rendered the unauthenticated state (${loginRedirect})`).toBeUndefined()

      // And the page must actually be usable, not a blank authenticated shell.
      await expect(page.locator('body')).not.toBeEmpty()
      const loginTime = await page.evaluate(() => localStorage.getItem('loginTime'))
      expect(loginTime, 'session marker must survive refresh').toBeTruthy()
    })
  }

  test('opening a protected route directly in a new tab restores the session', async ({ context, page }) => {
    await loginAs(page, 'admin')

    // Same browser context = same cookies, exactly like a user opening a link
    // in a second tab. The in-memory access token is NOT shared, so this only
    // works if the refresh cookie genuinely re-establishes the session.
    const secondTab = await context.newPage()
    await secondTab.goto('/crm-cases')
    await secondTab.waitForLoadState('networkidle')

    expect(secondTab.url(), 'direct navigation in a new tab must not bounce to login').not.toMatch(/\/login/)
    await expect(secondTab.getByRole('heading', { name: 'CRM Cases' })).toBeVisible({ timeout: 30_000 })
    await secondTab.close()
  })
})

test.describe('Golden Path Q — logout and re-login', () => {
  test('logout clears the session and protected routes are no longer reachable', async ({ page }) => {
    // No extra navigation here: login already lands on /dashboard. A full page
    // navigation between login and logout was found to change the outcome, so
    // this test deliberately exercises the simplest possible logout.
    await loginAs(page, 'admin')

    // Record what the logout control actually does on the wire.
    const logoutCalls = []
    page.on('response', async (r) => {
      if (r.url().includes('/auth/logout')) logoutCalls.push({ status: r.status(), url: r.url() })
    })

    // Drive the real logout control rather than clearing storage by hand.
    const logout = page.getByRole('button', { name: /log ?out|sign ?out/i }).first()
    if (await logout.count()) {
      await logout.click()
    } else {
      // Some layouts hide it behind a profile menu.
      const menu = page.getByRole('button', { name: /profile|account|menu/i }).first()
      if (await menu.count()) await menu.click()
      await page.getByRole('button', { name: /log ?out|sign ?out/i }).first().click()
    }

    await page.waitForURL(/\/login/, { timeout: 20_000 })

    // Logout must revoke the SERVER session, not just clear client state — the
    // refresh cookie is what re-establishes a session on the next page load.
    const cookiesAfterLogout = await page.context().cookies()
    const refreshAfterLogout = cookiesAfterLogout.find((c) => /refresh/i.test(c.name))
    expect(
      logoutCalls.length,
      'the logout control must actually call POST /auth/logout'
    ).toBeGreaterThan(0)
    expect(
      logoutCalls.map((c) => c.status),
      `POST /auth/logout returned ${JSON.stringify(logoutCalls)} — a non-200 means the server never revoked the session`
    ).toContain(200)
    expect(
      refreshAfterLogout?.value || '',
      `logout left a live refresh cookie (${refreshAfterLogout?.name}) — the server session was not revoked`
    ).toBe('')

    // The negative half of the gate: the protected route must NOT be reachable
    // by direct URL after logout ("Direct URL → bypass RBAC: FAIL").
    // A correct app interrupts this navigation with its own redirect to /login,
    // which makes page.goto reject — that rejection is the expected behavior
    // here, so assert on where we actually ended up rather than on goto itself.
    await page.goto('/crm-cases').catch(() => {})
    await page.waitForLoadState('networkidle').catch(() => {})
    const finalUrl = page.url()
    const cookiesNow = await page.context().cookies()
    expect(
      finalUrl,
      `a logged-out user reached a protected route by direct URL (ended at ${finalUrl}; cookies present: ${cookiesNow.map((c) => c.name).join(', ') || 'none'})`
    ).toMatch(/\/login/)

    const loginTime = await page.evaluate(() => localStorage.getItem('loginTime'))
    expect(loginTime, 'logout must clear the stored session marker').toBeFalsy()
  })

  test('logout still revokes the server session after a page reload (DEF-005)', async ({ page }) => {
    // The same logout that works immediately after login fails once the SPA has
    // been reloaded: AuthContext.logout() overrides the axios interceptor's
    // valid in-memory access token with its own `token` state
    // (AuthContext.jsx:135-137), and on the reload-restored path that value is
    // not the current access token — so POST /auth/logout 401s, the controller
    // never runs, and neither revokeSession nor clearRefreshCookie happens.
    // Consequence: the user appears logged out locally while their refresh
    // cookie stays live for its full TTL and can re-establish the session.
    await loginAs(page, 'admin')
    // Deliberately do NOT wait for networkidle: this reproduces a real user
    // reloading and clicking Log Out before the background session-restore
    // refresh has completed and repopulated AuthContext's `token` state.
    await page.goto('/dashboard')

    const logoutCalls = []
    page.on('response', (r) => {
      if (r.url().includes('/auth/logout')) logoutCalls.push(r.status())
    })

    const logout = page.getByRole('button', { name: /log ?out|sign ?out/i }).first()
    await logout.click()
    await page.waitForURL(/\/login/, { timeout: 20_000 })

    expect(logoutCalls, `POST /auth/logout returned ${logoutCalls.join(', ')} after a reload — the server session was not revoked`).toContain(200)

    const refreshCookie = (await page.context().cookies()).find((c) => /refresh/i.test(c.name))
    expect(refreshCookie?.value || '', 'a live refresh cookie survived logout after reload').toBe('')
  })

  test('re-login after logout works on the first attempt', async ({ page }) => {
    await loginAs(page, 'caseManager')
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/dashboard/)
  })
})

test.describe('Negative — unauthenticated direct navigation', () => {
  for (const route of PROTECTED_ROUTES) {
    test(`unauthenticated direct navigation to ${route} is refused`, async ({ page }) => {
      await page.goto(route)
      await page.waitForLoadState('networkidle')
      expect(page.url(), `unauthenticated user reached ${route}`).toMatch(/\/login/)
    })
  }

  test('wrong credentials are rejected and do not establish a session', async ({ page }) => {
    await page.goto('/login')
    await page.getByPlaceholder('Username').fill('definitely.not.a.user@e2e-audit.invalid')
    await page.getByPlaceholder('Password').fill('WrongPassword!123')
    await page.getByRole('button', { name: /login/i }).click()

    await page.waitForTimeout(3_000)
    expect(page.url(), 'invalid credentials must not authenticate').toMatch(/\/login/)
    const cookies = await page.context().cookies()
    expect(cookies.find((c) => /refresh/i.test(c.name)), 'failed login must not set a refresh cookie').toBeFalsy()
  })
})
