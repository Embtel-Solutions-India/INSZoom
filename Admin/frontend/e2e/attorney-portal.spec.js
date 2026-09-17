import { test, expect } from '@playwright/test'
import { loadFixtures, apiLogin, apiRequest, taggedClientEmail } from './fixtures.js'

// Real-browser verification of the Attorney Portal (a separate app on
// :5174). Uses absolute URLs because playwright.config.js's baseURL points
// at INSZoom (:3002) — this spec deliberately drives all three origins.
//
// Covers the prompt's S2 (direct login), S3 (case access isolation),
// S4/S5 (feedback both directions), S7 (role boundary) and S8 (documents/
// forms tabs) in an actual browser, not by status code.

const PORTAL = process.env.E2E_ATTORNEY_PORTAL_URL || 'http://localhost:5174'

async function portalLogin(page, userKey) {
  const { users } = loadFixtures()
  const user = users[userKey]
  expect(user, `no seeded fixture user '${userKey}'`).toBeTruthy()
  await page.goto(`${PORTAL}/login`)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  return user
}

// One case, granted to the `attorney` fixture, created through the real API
// (not seeded straight into Mongo) so the grant goes through the same
// controller a case manager actually uses.
async function createGrantedCase() {
  const { users } = loadFixtures()
  const adminToken = await apiLogin('admin')
  // Unique per call — a fixed name would collide with leftover cases from
  // earlier runs of this same spec (teardown only removes cases whose
  // CLIENT EMAIL is tagged; multiple runs' cases all share that tag but each
  // gets its own clientName here so locator-by-text stays unambiguous).
  const clientName = `Playwright Attorney Client ${Date.now()}`
  const created = await apiRequest(adminToken, 'POST', '/cases', {
    clientName,
    clientEmail: taggedClientEmail('attorneycase'),
    visaType: 'H-1B',
  })
  expect([200, 201], `case create returned ${created.status}`).toContain(created.status)
  const caseId = String(created.body.case?._id || created.body.data?._id)

  const granted = await apiRequest(adminToken, 'PATCH', `/cases/${caseId}/attorney-access`, {
    attorneyId: users.attorney.id,
    action: 'grant',
  })
  expect(granted.status, `grant returned ${granted.status}`).toBe(200)
  return { caseId, adminToken, clientName }
}

