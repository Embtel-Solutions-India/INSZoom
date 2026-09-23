import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Send, CornerDownRight, Paperclip, X, FileText, Clock, CheckCheck, Download, MessageSquare } from 'lucide-react'
import { feedbackApi } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { useSocket } from '../contexts/SocketContext'

// The case team's chat with the assigned attorney — backed by
// Backend/src/models/Feedback.js (models/Message.js + Conversation.js are
// the CLIENT-inclusive system used by Messaging.jsx and are never touched
// here; the client is never a participant of this thread). Styled and
// behaves like Messaging.jsx (bubbles, attachments, live socket updates)
// but is intentionally its own, smaller implementation — Feedback threads
// are two-party/staff-only and don't need Messaging.jsx's presence/typing/
// infinite-scroll machinery.

const idOf = (ref) => (ref && typeof ref === 'object' ? ref._id : ref)

function getInitials(name) {
  if (!name) return '?'
  return name.trim().split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase()
}

function formatFileSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatTime(date) {
  return new Date(date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function dayLabel(date) {
  const d = new Date(date)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { month: 'long', day: 'numeric', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined })
}

function authorName(item) {
  const author = item.authorId || {}
  return author.displayName || author.name || author.email || 'Unknown'
}

function authorRoleLabel(item) {
  const role = item.authorRole || item.authorId?.role || ''
  return role.replace(/_/g, ' ')
}

// Attachment bytes are served through an authenticated endpoint - fetched
// once as a blob per component instance and cached for the session, same
// approach as Messaging.jsx's loadAttachmentBlobUrl.
function useAttachmentBlob(caseId) {
  const cacheRef = useRef(new Map())
  return useCallback(
    async (feedbackId, attachmentId) => {
      const key = `${feedbackId}:${attachmentId}`
      if (cacheRef.current.has(key)) return cacheRef.current.get(key)
      const response = await feedbackApi.downloadAttachment(caseId, feedbackId, attachmentId)
      const url = URL.createObjectURL(response.data)
      cacheRef.current.set(key, url)
      return url
    },
    [caseId]
  )
}

function AttachmentChip({ caseId, feedbackId, attachment, loadBlob }) {
  const isImage = (attachment.mimeType || '').startsWith('image/')
  const [url, setUrl] = useState(null)
  const [status, setStatus] = useState('idle')
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const ensureLoaded = useCallback(async () => {
    if (url) return url
    setStatus('loading')
    try {
      const loaded = await loadBlob(feedbackId, attachment._id)
      setUrl(loaded)
      setStatus('ready')
      return loaded
    } catch {
      setStatus('error')
      return null
    }
  }, [url, loadBlob, feedbackId, attachment._id])

  useEffect(() => {
    if (isImage) ensureLoaded()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isImage])

  const download = async (event) => {
    event?.stopPropagation()
    const loaded = await ensureLoaded()
    if (!loaded) return
    const link = document.createElement('a')
    link.href = loaded
    link.download = attachment.originalName || 'attachment'
    link.click()
  }

  if (isImage) {
    return (
      <>
        <button
          type="button"
          onClick={() => (url ? setLightboxOpen(true) : ensureLoaded())}
          className="block w-40 h-32 rounded-xl overflow-hidden border border-border bg-muted hover:brightness-95 transition"
        >
          {status === 'ready' ? (
            <img src={url} alt={attachment.originalName} className="w-full h-full object-cover" />
          ) : (
            <span className="w-full h-full flex items-center justify-center text-[11px] text-muted-foreground">
              {status === 'error' ? "Couldn't load" : 'Loading…'}
            </span>
          )}
        </button>
        {lightboxOpen && (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6" onClick={() => setLightboxOpen(false)}>
            <img src={url} alt={attachment.originalName} className="max-w-full max-h-full rounded-lg shadow-2xl" onClick={(e) => e.stopPropagation()} />
            <div className="absolute top-5 right-5 flex items-center gap-4">
              <button type="button" onClick={download} title="Download" className="text-white/80 hover:text-white">
                <Download className="w-5 h-5" />
              </button>
              <button type="button" onClick={() => setLightboxOpen(false)} title="Close" className="text-white/80 hover:text-white">
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <button
      type="button"
      onClick={download}
      disabled={status === 'loading'}
      className="flex items-center gap-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1.5 rounded-full hover:bg-blue-100 transition disabled:opacity-60"
    >
      <FileText className="w-3.5 h-3.5" />
      {attachment.originalName}
      {attachment.fileSize ? <span className="text-blue-400">· {formatFileSize(attachment.fileSize)}</span> : null}
    </button>
  )
}

function Bubble({ item, caseId, selfId, loadBlob, onReply, onRetry }) {
  const outgoing = String(idOf(item.authorId)) === String(selfId)
  const isPending = Boolean(item.__pending)
  const isFailed = Boolean(item.__failed)
  const readByOthers = (item.readBy || []).filter((r) => String(idOf(r.userId)) !== String(idOf(item.authorId)))
  const parent = item.__parent

  const avatarClasses = outgoing ? 'bg-blue-500 text-white' : 'bg-muted text-muted-foreground'
  const bubbleClasses = outgoing
    ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white'
    : 'bg-secondary text-foreground border border-border'

  return (
    <div className={`flex flex-col ${outgoing ? 'items-end' : 'items-start'} group`}>
      {parent && (
        <div className={`mb-1 px-1 max-w-[78%] ${outgoing ? 'text-right' : ''}`}>
          <p className="text-[11px] text-muted-foreground flex items-center gap-1 justify-end">
            <CornerDownRight className="w-3 h-3 shrink-0" />
            <span className="truncate">Replying to {authorName(parent)}: {parent.message ? parent.message.slice(0, 60) : 'an attachment'}</span>
          </p>
        </div>
      )}
      <div className={`flex items-end gap-2 max-w-[78%] ${outgoing ? 'flex-row-reverse' : ''}`}>
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 shadow-sm ${avatarClasses}`} title={authorName(item)}>
          {getInitials(authorName(item))}
        </div>
        <div className="flex flex-col gap-1.5">
          {!outgoing && (
            <p className="text-[11px] font-semibold text-muted-foreground px-1">
              {authorName(item)}{authorRoleLabel(item) ? ` · ${authorRoleLabel(item)}` : ''}
            </p>
          )}
          {item.attachments?.length > 0 && (
            <div className={`flex flex-wrap gap-1.5 ${isPending ? 'opacity-60' : ''}`}>
              {item.attachments.map((attachment, index) => (
                <AttachmentChip key={attachment._id || index} caseId={caseId} feedbackId={item._id} attachment={attachment} loadBlob={loadBlob} />
              ))}
            </div>
          )}
          {item.message && (
            <div
              onClick={isFailed ? () => onRetry(item) : undefined}
              className={`rounded-2xl ${outgoing ? 'rounded-tr-md' : 'rounded-tl-md'} px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm transition-opacity ${bubbleClasses} ${isPending ? 'opacity-60' : ''} ${isFailed ? 'ring-2 ring-red-300 cursor-pointer' : ''}`}
            >
              {item.message}
            </div>
          )}
          <div className={`flex items-center gap-2 px-1 ${outgoing ? 'justify-end' : ''}`}>
            <span className="text-[11px] text-muted-foreground">{formatTime(item.createdAt)}</span>
            {!isPending && !isFailed && (
              <button type="button" onClick={() => onReply(item)} className="text-[11px] font-semibold text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity hover:underline">
                Reply
              </button>
            )}
          </div>
        </div>
      </div>
      {outgoing && (
        <div className="mt-0.5 mr-10 flex items-center gap-1 text-[11px] min-h-[14px]">
          {isFailed ? (
            <button type="button" onClick={() => onRetry(item)} className="text-red-500 font-medium hover:underline">
              Failed to send · Tap to retry
            </button>
          ) : isPending ? (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Clock className="w-3 h-3" /> Sending…
            </span>
          ) : (
            <span className={`flex items-center gap-1 ${readByOthers.length > 0 ? 'text-blue-500' : 'text-muted-foreground'}`}>
              <CheckCheck className="w-3.5 h-3.5" /> {readByOthers.length > 0 ? 'Seen' : 'Sent'}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export default function CaseFeedbackChat({ caseId }) {
  const { user } = useAuth()
  const { subscribe } = useSocket()
  const selfId = user?._id || user?.id
  const [items, setItems] = useState(null)
  const [message, setMessage] = useState('')
  const [files, setFiles] = useState([])
  const [replyTo, setReplyTo] = useState(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const dragCounterRef = useRef(0)
  const fileInputRef = useRef(null)
  const scrollRef = useRef(null)
  const loadBlob = useAttachmentBlob(caseId)

  const load = useCallback(
    () =>
      feedbackApi
        .list(caseId)
        .then(({ data }) => setItems(data.feedback || []))
        .catch((err) => setError(err.response?.data?.message || 'Could not load messages.')),
    [caseId]
  )

  useEffect(() => {
    setItems(null)
    setError('')
    feedbackApi.markRead(caseId).catch(() => {}).then(load)
  }, [caseId, load])

  // Live append — see feedback.service.js's notifyRecipients. Only ever
  // fires for messages authored by the OTHER party (the backend only emits
  // to recipients, never back to the author), so no dedupe race against our
  // own optimistic send below.
  useEffect(() => {
    const unsubscribe = subscribe('feedback:new', (incoming) => {
      if (String(incoming.caseId) !== String(caseId)) return
      setItems((current) => {
        if (!current) return current
        if (current.some((item) => String(item._id) === String(incoming._id))) return current
        return [...current, incoming]
      })
      feedbackApi.markRead(caseId).catch(() => {})
    })
    return unsubscribe
  }, [subscribe, caseId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [items?.length])

  const addFiles = (fileList) => {
    setFiles((current) => [...current, ...Array.from(fileList || [])])
  }
  const onFileInputChange = (event) => {
    addFiles(event.target.files)
    event.target.value = ''
  }
  const removeFile = (index) => setFiles((current) => current.filter((_, i) => i !== index))

  const onDragEnter = (event) => {
    event.preventDefault()
    dragCounterRef.current += 1
    setIsDraggingFiles(true)
  }
  const onDragLeave = (event) => {
    event.preventDefault()
    dragCounterRef.current -= 1
    if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setIsDraggingFiles(false) }
  }
  const onDragOver = (event) => event.preventDefault()
  const onDrop = (event) => {
    event.preventDefault()
    dragCounterRef.current = 0
    setIsDraggingFiles(false)
    addFiles(event.dataTransfer.files)
  }

  const sendMessage = async (overrideItem = null) => {
    const text = overrideItem ? overrideItem.message : message.trim()
    const attachFiles = overrideItem ? overrideItem.__files : files
    const parent = overrideItem ? overrideItem.__parent : replyTo
    if (!text && !attachFiles?.length) return

    const tempId = overrideItem?._id || `temp-${Date.now()}`
    const optimistic = {
      _id: tempId,
      caseId,
      authorId: { _id: selfId, name: user?.name, displayName: user?.displayName, email: user?.email, role: user?.role },
      authorRole: user?.role,
      message: text,
      parentFeedbackId: parent?._id || null,
      __parent: parent || null,
      attachments: (attachFiles || []).filter((f) => (f.type || '').startsWith('image/')).map((f) => ({ originalName: f.name, mimeType: f.type, fileSize: f.size, __localUrl: URL.createObjectURL(f) })),
      createdAt: overrideItem?.createdAt || new Date().toISOString(),
      readBy: [],
      __pending: true,
      __files: attachFiles,
    }

    setItems((current) => {
      const withoutOld = (current || []).filter((item) => item._id !== tempId)
      return [...withoutOld, optimistic]
    })
    if (!overrideItem) {
      setMessage('')
      setFiles([])
      setReplyTo(null)
    }
    setSending(true)
    setError('')
    try {
      const { data } = parent
        ? await feedbackApi.reply(caseId, parent._id, text, attachFiles)
        : await feedbackApi.send(caseId, text, attachFiles)
      const saved = data.feedback || data
      setItems((current) => (current || []).map((item) => (item._id === tempId ? saved : item)))
    } catch (err) {
      setError(err.response?.data?.message || 'Your message could not be sent.')
      setItems((current) => (current || []).map((item) => (item._id === tempId ? { ...item, __pending: false, __failed: true } : item)))
    } finally {
      setSending(false)
    }
  }

  const retry = (item) => sendMessage(item)

  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
  }

  // Flat chronological list (not nested-by-thread) — reads like a real chat
  // rather than the old indented-reply-list layout; a reply still shows a
  // small "Replying to X" caption above its own bubble.
  const timeline = useMemo(() => {
    if (!items) return []
    const byId = new Map(items.map((item) => [String(item._id), item]))
    return [...items]
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map((item) => ({ ...item, __parent: item.__parent || (item.parentFeedbackId ? byId.get(String(item.parentFeedbackId)) : null) }))
  }, [items])

  let lastDay = null

  return (
    <div
      className="flex flex-col h-[calc(100vh-260px)] min-h-[420px]"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="card !p-0 flex-1 flex flex-col overflow-hidden relative">
        {isDraggingFiles && (
          <div className="absolute inset-0 z-10 bg-blue-500/10 border-2 border-dashed border-blue-400 rounded-2xl flex items-center justify-center pointer-events-none">
            <p className="text-sm font-semibold text-blue-600 bg-card px-4 py-2 rounded-lg shadow">Drop files to attach</p>
          </div>
        )}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4">
          {items === null ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : timeline.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-2">
              <MessageSquare className="w-8 h-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No messages with the attorney yet. Start the conversation below.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {timeline.map((item) => {
                const day = dayLabel(item.createdAt)
                const showDivider = day !== lastDay
                lastDay = day
                return (
                  <div key={item._id}>
                    {showDivider && (
                      <div className="flex items-center gap-3 my-3">
                        <div className="flex-1 h-px bg-border" />
                        <span className="text-[11px] font-semibold text-muted-foreground">{day}</span>
                        <div className="flex-1 h-px bg-border" />
                      </div>
                    )}
                    <Bubble item={item} caseId={caseId} selfId={selfId} loadBlob={loadBlob} onReply={setReplyTo} onRetry={retry} />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="card mt-3 space-y-2 shrink-0">
        {replyTo && (
          <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-1.5">
            <p className="text-xs text-muted-foreground truncate">Replying to <span className="font-semibold">{authorName(replyTo)}</span></p>
            <button onClick={() => setReplyTo(null)} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        )}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {files.map((file, index) => (
              <span key={`${file.name}-${index}`} className="inline-flex items-center gap-1.5 text-xs bg-muted border border-border rounded-lg px-2.5 py-1.5">
                <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                {file.name}
                <button onClick={() => removeFile(index)} aria-label={`Remove ${file.name}`}><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
        )}
        <textarea
          rows={2}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Message the attorney… (Enter to send, Shift+Enter for a new line)"
          className="input-field"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center justify-between">
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onFileInputChange} />
          <button onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
            <Paperclip className="w-3.5 h-3.5" /> Attach
          </button>
          <button
            onClick={() => sendMessage()}
            disabled={sending || (!message.trim() && !files.length)}
            className="btn-primary flex items-center gap-1.5 text-xs disabled:opacity-50"
          >
            {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {replyTo ? 'Send reply' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
