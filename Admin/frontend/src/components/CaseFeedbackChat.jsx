import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Send, CornerUpLeft, Paperclip, X, FileText, CheckCheck, MessageSquare, AlertCircle, ChevronDown, Pencil, Trash2, Ban } from 'lucide-react'
import api, { feedbackApi } from '../services/api'
import ChatAttachment from './ChatAttachment'
import ConfirmModal from './ConfirmModal'
import { MAX_ATTACHMENTS_PER_MESSAGE, formatFileSize, isChunkedFile } from '../utils/chunkedUpload'
import {
  THUMBNAIL_MAX_BYTES,
  acceptNewFiles,
  attachmentKind,
  discardStagedUploads,
  isCanceledError,
  isRetryableError,
  orderForSending,
  sendErrorMessage,
  uploadChunkedFiles
} from '../utils/chatAttachments'
import { useAuth } from '../contexts/AuthContext'
import { useSocket } from '../contexts/SocketContext'

// The case team's chat with the assigned attorney — backed by
// Backend/src/models/Feedback.js (models/Message.js + Conversation.js are
// the CLIENT-inclusive system used by Messaging.jsx and are never touched
// here; the client is never a participant of this thread). This is the staff
// side of the thread the Attorney portal shows via
// Attorney/src/components/MessageThread.jsx, and deliberately mirrors that UI
// (bubbles with the quoted original inside, time + ticks inside the bubble,
// one-row composer, optimistic sends through a retrying queue). Feedback
// threads are two-party/staff-only and don't need Messaging.jsx's presence/
// typing/infinite-scroll machinery.

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

// Edit / delete-for-everyone (WhatsApp style). Only the author can do either (the backend enforces it);
// a deleted message keeps its place in the thread as a placeholder, and an edited one shows "Edited".
const isDeleted = (item) => Boolean(item?.deletedForEveryoneAt)
const DELETED_LABEL = 'This message was deleted'

// Replaces a message by _id with the copy the server (or a socket event) sent - never appends, so the
// author's own PATCH response and the same event echoed back are both harmless. Local-only fields
// (local thumbnails of just-sent images) are kept.
function mergeFeedback(current, incoming) {
  return current.map((item) => {
    if (String(item._id) !== String(incoming._id)) return item
    const attachments = Array.isArray(incoming.attachments)
      ? incoming.attachments.map((attachment) => {
        const previous = (item.attachments || []).find((a) => String(a._id) === String(attachment._id))
        return previous?.__localUrl ? { ...attachment, __localUrl: previous.__localUrl } : attachment
      })
      : item.attachments
    return { ...item, ...incoming, attachments }
  })
}

// Small chevron menu on the user's own bubbles. Fixed-positioned (from the button's rect) so the thread's
// scroll container never clips it; closes on outside click, Escape, scroll or resize.
function MessageActionsMenu({ onEdit, onDelete }) {
  const [pos, setPos] = useState(null)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)
  const close = useCallback(() => setPos(null), [])

  useEffect(() => {
    if (!pos) return undefined
    const onOutside = (event) => {
      if (menuRef.current?.contains(event.target) || buttonRef.current?.contains(event.target)) return
      close()
    }
    const onKey = (event) => { if (event.key === 'Escape') close() }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('touchstart', onOutside)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('touchstart', onOutside)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [pos, close])

  const toggle = () => {
    if (pos) { close(); return }
    const rect = buttonRef.current?.getBoundingClientRect()
    const up = Boolean(rect) && rect.bottom + 96 > window.innerHeight
    setPos({ up, top: rect ? (up ? rect.top - 4 : rect.bottom + 4) : 0, left: Math.max(8, Math.min(rect?.left ?? 0, window.innerWidth - 150)) })
  }
  const choose = (action) => { close(); action() }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        title="Message options"
        aria-label="Message options"
        aria-haspopup="menu"
        aria-expanded={Boolean(pos)}
        className={`p-1.5 rounded-full text-muted-foreground hover:text-primary hover:bg-secondary sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition-opacity shrink-0 ${pos ? 'sm:!opacity-100' : ''}`}
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {pos && (
        <div
          ref={menuRef}
          role="menu"
          style={{ position: 'fixed', top: pos.top, left: pos.left, transform: pos.up ? 'translateY(-100%)' : undefined }}
          className="z-40 min-w-[8.5rem] rounded-lg border border-border bg-card py-1 text-[13px] text-foreground shadow-lg"
        >
          {onEdit && (
            <button type="button" role="menuitem" onClick={() => choose(onEdit)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-secondary">
              <Pencil className="w-3.5 h-3.5 text-muted-foreground" /> Edit
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => choose(onDelete)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-red-600 hover:bg-secondary">
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </div>
      )}
    </>
  )
}

const RETRY_DELAYS_MS = [2000, 5000, 10000]

const newClientMessageId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

async function postWithRetry(post, signal) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await post()
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length || !isRetryableError(err)) throw err
      await new Promise((resolve) => {
        const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve() }
        const timer = setTimeout(done, RETRY_DELAYS_MS[attempt])
        signal?.addEventListener('abort', done)
      })
      if (signal?.aborted) throw Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' })
    }
  }
}

