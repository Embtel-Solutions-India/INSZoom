import { useState, useEffect, useRef, useCallback, memo, Fragment } from "react";
import { useAuth } from "../../context/AuthContext";
import { useSocket } from "../../context/SocketContext";
import { chunkApi, messagesApi, usersApi } from "../../services/api";
import { useMyCase } from "../../hooks/useMyCaseProfile";
import { IconX } from "../../utils/iconComponents";
import { attachmentProblem, formatFileSize, isChunkedFile, MAX_ATTACHMENTS_PER_MESSAGE, uploadFileInChunks } from "../../utils/chunkedUpload";
import AttachmentViewer from "../../components/AttachmentViewer";
import MessageAttachment from "../../components/MessageAttachment";

/* ─── Icons ────────────────────────────────────────────────────────────── */
const Ic = {
  Send:    () => <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>,
  Attach:  () => <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>,
  Lock:    () => <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>,
  Back:    () => <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"/></svg>,
  Refresh: () => <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>,
  File:    () => <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>,
  Reply:   () => <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 14L4 9l5-5M4 9h10a6 6 0 016 6v4"/></svg>,
  Msg:     () => <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>,
  CheckCheck: () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" className="shrink-0 overflow-visible"><path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/></svg>,
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

function formatTime(iso) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
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
      <span className="text-[0.65rem] font-semibold text-muted-foreground bg-secondary px-3 py-1 rounded-full">
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

// Messages that exist only in this browser so far (still sending, or failed
// and waiting for a tap-to-retry). A re-sync of the thread from the server must
// not wipe them out, unless the server list already holds that very message
// (matched by clientMessageId).
function localOnlyMessages(prevMessages, incomingMessages, threadId) {
  const incomingIds = new Set(incomingMessages.map((m) => idOf(m._id)));
  const incomingClientIds = new Set(incomingMessages.map((m) => m.clientMessageId).filter(Boolean));
  return prevMessages.filter((m) =>
    (m.__pending || m.__failed) &&
    (!threadId || m.__threadId === threadId) &&
    !incomingIds.has(idOf(m._id)) &&
    !incomingClientIds.has(m.__clientMessageId)
  );
}

// Merges a freshly-fetched message list into existing state by id instead of
// replacing the array outright. Unchanged messages keep their previous object
// reference so the memoized MessageBubble below skips re-rendering them, and
// if nothing actually changed the previous array itself is returned so
// setState bails out of the render entirely — a background re-sync that
// finds nothing new should never repaint the thread.
function mergeMessagesById(prevMessages, incomingMessages, threadId) {
  const prevById = new Map(prevMessages.map((m) => [idOf(m._id), m]));
  let changed = false;
  const merged = incomingMessages.map((incoming) => {
    const prev = prevById.get(idOf(incoming._id));
    if (prev && messagesEqual(prev, incoming)) return prev;
    changed = true;
    return incoming;
  });
  const next = [...merged, ...localOnlyMessages(prevMessages, incomingMessages, threadId)];
  if (!changed && next.length === prevMessages.length && next.every((m, i) => m === prevMessages[i])) return prevMessages;
  return next;
}

// The server's copy of a message replaces its optimistic bubble. The local File
// of each attachment is carried over (the server keeps small-then-big order, the
// same order the optimistic bubble uses) so what was just sent opens and shows
// at once instead of being downloaded back. If the bubble is already gone (a socket echo or a re-sync
// swapped it for the real message first) there is nothing to do, and a copy of
// the saved message is never left behind twice.
function applySavedMessage(prevMessages, tempId, saved) {
  const optimistic = prevMessages.find((m) => m._id === tempId);
  if (!optimistic) return prevMessages;
  const merged = {
    ...saved,
    __parent: optimistic.__parent, // the quoted original of a reply, kept from the bubble the user saw
    attachments: (saved.attachments || []).map((serverAttachment, index) => ({
      ...serverAttachment,
      __localFile: optimistic.attachments?.[index]?.__localFile,
    })),
  };
  return prevMessages.flatMap((m) => {
    if (m._id === tempId) return [merged];
    if (m._id === saved._id || (saved.clientMessageId && m.clientMessageId === saved.clientMessageId)) return [];
    return [m];
  });
}

// A socket echo of a message this browser is still sending takes the place of
// its optimistic bubble (matched by clientMessageId) instead of appearing twice.
function applyIncomingMessage(prevMessages, incoming) {
  if (prevMessages.some((m) => m._id === incoming._id)) return prevMessages;
  const clientMessageId = incoming.clientMessageId;
  const index = clientMessageId ? prevMessages.findIndex((m) => m.__clientMessageId === clientMessageId) : -1;
  if (index === -1) return [...prevMessages, incoming];
  const optimistic = prevMessages[index];
  const replacement = {
    ...incoming,
    __parent: optimistic.__parent,
    // The echo carries the sender as a bare id; keep the populated author from the optimistic bubble.
    senderId: incoming.senderId && typeof incoming.senderId === "object" ? incoming.senderId : optimistic.senderId,
    attachments: (incoming.attachments || []).map((serverAttachment, i) => ({
      ...serverAttachment,
      __localFile: optimistic.attachments?.[i]?.__localFile,
    })),
  };
  return prevMessages.map((m, i) => (i === index ? replacement : m));
}

// Delivery: every attempt for one message carries the same clientMessageId, so
// the backend returns the stored message for a repeat instead of duplicating it.
const RETRY_DELAYS_MS = [2000, 5000, 10000];

const newClientMessageId = () =>
  globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

// Worth retrying: the request never got an answer (offline / timeout) or the server hit an error. A 4xx is final.
const isRetryableSendError = (err) =>
  Boolean(err?.isNetworkError || err?.isTimeout) || err?.status >= 500 || err?.status === 408 || err?.status === 429;

const isCanceledError = (err) => err?.code === "ERR_CANCELED" || Boolean(err?.cancelled);

async function sendWithRetry(post, signal) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await post();
    } catch (err) {
      if (isCanceledError(err) || signal?.aborted || attempt >= RETRY_DELAYS_MS.length || !isRetryableSendError(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      if (signal?.aborted) {
        const canceled = new Error("Upload canceled");
        canceled.code = "ERR_CANCELED";
        throw canceled;
      }
    }
  }
}

