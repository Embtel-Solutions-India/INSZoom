import { useCallback, useEffect, useState } from 'react'
import { BellRing } from 'lucide-react'
import { getPushStatus, requestPermissionAndGetToken, isPushPromptDismissed, dismissPushPrompt, IOS_INSTALL_HINT } from '../services/notificationService'

// Sticky, theme-coloured call-to-action for browser push notifications (new case-team messages arrive as push, with the
// sender's name on top). Shown only while push is NOT working for this account in this browser; gone the moment it is
// enabled. Clicking opens the browser's own permission prompt (a user gesture) and registers this browser on success.
export default function EnablePushButton() {
  const [status, setStatus] = useState('checking')
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState('')
  const [dismissed, setDismissed] = useState(isPushPromptDismissed);

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

  if (status === 'checking' || status === 'unsupported' || status === 'enabled' || dismissed) return null

  const onClick = async () => {
    setHint('')
    if (status === 'install_ios') {
      setHint(IOS_INSTALL_HINT)
      return
    }
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
      {hint && <div className="pointer-events-auto max-w-sm rounded-xl border border-border bg-popover text-popover-foreground text-sm px-4 py-3 shadow-lg">{hint}</div>}
      <div className="pointer-events-auto relative">
        <button
          type="button"
          onClick={onClick}
          disabled={busy}
          className="inline-flex items-center gap-3 rounded-full bg-primary text-primary-foreground px-7 py-4 text-base font-bold shadow-xl ring-4 ring-primary/25 hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          <BellRing className="w-6 h-6" />
          {status === 'install_ios' ? 'Get notifications on iPhone' : (busy ? 'Enabling…' : 'Enable notifications')}
        </button>
        <button
          type="button"
          onClick={() => { dismissPushPrompt(); setDismissed(true); }}
          aria-label="Close"
          title="Close"
          className="absolute -top-2 -right-2 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-popover text-popover-foreground text-base leading-none shadow hover:bg-muted"
        >
          ×
        </button>
      </div>
    </div>
  )
}
