import { useEffect } from 'react'
import { useAuth } from './AuthContext.jsx'
import { useTheme } from './ThemeContext.jsx'
import { authApi } from "../services/api.js"

// Keeps the light/dark choice on the user's account (User.preferences.theme), so it is the same on every browser, device and
// portal and survives logging out and in. Renders nothing; mount it inside the AuthProvider.
export default function ThemeSync() {
  const { user } = useAuth()
  const { applyServerTheme, registerPersist } = useTheme()
  const userId = user?._id || user?.id
  const saved = user?.preferences?.theme

  useEffect(() => {
    if (!userId) return undefined
    if (saved === 'light' || saved === 'dark') applyServerTheme(saved)
    registerPersist((theme) => {
      Promise.resolve(authApi.savePreferences({ theme })).catch(() => { /* the choice still applies in this browser */ })
    })
    return () => registerPersist(null)
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
