import { createContext, useContext, useState, useEffect, useCallback, useMemo } from "react";
import { signInWithPopup } from "firebase/auth";
import { auth, googleProvider } from "../firebase";
import { authApi, tokenStore } from "../services/api";
import { initializeNotifications, unregisterCurrentDevice } from "../services/notificationService";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const clearSession = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  // Rehydrate session on mount
  useEffect(() => {
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
  }, []);

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

  // Firebase popup → exchange Firebase ID token for our JWT
  const loginWithGoogle = useCallback(async () => {
    const result = await signInWithPopup(auth, googleProvider);
    const idToken = await result.user.getIdToken();
    const data = await authApi.googleToken(idToken);
    tokenStore.set(data.accessToken);
    setUser(data.user);
    return data.user;
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
    () => ({ user, authLoading, signup, login, acceptInvite, loginWithGoogle, logout, setUserFromOAuth, updateUser }),
    [user, authLoading, signup, login, acceptInvite, loginWithGoogle, logout, setUserFromOAuth, updateUser]
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