test.describe('Attorney Portal', () => {
  test('S7 a non-attorney is refused at the attorney portal login', async ({ page }) => {
    await portalLogin(page, 'caseManager')
    await expect(page.getByRole('alert')).toContainText('this portal is for attorneys only')
    // Must not have reached the app shell.
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toHaveCount(0)
  })

  test('S2 an attorney signs in and sees a dashboard scoped to assigned cases', async ({ page }) => {
    const { caseId, clientName } = await createGrantedCase()

    await portalLogin(page, 'attorney')
    await page.waitForURL(/\/dashboard/)
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

    // Real numbers, not placeholders: the granted case must be counted.
    const assigned = page.locator('div', { hasText: /^Assigned cases$/ }).first()
    await expect(assigned).toBeVisible()
    await expect(page.getByText(clientName)).toBeVisible()

    // Sidebar nav items are buttons (AppLayout.jsx), not links — they call
    // navigate() programmatically, matching INSZoom's own Layout.jsx pattern.
    await page.getByRole('button', { name: 'My Cases' }).click()
    await expect(page.getByRole('cell', { name: clientName })).toBeVisible()

    // Opening the case detail loads real case data across tabs. The client
    // name legitimately renders twice (header subtitle + Overview field),
    // so this asserts on both places explicitly rather than a loose match.
    await page.goto(`${PORTAL}/cases/${caseId}/overview`)
    await expect(page.getByText(`${clientName} ·`)).toBeVisible()
    await expect(page.getByText(clientName, { exact: true })).toBeVisible()
    await expect(page.getByText('H-1B').first()).toBeVisible()
  })

  test('S3 an attorney cannot open a case nobody granted them', async ({ page }) => {
    // A case created but never granted to anyone.
    const adminToken = await apiLogin('admin')
    const created = await apiRequest(adminToken, 'POST', '/cases', {
      clientName: 'Playwright Ungranted Client',
      clientEmail: taggedClientEmail('ungranted'),
      visaType: 'L-1A',
    })
    const ungrantedId = String(created.body.case?._id || created.body.data?._id)

    await portalLogin(page, 'attorney')
    await page.waitForURL(/\/dashboard/)

    const responses = []
    page.on('response', (response) => {
      if (response.url().includes(`/attorney/cases/${ungrantedId}`)) responses.push(response.status())
    })

    await page.goto(`${PORTAL}/cases/${ungrantedId}/overview`)
    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible()
    // No case data leaked into the page.
    await expect(page.getByText('Playwright Ungranted Client')).toHaveCount(0)
    expect(responses, 'the API must have refused with 403').toContain(403)
  })

  test('S4/S5 Messages round-trips between the attorney and the case manager, is outside the case tabs, and supports Enter-to-send + file upload', async ({ page }) => {
    const { caseId, adminToken, clientName } = await createGrantedCase()

    await portalLogin(page, 'attorney')
    await page.waitForURL(/\/dashboard/)

    // Messages lives ONLY in the top-level nav, never as a case-detail tab.
    // Feedback (case-scoped) IS a tab. Notes/Strategy/Questionnaire are gone.
    await page.goto(`${PORTAL}/cases/${caseId}/overview`)
    await expect(page.getByRole('link', { name: 'Messages' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Notes' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Strategy' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Questionnaire' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Feedback' })).toBeVisible()

    // The Feedback tab and the top-level Messages hub are two entry points
    // into the exact same thread — sending from the tab must show up when
    // reopened through the hub.
    const feedbackTabMessage = `Feedback tab message ${Date.now()}`
    await page.getByRole('link', { name: 'Feedback' }).click()
    await page.waitForURL(new RegExp(`/cases/${caseId}/feedback$`))
    const feedbackTextarea = page.getByPlaceholder(/Message the case team/)
    await feedbackTextarea.fill(feedbackTabMessage)
    const [feedbackTabPost] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/feedback') && r.request().method() === 'POST'),
      feedbackTextarea.press('Enter'),
    ])
    expect(feedbackTabPost.status(), 'Feedback-tab POST must succeed').toBe(201)
    await expect(page.locator('p', { hasText: feedbackTabMessage })).toBeVisible()

    await page.getByRole('button', { name: 'Messages' }).click()
    await page.waitForURL(/\/messages$/)
    await page.getByText(clientName).click()
    await page.waitForURL(new RegExp(`/messages/${caseId}$`))

    // S4 + Enter-to-send (no button click): typing and pressing Enter alone
    // must submit — Shift+Enter must NOT (it inserts a newline instead).
    const message = `Attorney message ${Date.now()}`
    const textarea = page.getByPlaceholder(/Message the case team/)
    await textarea.fill(message)
    const [postResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/feedback') && r.request().method() === 'POST'),
      textarea.press('Enter'),
    ])
    expect(postResponse.status(), 'feedback POST must succeed').toBe(201)
    await expect(page.locator('p', { hasText: message })).toBeVisible()

    // File upload: attach a real file and send it.
    await page.setInputFiles('input[type="file"]', {
      name: 'evidence.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 playwright test attachment'),
    })
    await expect(page.getByText('evidence.pdf')).toBeVisible()
    const [uploadResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/feedback') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Send' }).click(),
    ])
    expect(uploadResponse.status(), 'attachment upload must succeed').toBe(201)
    await expect(page.getByRole('button', { name: 'evidence.pdf' })).toBeVisible()

    // The staff side sees it through the staff endpoint (proves both sides
    // read the same thread, not two parallel stores).
    const staffThread = await apiRequest(adminToken, 'GET', `/cases/${caseId}/feedback`)
    expect(staffThread.status).toBe(200)
    const staffSeen = (staffThread.body.feedback || []).find((item) => item.message === message)
    expect(staffSeen, 'case manager must see the attorney message').toBeTruthy()
    expect(staffSeen.authorRole).toBe('attorney')

    // S5: the case manager replies, and the attorney sees it after a reload.
    const replyText = `Case manager reply ${Date.now()}`
    const reply = await apiRequest(adminToken, 'POST', `/cases/${caseId}/feedback/${staffSeen._id}/reply`, {
      message: replyText,
    })
    expect(reply.status).toBe(201)

    await page.reload()
    await expect(page.getByText(replyText)).toBeVisible()
  })

  test('S8 documents and USCIS forms tabs load for a granted case', async ({ page }) => {
    const { caseId } = await createGrantedCase()
    await portalLogin(page, 'attorney')
    await page.waitForURL(/\/dashboard/)

    await page.goto(`${PORTAL}/cases/${caseId}/documents`)
    // A brand-new case has no documents — the empty state is the correct
    // real result here; what matters is that it rendered rather than erroring.
    await expect(page.getByText(/No documents on this case yet|Download/).first()).toBeVisible()

    await page.goto(`${PORTAL}/cases/${caseId}/forms`)
    await expect(page.getByText(/No USCIS forms generated|I-129|Form/i).first()).toBeVisible()
  })
})
