import { useCallback, useEffect, useState } from 'react'
import { BellRing } from 'lucide-react'
import { getPushStatus, requestPermissionAndGetToken } from '../services/notificationService'

// Sticky, theme-coloured call-to-action for browser push notifications (new case-team messages arrive as push, with the
// sender's name on top). Shown only while push is NOT working for this account in this browser; gone the moment it is
// enabled. Clicking opens the browser's own permission prompt (a user gesture) and registers this browser on success.
export default function EnablePushButton() {
  const [status, setStatus] = useState('checking')
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState('')

  const refresh = useCallback(async () => {
    try { setStatus(await getPushStatus()) } catch { setStatus('unsupported') }
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    let perm
    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: 'notifications' }).then((p) => { perm = p; p.onchange = refresh }).catch(() => {})
    }
    return () => {
      window.removeEventListener('focus', refresh)
      if (perm) perm.onchange = null
    }
  }, [refresh])

  if (status === 'checking' || status === 'unsupported' || status === 'enabled') return null

  const onClick = async () => {
    setHint('')
    if (status === 'denied') {
      setHint("Notifications are blocked for this site. Allow them in your browser's site settings, then click again.")
      return
    }
    setBusy(true)
    try {
      const token = await requestPermissionAndGetToken()
      if (!token && typeof Notification !== 'undefined' && Notification.permission === 'denied') {
        setHint("Notifications were blocked. Allow them in your browser's site settings to turn them on.")
      }
    } finally {
      setBusy(false)
      refresh()
    }
  }

  return (
    <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-40 flex flex-col items-end gap-2 pointer-events-none">
      {hint && <div className="pointer-events-auto max-w-xs rounded-lg border border-border bg-popover text-popover-foreground text-xs px-3 py-2 shadow-lg">{hint}</div>}
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-2.5 text-sm font-semibold shadow-lg hover:opacity-90 transition-opacity disabled:opacity-60"
      >
        <BellRing className="w-4 h-4" />
        {busy ? 'Enabling…' : 'Enable notifications'}
      </button>
    </div>
  )
}
