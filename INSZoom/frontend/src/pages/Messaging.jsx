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
  Clock,
  ArrowLeft,
  Download
} from 'lucide-react'

const FILTERS = [
  { key: 'all', label: 'All Messages' },
  { key: 'unread', label: 'Unread' },
  { key: 'internal', label: 'Internal Only' }
]

const INTERNAL_CONTACT_ROLES = ['super_admin', 'admin', 'team_lead', 'case_manager', 'paralegal', 'finance', 'hr', 'reviewer']

// Colors for any additional (3rd+) participant in a conversation, beyond the
// current user (blue) and the primary other party (grey) — cycled in order
// of first appearance so each extra person keeps a stable, distinct color.
// Each entry is fully self-contained (own text color) so nothing downstream
// needs to append a conflicting text-color class on top of it.
const EXTRA_PARTICIPANT_PALETTE = [
  { avatar: 'bg-white text-gray-900 border-2 border-gray-300', bubble: 'bg-white text-gray-900 border border-gray-300' },
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

  let changed = false
  const merged = incomingMessages.map((incoming) => {
    const prev = prevById.get(idOf(incoming._id))
    if (prev && messagesEqual(prev, incoming)) return prev
    changed = true
    return incoming
  })

  const stillInFlight = prevMessages.filter((m) => (m.__pending || m.__failed) && !incomingIds.has(idOf(m._id)))
  if (!changed && stillInFlight.length === 0 && merged.length === prevMessages.length) {
    return prevMessages
  }
  return [...merged, ...stillInFlight]
}

