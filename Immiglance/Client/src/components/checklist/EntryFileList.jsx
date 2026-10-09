import { useEffect, useRef, useState } from "react";
import { MAX_FILES_PER_ROW, formatBytes, planUpload } from "../../utils/uploadLimits";

// One checklist row's uploads: "Entry 1, Entry 2, ..." (name, size, remove)
// plus an "Add entry" button (disabled at MAX_FILES_PER_ROW). Used by BOTH the
// questionnaire file questions (QuestionInput) and the legacy document-baseline
// rows (DocumentUploadControl) so every checklist document row behaves the same.
//
// entries: [{ id, name, size, mimeType, url }]. onAdd(files[]) may throw; the
// message is shown inline. onRemove(entry) likewise.
//
// Uploads are OPTIMISTIC: a picked file shows up as an entry at once ("Uploading...") and is sent in the background, so the person never
// waits on the server. A failed send (timeout, dropped connection, 5xx) is retried automatically a few times with a growing pause; a
// rejection that retrying cannot fix (4xx: file too large, blocked type) fails straight away. A file that still failed stays listed with
// its reason and a Retry button; nothing is silently lost.
const RETRY_DELAYS_MS = [1500, 4000, 9000];
const isRetryable = (error) => !error?.status || error.status >= 500 || error.status === 408 || error.status === 429;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let localSeq = 0;

export default function EntryFileList({ inputId, entries = [], disabled = false, busy = false, onAdd, onRemove, lockedLabel = "Uploads are locked" }) {
  const inputRef = useRef(null);
  const mounted = useRef(true);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState("");
  const [removingId, setRemovingId] = useState("");
  const [pending, setPending] = useState([]); // { id, file, status: "uploading" | "retrying" | "failed", attempt, message }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const total = entries.length + pending.length;
  const full = total >= MAX_FILES_PER_ROW;
  const blocked = disabled || full;

  const patchPending = (id, patch) => { if (mounted.current) setPending((list) => list.map((item) => (item.id === id ? { ...item, ...patch } : item))); };
  const dropPending = (id) => { if (mounted.current) setPending((list) => list.filter((item) => item.id !== id)); };

  // One file's background upload with automatic retries.
  const send = async (id, file) => {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      patchPending(id, { status: attempt ? "retrying" : "uploading", attempt, message: "" });
      try {
        await onAdd([file]);
        dropPending(id);
        return;
      } catch (uploadError) {
        const last = attempt === RETRY_DELAYS_MS.length || !isRetryable(uploadError);
        if (last) {
          patchPending(id, { status: "failed", message: uploadError?.message || "Upload failed." });
          return;
        }
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  };

  const handleFiles = async (fileList) => {
    const picked = Array.from(fileList || []);
    if (!picked.length) return;
    const { accepted, error: planError } = planUpload(picked, total);
    setError(planError);
    if (!accepted.length) return;
    // show every accepted file immediately, then upload them in the background (one request each, so one bad file never fails the rest)
    const items = accepted.map((file) => ({ id: `local-${localSeq += 1}`, file, status: "uploading", attempt: 0, message: "" }));
    setPending((list) => [...list, ...items]);
    items.forEach((item) => { send(item.id, item.file); });
  };

  const retryNow = (item) => { send(item.id, item.file); };

  const remove = async (entry) => {
    setRemovingId(entry.id);
    setError("");
    try {
      await onRemove(entry);
    } catch (removeError) {
      setError(removeError?.message || "Unable to remove this entry. Please try again.");
    } finally {
      setRemovingId("");
    }
  };

  const addLabel = total ? "Add entry" : "Upload file";

  return (
    <div className="space-y-2">
      {total > 0 && (
        <ul className="space-y-1.5">
          {entries.map((entry, index) => (
            <li key={entry.id || index} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-border bg-card px-3 py-2 text-xs">
              <span className="shrink-0 font-semibold text-muted-foreground">Entry {index + 1}</span>
              <span className="min-w-0 flex-1 basis-32 truncate font-medium text-foreground" title={entry.name}>{entry.name}</span>
              {entry.size ? <span className="shrink-0 text-muted-foreground">{formatBytes(entry.size)}</span> : null}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(entry)}
                  disabled={removingId === entry.id || busy}
                  aria-label={`Remove entry ${index + 1}: ${entry.name}`}
                  className="shrink-0 rounded px-1.5 py-1 font-semibold text-muted-foreground hover:text-destructive disabled:opacity-50"
                >
                  {removingId === entry.id ? "Removing…" : "Remove"}
                </button>
              )}
            </li>
          ))}
          {pending.map((item, index) => (
            <li key={item.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-border bg-card px-3 py-2 text-xs" data-testid="pending-upload">
              <span className="shrink-0 font-semibold text-muted-foreground">Entry {entries.length + index + 1}</span>
              <span className="min-w-0 flex-1 basis-32 truncate font-medium text-foreground" title={item.file.name}>{item.file.name}</span>
              <span className="shrink-0 text-muted-foreground">{formatBytes(item.file.size)}</span>
              {item.status === "failed" ? (
                <>
                  <span className="shrink-0 font-semibold text-destructive" title={item.message}>Not uploaded</span>
                  <button type="button" onClick={() => retryNow(item)} className="shrink-0 rounded px-1.5 py-1 font-semibold text-foreground hover:underline">Retry</button>
                  <button type="button" onClick={() => dropPending(item.id)} className="shrink-0 rounded px-1.5 py-1 font-semibold text-muted-foreground hover:text-destructive">Dismiss</button>
                </>
              ) : (
                <span className="shrink-0 font-semibold text-muted-foreground">{item.status === "retrying" ? `Retrying (${item.attempt}/${RETRY_DELAYS_MS.length})…` : "Uploading…"}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div
        onDragOver={(event) => { if (!blocked) { event.preventDefault(); setDrag(true); } }}
        onDragLeave={() => setDrag(false)}
        onDrop={(event) => { event.preventDefault(); setDrag(false); if (!blocked) handleFiles(event.dataTransfer.files); }}
        className={`flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-3 py-3 text-center transition ${drag ? "border-ring bg-accent" : "border-border bg-secondary"} ${disabled ? "opacity-60" : ""}`}
      >
        {disabled ? (
          <p className="text-xs font-medium text-muted-foreground">{entries.length ? lockedLabel : "Uploads are locked"}</p>
        ) : (
          <>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={blocked}
              className="min-h-9 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {`+ ${addLabel}`}
            </button>
            <p className="text-[0.65rem] text-muted-foreground">
              {full
                ? `Maximum of ${MAX_FILES_PER_ROW} entries reached`
                : `${total} of ${MAX_FILES_PER_ROW} entries · any file type · up to ${formatBytes(50 * 1024 * 1024)} each`}
            </p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          id={inputId}
          name={inputId}
          multiple
          className="hidden"
          disabled={blocked}
          onChange={(event) => { const picked = event.target.files; handleFiles(picked).finally(() => { event.target.value = ""; }); }}
        />
      </div>

      {error && <p role="alert" className="text-xs font-semibold text-destructive">{error}</p>}
    </div>
  );
}
