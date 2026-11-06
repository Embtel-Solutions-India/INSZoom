import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Target, Trophy, X } from 'lucide-react'
import api from '../services/api'
import { EVERYDAY_CHANNEL, announceEverydayChange } from '../utils/everyday'

// The sticky box in the top-right corner of EVERY page: 21:00 IST "Write your today's goal", 06:30 IST "Don't forget to write what you achieved today". It is fixed
// to the viewport, so changing pages never moves it. What to show (and whether it was crossed or already written) is decided by the server per person, so the cross
// button hides it on every screen / tab and it does not come back on refresh; the next one appears only at its next scheduled time.
const BOXES = {
  plan: { title: "Write your today's goal", text: 'Set your goals for today in the Everyday plan.', Icon: Target, tone: 'bg-primary/10 text-primary', link: '/eod-reports?section=plan' },
  report: { title: "Don't forget your achievements", text: 'Write what you achieved today in the Everyday report.', Icon: Trophy, tone: 'bg-green-100 text-green-700', link: '/eod-reports?section=report' },
}
const POLL_MS = 60 * 1000

export default function EverydayPrompt() {
  const navigate = useNavigate()
  const [prompts, setPrompts] = useState({ plan: false, report: false })
  const stopped = useRef(false)

  const refresh = useCallback(async () => {
    if (stopped.current) return
    try {
      const response = await api.get('/reports/everyday/me')
      setPrompts(response.data?.data?.prompts || { plan: false, report: false })
    } catch (error) {
      // Not on the internal team (403) or signed out: never show anything, and stop asking.
      if ([401, 403].includes(error.response?.status)) { stopped.current = true; setPrompts({ plan: false, report: false }) }
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, POLL_MS)
    const onFocus = () => { if (document.visibilityState !== 'hidden') refresh() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('everyday-updated', refresh)
    let channel = null
    try { channel = new BroadcastChannel(EVERYDAY_CHANNEL); channel.onmessage = refresh } catch { /* polling covers it */ }
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('everyday-updated', refresh)
      channel?.close()
    }
  }, [refresh])

  const dismiss = async (kind) => {
    setPrompts((current) => ({ ...current, [kind]: false })) // gone at once; the server remembers it
    try {
      await api.post('/reports/everyday/me/dismiss', { kind })
    } catch { /* it simply shows again at the next check */ }
    announceEverydayChange()
  }

  const open = (kind) => navigate(BOXES[kind].link)
  const visible = Object.keys(BOXES).filter((kind) => prompts[kind])
  if (!visible.length) return null
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[10000] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-3" data-testid="everyday-prompts">
      {visible.map((kind) => {
        const { title, text, Icon, tone } = BOXES[kind]
        return (
          <div key={kind} role="status" data-testid={`everyday-prompt-${kind}`} className="pointer-events-auto flex items-start gap-3 rounded-xl border border-border bg-card p-3 shadow-lg">
            <button type="button" onClick={() => open(kind)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone}`}><Icon className="h-5 w-5" /></span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">{title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{text}</span>
              </span>
            </button>
            <button type="button" onClick={() => dismiss(kind)} aria-label={`Dismiss: ${title}`} className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
