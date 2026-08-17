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
    setAuthStatus(AUTH_STATUS.UNAUTHENTICATED);
  }, []);

  // Re-verifies against /auth/me without ever downgrading a backend/network
  // failure into "logged out" — used on mount and as the retry action
  // ProtectedRoute's error screen offers the user directly.
  const verifySession = useCallback(async () => {
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
      const { user: u, features } = await authApi.me();
      setUser(u ? { ...u, features } : u);
      setAuthStatus(AUTH_STATUS.AUTHENTICATED);
    } catch (err) {
      if (err?.status === 401) {
        // A real 401 means the token is genuinely invalid — api.js has
        // already cleared it and fired bais:session-expired by this point;
        // this just mirrors that into local state.
        setUser(null);
        setAuthStatus(AUTH_STATUS.UNAUTHENTICATED);
      } else {
        // Network error, 5xx, a 504 from backend/DB contention — NOT proof
        // the user is logged out. Leave the token alone; ProtectedRoute
        // shows a retry screen instead of bouncing to the login prompt.
        setAuthStatus(AUTH_STATUS.ERROR);
      }
    }
  }, []);

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

  const signup = useCallback(async (name, email, password, referralCode, phone, accountType = "client") => {
    const data = await authApi.register(name, email, password, referralCode, phone, accountType);
    tokenStore.set(data.accessToken);
    setUser(data.user);
    setAuthStatus(AUTH_STATUS.AUTHENTICATED);
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await authApi.login(email, password);
    tokenStore.set(data.accessToken);
    setUser(data.user);
    setAuthStatus(AUTH_STATUS.AUTHENTICATED);
    return data.user;
  }, []);

  // Invited employee sets their own password via the emailed link, then is
  // logged straight in — the employer never sees or sets this password.
  const acceptInvite = useCallback(async (token, password, confirmPassword) => {
    const data = await authApi.acceptInvite(token, password, confirmPassword);
    tokenStore.set(data.accessToken);
    setUser(data.user);
    setAuthStatus(AUTH_STATUS.AUTHENTICATED);
    return data.user;
  }, []);

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

  // Called by OAuthCallback page (passport redirect flow — kept for compatibility)
  const setUserFromOAuth = useCallback((userData) => {
    setUser(userData);
    setAuthStatus(AUTH_STATUS.AUTHENTICATED);
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
      signup, login, acceptInvite, loginWithGoogle, logout, setUserFromOAuth, updateUser,
      googleRedirectUser, clearGoogleRedirectUser, googleAuthError, clearGoogleAuthError,
    }),
    [
      user, authStatus, verifySession, signup, login, acceptInvite, loginWithGoogle, logout, setUserFromOAuth, updateUser,
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
