import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Send, X } from 'lucide-react'
import { petitionReviewApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
import { useOptionalSocket } from '../../contexts/SocketContext'

export const timeLabel = (value) => {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return ''
  const sameDay = date.toDateString() === new Date().toDateString()
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return sameDay ? time : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`
}

const newClientId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0, 60)

function Bubble({ message, mine, onRetry }) {
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[85%] flex-col gap-0.5 ${mine ? 'items-end' : 'items-start'}`}>
        <div className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[13px] leading-snug shadow-sm [overflow-wrap:anywhere] ${mine ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md border border-border bg-muted text-foreground'} ${message.failed ? 'opacity-70 ring-1 ring-destructive' : ''}`}>
          {message.body}
        </div>
        <div className="flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
          {!mine && <span className="font-semibold">{message.authorName || 'Client'}</span>}
          <span>{message.pending ? 'Sending…' : timeLabel(message.createdAt)}</span>
          {message.failed && <button type="button" onClick={() => onRetry(message)} className="font-semibold text-destructive hover:underline">Retry</button>}
        </div>
      </div>
    </div>
  )
}

// The conversation about one petition between the case manager and the client-side audience, live in both directions. Enter sends, Shift+Enter adds a line.
export function PetitionFeedbackThread({ documentId, onChanged }) {
  const { user } = useAuth()
  const socket = useOptionalSocket()
  const selfId = String(user?._id || user?.id || '')
  const [messages, setMessages] = useState([])
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const bottomRef = useRef(null)

  const markRead = useCallback(() => {
    petitionReviewApi.markRead(documentId).then(() => onChanged?.()).catch(() => {})
  }, [documentId, onChanged])

  const load = useCallback(async () => {
    setStatus('loading')
    setError('')
    try {
      const res = await petitionReviewApi.messages(documentId)
      setMessages(res.data?.data?.messages || [])
      setStatus('ready')
      markRead()
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load the feedback.')
      setStatus('error')
    }
  }, [documentId, markRead])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!socket?.subscribe) return undefined
    return socket.subscribe('petition:message', (payload) => {
      if (String(payload?.documentId) !== String(documentId) || !payload.message) return
      setMessages((current) => (current.some((row) => row._id === payload.message._id) ? current : [...current, payload.message]))
      if (payload.message.authorId !== selfId) markRead()
    })
  }, [socket, documentId, selfId, markRead])

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }) }, [messages.length, status])

  const submit = useCallback(async (body, clientMessageId, tempId = `temp-${clientMessageId}`) => {
    setMessages((current) => [...current.filter((row) => row._id !== tempId), { _id: tempId, documentId, authorId: selfId, authorName: '', body, createdAt: new Date().toISOString(), pending: true, clientMessageId }])
    try {
      const res = await petitionReviewApi.send(documentId, body, clientMessageId)
      const saved = res.data?.data?.message
      setMessages((current) => {
        const rest = current.filter((row) => row._id !== tempId && row._id !== saved?._id)
        return saved ? [...rest, saved] : rest
      })
      onChanged?.()
    } catch (err) {
      setMessages((current) => current.map((row) => (row._id === tempId ? { ...row, pending: false, failed: true } : row)))
      setError(err.response?.data?.message || 'Your message could not be sent.')
    }
  }, [documentId, selfId, onChanged])

  const send = () => {
    const body = text.trim()
    if (!body) return
    setText('')
    setError('')
    submit(body, newClientId())
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-4" aria-live="polite" aria-label="Petition feedback messages">
        {status === 'loading' && <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>}
        {status === 'error' && (
          <div role="alert" className="py-6 text-center text-xs">
            <p className="text-muted-foreground">{error}</p>
            <button type="button" onClick={load} className="mt-2 font-semibold text-primary hover:underline">Try again</button>
          </div>
        )}
        {status === 'ready' && messages.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">No feedback yet. The client's comments on the petition appear here, and you can reply.</p>}
        {messages.map((message) => (
          <Bubble key={message._id} message={message} mine={String(message.authorId) === selfId} onRetry={(row) => submit(row.body, row.clientMessageId || newClientId(), row._id)} />
        ))}
        <div ref={bottomRef} />
      </div>
      {error && status === 'ready' && <p role="alert" className="px-4 pb-1 text-xs text-destructive">{error}</p>}
      <div className="shrink-0 border-t border-border p-3">
        <label className="sr-only" htmlFor={`petition-reply-${documentId}`}>Reply to the client</label>
        <div className="flex items-end gap-2">
          <textarea
            id={`petition-reply-${documentId}`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send() } }}
            rows={2}
            maxLength={4000}
            placeholder="Reply to the client…"
            className="min-w-0 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/15"
          />
          <button type="button" onClick={send} disabled={!text.trim()} className="btn-primary inline-flex items-center gap-1.5 !px-3 !py-2 text-sm disabled:opacity-50">
            <Send className="h-4 w-4" /> Send
          </button>
        </div>
      </div>
    </div>
  )
}

export function PetitionChatModal({ item, onClose, onChanged }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6" onClick={onClose}>
      <div className="flex h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl" role="dialog" aria-modal="true" aria-label={`Feedback for ${item.fileName}`} onClick={(event) => event.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground">Petition feedback</p>
            <p className="truncate text-xs text-muted-foreground">{item.fileName}{item.audienceLabel ? ` · with ${item.audienceLabel}` : ''}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <PetitionFeedbackThread documentId={item.documentId} onChanged={onChanged} />
      </div>
    </div>
  )
}
