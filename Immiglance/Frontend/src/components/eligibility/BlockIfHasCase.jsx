import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { authApi } from "../../services/api";
import { isEmployeeAccount } from "../../utils/auth";

// Route guard for /eligibility and /eligibility/quiz — stops a client who
// already has a case (or an invited employee) from reaching the public quiz
// by URL/stale link, not just hiding the CTA that links to it (see
// StartAssessmentButton.jsx). Anonymous visitors and logged-in users
// without a case pass through untouched.
//
// PHASE 3: uses GET /api/auth/session-context (the single routing-context
// source of truth — see AuthGate.jsx) instead of a separate GET /cases/my
// call. An invited employee always counts as "has a case" here, same as
// before — session-context's own hasCase is derived from User.caseIds,
// which the Phase 3 migration script only populates for role:'client'
// accounts (an employee is Case-linked via Case.employeeUser instead), so
// this checks isEmployeeAccount directly rather than trusting hasCase for
// that role, mirroring AuthGate's identical special-case.
export default function BlockIfHasCase() {
  const { user, authLoading } = useAuth();
  const employee = isEmployeeAccount(user);
  const shouldCheck = !authLoading && Boolean(user) && !employee;

  // null = not yet resolved (in flight or not started); every setState call
  // below happens inside a promise continuation, never synchronously in the
  // effect body itself.
  const [remoteHasCase, setRemoteHasCase] = useState(null);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    if (!shouldCheck) return;
    let cancelled = false;
    authApi.sessionContext()
      .then((res) => {
        if (cancelled) return;
        setRemoteHasCase(Boolean(res?.hasCase));
        setIsError(false);
      })
      .catch(() => {
        if (cancelled) return;
        // A transient failure fetching session-context is not evidence of
        // "no case" — same non-guessing, fail-open stance the old
        // useHasCase() hook took on a failed /cases/my call.
        setIsError(true);
      });
    return () => { cancelled = true; };
  }, [shouldCheck]);

  if (authLoading) return null;
  if (!user) return <Outlet />;
  if (employee) {
    return <Navigate to="/dashboard" replace state={{ notice: "You already have an active case." }} />;
  }
  // Render nothing while the check is in flight rather than showing the
  // quiz for a moment and then redirecting away from it.
  if (remoteHasCase === null && !isError) return null;
  if (isError) return <Outlet />;
  if (remoteHasCase) {
    return <Navigate to="/dashboard" replace state={{ notice: "You already have an active case." }} />;
  }
  return <Outlet />;
}
