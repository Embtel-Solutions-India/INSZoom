import { Outlet, Link, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { isEmployeeAccount } from "../utils/auth";

// Blocks the invited-employee role from routes it should never reach directly
// by URL — an employee's whole world is their own case's Documents/checklist
// page, so the redirect target is /dashboard/documents (NOT /dashboard —
// wrapping /dashboard itself in this guard would otherwise infinite-loop).
export function BlockEmployeeRoute() {
  const { user } = useAuth();
  if (isEmployeeAccount(user)) return <Navigate to="/dashboard/documents" replace />;
  return <Outlet />;
}

export default function ProtectedRoute() {
  const { user, authStatus, retryAuth } = useAuth();

  if (authStatus === "loading") {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-5rem)]">
        <div className="w-10 h-10 rounded-full border-4 border-border border-t-primary animate-spin" />
      </div>
    );
  }

  // A backend/network failure verifying the session is NOT the same thing as
  // being logged out — showing the login/signup prompt here (as this used to)
  // told a user with a perfectly valid session to log back in just because
  // /auth/me hit a transient 504. This never navigates away and never
  // touches the stored token; retrying just re-attempts verification in place.
  if (authStatus === "error") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-5rem)] px-6 text-center">
        <div className="w-20 h-20 rounded-2xl bg-secondary flex items-center justify-center mb-8">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-muted-foreground">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v4m0 4h.01M4.93 4.93l14.14 14.14M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
        </div>
        <h1 className="text-2xl sm:text-3xl font-serif font-bold text-foreground mb-3">
          We're having trouble connecting
        </h1>
        <p className="text-muted-foreground text-base max-w-md mb-8">
          This isn't a sign you've been logged out — we just couldn't reach the server to confirm your session. Please try again in a moment.
        </p>
        <button
          type="button"
          onClick={retryAuth}
          className="px-6 py-3.5 bg-primary text-primary-foreground font-bold text-base rounded-xl
            shadow-sm hover:opacity-90 transition-all duration-200 active:scale-95"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-5rem)] px-6 text-center">
        <div className="w-20 h-20 rounded-2xl bg-primary
          flex items-center justify-center shadow-sm mb-8">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor" className="text-primary-foreground">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
        </div>

        <h1 className="text-3xl sm:text-4xl font-serif font-bold text-foreground mb-3">
          Welcome Back!
        </h1>
        <p className="text-muted-foreground text-base sm:text-lg max-w-md mb-2">
          We're glad to see you. Please log in to continue your immigration journey with us.
        </p>
        <p className="text-muted-foreground text-sm max-w-sm mb-10">
          If you're an existing client, simply log in to pick up right where you left off.
          New to Immiglance? Sign up for free — we'd love to help you get started.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 w-full max-w-sm">
          <Link
            to="/login"
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3.5
              border-2 border-primary text-primary font-bold text-base rounded-xl
              hover:bg-accent transition-all duration-200 no-underline active:scale-95"
          >
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"/>
            </svg>
            Log In
          </Link>
          <Link
            to="/signup"
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3.5
              bg-primary text-primary-foreground font-bold text-base rounded-xl
              shadow-sm hover:opacity-90
              transition-all duration-200 no-underline active:scale-95"
          >
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/>
            </svg>
            New User? Sign Up
          </Link>
        </div>

        <p className="mt-8 text-xs text-muted-foreground">
          Immiglance · Secure Portal
        </p>
      </div>
    );
  }

  return <Outlet />;
}
