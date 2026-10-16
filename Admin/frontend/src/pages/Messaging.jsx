import { useState, useEffect, useMemo, useRef, useCallback, memo, Fragment } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import api from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { useNotifications } from '../contexts/NotificationContext'
import { useSocket } from '../contexts/SocketContext'
import {
  MessageSquare,
  Send,
  Lock,
  CheckCheck,
  AlertCircle,
  Inbox,
  Search,
  Plus,
  Users,
  Paperclip,
  FileText,
  X,
  CornerUpLeft,
  ArrowLeft
} from 'lucide-react'
import ChatAttachment from '../components/ChatAttachment'
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

const INTERNAL_CONTACT_ROLES = ['super_admin', 'admin', 'team_lead', 'case_manager', 'paralegal', 'finance', 'hr', 'reviewer']

// Colors for any additional (3rd+) participant in a conversation, beyond the
// current user (blue) and the primary other party (grey) — cycled in order
// of first appearance so each extra person keeps a stable, distinct color.
// Each entry is fully self-contained (own text color) so nothing downstream
// needs to append a conflicting text-color class on top of it.
const EXTRA_PARTICIPANT_PALETTE = [
  { avatar: 'bg-card text-foreground border-2 border-border', bubble: 'bg-card text-foreground border border-border' },
  { avatar: 'bg-teal-500 text-white', bubble: 'bg-teal-100 text-teal-900 border border-teal-200' },
  { avatar: 'bg-pink-500 text-white', bubble: 'bg-pink-100 text-pink-900 border border-pink-200' },
  { avatar: 'bg-indigo-500 text-white', bubble: 'bg-indigo-100 text-indigo-900 border border-indigo-200' },
  { avatar: 'bg-cyan-500 text-white', bubble: 'bg-cyan-100 text-cyan-900 border border-cyan-200' }
]

const getInitials = (name) => {
  if (!name) return '?'
  return name.trim().split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase()
}

const idOf = (ref) => (ref && typeof ref === 'object' ? ref._id : ref)

// Shared by every bubble that has no per-sender palette (kept as constants so
// the memo'd bubbles get a stable `style` prop).
const SELF_STYLE = { key: 'self' }
const OTHER_STYLE = { key: 'other' }

const RETRY_DELAYS_MS = [2000, 5000, 10000]

const newClientMessageId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

const isCanceled = isCanceledError
const isRetryable = isRetryableError

// Resolves after `ms`, or as soon as `signal` aborts (so cancelling an upload never waits out a retry delay).
const sleep = (ms, signal) => new Promise((resolve) => {
  const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve() }
  const timer = setTimeout(done, ms)
  signal?.addEventListener('abort', done)
})

const postWithRetry = async (post, signal) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await post()
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length || !isRetryable(err)) throw err
      await sleep(RETRY_DELAYS_MS[attempt], signal)
      if (signal?.aborted) throw Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' })
    }
  }
}

const senderNameOf = (m) => m?.senderId?.name || m?.senderId?.displayName || m?.senderId?.email || m?.senderName || ''

// Keeps the local object URLs of a just-sent image on the saved message so it
// doesn't flicker into a network refetch.
const adoptLocalAttachmentUrls = (saved, local) => ({
  ...saved,
  attachments: (saved.attachments || []).map((serverAttachment, index) => ({
    ...serverAttachment,
    __localUrl: local.attachments?.[index]?.originalName === serverAttachment.originalName ? local.attachments[index].__localUrl : undefined
  }))
})

const messagesEqual = (a, b) => (
  a.message === b.message &&
  a.isInternal === b.isInternal &&
  a.deliveryStatus === b.deliveryStatus &&
  (a.readBy?.length || 0) === (b.readBy?.length || 0) &&
  (a.attachments?.length || 0) === (b.attachments?.length || 0)
)

// Merges a freshly-fetched message list into existing state by id instead of
// replacing the array outright. Unchanged messages keep their previous object
// reference so React.memo'd bubbles skip re-rendering, and if literally
// nothing changed the previous array itself is returned so setState bails
// out of the render entirely — a background re-sync that finds nothing new
// should never repaint the thread. Local-only messages the server doesn't
// know about yet (still sending, or failed and awaiting a retry) are never
// dropped by a re-sync.
const mergeMessagesById = (prevMessages, incomingMessages) => {
  const prevById = new Map(prevMessages.map((m) => [idOf(m._id), m]))
  const incomingIds = new Set(incomingMessages.map((m) => idOf(m._id)))
  const incomingClientIds = new Set(incomingMessages.map((m) => m.clientMessageId).filter(Boolean))

  let changed = false
  const merged = incomingMessages.map((incoming) => {
    const prev = prevById.get(idOf(incoming._id))
    if (prev && messagesEqual(prev, incoming)) return prev
    changed = true
    return incoming
  })

  // A still-sending temp whose saved copy already arrived (same clientMessageId) is superseded by it.
  const stillInFlight = prevMessages.filter((m) => (
    (m.__pending || m.__failed) &&
    !incomingIds.has(idOf(m._id)) &&
    !(m.__clientMessageId && incomingClientIds.has(m.__clientMessageId))
  ))
  if (!changed && stillInFlight.length === 0 && merged.length === prevMessages.length) {
    return prevMessages
  }
  return [...merged, ...stillInFlight]
}

// Attachment bytes are served through an authenticated endpoint (not a plain
// static URL); ChatAttachment fetches them through this and caches thumbnails.
const fetchAttachmentBlob = (messageId, attachmentId, onProgress, signal) => (
  api.get(`/messages/${messageId}/attachments/${attachmentId}`, {
    responseType: 'blob',
    signal,
    timeout: 0,
    onDownloadProgress: onProgress
      ? (event) => { if (event.total) onProgress(event.loaded / event.total) }
      : undefined
  }).then((response) => response.data)
)

