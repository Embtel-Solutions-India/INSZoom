import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import api, { setAccessToken } from '../services/api'
import * as permissionUtils from '../utils/permissions'
import { initializeNotifications, unregisterCurrentDevice } from '../services/notificationService'

const AuthContext = createContext()

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}


export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [token, setToken] = useState(null)
  useEffect(() => { if (user) initializeNotifications().catch(() => {}); }, [user]);
  const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds

  const clearSession = () => {
    // Access and refresh tokens are intentionally never persisted in browser storage.
    localStorage.removeItem('loginTime')
    localStorage.removeItem('user')
    setAccessToken(null)
    setToken(null)
    setUser(null)
  }

  useEffect(() => {
    const fetchUser = async () => {
      if (token) {
        // Check if session has expired
        const loginTime = localStorage.getItem('loginTime')
        if (loginTime) {
          const elapsed = Date.now() - parseInt(loginTime)
          if (elapsed > SESSION_DURATION) {
            // Session expired, logout
            clearSession()
            setToken(null)
            setUser(null)
            setLoading(false)
            return
          }
        }

        try {
          const response = await api.get('/auth/me', {
            headers: { Authorization: `Bearer ${token}` }
          })
          if (!permissionUtils.canAccessAdminPortal(response.data.user)) {
            clearSession()
            setLoading(false)
            return
          }
          setUser(response.data.user)
        } catch (error) {
          clearSession()
        }
      } else {
        try {
          const response = await api.post('/auth/refresh', {})
          const renewedToken = response.data?.accessToken
          if (renewedToken) {
            setAccessToken(renewedToken)
            setToken(renewedToken)
            return
          }
        } catch {
          clearSession()
        }
      }
      setLoading(false)
    }

    fetchUser()

    // Check session expiration every minute
    const sessionCheckInterval = setInterval(() => {
      const loginTime = localStorage.getItem('loginTime')
      if (loginTime && token) {
        const elapsed = Date.now() - parseInt(loginTime)
        if (elapsed > SESSION_DURATION) {
          logout()
        }
      }
    }, 60000) // Check every minute

    return () => clearInterval(sessionCheckInterval)
  }, [token])

  const login = useCallback(async (email, password) => {
    try {
      const response = await api.post('/auth/login', { email, password })
      const { token: newToken, accessToken, user: userData } = response.data
      if (!permissionUtils.canAccessAdminPortal(userData)) {
        return {
          success: false,
          message: 'This account is for the client portal only. Please sign in through the client portal.'
        }
      }
      
      // Store token and login timestamp
      localStorage.setItem('loginTime', Date.now().toString())
      
      setAccessToken(accessToken || newToken)
      setToken(accessToken || newToken)
      setUser(userData)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || 'Login failed'
      }
    }
  }, [])

  const logout = useCallback(async () => {
    await unregisterCurrentDevice().catch(() => {})
    try {
      await api.post('/auth/logout', {}, {
        headers: { Authorization: `Bearer ${token}` }
      })
    } catch (error) {
      console.error('Logout error:', error)
    } finally {
      clearSession()
    }
  }, [token])

  const hasPermission = useCallback((permission) => {
    if (!user) return false
    if (user.role === 'super_admin') return true
    return user.permissions?.includes(permission)
  }, [user])

  const hasRole = useCallback((roles) => {
    if (!user) return false
    if (Array.isArray(roles)) {
      return roles.includes(user.role)
    }
    return user.role === roles
  }, [user])

  const canModifyUser = useCallback((targetUser) => {
    if (!user) return false
    return permissionUtils.canModifyUser(user, targetUser)
  }, [user])

  const canCreateUserRole = useCallback((targetRole) => {
    if (!user) return false
    return permissionUtils.canCreateUserRole(user, targetRole)
  }, [user])

  const canAccessModule = useCallback((module) => {
    if (!user) return false
    return permissionUtils.canAccessModule(user, module)
  }, [user])

  const hasResourcePermission = useCallback((action, resource) => {
    if (!user) return false
    return permissionUtils.hasPermission(user, action, resource)
  }, [user])

  const getSidebarMenuItems = useCallback(() => {
    if (!user) return []
    return permissionUtils.getSidebarMenuItems(user)
  }, [user])

  const isInternalStaff = useCallback(() => {
    if (!user) return false
    return permissionUtils.isInternalStaff(user)
  }, [user])

  const isExternalUser = useCallback(() => {
    if (!user) return false
    return permissionUtils.isExternalUser(user)
  }, [user])

  const value = useMemo(() => ({
    user,
    token,
    loading,
    login,
    logout,
    hasPermission,
    hasRole,
    canModifyUser,
    canCreateUserRole,
    canAccessModule,
    hasResourcePermission,
    getSidebarMenuItems,
    isInternalStaff,
    isExternalUser,
    isAuthenticated: !!user
  }), [user, token, loading, login, logout, hasPermission, hasRole, canModifyUser, canCreateUserRole, canAccessModule, hasResourcePermission, getSidebarMenuItems, isInternalStaff, isExternalUser])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
