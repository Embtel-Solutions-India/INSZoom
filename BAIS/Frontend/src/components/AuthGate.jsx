/**
 * AuthGate — Single routing authority for authenticated sessions.
 *
 * This component wraps all protected client routes. On mount, it calls
 * GET /api/auth/session-context and routes the user to the correct
 * destination based on their role and case status.
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
 */
import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { authApi } from "../services/api";
import { isEmployeeAccount } from "../utils/auth";

const INSZOOM_URL = import.meta.env.VITE_INSZOOM_URL || "http://localhost:3002";

const STAFF_ROLES = ["super_admin", "admin", "team_lead", "case_manager"];

export default function AuthGate() {
  const [status, setStatus] = useState("loading"); // 'loading' | 'ready' | 'unauthenticated' | 'error'
  const [context, setContext] = useState(null);
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;

    async function fetchContext() {
      try {
        // api.js is a plain fetch wrapper (see services/api.js's request()) —
        // authApi.sessionContext() resolves with the parsed JSON body
        // directly, not an axios-style { data } envelope.
        const res = await authApi.sessionContext();
        if (cancelled) return;
        if (res?.success) {
          setContext(res);
          setStatus("ready");
        } else {
          setStatus("unauthenticated");
        }
      } catch (err) {
        if (cancelled) return;
        // Errors thrown by api.js carry `.status` (see request()'s
        // `error.status = res.status`), not an axios `err.response.status`.
        if (err?.status === 401) {
          setStatus("unauthenticated");
        } else {
          setStatus("error");
        }
      }
    }

    fetchContext();
    return () => { cancelled = true; };
  }, []); // Only run once on mount

  // Cross-origin navigation is a side effect and must not run during render
  // (React may invoke the render body more than once, e.g. under Strict
  // Mode) — it belongs in its own effect, gated on the same condition the
  // render body below re-checks to decide what to show meanwhile.
  const isStaff = status === "ready" && Boolean(context) && STAFF_ROLES.includes(context.role);
  useEffect(() => {
    if (isStaff) window.location.href = INSZOOM_URL;
  }, [isStaff]);

  // ── Loading state (also covers the staff redirect firing above) ─────────
  if (status === "loading" || isStaff) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-5rem)]">
        <div className="w-10 h-10 rounded-full border-4 border-emerald-200 border-t-emerald-600 animate-spin" />
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────────────────────
  if (status === "error") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-5rem)] px-6 text-center">
        <h1 className="text-2xl font-extrabold text-slate-900 mb-3">We're having trouble connecting</h1>
        <p className="text-slate-500 text-base max-w-md">
          This isn't a sign you've been logged out — we just couldn't reach the server to confirm your session. Please refresh the page.
        </p>
      </div>
    );
  }

  // ── Unauthenticated ──────────────────────────────────────────────────────
  if (status === "unauthenticated" || !context) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Staff roles are handled by the useEffect above (isStaff / INSZOOM_URL) —
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
    if (!location.pathname.startsWith("/dashboard/documents")) {
      return <Navigate to="/dashboard/documents" replace />;
    }
    return <Outlet />;
  }

  // "/dashboard/intake" is a redirect stub (see App.jsx) that forwards to
  // this canonical path before AuthGate ever runs, so this is the one path
  // to check — no need to special-case the legacy URL here too.
  const isIntakePath = location.pathname === "/onboarding/intake";

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

  // ── Client: no case, not legacy → intake questionnaire ───────────────────
  if (!isIntakePath) {
    return <Navigate to="/onboarding/intake" replace />;
  }
  return <Outlet />;
}