const formatClock = (date) => new Date(date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

const formatTime = (date) => {
  if (!date) return ''
  return new Date(date).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

const formatDayLabel = (date) => {
  const d = new Date(date)
  const now = new Date()
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return d.toLocaleDateString([], {
    month: 'long',
    day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  })
}

const presenceLabel = (presence) => {
  if (!presence) return null
  if (presence.isOnline) return 'Online'
  if (presence.lastSeenAt) return `Last seen ${formatTime(presence.lastSeenAt)}`
  return null
}

const DayDivider = ({ label }) => (
  <div className="flex items-center justify-center py-1">
    <span className="text-[11px] font-medium text-muted-foreground bg-muted px-3 py-1 rounded-full">
      {label}
    </span>
  </div>
)

// Memoized so a background re-sync that leaves this message's object
// reference unchanged (see mergeMessagesById) skips re-rendering it entirely
// — only bubbles for genuinely new/changed messages do any work. This also
// means the parent's other state (reply textarea, attach picker, etc.) can
// re-render freely without repainting the whole thread, as long as the
// `message`/`style`/`parent`/`onRetry` props it receives stay referentially stable.
const MessageBubble = memo(function MessageBubble({ message: m, outgoing, style, senderName, parent, onReply, onRetry, onCancelUpload, onDiscard }) {
  const senderId = idOf(m.senderId)
  const isSelf = style.key === 'self'
  // Own, non-internal messages use the softened navy bubble; internal notes keep their orange one.
  const onNavy = isSelf && !m.isInternal
  const avatarClasses = isSelf
    ? 'bg-primary/80 text-primary-foreground dark:bg-primary/25 dark:text-primary'
    : style.key === 'extra'
      ? style.palette.avatar
      : 'bg-muted text-muted-foreground'
  // Dark mode: own bubbles are a muted tint of the brand colour with light text (the solid brand colour is too bright for a large surface).
  const bubbleClasses = m.isInternal
    ? 'bg-orange-50 text-orange-900 border border-orange-200'
    : isSelf
      ? 'bg-primary/80 text-primary-foreground dark:bg-primary/20 dark:text-foreground dark:border dark:border-primary/30'
      : style.key === 'extra'
        ? style.palette.bubble
        : 'bg-secondary text-foreground border border-border'
  const metaClasses = onNavy ? 'text-primary-foreground/70 dark:text-muted-foreground' : 'text-muted-foreground'
  const quoteClasses = onNavy
    ? 'bg-black/20 border-l-primary-foreground/60 dark:border-l-primary'
    : m.isInternal
      ? 'bg-orange-100/70 border-l-orange-400'
      : style.key === 'extra'
        ? 'bg-black/5 border-l-primary'
        : 'bg-background border-l-primary'
  const quoteNameClasses = onNavy ? 'text-primary-foreground dark:text-primary' : m.isInternal ? 'text-orange-900' : 'text-primary'
  const quoteTextClasses = onNavy ? 'text-primary-foreground/80 dark:text-muted-foreground' : m.isInternal ? 'text-orange-800/80' : 'text-muted-foreground'
  const readNames = (m.readBy || [])
    .filter((r) => idOf(r.userId) !== senderId)
    .map((r) => (r.userId?.name || r.userId?.displayName))
    .filter(Boolean)
  const seen = readNames.length > 0
  const isPending = Boolean(m.__pending)
  const isFailed = Boolean(m.__failed)
  const attachments = m.attachments || []
  const isUploading = isPending && attachments.some((a) => typeof a.__progress === 'number')
  // Text, a quoted reply and attachments all live inside the one bubble (with the time/tick footer at its bottom).
  const hasBubble = Boolean(m.message || parent || attachments.length > 0)
  const messageId = idOf(m._id)

  // Time (and delivery state for our own messages) at the bottom-right, like
  // WhatsApp. Two states we can honestly distinguish from the data we have:
  // sent (muted double-check) and read (light-blue double-check). There's no
  // real delivery-ack pipeline, so a fake "delivered" tick in between would
  // just be theater — this skips it rather than lie. Who has seen it stays
  // available as a tooltip on the footer.
  const footer = (
    <div
      title={outgoing && !isFailed ? (seen ? `Seen by ${readNames.join(', ')}` : 'Sent') : undefined}
      className={`mt-0.5 flex items-center justify-end gap-1 whitespace-nowrap pr-1 text-[10px] leading-none ${hasBubble ? metaClasses : 'text-muted-foreground'}`}
    >
      <span>{formatClock(m.createdAt)}</span>
      {outgoing && !isFailed && (
        <CheckCheck
          strokeWidth={2.25}
          className={`w-4 h-4 shrink-0 overflow-visible ${seen ? (onNavy && hasBubble ? 'text-sky-300' : 'text-sky-500') : ''}`}
          aria-label={seen ? 'Seen' : 'Sent'}
        />
      )}
    </div>
  )

  return (
    <div className={`flex flex-col ${outgoing ? 'items-end' : 'items-start'} group`}>
      <div className={`flex items-end gap-2 max-w-[88%] sm:max-w-[78%] ${outgoing ? 'flex-row-reverse' : ''}`}>
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 shadow-sm ${avatarClasses}`}
          title={senderName}
        >
          {getInitials(senderName)}
        </div>
        <div className="flex flex-col gap-1.5 min-w-0">
          {(!outgoing || m.isInternal) && (
            <div className={`flex items-center gap-2 px-1 ${outgoing ? 'justify-end' : ''}`}>
              {!outgoing && senderName && senderName !== '?' && (
                <p className="text-[11px] font-semibold text-muted-foreground truncate">{senderName}</p>
              )}
              {m.isInternal && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-orange-100 text-orange-700">
                  <Lock className="w-3 h-3" />
                  Internal
                </span>
              )}
            </div>
          )}
          {hasBubble ? (
            <div
              onClick={isFailed ? () => onRetry(m) : undefined}
              className={`rounded-2xl ${outgoing ? 'rounded-tr-md' : 'rounded-tl-md'} px-3 pt-2 pb-1.5 text-[13px] leading-snug shadow-sm ${bubbleClasses} ${isFailed ? 'ring-2 ring-red-300 cursor-pointer' : ''}`}
            >
              {parent && (
                <div className={`mb-1.5 rounded-lg border-l-4 px-2.5 py-1.5 ${quoteClasses}`}>
                  <p className={`text-[11px] font-semibold truncate ${quoteNameClasses}`}>{senderNameOf(parent) || 'Unknown'}</p>
                  <p className={`text-[12px] line-clamp-2 break-words ${quoteTextClasses}`}>
                    {parent.message || parent.messageBody || 'Attachment'}
                  </p>
                </div>
              )}
              {attachments.length > 0 && (
                <div className={`flex flex-wrap items-start gap-1.5 ${m.message ? 'mb-1.5' : ''}`}>
                  {attachments.map((attachment, index) => (
                    <ChatAttachment
                      key={attachment._id || index}
                      attachment={attachment}
                      cacheKey={`${messageId}:${attachment._id}`}
                      fetchBlob={(onProgress, signal) => fetchAttachmentBlob(messageId, attachment._id, onProgress, signal)}
                    />
                  ))}
                </div>
              )}
              {isUploading && (
                <div className={`mb-1 flex items-center justify-between gap-3 text-[11px] ${metaClasses}`}>
                  <span>Uploading...</span>
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); onCancelUpload?.(m._id) }}
                    title="Cancel upload"
                    aria-label="Cancel upload"
                    className="inline-flex items-center gap-1 font-semibold hover:text-red-500"
                  >
                    <X className="w-3.5 h-3.5" />
                    Cancel
                  </button>
                </div>
              )}
              {m.message && <p className="whitespace-pre-wrap break-words">{m.message}</p>}
              {footer}
            </div>
          ) : footer}
        </div>
        {!isPending && !isFailed && (
          <button
            type="button"
            onClick={() => onReply(m)}
            title="Reply"
            aria-label="Reply"
            className="mb-1 p-1.5 rounded-full text-muted-foreground hover:text-primary hover:bg-secondary sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition-opacity shrink-0"
          >
            <CornerUpLeft className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {outgoing && isFailed && (
        <div className="mt-0.5 mr-10 flex items-center gap-2 text-[11px]">
          <button
            type="button"
            onClick={() => onRetry(m)}
            className="text-red-500 font-medium hover:underline"
          >
            Failed to send · Tap to retry
          </button>
          <button
            type="button"
            onClick={() => onDiscard?.(m)}
            className="text-muted-foreground hover:text-foreground hover:underline"
          >
            Discard
          </button>
        </div>
      )}
    </div>
  )
})

const Messaging = () => {
  const { user } = useAuth()
  const { fetchUnreadMessageCount } = useNotifications()
  const { subscribe, connected } = useSocket()
  const location = useLocation()
  const { caseId: urlCaseId, userId: urlUserId } = useParams()
  const currentUserId = user?._id || user?.id

  const [messages, setMessages] = useState([])
  const [serverConversations, setServerConversations] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showMobileThread, setShowMobileThread] = useState(false) // mobile: list vs thread view
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const dragCounterRef = useRef(0)
  const abortControllersRef = useRef(new Map())
  // Finished chunk uploads per message being sent (tempId -> { fileIndex: { uploadId, ready } }), so a retry only re-sends what is missing.
  const uploadStoresRef = useRef(new Map())
  // One promise chain per thread: sends are delivered in the order they were typed, and the composer is never locked while one is in flight.
  const sendQueuesRef = useRef(new Map())
  const selectedGroupRef = useRef(null)
  const messagesFetchInFlightRef = useRef(false)

  // Tab state: 'conversations' or 'contacts'
  const [activeTab, setActiveTab] = useState('conversations')
  
  const [selectedCaseId, setSelectedCaseId] = useState(null)
  const [selectedUserId, setSelectedUserId] = useState(null)

  const [replyText, setReplyText] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  const [sendError, setSendError] = useState(null)
  const [attachFiles, setAttachFiles] = useState([])
  const [attachNotice, setAttachNotice] = useState('') // why a picked/dropped file was not added
  const [replyingTo, setReplyingTo] = useState(null) // message being replied to (quoted inside the new bubble)
  const [typingUserName, setTypingUserName] = useState(null)
  const [presence, setPresence] = useState(null) // { isOnline, lastSeenAt } for the other party in the open thread
  const [hasMoreOlder, setHasMoreOlder] = useState(false)
  const [oldestCursor, setOldestCursor] = useState(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const loadingOlderRef = useRef(false)
  const isTypingRef = useRef(false)
  const typingStopTimeoutRef = useRef(null)
  const typingClearTimeoutRef = useRef(null)
  const replyTextAreaRef = useRef(null)
  const messagesContainerRef = useRef(null)
  const fileInputRef = useRef(null)
  // Tracks whether the user is scrolled near the bottom of the thread, kept
  // up to date by a scroll listener rather than recomputed from post-update
  // scrollHeight (which already includes whatever just arrived). Read by the
  // auto-scroll effect below so a message arriving while someone has
  // scrolled up to read history doesn't yank them back down.
  const isNearBottomRef = useRef(true)
  const [newChatSearch, setNewChatSearch] = useState('')

  // Handle navigation state for case/user selection
  useEffect(() => {
    // Prioritize URL parameter over navigation state
    if (urlUserId) {
      setSelectedUserId(urlUserId)
      setSelectedCaseId(null)
      setActiveTab('conversations')
    } else if (urlCaseId) {
      setSelectedCaseId(urlCaseId)
      setSelectedUserId(null)
    } else if (location.state?.userId) {
      setSelectedUserId(location.state.userId)
      setSelectedCaseId(null)
      setActiveTab('conversations')
    } else if (location.state?.caseId) {
      setSelectedCaseId(location.state.caseId)
      setSelectedUserId(null)
    }
  }, [urlCaseId, urlUserId, location.state?.caseId, location.state?.userId])

  // Show notification when navigating from case detail with openChat
  useEffect(() => {
    if (location.state?.openChat && (selectedCaseId || selectedUserId)) {
      // Chat is ready for messaging
    }
  }, [location.state?.openChat, selectedCaseId, selectedUserId, location.state?.clientName, location.state?.userName])

  // Auto-focus reply textarea and scroll to bottom when conversation is selected
  useEffect(() => {
    if (selectedCaseId || selectedUserId) {
      setShowMobileThread(true)
      // Focus on reply textarea
      if (replyTextAreaRef.current) {
        replyTextAreaRef.current.focus()
      }
      // Opening a thread always starts pinned to the latest message,
      // regardless of where the previous thread was scrolled to.
      isNearBottomRef.current = true
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
      }
    }
  }, [selectedCaseId, selectedUserId, location.state?.openChat])

  const isUnreadForMe = (m) => {
    const sentByMe = idOf(m.senderId) === currentUserId
    const readByMe = (m.readBy || []).some((r) => idOf(r.userId) === currentUserId)
    return !sentByMe && !readByMe
  }

  const fetchMessages = async () => {
    if (messagesFetchInFlightRef.current) return
    messagesFetchInFlightRef.current = true
    try {
      setError(null)
      const response = await api.get('/messages')
      setMessages((prev) => mergeMessagesById(prev, response.data.messages || []))
      setServerConversations(response.data.conversations || response.data.threads || [])
    } catch (err) {
      console.error('Error fetching messages:', err)
      setError(err.response?.data?.message || err.message || 'Failed to load messages')
    } finally {
      messagesFetchInFlightRef.current = false
      setLoading(false)
    }
  }

  const fetchUsers = async () => {
    try {
      const response = await api.get('/users/assignable', {
        params: { includeCaseClients: true }
      })
      setUsers(response.data.users || [])
    } catch (err) {
      console.error('Error fetching users:', err)
    }
  }

  useEffect(() => {
    fetchMessages()
    fetchUsers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Live-append incoming/outgoing messages the instant they're sent anywhere
  // in the conversation, without requiring a page refresh.
  useEffect(() => {
    return subscribe('message:new', (message) => {
      setMessages((prev) => {
        if (prev.some((m) => idOf(m._id) === idOf(message._id))) return prev
        // Echo of a message this tab is still sending: it replaces the temp
        // bubble instead of appearing next to it.
        const tempIndex = message.clientMessageId
          ? prev.findIndex((m) => m.__clientMessageId === message.clientMessageId && (m.__pending || m.__failed))
          : -1
        if (tempIndex !== -1) {
          const next = [...prev]
          next[tempIndex] = adoptLocalAttachmentUrls(message, prev[tempIndex])
          return next
        }
        return [...prev, message]
      })
      fetchUnreadMessageCount()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected])

  // A socket can silently miss messages sent during a brief disconnect
  // (network blip, tab backgrounded, token rotation) — re-sync the instant
  // it (re)connects instead of waiting on the next live event.
  useEffect(() => {
    if (connected) fetchMessages()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected])

  // Safety net: keep messages fresh on a short interval even if a socket
  // event is ever missed without a reconnect firing, so nothing needs a
  // manual page refresh to show up.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'hidden') return
      fetchMessages()
    }, 15000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!selectedCaseId) return

    setHasMoreOlder(false)
    setOldestCursor(null)

    const ensureCaseConversation = async () => {
      try {
        const response = await api.get(`/messages/case/${selectedCaseId}`)
        const conversation = response.data.conversation || response.data.thread
        if (!conversation) return

        setServerConversations((existing) => {
          const conversationId = idOf(conversation._id)
          const caseConversationIndex = existing.findIndex(item => idOf(item._id) === conversationId || idOf(item.caseId) === selectedCaseId)
          if (caseConversationIndex === -1) return [conversation, ...existing]

          const next = [...existing]
          next[caseConversationIndex] = conversation
          return next
        })

        const messagesResponse = await api.get(`/messages/${conversation._id}`, { params: { limit: 30 } })
        const caseMessages = messagesResponse.data.messages || []
        setHasMoreOlder(Boolean(messagesResponse.data.hasMore))
        setOldestCursor(messagesResponse.data.oldestCursor || null)
        setMessages((existing) => {
          const otherConversationMessages = existing.filter(message => idOf(message.caseId) !== selectedCaseId)
          const priorCaseMessages = existing.filter(message => idOf(message.caseId) === selectedCaseId)
          const mergedCaseMessages = mergeMessagesById(priorCaseMessages, caseMessages)
          if (mergedCaseMessages === priorCaseMessages) return existing
          return [...otherConversationMessages, ...mergedCaseMessages]
        })
      } catch (err) {
        console.error('Error opening case conversation:', err)
        if (err.response?.status === 403 || err.response?.status === 404) {
          // No longer authorized for this case (e.g. reassigned to another
          // case manager since this was last opened) - drop every trace of
          // it from view instead of leaving a stale/placeholder selection
          // showing its name, or hijacking the whole page with a full-screen
          // error for what's really just one no-longer-accessible thread.
          setMessages((prev) => prev.filter((m) => idOf(m.caseId) !== selectedCaseId))
          setServerConversations((prev) => prev.filter((c) => idOf(c.caseId) !== selectedCaseId))
          setSelectedCaseId(null)
          setShowMobileThread(false)
          setLoading(false)
          return
        }
        setError(err.response?.data?.message || err.message || 'Failed to open case conversation')
      } finally {
        setLoading(false)
      }
    }

    ensureCaseConversation()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCaseId])

  // Group messages into per-case and per-user conversations
  const groups = useMemo(() => {
    const map = new Map()
    for (const conv of serverConversations) {
      if (conv.type !== 'case' || !conv.caseId) continue
      const caseRef = conv.caseId
      const id = idOf(caseRef)
      if (!id || map.has(id)) continue
      map.set(id, {
        type: 'case',
        caseId: id,
        conversationId: idOf(conv._id),
        caseNumber: caseRef.caseNumber || conv.subject || 'Unknown Case',
        clientName: caseRef.clientName || conv.clientId?.name || conv.clientId?.displayName || location.state?.clientName || '—',
        clientUserId: idOf(conv.clientId),
        clientPortalId: conv.clientPortalId,
        messages: [],
        latestAt: conv.lastMessageAt,
        last: conv.lastMessagePreview ? { message: conv.lastMessagePreview, createdAt: conv.lastMessageAt } : null,
        unreadCount: (conv.participants || []).find(participant => idOf(participant.user) === currentUserId)?.unreadCount || 0,
        hasInternal: false
      })
    }
    // A case's presence here is decided ENTIRELY by serverConversations (the
    // access-scoped source of truth from the last /messages fetch) - never
    // by messages alone. A case-tied message whose case isn't already a
    // known key (e.g. a locally-cached message left over from before access
    // was revoked, or a __failed optimistic send retried after losing
    // access) must never resurrect that case into view; it's silently
    // dropped rather than rendered. A brand-new case's very first message
    // still shows up fine because ensureCaseConversation adds it to
    // serverConversations itself, before any message for it exists locally.
    const accessibleCaseIds = new Set(map.keys())
    for (const m of messages) {
      // Case-based conversations
      const caseRef = m.caseId
      if (caseRef) {
        const id = idOf(caseRef)
        if (accessibleCaseIds.has(id)) map.get(id).messages.push(m)
      }

      // User-based conversations (direct messages)
      const senderRef = m.senderId
      const receiverRef = m.receiverId
      if (senderRef || receiverRef) {
        const otherUserId = idOf(senderRef) === currentUserId ? idOf(receiverRef) : idOf(senderRef)
        if (otherUserId && m.receiverId) { // Only group if receiverId exists (user-to-user messages)
          const id = `user_${otherUserId}`
          if (!map.has(id)) {
            const otherUser = users.find(u => idOf(u._id) === otherUserId)
            map.set(id, {
              type: 'user',
              userId: otherUserId,
              conversationId: idOf(m.conversationId),
              userName: otherUser?.name || otherUser?.displayName || otherUser?.email || 'Unknown User',
              userRole: otherUser?.role || 'Unknown',
              messages: []
            })
          }
          map.get(id).messages.push(m)
        }
      }
    }

    const arr = Array.from(map.values()).map((g) => {
      const sorted = [...g.messages].sort(
        (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
      )
      const last = sorted[sorted.length - 1] || g.last
      return {
        ...g,
        messages: sorted,
        last,
        latestAt: last?.createdAt || g.latestAt,
        unreadCount: sorted.length ? sorted.filter(isUnreadForMe).length : g.unreadCount,
        hasInternal: sorted.some((m) => m.isInternal)
      }
    })

    arr.sort((a, b) => new Date(b.latestAt) - new Date(a.latestAt))
    return arr
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, currentUserId, users])

  const conversations = useMemo(() => groups, [groups])

  const contactUsers = useMemo(() => (
    users
      .filter(contact => idOf(contact._id) !== currentUserId)
      .sort((left, right) => {
        const leftName = (left.name || left.displayName || left.email || '').toLowerCase()
        const rightName = (right.name || right.displayName || right.email || '').toLowerCase()
        return leftName.localeCompare(rightName)
      })
  ), [users, currentUserId])

  const internalContacts = useMemo(() => (
    contactUsers.filter(contact => INTERNAL_CONTACT_ROLES.includes(contact.role))
  ), [contactUsers])

  const clientContacts = useMemo(() => (
    contactUsers.filter(contact => contact.role === 'client')
  ), [contactUsers])

  const selectedGroup = useMemo(() => {
    if (selectedUserId) {
      const directConversation = groups.find(conv => conv.type === 'user' && conv.userId === selectedUserId)
      if (directConversation) return directConversation

      const selectedContact = contactUsers.find(contact => idOf(contact._id) === selectedUserId)
      if (!selectedContact) return null

      return {
        type: 'user',
        userId: idOf(selectedContact._id),
        userName: selectedContact.name || selectedContact.displayName || selectedContact.email || 'Unknown User',
        userRole: selectedContact.role || 'client',
        relatedCases: selectedContact.relatedCases || [],
        messages: [],
        last: null,
        latestAt: null,
        unreadCount: 0,
        hasInternal: false
      }
    }
    if (selectedCaseId) {
      return groups.find(g => g.type === 'case' && g.caseId === selectedCaseId) || {
        type: 'case',
        caseId: selectedCaseId,
        conversationId: null,
        caseNumber: location.state?.caseNumber || 'Selected Case',
        clientName: location.state?.clientName || 'Client',
        clientPortalId: null,
        messages: [],
        last: null,
        latestAt: null,
        unreadCount: 0,
        hasInternal: false
      }
    }
    return null
  }, [contactUsers, groups, selectedUserId, selectedCaseId, location.state?.caseNumber, location.state?.clientName])

  selectedGroupRef.current = selectedGroup

  const threadMessages = selectedGroup ? selectedGroup.messages : []

  // A reply's quoted original: the local copy when it's loaded (full sender
  // info), else the populated `replyTo` the API returns with every message.
  const threadById = useMemo(
    () => new Map((selectedGroup?.messages || []).map((m) => [String(idOf(m._id)), m])),
    [selectedGroup]
  )
  const parentOf = (m) => {
    if (m.__parent) return m.__parent
    if (!m.replyTo) return null
    return threadById.get(String(idOf(m.replyTo))) || (typeof m.replyTo === 'object' ? m.replyTo : null)
  }

  // Replying to a message from another thread makes no sense — drop it when the thread changes.
  useEffect(() => {
    setReplyingTo(null)
  }, [selectedCaseId, selectedUserId])

  // Loads the next page of older history for the open case conversation and
  // prepends it, compensating scrollTop by the exact height the prepend
  // added so the messages already on screen don't visually jump. Direct
  // (user-to-user) conversations aren't paginated — they're built from the
  // global recent-activity feed rather than a per-conversation fetch, so
  // there's no cursor to page against.
  const loadOlderCaseMessages = useCallback(async () => {
    if (selectedGroup?.type !== 'case' || !selectedGroup.conversationId) return
    if (!hasMoreOlder || loadingOlderRef.current || !oldestCursor) return
    loadingOlderRef.current = true
    setLoadingOlder(true)
    const container = messagesContainerRef.current
    const prevScrollHeight = container?.scrollHeight || 0
    try {
      const response = await api.get(`/messages/${selectedGroup.conversationId}`, { params: { limit: 30, before: oldestCursor } })
      const older = response.data.messages || []
      if (older.length) setMessages((prev) => [...older, ...prev])
      setHasMoreOlder(Boolean(response.data.hasMore))
      setOldestCursor(response.data.oldestCursor || oldestCursor)
      requestAnimationFrame(() => {
        if (container) container.scrollTop += container.scrollHeight - prevScrollHeight
      })
    } catch (err) {
      console.error('Error loading older messages:', err)
    } finally {
      loadingOlderRef.current = false
      setLoadingOlder(false)
    }
  }, [selectedGroup?.type, selectedGroup?.conversationId, hasMoreOlder, oldestCursor])

  // Track how close to the bottom the user is scrolled, so the auto-scroll
  // effect below can tell a live update apart from someone reading history.
  // Also triggers loading older case history once scrolled near the top.
  useEffect(() => {
    const el = messagesContainerRef.current
    if (!el) return
    const handleScroll = () => {
      isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
      if (el.scrollTop < 80) loadOlderCaseMessages()
    }
    el.addEventListener('scroll', handleScroll)
    return () => el.removeEventListener('scroll', handleScroll)
  }, [selectedCaseId, selectedUserId, loadOlderCaseMessages])

  // Typing indicator: listen for the other party's typing state in the
  // currently open conversation. A safety timeout auto-clears the "typing…"
  // line if a "stopped typing" event is ever missed (tab closed, dropped
  // connection) so it never gets stuck on indefinitely.
  useEffect(() => {
    setTypingUserName(null)
    clearTimeout(typingClearTimeoutRef.current)
    const conversationId = selectedGroup?.conversationId

    const unsubscribe = subscribe('message:typing', (payload) => {
      if (!conversationId || idOf(payload.conversationId) !== conversationId) return
      if (idOf(payload.userId) === currentUserId) return
      clearTimeout(typingClearTimeoutRef.current)
      if (payload.isTyping) {
        const match = users.find((u) => idOf(u._id) === idOf(payload.userId))
        const name = match?.name || match?.displayName || match?.email
          || (selectedGroup?.type === 'case' ? selectedGroup.clientName : selectedGroup?.userName)
          || 'Someone'
        setTypingUserName(name)
        typingClearTimeoutRef.current = setTimeout(() => setTypingUserName(null), 5000)
      } else {
        setTypingUserName(null)
      }
    })

    return () => {
      unsubscribe?.()
      // Stop announcing "typing" for the conversation we're navigating away from.
      if (isTypingRef.current && conversationId) {
        isTypingRef.current = false
        clearTimeout(typingStopTimeoutRef.current)
        api.post(`/messages/conversations/${conversationId}/typing`, { isTyping: false }).catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, selectedGroup?.conversationId])

  // Debounced typing broadcast: announce once when the user starts typing,
  // then auto-announce "stopped" after a short pause of inactivity — instead
  // of firing a request on every keystroke.
  const emitTyping = useCallback((isTyping) => {
    const conversationId = selectedGroup?.conversationId
    if (!conversationId) return
    if (isTyping) {
      if (!isTypingRef.current) {
        isTypingRef.current = true
        api.post(`/messages/conversations/${conversationId}/typing`, { isTyping: true }).catch(() => {})
      }
      clearTimeout(typingStopTimeoutRef.current)
      typingStopTimeoutRef.current = setTimeout(() => {
        isTypingRef.current = false
        api.post(`/messages/conversations/${conversationId}/typing`, { isTyping: false }).catch(() => {})
      }, 3000)
    } else {
      clearTimeout(typingStopTimeoutRef.current)
      if (isTypingRef.current) {
        isTypingRef.current = false
        api.post(`/messages/conversations/${conversationId}/typing`, { isTyping: false }).catch(() => {})
      }
    }
  }, [selectedGroup?.conversationId])

  const presenceUserId = selectedGroup?.type === 'case' ? selectedGroup.clientUserId : selectedGroup?.userId

  // Presence: fetch an initial online/last-seen snapshot when the other
  // party changes (push updates alone don't tell us the CURRENT state of
  // someone who was already online/offline before this component mounted).
  useEffect(() => {
    if (!presenceUserId) { setPresence(null); return }
    setPresence(null)
    api.get(`/users/presence?ids=${presenceUserId}`)
      .then((response) => setPresence(response.data.presence?.[presenceUserId] || null))
      .catch(() => {})
  }, [presenceUserId])

  // Live presence updates pushed from the realtime gateway on connect/disconnect.
  useEffect(() => {
    if (!presenceUserId) return
    return subscribe('presence:update', (payload) => {
      if (payload.userId !== presenceUserId) return
      setPresence({ isOnline: payload.isOnline, lastSeenAt: payload.lastSeenAt || null })
    })
  }, [connected, presenceUserId])

  // Assign each distinct sender in the conversation a stable color: the
  // current user is always blue, the first other participant encountered
  // (the client, in a case thread) stays grey as before, and any additional
  // participant (e.g. another team member also messaging in this thread)
  // gets its own color from the palette so they're visually distinguishable.
  const senderStyles = useMemo(() => {
    const map = new Map()
    if (!selectedGroup) return map

    let otherAssigned = false
    let paletteIndex = 0
    for (const m of selectedGroup.messages) {
      const id = idOf(m.senderId)
      if (!id || map.has(id)) continue
      if (id === currentUserId) {
        map.set(id, { key: 'self' })
      } else if (!otherAssigned) {
        map.set(id, { key: 'other' })
        otherAssigned = true
      } else {
        map.set(id, { key: 'extra', palette: EXTRA_PARTICIPANT_PALETTE[paletteIndex % EXTRA_PARTICIPANT_PALETTE.length] })
        paletteIndex += 1
      }
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroup, currentUserId])

  // Keep the thread scrolled to the latest message as new ones arrive live —
  // but only if the user was already near the bottom. Someone scrolled up
  // reading history shouldn't get yanked back down by a background update.
  useEffect(() => {
    if (messagesContainerRef.current && isNearBottomRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight
    }
  }, [threadMessages.length])

  // Mark unread messages as read when a thread is opened
  useEffect(() => {
    if (!selectedGroup) return

    const unread = (selectedGroup.messages || []).filter(isUnreadForMe)
    if (unread.length === 0) return

    const markRead = async () => {
      try {
        await Promise.all(unread.map((m) => api.put(`/messages/${m._id}/read`)))
        await fetchMessages()
        fetchUnreadMessageCount()
      } catch (err) {
        console.error('Error marking messages as read:', err)
      }
    }

    markRead()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroup?._id, selectedGroup?.caseId, selectedGroup?.userId])

  // The message shows up in the thread (as sent) the moment it is submitted;
  // delivery to the backend happens in the background. Sends go through one
  // queue per thread so they reach the server in the order they were typed,
  // and the composer is never locked while one is in flight. A failed delivery
  // is retried automatically (network / 5xx only); once those retries run out
  // the bubble turns red and can be re-sent by tapping it. Every attempt
  // carries the same clientMessageId, so the backend never stores a message
  // twice. The temp id is swapped for the saved message on success; the live
  // socket listener and mergeMessagesById dedupe by id AND clientMessageId, so
  // if this message's own echo arrives first nothing double-renders.
  // `opts` is only used when re-sending a failed bubble (same temp id, same
  // clientMessageId, same target thread).
  const dispatchMessage = useCallback((body, internalFlag, pickedFiles = [], opts = {}) => {
    const group = selectedGroupRef.current
    const target = opts.target || (group
      ? { type: group.type, caseId: group.caseId, caseNumber: group.caseNumber, userId: group.userId }
      : null)
    if (!target || (!body && pickedFiles.length === 0)) return

    const files = orderForSending(pickedFiles)
    const parent = opts.parent || null
    const tempId = opts.tempId || `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const clientMessageId = opts.clientMessageId || newClientMessageId()
    // Internal notes only exist in case threads; direct messages are never internal.
    const internalMessage = target.type === 'case' ? Boolean(internalFlag) : false
    // Every attachment shows up in the thread immediately (name + size, openable from the local file);
    // images also get a local object URL so the thumbnail needs no network round-trip.
    const optimisticAttachments = opts.attachments || files.map((file, index) => ({
      _id: `temp-att-${tempId}-${index}`,
      originalName: file.name,
      mimeType: file.type,
      size: file.size,
      __file: file,
      __localUrl: attachmentKind(file.type, file.name) === 'image' && file.size <= THUMBNAIL_MAX_BYTES ? URL.createObjectURL(file) : null
    }))
    const optimisticMessage = {
      _id: tempId,
      message: body,
      isInternal: internalMessage,
      createdAt: opts.createdAt || new Date().toISOString(),
      senderId: user,
      receiverId: target.type === 'user' ? target.userId : undefined,
      caseId: target.type === 'case' ? { _id: target.caseId, caseNumber: target.caseNumber } : undefined,
      replyTo: parent?._id,
      readBy: [],
      attachments: optimisticAttachments.map((attachment) => ({ ...attachment, __progress: files.length > 0 ? 0 : undefined })),
      __parent: parent,
      __pending: true,
      __files: files,
      __clientMessageId: clientMessageId,
      __target: target
    }

    setMessages((prev) => [...prev.filter((m) => m._id !== tempId), optimisticMessage])
    setSendError(null)

    const controller = new AbortController()
    if (files.length > 0) abortControllersRef.current.set(tempId, controller)
    if (files.length > 0 && !uploadStoresRef.current.has(tempId)) uploadStoresRef.current.set(tempId, {})
    const uploadStore = uploadStoresRef.current.get(tempId)

    // Per-file progress shown inside the bubble (only re-rendered when the whole percent changes).
    const shownProgress = {}
    const setFileProgress = (index, fraction) => {
      const percent = Math.max(0, Math.min(100, Math.round(fraction * 100)))
      if (shownProgress[index] === percent) return
      shownProgress[index] = percent
      setMessages((prev) => prev.map((m) => (
        m._id !== tempId
          ? m
          : { ...m, attachments: (m.attachments || []).map((attachment, i) => (i === index ? { ...attachment, __progress: percent } : attachment)) }
      )))
    }

    const postOnce = async () => {
      if (target.type !== 'case' && !(target.type === 'user' && target.userId)) {
        throw Object.assign(new Error('Invalid conversation type'), { retryable: false })
      }
      if (files.length > 0) {
        const smallIndexes = files.map((file, index) => (isChunkedFile(file) ? -1 : index)).filter((index) => index !== -1)
        // Big files go up first, in chunks (cancellable, resumable); the message then just references them by id.
        const uploadIds = await uploadChunkedFiles({ api, files, store: uploadStore, signal: controller.signal, onFileProgress: setFileProgress })
        const formData = new FormData()
        formData.append('message', body)
        formData.append('isInternal', String(internalMessage))
        formData.append('sender', 'case_manager')
        formData.append('clientMessageId', clientMessageId)
        if (parent?._id) formData.append('replyTo', parent._id)
        if (target.type === 'case') formData.append('caseId', target.caseId)
        else formData.append('receiverId', target.userId)
        smallIndexes.forEach((index) => formData.append('attachments', files[index]))
        if (uploadIds.length > 0) formData.append('uploadIds', JSON.stringify(uploadIds))
        smallIndexes.forEach((index) => setFileProgress(index, 0))
        return api.post('/messages', formData, {
          signal: controller.signal,
          onUploadProgress: (progressEvent) => {
            if (!progressEvent.total) return
            // Stay just under 100 until the server confirms, so a bar never claims "done" early.
            const fraction = Math.min(0.99, progressEvent.loaded / progressEvent.total)
            smallIndexes.forEach((index) => setFileProgress(index, fraction))
          }
        })
      }
      return api.post('/messages', {
        ...(target.type === 'case' ? { caseId: target.caseId } : { receiverId: target.userId }),
        message: body,
        isInternal: internalMessage,
        sender: 'case_manager',
        clientMessageId,
        ...(parent?._id ? { replyTo: parent._id } : {})
      })
    }

    const queueKey = target.type === 'case' ? `case:${target.caseId}` : `user:${target.userId}`
    const queued = (sendQueuesRef.current.get(queueKey) || Promise.resolve()).then(async () => {
      try {
        // Cancelled while still waiting its turn behind earlier sends.
        if (controller.signal.aborted) throw Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' })
        const response = await postWithRetry(postOnce, controller.signal)
        abortControllersRef.current.delete(tempId)
        uploadStoresRef.current.delete(tempId)
        const sentMessage = response?.data?.message
        setMessages((prev) => {
          const next = prev.map((m) => {
            if (m._id !== tempId) return m
            if (!sentMessage) return { ...m, __pending: false }
            return adoptLocalAttachmentUrls(sentMessage, m)
          })
          const seen = new Set()
          return next.filter((m) => {
            const id = idOf(m._id)
            if (seen.has(id)) return false
            seen.add(id)
            return true
          })
        })
        fetchUnreadMessageCount()
      } catch (err) {
        abortControllersRef.current.delete(tempId)
        if (isCanceled(err)) {
          // User-initiated cancel — drop the pending bubble entirely rather
          // than showing a "failed" state for something they chose to stop.
          discardStagedUploads(api, uploadStoresRef.current.get(tempId))
          uploadStoresRef.current.delete(tempId)
          setMessages((prev) => prev.filter((m) => m._id !== tempId))
          return
        }
        console.error('Error sending message:', err)
        setSendError(sendErrorMessage(err, 'Failed to send message'))
        setMessages((prev) => prev.map((m) => (m._id === tempId ? { ...m, __pending: false, __failed: true } : m)))
      }
    })
    sendQueuesRef.current.set(queueKey, queued)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, fetchUnreadMessageCount])

  const cancelUpload = useCallback((tempId) => {
    const controller = abortControllersRef.current.get(tempId)
    if (controller) controller.abort()
  }, [])

  // Drops a failed bubble the user gave up on (and any big-file uploads that were staged for it).
  const discardMessage = useCallback((failedMessage) => {
    discardStagedUploads(api, uploadStoresRef.current.get(failedMessage._id))
    uploadStoresRef.current.delete(failedMessage._id)
    setMessages((prev) => prev.filter((m) => m._id !== failedMessage._id))
  }, [])

  const handleSend = (e) => {
    e.preventDefault()
    const body = replyText.trim()
    if (!body && attachFiles.length === 0) return
    if (!selectedGroup) return

    const internalFlag = isInternal
    const files = attachFiles
    const parent = replyingTo
    setReplyText('')
    setIsInternal(false)
    setAttachFiles([])
    setReplyingTo(null)
    emitTyping(false)
    // Your own message always scrolls into view, even if you'd scrolled up.
    isNearBottomRef.current = true
    setAttachNotice('')
    dispatchMessage(body, internalFlag, files, { parent })
  }

  // Applies the size / count rules, then adds what is allowed; whatever was refused is explained inline.
  const addAttachFiles = useCallback((picked) => {
    if (!picked.length) return
    setAttachFiles((prev) => {
      const { accepted, notice } = acceptNewFiles(prev, picked)
      setAttachNotice(notice)
      return accepted.length ? [...prev, ...accepted] : prev
    })
  }, [])

  const handleFileSelect = (e) => {
    addAttachFiles(Array.from(e.target.files || []))
    e.target.value = ''
  }

  const startReply = useCallback((message) => {
    setReplyingTo(message)
    replyTextAreaRef.current?.focus()
  }, [])

  // Re-sends a failed bubble in place: same temp id (so it keeps its spot),
  // same clientMessageId (so a copy that did land is never duplicated) and the
  // same thread it was written in, wherever the user is looking now.
  const retryMessage = useCallback((failedMessage) => {
    dispatchMessage(failedMessage.message, failedMessage.isInternal, failedMessage.__files || [], {
      target: failedMessage.__target,
      tempId: failedMessage._id,
      clientMessageId: failedMessage.__clientMessageId,
      parent: failedMessage.__parent,
      createdAt: failedMessage.createdAt,
      attachments: failedMessage.attachments
    })
  }, [dispatchMessage])

  // Single-line composer that grows with its content (up to its max-height).
  const hasThread = Boolean(selectedGroup)
  useEffect(() => {
    const el = replyTextAreaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [replyText, hasThread])

  const handleReplyKeyDown = (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent?.isComposing) return

    e.preventDefault()
    e.currentTarget.form?.requestSubmit()
  }

  return (
    <div>
      {/* Split pane */}
      {/* Fills the viewport under the app header: main's padding (p-3 / sm:p-4 / lg:p-6) plus the sticky header (~61px) are subtracted, so there is no gap under the card. */}
      <div className="card !p-0 overflow-hidden h-[calc(100vh-5.5rem)] sm:h-[calc(100vh-6.25rem)] lg:h-[calc(100vh-7rem)] min-h-[420px]">
        {loading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Loading messages...
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <AlertCircle className="w-10 h-10 text-red-500 mb-3" />
            <p className="text-muted-foreground mb-4">{error}</p>
            <button onClick={fetchMessages} className="btn-primary">
              Retry
            </button>
          </div>
        ) : (
          <div className="flex h-full">
            {/* Left panel - unified conversations list */}
            <div className={`w-full sm:w-80 border-r border-border flex-col shrink-0 ${showMobileThread ? 'hidden sm:flex' : 'flex'}`}>
              {/* Title, tabs and search */}
              <div className="p-3 border-b border-border">
                <div>
                  <h1 className="text-base font-semibold text-foreground leading-tight mb-2.5">Messages</h1>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setActiveTab('conversations')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          activeTab === 'conversations'
                            ? 'bg-primary/15 text-primary'
                            : 'bg-secondary text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        Conversations
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTab('contacts')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          activeTab === 'contacts'
                            ? 'bg-primary/15 text-primary'
                            : 'bg-secondary text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        Contacts
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('contacts')}
                      className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
                      title="Start a new chat"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <input
                      type="text"
                      placeholder={activeTab === 'contacts' ? 'Search contacts...' : 'Search conversations...'}
                      value={newChatSearch}
                      onChange={(e) => setNewChatSearch(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-border rounded-lg text-sm bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
              </div>

              {/* Conversations / contacts list */}
              <div className="flex-1 overflow-y-auto">
                {activeTab === 'conversations' && conversations.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground px-6 text-center py-12">
                    <Inbox className="w-8 h-8 mb-2" />
                    <p className="text-sm">No conversations found</p>
                  </div>
                ) : activeTab === 'contacts' && internalContacts.length === 0 && clientContacts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground px-6 text-center py-12">
                    <Users className="w-8 h-8 mb-2" />
                    <p className="text-sm">No contacts found</p>
                  </div>
                ) : (
                  activeTab === 'conversations' ? conversations
                    .filter(conv => {
                      const searchTerm = newChatSearch.toLowerCase()
                      if (!searchTerm) return true
                      if (conv.type === 'case') {
                        return conv.caseNumber?.toLowerCase().includes(searchTerm) ||
                               conv.clientName?.toLowerCase().includes(searchTerm)
                      } else {
                        return conv.userName?.toLowerCase().includes(searchTerm)
                      }
                    })
                    .map((conv) => (
                      <button
                        key={conv.type === 'case' ? conv.caseId : conv.userId}
                        onClick={() => {
                          if (conv.type === 'case') {
                            setSelectedCaseId(conv.caseId)
                            setSelectedUserId(null)
                          } else {
                            setSelectedUserId(conv.userId)
                            setSelectedCaseId(null)
                          }
                          setActiveTab('conversations')
                        }}
                        className={`w-full text-left px-4 py-3 border-b border-border transition-colors ${
                          (conv.type === 'case' && selectedCaseId === conv.caseId) || 
                          (conv.type === 'user' && selectedUserId === conv.userId)
                            ? 'bg-primary/10 border-l-4 border-l-primary'
                            : 'hover:bg-muted border-l-4 border-l-transparent'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-foreground truncate">
                            {conv.type === 'case' ? conv.caseNumber : conv.userName}
                          </span>
                          <div className="flex items-center gap-2">
                            {conv.type === 'user' && (
                              <span className="text-xs px-2 py-1 rounded-full bg-primary/15 text-primary">
                                {conv.userRole}
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground shrink-0">
                              {conv.latestAt ? formatTime(conv.latestAt) : ''}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <span className="text-sm text-muted-foreground truncate">
                            {conv.type === 'case' ? conv.clientName : `${conv.userRole} • ${conv.last?.message || 'No messages yet'}`}
                          </span>
                          {conv.unreadCount > 0 && (
                            <span className="shrink-0 min-w-[1.25rem] h-5 px-1.5 flex items-center justify-center text-xs font-semibold rounded-full bg-primary text-primary-foreground">
                              {conv.unreadCount}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-1">
                          {conv.last?.isInternal && (
                            <span className="text-orange-600 font-medium">[Internal] </span>
                          )}
                          {conv.last?.message || 'No messages yet'}
                        </p>
                      </button>
                    )) : (
                    <div className="py-2">
                      {[
                        { key: 'internal', label: 'Internal Team', items: internalContacts },
                        { key: 'clients', label: 'Assigned Clients', items: clientContacts }
                      ].map(section => {
                        const filteredItems = section.items.filter(contact => {
                          const searchTerm = newChatSearch.toLowerCase()
                          if (!searchTerm) return true
                          const casesText = (contact.relatedCases || []).map(item => item.caseNumber).join(' ')
                          return (
                            (contact.name || contact.displayName || contact.email || '').toLowerCase().includes(searchTerm) ||
                            (contact.role || '').toLowerCase().includes(searchTerm) ||
                            casesText.toLowerCase().includes(searchTerm)
                          )
                        })

                        if (filteredItems.length === 0) return null

                        return (
                          <div key={section.key} className="pb-2">
                            <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {section.label}
                            </div>
                            {filteredItems.map(contact => (
                              <button
                                key={idOf(contact._id)}
                                type="button"
                                onClick={() => {
                                  setSelectedUserId(idOf(contact._id))
                                  setSelectedCaseId(null)
                                  setActiveTab('conversations')
                                }}
                                className={`w-full text-left px-4 py-3 border-b border-border transition-colors ${
                                  selectedUserId === idOf(contact._id)
                                    ? 'bg-primary/10 border-l-4 border-l-primary'
                                    : 'hover:bg-muted border-l-4 border-l-transparent'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold text-foreground truncate">
                                    {contact.name || contact.displayName || contact.email}
                                  </span>
                                  <span className={`text-xs px-2 py-1 rounded-full ${
                                    contact.role === 'client'
                                      ? 'bg-slate-200 text-slate-700'
                                      : 'bg-primary/15 text-primary'
                                  }`}>
                                    {contact.role}
                                  </span>
                                </div>
                                <p className="text-sm text-muted-foreground truncate mt-1">
                                  {contact.email}
                                </p>
                                {contact.role === 'client' && (contact.relatedCases || []).length > 0 && (
                                  <p className="text-xs text-muted-foreground truncate mt-1">
                                    {(contact.relatedCases || []).map(item => item.caseNumber).join(', ')}
                                  </p>
                                )}
                              </button>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                  )
                )}
              </div>
            </div>

            {/* Right panel — thread */}
            <div
              className={`relative flex-1 flex-col min-w-0 ${showMobileThread ? 'flex' : 'hidden sm:flex'}`}
              onDragEnter={(e) => {
                if (!selectedGroup) return
                e.preventDefault()
                dragCounterRef.current += 1
                setIsDraggingFiles(true)
              }}
              onDragOver={(e) => {
                if (!selectedGroup) return
                e.preventDefault()
              }}
              onDragLeave={(e) => {
                if (!selectedGroup) return
                e.preventDefault()
                dragCounterRef.current -= 1
                if (dragCounterRef.current <= 0) {
                  dragCounterRef.current = 0
                  setIsDraggingFiles(false)
                }
              }}
              onDrop={(e) => {
                if (!selectedGroup) return
                e.preventDefault()
                dragCounterRef.current = 0
                setIsDraggingFiles(false)
                addAttachFiles(Array.from(e.dataTransfer.files || []))
              }}
            >
              {isDraggingFiles && (
                <div className="absolute inset-0 z-20 bg-primary/10 backdrop-blur-[1px] border-2 border-dashed border-primary rounded-lg flex flex-col items-center justify-center pointer-events-none">
                  <Paperclip className="w-8 h-8 text-primary mb-2" />
                  <p className="text-primary font-semibold">Drop files to attach</p>
                </div>
              )}
              {!selectedGroup ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <MessageSquare className="w-10 h-10 mb-3" />
                  <p>Select a conversation to view messages</p>
                </div>
              ) : (
                <>
                  {/* Thread header */}
                  <div className="px-5 py-3 border-b border-border flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => setShowMobileThread(false)}
                      className="sm:hidden mt-0.5 text-muted-foreground hover:text-foreground shrink-0"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div className="min-w-0">
                    <h3 className="font-semibold text-foreground flex items-center gap-2">
                      {selectedGroup?.type === 'user'
                        ? selectedGroup.userName
                        : selectedGroup?.caseNumber}
                      {presence?.isOnline && (
                        <span className="w-2 h-2 rounded-full bg-emerald-500" title="Online" />
                      )}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {typingUserName ? (
                        <span className="text-primary font-medium">{typingUserName} is typing…</span>
                      ) : presenceLabel(presence) ? (
                        <span className={presence?.isOnline ? 'text-emerald-600 font-medium' : 'text-muted-foreground'}>
                          {presenceLabel(presence)}
                        </span>
                      ) : selectedGroup?.type === 'user'
                        ? `${selectedGroup?.userRole || 'Direct contact'}${selectedGroup?.relatedCases?.length ? ` • ${(selectedGroup.relatedCases || []).map(item => item.caseNumber).join(', ')}` : ''}`
                        : selectedGroup?.clientName}
                    </p>
                    </div>
                  </div>

                  {/* Messages */}
                  <div ref={messagesContainerRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 sm:px-5 sm:py-4 space-y-4 bg-muted">
                    {threadMessages.length === 0 ? (
                      <div className="text-center text-muted-foreground py-12">
                        <MessageSquare className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                        <p className="font-medium text-muted-foreground mb-2">
                          {location.state?.openChat && location.state.clientName
                            ? `Start your conversation with ${location.state.clientName}`
                            : selectedGroup?.type === 'user' 
                              ? `Start your conversation with ${selectedGroup.userName}`
                              : selectedGroup?.type === 'case'
                                ? `No messages in this case conversation`
                                : 'No messages yet in this conversation'
                          }
                        </p>
                        <p className="text-sm">
                          {location.state?.openChat || selectedGroup?.type === 'user'
                            ? 'Type your message below to begin'
                            : 'Be the first to send a message'
                          }
                        </p>
                      </div>
                    ) : (
                      <>
                        {loadingOlder && (
                          <div className="flex items-center justify-center py-2">
                            <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                          </div>
                        )}
                        {(() => {
                        let lastDayKey = null
                        return threadMessages.map((m) => {
                          const dayKey = new Date(m.createdAt).toDateString()
                          const showDivider = dayKey !== lastDayKey
                          lastDayKey = dayKey
                          const senderId = idOf(m.senderId)
                          const outgoing = senderId === currentUserId
                          const style = senderStyles.get(senderId) || (outgoing ? SELF_STYLE : OTHER_STYLE)
                          const senderName = m.senderId?.name || m.senderId?.displayName || m.senderId?.email || (outgoing ? (user?.name || user?.displayName || 'You') : '?')
                          return (
                            <Fragment key={m._id}>
                              {showDivider && <DayDivider label={formatDayLabel(m.createdAt)} />}
                              <MessageBubble
                                message={m}
                                outgoing={outgoing}
                                style={style}
                                senderName={senderName}
                                parent={parentOf(m)}
                                onReply={startReply}
                                onRetry={retryMessage}
                                onCancelUpload={cancelUpload}
                                onDiscard={discardMessage}
                              />
                            </Fragment>
                          )
                        })
                        })()}
                      </>
                    )}
                  </div>

                  {/* Reply box — one slim row (attach, text, send); notes/chips only take a line above it while active */}
                  <form onSubmit={handleSend} className="border-t border-border bg-card px-3 py-2 sm:px-4 space-y-1.5 shrink-0">
                    {sendError && (
                      <div role="alert" className="flex items-center gap-2 text-xs text-red-600">
                        <AlertCircle className="w-4 h-4 shrink-0" />
                        {sendError}
                      </div>
                    )}
                    {replyingTo && (
                      <div className="flex items-center justify-between gap-2 rounded-lg bg-secondary border border-border px-3 py-1.5">
                        <p className="text-xs text-muted-foreground truncate">
                          Replying to <span className="font-semibold text-foreground">{senderNameOf(replyingTo) || 'Unknown'}</span>
                          {replyingTo.message ? <span> · {replyingTo.message}</span> : null}
                        </p>
                        <button
                          type="button"
                          onClick={() => setReplyingTo(null)}
                          className="shrink-0 text-xs font-semibold text-muted-foreground hover:text-foreground"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                    {isInternal && selectedGroup.type === 'case' && (
                      <div className="flex items-center justify-between gap-2 rounded-lg bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-900 px-3 py-1.5">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-orange-700 dark:text-orange-300">
                          <Lock className="w-3.5 h-3.5" />
                          Internal note (not synced to client)
                        </span>
                        <button
                          type="button"
                          onClick={() => setIsInternal(false)}
                          className="shrink-0 text-xs font-semibold text-orange-700 dark:text-orange-300 hover:underline"
                        >
                          Turn off
                        </button>
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
                    {attachFiles.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5" data-testid="attach-chips">
                        {attachFiles.map((file, index) => (
                          <span
                            key={`${file.name}-${index}`}
                            className="inline-flex items-center gap-1.5 max-w-[16rem] text-xs font-medium text-foreground bg-secondary border border-border px-2.5 py-1 rounded-full"
                          >
                            <FileText className="w-3.5 h-3.5 shrink-0 text-primary" />
                            <span className="truncate">{file.name}</span>
                            <span className="shrink-0 text-muted-foreground font-normal">{formatFileSize(file.size)}</span>
                            <button
                              type="button"
                              onClick={() => { setAttachFiles((prev) => prev.filter((_, i) => i !== index)); setAttachNotice('') }}
                              aria-label={`Remove ${file.name}`}
                              className="shrink-0 text-muted-foreground hover:text-red-500"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                        <span className="text-[11px] text-muted-foreground">{attachFiles.length}/{MAX_ATTACHMENTS_PER_MESSAGE}</span>
                      </div>
                    )}
                    <label htmlFor="admin-message-text" className="sr-only">Message</label>
                    <div className="flex items-end gap-1 rounded-lg border border-input bg-background px-1.5 py-1 focus-within:ring-2 focus-within:ring-ring focus-within:border-ring transition-all">
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={handleFileSelect}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        title="Attach file"
                        aria-label="Attach file"
                        className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                      >
                        <Paperclip className="w-4 h-4" />
                      </button>
                      {selectedGroup.type === 'case' && (
                        <button
                          type="button"
                          onClick={() => setIsInternal((prev) => !prev)}
                          title={isInternal ? 'Internal note: on (not synced to client)' : 'Make this an internal note (not synced to client)'}
                          aria-label="Internal note"
                          aria-pressed={isInternal}
                          className={`shrink-0 p-1.5 rounded-md transition-colors ${
                            isInternal
                              ? 'text-orange-600 bg-orange-100 dark:bg-orange-950/40'
                              : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                          }`}
                        >
                          <Lock className="w-4 h-4" />
                        </button>
                      )}
                      <textarea
                        id="admin-message-text"
                        ref={replyTextAreaRef}
                        value={replyText}
                        onChange={(e) => {
                          setReplyText(e.target.value)
                          emitTyping(e.target.value.trim().length > 0)
                        }}
                        onKeyDown={handleReplyKeyDown}
                        placeholder={
                          isInternal && selectedGroup.type === 'case'
                            ? 'Write an internal note...'
                            : location.state?.openChat && location.state.clientName
                              ? `Write a message to ${location.state.clientName}...`
                              : selectedGroup?.type === 'user' && selectedGroup?.userName
                                ? `Write a message to ${selectedGroup.userName}...`
                                : selectedGroup?.type === 'case' && selectedGroup?.clientName
                                  ? `Write a message to ${selectedGroup.clientName}...`
                                  : 'Write a message...'
                        }
                        rows={1}
                        className="block flex-1 min-w-0 resize-none !border-0 !bg-transparent px-1 py-1.5 text-base sm:text-[13px] leading-5 text-foreground placeholder:text-muted-foreground outline-none focus:ring-0 max-h-32"
                      />
                      {/* Never locked while an earlier message is still being delivered — only empty disables it. */}
                      <button
                        type="submit"
                        disabled={!replyText.trim() && attachFiles.length === 0}
                        title={replyingTo ? 'Send reply' : 'Send'}
                        aria-label={replyingTo ? 'Send reply' : 'Send'}
                        className="shrink-0 p-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  </form>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default Messaging
