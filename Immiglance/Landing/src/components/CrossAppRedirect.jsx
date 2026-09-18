import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import PageLoader from "./PageLoader";
import { tokenStore } from "../services/api";
import { useAuth } from "../context/AuthContext";

// Repository-split shim.
//
// Before the split, `/dashboard/*` and `/onboarding/*` were routes in this
// same app. They now live in the Client app on a different origin, so a
// bookmark, an emailed link, or an in-app <Navigate> that still points at one
// of those paths would 404 here. This component forwards the browser to the
// same path on the Client origin, preserving query string and hash.
//
// Hands the access token over via Client's /auth/sso?token=... (see
// Client/src/components/SSOHandler.jsx) rather than a bare cross-origin
// navigation with no credential — the in-memory token and the
// "do we have a session" localStorage marker are both origin-scoped, so
// Client's own AuthContext had no way to know a session existed and gave up
// immediately on a fresh load, bouncing straight back to Landing's /login.
// That was the confirmed cause of the /login <-> /dashboard flicker loop
// right after a successful login. Falls back to a bare forward (no token)
// when there genuinely isn't one yet — Client's own AuthGate handles that
// as ordinary unauthenticated, no worse than before.
const CLIENT_URL = import.meta.env.VITE_CLIENT_URL || "http://localhost:5175";

export default function CrossAppRedirect() {
  const { pathname, search, hash } = useLocation();
  const { authLoading } = useAuth();

  useEffect(() => {
    // Wait for Landing's own mount-time session check to resolve first —
    // otherwise a direct bookmark hit to /dashboard can read the in-memory
    // token before the cookie-based refresh that would have populated it
    // has had a chance to run, forwarding as if logged out.
    if (authLoading) return;
    const destination = `${pathname}${search}${hash}`;
    const token = tokenStore.getAccess();
    const target = token
      ? `${CLIENT_URL}/auth/sso?token=${encodeURIComponent(token)}&redirect=${encodeURIComponent(destination)}`
      : `${CLIENT_URL}${destination}`;
    window.location.replace(target);
  }, [authLoading, pathname, search, hash]);

  return <PageLoader />;
}

export { CLIENT_URL };