// Attachment bytes are served through an authenticated endpoint; ChatAttachment
// fetches them through this (with download progress) and caches thumbnails.
const fetchFeedbackBlob = (caseId, feedbackId, attachmentId, onProgress, signal) => (
  feedbackApi
    .downloadAttachment(caseId, feedbackId, attachmentId, {
      signal,
      timeout: 0,
      onDownloadProgress: onProgress ? (event) => { if (event.total) onProgress(event.loaded / event.total) } : undefined
    })
    .then((response) => response.data)
)

function Bubble({ item, selfId, caseId, onReply, onRetry, onCancelUpload, onDiscard, onEditMessage, onDeleteMessage }) {
  const outgoing = String(idOf(item.authorId)) === String(selfId)
  const deleted = isDeleted(item)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [actionError, setActionError] = useState('')
  const editRef = useRef(null)
  const isFailed = Boolean(item.__failed)
  const readByOthers = (item.readBy || []).filter((r) => String(idOf(r.userId)) !== String(idOf(item.authorId)))
  const parent = item.__parent
  const seen = readByOthers.length > 0

  const avatarClasses = outgoing ? 'bg-primary/80 text-primary-foreground dark:bg-primary/25 dark:text-primary' : 'bg-muted text-muted-foreground'
  // Dark mode: own bubbles are a muted tint of the brand colour with light text (the solid brand colour is too bright for a large surface).
  const bubbleClasses = outgoing
    ? 'bg-primary/80 text-primary-foreground dark:bg-primary/20 dark:text-foreground dark:border dark:border-primary/30'
    : 'bg-secondary text-foreground border border-border'
  const metaClasses = outgoing ? 'text-primary-foreground/70 dark:text-muted-foreground' : 'text-muted-foreground'
  const quoteClasses = outgoing ? 'bg-black/20 border-l-primary-foreground/60 dark:border-l-primary' : 'bg-background border-l-primary'

  const attachments = deleted ? [] : item.attachments || []
  // Own, delivered, not-yet-deleted messages only; attachment-only messages cannot be edited (only deleted).
  const canModify = outgoing && !isFailed && !item.__pending && !deleted && !String(item._id).startsWith('temp-')
  const canEdit = canModify && Boolean(item.message)
  const isEditing = editing && canEdit

  useEffect(() => {
    const el = editRef.current
    if (!isEditing || !el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [isEditing, draft])
  useEffect(() => {
    if (!isEditing) return
    const el = editRef.current
    el?.focus()
    el?.setSelectionRange?.(el.value.length, el.value.length)
  }, [isEditing])

  const startEdit = () => { setDraft(item.message || ''); setActionError(''); setEditing(true) }
  const cancelEdit = () => { setEditing(false); setActionError('') }
  const saveEdit = async () => {
    const text = draft.trim()
    if (saving || (!text && attachments.length === 0)) return
    if (text === (item.message || '').trim()) { cancelEdit(); return }
    setSaving(true)
    const failure = await onEditMessage(item, text)
    setSaving(false)
    if (failure) setActionError(failure)
    else cancelEdit()
  }
  const onEditKeyDown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); cancelEdit() }
    else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing) { event.preventDefault(); saveEdit() }
  }
  const confirmDelete = async () => {
    setDeleting(true)
    const failure = await onDeleteMessage(item)
    setDeleting(false)
    if (failure) setActionError(failure)
    else setConfirmingDelete(false)
  }
  const isUploading = Boolean(item.__pending) && attachments.some((a) => typeof a.__progress === 'number')
  // Text, a quoted reply and attachments all live in the one bubble, with the time/tick footer at its bottom-right like WhatsApp.
  const hasBubble = Boolean(deleted || item.message || parent || attachments.length > 0)
  const footer = (
    <div className={`mt-0.5 flex items-center justify-end gap-1 whitespace-nowrap pr-1 text-[10px] leading-none ${hasBubble ? metaClasses : 'text-muted-foreground'}`}>
      {item.editedAt && !deleted && <span>Edited</span>}
      <span>{formatTime(item.createdAt)}</span>
      {outgoing && !isFailed && (
        <CheckCheck
          strokeWidth={2.25}
          className={`w-4 h-4 shrink-0 overflow-visible ${seen ? (hasBubble ? 'text-sky-300' : 'text-sky-500') : ''}`}
          aria-label={seen ? 'Seen' : 'Sent'}
        />
      )}
    </div>
  )

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
          {hasBubble ? (
            <div
              onClick={isFailed ? () => onRetry(item) : undefined}
              className={`rounded-2xl ${outgoing ? 'rounded-tr-md' : 'rounded-tl-md'} px-3 pt-2 pb-1.5 text-[13px] leading-snug shadow-sm ${bubbleClasses} ${isEditing ? 'min-w-[14rem] sm:min-w-[20rem]' : ''} ${isFailed ? 'ring-2 ring-red-300 cursor-pointer' : ''}`}
            >
              {parent && !deleted && (
                <div className={`mb-1.5 rounded-lg border-l-4 px-2.5 py-1.5 ${quoteClasses}`}>
                  <p className={`text-[11px] font-semibold truncate ${outgoing ? 'text-primary-foreground dark:text-primary' : 'text-primary'}`}>{authorName(parent)}</p>
                  <p className={`text-[12px] line-clamp-2 break-words ${outgoing ? 'text-primary-foreground/80 dark:text-muted-foreground' : 'text-muted-foreground'}`}>
                    {isDeleted(parent) ? <span className="italic">{DELETED_LABEL}</span> : parent.message || 'Attachment'}
                  </p>
                </div>
              )}
              {attachments.length > 0 && (
                <div className={`flex flex-wrap items-start gap-1.5 ${item.message ? 'mb-1.5' : ''}`}>
                  {attachments.map((attachment, index) => (
                    <ChatAttachment
                      key={attachment._id || index}
                      attachment={attachment}
                      cacheKey={`${item._id}:${attachment._id}`}
                      fetchBlob={(onProgress, signal) => fetchFeedbackBlob(caseId, item._id, attachment._id, onProgress, signal)}
                    />
                  ))}
                </div>
              )}
              {isUploading && (
                <div className={`mb-1 flex items-center justify-between gap-3 text-[11px] ${metaClasses}`}>
                  <span>Uploading...</span>
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); onCancelUpload(item._id) }}
                    title="Cancel upload"
                    aria-label="Cancel upload"
                    className="inline-flex items-center gap-1 font-semibold hover:text-red-500"
                  >
                    <X className="w-3.5 h-3.5" />
                    Cancel
                  </button>
                </div>
              )}
              {deleted && (
                <p className={`flex items-center gap-1.5 italic ${metaClasses}`}>
                  <Ban className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  {DELETED_LABEL}
                </p>
              )}
              {isEditing ? (
                <div>
                  <textarea
                    ref={editRef}
                    rows={1}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={onEditKeyDown}
                    aria-label="Edit message"
                    className="block w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-[13px] leading-5 text-foreground outline-none focus:ring-2 focus:ring-ring max-h-40"
                  />
                  {actionError && <p role="alert" className="mt-1 text-[11px] font-medium text-red-300">{actionError}</p>}
                  <div className="mt-1.5 flex justify-end gap-1.5">
                    <button type="button" onClick={cancelEdit} className={`rounded-md px-2.5 py-1 text-[11px] font-semibold hover:bg-black/10 ${metaClasses}`}>Cancel</button>
                    <button
                      type="button"
                      onClick={saveEdit}
                      disabled={saving || (!draft.trim() && attachments.length === 0)}
                      className="rounded-md bg-background px-2.5 py-1 text-[11px] font-semibold text-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                !deleted && item.message && <p className="whitespace-pre-wrap break-words">{item.message}</p>
              )}
              {footer}
            </div>
          ) : footer}
        </div>
        {!isFailed && !deleted && (
          <div className="mb-1 flex items-center shrink-0">
            <button
              type="button"
              onClick={() => onReply(item)}
              title="Reply"
              aria-label="Reply"
              className="p-1.5 rounded-full text-muted-foreground hover:text-primary hover:bg-secondary sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition-opacity shrink-0"
            >
              <CornerUpLeft className="w-3.5 h-3.5" />
            </button>
            {canModify && !isEditing && <MessageActionsMenu onEdit={canEdit ? startEdit : null} onDelete={() => { setActionError(''); setConfirmingDelete(true) }} />}
          </div>
        )}
      </div>
      {confirmingDelete && (
        <ConfirmModal
          title="Delete message"
          message="Delete this message? It will be removed for everyone in this conversation."
          confirmLabel="Delete"
          tone="danger"
          busy={deleting}
          error={actionError}
          onConfirm={confirmDelete}
          onCancel={() => { setConfirmingDelete(false); setActionError('') }}
        />
      )}
      {outgoing && isFailed && (
        <div className="mt-0.5 mr-10 flex items-center gap-2 text-[11px]">
          <button type="button" onClick={() => onRetry(item)} className="text-red-500 font-medium hover:underline">
            Failed to send · Tap to retry
          </button>
          <button type="button" onClick={() => onDiscard(item)} className="text-muted-foreground hover:text-foreground hover:underline">
            Discard
          </button>
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
  const [attachNotice, setAttachNotice] = useState('') // why a picked/dropped file was not added
  const [replyTo, setReplyTo] = useState(null)
  const [error, setError] = useState('')
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const dragCounterRef = useRef(0)
  const fileInputRef = useRef(null)
  const scrollRef = useRef(null)
  const textareaRef = useRef(null)
  const sendQueueRef = useRef(Promise.resolve())
  const abortControllersRef = useRef(new Map())
  // Finished chunk uploads per message being sent (tempId -> { fileIndex: { uploadId, ready } }), so a retry only re-sends what is missing.
  const uploadStoresRef = useRef(new Map())

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
  // own optimistic send below — but a copy of a message still being sent
  // (same clientMessageId) would replace its temp bubble rather than double up.
  useEffect(() => {
    const unsubscribeNew = subscribe('feedback:new', (incoming) => {
      if (String(incoming.caseId) !== String(caseId)) return
      setItems((current) => {
        if (!current) return current
        if (current.some((item) => String(item._id) === String(incoming._id))) return current
        if (incoming.clientMessageId && current.some((item) => item.__clientMessageId === incoming.clientMessageId)) {
          return current.map((item) => (item.__clientMessageId === incoming.clientMessageId ? incoming : item))
        }
        return [...current, incoming]
      })
      feedbackApi.markRead(caseId).catch(() => {})
    })
    // An edit / delete-for-everyone, from the other party or from this user's other session: replace the
    // message by _id (never append) and leave read state alone, so no unread count moves.
    const replaceMessage = (incoming) => {
      if (!incoming?._id || String(incoming.caseId) !== String(caseId)) return
      setItems((current) => (current ? mergeFeedback(current, incoming) : current))
    }
    const unsubscribeUpdate = subscribe('feedback:update', replaceMessage)
    const unsubscribeDelete = subscribe('feedback:delete', replaceMessage)
    return () => {
      unsubscribeNew?.()
      unsubscribeUpdate?.()
      unsubscribeDelete?.()
    }
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

  // Applies the size / count rules, then adds what is allowed; whatever was refused is explained inline.
  const addFiles = (fileList) => {
    const picked = Array.from(fileList || [])
    if (!picked.length) return
    const { accepted, notice } = acceptNewFiles(files, picked)
    setAttachNotice(notice)
    if (accepted.length) setFiles((current) => [...current, ...accepted])
  }
  const onFileInputChange = (event) => {
    addFiles(event.target.files)
    event.target.value = ''
  }
  const removeFile = (index) => { setFiles((current) => current.filter((_, i) => i !== index)); setAttachNotice('') }

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

  // The message shows up in the thread (as sent) the moment it is submitted;
  // delivery to the backend happens in the background. Sends go through one
  // queue so they reach the server in the order they were typed, and the
  // composer is never locked while one is in flight. A failed delivery is
  // retried automatically (network / 5xx only); once those retries run out the
  // bubble turns red and can be re-sent by tapping it. Every attempt carries
  // the same clientMessageId, so the backend never stores a message twice.
  const sendMessage = (overrideItem = null) => {
    const text = overrideItem ? overrideItem.message : message.trim()
    const attachFiles = orderForSending(overrideItem ? overrideItem.__files || [] : files)
    const parent = overrideItem ? overrideItem.__parent : replyTo
    if (!text && !attachFiles.length) return

    const tempId = overrideItem?._id || `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const clientMessageId = overrideItem?.__clientMessageId || newClientMessageId()
    // Every attachment shows up in the thread immediately (name + size, openable from the local file);
    // images also get a local object URL so the thumbnail needs no network round-trip.
    const optimisticAttachments = overrideItem?.attachments || attachFiles.map((file, index) => ({
      _id: `temp-att-${tempId}-${index}`,
      originalName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      __file: file,
      __localUrl: attachmentKind(file.type, file.name) === 'image' && file.size <= THUMBNAIL_MAX_BYTES ? URL.createObjectURL(file) : null
    }))
    const optimistic = {
      _id: tempId,
      caseId,
      authorId: { _id: selfId, name: user?.name, displayName: user?.displayName, email: user?.email, role: user?.role },
      authorRole: user?.role,
      message: text,
      parentFeedbackId: parent?._id || null,
      __parent: parent || null,
      attachments: optimisticAttachments.map((attachment) => ({ ...attachment, __progress: attachFiles.length > 0 ? 0 : undefined })),
      createdAt: overrideItem?.createdAt || new Date().toISOString(),
      readBy: [],
      __pending: true,
      __files: attachFiles,
      __clientMessageId: clientMessageId,
    }

    setItems((current) => [...(current || []).filter((item) => item._id !== tempId), optimistic])
    if (!overrideItem) {
      setMessage('')
      setFiles([])
      setReplyTo(null)
      setAttachNotice('')
    }
    setError('')

    const controller = new AbortController()
    if (attachFiles.length > 0) abortControllersRef.current.set(tempId, controller)
    if (attachFiles.length > 0 && !uploadStoresRef.current.has(tempId)) uploadStoresRef.current.set(tempId, {})
    const uploadStore = uploadStoresRef.current.get(tempId)

    // Per-file progress shown inside the bubble (only re-rendered when the whole percent changes).
    const shownProgress = {}
    const setFileProgress = (index, fraction) => {
      const percent = Math.max(0, Math.min(100, Math.round(fraction * 100)))
      if (shownProgress[index] === percent) return
      shownProgress[index] = percent
      setItems((current) => (current || []).map((item) => (
        item._id !== tempId
          ? item
          : { ...item, attachments: (item.attachments || []).map((attachment, i) => (i === index ? { ...attachment, __progress: percent } : attachment)) }
      )))
    }

    const post = async () => {
      const smallIndexes = attachFiles.map((file, index) => (isChunkedFile(file) ? -1 : index)).filter((index) => index !== -1)
      // Big files go up first, in chunks (cancellable, resumable); the message then just references them by id.
      const uploadIds = await uploadChunkedFiles({ api, files: attachFiles, store: uploadStore || {}, signal: controller.signal, onFileProgress: setFileProgress })
      smallIndexes.forEach((index) => setFileProgress(index, 0))
      const options = {
        uploadIds,
        signal: controller.signal,
        onUploadProgress: (progressEvent) => {
          if (!progressEvent.total) return
          // Stay just under 100 until the server confirms, so a bar never claims "done" early.
          const fraction = Math.min(0.99, progressEvent.loaded / progressEvent.total)
          smallIndexes.forEach((index) => setFileProgress(index, fraction))
        }
      }
      const smallFiles = smallIndexes.map((index) => attachFiles[index])
      return parent
        ? feedbackApi.reply(caseId, parent._id, text, smallFiles, clientMessageId, options)
        : feedbackApi.send(caseId, text, smallFiles, clientMessageId, options)
    }

    sendQueueRef.current = sendQueueRef.current
      .then(async () => {
        try {
          // Cancelled while still waiting its turn behind earlier sends.
          if (controller.signal.aborted) throw Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' })
          const { data } = await postWithRetry(post, controller.signal)
          abortControllersRef.current.delete(tempId)
          uploadStoresRef.current.delete(tempId)
          const saved = data.feedback || data
          setItems((current) => {
            const next = (current || []).map((item) => {
              if (item._id !== tempId) return item
              // Keep the local thumbnails of just-sent images so they don't flicker into a refetch.
              return {
                ...saved,
                attachments: (saved.attachments || []).map((attachment, index) => ({
                  ...attachment,
                  __localUrl: item.attachments?.[index]?.originalName === attachment.originalName ? item.attachments[index].__localUrl : undefined
                }))
              }
            })
            // Never leave two copies of the saved message (e.g. a reload that landed first).
            const seenIds = new Set()
            return next.filter((item) => {
              const id = String(item._id)
              if (seenIds.has(id)) return false
              seenIds.add(id)
              return true
            })
          })
        } catch (err) {
          abortControllersRef.current.delete(tempId)
          if (isCanceledError(err)) {
            // User-initiated cancel - drop the bubble rather than showing "failed" for something they chose to stop.
            discardStagedUploads(api, uploadStoresRef.current.get(tempId))
            uploadStoresRef.current.delete(tempId)
            setItems((current) => (current || []).filter((item) => item._id !== tempId))
            return
          }
          setError(sendErrorMessage(err, 'Your message could not be sent.'))
          setItems((current) => (current || []).map((item) => (item._id === tempId ? { ...item, __pending: false, __failed: true } : item)))
        }
      })
  }

  const cancelUpload = (tempId) => abortControllersRef.current.get(tempId)?.abort()

  // Drops a failed bubble the user gave up on (and any big-file uploads that were staged for it).
  const discard = (failed) => {
    discardStagedUploads(api, uploadStoresRef.current.get(failed._id))
    uploadStoresRef.current.delete(failed._id)
    setItems((current) => (current || []).filter((item) => item._id !== failed._id))
  }

  const retry = (item) => sendMessage(item)

  // Edit / delete for everyone. Both resolve to '' on success or the error text to show next to the
  // control, leaving the old text in place on failure. The staff feedback endpoints are called through
  // the shared axios instance (feedbackApi has no edit/delete wrappers).
  const editMessage = async (item, text) => {
    try {
      const { data } = await api.patch(`/cases/${caseId}/feedback/${item._id}`, { message: text })
      if (data?.feedback) setItems((current) => (current ? mergeFeedback(current, data.feedback) : current))
      return ''
    } catch (err) {
      return err.response?.data?.message || 'Could not edit this message.'
    }
  }
  const deleteMessage = async (item) => {
    try {
      const { data } = await api.delete(`/cases/${caseId}/feedback/${item._id}`)
      if (data?.feedback) setItems((current) => (current ? mergeFeedback(current, data.feedback) : current))
      return ''
    } catch (err) {
      return err.response?.data?.message || 'Could not delete this message.'
    }
  }

  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
  }

  // Flat chronological list (not nested-by-thread) — reads like a real chat;
  // a reply shows the quoted original inside its own bubble.
  const timeline = useMemo(() => {
    if (!items) return []
    const byId = new Map(items.map((item) => [String(item._id), item]))
    return [...items]
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map((item) => ({ ...item, __parent: (item.parentFeedbackId && byId.get(String(item.parentFeedbackId))) || item.__parent || null }))
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
      <div className="card !p-0 flex-1 min-h-0 flex flex-col overflow-hidden relative">
        {isDraggingFiles && (
          <div className="absolute inset-0 z-10 bg-primary/10 border-2 border-dashed border-primary rounded-2xl flex items-center justify-center pointer-events-none">
            <p className="text-sm font-semibold text-primary bg-card px-4 py-2 rounded-lg shadow">Drop files to attach</p>
          </div>
        )}
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 sm:px-5 sm:py-4">
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
                    <Bubble item={item} selfId={selfId} caseId={caseId} onReply={setReplyTo} onRetry={retry} onCancelUpload={cancelUpload} onDiscard={discard} onEditMessage={editMessage} onDeleteMessage={deleteMessage} />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <form onSubmit={(event) => { event.preventDefault(); sendMessage() }} className="card mt-3 space-y-2 shrink-0">
        {replyTo && (
          <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-1.5">
            <p className="text-xs text-muted-foreground truncate">Replying to <span className="font-semibold">{authorName(replyTo)}</span></p>
            <button type="button" onClick={() => setReplyTo(null)} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        )}
        {attachNotice && (
          <div role="alert" className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="min-w-0 flex-1">{attachNotice}</span>
            <button type="button" onClick={() => setAttachNotice('')} aria-label="Dismiss" className="shrink-0 hover:opacity-70">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {files.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" data-testid="attach-chips">
            {files.map((file, index) => (
              <span key={`${file.name}-${index}`} className="inline-flex items-center gap-1.5 max-w-[16rem] text-xs font-medium text-foreground bg-secondary border border-border px-2.5 py-1 rounded-full">
                <FileText className="w-3.5 h-3.5 shrink-0 text-primary" />
                <span className="truncate">{file.name}</span>
                <span className="shrink-0 text-muted-foreground font-normal">{formatFileSize(file.size)}</span>
                <button type="button" onClick={() => removeFile(index)} aria-label={`Remove ${file.name}`} className="shrink-0 text-muted-foreground hover:text-red-500"><X className="w-3 h-3" /></button>
              </span>
            ))}
            <span className="text-[11px] text-muted-foreground">{files.length}/{MAX_ATTACHMENTS_PER_MESSAGE}</span>
          </div>
        )}

        <label htmlFor="case-feedback-text" className="sr-only">Message</label>
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
            id="case-feedback-text"
            ref={textareaRef}
            rows={1}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Message the attorney… (Enter to send, Shift+Enter for a new line)"
            className="block flex-1 min-w-0 resize-none !border-0 !bg-transparent px-1 py-1.5 text-base sm:text-[13px] leading-5 text-foreground placeholder:text-muted-foreground outline-none focus:ring-0 max-h-32"
          />
          {/* Never locked while an earlier message is still being delivered — only empty disables it. */}
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

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </form>
    </div>
  )
}
