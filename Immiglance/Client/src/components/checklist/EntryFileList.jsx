import { useRef, useState } from "react";
import { MAX_FILES_PER_ROW, formatBytes, planUpload } from "../../utils/uploadLimits";

// One checklist row's uploads: "Entry 1, Entry 2, ..." (name, size, remove)
// plus an "Add entry" button (disabled at MAX_FILES_PER_ROW). Used by BOTH the
// questionnaire file questions (QuestionInput) and the legacy document-baseline
// rows (DocumentUploadControl) so every checklist document row behaves the same.
//
// entries: [{ id, name, size, mimeType, url }]. onAdd(files[]) may throw; the
// message is shown inline. onRemove(entry) likewise.
export default function EntryFileList({ inputId, entries = [], disabled = false, busy = false, onAdd, onRemove, lockedLabel = "Uploads are locked" }) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState("");
  const [removingId, setRemovingId] = useState("");
  const full = entries.length >= MAX_FILES_PER_ROW;
  const blocked = disabled || busy || full;

  const handleFiles = async (fileList) => {
    const picked = Array.from(fileList || []);
    if (!picked.length) return;
    const { accepted, error: planError } = planUpload(picked, entries.length);
    setError(planError);
    if (!accepted.length) return;
    try {
      await onAdd(accepted);
    } catch (addError) {
      setError(addError?.message || "Upload failed. Please try again.");
    }
  };

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

  const addLabel = entries.length ? "Add entry" : "Upload file";

  return (
    <div className="space-y-2">
      {entries.length > 0 && (
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
              {busy ? "Uploading…" : `+ ${addLabel}`}
            </button>
            <p className="text-[0.65rem] text-muted-foreground">
              {full
                ? `Maximum of ${MAX_FILES_PER_ROW} entries reached`
                : `${entries.length} of ${MAX_FILES_PER_ROW} entries · any file type · up to ${formatBytes(50 * 1024 * 1024)} each`}
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
