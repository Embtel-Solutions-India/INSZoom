import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Send, CornerUpLeft, Paperclip, X, CheckCheck, Clock, MessageSquare } from 'lucide-react'
import api, { attorneyApi } from '../services/api'
import { attachmentProblem, formatFileSize, isChunkedFile, MAX_ATTACHMENTS_PER_MESSAGE, uploadFileInChunks } from '../utils/chunkedUpload'
import AttachmentViewer, { FileTypeIcon, fileKind } from './AttachmentViewer'
import MessageAttachment from './MessageAttachments'
import { useAuth } from '../auth/AuthContext'
import { useSocket } from '../context/SocketContext'

// The attorney's ONLY messaging surface — a staff-only thread (attorney <->
// case manager/team lead/admin) backed by models/Feedback.js, never the
// client-inclusive Conversation system. Used by both /messages/:caseId (the
// cross-case hub) and the per-case Feedback tab. Styled and behaves like the
// Admin/CRM portal's client Messaging UI (bubbles, attachments, live socket
// updates) via Admin/frontend/src/components/CaseFeedbackChat.jsx, which
// this mirrors — same backend thread, same UX, themed for this portal.

const idOf = (ref) => (ref && typeof ref === 'object' ? ref._id : ref)

function getInitials(name) {
  if (!name) return '?'
  return name.trim().split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase()
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

const RETRY_DELAYS_MS = [2000, 5000, 10000]

const newClientMessageId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

// Worth retrying: the request never got an answer (offline / timeout) or the server hit an error. A 4xx is final.
const isRetryable = (err) => !err.response || err.response.status >= 500 || err.response.status === 408 || err.response.status === 429

async function postWithRetry(post) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await post()
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length || !isRetryable(err)) throw err
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]))
    }
  }
}

// Downloads a received attachment as a Blob. Small ones are kept so a thumbnail and
// the viewer do not fetch the same file twice; big ones are never held on to.
const BLOB_CACHE_MAX_BYTES = 25 * 1024 * 1024

function useAttachmentBlob(caseId) {
  const cacheRef = useRef(new Map())
  return useCallback(
    async (feedbackId, attachmentId, config) => {
      const key = `${feedbackId}:${attachmentId}`
      if (cacheRef.current.has(key)) return cacheRef.current.get(key)
      const response = await attorneyApi.downloadAttachment(caseId, feedbackId, attachmentId, config)
      if (response.data.size <= BLOB_CACHE_MAX_BYTES) cacheRef.current.set(key, response.data)
      return response.data
    },
    [caseId]
  )
}

// The chunked uploader owns /chunked-uploads/* calls; this wrapper only notes the
// uploadId the moment the server hands it out, so a failed upload can be resumed
// (resumeUploadId) instead of restarted when the message is retried.
function trackingApi(entry) {
  return {
    get: (...args) => api.get(...args),
    put: (...args) => api.put(...args),
    delete: (...args) => api.delete(...args),
    post: async (url, ...rest) => {
      const response = await api.post(url, ...rest)
      if (url === '/chunked-uploads' && response.data?.uploadId) entry.uploadId = response.data.uploadId
      return response
    },
  }
}

