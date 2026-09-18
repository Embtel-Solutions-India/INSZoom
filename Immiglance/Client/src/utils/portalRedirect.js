// Shared by AuthGate.jsx (protected routes) and MainLayout.jsx (the public
// marketing site) — both need to bounce an already-authenticated staff/
// attorney session off to that account's real portal, with the exact same
// URLs and the exact same token-handoff mechanism. Centralized here so the
// two call sites can't drift out of sync with each other.
const ADMIN_URL = import.meta.env.VITE_ADMIN_URL || "http://localhost:3002";
const ATTORNEY_PORTAL_URL = import.meta.env.VITE_ATTORNEY_PORTAL_URL || "http://localhost:5174";

// A deployed (non-localhost) build with these unset silently falls back to a
// bare "http://localhost:3002"/"5174" — an address that only resolves to
// anything on the machine that built the app, never on a real visitor's own
// computer. That previously failed completely silently: a staff or attorney
// login would try to navigate to a dead localhost URL and just get stuck,
// with nothing in the console pointing at why. Logging loudly here means a
// missing production env var shows up immediately in devtools instead of
// looking like a mysterious login bug.
if (import.meta.env.PROD) {
  if (!import.meta.env.VITE_ADMIN_URL) {
    console.error("[portalRedirect] VITE_ADMIN_URL is not set in this build — staff logins will try to redirect to", ADMIN_URL, "which will not work for real visitors. Set VITE_ADMIN_URL to the deployed Admin app's URL.");
  }
  if (!import.meta.env.VITE_ATTORNEY_PORTAL_URL) {
    console.error("[portalRedirect] VITE_ATTORNEY_PORTAL_URL is not set in this build — attorney logins will try to redirect to", ATTORNEY_PORTAL_URL, "which will not work for real visitors. Set VITE_ATTORNEY_PORTAL_URL to the deployed Attorney app's URL.");
  }
}

export const STAFF_ROLES = ["super_admin", "admin", "team_lead", "case_manager"];

// Hands the access token over in the URL rather than relying on the
// refresh-token cookie being readable from the other app's origin too —
// that assumption doesn't always hold in production (different
// subdomain/cookie policy, browsers blocking a plain cross-site navigation's
// cookie, etc.), and was confirmed as the cause of an already-authenticated
// account landing back on the other app's own /login after being sent
// there with no credential.
export function redirectToOwnPortal(role, accessToken) {
  const targetOrigin = STAFF_ROLES.includes(role) ? ADMIN_URL : ATTORNEY_PORTAL_URL;
  window.location.href = accessToken
    ? `${targetOrigin}/auth/sso?token=${encodeURIComponent(accessToken)}`
    : `${targetOrigin}/login`;
}

export { ADMIN_URL, ATTORNEY_PORTAL_URL };