// Attachment bytes are served through an authenticated endpoint (not a plain static URL), so they are fetched as a Blob.
// Small ones are kept so a thumbnail and the viewer never download the same file twice; big ones are never held on to.
const BLOB_CACHE_MAX_BYTES = 25 * 1024 * 1024;
const attachmentBlobCache = new Map();

// Reads the response body, reporting 0..1 progress when the server sent a Content-Length.
async function readBlobWithProgress(res, onProgress) {
  const total = Number(res.headers?.get?.("content-length")) || 0;
  if (!res.body?.getReader || !total || !onProgress) return res.blob();
  const reader = res.body.getReader();
  const parts = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    received += value.length;
    onProgress(Math.min(1, received / total));
  }
  return new Blob(parts, { type: res.headers.get("content-type") || "" });
}

async function loadAttachmentBlob(messageId, attachmentId, { signal, onProgress } = {}) {
  const cacheKey = `${messageId}:${attachmentId}`;
  if (attachmentBlobCache.has(cacheKey)) return attachmentBlobCache.get(cacheKey);
  // Always pass a signal: without one the shared client aborts any request after 25 s, mid-download for a big file.
  const res = await messagesApi.getAttachment(messageId, attachmentId, { signal: signal || AbortSignal.timeout(10 * 60 * 1000) });
  const blob = await readBlobWithProgress(res, onProgress);
  if (blob.size <= BLOB_CACHE_MAX_BYTES) attachmentBlobCache.set(cacheKey, blob);
  return blob;
}

// The chunked uploader owns the /chunked-uploads calls; this wrapper only notes the uploadId the moment the
// server hands it out, so a failed upload is resumed (resumeUploadId) rather than restarted when the message is retried.
function trackingChunkApi(entry) {
  return {
    get: (...args) => chunkApi.get(...args),
    put: (...args) => chunkApi.put(...args),
    delete: (...args) => chunkApi.delete(...args),
    post: async (url, ...rest) => {
      const response = await chunkApi.post(url, ...rest);
      if (url === "/chunked-uploads" && response.data?.uploadId) entry.partialId = response.data.uploadId;
      return response;
    },
  };
}