function Bubble({ item, selfId, loadBlob, onOpenAttachment, onCancelUpload, onReply, onRetry }) {
  const outgoing = String(idOf(item.authorId)) === String(selfId)
  const isPending = Boolean(item.__pending)
  const isFailed = Boolean(item.__failed)
  const readByOthers = (item.readBy || []).filter((r) => String(idOf(r.userId)) !== String(idOf(item.authorId)))
  const parent = item.__parent
  const seen = readByOthers.length > 0
  // A big file still going up: show a clock instead of the delivered ticks.
  const uploading = isPending && (item.attachments || []).some((a) => a.__upload && (a.__upload.status === 'queued' || a.__upload.status === 'uploading'))

  const avatarClasses = outgoing ? 'bg-primary/80 text-primary-foreground dark:bg-primary/25 dark:text-primary' : 'bg-secondary text-muted-foreground'
  // Dark mode: own bubbles are a muted tint of the brand colour with light text (the solid brand colour is too bright for a large surface).
  const bubbleClasses = outgoing ? 'bg-primary/80 text-primary-foreground dark:bg-primary/20 dark:text-foreground dark:border dark:border-primary/30' : 'bg-secondary text-foreground border border-border'
  const metaClasses = outgoing ? 'text-primary-foreground/70 dark:text-muted-foreground' : 'text-muted-foreground'
  const quoteClasses = outgoing ? 'bg-black/20 border-l-primary-foreground/60 dark:border-l-primary' : 'bg-background border-l-primary'

  return (
    <div className={`flex flex-col ${outgoing ? 'items-end' : 'items-start'} group`}>
      <div className={`flex items-end gap-2 max-w-[88%] sm:max-w-[78%] ${outgoing ? 'flex-row-reverse' : ''}`}>
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 shadow-sm ${avatarClasses}`} title={authorName(item)}>
          {getInitials(authorName(item))}
        </div>
        <div className="flex flex-col gap-1.5 min-w-0">
          {!outgoing && (
            <p className="text-[11px] font-semibold text-muted-foreground px-1">
              {authorName(item)}{authorRoleLabel(item) ? ` · ${authorRoleLabel(item)}` : ''}
            </p>
          )}
          {(item.message || item.attachments?.length > 0) && (
            <div
              onClick={isFailed ? () => onRetry(item) : undefined}
              className={`rounded-2xl ${outgoing ? 'rounded-tr-md' : 'rounded-tl-md'} px-3 pt-2 pb-1.5 text-[13px] leading-snug shadow-sm ${bubbleClasses} ${isFailed ? 'ring-2 ring-destructive/50 cursor-pointer' : ''}`}
            >
              {parent && (
                <div className={`mb-1.5 rounded-lg border-l-4 px-2.5 py-1.5 ${quoteClasses}`}>
                  <p className={`text-[11px] font-semibold truncate ${outgoing ? 'text-primary-foreground dark:text-primary' : 'text-primary'}`}>{authorName(parent)}</p>
                  <p className={`text-[12px] line-clamp-2 break-words ${outgoing ? 'text-primary-foreground/80 dark:text-muted-foreground' : 'text-muted-foreground'}`}>
                    {parent.message || 'Attachment'}
                  </p>
                </div>
              )}
              {item.attachments?.length > 0 && (
                <div className={`flex flex-wrap gap-1.5 ${item.message ? 'mb-1.5' : ''}`}>
                  {item.attachments.map((attachment, index) => (
                    <MessageAttachment
                      key={attachment._id || `${attachment.originalName}-${index}`}
                      attachment={attachment}
                      feedbackId={item.__pending || item.__failed ? null : item._id}
                      loadBlob={loadBlob}
                      onOpen={onOpenAttachment}
                      onCancel={item.__pending ? (a) => onCancelUpload(item._id, a.__localFile) : undefined}
                    />
                  ))}
                </div>
              )}
              {item.message && <p className="whitespace-pre-wrap break-words">{item.message}</p>}
              {/* Time (and delivery state for our own messages) at the bottom-right of the box, like WhatsApp */}
              <div className={`mt-0.5 flex items-center justify-end gap-1 whitespace-nowrap pr-1 text-[10px] leading-none ${metaClasses}`}>
                <span>{formatTime(item.createdAt)}</span>
                {outgoing && uploading && <Clock strokeWidth={2.25} className="w-3.5 h-3.5 shrink-0" aria-label="Uploading" />}
                {outgoing && !isFailed && !uploading && (
                  <CheckCheck strokeWidth={2.25} className={`w-4 h-4 shrink-0 overflow-visible ${seen ? 'text-sky-300' : ''}`} aria-label={seen ? 'Seen' : 'Sent'} />
                )}
              </div>
            </div>
          )}
        </div>
        {!isFailed && (
          <button
            type="button"
            onClick={() => onReply(item)}
            title="Reply"
            aria-label="Reply"
            className="mb-1 p-1.5 rounded-full text-muted-foreground hover:text-primary hover:bg-secondary sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition-opacity shrink-0"
          >
            <CornerUpLeft className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {outgoing && isFailed && (
        <button type="button" onClick={() => onRetry(item)} className="mt-0.5 mr-10 text-[11px] text-destructive font-medium hover:underline">
          Failed to send · Tap to retry
        </button>
      )}
    </div>
  )
}

// `fill` = chat-pane mode: stretches to the height of its parent (the split
// Messages page) with a flat, borderless messages area and a docked composer,
// instead of the stand-alone card + card layout the per-case Feedback tab uses.
export default function MessageThread({ caseId, fill = false }) {
  const { user } = useAuth()
  const { subscribe } = useSocket()
  const selfId = user?._id || user?.id
  const [items, setItems] = useState(null)
  const [message, setMessage] = useState('')
  const [files, setFiles] = useState([])
  const [replyTo, setReplyTo] = useState(null)
  const [error, setError] = useState('')
  const [attachNotice, setAttachNotice] = useState('')
  const [viewing, setViewing] = useState(null)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const dragCounterRef = useRef(0)
  const fileInputRef = useRef(null)
  const scrollRef = useRef(null)
  const textareaRef = useRef(null)
  const sendQueueRef = useRef(Promise.resolve())
  // Per-File upload bookkeeping that must survive a failed send so Retry reuses it:
  // { uploadId, done, progress, cancelled, controller }.
  const uploadsRef = useRef(new WeakMap())
  const loadBlob = useAttachmentBlob(caseId)

  const load = useCallback(
    () =>
      attorneyApi
        .feedback(caseId)
        .then(({ data }) => setItems(data.feedback || []))
        .catch((err) => setError(err.response?.data?.message || 'Could not load messages.')),
    [caseId]
  )

  useEffect(() => {
    setItems(null)
    setError('')
    attorneyApi.markFeedbackRead(caseId).catch(() => {}).then(load)
  }, [caseId, load])

  useEffect(() => {
    const unsubscribe = subscribe('feedback:new', (incoming) => {
      if (String(incoming.caseId) !== String(caseId)) return
      setItems((current) => {
        if (!current) return current
        if (current.some((item) => String(item._id) === String(incoming._id))) return current
        return [...current, incoming]
      })
      attorneyApi.markFeedbackRead(caseId).catch(() => {})
    })
    return unsubscribe
  }, [subscribe, caseId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [items?.length])

  // Single-line composer that grows with its content (up to its max-height).
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [message])

  // Client-side guards (the backend enforces the same): empty / over-400 MB files are
  // refused with a message, and a message carries at most MAX_ATTACHMENTS_PER_MESSAGE files.
  const addFiles = (fileList) => {
    const incoming = Array.from(fileList || [])
    if (!incoming.length) return
    const problems = []
    let accepted = []
    incoming.forEach((file) => {
      const problem = attachmentProblem(file)
      if (problem) problems.push(problem)
      else accepted.push(file)
    })
    const room = Math.max(MAX_ATTACHMENTS_PER_MESSAGE - files.length, 0)
    if (accepted.length > room) {
      problems.push(`You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`)
      accepted = accepted.slice(0, room)
    }
    setAttachNotice(problems.join(' '))
    if (accepted.length) setFiles([...files, ...accepted])
  }
  const onFileInputChange = (event) => { addFiles(event.target.files); event.target.value = '' }
  const removeFile = (index) => { setAttachNotice(''); setFiles((current) => current.filter((_, i) => i !== index)) }
  const openLocalFile = (file) => setViewing({ name: file.name, size: file.size, mimeType: file.type, getBlob: async () => file })

  const onDragEnter = (event) => { event.preventDefault(); dragCounterRef.current += 1; setIsDraggingFiles(true) }
  const onDragLeave = (event) => {
    event.preventDefault()
    dragCounterRef.current -= 1
    if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setIsDraggingFiles(false) }
  }
  const onDragOver = (event) => event.preventDefault()
  const onDrop = (event) => { event.preventDefault(); dragCounterRef.current = 0; setIsDraggingFiles(false); addFiles(event.dataTransfer.files) }

  const entryOf = (file) => {
    let entry = uploadsRef.current.get(file)
    if (!entry) { entry = {}; uploadsRef.current.set(file, entry) }
    return entry
  }

  const optimisticAttachment = (file) => {
    const entry = entryOf(file)
    const upload = isChunkedFile(file) ? (entry.done ? { status: 'done', progress: 1 } : { status: 'queued', progress: entry.progress || 0 }) : null
    return { originalName: file.name, mimeType: file.type, fileSize: file.size, __localFile: file, __upload: upload }
  }

  // X on a big file that is still uploading: stop it and take it out of the message
  // (the rest of the message still goes; an attachment-only message with nothing
  // left disappears).
  const cancelUpload = (tempId, file) => {
    if (!file) return
    const entry = entryOf(file)
    entry.cancelled = true
    if (entry.controller) entry.controller.abort()
    else if (entry.uploadId) api.delete(`/chunked-uploads/${entry.uploadId}`).catch(() => {})
    setItems((current) => (current || []).flatMap((item) => {
      if (item._id !== tempId) return [item]
      const remaining = (item.__files || []).filter((f) => f !== file)
      if (!item.message && !remaining.length) return []
      return [{ ...item, __files: remaining, attachments: (item.attachments || []).filter((a) => a.__localFile !== file) }]
    }))
  }

  // The message shows up in the thread (as sent) the moment it is submitted;
  // delivery to the backend happens in the background. Sends go through one
  // queue so they reach the server in the order they were typed, and the
  // composer is never locked while one is in flight. Big files (> 4 MB) are
  // uploaded in chunks first (progress is drawn on their chip), then the message
  // is posted carrying their uploadIds; small files ride in the post itself.
  // A failed post is retried automatically (network / 5xx only); once those
  // retries run out - or an upload fails - the bubble turns red and can be
  // re-sent by tapping it. Every attempt carries the same clientMessageId (so
  // the backend never stores a message twice) and a re-send reuses the uploads
  // that already finished and resumes the partial one.
  const sendMessage = (overrideItem = null) => {
    const text = overrideItem ? overrideItem.message : message.trim()
    const attachFiles = (overrideItem ? overrideItem.__files || [] : files).filter((file) => !entryOf(file).cancelled)
    const parent = overrideItem ? overrideItem.__parent : replyTo
    if (!text && !attachFiles.length) return

    const tempId = overrideItem?._id || `temp-${Date.now()}`
    const clientMessageId = overrideItem?.__clientMessageId || newClientMessageId()
    const optimistic = {
      _id: tempId,
      caseId,
      authorId: { _id: selfId, name: user?.name, displayName: user?.displayName, email: user?.email, role: user?.role },
      authorRole: user?.role,
      message: text,
      parentFeedbackId: parent?._id || null,
      __parent: parent || null,
      attachments: attachFiles.map(optimisticAttachment),
      createdAt: overrideItem?.createdAt || new Date().toISOString(),
      readBy: [],
      __pending: true,
      __files: attachFiles,
      __clientMessageId: clientMessageId,
    }

    setItems((current) => [...(current || []).filter((item) => item._id !== tempId), optimistic])
    if (!overrideItem) { setMessage(''); setFiles([]); setReplyTo(null) }
    setError('')
    setAttachNotice('')

    const patchUpload = (file, upload) =>
      setItems((current) => (current || []).map((item) => (item._id !== tempId ? item : { ...item, attachments: (item.attachments || []).map((a) => (a.__localFile === file ? { ...a, __upload: upload } : a)) })))

    const post = (smallFiles, uploadIds) => (parent
      ? attorneyApi.replyFeedback(caseId, parent._id, text, smallFiles, clientMessageId, uploadIds)
      : attorneyApi.sendFeedback(caseId, text, smallFiles, clientMessageId, uploadIds))

    // Stage 1: chunk-upload every big file not already uploaded. Stage 2: post the message.
    const deliver = async () => {
      const live = () => attachFiles.filter((file) => !entryOf(file).cancelled)
      for (const file of live().filter(isChunkedFile)) {
        const entry = entryOf(file)
        if (entry.cancelled) continue
        if (entry.done && entry.uploadId) { patchUpload(file, { status: 'done', progress: 1 }); continue }
        const controller = new AbortController()
        entry.controller = controller
        patchUpload(file, { status: 'uploading', progress: entry.progress || 0 })
        try {
          const result = await uploadFileInChunks(trackingApi(entry), file, {
            signal: controller.signal,
            resumeUploadId: entry.uploadId,
            onProgress: (progress) => { entry.progress = progress; patchUpload(file, { status: 'uploading', progress }) },
          })
          entry.uploadId = result.uploadId
          entry.done = true
          patchUpload(file, { status: 'done', progress: 1 })
        } catch (err) {
          if (err?.cancelled || entry.cancelled) continue
          patchUpload(file, { status: 'error', progress: entry.progress || 0 })
          throw err
        } finally {
          entry.controller = null
        }
      }

      const finalFiles = live()
      if (!text && !finalFiles.length) return null // everything was cancelled
      const bigFiles = finalFiles.filter(isChunkedFile)
      try {
        return await postWithRetry(() => post(finalFiles.filter((file) => !isChunkedFile(file)), bigFiles.map((file) => entryOf(file).uploadId)))
      } catch (err) {
        // A final rejection may mean the staged upload is gone/invalid: let the next try re-check it (resume is cheap when it is still there).
        if (!isRetryable(err)) bigFiles.forEach((file) => { entryOf(file).done = false })
        throw err
      }
    }

    sendQueueRef.current = sendQueueRef.current
      .then(async () => {
        try {
          const result = await deliver()
          if (!result) {
            setItems((current) => (current || []).filter((item) => item._id !== tempId))
            return
          }
          const saved = result.data.feedback || result.data
          // Keep the local file on a just-sent attachment so it opens instantly instead of being downloaded back.
          const savedAttachments = (saved.attachments || []).map((attachment) => {
            const local = attachFiles.find((file) => file.name === attachment.originalName && file.size === attachment.fileSize)
            return local ? { ...attachment, __localFile: local } : attachment
          })
          setItems((current) => (current || [])
            .filter((item) => item._id === tempId || String(item._id) !== String(saved._id))
            .map((item) => (item._id === tempId ? { ...saved, attachments: savedAttachments } : item)))
        } catch (err) {
          setError(err.userMessage || err.response?.data?.message || 'Your message could not be sent.')
          setItems((current) => (current || []).map((item) => (item._id === tempId ? { ...item, __pending: false, __failed: true } : item)))
        }
      })
  }

  const retry = (item) => sendMessage(item)

  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
  }

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
      className={fill ? 'flex flex-col h-full min-h-0' : 'flex flex-col h-[calc(100vh-260px)] min-h-[420px]'}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className={fill ? 'flex-1 min-h-0 flex flex-col overflow-hidden relative bg-muted/40' : 'card !p-0 flex-1 flex flex-col overflow-hidden relative'}>
        {isDraggingFiles && (
          <div className="absolute inset-0 z-10 bg-primary/10 border-2 border-dashed border-primary/50 rounded-2xl flex items-center justify-center pointer-events-none">
            <p className="text-sm font-semibold text-primary bg-card px-4 py-2 rounded-lg shadow">Drop files to attach</p>
          </div>
        )}
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 sm:px-5 sm:py-4">
          {items === null ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : timeline.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-2">
              <MessageSquare className="w-8 h-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No messages on this case yet. Start the conversation with the case team below.</p>
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
                    <Bubble item={item} selfId={selfId} loadBlob={loadBlob} onOpenAttachment={setViewing} onCancelUpload={cancelUpload} onReply={setReplyTo} onRetry={retry} />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <form onSubmit={(event) => { event.preventDefault(); sendMessage() }} className={fill ? 'border-t border-border bg-card px-3 py-2 sm:px-4 space-y-1.5 shrink-0' : 'card mt-3 space-y-3 shrink-0'}>
        {replyTo && (
          <div className="flex items-center justify-between rounded-lg bg-secondary border border-border px-3 py-2">
            <p className="text-xs text-muted-foreground truncate">
              Replying to <span className="font-semibold text-foreground">{authorName(replyTo)}</span>
            </p>
            <button type="button" onClick={() => setReplyTo(null)} className="text-xs font-semibold text-muted-foreground hover:text-foreground">
              Cancel
            </button>
          </div>
        )}

        {files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {files.map((file, index) => (
              <span key={`${file.name}-${index}`} className="inline-flex items-center gap-1.5 text-xs bg-secondary border border-border rounded-lg pl-2.5 pr-1.5 py-1.5 max-w-full">
                <FileTypeIcon kind={fileKind(file.name, file.type)} className="w-4 h-4 text-primary shrink-0" />
                <button type="button" onClick={() => openLocalFile(file)} title={`Preview ${file.name}`} className="min-w-0 max-w-[12rem] truncate font-medium text-foreground hover:underline">
                  {file.name}
                </button>
                <span className="text-muted-foreground shrink-0">{formatFileSize(file.size)}</span>
                <button type="button" onClick={() => removeFile(index)} aria-label={`Remove ${file.name}`} title="Remove" className="shrink-0 p-0.5 rounded hover:bg-accent">
                  <X className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              </span>
            ))}
          </div>
        )}

        <label htmlFor="message-text" className="sr-only">Message</label>
        {/* One slim row: Attach, the text box and Send share a line, so the messages above get the room. The box grows with long text. */}
        <div className="flex items-end gap-1 rounded-lg border border-input bg-background px-1.5 py-1 focus-within:ring-2 focus-within:ring-ring focus-within:border-ring transition-all">
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onFileInputChange} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Attach files"
            aria-label="Attach files"
            className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <textarea
            id="message-text"
            ref={textareaRef}
            rows={1}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Message the case team… (Enter to send, Shift+Enter for a new line)"
            className="block flex-1 min-w-0 resize-none !border-0 !bg-transparent px-1 py-1.5 text-base sm:text-[13px] leading-5 text-foreground placeholder:text-muted-foreground outline-none focus:ring-0 max-h-32"
          />
          <button
            type="submit"
            disabled={!message.trim() && !files.length}
            title={replyTo ? 'Send reply' : 'Send'}
            aria-label={replyTo ? 'Send reply' : 'Send'}
            className="shrink-0 p-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>

        {attachNotice && <p role="status" className="text-xs text-amber-600 dark:text-amber-400">{attachNotice}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </form>

      {viewing && <AttachmentViewer {...viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}
