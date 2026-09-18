/**
 * AuthGate — Single routing authority for authenticated sessions.
 *
 * This component wraps all protected client routes. It reads sessionContext
 * (from GET /api/auth/session-context) off AuthContext — fetched once there
 * alongside /auth/me, not by this component — and routes the user to the
 * correct destination based on their role and case status.
 *
 * IMPORTANT: This is the ONLY component that should make this routing
 * decision. No other component should independently check hasCase or
 * call session-context to determine where to route.
 *
 * Phase 3 addition. Replaces the routing logic previously scattered across:
 * - postLoginDest.js
 * - OAuthCallback.jsx
 * - Dashboard.jsx (mount-time redirect)
 * - Intake.jsx (mount-time redirect)
 * - BlockIfHasCase.jsx
 *
 * Perf fix: previously ran its own GET /api/auth/session-context on every
 * mount, independently of Navbar's identical fetch and AuthContext's own
 * /auth/me call. Now purely a function of AuthContext's shared authStatus/
 * sessionContext — no fetch, no local loading state of its own.
 */
import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { isEmployeeAccount } from "../utils/auth";
import { tokenStore } from "../services/api";
import { STAFF_ROLES, redirectToOwnPortal } from "../utils/portalRedirect";

const CLIENT_PORTAL_ROLES = ["client", "user", "employer", "employee", "beneficiary"];
const RESTRICTED_PORTAL_PATHS = ["/dashboard", "/dashboard/documents", "/dashboard/profile"];

function isAllowedRestrictedPortalPath(pathname) {
  return RESTRICTED_PORTAL_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export default function AuthGate() {
  const { authStatus, authLoading, sessionContext: context } = useAuth();
  const location = useLocation();

  // Cross-origin navigation is a side effect and must not run during render
  // (React may invoke the render body more than once, e.g. under Strict
  // Mode) — it belongs in its own effect, gated on the same condition the
  // render body below re-checks to decide what to show meanwhile.
  //
  // The token is handed over in the URL (exactly like the isAttorney branch
  // below) rather than relying on the refresh-token cookie being readable
  // from the Admin origin too — that assumption doesn't always hold in
  // production (different subdomain/cookie policy, browsers blocking
  // "third-party" cookies on a plain cross-site navigation, etc.), and was
  // confirmed as the cause of an already-authenticated staff member landing
  // back on Admin's own /login after being sent here with no credential.
  const isStaff = authStatus === "authenticated" && Boolean(context) && STAFF_ROLES.includes(context.role);
  useEffect(() => {
    if (isStaff) redirectToOwnPortal(context.role, tokenStore.getAccess());
  }, [isStaff, context?.role]);

  // Attorneys belong to neither portal this app routes between — they get
  // the third app. The access token is handed over in the URL so the
  // attorney portal (a separate origin, so it cannot read this one's
  // in-memory token) can establish the session without a second login; it
  // verifies the token against GET /api/auth/me before trusting it, never
  // client-side. Mirrors the isStaff redirect directly above.
  const isAttorney = authStatus === "authenticated" && Boolean(context) && context.role === "attorney";
  useEffect(() => {
    if (isAttorney) redirectToOwnPortal("attorney", tokenStore.getAccess());
  }, [isAttorney]);

  // ── Loading state (also covers the staff/attorney redirects firing above) ─
  if (authLoading || isStaff || isAttorney) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-5rem)]">
        <div className="w-10 h-10 rounded-full border-4 border-emerald-200 border-t-emerald-600 animate-spin" />
      </div>
    );
  }

  // ── Error state (a session-context-specific failure now surfaces the same
  //    way an /auth/me failure does — folded together in AuthContext) ──────
  if (authStatus === "error") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-5rem)] px-6 text-center">
        <h1 className="text-2xl font-bold text-slate-900 mb-3">We're having trouble connecting</h1>
        <p className="text-slate-500 text-base max-w-md">
          This isn't a sign you've been logged out — we just couldn't reach the server to confirm your session. Please refresh the page.
        </p>
      </div>
    );
  }

  // ── Unauthenticated ──────────────────────────────────────────────────────
  if (authStatus === "unauthenticated" || !context) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!CLIENT_PORTAL_ROLES.includes(context.role)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-5rem)] px-6 text-center">
        <h1 className="text-2xl font-bold text-slate-900 mb-3">Access unavailable</h1>
        <p className="text-slate-500 text-base max-w-md">
          This account role is not enabled for the client portal.
        </p>
      </div>
    );
  }

  // Staff roles are handled by the useEffect above (isStaff / ADMIN_URL) —
  // by this point in the render, `isStaff` is guaranteed false, since the
  // loading branch already returned for that case.

  // ── Phase 8: mustSetPassword blocks every protected route ────────────────
  // A stub account created at case-creation time (Phase 5) or an invited
  // employee (employeeInvite.service.js) starts with mustSetPassword: true
  // and no usable password until they complete /accept-invite. This check
  // runs before every other branch below — including the employee
  // special-case immediately after it — so no protected route is reachable
  // until setup completes. /accept-invite itself is a public route outside
  // AuthGate (see App.jsx), so redirecting here never loops; without a
  // token in the URL it shows its own "invalid or expired link" state
  // rather than a blank page.
  if (context.mustSetPassword) {
    if (!location.pathname.startsWith("/accept-invite")) {
      return <Navigate to="/accept-invite" replace />;
    }
    return <Outlet />;
  }

  // ── Invited employee → always confined to /dashboard/documents ──────────
  // Not part of the given session-context shape (getSessionContext derives
  // hasCase from User.caseIds, which the Phase 3 migration script only
  // populates for role:'client' accounts — an employee is Case-linked via
  // Case.employeeUser instead, so their caseIds stays empty and hasCase
  // would incorrectly read false). isEmployeeAccount(context) mirrors the
  // same special-casing useHasCase.js already applies elsewhere in this
  // app, so an employee is never routed into onboarding/legacy-holding.
  if (isEmployeeAccount(context)) {
    if (!isAllowedRestrictedPortalPath(location.pathname)) {
      return <Navigate to="/dashboard" replace />;
    }
    return <Outlet />;
  }

  // "/dashboard/intake" is a redirect stub (see App.jsx) that forwards to
  // this canonical path before AuthGate ever runs, so this is the one path
  // to check — no need to special-case the legacy URL here too.
  const isIntakePath = location.pathname === "/onboarding/intake";
  // Intake.jsx's short-form submit lands the still-case-less client here
  // (see submitEvaluation's navigate call) before a Case exists — must be
  // allowed through the same way isIntakePath is, or this branch's
  // catch-all below would bounce them straight back to intake before they
  // can book.
  const isPreCaseBookingPath = location.pathname === "/consultation/book";

  // ── Client: has a case → dashboard (bounce out of intake specifically,
  // render normally on any other already-AuthGate-wrapped path) ───────────
  if (context.hasCase) {
    if (isIntakePath) {
      return <Navigate to="/dashboard" replace />;
    }
    return <Outlet />;
  }

  // ── Client: legacy account (no case, was a pre-existing user) ────────────
  if (context.isLegacyNoCaseAccount) {
    return <Navigate to="/legacy-holding" replace />;
  }

  // ── Client: no case, not legacy → intake questionnaire (or, once intake
  // is submitted, consultation booking) ─────────────────────────────────
  if (!isIntakePath && !isPreCaseBookingPath) {
    return <Navigate to="/onboarding/intake" replace />;
  }
  return <Outlet />;
}
