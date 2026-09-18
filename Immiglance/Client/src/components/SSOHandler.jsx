import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { LANDING_URL } from "./CrossAppRedirect";
import PageLoader from "./PageLoader";

// Landing point for Landing(5173)'s CrossAppRedirect, which hands an
// already-authenticated session over via ?token= instead of a bare
// cross-origin navigation — mirrors Admin's/Attorney's own SSOHandler
// exactly. The token is never trusted client-side: it's handed to the
// backend via /auth/me (see AuthContext.loginWithToken), and only a 200
// establishes the session here.
export default function SSOHandler() {
  const [params] = useSearchParams();
  const { loginWithToken } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  // Caps this to exactly one attempt per mount regardless of how many times
  // the effect itself re-runs (useSearchParams() can hand back a
  // differently-identitied object on some renders) — mirrors Admin's
  // SSOHandler guard against re-firing loginWithToken() mid-flight.
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    const token = params.get("token");
    const redirect = params.get("redirect") || "/dashboard";
    if (!token) {
      window.location.replace(`${LANDING_URL}/login`);
      return;
    }
    loginWithToken(token)
      .then(() => navigate(redirect, { replace: true }))
      .catch((err) => setError(err.message || "This sign-in link is no longer valid."));
  }, [params, loginWithToken, navigate]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6 text-center gap-3">
        <h1 className="text-xl font-bold text-foreground">Couldn&apos;t sign you in</h1>
        <p className="text-muted-foreground max-w-md text-sm">{error}</p>
        <a href={`${LANDING_URL}/login`} className="text-primary font-semibold text-sm hover:underline">
          Go to sign in
        </a>
      </div>
    );
  }

  return <PageLoader />;
}
