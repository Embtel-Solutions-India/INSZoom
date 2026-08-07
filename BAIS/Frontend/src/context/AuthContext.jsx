import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { auth, googleProvider, signInWithRedirect, signInWithPopup, getRedirectResult, redirectWillLoseState } from "../firebase";
import { authApi, tokenStore } from "../services/api";
import { initializeNotifications, unregisterCurrentDevice } from "../services/notificationService";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  // Set exactly once, right after a Google signInWithRedirect flow lands
  // back on the page - Login/Register consume it to navigate (role-based,
  // same as the old popup flow's inline `navigate()`) and then clear it.
  // Kept separate from `user` so this doesn't also re-fire on ordinary
  // email/password logins, which already navigate themselves.
  const [googleRedirectUser, setGoogleRedirectUser] = useState(null);
  const [googleAuthError, setGoogleAuthError] = useState("");

  const clearSession = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  const clearGoogleRedirectUser = useCallback(() => setGoogleRedirectUser(null), []);
  const clearGoogleAuthError = useCallback(() => setGoogleAuthError(""), []);

  // getRedirectResult() only ever returns Google's real result on the FIRST
  // call after a redirect completes - every call after that resolves to
  // null, even within the same page load. React.StrictMode (main.jsx)
  // double-invokes effects in dev (mount -> cleanup -> mount again), which
  // races two calls to it: whichever call actually receives the real result
  // may belong to the invocation whose cleanup already fired, so its
  // now-stale `cancelled` guard would silently drop a successful sign-in,
  // and the second invocation finds nothing left to consume. This ref
  // ensures the redirect check + token exchange runs exactly once per
  // provider lifetime regardless of how many times the effect fires.
  const redirectCheckStarted = useRef(false);

  // On mount: first check whether we just landed back from a Google
  // signInWithRedirect round-trip, THEN fall back to the normal
  // localStorage-token rehydration. Both paths share the same authLoading
  // gate so ProtectedRoute never flashes "please log in" while the
  // redirect-result exchange is still in flight.
  useEffect(() => {
    if (redirectCheckStarted.current) return;
    redirectCheckStarted.current = true;
    (async () => {
      try {
        const result = await getRedirectResult(auth);
        if (result) {
          const idToken = await result.user.getIdToken();
          const data = await authApi.googleToken(idToken);
          tokenStore.set(data.accessToken);
          setUser(data.user);
          setGoogleRedirectUser(data.user);
          setAuthLoading(false);
          return;
        }
      } catch (err) {
        // Real config/account errors (e.g. unauthorized-domain, disabled
        // user) - NOT the common case, which is getRedirectResult simply
        // resolving to null on every ordinary page load.
        console.error("Google redirect sign-in failed:", err);
        setGoogleAuthError("Unable to complete Google sign-in. Please try again or use email login.");
      }
      const access = tokenStore.getAccess();
      if (!access) {
        setAuthLoading(false);
        return;
      }
      authApi
        .me()
        // features (feature-flag server defaults) only comes back from /auth/me,
        // not login/signup/acceptInvite — attaching it here means a flag flip
        // takes effect on next refresh, matching the flag module's contract.
        .then(({ user: u, features }) => setUser(u ? { ...u, features } : u))
        .catch(clearSession)
        .finally(() => setAuthLoading(false));
    })();
  }, [clearSession]);

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
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await authApi.login(email, password);
    tokenStore.set(data.accessToken);
    setUser(data.user);
    return data.user;
  }, []);

  // Invited employee sets their own password via the emailed link, then is
  // logged straight in — the employer never sees or sets this password.
  const acceptInvite = useCallback(async (token, password, confirmPassword) => {
    const data = await authApi.acceptInvite(token, password, confirmPassword);
    tokenStore.set(data.accessToken);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    await unregisterCurrentDevice().catch(() => {});
    clearSession();
    await authApi.logout().catch(() => {});
  }, [clearSession]);

  // Edge deletes the pending-redirect state during signInWithRedirect's
  // navigation chain through the firebaseapp.com auth handler (confirmed via
  // diagnostic capture) - getRedirectResult() then always resolves to null
  // on return, silently stranding the user back on /login. For Edge (and,
  // on a less-confirmed bet, Safari/iOS - see firebase.js's authDomain
  // comment) this uses signInWithPopup instead, which resolves inline
  // without a navigation chain. Everyone else keeps using
  // signInWithRedirect, picked up by the getRedirectResult effect above.
  const loginWithGoogle = useCallback(async () => {
    if (redirectWillLoseState()) {
      const result = await signInWithPopup(auth, googleProvider);
      const idToken = await result.user.getIdToken();
      const data = await authApi.googleToken(idToken);
      tokenStore.set(data.accessToken);
      setUser(data.user);
      setGoogleRedirectUser(data.user);
      setAuthLoading(false);
      return;
    }
    await signInWithRedirect(auth, googleProvider);
  }, []);

  // Called by OAuthCallback page (passport redirect flow — kept for compatibility)
  const setUserFromOAuth = useCallback((userData) => {
    setUser(userData);
    setAuthLoading(false);
  }, []);

  // Merge a partial user update (e.g. the response from PUT /auth/updatedetails)
  // into local state without a full re-login — used for self-service account
  // fields like applicantType.
  const updateUser = useCallback((patch) => {
    setUser((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const value = useMemo(
    () => ({
      user, authLoading, signup, login, acceptInvite, loginWithGoogle, logout, setUserFromOAuth, updateUser,
      googleRedirectUser, clearGoogleRedirectUser, googleAuthError, clearGoogleAuthError,
    }),
    [
      user, authLoading, signup, login, acceptInvite, loginWithGoogle, logout, setUserFromOAuth, updateUser,
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