const formatFileSize = (bytes) => {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Attachment bytes are served through an authenticated endpoint (not a plain
// static URL), so each one is fetched once as a blob and the object URL is
// reused for the life of the page instead of re-fetching on every re-render.
const attachmentBlobCache = new Map()

const loadAttachmentBlobUrl = async (messageId, attachmentId) => {
  const cacheKey = `${messageId}:${attachmentId}`
  if (attachmentBlobCache.has(cacheKey)) return attachmentBlobCache.get(cacheKey)
  const response = await api.get(`/messages/${messageId}/attachments/${attachmentId}`, { responseType: 'blob' })
  const url = URL.createObjectURL(response.data)
  attachmentBlobCache.set(cacheKey, url)
  return url
}

const triggerBlobDownload = (url, filename) => {
  const link = document.createElement('a')
  link.href = url
  link.download = filename || 'download'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

// Renders an inline image thumbnail (click to open a full-size lightbox with
// a soft fade/scale-in transition) or a file chip — both sides of a
// conversation can download anything either party attached. A pending,
// not-yet-uploaded attachment already carries its own local object URL
// (__localUrl) and skips the network fetch entirely.
const AttachmentItem = ({ messageId, attachment }) => {
  const isImage = (attachment.mimeType || '').startsWith('image/')
  const [url, setUrl] = useState(attachment.__localUrl || null)
  const [status, setStatus] = useState(attachment.__localUrl ? 'ready' : 'idle')
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxVisible, setLightboxVisible] = useState(false)

  const ensureLoaded = useCallback(async () => {
    if (url) return url
    setStatus('loading')
    try {
      const loaded = await loadAttachmentBlobUrl(messageId, attachment._id)
      setUrl(loaded)
      setStatus('ready')
      return loaded
    } catch {
      setStatus('error')
      return null
    }
  }, [messageId, attachment._id, url])

  useEffect(() => {
    if (isImage && !url) ensureLoaded()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isImage])

  // Mount the lightbox invisible, then flip to visible a frame later so the
  // opacity/scale transition actually has something to animate from.
  useEffect(() => {
    if (!lightboxOpen) return
    const raf = requestAnimationFrame(() => setLightboxVisible(true))
    return () => cancelAnimationFrame(raf)
  }, [lightboxOpen])

  const closeLightbox = () => {
    setLightboxVisible(false)
    setTimeout(() => setLightboxOpen(false), 150)
  }

  const handleOpen = async () => {
    const loaded = await ensureLoaded()
    if (!loaded) return
    if (isImage) setLightboxOpen(true)
    else triggerBlobDownload(loaded, attachment.originalName)
  }

  const handleDownload = async (e) => {
    e?.stopPropagation()
    const loaded = await ensureLoaded()
    if (loaded) triggerBlobDownload(loaded, attachment.originalName)
  }

  if (isImage) {
    return (
      <>
        <button
          type="button"
          onClick={handleOpen}
          className="block w-40 h-32 rounded-xl overflow-hidden border border-gray-200 bg-gray-100 hover:brightness-95 transition"
        >
          {status === 'ready' ? (
            <img src={url} alt={attachment.originalName} className="w-full h-full object-cover" />
          ) : (
            <span className="w-full h-full flex items-center justify-center text-[11px] text-gray-400">
              {status === 'error' ? "Couldn't load image" : 'Loading…'}
            </span>
          )}
        </button>
        {lightboxOpen && (
          <div
            className={`fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6 transition-opacity duration-200 ${lightboxVisible ? 'opacity-100' : 'opacity-0'}`}
            onClick={closeLightbox}
          >
            <img
              src={url}
              alt={attachment.originalName}
              className={`max-w-full max-h-full rounded-lg shadow-2xl transition-all duration-200 ease-out ${lightboxVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
              onClick={(e) => e.stopPropagation()}
            />
            <div className="absolute top-5 right-5 flex items-center gap-4">
              <button type="button" onClick={handleDownload} title="Download" className="text-white/80 hover:text-white">
                <Download className="w-5 h-5" />
              </button>
              <button type="button" onClick={closeLightbox} title="Close" className="text-white/80 hover:text-white">
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
      onClick={handleOpen}
      disabled={status === 'loading'}
      className="flex items-center gap-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1.5 rounded-full hover:bg-blue-100 transition disabled:opacity-60"
    >
      <FileText className="w-3.5 h-3.5" />
      {attachment.originalName}
      {attachment.size ? <span className="text-blue-400 font-normal">{formatFileSize(attachment.size)}</span> : null}
      <Download className="w-3 h-3" />
      {status === 'loading' && ' · Downloading…'}
      {status === 'error' && ' · Failed to download'}
    </button>
  )
}

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
    <span className="text-[11px] font-medium text-gray-500 bg-gray-200/70 px-3 py-1 rounded-full">
      {label}
    </span>
  </div>
)

// Memoized so a background re-sync that leaves this message's object
// reference unchanged (see mergeMessagesById) skips re-rendering it entirely
// — only bubbles for genuinely new/changed messages do any work. This also
// means the parent's other state (reply textarea, attach picker, etc.) can
// re-render freely without repainting the whole thread, as long as the
// `message`/`style`/`onRetry` props it receives stay referentially stable.
const MessageBubble = memo(function MessageBubble({ message: m, outgoing, style, senderName, onRetry, onCancelUpload }) {
  const senderId = idOf(m.senderId)
  const avatarClasses = style.key === 'self'
    ? 'bg-blue-500 text-white'
    : style.key === 'extra'
      ? style.palette.avatar
      : 'bg-gray-300 text-gray-700'
  const bubbleClasses = m.isInternal
    ? 'bg-orange-50 text-orange-900 border border-orange-200'
    : style.key === 'self'
      ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white'
      : style.key === 'extra'
        ? style.palette.bubble
        : 'bg-gray-100 text-gray-800 border border-gray-200'
  const readNames = (m.readBy || [])
    .filter((r) => idOf(r.userId) !== senderId)
    .map((r) => (r.userId?.name || r.userId?.displayName))
    .filter(Boolean)
  const isPending = Boolean(m.__pending)
  const isFailed = Boolean(m.__failed)

  return (
    // Time/internal badge sits on its own row above the avatar+bubble
    // row so the avatar always bottom-aligns with the bubble itself —
    // not with the "Seen by" line, which is a separate row below.
    <div className={`flex flex-col ${outgoing ? 'items-end' : 'items-start'}`}>
      <div className="flex items-center gap-2 mb-1 px-1">
        {m.isInternal && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-orange-100 text-orange-700">
            <Lock className="w-3 h-3" />
            Internal
          </span>
        )}
        <span className="text-[11px] text-gray-400">
          {formatTime(m.createdAt)}
        </span>
      </div>

      <div className={`flex items-end gap-2 max-w-[78%] ${outgoing ? 'flex-row-reverse' : ''}`}>
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 shadow-sm ${avatarClasses}`}
          title={senderName}
        >
          {getInitials(senderName)}
        </div>
        <div className="flex flex-col gap-1.5">
          {m.attachments?.length > 0 && (
            <div className={`flex flex-wrap gap-1.5 ${isPending ? 'opacity-60' : ''}`}>
              {m.attachments.map((attachment, index) => (
                <AttachmentItem key={attachment._id || index} messageId={idOf(m._id)} attachment={attachment} />
              ))}
            </div>
          )}
          {isPending && typeof m.__uploadProgress === 'number' && (
            <div className="flex items-center gap-2 w-40">
              <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all"
                  style={{ width: `${m.__uploadProgress}%` }}
                />
              </div>
              <span className="text-[10px] text-gray-500 shrink-0">{m.__uploadProgress}%</span>
              <button
                type="button"
                onClick={() => onCancelUpload?.(m._id)}
                title="Cancel upload"
                className="text-gray-400 hover:text-red-500 shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
          {m.message && (
            <div
              onClick={isFailed ? () => onRetry(m) : undefined}
              className={`rounded-2xl ${outgoing ? 'rounded-tr-md' : 'rounded-tl-md'} px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm transition-opacity ${bubbleClasses} ${isPending ? 'opacity-60' : ''} ${isFailed ? 'ring-2 ring-red-300 cursor-pointer' : ''}`}
            >
              {m.message}
            </div>
          )}
        </div>
      </div>

      {outgoing && (
        <div className="mt-1 mr-10 flex items-center gap-1 text-[11px] min-h-[14px]">
          {isFailed ? (
            <button
              type="button"
              onClick={() => onRetry(m)}
              className="text-red-500 font-medium hover:underline"
            >
              Failed to send · Tap to retry
            </button>
          ) : isPending ? (
            <span className="flex items-center gap-1 text-gray-400">
              <Clock className="w-3 h-3" />
              Sending…
            </span>
          ) : (
            // Two states we can honestly distinguish from the data we have:
            // sent (grey double-check) and read (blue double-check). There's
            // no real delivery-ack pipeline, so a fake "delivered" tick in
            // between would just be theater — this skips it rather than lie.
            <span
              className={`flex items-center gap-1 ${readNames.length > 0 ? 'text-blue-500' : 'text-gray-400'}`}
              title={readNames.length > 0 ? `Seen by ${readNames.join(', ')}` : 'Sent'}
            >
              <CheckCheck className="w-3.5 h-3.5" />
              {readNames.length > 0 ? `Seen by ${readNames.join(', ')}` : 'Sent'}
            </span>
          )}
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
  const messagesFetchInFlightRef = useRef(false)

  // Tab state: 'conversations' or 'contacts'
  const [activeTab, setActiveTab] = useState('conversations')
  
  const [selectedCaseId, setSelectedCaseId] = useState(null)
  const [selectedUserId, setSelectedUserId] = useState(null)
  const [filter, setFilter] = useState('all')

  const [replyText, setReplyText] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  const [sendError, setSendError] = useState(null)
  const [attachFiles, setAttachFiles] = useState([])
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

  const threadMessages = selectedGroup
    ? filter === 'internal'
      ? selectedGroup.messages.filter((m) => m.isInternal)
      : selectedGroup.messages
    : []

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

  // Renders the message in the thread immediately (optimistically) and lets
  // the network request reconcile in the background, so sending never feels
  // gated on round-trip latency. The temp id is swapped for the real message
  // on success; the live socket listener already dedupes by id, so if its
  // own copy of this same message arrives a moment later nothing double-
  // renders — the dedupe filter below is just a safety net for the reverse
  // race (socket delivers before this request resolves).
  const dispatchMessage = useCallback(async (body, internalFlag, files = []) => {
    if (!selectedGroup || (!body && files.length === 0)) return

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`
    // Attach local object URLs immediately so image attachments render
    // in the thread before the upload even starts — no network round-trip
    // needed to show what the user just picked.
    const optimisticAttachments = files.map((file, index) => ({
      _id: `temp-att-${tempId}-${index}`,
      originalName: file.name,
      mimeType: file.type,
      size: file.size,
      __localUrl: file.type?.startsWith('image/') ? URL.createObjectURL(file) : null
    }))
    const optimisticMessage = {
      _id: tempId,
      message: body,
      isInternal: internalFlag,
      createdAt: new Date().toISOString(),
      senderId: user,
      receiverId: selectedGroup.type === 'user' ? selectedGroup.userId : undefined,
      caseId: selectedGroup.type === 'case' ? { _id: selectedGroup.caseId, caseNumber: selectedGroup.caseNumber } : undefined,
      readBy: [],
      attachments: optimisticAttachments,
      __pending: true,
      __files: files,
      __uploadProgress: files.length > 0 ? 0 : null
    }

    setMessages((prev) => [...prev, optimisticMessage])
    setSendError(null)

    const controller = new AbortController()
    if (files.length > 0) abortControllersRef.current.set(tempId, controller)

    try {
      let response
      if (files.length > 0) {
        const formData = new FormData()
        formData.append('message', body)
        formData.append('isInternal', String(selectedGroup.type === 'case' ? internalFlag : false))
        formData.append('sender', 'case_manager')
        if (selectedGroup.type === 'case') formData.append('caseId', selectedGroup.caseId)
        else if (selectedGroup.type === 'user' && selectedGroup.userId) formData.append('receiverId', selectedGroup.userId)
        else throw new Error('Invalid conversation type')
        files.forEach((file) => formData.append('attachments', file))
        response = await api.post('/messages', formData, {
          signal: controller.signal,
          onUploadProgress: (progressEvent) => {
            if (!progressEvent.total) return
            const percent = Math.round((progressEvent.loaded / progressEvent.total) * 100)
            setMessages((prev) => prev.map((m) => (m._id === tempId ? { ...m, __uploadProgress: percent } : m)))
          }
        })
      } else if (selectedGroup.type === 'case') {
        response = await api.post('/messages', {
          caseId: selectedGroup.caseId,
          message: body,
          isInternal: internalFlag,
          sender: 'case_manager'
        })
      } else if (selectedGroup.type === 'user' && selectedGroup.userId) {
        response = await api.post('/messages', {
          receiverId: selectedGroup.userId,
          message: body,
          isInternal: false,
          sender: 'case_manager'
        })
      } else {
        throw new Error('Invalid conversation type')
      }

      abortControllersRef.current.delete(tempId)
      const sentMessage = response?.data?.message
      setMessages((prev) => {
        const next = prev.map((m) => {
          if (m._id !== tempId) return m
          if (!sentMessage) return { ...m, __pending: false }
          // Keep the local object URLs on the reconciled message so images
          // that are already rendering don't flicker into a network refetch.
          const mergedAttachments = (sentMessage.attachments || []).map((serverAttachment, index) => ({
            ...serverAttachment,
            __localUrl: m.attachments?.[index]?.__localUrl
          }))
          return { ...sentMessage, attachments: mergedAttachments }
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
      if (err.code === 'ERR_CANCELED') {
        // User-initiated cancel — drop the pending bubble entirely rather
        // than showing a "failed" state for something they chose to stop.
        setMessages((prev) => prev.filter((m) => m._id !== tempId))
        return
      }
      console.error('Error sending message:', err)
      setSendError(err.response?.data?.message || err.message || 'Failed to send message')
      setMessages((prev) => prev.map((m) => (m._id === tempId ? { ...m, __pending: false, __failed: true } : m)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroup, user, fetchUnreadMessageCount])

  const cancelUpload = useCallback((tempId) => {
    const controller = abortControllersRef.current.get(tempId)
    if (controller) controller.abort()
  }, [])

  const handleSend = (e) => {
    e.preventDefault()
    const body = replyText.trim()
    if (!body && attachFiles.length === 0) return
    if (!selectedGroup) return

    const internalFlag = isInternal
    const files = attachFiles
    setReplyText('')
    setIsInternal(false)
    setAttachFiles([])
    emitTyping(false)
    dispatchMessage(body, internalFlag, files)
  }

  const handleFileSelect = (e) => {
    const picked = Array.from(e.target.files || [])
    if (picked.length) setAttachFiles((prev) => [...prev, ...picked])
    e.target.value = ''
  }

  const retryMessage = useCallback((failedMessage) => {
    setMessages((prev) => prev.filter((m) => m._id !== failedMessage._id))
    dispatchMessage(failedMessage.message, failedMessage.isInternal, failedMessage.__files || [])
  }, [dispatchMessage])

  const handleReplyKeyDown = (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent?.isComposing) return

    e.preventDefault()
    e.currentTarget.form?.requestSubmit()
  }

  return (
    <div className="space-y-2">
      {/* Header — kept to a single compact line so the conversation pane below gets the vertical space instead */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2 min-w-0">
          <h1 className="text-base font-bold text-gray-900 leading-tight shrink-0">Messages</h1>
          <p className="text-xs text-gray-500 truncate">
            {selectedGroup?.type === 'user'
              ? `Chat with ${selectedGroup.userName}`
              : location.state?.openChat && location.state?.clientName
                ? `Chat with ${location.state.clientName} - Case ${location.state.caseNumber}`
                : 'Communicate with cases and team members'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                filter === f.key
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Split pane */}
      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-96 text-gray-600">
            Loading messages...
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-96 text-center px-6">
            <AlertCircle className="w-10 h-10 text-red-500 mb-3" />
            <p className="text-gray-700 mb-4">{error}</p>
            <button onClick={fetchMessages} className="btn-primary">
              Retry
            </button>
          </div>
        ) : (
          <div className="flex h-[calc(100vh-11.5rem)] min-h-[500px]">
            {/* Left panel - unified conversations list */}
            <div className={`w-full sm:w-80 border-r border-gray-200 flex-col shrink-0 ${showMobileThread ? 'hidden sm:flex' : 'flex'}`}>
              {/* Search */}
              <div className="p-3 border-b border-gray-200">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setActiveTab('conversations')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          activeTab === 'conversations'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        Conversations
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTab('contacts')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          activeTab === 'contacts'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        Contacts
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('contacts')}
                      className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                      title="Start a new chat"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    <input
                      type="text"
                      placeholder={activeTab === 'contacts' ? 'Search contacts...' : 'Search conversations...'}
                      value={newChatSearch}
                      onChange={(e) => setNewChatSearch(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Conversations / contacts list */}
              <div className="flex-1 overflow-y-auto">
                {activeTab === 'conversations' && conversations.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-gray-500 px-6 text-center py-12">
                    <Inbox className="w-8 h-8 mb-2" />
                    <p className="text-sm">No conversations found</p>
                  </div>
                ) : activeTab === 'contacts' && internalContacts.length === 0 && clientContacts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-gray-500 px-6 text-center py-12">
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
                        className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-colors ${
                          (conv.type === 'case' && selectedCaseId === conv.caseId) || 
                          (conv.type === 'user' && selectedUserId === conv.userId)
                            ? 'bg-blue-50 border-l-4 border-l-blue-500'
                            : 'hover:bg-gray-50 border-l-4 border-l-transparent'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-gray-900 truncate">
                            {conv.type === 'case' ? conv.caseNumber : conv.userName}
                          </span>
                          <div className="flex items-center gap-2">
                            {conv.type === 'user' && (
                              <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700">
                                {conv.userRole}
                              </span>
                            )}
                            <span className="text-xs text-gray-400 shrink-0">
                              {conv.latestAt ? formatTime(conv.latestAt) : ''}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <span className="text-sm text-gray-600 truncate">
                            {conv.type === 'case' ? conv.clientName : `${conv.userRole} • ${conv.last?.message || 'No messages yet'}`}
                          </span>
                          {conv.unreadCount > 0 && (
                            <span className="shrink-0 min-w-[1.25rem] h-5 px-1.5 flex items-center justify-center text-xs font-semibold rounded-full bg-blue-500 text-white">
                              {conv.unreadCount}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 truncate mt-1">
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
                            <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
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
                                className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-colors ${
                                  selectedUserId === idOf(contact._id)
                                    ? 'bg-blue-50 border-l-4 border-l-blue-500'
                                    : 'hover:bg-gray-50 border-l-4 border-l-transparent'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold text-gray-900 truncate">
                                    {contact.name || contact.displayName || contact.email}
                                  </span>
                                  <span className={`text-xs px-2 py-1 rounded-full ${
                                    contact.role === 'client'
                                      ? 'bg-slate-200 text-slate-700'
                                      : 'bg-blue-100 text-blue-700'
                                  }`}>
                                    {contact.role}
                                  </span>
                                </div>
                                <p className="text-sm text-gray-600 truncate mt-1">
                                  {contact.email}
                                </p>
                                {contact.role === 'client' && (contact.relatedCases || []).length > 0 && (
                                  <p className="text-xs text-gray-500 truncate mt-1">
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
                const dropped = Array.from(e.dataTransfer.files || [])
                if (dropped.length) setAttachFiles((prev) => [...prev, ...dropped])
              }}
            >
              {isDraggingFiles && (
                <div className="absolute inset-0 z-20 bg-blue-50/90 border-2 border-dashed border-blue-400 rounded-lg flex flex-col items-center justify-center pointer-events-none">
                  <Paperclip className="w-8 h-8 text-blue-500 mb-2" />
                  <p className="text-blue-700 font-semibold">Drop files to attach</p>
                </div>
              )}
              {!selectedGroup ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-500">
                  <MessageSquare className="w-10 h-10 mb-3" />
                  <p>Select a conversation to view messages</p>
                </div>
              ) : (
                <>
                  {/* Thread header */}
                  <div className="px-5 py-3 border-b border-gray-200 flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => setShowMobileThread(false)}
                      className="sm:hidden mt-0.5 text-gray-500 hover:text-gray-800 shrink-0"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div className="min-w-0">
                    <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                      {selectedGroup?.type === 'user'
                        ? selectedGroup.userName
                        : selectedGroup?.caseNumber}
                      {presence?.isOnline && (
                        <span className="w-2 h-2 rounded-full bg-emerald-500" title="Online" />
                      )}
                    </h3>
                    <p className="text-sm text-gray-500">
                      {typingUserName ? (
                        <span className="text-blue-600 font-medium">{typingUserName} is typing…</span>
                      ) : presenceLabel(presence) ? (
                        <span className={presence?.isOnline ? 'text-emerald-600 font-medium' : 'text-gray-400'}>
                          {presenceLabel(presence)}
                        </span>
                      ) : selectedGroup?.type === 'user'
                        ? `${selectedGroup?.userRole || 'Direct contact'}${selectedGroup?.relatedCases?.length ? ` • ${(selectedGroup.relatedCases || []).map(item => item.caseNumber).join(', ')}` : ''}`
                        : selectedGroup?.clientName}
                    </p>
                    </div>
                  </div>

                  {/* Messages */}
                  <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-5 space-y-3 bg-gray-50">
                    {threadMessages.length === 0 ? (
                      <div className="text-center text-gray-500 py-12">
                        <MessageSquare className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                        <p className="font-medium text-gray-700 mb-2">
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
                            <div className="w-4 h-4 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
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
                          const style = senderStyles.get(senderId) || { key: outgoing ? 'self' : 'other' }
                          const senderName = m.senderId?.name || m.senderId?.displayName || m.senderId?.email || (outgoing ? (user?.name || user?.displayName || 'You') : '?')
                          return (
                            <Fragment key={m._id}>
                              {showDivider && <DayDivider label={formatDayLabel(m.createdAt)} />}
                              <MessageBubble
                                message={m}
                                outgoing={outgoing}
                                style={style}
                                senderName={senderName}
                                onRetry={retryMessage}
                                onCancelUpload={cancelUpload}
                              />
                            </Fragment>
                          )
                        })
                        })()}
                      </>
                    )}
                  </div>

                  {/* Reply box */}
                  <form onSubmit={handleSend} className="border-t border-gray-200 p-2.5 space-y-2">
                    {sendError && (
                      <div className="flex items-center gap-2 text-sm text-red-600">
                        <AlertCircle className="w-4 h-4" />
                        {sendError}
                      </div>
                    )}
                    {attachFiles.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {attachFiles.map((file, index) => (
                          <span
                            key={`${file.name}-${index}`}
                            className="flex items-center gap-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-full"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            {file.name}
                            <button
                              type="button"
                              onClick={() => setAttachFiles((prev) => prev.filter((_, i) => i !== index))}
                              className="text-blue-400 hover:text-red-500"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <textarea
                      ref={replyTextAreaRef}
                      value={replyText}
                      onChange={(e) => {
                        setReplyText(e.target.value)
                        emitTyping(e.target.value.trim().length > 0)
                      }}
                      onKeyDown={handleReplyKeyDown}
                      placeholder={
                        location.state?.openChat && location.state.clientName
                          ? `Write a message to ${location.state.clientName}...`
                          : selectedGroup?.type === 'user' && selectedGroup?.userName
                            ? `Write a message to ${selectedGroup.userName}...`
                            : selectedGroup?.type === 'case' && selectedGroup?.clientName
                              ? `Write a message to ${selectedGroup.clientName}...`
                              : isInternal 
                                ? 'Write an internal note...' 
                                : 'Write a message...'
                      }
                      rows={2}
                      className="input-field resize-none text-sm leading-5 min-h-[46px] max-h-24"
                    />
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isInternal}
                          onChange={(e) => setIsInternal(e.target.checked)}
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="inline-flex items-center gap-1">
                          <Lock className="w-3.5 h-3.5 text-orange-500" />
                          Internal note (not synced to client)
                        </span>
                      </label>
                      <div className="flex items-center gap-2">
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
                          className="w-9 h-9 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center hover:bg-gray-200 transition-colors"
                        >
                          <Paperclip className="w-4 h-4" />
                        </button>
                        <button
                          type="submit"
                          disabled={!replyText.trim() && attachFiles.length === 0}
                          className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Send className="w-4 h-4" />
                          Send
                        </button>
                      </div>
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
