import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { initializeNotifications } from '../services/notificationService'

// Mirrors the other portals' behavior exactly: on an authenticated mount we
// only re-register an ALREADY-granted token (initializeNotifications never
// prompts). The browser permission prompt must come from an explicit user
// action — see notificationService.requestPermissionAndGetToken's own
// comment — so it is deliberately not called here.
export default function usePushNotifications() {
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isAuthenticated) return
    initializeNotifications().catch(() => {})
  }, [isAuthenticated])

  // The service worker posts this when a background notification is clicked
  // and an app tab is already open — routing in-app beats a full reload.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined
    const onMessage = (event) => {
      if (event.data?.type === 'notification-click' && event.data.link) {
        navigate(event.data.link)
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [navigate])
}
