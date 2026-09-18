import { useState, useEffect } from "react";
import { useNavigate, Link, Navigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { authApi } from "../../services/api";
import PasswordField from "../../components/auth/PasswordField";
import AuthShell from "../../components/auth/AuthShell";

// Edge/IE inject their own native reveal-password icon on type="password"
// inputs (the ::-ms-reveal pseudo-element) — matches Admin's Login.jsx,
// which this page's visual design now mirrors exactly (see PasswordField).
const HIDE_NATIVE_REVEAL_CSS = `
  input[type="password"]::-ms-reveal,
  input[type="password"]::-ms-clear {
    display: none;
  }
`;

// Presentational-only entry hints — NOT an access decision. Whichever tab is
// selected renders the same login form and calls the same login() below;
// the authenticated account's real role (via AuthGate reading
// GET /api/auth/session-context) is what decides the post-login destination
// (client portal vs. Admin staff app), never what the user clicked here.
const ROLE_TABS = [
  { key: "client", label: "Client", heading: "Welcome back", sub: "Sign in to track your case in the client portal." },
  { key: "attorney", label: "Attorney", heading: "Attorney sign-in", sub: "Attorney portal access." },
  { key: "team", label: "Team member", heading: "Team member sign-in", sub: "" },
];

export default function Login() {
  const [roleTab,      setRoleTab]      = useState("client");
  const [email,       setEmail]       = useState("");
  const [caseId,      setCaseId]      = useState("");
  const [loginMethod, setLoginMethod] = useState("email");
  const [password,    setPassword]    = useState("");
  const [error,       setError]       = useState("");
  const [loading,     setLoading]     = useState(false);
  const [pendingInvite, setPendingInvite] = useState(false);
  const [resendingInvite, setResendingInvite] = useState(false);
  const [resendSent, setResendSent] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const { login, loginWithGoogle, googleRedirectUser, clearGoogleRedirectUser, googleAuthError, clearGoogleAuthError, user, authLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "Login | Immiglance";
  }, []);

  // signInWithRedirect leaves this page and comes back to it after Google
  // completes - pick up the result here instead of inline in handleGoogle,
  // mirroring exactly where the old popup flow's `navigate()` call was.
  // PHASE 3: routing is now decided exclusively by AuthGate
  // (src/components/AuthGate.jsx) via GET /api/auth/session-context — this
  // just lands the session on a protected route and lets AuthGate take it
  // from there (staff → Admin, client with no case → /onboarding/intake,
  // etc.).
  useEffect(() => {
    if (!googleRedirectUser) return;
    clearGoogleRedirectUser();
    navigate("/dashboard", { replace: true });
  }, [googleRedirectUser, navigate, clearGoogleRedirectUser]);

  useEffect(() => {
    if (!googleAuthError) return;
    setError(googleAuthError);
    setGoogleLoading(false);
    clearGoogleAuthError();
  }, [googleAuthError, clearGoogleAuthError]);

  // Never paint the login form for an already-authenticated visitor, not
  // even for a frame — covers a bookmarked/back-navigated visit to /login
  // while already signed in, not just the Google path above. While the
  // session check is in flight, render nothing; once it resolves to a
  // logged-in user, redirect declaratively instead of painting the form
  // first and navigating away a tick later. AuthGate (wrapping /dashboard)
  // takes it from there — staff/attorney get bounced to their own app,
  // clients land on the right destination for their case state.
  if (authLoading) {
    return <div className="min-h-screen bg-background" />;
  }
  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleLogin = async () => {
    const normalizedCaseId = caseId.trim();
    const normalizedEmail = email.trim();
    if (loginMethod === "caseId" && (!normalizedCaseId || !password)) {
      setError("Please enter your Case ID and password.");
      return;
    }
    if (loginMethod === "email" && (!normalizedEmail || !password)) {
      setError("Please enter your email and password.");
      return;
    }
    setError(""); setPendingInvite(false); setResendSent(false); setLoading(true);
    try {
      // No navigate() here - the already-authenticated-guard effect above
      // reacts to `user` becoming set (which login() does internally) and
      // resolves the correct destination itself. Navigating here too would
      // race it: this would fire first with a guess, then the guard's async
      // case-check would correct it a beat later, producing exactly the
      // /dashboard-then-/dashboard/intake flash this page is meant to avoid.
      await login(
        loginMethod === "caseId"
          ? { caseId: normalizedCaseId, password }
          : { email: normalizedEmail, password }
      );
    } catch (err) {
      const msg = (err.message || "").toLowerCase();
      if (err.code === "PENDING_INVITE") {
        setPendingInvite(true);
      } else if (msg.includes("user-not-found") || msg.includes("no user") || msg.includes("invalid-credential") || msg.includes("invalid credential")) {
        setError("No account found with this email. Please check your email or sign up.");
      } else if (msg.includes("wrong-password") || msg.includes("wrong password") || msg.includes("incorrect password")) {
        setError("Incorrect password. Please try again or reset your password.");
      } else if (msg.includes("too-many-requests") || msg.includes("too many")) {
        setError("Too many failed attempts. Please wait a moment before trying again.");
      } else if (msg.includes("network") || msg.includes("offline")) {
        setError("Network issue. Please check your internet connection and try again.");
      } else {
        setError("Unable to log in. Please check your credentials and try again.");
      }
    } finally { setPassword(""); setLoading(false); }
  };

  const handleResendInvite = async () => {
    setResendingInvite(true);
    try {
      await authApi.resendInvite(email.trim());
      setResendSent(true);
    } finally {
      setResendingInvite(false);
    }
  };

  const handleGoogle = async () => {
    setError(""); setGoogleLoading(true);
    try {
      // On most browsers this triggers a full-page redirect to Google -
      // this component unmounts here on success, and the result is handled
      // by the useEffect above once Google redirects back to this page. On
      // Edge (see firebase.js's redirectWillLoseState), it opens a popup
      // instead and resolves inline without unmounting - context's
      // loginWithGoogle sets googleRedirectUser itself in that case, which
      // the same useEffect below also reacts to, so no separate handling is
      // needed here either way.
      await loginWithGoogle();
    } catch (err) {
      // auth/popup-closed-by-user means the user dismissed the popup (Edge
      // path only) - not an error worth surfacing.
      if (err?.code === "auth/popup-closed-by-user" || err?.code === "auth/cancelled-popup-request") {
        setGoogleLoading(false);
        return;
      }
      console.error("Google sign-in error:", err?.code, err?.message);
      setError("Unable to continue with Google. Please try again or use email login.");
      setGoogleLoading(false);
    }
  };

  const activeTab = ROLE_TABS.find((t) => t.key === roleTab) || ROLE_TABS[0];

  return (
    <AuthShell>
      <style>{HIDE_NATIVE_REVEAL_CSS}</style>

      {(
        <>
        {/* Role entry tabs */}
            <div className="mb-4 flex items-center gap-1 border-b border-border">
              {ROLE_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => { setRoleTab(tab.key); setError(""); setLoginMethod("email"); }}
                  className={`flex-1 -mb-px border-b-2 pb-2.5 text-xs sm:text-sm font-bold transition cursor-pointer ${
                    roleTab === tab.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="mb-4 text-center">
              <h2 className="text-xl font-bold text-foreground">{activeTab.heading}</h2>
              {activeTab.sub && <p className="mt-1 text-sm text-muted-foreground">{activeTab.sub}</p>}
            </div>

            {(
              // The attorney tab used to show a static "go to the attorney
              // portal" link instead of a real form — now that the attorney
              // portal exists and AuthGate already knows how to hand a
              // session over to it (isAttorney branch below, SSO token in
              // the URL), an attorney can just sign in with the same
              // email/password form as every other tab right here: login()
              // authenticates against the same backend, the "already
              // authenticated" redirect effect above sends them to
              // /dashboard, and AuthGate's isAttorney check takes it from
              // there — one sign-in, no extra click, no second login screen.
              <>
                {/* Google + Case ID sign-in are client-only — team members
                    always sign in with their staff email + password, no
                    alternate identifiers. */}
                {roleTab === "client" && (
                  <>
                    <button
                      onClick={handleGoogle}
                      disabled={loading || googleLoading}
                      className="flex items-center justify-center gap-3 w-full py-2.5 mb-3
                        bg-card border border-border rounded-xl text-sm font-semibold text-foreground
                        hover:bg-secondary transition-all duration-200 active:scale-[0.98] disabled:opacity-60 cursor-pointer"
                    >
                      {googleLoading ? "Redirecting to Google…" : (
                        <>
                          <GoogleIcon />
                          Continue with Google
                        </>
                      )}
                    </button>

                    <div className="flex items-center gap-3 mb-3">
                      <span className="flex-1 h-px bg-border" />
                      <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">Or sign in with portal credentials</span>
                      <span className="flex-1 h-px bg-border" />
                    </div>
                  </>
                )}

                <form onSubmit={(e) => { e.preventDefault(); handleLogin(); }}>
                {roleTab === "client" && (
                  <div className="mb-3 flex items-center gap-4">
                    {[
                      { key: "email", label: "Email" },
                      { key: "caseId", label: "Case ID" },
                    ].map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => {
                          setLoginMethod(option.key);
                          setError("");
                          setPendingInvite(false);
                          setResendSent(false);
                        }}
                        className={`text-xs font-bold transition cursor-pointer pb-1 border-b-2 ${
                          loginMethod === option.key
                            ? "border-primary text-primary"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}

                {loginMethod === "email" ? (
                  <FieldWrap icon={<MailIcon />}>
                    <input
                      type="email"
                      id="login-email"
                      name="email"
                      placeholder="Email address"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      className="w-full h-12 pl-10 pr-4 text-sm text-foreground placeholder-muted-foreground
                        border border-input rounded-lg bg-card/90 outline-none
                        hover:border-ring/50 focus:border-primary focus:ring-4 focus:ring-ring/10
                        transition-all duration-150"
                    />
                  </FieldWrap>
                ) : (
                  <FieldWrap icon={<CaseIdIcon />}>
                    <input
                      type="text"
                      id="login-case-id"
                      name="caseId"
                      placeholder="Case ID"
                      value={caseId}
                      onChange={(e) => setCaseId(e.target.value)}
                      autoComplete="username"
                      className="w-full h-12 pl-10 pr-4 text-sm text-foreground placeholder-muted-foreground
                        border border-input rounded-lg bg-card/90 outline-none
                        hover:border-ring/50 focus:border-primary focus:ring-4 focus:ring-ring/10
                        transition-all duration-150"
                    />
                  </FieldWrap>
                )}

                {/* Password */}
                <PasswordField
                  icon={<LockIcon />}
                  name="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />

                {/* Forgot */}
                <div className="text-right mb-3 -mt-1">
                  <Link to="/forgot-password" className="text-xs text-primary hover:underline font-medium">
                    Forgot password?
                  </Link>
                </div>

                {/* Invited-but-passwordless employee tried to log in with their
                    invited email — guide them to activation via a resend, never
                    exposing the invite token itself. */}
                {pendingInvite && (
                  <div role="alert" className="mb-4 px-4 py-3 bg-accent border border-accent-foreground/20 rounded-xl text-sm text-accent-foreground">
                    {resendSent ? (
                      <p>A new invitation has been sent to <span className="font-semibold">{email}</span>. Check your email to set your password.</p>
                    ) : (
                      <>
                        <p className="mb-2">You've been invited — set your password to continue instead of logging in.</p>
                        <button type="button" onClick={handleResendInvite} disabled={resendingInvite}
                          className="text-sm font-bold underline disabled:opacity-60 cursor-pointer">
                          {resendingInvite ? "Sending…" : "Resend invitation email"}
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* Error */}
                {error && (
                  <div role="alert" className="flex items-start gap-2 mb-4 px-4 py-3
                    bg-destructive/10 border border-destructive/30 rounded-xl text-sm text-destructive">
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="shrink-0 mt-0.5" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                    </svg>
                    {error}
                  </div>
                )}

                {/* Login button */}
                <button
                  type="submit"
                  disabled={loading || googleLoading}
                  className="h-12 w-full mb-2.5 rounded-lg bg-primary text-sm font-black text-primary-foreground
                    shadow-[0_12px_28px_rgba(37,99,235,0.28)] transition hover:bg-primary/90 focus:outline-none
                    focus:ring-4 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Signing in…" : "Sign In"}
                </button>
                </form>

                {roleTab === "client" && (
                  <button
                    type="button"
                    onClick={() => navigate("/signup")}
                    className="w-full py-2.5 bg-card border border-border text-foreground
                      text-sm font-semibold rounded-xl hover:bg-secondary
                      transition-all duration-200 cursor-pointer"
                  >
                    New user? Create account
                  </button>
                )}
              </>
            )}

            <div className="my-4 h-px bg-gradient-to-r from-transparent via-border to-transparent" />

            <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-bold text-muted-foreground sm:gap-3 sm:text-sm">
              <ShieldIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span>Secure</span>
              <span className="text-muted-foreground/60">&bull;</span>
              <span>Trusted</span>
              <span className="text-muted-foreground/60">&bull;</span>
              <span>Compliant</span>
            </div>

            <p className="mt-3 text-center text-xs text-muted-foreground">© 2026 Immiglance</p>
        </>
      )}
    </AuthShell>
  );
}

/* ── Shared field wrapper ── */
function FieldWrap({ icon, children }) {
  return (
    <div className="relative mb-3">
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none flex items-center z-10">
        {icon}
      </span>
      {children}
    </div>
  );
}

/* ── Icons ── */
function ShieldIcon({ className = "h-5 w-5", strokeWidth = 2 }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.08 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-3.59-13.46-8.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}
function MailIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
    </svg>
  );
}
function CaseIdIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" d="M7 7h10M7 12h5m-7 8h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
    </svg>
  );
}
function LockIcon() {
  return (
    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
    </svg>
  );
}
