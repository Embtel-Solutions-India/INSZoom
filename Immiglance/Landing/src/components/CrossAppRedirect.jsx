import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import PageLoader from "./PageLoader";

// Repository-split shim — NOT an auth/session mechanism.
//
// Before the split, `/dashboard/*` and `/onboarding/*` were routes in this
// same app. They now live in the Client app on a different origin, so a
// bookmark, an emailed link, or an in-app <Navigate> that still points at one
// of those paths would 404 here. This component forwards the browser to the
// same path on the Client origin, preserving query string and hash.
//
// Deliberately hands over NOTHING: no token, no cookie change, no session
// state. The session continues to come from the existing httpOnly refresh
// cookie + the `/auth/me` bootstrap in AuthContext, exactly as before. Wiring
// up a real cross-origin session handoff between Landing and Client is
// explicitly deferred to the centralized-auth phase.
const CLIENT_URL = import.meta.env.VITE_CLIENT_URL || "http://localhost:5175";

export default function CrossAppRedirect() {
  const { pathname, search, hash } = useLocation();

  useEffect(() => {
    window.location.replace(`${CLIENT_URL}${pathname}${search}${hash}`);
  }, [pathname, search, hash]);

  return <PageLoader />;
}

export { CLIENT_URL };