/* ─── Thread list item ────────────────────────────────────────────────── */
function ThreadItem({ thread, isActive, onClick, isAdmin }) {
  const unread = isAdmin ? thread.unreadManager : thread.unreadClient;
  const peer   = isAdmin
    ? (thread.clientId?.displayName || thread.clientId?.email || "Client")
    : "Immiglance Case Team";
  const caseLabel = thread.caseId?.caseId
    ? `${thread.caseId.caseId} — ${thread.caseId.visaType}`
    : thread.subject;

  return (
    <button onClick={onClick}
      className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left border-b border-border border-l-2 transition cursor-pointer
        ${isActive ? "bg-primary/10 border-l-primary" : "border-l-transparent hover:bg-secondary"}`}>
      <div className="w-8 h-8 rounded-full bg-primary
        flex items-center justify-center text-primary-foreground text-[11px] font-bold shrink-0">
        {initials(peer)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-bold text-foreground truncate">{peer}</p>
          <p className="text-[10px] text-muted-foreground shrink-0">{fmt(thread.lastMessageAt)}</p>
        </div>
        <p className="text-[11px] text-muted-foreground truncate">{caseLabel}</p>
        {unread > 0 && (
          <span className="inline-block mt-1 text-[10px] font-bold bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
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
const MessageBubble = memo(function MessageBubble({ msg, isOwn, isAdmin, onRetry, onCancelUpload, onOpenAttachment, onReply }) {
  if (msg.isInternalNote && !isAdmin) return null;

  const senderId = msg.senderId?._id || msg.senderId;
  // Two states we can honestly tell apart from the data we have: sent (muted
  // double-check) and read (light-blue double-check). There's no real
  // delivery-ack pipeline, so a fake "delivered" tick in between would just be theater.
  const readers = (msg.readBy || []).filter((r) => (r.userId?._id || r.userId) !== senderId);
  const isRead = readers.length > 0;
  const isPending = Boolean(msg.__pending);
  const isFailed = Boolean(msg.__failed);
  const readerNames = readers.map((r) => r.userId?.displayName || r.userId?.name).filter(Boolean);
  const tickTitle = isRead
    ? `Read${readerNames.length ? ` by ${readerNames.join(", ")}` : ""}${readers[0]?.readAt ? ` · ${new Date(readers[0].readAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}`
    : "Sent";

  // A reply from the case team arrives with its original message populated.
  const parent = msg.__parent || (msg.replyTo && typeof msg.replyTo === "object" ? msg.replyTo : null);

  const note = Boolean(msg.isInternalNote);
  // Own messages: the brand colour softened (dark mode: a muted tint of it with light text — the solid colour is too bright for a large surface).
  const avatarClasses = isOwn
    ? "bg-primary/80 text-primary-foreground dark:bg-primary/25 dark:text-primary"
    : "bg-secondary text-secondary-foreground";
  const bubbleClasses = note
    ? "bg-amber-50 border border-amber-200 text-amber-900"
    : isOwn
      ? "bg-primary/80 text-primary-foreground dark:bg-primary/20 dark:text-foreground dark:border dark:border-primary/30 rounded-tr-sm"
      : "bg-card border border-border text-card-foreground rounded-tl-sm";
  const metaClasses = isOwn && !note ? "text-primary-foreground/70 dark:text-muted-foreground" : "text-muted-foreground";
  const quoteOwn = isOwn && !note;
  const quoteClasses = quoteOwn ? "bg-black/20 border-l-primary-foreground/60 dark:border-l-primary" : "bg-secondary border-l-primary";
  const hasAttachments = msg.attachments?.length > 0;

  return (
    <div className={`group flex gap-2 ${isOwn ? "flex-row-reverse" : ""}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 shadow-sm ${avatarClasses}`}>
        {initials(msg.senderId?.displayName || msg.senderId?.email || "?")}
      </div>
      <div className={`max-w-[85%] sm:max-w-[75%] gap-1 ${isOwn ? "items-end" : "items-start"} flex flex-col`}>
        {msg.isInternalNote && (
          <span className="text-[10px] font-bold text-amber-600 flex items-center gap-1">
            <Ic.Lock /> Internal Note (visible to team only)
          </span>
        )}
        {(msg.messageBody || hasAttachments) && (
          <div
            onClick={isFailed ? () => onRetry?.(msg) : undefined}
            className={`px-3 pt-2 pb-1.5 rounded-2xl text-[13px] leading-snug shadow-sm max-w-full
              ${isFailed ? "ring-2 ring-destructive/50 cursor-pointer" : ""} ${bubbleClasses}`}>
            {parent && (
              <div className={`mb-1.5 rounded-lg border-l-4 px-2.5 py-1.5 ${quoteClasses}`}>
                <p className={`text-[11px] font-semibold truncate ${quoteOwn ? "text-primary-foreground dark:text-primary" : "text-primary"}`}>
                  {parent.senderName || "Message"}
                </p>
                <p className={`text-[12px] line-clamp-2 break-words ${quoteOwn ? "text-primary-foreground/80 dark:text-muted-foreground" : "text-muted-foreground"}`}>
                  {parent.messageBody || parent.message || "Attachment"}
                </p>
              </div>
            )}
            {hasAttachments && (
              <div className={`flex flex-wrap items-start gap-1.5 ${msg.messageBody ? "mb-1.5" : ""}`}>
                {msg.attachments.map((a, i) => (
                  <MessageAttachment
                    key={a._id || a.storedName || i}
                    attachment={a}
                    messageId={isPending || isFailed ? null : msg._id}
                    loadBlob={loadAttachmentBlob}
                    onOpen={onOpenAttachment}
                    onCancel={isPending ? () => onCancelUpload?.(msg._id) : undefined}
                  />
                ))}
              </div>
            )}
            {msg.messageBody && <p className="whitespace-pre-wrap break-words">{msg.messageBody}</p>}
            {/* Time (and, for our own messages, the delivery tick) at the bottom-right of the bubble, like WhatsApp. The read receipt lives in the tick's tooltip. */}
            <div className={`mt-0.5 flex items-center justify-end gap-1 whitespace-nowrap pr-1 text-[10px] leading-none ${metaClasses}`}>
              <span>{formatTime(msg.createdAt)}</span>
              {isOwn && !isFailed && (
                <span title={tickTitle} aria-label={isRead ? "Read" : "Sent"} className={`inline-flex ${isRead ? (quoteOwn ? "text-sky-300" : "text-sky-500") : ""}`}>
                  <Ic.CheckCheck />
                </span>
              )}
            </div>
          </div>
        )}
        {isFailed && (
          <button type="button" onClick={() => onRetry?.(msg)} className="text-[11px] text-destructive font-semibold hover:underline">
            Failed to send · Tap to retry
          </button>
        )}
      </div>
      {!isPending && !isFailed && onReply && (
        <button type="button" onClick={() => onReply(msg)} title="Reply" aria-label="Reply"
          className="self-end mb-1 p-1.5 rounded-full text-muted-foreground hover:text-primary hover:bg-secondary sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition-opacity shrink-0">
          <Ic.Reply />
        </button>
      )}
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
  const textareaRef                    = useRef(null);
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
  const sendQueueRef                   = useRef(Promise.resolve()); // one chain: sends are delivered in the order they were typed
  const dragCounterRef                 = useRef(0);
  // Per sending message (keyed by its bubble id): what has been uploaded so far for each file. It outlives a failed
  // attempt, so a retry skips finished uploads (uploadId) and resumes a partial one (partialId) instead of starting over.
  const uploadEntriesRef               = useRef(new Map());

  const [threads, setThreads]         = useState([]);
  const [activeThread, setActiveThread] = useState(null);
  const [messages, setMessages]       = useState([]);
  const [body, setBody]               = useState("");
  const [files, setFiles]             = useState([]);
  const [internalNote, setInternalNote] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [sendError, setSendError]     = useState(null);
  const [attachNotice, setAttachNotice] = useState(null); // why a file was not added (too many / too big / empty)
  const [replyingTo, setReplyingTo] = useState(null); // { _id, senderName, messageBody } of the message being replied to
  const [viewer, setViewer]           = useState(null); // attachment open in the centered viewer
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
  // client — "the Immiglance Case Team" isn't a single presence-able identity.
  const presenceUserId = isAdmin ? (activeThread?.clientId?._id || activeThread?.clientId || null) : null;

  useEffect(() => { document.title = "Messages | Immiglance"; }, []);

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
      // Messages still being sent (or failed, waiting for a retry) are kept; only the server's list is replaced.
      setMessages((prev) => {
        const incoming = res.messages || [];
        return silent ? mergeMessagesById(prev, incoming, threadId) : [...incoming, ...localOnlyMessages(prev, incoming, threadId)];
      });
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
        setMessages((prev) => applyIncomingMessage(prev, message));
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

  // The message shows up in the thread (as sent) the moment it is submitted;
  // delivery happens in the background through ONE queue, so sends reach the
  // server in the order they were typed and the composer is never locked while
  // one is in flight. Small files ride along as multipart; big ones are first
  // uploaded in chunks (progress per file in the bubble) and referenced by
  // `uploadIds`. A failed delivery is retried automatically (network / 5xx only);
  // once those run out the bubble turns red and a tap re-sends it. Every attempt
  // carries the same clientMessageId, so the backend never stores a message twice.
  // `resend` is a failed bubble being re-sent in place.
  const dispatchMessage = useCallback((bodyText, internalFlag, uploadFiles, resend = null, replyParent = null) => {
    const threadId = resend?.__threadId || activeThread?._id;
    if (!threadId || (!bodyText && uploadFiles.length === 0)) return;

    const tempId = resend?._id || `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const clientMessageId = resend?.__clientMessageId || newClientMessageId();
    const parent = resend ? resend.__parent || null : replyParent;

    // The server stores multipart files first, then the staged (chunked) ones: the bubble uses the same order.
    let entries = uploadEntriesRef.current.get(tempId);
    if (!entries) {
      const ordered = [...uploadFiles.filter((f) => !isChunkedFile(f)), ...uploadFiles.filter(isChunkedFile)];
      entries = ordered.map((file) => ({ file, big: isChunkedFile(file), uploadId: null, partialId: null, done: false }));
      uploadEntriesRef.current.set(tempId, entries);
    }
    const optimisticAttachments = entries.map((entry, index) => ({
      _id: `temp-att-${tempId}-${index}`,
      originalName: entry.file.name,
      mimeType: entry.file.type,
      size: entry.file.size,
      fileSize: entry.file.size,
      __localFile: entry.file,
      __upload: entry.done ? { status: "done", progress: 1 } : { status: "queued", progress: 0 },
    }));
    const optimisticMessage = {
      _id: tempId,
      messageBody: bodyText,
      __parent: parent,
      isInternalNote: internalFlag,
      createdAt: resend?.createdAt || new Date().toISOString(),
      senderId: user,
      attachments: optimisticAttachments,
      readBy: [],
      __pending: true,
      __files: uploadFiles,
      __threadId: threadId,
      __clientMessageId: clientMessageId,
    };

    if (!resend) isNearBottomRef.current = true; // your own message always scrolls into view
    setMessages((prev) => (prev.some((m) => m._id === tempId)
      ? prev.map((m) => (m._id === tempId ? optimisticMessage : m))
      : [...prev, optimisticMessage]));
    setSendError(null);

    const controller = new AbortController();
    if (entries.length > 0) abortControllersRef.current.set(tempId, controller);

    const setUpload = (index, patch) => setMessages((prev) => prev.map((m) => (m._id !== tempId ? m : {
      ...m,
      attachments: m.attachments.map((a, i) => (i === index ? { ...a, __upload: { ...a.__upload, ...patch } } : a)),
    })));

    const post = async () => {
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        if (!entry.big || entry.done) continue;
        setUpload(index, { status: "uploading" });
        const uploaded = await uploadFileInChunks(trackingChunkApi(entry), entry.file, {
          signal: controller.signal,
          resumeUploadId: entry.partialId,
          onProgress: (fraction) => setUpload(index, { progress: fraction }),
        });
        entry.uploadId = uploaded.uploadId;
        entry.done = true;
        setUpload(index, { status: "done", progress: 1 });
      }
      const smallIndexes = entries.flatMap((entry, index) => (entry.big ? [] : [index]));
      smallIndexes.forEach((index) => setUpload(index, { status: "uploading" }));
      return messagesApi.sendMessage(threadId, bodyText, entries.filter((e) => !e.big).map((e) => e.file), internalFlag, {
        clientMessageId,
        replyTo: parent?._id,
        uploadIds: entries.filter((e) => e.big).map((e) => e.uploadId),
        onProgress: (percent) => smallIndexes.forEach((index) => setUpload(index, { progress: percent / 100 })),
        signal: controller.signal,
      });
    };

    const failBubble = () => setMessages((prev) => prev.map((m) => (m._id !== tempId ? m : {
      ...m,
      __pending: false,
      __failed: true,
      attachments: (m.attachments || []).map((a) => (a.__upload?.status === "done" ? a : { ...a, __upload: { ...a.__upload, status: "error" } })),
    })));

    sendQueueRef.current = sendQueueRef.current.then(async () => {
      if (controller.signal.aborted) return; // canceled while waiting its turn (the bubble is already gone)
      try {
        const res = await sendWithRetry(post, controller.signal);
        abortControllersRef.current.delete(tempId);
        uploadEntriesRef.current.delete(tempId);
        const sentMessage = res?.message;
        setMessages((prev) => (sentMessage
          ? applySavedMessage(prev, tempId, sentMessage)
          : prev.map((m) => (m._id === tempId ? { ...m, __pending: false } : m))));
        setThreads((prev) => prev.map((t) =>
          t._id === threadId ? { ...t, lastMessageAt: new Date().toISOString() } : t
        ));
      } catch (err) {
        abortControllersRef.current.delete(tempId);
        if (isCanceledError(err) || controller.signal.aborted) {
          // User-initiated cancel — drop the pending bubble entirely rather
          // than showing a "failed" state for something they chose to stop.
          uploadEntriesRef.current.delete(tempId);
          setMessages((prev) => prev.filter((m) => m._id !== tempId));
          return;
        }
        setSendError(err.userMessage || err.message || "Failed to send message");
        failBubble();
      }
    });
  }, [activeThread?._id, user]);

  // Single-line composer that grows with its content (up to its max-height).
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [body, activeThread]);

  // Adds chosen / dropped files to the composer: at most MAX_ATTACHMENTS_PER_MESSAGE, none empty or over the size limit.
  const addFiles = useCallback((incoming) => {
    const list = Array.from(incoming || []);
    if (!list.length) return;
    const problems = [];
    const accepted = [];
    list.forEach((file) => {
      const problem = attachmentProblem(file);
      if (problem) problems.push(problem);
      else accepted.push(file);
    });
    const room = Math.max(0, MAX_ATTACHMENTS_PER_MESSAGE - files.length);
    if (accepted.length > room) {
      problems.push(`You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files to one message.${room ? ` Only the first ${room} of your selection ${room === 1 ? "was" : "were"} added.` : ""}`);
    }
    if (accepted.length) setFiles([...files, ...accepted.slice(0, room)]);
    setAttachNotice(problems.length ? problems.join(" ") : null);
  }, [files]);

  const handleSend = () => {
    const bodyText = body.trim();
    if (!bodyText && files.length === 0) return;
    const internalFlag = Boolean(isAdmin && internalNote);
    const uploadFiles = files;
    setBody("");
    setFiles([]);
    setAttachNotice(null);
    setInternalNote(false);
    emitTyping(false);
    const parent = replyingTo;
    setReplyingTo(null);
    dispatchMessage(bodyText, internalFlag, uploadFiles, null, parent);
  };

  // Re-sends a failed bubble in place, with the SAME clientMessageId as its earlier attempts.
  const retryMessage = useCallback((failedMessage) => {
    dispatchMessage(failedMessage.messageBody, failedMessage.isInternalNote, failedMessage.__files || [], failedMessage);
  }, [dispatchMessage]);

  const cancelUpload = useCallback((tempId) => {
    const controller = abortControllersRef.current.get(tempId);
    if (!controller) return;
    controller.abort();
    uploadEntriesRef.current.delete(tempId);
    setMessages((prev) => prev.filter((m) => m._id !== tempId));
  }, []);

  const startReply = useCallback((message) => {
    const own = (message.senderId?._id || message.senderId) === user?._id;
    setReplyingTo({
      _id: message._id,
      senderName: message.senderName || message.senderId?.displayName || message.senderId?.email || (own ? user?.displayName : null) || "Immiglance Case Team",
      messageBody: message.messageBody || message.message || (message.attachments?.length ? "Attachment" : ""),
    });
    textareaRef.current?.focus();
  }, [user]);

  // A reply quotes a message of the open conversation: drop it when the conversation changes.
  useEffect(() => { setReplyingTo(null); }, [activeThread?._id]);

  const openAttachment = useCallback((info) => setViewer(info), []);
  const closeViewer = useCallback(() => setViewer(null), []);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  /* ── Render ── */
  return (
    // The portal's top bar is 4rem tall and <main> has no padding, so the chat card takes exactly the rest of the viewport.
    <div className="h-[calc(100dvh-4rem)] min-h-[420px] bg-card flex overflow-hidden">

      {/* ── Thread list (sidebar) ── */}
      <div className={`w-full sm:w-72 border-r border-border flex flex-col shrink-0
        ${showMobile ? "hidden sm:flex" : "flex"}`}>
        <div className="px-3 py-2 border-b border-border flex items-center gap-2 shrink-0">
          <span className="text-primary"><Ic.Msg /></span>
          <h1 className="font-serif text-sm font-bold text-foreground leading-tight">Messages</h1>
          <span className="text-[11px] text-muted-foreground">{threads.length}</span>
          <button onClick={loadThreads} className="ml-auto text-muted-foreground hover:text-foreground transition" title="Refresh">
            <Ic.Refresh />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-24">
              <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            </div>
          ) : threads.length === 0 ? (
            <div className="py-12 text-center px-4">
              <Ic.Msg />
              <p className="text-[13px] text-muted-foreground mt-2">No conversations yet.</p>
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
          addFiles(e.dataTransfer.files);
        }}
      >
        {isDraggingFiles && (
          <div className="absolute inset-0 z-20 bg-primary/10 border-2 border-dashed border-primary rounded-lg flex flex-col items-center justify-center pointer-events-none">
            <Ic.Attach />
            <p className="text-primary text-sm font-semibold mt-2">Drop files to attach</p>
          </div>
        )}
        {!activeThread ? (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
            <Ic.Msg />
            <p className="text-[13px] font-medium">Select a conversation to view messages</p>
          </div>
        ) : (
          <>
            {/* Conversation header */}
            <div className="px-3 sm:px-4 py-2 border-b border-border flex items-center gap-2.5 shrink-0">
              <button onClick={() => setShowMobile(false)} className="sm:hidden text-muted-foreground hover:text-foreground">
                <Ic.Back />
              </button>
              <div className="relative shrink-0">
                <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-[11px] font-bold">
                  {isAdmin ? initials(activeThread.clientId?.displayName || activeThread.clientId?.email || "C") : "US"}
                </div>
                {presence?.isOnline && (
                  <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-card" />
                )}
              </div>
              <div className="min-w-0">
                <p className="font-bold text-foreground text-[13px] leading-tight truncate">
                  {isAdmin
                    ? (activeThread.clientId?.displayName || activeThread.clientId?.email || "Client")
                    : "Immiglance Case Team"}
                </p>
                <p className="text-[11px] leading-tight truncate">
                  {typingActive ? (
                    <span className="text-primary font-semibold">
                      {isAdmin ? "Client" : "Immiglance Case Team"} is typing…
                    </span>
                  ) : presenceLabel(presence) ? (
                    <span className={presence?.isOnline ? "text-primary font-semibold" : "text-muted-foreground"}>
                      {presenceLabel(presence)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{activeThread.subject}</span>
                  )}
                </p>
              </div>
              <button onClick={() => loadMessages(activeThread._id)} title="Refresh" className="ml-auto text-muted-foreground hover:text-foreground transition">
                <Ic.Refresh />
              </button>
            </div>

            {/* Messages */}
            <div ref={messagesContainerRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 sm:px-4 space-y-3">
              {msgLoading ? (
                <div className="flex items-center justify-center h-24">
                  <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                </div>
              ) : messages.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <p className="text-[13px]">No messages yet. Send the first message below.</p>
                </div>
              ) : (
                <>
                  {loadingOlder && (
                    <div className="flex items-center justify-center py-2">
                      <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
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
                            onRetry={retryMessage} onCancelUpload={cancelUpload} onOpenAttachment={openAttachment} onReply={startReply} />
                        </Fragment>
                      );
                    });
                  })()}
                </>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Composer, docked at the bottom: attachments / errors above, then ONE slim row (attach, text, send). */}
            <div className={`px-3 py-2 sm:px-4 border-t shrink-0 space-y-1.5
              ${internalNote ? "border-amber-200 bg-amber-50/30" : "border-border bg-card"}`}>
              {/* Admin: internal note toggle */}
              {isAdmin && (
                <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
                  <input type="checkbox" id="messages-internal-note" name="internalNote" checked={internalNote} onChange={(e) => setInternalNote(e.target.checked)}
                    className="accent-amber-500 w-4 h-4" />
                  <span className="text-[11px] font-bold text-amber-600 flex items-center gap-1">
                    <Ic.Lock /> Internal Note (not visible to client)
                  </span>
                </label>
              )}

              {/* Attached files preview */}
              {files.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {files.map((f, i) => (
                    <span key={`${f.name}-${i}`} className="flex items-center gap-1.5 text-[11px] bg-secondary text-foreground border border-border px-2.5 py-1 rounded-full font-medium max-w-full break-all">
                      <Ic.File /> {f.name}
                      <span className="text-muted-foreground font-normal">{formatFileSize(f.size)}</span>
                      <button type="button" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} className="ml-0.5 text-muted-foreground hover:text-destructive"><IconX size={12} className="text-inherit" /></button>
                    </span>
                  ))}
                </div>
              )}

              {replyingTo && (
                <div data-testid="reply-bar" className="flex items-center justify-between gap-2 rounded-lg bg-secondary border border-border px-3 py-1.5">
                  <p className="text-[11px] text-muted-foreground truncate">
                    Replying to <span className="font-semibold text-foreground">{replyingTo.senderName}</span>
                    {replyingTo.messageBody ? <span> · {replyingTo.messageBody}</span> : null}
                  </p>
                  <button type="button" onClick={() => setReplyingTo(null)} className="shrink-0 text-[11px] font-semibold text-muted-foreground hover:text-foreground">
                    Cancel
                  </button>
                </div>
              )}

              {attachNotice && (
                <div role="status" data-testid="attach-notice" className="px-3 py-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300 rounded-lg bg-amber-500/10 border border-amber-500/30">
                  {attachNotice}
                </div>
              )}

              {sendError && (
                <div role="alert" className="px-3 py-1.5 text-[11px] font-semibold text-destructive rounded-lg bg-destructive/10 border border-destructive/20">
                  {sendError}
                </div>
              )}

              <div className="flex items-end gap-1 rounded-lg border border-border bg-background px-1.5 py-1 focus-within:ring-2 focus-within:ring-ring/30 focus-within:border-ring transition-all">
                <button type="button" onClick={() => fileRef.current?.click()} title="Attach file" aria-label="Attach file"
                  className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                  <Ic.Attach />
                </button>
                <textarea
                  id="messages-body"
                  name="messageBody"
                  ref={textareaRef}
                  value={body}
                  onChange={(e) => {
                    setBody(e.target.value);
                    emitTyping(e.target.value.trim().length > 0);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={internalNote ? "Write an internal note (team only)…" : "Type your message… (Enter to send)"}
                  rows={1}
                  className="block flex-1 min-w-0 resize-none !border-0 !bg-transparent px-1 py-1.5 text-base sm:text-[13px] leading-5 text-foreground
                    placeholder:text-muted-foreground outline-none focus:ring-0 max-h-32"
                />
                <button type="button" onClick={handleSend} disabled={!body.trim() && files.length === 0}
                  title={replyingTo ? "Send reply" : "Send"} aria-label="Send"
                  className="shrink-0 p-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed">
                  <Ic.Send />
                </button>
                <input ref={fileRef} type="file" id="messages-attachments" name="attachments" multiple className="hidden"
                  onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
              </div>
            </div>
          </>
        )}
      </div>

      {viewer && <AttachmentViewer {...viewer} onClose={closeViewer} />}
    </div>
  );
}
