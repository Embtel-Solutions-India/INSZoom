import { useCallback, useEffect, useRef, useState } from "react";
import { petitionReviewApi } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { useSocket } from "../../context/SocketContext";

const timeLabel = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : date.toLocaleDateString([], { month: "short", day: "numeric" }) + ", " + date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

const newClientId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0, 60);

function Bubble({ message, mine, onRetry }) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[92%] ${mine ? "items-end" : "items-start"} flex flex-col gap-0.5`}>
        <div
          className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[13px] leading-snug shadow-sm [overflow-wrap:anywhere] ${
            mine ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md border border-border bg-secondary text-foreground"
          } ${message.failed ? "opacity-70 ring-1 ring-destructive" : ""}`}
        >
          {message.body}
        </div>
        <div className="flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
          {!mine && <span className="font-semibold">{message.authorName || "Case manager"}</span>}
          <span>{message.pending ? "Sending…" : timeLabel(message.createdAt)}</span>
          {message.failed && <button type="button" onClick={() => onRetry(message)} className="font-semibold text-destructive hover:underline">Retry</button>}
        </div>
      </div>
    </div>
  );
}

// The feedback conversation of one petition: the client writes what should change, the case manager answers - live. Used beside the petition viewer (compact) and in the full
// chat window. Enter sends, Shift+Enter adds a line. A send that fails stays in the thread with a Retry; a retried send is never posted twice (clientMessageId).
export default function PetitionThread({ documentId, compact = false, onChanged }) {
  const { user } = useAuth();
  const socket = useSocket();
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const bottomRef = useRef(null);
  const myId = String(user?._id || "");

  const markRead = useCallback(() => {
    petitionReviewApi.markRead(documentId).then(() => onChanged?.()).catch(() => {});
  }, [documentId, onChanged]);

  const load = useCallback(async () => {
    setStatus("loading");
    setError("");
    try {
      const response = await petitionReviewApi.messages(documentId, { limit: 100 });
      setMessages(response?.data?.messages || []);
      setStatus("ready");
      markRead();
    } catch (err) {
      setError(err?.message || "We could not load the feedback.");
      setStatus("error");
    }
  }, [documentId, markRead]);

  useEffect(() => { load(); }, [load]);

  // live: the case manager's answer (and this client's own messages from another tab) appear without a reload
  useEffect(() => {
    if (!socket) return undefined;
    const onMessage = (payload) => {
      if (String(payload?.documentId) !== String(documentId) || !payload.message) return;
      setMessages((current) => (current.some((row) => row._id === payload.message._id) ? current : [...current.filter((row) => !(row.pending && row.body === payload.message.body && row.authorId === payload.message.authorId)), payload.message]));
      if (payload.message.authorId !== myId) markRead();
    };
    socket.on("petition:message", onMessage);
    return () => socket.off("petition:message", onMessage);
  }, [socket, documentId, myId, markRead]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: "end" }); }, [messages.length, status]);

  const submit = useCallback(async (body, clientMessageId, existingTempId) => {
    const tempId = existingTempId || `temp-${clientMessageId}`;
    setMessages((current) => {
      const rest = current.filter((row) => row._id !== tempId);
      return [...rest, { _id: tempId, documentId, authorId: myId, authorName: "", body, createdAt: new Date().toISOString(), pending: true, clientMessageId }];
    });
    try {
      const response = await petitionReviewApi.send(documentId, body, clientMessageId);
      const saved = response?.data?.message;
      setMessages((current) => {
        const rest = current.filter((row) => row._id !== tempId && row._id !== saved?._id);
        return saved ? [...rest, saved] : rest;
      });
      onChanged?.();
    } catch (err) {
      setMessages((current) => current.map((row) => (row._id === tempId ? { ...row, pending: false, failed: true } : row)));
      setError(err?.message || "Your message could not be sent.");
    }
  }, [documentId, myId, onChanged]);

  const send = () => {
    const body = text.trim();
    if (!body) return;
    setText("");
    setError("");
    submit(body, newClientId());
  };

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${compact ? "" : "bg-card"}`}>
      <div className={`min-h-0 flex-1 space-y-2.5 overflow-y-auto ${compact ? "px-3 py-3" : "px-4 py-4"}`} aria-live="polite" aria-label="Petition feedback messages">
        {status === "loading" && <p className="py-6 text-center text-xs text-muted-foreground">Loading feedback…</p>}
        {status === "error" && (
          <div role="alert" className="py-6 text-center text-xs">
            <p className="text-muted-foreground">{error}</p>
            <button type="button" onClick={load} className="mt-2 font-semibold text-primary hover:underline">Try again</button>
          </div>
        )}
        {status === "ready" && messages.length === 0 && (
          <p className="py-6 text-center text-xs leading-relaxed text-muted-foreground">No feedback yet. Tell your case manager what you would like changed in the petition.</p>
        )}
        {messages.map((message) => (
          <Bubble key={message._id} message={message} mine={String(message.authorId) === myId} onRetry={(row) => submit(row.body, row.clientMessageId || newClientId(), row._id)} />
        ))}
        <div ref={bottomRef} />
      </div>
      {error && status === "ready" && <p role="alert" className="px-3 pb-1 text-[11px] text-destructive">{error}</p>}
      <div className={`shrink-0 border-t border-border ${compact ? "p-2.5" : "p-3"}`}>
        <label className="sr-only" htmlFor={`petition-feedback-${documentId}`}>Your feedback</label>
        <textarea
          id={`petition-feedback-${documentId}`}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }}
          rows={compact ? 3 : 3}
          maxLength={4000}
          placeholder="Write your feedback…"
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/15"
        />
        <button
          type="button"
          onClick={send}
          disabled={!text.trim()}
          className="mt-2 w-full rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
