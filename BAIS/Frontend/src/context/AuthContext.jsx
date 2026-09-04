import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { authApi, tokenStore, API_BASE_URL } from "../services/api";
import { initializeNotifications, unregisterCurrentDevice } from "../services/notificationService";

const AuthContext = createContext(null);

// Explicit states rather than a bare boolean+user pair: "backend temporarily
// unreachable" and "genuinely not logged in" used to collapse into the same
// thing (user=null), which meant a 504 from /auth/me looked IDENTICAL to a
// real logged-out session — ProtectedRoute would show the login/signup
// prompt either way. They now stay distinguishable end-to-end:
//   loading         - initial check in flight, or a fresh login just submitted
//   authenticated   - user is confirmed and available
//   unauthenticated - confirmed no valid session (no token, or a real 401)
//   error           - backend/network failure verifying the session; the
//                     token (if any) is left untouched, since this is NOT
//                     evidence the user is logged out
const AUTH_STATUS = { LOADING: "loading", AUTHENTICATED: "authenticated", UNAUTHENTICATED: "unauthenticated", ERROR: "error" };

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authStatus, setAuthStatus] = useState(AUTH_STATUS.LOADING);
  // Perf fix: previously fetched independently by both AuthGate.jsx and
  // Navbar.jsx (each into its own local useState, with zero sharing) - now
  // fetched once here alongside /auth/me and shared via context, so
  // GET /auth/session-context fires once per verifySession() call instead of
  // once per component. Stores the full response shape (hasCase, caseIds,
  // activeCase, isLegacyNoCaseAccount, leadId, mustSetPassword, caseRole,
  // role, userId) since AuthGate depends on nearly all of these fields.
  const [sessionContext, setSessionContext] = useState(null);
  // Previously set once a Google sign-in flow completed, so Login/Register
  // could navigate (role-based) without re-firing on ordinary email/password
  // logins. Firebase Auth (the same-page signInWithRedirect() flow this was
  // built for) is removed. The current Google sign-in flow is a full
  // backend-mediated redirect that lands on /auth/callback (OAuthCallback.jsx
  // -> setUserFromOAuth) instead of returning to this page, so nothing sets
  // this today either — kept only because Login.jsx/Register.jsx still read
  // it defensively.
  const [googleRedirectUser, setGoogleRedirectUser] = useState(null);
  const [googleAuthError, setGoogleAuthError] = useState("");

  const clearSession = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setSessionContext(null);
    setAuthStatus(AUTH_STATUS.UNAUTHENTICATED);
  }, []);

  // Re-verifies against /auth/me without ever downgrading a backend/network
  // failure into "logged out" — used on mount and as the retry action
  // ProtectedRoute's error screen offers the user directly.
  //
  // Phase 12 fix (P12-C2): a transient /auth/me failure (this dev
  // environment's remote DB routinely takes 15-45s under load - see
  // PHASE_F2/F3_COMPLETION_REPORT.md) left `user` at its initial `null`
  // forever, with no automatic recovery - only ProtectedRoute's manual
  // "retry" button ever re-ran verifySession(). Navbar renders purely off
  // `user` (not authStatus), so it showed Login/Sign Up indefinitely for an
  // actually-valid session, even while other components' own token-bearing
  // API calls succeeded moments later on their own retry/slower response.
  // autoRetry (default true) schedules exactly one automatic re-check a few
  // seconds later on a non-401 failure, so a slow-backend blip self-heals
  // without the user having to notice and click anything. Explicit manual
  // retries (ProtectedRoute's button) pass autoRetry:false so a still-down
  // backend doesn't loop retries silently forever.
  const verifySessionRef = useRef(null);
  const verifySession = useCallback(async (autoRetry = true) => {
    const access = tokenStore.getAccess();
    if (!access) {
      setAuthStatus(AUTH_STATUS.UNAUTHENTICATED);
      return;
    }
    setAuthStatus((current) => (current === AUTH_STATUS.AUTHENTICATED ? current : AUTH_STATUS.LOADING));
    try {
      // features (feature-flag server defaults) only comes back from /auth/me,
      // not login/signup/acceptInvite — attaching it here means a flag flip
      // takes effect on next refresh, matching the flag module's contract.
      // Fetched alongside session-context (previously a second, separate
      // round-trip fired independently by both AuthGate and Navbar).
      const [{ user: u, features }, sessionCtx] = await Promise.all([authApi.me(), authApi.sessionContext()]);
      if (!sessionCtx?.success) {
        // Mirrors AuthGate's original fetchContext() behavior: a
        // non-exception, non-success session-context response is treated as
        // no valid session, same as it did before this fetch moved here.
        setUser(null);
        setSessionContext(null);
        setAuthStatus(AUTH_STATUS.UNAUTHENTICATED);
        return;
      }
      setUser(u ? { ...u, features } : u);
      setSessionContext(sessionCtx);
      setAuthStatus(AUTH_STATUS.AUTHENTICATED);
    } catch (err) {
      if (err?.status === 401) {
        // A real 401 means the token is genuinely invalid — api.js has
        // already cleared it and fired bais:session-expired by this point;
        // this just mirrors that into local state.
        setUser(null);
        setSessionContext(null);
        setAuthStatus(AUTH_STATUS.UNAUTHENTICATED);
      } else {
        // Network error, 5xx, a 504 from backend/DB contention — NOT proof
        // the user is logged out. Leave the token alone; ProtectedRoute
        // shows a retry screen instead of bouncing to the login prompt.
        // A session-context-specific failure now surfaces identically to an
        // /auth/me failure (a deliberate simplification — AuthGate no longer
        // has its own separate error copy for this case).
        setAuthStatus(AUTH_STATUS.ERROR);
        if (autoRetry) setTimeout(() => { verifySessionRef.current?.(false); }, 4000);
      }
    }
  }, []);
  useEffect(() => { verifySessionRef.current = verifySession; }, [verifySession]);

  const clearGoogleRedirectUser = useCallback(() => setGoogleRedirectUser(null), []);
  const clearGoogleAuthError = useCallback(() => setGoogleAuthError(""), []);

  // Firebase's signInWithRedirect round-trip (and its getRedirectResult()
  // mount-time check) was removed along with Firebase Auth. This effect is
  // now just the plain localStorage-token rehydration every other page load
  // already did — kept as its own effect (rather than inlined) so a future
  // Google-sign-in replacement has an obvious place to add its own
  // mount-time credential check without disturbing this.
  const mountCheckStarted = useRef(false);
  useEffect(() => {
    if (mountCheckStarted.current) return;
    mountCheckStarted.current = true;
    verifySession();
  }, [verifySession]);

  // Listen for global session-expired events (triggered by api.js on 401)
  useEffect(() => {
    const handler = () => clearSession();
    window.addEventListener("bais:session-expired", handler);
    return () => window.removeEventListener("bais:session-expired", handler);
  }, [clearSession]);

  // Single hook point for FCM setup — mirrors SocketProvider's exact
  // user?._id-driven pattern, so it fires once per session-start regardless
  // of which of the 4 login paths (or mount-time rehydration) produced the
  // session, with no duplicated calls in each of those callbacks.
  useEffect(() => {
    if (!user?._id) return;
    initializeNotifications().catch(() => {});
  }, [user?._id]);

  // login/signup/acceptInvite each land the user directly on a protected
  // route (see Login.jsx's "already-authenticated" navigate effect) as soon
  // as authStatus flips to AUTHENTICATED. AuthGate now reads sessionContext
  // from this same context instead of fetching its own copy, so it must
  // already be populated by the time that flip happens — otherwise AuthGate
  // sees AUTHENTICATED + sessionContext:null and incorrectly bounces back to
  // /login. Fetched best-effort (a failure here just leaves sessionContext
  // null; AuthGate's own "!context" branch already handles that by routing
  // to /login, no worse than before this fetch existed here).
  const fetchAndSetSessionContext = useCallback(async () => {
    const sessionCtx = await authApi.sessionContext().catch(() => null);
    setSessionContext(sessionCtx?.success ? sessionCtx : null);
  }, []);

  const signup = useCallback(async (name, email, password, referralCode, phone, accountType = "client") => {
    const data = await authApi.register(name, email, password, referralCode, phone, accountType);
    tokenStore.set(data.accessToken);
    setUser(data.user);
    await fetchAndSetSessionContext();
    setAuthStatus(AUTH_STATUS.AUTHENTICATED);
  }, [fetchAndSetSessionContext]);

  const login = useCallback(async (emailOrPayload, password) => {
    const data = await authApi.login(emailOrPayload, password);
    tokenStore.set(data.accessToken);
    setUser(data.user);
    await fetchAndSetSessionContext();
    setAuthStatus(AUTH_STATUS.AUTHENTICATED);
    return data.user;
  }, [fetchAndSetSessionContext]);

  // Invited employee sets their own password via the emailed link, then is
  // logged straight in — the employer never sees or sets this password.
  const acceptInvite = useCallback(async (token, password, confirmPassword) => {
    const data = await authApi.acceptInvite(token, password, confirmPassword);
    tokenStore.set(data.accessToken);
    setUser(data.user);
    await fetchAndSetSessionContext();
    setAuthStatus(AUTH_STATUS.AUTHENTICATED);
    return data.user;
  }, [fetchAndSetSessionContext]);

  const logout = useCallback(async () => {
    await unregisterCurrentDevice().catch(() => {});
    clearSession();
    await authApi.logout().catch(() => {});
  }, [clearSession]);

  // Backend-mediated OAuth authorization-code flow: this is a full-page
  // navigation to the backend's /auth/google, which redirects to Google,
  // then back to the backend's /auth/google/callback, which finally
  // redirects the browser to this app's /auth/callback with the session
  // already established (see OAuthCallback.jsx + setUserFromOAuth above).
  // This function never resolves on success — the page navigates away.
  const loginWithGoogle = useCallback(async () => {
    window.location.href = `${API_BASE_URL}/auth/google`;
  }, []);

  // Called by OAuthCallback page (passport redirect flow — kept for
  // compatibility) right after tokenStore.set(accessToken), before its own
  // navigate("/dashboard"). Sets `user` immediately for a fast paint, but
  // deliberately does NOT jump straight to AUTHENTICATED — sessionContext
  // (needed by the AuthGate this navigate lands on) isn't known yet. Routing
  // through verifySession() here (rather than a bespoke fetch) fetches it via
  // the exact same /auth/me + /auth/session-context pair every other login
  // path relies on, and keeps authStatus at LOADING for that window so
  // AuthGate shows its spinner instead of reading a still-null sessionContext
  // as "not logged in" and bouncing back to /login.
  const setUserFromOAuth = useCallback((userData) => {
    setUser(userData);
    setAuthStatus(AUTH_STATUS.LOADING);
    verifySessionRef.current?.(false);
  }, []);

  // Merge a partial user update (e.g. the response from PUT /auth/updatedetails)
  // into local state without a full re-login — used for self-service account
  // fields like applicantType.
  const updateUser = useCallback((patch) => {
    setUser((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const value = useMemo(
    () => ({
      user, authStatus, authLoading: authStatus === AUTH_STATUS.LOADING, retryAuth: verifySession,
      sessionContext,
      signup, login, acceptInvite, loginWithGoogle, logout, setUserFromOAuth, updateUser,
      googleRedirectUser, clearGoogleRedirectUser, googleAuthError, clearGoogleAuthError,
    }),
    [
      user, authStatus, verifySession, sessionContext, signup, login, acceptInvite, loginWithGoogle, logout, setUserFromOAuth, updateUser,
      googleRedirectUser, clearGoogleRedirectUser, googleAuthError, clearGoogleAuthError,
    ]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
