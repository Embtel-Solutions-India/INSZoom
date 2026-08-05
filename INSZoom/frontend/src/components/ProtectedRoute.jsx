import { Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'

const ProtectedRoute = ({ children, requiredRoles = [], requiredPermissions = [], module = null }) => {
  const { isAuthenticated, loading, user, logout, hasRole, hasPermission, canAccessModule } = useAuth()
  const isClientPortalOnly = user?.role === 'client' || user?.role === 'user'

  useEffect(() => {
    if (!loading && isAuthenticated && isClientPortalOnly) logout()
  }, [loading, isAuthenticated, isClientPortalOnly, logout])

  // Wait for auth to finish resolving before deciding where to send the user.
  // Without this, a page refresh redirects to /login while the session is still
  // being restored from localStorage / validated against the server.
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-600">Loading...</div>
      </div>
    )
  }

  // Check if user is authenticated
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (isClientPortalOnly) {
    return <Navigate to="/login" replace />
  }

  // Check if user has required role
  if (requiredRoles.length > 0 && !hasRole(requiredRoles)) {
    return <Navigate to="/dashboard" replace />
  }

  // Check if user has required permissions
  if (requiredPermissions.length > 0) {
    const hasAllPermissions = requiredPermissions.every(permission => hasPermission(permission))
    if (!hasAllPermissions) {
      return <Navigate to="/dashboard" replace />
    }
  }

  // Check if user can access the module.
  // Never redirect the dashboard module to itself — that would create an
  // infinite redirect loop and render a blank screen.
  if (module && module !== 'dashboard' && !canAccessModule(module)) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}

export default ProtectedRoute
