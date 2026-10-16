import { useEffect, useRef } from 'react'
import { useOptionalSocket } from '../contexts/SocketContext'
import { useOptionalAuth } from '../contexts/AuthContext'

// Live updates for an open USCIS form: when ANOTHER team member changes the form, `onRemoteChange(event)` is called (once, after a short pause so a burst of saves is one
// refresh) so the screen can re-read the form. It is a pure bonus: with no socket (no provider, not connected, access refused) nothing happens and the form works exactly as
// before. It also asks for one catch-up refresh after the connection comes back, because events sent while offline are not replayed.
export const LIVE_EVENT = 'caseForm:updated'
export const LIVE_DEBOUNCE_MS = 400

export function useCaseFormLiveUpdates({ caseId, caseFormId, onRemoteChange }) {
  const socketContext = useOptionalSocket()
  const auth = useOptionalAuth()
  const socket = socketContext?.socket || null
  const connected = Boolean(socketContext?.connected)
  const myId = String(auth?.user?._id || auth?.user?.id || '')
  const callbackRef = useRef(onRemoteChange)
  callbackRef.current = onRemoteChange
  const hadConnection = useRef(false)

  useEffect(() => {
    if (!socket || !connected || !caseId || !caseFormId) return undefined
    let timer = null
    let latest = null
    const fire = (event) => {
      latest = event
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        try { callbackRef.current?.(latest) } catch { /* a refresh problem must never break the form */ }
      }, LIVE_DEBOUNCE_MS)
    }
    const handler = (event) => {
      if (!event || String(event.caseFormId) !== String(caseFormId)) return
      if (myId && event.actorId && String(event.actorId) === myId) return // my own save: this screen already has it
      fire(event)
    }
    try { socket.emit('caseForm:join', { caseId, caseFormId }, () => {}) } catch { /* no live updates; the form is unaffected */ }
    socket.on(LIVE_EVENT, handler)
    // reconnected after a drop: anything that happened meanwhile was missed, so refresh once
    if (hadConnection.current) fire({ caseFormId, reconnect: true })
    hadConnection.current = true
    return () => {
      if (timer) clearTimeout(timer)
      socket.off(LIVE_EVENT, handler)
      try { socket.emit('caseForm:leave', { caseFormId }) } catch { /* nothing to clean up */ }
    }
  }, [socket, connected, caseId, caseFormId, myId])
}
