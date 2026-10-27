import { useCallback, useEffect, useState } from "react";
import { petitionReviewApi } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { useSocket } from "../../context/SocketContext";
import PetitionThread from "../../components/petition/PetitionThread";
import PetitionViewer from "../../components/petition/PetitionViewer";
import { prefetchPetition, waitUntilReady } from "../../components/petition/usePetitionStream";

const dateLabel = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "";
};
const timeLabel = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
};

const Svg = ({ children, size = 18, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>{children}</svg>
);
const FileIcon = (props) => <Svg {...props}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h5" /></Svg>;
const EyeIcon = (props) => <Svg {...props}><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></Svg>;
const DownloadIcon = (props) => <Svg {...props}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></Svg>;
const ChatIcon = (props) => <Svg {...props}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></Svg>;

function ChatWindow({ item, onClose, onChanged }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-3 sm:p-6" onClick={onClose}>
      <div className="flex h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl" role="dialog" aria-modal="true" aria-label={`Feedback for ${item.fileName}`} onClick={(event) => event.stopPropagation()}>
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-foreground">Feedback</h2>
            <p className="truncate text-xs text-muted-foreground">{item.fileName} · Case {item.caseNumber}</p>
          </div>
          <button type="button" onClick={onClose} title="Close" aria-label="Close" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground transition hover:bg-secondary"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg></button>
        </header>
        <PetitionThread documentId={item.documentId} onChanged={onChanged} />
      </div>
    </div>
  );
}

function PetitionRow({ item, myId, onView, onDownload, onChat }) {
  const { latest, total, unread } = item.messages;
  return (
    <li className="rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/30 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><FileIcon size={20} /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-extrabold tracking-tight text-foreground sm:text-xl">{item.fileName}</p>
          <p className="text-xs text-muted-foreground">Case {item.caseNumber} · Sent for your review {dateLabel(item.clientReview?.sentAt)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => onView(item)} onMouseEnter={() => prefetchPetition(item.documentId)} onFocus={() => prefetchPetition(item.documentId)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"><EyeIcon size={16} /> View</button>
          <button type="button" onClick={() => onDownload(item)} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-semibold text-foreground transition hover:bg-secondary"><DownloadIcon size={16} /> Download</button>
          <button type="button" onClick={() => onChat(item)} className="relative inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-semibold text-foreground transition hover:bg-secondary">
            <ChatIcon size={16} /> Feedback
            {unread > 0 && <span className="ml-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground" aria-label={`${unread} unread`}>{unread}</span>}
          </button>
        </div>
      </div>

      {/* the latest feedback sits under the row, in the same card; opening it shows the whole conversation */}
      <button type="button" onClick={() => onChat(item)} className="mt-3 block w-full rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-left transition hover:border-primary/50 hover:bg-primary/10" aria-label={`Open the feedback conversation for ${item.fileName}`}>
        <span className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-primary">
          <span>Latest feedback{total > latest.length ? ` · ${latest.length} of ${total}` : ""}</span>
          <span className="normal-case">Open conversation</span>
        </span>
        {latest.length === 0 ? (
          <span className="mt-1 block text-[13px] text-muted-foreground">No feedback yet. Open the petition and use the Feedback panel to tell your case manager what you would like changed.</span>
        ) : (
          <span className="mt-1.5 block space-y-0.5">
            {latest.map((message) => (
              <span key={message._id} className="flex gap-2 text-[13px] leading-snug">
                <span className="w-24 shrink-0 truncate font-semibold text-foreground sm:w-32">{String(message.authorId) === myId ? "You" : message.authorName || "Case manager"}</span>
                <span className="min-w-0 flex-1 truncate text-foreground/80">{message.body}</span>
                <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{timeLabel(message.createdAt)}</span>
              </span>
            ))}
          </span>
        )}
      </button>
    </li>
  );
}

// The petitions the case manager sent for my review. Only the case's petition audience sees anything here: the single applicant, the petitioner of a family case, the employer
// of an employer-employee case. View opens the petition across most of the screen with a Feedback column beside it; Feedback opens the whole conversation.
export default function Petition() {
  const { user } = useAuth();
  const socket = useSocket();
  const myId = String(user?._id || "");
  const [state, setState] = useState({ status: "loading", items: [], error: "" });
  const [viewing, setViewing] = useState(null);
  const [chatting, setChatting] = useState(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setState((current) => ({ ...current, status: "loading", error: "" }));
    try {
      const response = await petitionReviewApi.list();
      setState({ status: "ready", items: response?.data?.items || [], error: "" });
    } catch (error) {
      setState((current) => (silent ? current : { status: "error", items: [], error: error?.message || "We could not load your petitions." }));
    }
  }, []);

  useEffect(() => { document.title = "Petition | Immiglance"; load(); }, [load]);

  // live: a new case-manager message or a newly released petition shows up without a reload
  useEffect(() => {
    if (!socket) return undefined;
    let timer = null;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => load({ silent: true }), 300); };
    socket.on("petition:message", refresh);
    socket.on("petition:review", refresh);
    return () => { clearTimeout(timer); socket.off("petition:message", refresh); socket.off("petition:review", refresh); };
  }, [socket, load]);

  // Download goes through the same prepared stream as the viewer: no request time limit, retried quietly until the server has the file ready
  const download = useCallback(async (item) => {
    setNotice("");
    try {
      const token = await waitUntilReady(item.documentId);
      const anchor = document.createElement("a");
      anchor.href = petitionReviewApi.streamUrl(token, { download: true });
      anchor.download = item.fileName || "petition.pdf";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (error) {
      setNotice(error?.status === 404 ? "This petition is no longer available." : "We could not prepare the download just yet. Please try again in a moment.");
    }
  }, []);

  const refreshQuietly = useCallback(() => load({ silent: true }), [load]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Petition</h1>
        <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Your case manager shares the petition prepared for your case here. Read it, download a copy, and tell us what you would like changed in the Feedback panel.
        </p>
      </header>

      {notice && <p role="alert" className="mb-4 rounded-lg border border-border bg-card px-4 py-2 text-sm text-destructive">{notice}</p>}

      {state.status === "loading" ? (
        <ul className="space-y-3" aria-hidden="true">{[0, 1].map((key) => <li key={key} className="h-44 animate-pulse rounded-2xl border border-border bg-secondary/60" />)}</ul>
      ) : state.status === "error" ? (
        <div role="alert" className="rounded-2xl border border-border bg-card p-10 text-center">
          <p className="font-semibold text-foreground">We could not load your petitions</p>
          <p className="mt-1 text-sm text-muted-foreground">{state.error}</p>
          <button type="button" onClick={() => load()} className="mt-5 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Try again</button>
        </div>
      ) : state.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
          <FileIcon size={36} className="mx-auto text-muted-foreground" />
          <p className="mt-3 font-semibold text-foreground">No petition is ready for your review yet</p>
          <p className="mt-1 text-sm text-muted-foreground">When your case manager sends the petition for your review it appears here, and we will email you.</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {state.items.map((item) => (
            <PetitionRow key={item.documentId} item={item} myId={myId} onView={setViewing} onDownload={download} onChat={setChatting} />
          ))}
        </ul>
      )}

      {viewing && <PetitionViewer item={viewing} onClose={() => { setViewing(null); refreshQuietly(); }} onChanged={refreshQuietly} onDownload={download} />}
      {chatting && <ChatWindow item={chatting} onClose={() => { setChatting(null); refreshQuietly(); }} onChanged={refreshQuietly} />}
    </div>
  );
}
