import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import PageLoader from "./PageLoader";

// Repository-split shim — NOT an auth/session mechanism.
//
// Before the split, the public/pre-authentication routes (`/`, `/login`,
// `/signup`, `/accept-invite`, `/forgot-password`, `/reset-password`,
// `/auth/callback`, `/legacy-holding`, `/eligibility/*`, `/consultation/*`)
// were routes in this same app. They now live in the Landing app on a
// different origin. AuthGate still emits same-app <Navigate to="/login">,
// <Navigate to="/accept-invite"> and <Navigate to="/legacy-holding"> exactly
// as it did before the split — this catch-all route is what turns those (and
// any stale bookmark) into a forward to the Landing origin instead of a 404.
//
// Deliberately hands over NOTHING: no token, no cookie change, no session
// state. AuthGate's decision logic is unmodified. Wiring up a real
// cross-origin session handoff between Landing and Client is explicitly
// deferred to the centralized-auth phase.
const LANDING_URL = import.meta.env.VITE_LANDING_URL || "http://localhost:5173";

export default function CrossAppRedirect() {
  const { pathname, search, hash } = useLocation();

  useEffect(() => {
    window.location.replace(`${LANDING_URL}${pathname}${search}${hash}`);
  }, [pathname, search, hash]);

  return <PageLoader />;
}

export { LANDING_URL };
