import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import api from '../services/api'
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
  // Restore the user synchronously from localStorage so there is no "null gap"
  // on refresh that would cause ProtectedRoute to bounce back to /login.
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem('user')
    if (!savedUser) return null
    try {
      return JSON.parse(savedUser)
    } catch {
      localStorage.removeItem('user')
      return null
    }
  })
  const [loading, setLoading] = useState(true)
  const [token, setToken] = useState(localStorage.getItem('token'))
  useEffect(() => { if (user) initializeNotifications().catch(() => {}); }, [user]);
  const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds

  const clearSession = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('refreshToken')
    localStorage.removeItem('loginTime')
    localStorage.removeItem('user')
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
          // Refresh the cached user so the next reload restores up-to-date data
          localStorage.setItem('user', JSON.stringify(response.data.user))
        } catch (error) {
          clearSession()
        }
      } else {
        // Try to restore user from localStorage
        const savedUser = localStorage.getItem('user')
        if (savedUser) {
          try {
            const parsedUser = JSON.parse(savedUser)
            if (permissionUtils.canAccessAdminPortal(parsedUser)) setUser(parsedUser)
            else clearSession()
          } catch (error) {
            localStorage.removeItem('user')
          }
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
      const { token: newToken, accessToken, refreshToken, user: userData } = response.data
      if (!permissionUtils.canAccessAdminPortal(userData)) {
        return {
          success: false,
          message: 'This account is for the client portal only. Please sign in through the client portal.'
        }
      }
      
      // Store token and login timestamp
      localStorage.setItem('token', accessToken || newToken)
      if (refreshToken) localStorage.setItem('refreshToken', refreshToken)
      localStorage.setItem('loginTime', Date.now().toString())
      localStorage.setItem('user', JSON.stringify(userData))
      
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
    try {
      await api.post('/auth/logout', { refreshToken: localStorage.getItem('refreshToken') }, {
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
