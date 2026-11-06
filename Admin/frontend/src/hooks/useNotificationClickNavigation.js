import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

// The service worker posts { type: 'notification-click', link } when a background notification is clicked while a tab of this app is
// already open. Without a listener the click only focused the tab; this opens the notification's page in-app (no reload). Unknown
// paths fall through to the app's catch-all route, so a bad link can never produce a blank page.
export default function useNotificationClickNavigation() {
  const navigate = useNavigate()
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return undefined
    const onMessage = (event) => {
      const link = event.data?.type === 'notification-click' ? event.data.link : null
      if (typeof link === 'string' && link.startsWith('/')) navigate(link)
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [navigate])
}
