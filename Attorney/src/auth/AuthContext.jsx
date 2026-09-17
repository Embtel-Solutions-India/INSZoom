import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { authApi, setAccessToken, getAccessToken } from '../services/api'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

// This portal is attorneys-only. A valid session for any other role is a
// successful authentication but NOT an authorized one — it's rejected here
// rather than deeper in the UI, so no attorney portal screen ever renders
// for a client/case manager/admin account.
const ACCESS_DENIED = 'Access denied — this portal is for attorneys only.'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  // Restores the session on a hard refresh: the access token only lives in
  // memory, but the refresh cookie survives, so /auth/me (which triggers the
  // interceptor's silent refresh on 401) re-establishes it.
  useEffect(() => {
    let cancelled = false
    authApi
      .me()
      .then(({ data }) => {
        if (cancelled) return
        const me = data?.user || data?.data || data
        setUser(me?.role === 'attorney' ? me : null)
      })
      .catch(() => { if (!cancelled) setUser(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const login = useCallback(async (email, password) => {
    const { data } = await authApi.login(email, password)
    const token = data?.token || data?.accessToken
    const me = data?.user
    if (!token) throw new Error('Login failed')
    setAccessToken(token)

    // Role gate. The token is discarded rather than kept around, so a
    // non-attorney can't sit on a usable session in this origin.
    if (me?.role !== 'attorney') {
      setAccessToken(null)
      throw new Error(ACCESS_DENIED)
    }
    localStorage.setItem('loginTime', Date.now().toString())
    setUser(me)
    return me
  }, [])

  // SSO landing from Immiglance: the token arrives in the URL, and the only
  // thing that makes it trustworthy is the backend confirming it — the
  // signature is never checked client-side.
  const loginWithToken = useCallback(async (token) => {
    setAccessToken(token)
    try {
      const { data } = await authApi.me()
      const me = data?.user || data?.data || data
      if (me?.role !== 'attorney') {
        setAccessToken(null)
        throw new Error(ACCESS_DENIED)
      }
      localStorage.setItem('loginTime', Date.now().toString())
      setUser(me)
      return me
    } catch (error) {
      setAccessToken(null)
      throw error
    }
  }, [])

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => {})
    setAccessToken(null)
    localStorage.removeItem('loginTime')
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, loading, login, loginWithToken, logout, isAuthenticated: Boolean(user && getAccessToken()) }),
    [user, loading, login, loginWithToken, logout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export { ACCESS_DENIED }
