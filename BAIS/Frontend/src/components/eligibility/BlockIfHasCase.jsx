import { Navigate, Outlet } from "react-router-dom";
import useHasCase from "../../hooks/useHasCase";

// Route guard for /eligibility and /eligibility/quiz — stops a client who
// already has a case (or an invited employee) from reaching the public quiz
// by URL/stale link, not just hiding the CTA that links to it (see
// StartAssessmentButton.jsx). Anonymous visitors and logged-in users
// without a case pass through untouched.
export default function BlockIfHasCase() {
  const { hasCase, loading } = useHasCase();
  // Render nothing while the check is in flight rather than showing the
  // quiz for a moment and then redirecting away from it.
  if (loading) return null;
  if (hasCase) {
    return <Navigate to="/dashboard" replace state={{ notice: "You already have an active case." }} />;
  }
  return <Outlet />;
}
