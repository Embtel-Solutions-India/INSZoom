import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))
const BACKEND_DIR = path.resolve(here, '../../../Backend')
const FIXTURES_FILE = path.join(here, '.fixtures.json')

// The staff accounts these specs log in as are created and destroyed by this
// run — never a real person's account, and never a hardcoded ID that goes
// stale the next time the dev database is reset (the failure mode recorded in
// uscis-form-render.spec.js's own comments).
export function seedFixtures() {
  const out = execFileSync('node', ['src/scripts/e2eFixtures.js', 'seed'], { cwd: BACKEND_DIR, encoding: 'utf8' })
  const fixtures = JSON.parse(out.trim().split('\n').pop())
  fs.writeFileSync(FIXTURES_FILE, JSON.stringify(fixtures, null, 2))
  return fixtures
}

export function teardownFixtures() {
  const out = execFileSync('node', ['src/scripts/e2eFixtures.js', 'teardown'], { cwd: BACKEND_DIR, encoding: 'utf8' })
  if (fs.existsSync(FIXTURES_FILE)) fs.unlinkSync(FIXTURES_FILE)
  return JSON.parse(out.trim().split('\n').pop())
}

export function loadFixtures() {
  if (!fs.existsSync(FIXTURES_FILE)) throw new Error('e2e fixtures missing — global setup did not run')
  return JSON.parse(fs.readFileSync(FIXTURES_FILE, 'utf8'))
}

// A client email in the fixture domain, so global teardown can find and delete
// every case a spec creates even if the spec itself fails partway through.
export function taggedClientEmail(prefix) {
  const { tag } = loadFixtures()
  return `${prefix}.${Date.now()}${Math.floor(Math.random() * 1000)}@${tag}`
}

export async function loginAs(page, userKey) {
  const { users } = loadFixtures()
  const user = users[userKey]
  expect(user, `no seeded fixture user '${userKey}'`).toBeTruthy()
  await page.goto('/login')
  await page.getByPlaceholder('Username').fill(user.email)
  await page.getByPlaceholder('Password').fill(user.password)

  // The app-wide limiter (app.js: 300 requests / 15 min / IP) covers ALL API
  // traffic, and a browser run burns through it quickly — the UI then renders
  // the same generic "Login failed" it shows for bad credentials. Capture the
  // real status so an exhausted rate-limit budget is never misdiagnosed as an
  // authentication defect.
  const [loginResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/auth/login'), { timeout: 30_000 }),
    page.getByRole('button', { name: /login/i }).click(),
  ])
  expect(
    loginResponse.status(),
    loginResponse.status() === 429
      ? 'rate limit exhausted (429) — not an auth failure; wait for the 15-minute window to reset before re-running'
      : `login returned ${loginResponse.status()}`
  ).toBe(200)

  await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
  // The access token is deliberately held in memory only (services/api.js) with
  // the refresh token in an httpOnly cookie — so a stored bearer token is NOT
  // the success signal. Session establishment is proven by the persisted
  // loginTime marker plus the refresh cookie the browser now holds.
  const loginTime = await page.evaluate(() => localStorage.getItem('loginTime'))
  expect(loginTime, 'login must establish a session (loginTime marker)').toBeTruthy()
  const cookies = await page.context().cookies()
  const refreshCookie = cookies.find((c) => /refresh/i.test(c.name))
  expect(refreshCookie, 'login must set a refresh cookie').toBeTruthy()
  expect(refreshCookie.httpOnly, 'refresh cookie must be httpOnly').toBe(true)
  return { user, loginTime }
}

// Direct database assertions, run in the Backend's own process so the specs can
// prove PERSISTED state rather than trusting what the UI happens to render.
const API_BASE = process.env.E2E_API_URL || 'http://localhost:7000/api'

// Direct API access for arranging test preconditions cheaply. Driving every
// setup step through the UI would burn the app-wide rate-limit budget (300
// requests / 15 min) that the actual browser assertions need.
export async function apiLogin(userKey) {
  const { users } = loadFixtures()
  const user = users[userKey]
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password }),
  })
  const body = await response.json()
  expect(response.status, `API login for ${userKey} failed: ${response.status}`).toBe(200)
  return body.token
}

export async function apiRequest(token, method, path, payload) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { status: response.status, body }
}

// Form provisioning is deliberately asynchronous (case.controller.js hands
// initializeCase() to setImmediate so the create response isn't blocked by
// template resolution + questionnaire generation). "Immediately" in the
// certification gate means "with no questionnaire gate", not "synchronously" —
// so poll, and report how long it actually took as evidence.
export async function pollDatabase(expression, isReady, { timeoutMs = 120_000, intervalMs = 3_000 } = {}) {
  const startedAt = Date.now()
  let last
  while (Date.now() - startedAt < timeoutMs) {
    last = queryDatabase(expression)
    if (isReady(last)) return { ...last, __waitedMs: Date.now() - startedAt }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return { ...last, __waitedMs: Date.now() - startedAt, __timedOut: true }
}

export function queryDatabase(expression) {
  const script = `
    require("dotenv").config();
    const mongoose = require("mongoose");
    mongoose.connect(process.env.MONGODB_URI).then(async () => {
      const Case = require("./src/models/Case");
      const CaseForm = require("./src/models/CaseForm");
      const EmployerProfile = require("./src/models/EmployerProfile");
      const EmployeeProfile = require("./src/models/EmployeeProfile");
      const User = require("./src/models/User");
      const AuditLog = require("./src/models/AuditLog");
      const models = { Case, CaseForm, EmployerProfile, EmployeeProfile, User, AuditLog };
      try {
        const result = await (${expression})(models);
        console.log("__RESULT__" + JSON.stringify(result));
      } finally {
        await mongoose.disconnect();
      }
    }).catch((e) => { console.error(e.message); process.exit(1); });
  `
  const out = execFileSync('node', ['-e', script], { cwd: BACKEND_DIR, encoding: 'utf8' })
  const line = out.split('\n').find((l) => l.startsWith('__RESULT__'))
  if (!line) throw new Error(`database query produced no result: ${out}`)
  return JSON.parse(line.replace('__RESULT__', ''))
}
