import { useState, useEffect, useRef, useCallback, memo, Fragment } from "react";
import { useAuth } from "../../context/AuthContext";
import { useSocket } from "../../context/SocketContext";
import { messagesApi, usersApi } from "../../services/api";
import { useMyCase } from "../../hooks/useMyCaseProfile";
import { IconX } from "../../utils/iconComponents";

/* ─── Icons ────────────────────────────────────────────────────────────── */
const Ic = {
  Send:    () => <svg width="17" height="17" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>,
  Attach:  () => <svg width="17" height="17" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>,
  Lock:    () => <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>,
  Back:    () => <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"/></svg>,
  Refresh: () => <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>,
  File:    () => <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>,
  Msg:     () => <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>,
  DoubleCheck: () => <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M1 13l4 4L12 8"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 13l4 4L20 8"/></svg>,
  Clock:   () => <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" strokeWidth="2"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 7v5l3 3"/></svg>,
  Download: () => <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/></svg>,
};

function fmt(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

function initials(name) {
  if (!name) return "?";
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dayLabel(date) {
  const d = new Date(date);
  const now = new Date();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString([], {
    month: "long",
    day: "numeric",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined
  });
}

function presenceLabel(presence) {
  if (!presence) return null;
  if (presence.isOnline) return "Online";
  if (presence.lastSeenAt) return `Last seen ${fmt(presence.lastSeenAt)}`;
  return null;
}

function DayDivider({ label }) {
  return (
    <div className="flex items-center justify-center py-1">
      <span className="text-[0.65rem] font-semibold text-slate-500 bg-slate-200/70 px-3 py-1 rounded-full">
        {label}
      </span>
    </div>
  );
}

function idOf(ref) {
  return ref && typeof ref === "object" ? ref._id : ref;
}

function messagesEqual(a, b) {
  return (
    a.messageBody === b.messageBody &&
    a.isInternalNote === b.isInternalNote &&
    (a.readBy?.length || 0) === (b.readBy?.length || 0) &&
    (a.attachments?.length || 0) === (b.attachments?.length || 0)
  );
}

// Merges a freshly-fetched message list into existing state by id instead of
// replacing the array outright. Unchanged messages keep their previous object
// reference so the memoized MessageBubble below skips re-rendering them, and
// if nothing actually changed the previous array itself is returned so
// setState bails out of the render entirely — a background re-sync that
// finds nothing new should never repaint the thread.
function mergeMessagesById(prevMessages, incomingMessages) {
  const prevById = new Map(prevMessages.map((m) => [idOf(m._id), m]));
  let changed = false;
  const merged = incomingMessages.map((incoming) => {
    const prev = prevById.get(idOf(incoming._id));
    if (prev && messagesEqual(prev, incoming)) return prev;
    changed = true;
    return incoming;
  });
  if (!changed && merged.length === prevMessages.length) return prevMessages;
  return merged;
}

// Attachment bytes are served through an authenticated endpoint (not a plain
// static URL), so we fetch them once as a blob and reuse the object URL for
// the life of the page instead of re-fetching every time a message re-renders.
const attachmentBlobCache = new Map();

async function loadAttachmentBlobUrl(messageId, attachmentId) {
  const cacheKey = `${messageId}:${attachmentId}`;
  if (attachmentBlobCache.has(cacheKey)) return attachmentBlobCache.get(cacheKey);
  const res = await messagesApi.getAttachment(messageId, attachmentId);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  attachmentBlobCache.set(cacheKey, url);
  return url;
}

function triggerBlobDownload(url, filename) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "download";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/* ─── Attachment: inline image thumbnail + lightbox, or a file chip ────── */
// Both sides of a conversation can download anything either party attached.
// Opening an image plays a soft fade/scale-in transition on the lightbox.
function AttachmentItem({ messageId, attachment }) {
  const isImage = attachment.mimeType?.startsWith("image/");
  const [url, setUrl] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | loading | ready | error
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxVisible, setLightboxVisible] = useState(false);

  const ensureLoaded = useCallback(async () => {
    if (url) return url;
    setStatus("loading");
    try {
      const loaded = await loadAttachmentBlobUrl(messageId, attachment._id);
      setUrl(loaded);
      setStatus("ready");
      return loaded;
    } catch {
      setStatus("error");
      return null;
    }
  }, [messageId, attachment._id, url]);

  // Images load eagerly so they render inline like a real chat app instead
  // of showing a placeholder the user has to click through.
  useEffect(() => {
    if (isImage) ensureLoaded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isImage]);

  // Mount the lightbox invisible, then flip to visible a frame later so the
  // opacity/scale transition actually has something to animate from.
  useEffect(() => {
    if (!lightboxOpen) return;
    const raf = requestAnimationFrame(() => setLightboxVisible(true));
    return () => cancelAnimationFrame(raf);
  }, [lightboxOpen]);

  const closeLightbox = () => {
    setLightboxVisible(false);
    setTimeout(() => setLightboxOpen(false), 150);
  };

  const handleOpen = async () => {
    const loaded = await ensureLoaded();
    if (!loaded) return;
    if (isImage) setLightboxOpen(true);
    else triggerBlobDownload(loaded, attachment.originalName);
  };

  const handleDownload = async (e) => {
    e?.stopPropagation();
    const loaded = await ensureLoaded();
    if (loaded) triggerBlobDownload(loaded, attachment.originalName);
  };

  if (isImage) {
    return (
      <>
        <button type="button" onClick={handleOpen}
          className="block w-40 h-32 rounded-xl overflow-hidden border border-slate-200 bg-slate-100 hover:brightness-95 transition">
          {status === "ready" ? (
            <img src={url} alt={attachment.originalName} className="w-full h-full object-cover" />
          ) : (
            <span className="w-full h-full flex items-center justify-center text-[0.65rem] text-slate-400">
              {status === "error" ? "Couldn't load image" : "Loading…"}
            </span>
          )}
        </button>
        {lightboxOpen && (
          <div
            className={`fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6 transition-opacity duration-200 ${lightboxVisible ? "opacity-100" : "opacity-0"}`}
            onClick={closeLightbox}>
            <img src={url} alt={attachment.originalName}
              className={`max-w-full max-h-full rounded-lg shadow-2xl transition-all duration-200 ease-out ${lightboxVisible ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}
              onClick={(e) => e.stopPropagation()} />
            <div className="absolute top-5 right-5 flex items-center gap-4">
              <button type="button" onClick={handleDownload} title="Download" className="text-white/80 hover:text-white">
                <Ic.Download />
              </button>
              <button type="button" onClick={closeLightbox} title="Close" className="text-white/80 hover:text-white">
                <IconX size={22} className="text-inherit" />
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <button type="button" onClick={handleOpen} disabled={status === "loading"}
      className="flex items-center gap-1.5 text-[0.7rem] font-semibold text-blue-600 bg-blue-50
        border border-blue-200 px-2.5 py-1 rounded-full hover:bg-blue-100 transition disabled:opacity-60">
      <Ic.File /> {attachment.originalName}
      <Ic.Download />
      {status === "loading" && " · Downloading…"}
      {status === "error" && " · Failed to download"}
    </button>
  );
}

/* ─── Thread list item ────────────────────────────────────────────────── */
function ThreadItem({ thread, isActive, onClick, isAdmin }) {
  const unread = isAdmin ? thread.unreadManager : thread.unreadClient;
  const peer   = isAdmin
    ? (thread.clientId?.displayName || thread.clientId?.email || "Client")
    : "BAIS Case Team";
  const caseLabel = thread.caseId?.caseId
    ? `${thread.caseId.caseId} — ${thread.caseId.visaType}`
    : thread.subject;

  return (
    <button onClick={onClick}
      className={`w-full flex items-start gap-3 px-4 py-4 text-left border-b border-slate-100 transition hover:bg-slate-50 cursor-pointer
        ${isActive ? "bg-emerald-50/60 border-l-2 border-l-emerald-500" : ""}`}>
      <div className="w-9 h-9 rounded-full bg-linear-to-br from-[#1D9E75] to-teal-600
        flex items-center justify-center text-white text-xs font-extrabold shrink-0">
        {initials(peer)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-bold text-slate-800 truncate">{peer}</p>
          <p className="text-[0.65rem] text-slate-400 shrink-0">{fmt(thread.lastMessageAt)}</p>
        </div>
        <p className="text-xs text-slate-500 truncate mt-0.5">{caseLabel}</p>
        {unread > 0 && (
          <span className="inline-block mt-1.5 text-[0.6rem] font-extrabold bg-emerald-500 text-white px-2 py-0.5 rounded-full">
            {unread} new
          </span>
        )}
      </div>
    </button>
  );
}

/* ─── Single message bubble ───────────────────────────────────────────── */
// Memoized so a background re-sync that leaves this message's object
// reference unchanged (see mergeMessagesById) skips re-rendering it entirely.
const MessageBubble = memo(function MessageBubble({ msg, isOwn, isAdmin, onRetry, onCancelUpload }) {
  if (msg.isInternalNote && !isAdmin) return null;

  const senderId = msg.senderId?._id || msg.senderId;
  // Two states we can honestly tell apart from the data we have: sent (grey
  // double-check) and read (blue double-check). There's no real delivery-ack
  // pipeline, so a fake "delivered" tick in between would just be theater.
  const isRead = (msg.readBy || []).some((r) => (r.userId?._id || r.userId) !== senderId);
  const isPending = Boolean(msg.__pending);
  const isFailed = Boolean(msg.__failed);

  return (
    <div className={`flex gap-3 ${isOwn ? "flex-row-reverse" : ""}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-extrabold shrink-0
        ${isOwn ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-600"}`}>
        {initials(msg.senderId?.displayName || msg.senderId?.email || "?")}
      </div>
      <div className={`max-w-[70%] space-y-1 ${isOwn ? "items-end" : "items-start"} flex flex-col`}>
        {msg.isInternalNote && (
          <span className="text-[0.6rem] font-bold text-amber-600 flex items-center gap-1">
            <Ic.Lock /> Internal Note (visible to team only)
          </span>
        )}
        {msg.attachments?.length > 0 && (
          <div className={`flex flex-wrap gap-1.5 ${isPending ? "opacity-60" : ""}`}>
            {msg.attachments.map((a, i) => (
              <AttachmentItem key={a._id || a.storedName || i} messageId={msg._id} attachment={a} />
            ))}
          </div>
        )}
        {isPending && typeof msg.__uploadProgress === "number" && (
          <div className="flex items-center gap-2 w-40">
            <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${msg.__uploadProgress}%` }} />
            </div>
            <span className="text-[0.6rem] text-slate-500 shrink-0">{msg.__uploadProgress}%</span>
            <button type="button" onClick={() => onCancelUpload?.(msg._id)} title="Cancel upload"
              className="text-slate-400 hover:text-red-500 shrink-0">
              <IconX size={11} className="text-inherit" />
            </button>
          </div>
        )}
        {msg.messageBody && (
          <div
            onClick={isFailed ? () => onRetry?.(msg) : undefined}
            className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed transition-opacity
              ${isPending ? "opacity-60" : ""} ${isFailed ? "ring-2 ring-red-300 cursor-pointer" : ""}
              ${msg.isInternalNote
                ? "bg-amber-50 border border-amber-200 text-amber-900"
                : isOwn
                  ? "bg-emerald-600 text-white rounded-tr-sm"
                  : "bg-white border border-slate-200 text-slate-800 rounded-tl-sm"}`}>
            {msg.messageBody}
          </div>
        )}
        <div className="flex items-center gap-1">
          {isFailed ? (
            <button type="button" onClick={() => onRetry?.(msg)} className="text-[0.62rem] text-red-500 font-semibold hover:underline">
              Failed to send · Tap to retry
            </button>
          ) : isPending ? (
            <span className="flex items-center gap-1 text-[0.62rem] text-slate-400">
              <Ic.Clock /> Sending…
            </span>
          ) : (
            <>
              <p className="text-[0.62rem] text-slate-400">{fmt(msg.createdAt)}</p>
              {isOwn && (
                <span className={isRead ? "text-sky-500" : "text-slate-400"} title={isRead ? "Read" : "Sent"}>
                  <Ic.DoubleCheck />
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
});

/* ─── Main Messages component ─────────────────────────────────────────── */
export default function Messages() {
  const { user }                       = useAuth();
  const socket                         = useSocket();
  const isAdmin                        = user?.role === "admin";
  const bottomRef                      = useRef(null);
  const messagesContainerRef           = useRef(null);
  const fileRef                        = useRef(null);
  const activeThreadRef                = useRef(null);
  // Tracks whether the user is scrolled near the bottom of the thread, kept
  // up to date by a scroll listener so a message arriving while someone has
  // scrolled up to read history doesn't yank them back down.
  const isNearBottomRef                = useRef(true);
  const loadingOlderRef                = useRef(false);
  const isTypingRef                    = useRef(false);
  const typingStopTimeoutRef           = useRef(null);
  const typingClearTimeoutRef          = useRef(null);
  const abortControllersRef            = useRef(new Map());
  const dragCounterRef                 = useRef(0);

  const [threads, setThreads]         = useState([]);
  const [activeThread, setActiveThread] = useState(null);
  const [messages, setMessages]       = useState([]);
  const [body, setBody]               = useState("");
  const [files, setFiles]             = useState([]);
  const [internalNote, setInternalNote] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [sendError, setSendError]     = useState(null);
  const [loading, setLoading]         = useState(true);
  const [msgLoading, setMsgLoading]   = useState(false);
  const [showMobile, setShowMobile]   = useState(false); // mobile: show conversation
  const [typingActive, setTypingActive] = useState(false); // is the other party typing right now
  const [presence, setPresence]       = useState(null); // { isOnline, lastSeenAt } for the thread's client, admin view only
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [oldestCursor, setOldestCursor] = useState(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [, setClock]                  = useState(0); // ticks to keep "Xm ago" labels live

  // Presence is only meaningful from the admin side, viewing a specific
  // client — "the BAIS Case Team" isn't a single presence-able identity.
  const presenceUserId = isAdmin ? (activeThread?.clientId?._id || activeThread?.clientId || null) : null;

  useEffect(() => { document.title = "Messages | BAIS Portal"; }, []);

  // Re-render every 30s so relative timestamps ("Just now" -> "1m ago" -> ...)
  // update on their own without needing a reload or any other state change.
  useEffect(() => {
    const id = setInterval(() => setClock((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const threadsInFlightRef = useRef(false); // mount effect, socket connect/message:new handlers, and the manual refresh button can all call this independently

  const loadThreads = useCallback(async () => {
    if (threadsInFlightRef.current) return;
    threadsInFlightRef.current = true;
    try {
      const res = await messagesApi.getThreads();
      setThreads(res.threads || []);
    } catch { /* silently fail */ }
    finally { setLoading(false); threadsInFlightRef.current = false; }
  }, []);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  // Auto-create thread from the user's own case on first mount (non-admin)
  const { data: myCase } = useMyCase({ enabled: !isAdmin });
  useEffect(() => {
    if (isAdmin || loading) return;
    if (threads.length === 0 && myCase?._id) {
      messagesApi.getOrCreateThread(myCase._id).then((res) => {
        setThreads([res.thread]);
        setActiveThread(res.thread);
      }).catch(() => {});
    }
  }, [isAdmin, loading, threads.length, myCase]);

  // `silent` distinguishes a deliberate thread open (full replace + loading
  // spinner + jump to bottom is expected) from a background re-sync of the
  // thread already on screen (merge in place, no spinner, no forced scroll —
  // see mergeMessagesById and the scroll effect below).
  const silentLoadInFlightRef = useRef(new Set()); // avoid piling up concurrent silent polls per-thread if one call is slow

  const loadMessages = useCallback(async (threadId, { silent = false } = {}) => {
    if (silent) {
      if (silentLoadInFlightRef.current.has(threadId)) return;
      silentLoadInFlightRef.current.add(threadId);
    } else {
      setMsgLoading(true);
    }
    try {
      const res = await messagesApi.getMessages(threadId, { limit: 30 });
      setMessages((prev) => (silent ? mergeMessagesById(prev, res.messages || []) : (res.messages || [])));
      setHasMoreOlder(Boolean(res.hasMore));
      setOldestCursor(res.oldestCursor || null);
      // refresh unread badges
      setThreads((prev) => prev.map((t) => t._id === threadId
        ? { ...t, unreadClient: 0, unreadManager: 0 }
        : t));
    } catch { /* silently fail */ }
    finally {
      if (silent) silentLoadInFlightRef.current.delete(threadId);
      else setMsgLoading(false);
    }
  }, []);

  // Loads the next page of older history and prepends it, compensating
  // scrollTop by the exact height the prepend added so the messages already
  // on screen don't visually jump.
  const loadOlderMessages = useCallback(async () => {
    const threadId = activeThread?._id;
    if (!threadId || !hasMoreOlder || loadingOlderRef.current || !oldestCursor) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const container = messagesContainerRef.current;
    const prevScrollHeight = container?.scrollHeight || 0;
    try {
      const res = await messagesApi.getMessages(threadId, { limit: 30, before: oldestCursor });
      const older = res.messages || [];
      if (older.length) setMessages((prev) => [...older, ...prev]);
      setHasMoreOlder(Boolean(res.hasMore));
      setOldestCursor(res.oldestCursor || oldestCursor);
      requestAnimationFrame(() => {
        if (container) container.scrollTop += container.scrollHeight - prevScrollHeight;
      });
    } catch {
      // leave hasMoreOlder as-is — scrolling near the top again will retry
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [activeThread?._id, hasMoreOlder, oldestCursor]);

  useEffect(() => {
    if (activeThread) {
      isNearBottomRef.current = true;
      loadMessages(activeThread._id);
      setShowMobile(true);
    }
  }, [activeThread, loadMessages]);

  // Track how close to the bottom the user is scrolled, so the auto-scroll
  // effect below can tell a live update apart from someone reading history.
  // Also triggers loading older history once they scroll near the top.
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const handleScroll = () => {
      isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      if (el.scrollTop < 80) loadOlderMessages();
    };
    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, [activeThread, loadOlderMessages]);

  // Keep the thread scrolled to the latest message as new ones arrive live —
  // but only if the user was already near the bottom. Someone scrolled up
  // reading history shouldn't get yanked back down by a background update.
  useEffect(() => {
    if (isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Keep a ref to the open thread so the socket handler below always sees
  // the latest selection without needing to resubscribe on every click.
  useEffect(() => { activeThreadRef.current = activeThread; }, [activeThread]);

  // Live-append incoming/outgoing messages the instant they're sent, and
  // refresh the conversation list (previews + unread badges) in real time —
  // no reload required, in either direction.
  useEffect(() => {
    if (!socket) return;
    const handleNewMessage = (message) => {
      const msgThreadId = message.conversationId || message.threadId;
      const current = activeThreadRef.current;
      if (current && msgThreadId === current._id) {
        setMessages((prev) => (prev.some((m) => m._id === message._id) ? prev : [...prev, message]));
      }
      loadThreads();
    };
    socket.on("message:new", handleNewMessage);
    return () => socket.off("message:new", handleNewMessage);
  }, [socket, loadThreads]);

  // Typing indicator: listen for the other party's typing state in the
  // currently open thread. A safety timeout auto-clears it if a "stopped
  // typing" event is ever missed (tab closed, dropped connection).
  useEffect(() => {
    if (!socket) return;
    setTypingActive(false);
    clearTimeout(typingClearTimeoutRef.current);
    const handleTyping = (payload) => {
      const current = activeThreadRef.current;
      if (!current || payload.conversationId !== current._id) return;
      const selfId = user?._id;
      if (payload.userId === selfId || payload.userId?._id === selfId) return;
      clearTimeout(typingClearTimeoutRef.current);
      if (payload.isTyping) {
        setTypingActive(true);
        typingClearTimeoutRef.current = setTimeout(() => setTypingActive(false), 5000);
      } else {
        setTypingActive(false);
      }
    };
    socket.on("message:typing", handleTyping);
    return () => socket.off("message:typing", handleTyping);
  }, [socket, activeThread?._id, user?._id]);

  // Debounced typing broadcast: announce once when the user starts typing,
  // then auto-announce "stopped" after a short pause of inactivity — instead
  // of firing a request on every keystroke.
  const emitTyping = useCallback((isTyping) => {
    const threadId = activeThread?._id;
    if (!threadId) return;
    if (isTyping) {
      if (!isTypingRef.current) {
        isTypingRef.current = true;
        messagesApi.typing(threadId, true).catch(() => {});
      }
      clearTimeout(typingStopTimeoutRef.current);
      typingStopTimeoutRef.current = setTimeout(() => {
        isTypingRef.current = false;
        messagesApi.typing(threadId, false).catch(() => {});
      }, 3000);
    } else {
      clearTimeout(typingStopTimeoutRef.current);
      if (isTypingRef.current) {
        isTypingRef.current = false;
        messagesApi.typing(threadId, false).catch(() => {});
      }
    }
  }, [activeThread?._id]);

  // Presence: fetch an initial online/last-seen snapshot when the thread's
  // client changes (push updates alone don't tell us the CURRENT state of
  // someone who was already online/offline before this component mounted).
  useEffect(() => {
    if (!presenceUserId) { setPresence(null); return; }
    setPresence(null);
    usersApi.getPresence([presenceUserId]).then((res) => {
      setPresence(res.presence?.[presenceUserId] || null);
    }).catch(() => {});
  }, [presenceUserId]);

  // Live presence updates pushed from the realtime gateway on connect/disconnect.
  useEffect(() => {
    if (!socket || !presenceUserId) return;
    const handlePresence = (payload) => {
      if (payload.userId !== presenceUserId) return;
      setPresence({ isOnline: payload.isOnline, lastSeenAt: payload.lastSeenAt || null });
    };
    socket.on("presence:update", handlePresence);
    return () => socket.off("presence:update", handlePresence);
  }, [socket, presenceUserId]);

  // A socket can silently miss messages sent during a brief disconnect
  // (network blip, tab backgrounded, token rotation). Re-sync immediately
  // whenever the socket (re)connects, instead of waiting on the next event.
  useEffect(() => {
    if (!socket) return;
    const handleConnect = () => {
      loadThreads();
      if (activeThreadRef.current) loadMessages(activeThreadRef.current._id, { silent: true });
    };
    socket.on("connect", handleConnect);
    return () => socket.off("connect", handleConnect);
  }, [socket, loadThreads, loadMessages]);

  // Safety net: even if a socket event is ever missed without a reconnect
  // firing (e.g. the tab is on a network that silently drops idle sockets),
  // keep the open conversation fresh on a short interval so nothing needs a
  // manual page refresh to show up.
  useEffect(() => {
    const id = setInterval(() => {
      if (activeThreadRef.current) loadMessages(activeThreadRef.current._id, { silent: true });
    }, 15000);
    return () => clearInterval(id);
  }, [loadMessages]);

  // Renders the message immediately (optimistically) and lets the upload
  // reconcile in the background — mirrors the admin portal's dispatch
  // pattern so sending never feels gated on round-trip latency, and so an
  // attachment upload has a bubble to show its progress bar against.
  const dispatchMessage = useCallback(async (bodyText, internalFlag, uploadFiles) => {
    const threadId = activeThread?._id;
    if (!threadId || (!bodyText && uploadFiles.length === 0)) return;

    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimisticAttachments = uploadFiles.map((file, index) => ({
      _id: `temp-att-${tempId}-${index}`,
      originalName: file.name,
      mimeType: file.type,
      size: file.size,
      __localUrl: file.type?.startsWith("image/") ? URL.createObjectURL(file) : null,
    }));
    const optimisticMessage = {
      _id: tempId,
      messageBody: bodyText,
      isInternalNote: internalFlag,
      createdAt: new Date().toISOString(),
      senderId: user,
      attachments: optimisticAttachments,
      readBy: [],
      __pending: true,
      __files: uploadFiles,
      __uploadProgress: uploadFiles.length > 0 ? 0 : null,
    };

    setMessages((prev) => [...prev, optimisticMessage]);
    setSendError(null);

    const controller = new AbortController();
    if (uploadFiles.length > 0) abortControllersRef.current.set(tempId, controller);

    try {
      const res = await messagesApi.sendMessage(threadId, bodyText, uploadFiles, internalFlag, {
        onProgress: (percent) => {
          setMessages((prev) => prev.map((m) => (m._id === tempId ? { ...m, __uploadProgress: percent } : m)));
        },
        signal: controller.signal,
      });
      abortControllersRef.current.delete(tempId);
      const sentMessage = res?.message;
      setMessages((prev) => {
        const next = prev.map((m) => {
          if (m._id !== tempId) return m;
          if (!sentMessage) return { ...m, __pending: false };
          // Keep the local object URLs on the reconciled message so images
          // that are already rendering don't flicker into a network refetch.
          const mergedAttachments = (sentMessage.attachments || []).map((serverAttachment, index) => ({
            ...serverAttachment,
            __localUrl: m.attachments?.[index]?.__localUrl,
          }));
          return { ...sentMessage, attachments: mergedAttachments };
        });
        const seen = new Set();
        return next.filter((m) => {
          if (seen.has(m._id)) return false;
          seen.add(m._id);
          return true;
        });
      });
      setThreads((prev) => prev.map((t) =>
        t._id === threadId ? { ...t, lastMessageAt: new Date().toISOString() } : t
      ));
    } catch (err) {
      abortControllersRef.current.delete(tempId);
      if (err.code === "ERR_CANCELED") {
        // User-initiated cancel — drop the pending bubble entirely rather
        // than showing a "failed" state for something they chose to stop.
        setMessages((prev) => prev.filter((m) => m._id !== tempId));
        return;
      }
      setSendError(err.message || "Failed to send message");
      setMessages((prev) => prev.map((m) => (m._id === tempId ? { ...m, __pending: false, __failed: true } : m)));
    }
  }, [activeThread?._id, user]);

  const handleSend = () => {
    const bodyText = body.trim();
    if (!bodyText && files.length === 0) return;
    const internalFlag = Boolean(isAdmin && internalNote);
    const uploadFiles = files;
    setBody("");
    setFiles([]);
    setInternalNote(false);
    emitTyping(false);
    dispatchMessage(bodyText, internalFlag, uploadFiles);
  };

  const retryMessage = useCallback((failedMessage) => {
    setMessages((prev) => prev.filter((m) => m._id !== failedMessage._id));
    dispatchMessage(failedMessage.messageBody, failedMessage.isInternalNote, failedMessage.__files || []);
  }, [dispatchMessage]);

  const cancelUpload = useCallback((tempId) => {
    const controller = abortControllersRef.current.get(tempId);
    if (controller) controller.abort();
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  /* ── Render ── */
  return (
    <div className="min-h-screen bg-[#f1f5f9] flex flex-col">
      {/* Banner */}
      <div className="bg-linear-to-r from-[#1D9E75] via-teal-600 to-blue-700 text-white shrink-0">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex items-center gap-3">
          {showMobile && activeThread && (
            <button onClick={() => setShowMobile(false)} className="sm:hidden mr-1 text-white/80 hover:text-white">
              <Ic.Back />
            </button>
          )}
          <Ic.Msg />
          <div>
            <p className="text-white/70 text-[0.7rem] font-semibold uppercase tracking-widest">Communication</p>
            <h1 className="text-xl font-extrabold leading-tight">Messages</h1>
          </div>
          <button onClick={loadThreads} className="ml-auto text-white/70 hover:text-white transition" title="Refresh">
            <Ic.Refresh />
          </button>
        </div>
      </div>

      {/* Below the banner, the message pane is edge-to-edge on mobile (no
          side margins, no inset card) and only gets the padded/rounded card
          treatment from the sm breakpoint up. */}
      <div className="flex-1 min-h-0 flex flex-col sm:max-w-6xl sm:w-full sm:mx-auto sm:px-6 sm:py-6">
        <div className="bg-white flex-1 min-h-0 flex sm:rounded-2xl sm:border sm:border-slate-200 sm:shadow-sm overflow-hidden">

          {/* ── Thread list (sidebar) ── */}
          <div className={`w-full sm:w-72 border-r border-slate-100 flex flex-col shrink-0
            ${showMobile ? "hidden sm:flex" : "flex"}`}>
            <div className="px-4 py-3.5 border-b border-slate-100 flex items-center justify-between">
              <p className="font-extrabold text-slate-800 text-sm">Conversations</p>
              <span className="text-xs text-slate-400">{threads.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center h-24">
                  <div className="w-6 h-6 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
                </div>
              ) : threads.length === 0 ? (
                <div className="py-12 text-center px-4">
                  <Ic.Msg />
                  <p className="text-sm text-slate-400 mt-2">No conversations yet.</p>
                </div>
              ) : (
                threads.map((t) => (
                  <ThreadItem key={t._id} thread={t} isAdmin={isAdmin}
                    isActive={activeThread?._id === t._id}
                    onClick={() => setActiveThread(t)} />
                ))
              )}
            </div>
          </div>

          {/* ── Conversation view ── */}
          <div
            className={`relative flex-1 flex flex-col min-w-0
            ${!showMobile && !activeThread ? "hidden sm:flex" : "flex"}`}
            onDragEnter={(e) => {
              if (!activeThread) return;
              e.preventDefault();
              dragCounterRef.current += 1;
              setIsDraggingFiles(true);
            }}
            onDragOver={(e) => {
              if (!activeThread) return;
              e.preventDefault();
            }}
            onDragLeave={(e) => {
              if (!activeThread) return;
              e.preventDefault();
              dragCounterRef.current -= 1;
              if (dragCounterRef.current <= 0) {
                dragCounterRef.current = 0;
                setIsDraggingFiles(false);
              }
            }}
            onDrop={(e) => {
              if (!activeThread) return;
              e.preventDefault();
              dragCounterRef.current = 0;
              setIsDraggingFiles(false);
              const dropped = Array.from(e.dataTransfer.files || []);
              if (dropped.length) setFiles((prev) => [...prev, ...dropped]);
            }}
          >
            {isDraggingFiles && (
              <div className="absolute inset-0 z-20 bg-emerald-50/90 border-2 border-dashed border-emerald-400 rounded-lg flex flex-col items-center justify-center pointer-events-none">
                <Ic.Attach />
                <p className="text-emerald-700 font-semibold mt-2">Drop files to attach</p>
              </div>
            )}
            {!activeThread ? (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-3">
                <Ic.Msg />
                <p className="text-sm font-medium">Select a conversation to view messages</p>
              </div>
            ) : (
              <>
                {/* Conversation header */}
                <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-3">
                  <button onClick={() => setShowMobile(false)} className="sm:hidden text-slate-500 hover:text-slate-800">
                    <Ic.Back />
                  </button>
                  <div className="relative shrink-0">
                    <div className="w-9 h-9 rounded-full bg-linear-to-br from-[#1D9E75] to-teal-600 flex items-center justify-center text-white text-xs font-extrabold">
                      {isAdmin ? initials(activeThread.clientId?.displayName || activeThread.clientId?.email || "C") : "US"}
                    </div>
                    {presence?.isOnline && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-extrabold text-slate-800 text-sm truncate">
                      {isAdmin
                        ? (activeThread.clientId?.displayName || activeThread.clientId?.email || "Client")
                        : "BAIS Case Team"}
                    </p>
                    <p className="text-xs truncate">
                      {typingActive ? (
                        <span className="text-emerald-600 font-semibold">
                          {isAdmin ? "Client" : "BAIS Case Team"} is typing…
                        </span>
                      ) : presenceLabel(presence) ? (
                        <span className={presence?.isOnline ? "text-emerald-600 font-semibold" : "text-slate-400"}>
                          {presenceLabel(presence)}
                        </span>
                      ) : (
                        <span className="text-slate-400">{activeThread.subject}</span>
                      )}
                    </p>
                  </div>
                  <button onClick={() => loadMessages(activeThread._id)} className="ml-auto text-slate-400 hover:text-slate-700 transition">
                    <Ic.Refresh />
                  </button>
                </div>

                {/* Messages */}
                <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
                  {msgLoading ? (
                    <div className="flex items-center justify-center h-24">
                      <div className="w-6 h-6 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="text-center py-12 text-slate-400">
                      <p className="text-sm">No messages yet. Send the first message below.</p>
                    </div>
                  ) : (
                    <>
                      {loadingOlder && (
                        <div className="flex items-center justify-center py-2">
                          <div className="w-4 h-4 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
                        </div>
                      )}
                      {(() => {
                        let lastDayKey = null;
                        return messages.map((msg) => {
                          const dayKey = new Date(msg.createdAt).toDateString();
                          const showDivider = dayKey !== lastDayKey;
                          lastDayKey = dayKey;
                          return (
                            <Fragment key={msg._id}>
                              {showDivider && <DayDivider label={dayLabel(msg.createdAt)} />}
                              <MessageBubble msg={msg} isAdmin={isAdmin}
                                isOwn={msg.senderId?._id === user?._id || msg.senderId === user?._id}
                                onRetry={retryMessage} onCancelUpload={cancelUpload} />
                            </Fragment>
                          );
                        });
                      })()}
                    </>
                  )}
                  <div ref={bottomRef} />
                </div>

                {/* Admin: internal note toggle */}
                {isAdmin && (
                  <div className="px-4 pt-2 flex items-center gap-2">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input type="checkbox" id="messages-internal-note" name="internalNote" checked={internalNote} onChange={(e) => setInternalNote(e.target.checked)}
                        className="accent-amber-500 w-4 h-4" />
                      <span className="text-xs font-bold text-amber-600 flex items-center gap-1">
                        <Ic.Lock /> Internal Note (not visible to client)
                      </span>
                    </label>
                  </div>
                )}

                {/* Attached files preview */}
                {files.length > 0 && (
                  <div className="px-4 py-2 flex flex-wrap gap-1.5 border-t border-slate-100">
                    {files.map((f, i) => (
                      <span key={i} className="flex items-center gap-1.5 text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-1 rounded-full font-semibold">
                        <Ic.File /> {f.name}
                        <button onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} className="ml-1 text-blue-400 hover:text-red-500"><IconX size={12} className="text-inherit" /></button>
                      </span>
                    ))}
                  </div>
                )}

                {sendError && (
                  <div className="px-4 py-2 text-xs font-semibold text-red-600 border-t border-red-100 bg-red-50">
                    {sendError}
                  </div>
                )}

                {/* Reply box */}
                <div className={`px-4 py-3 border-t flex items-end gap-2
                  ${internalNote ? "border-amber-200 bg-amber-50/30" : "border-slate-100 bg-slate-50/60"}`}>
                  <textarea
                    id="messages-body"
                    name="messageBody"
                    value={body}
                    onChange={(e) => {
                      setBody(e.target.value);
                      emitTyping(e.target.value.trim().length > 0);
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder={internalNote ? "Write an internal note (team only)…" : "Type your message… (Enter to send)"}
                    rows={2}
                    className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-slate-800
                      resize-none outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 transition"
                  />
                  <div className="flex flex-col gap-2 shrink-0">
                    <button onClick={() => fileRef.current?.click()} title="Attach file"
                      className="w-9 h-9 rounded-xl bg-white border border-slate-200 text-slate-500 flex items-center justify-center hover:bg-slate-100 transition">
                      <Ic.Attach />
                    </button>
                    <button onClick={handleSend} disabled={!body.trim() && files.length === 0}
                      className="w-9 h-9 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center
                        transition disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-emerald-200">
                      <Ic.Send />
                    </button>
                  </div>
                  <input ref={fileRef} type="file" id="messages-attachments" name="attachments" multiple className="hidden"
                    onChange={(e) => setFiles((prev) => [...prev, ...Array.from(e.target.files)])} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
