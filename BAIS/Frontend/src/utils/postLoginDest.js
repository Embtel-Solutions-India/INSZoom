/**
 * Returns the correct post-login destination for a given user.
 *
 * super_admin, admin, team_lead, case_manager are INSZoom staff roles - if
 * one of them ends up authenticated on BAIS (e.g. via the Google button,
 * which has no role gate), send them to the INSZoom portal instead of the
 * BAIS client dashboard. All other roles stay on /dashboard.
 *
 * BAIS and INSZoom are separate origins with separate localStorage-based
 * sessions, so this is an app handoff, not SSO - INSZoom still runs its own
 * login/auth check once the browser lands there.
 */

import { casesApi } from '../services/api'

const INSZOOM_URL = import.meta.env.VITE_INSZOOM_URL || 'http://localhost:3002'

const STAFF_ROLES = ['super_admin', 'admin', 'team_lead', 'case_manager']

export function getPostLoginDest(user) {
  if (!user) return { external: false, url: '/login' }
  if (STAFF_ROLES.includes(user.role)) {
    return { external: true, url: INSZOOM_URL }
  }
  return { external: false, url: '/dashboard' }
}

// GET /cases/my returns the case object directly as the response body (not
// wrapped in {success, data}) - res.json(null) when none exists, or the
// serialized case otherwise - see Backend/src/modules/cases/case.controller.js's
// getMyCase. BAIS's services/api.js is a plain fetch wrapper (api.get()
// resolves with res.json() itself, see the `request()` function) - NOT
// axios - so casesApi.my() already resolves with the case object (or null)
// directly. There is no .data to unwrap here.
async function hasExistingCase() {
  try {
    const caseData = await casesApi.my()
    return Boolean(caseData?._id)
  } catch {
    return null // unknown - caller decides the safe fallback
  }
}

// Full destination resolution for a client (non-staff) user: checks whether
// they already have a case so a brand-new signup/login lands directly on
// the intake wizard instead of flashing /dashboard first - Dashboard.jsx's
// own loadCase() effect would otherwise redirect a beat later; this is that
// same check, done once up front so the redirect is immediate. Staff go
// through the same external-portal branch as getPostLoginDest either way.
export async function resolvePostLoginDest(user) {
  const dest = getPostLoginDest(user)
  if (dest.external || !user) return dest
  const has = await hasExistingCase()
  // Unknown (the /cases/my call itself failed) -> default to /dashboard,
  // same fallback Dashboard.jsx's own check already uses, and safer than
  // guessing "no case" and bouncing a returning user into intake.
  return { external: false, url: has === false ? '/dashboard/intake' : '/dashboard' }
}
