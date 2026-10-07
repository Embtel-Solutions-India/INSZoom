import { useRef, useState } from "react";

export const ADDITIONAL_DOCUMENT_TYPE = "additional_document";

const formatSize = (bytes) => {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// "Additional documents": anything the client wants to give their case team that does not belong to a checklist
// question. These are stored on the case as documentType "additional_document" - they never fill, or count toward, a
// checklist row - and the case team sees them under that name in the case's documents.
export default function AdditionalDocuments({ documents = [], onUpload, onRemove, disabled = false }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removingId, setRemovingId] = useState("");

  const handleFiles = async (event) => {
    const selected = Array.from(event.target.files || []);
    if (inputRef.current) inputRef.current.value = "";
    if (!selected.length) return;
    setBusy(true);
    setError("");
    const failed = [];
    for (const file of selected) {
      try {
        await onUpload(file, "supporting", ADDITIONAL_DOCUMENT_TYPE);
      } catch (err) {
        failed.push(`${file.name}${err?.message ? ` (${err.message})` : ""}`);
      }
    }
    if (failed.length) setError(`These files could not be uploaded: ${failed.join(", ")}. Please try them again.`);
    setBusy(false);
  };

  const handleRemove = async (doc) => {
    if (!window.confirm(`Remove "${doc.originalName || doc.fileName || "this document"}"?`)) return;
    setRemovingId(doc._id);
    setError("");
    try {
      await onRemove(doc._id);
    } catch (err) {
      setError(err?.message || "Could not remove this document.");
    } finally {
      setRemovingId("");
    }
  };

  return (
    <section className="rounded-xl border border-border bg-card p-5" data-testid="additional-documents">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground">Additional documents</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Have something that does not fit any question above? Upload it here and your case team will see it with your case. You can add as many as you need.
          </p>
        </div>
        <div>
          <input ref={inputRef} type="file" multiple className="hidden" onChange={handleFiles} disabled={disabled || busy} data-testid="additional-documents-input" />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || busy}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Uploading…" : "Upload documents"}
          </button>
        </div>
      </div>

      {error && <p role="alert" className="mt-3 text-sm font-medium text-destructive">{error}</p>}

      {documents.length > 0 ? (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
          {documents.map((doc) => (
            <li key={doc._id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{doc.originalName || doc.fileName || "Document"}</p>
                <p className="text-xs text-muted-foreground">
                  {[formatSize(doc.fileSize || doc.size), doc.createdAt ? new Date(doc.createdAt).toLocaleDateString() : ""].filter(Boolean).join(" · ")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleRemove(doc)}
                disabled={disabled || removingId === doc._id}
                className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-destructive transition hover:bg-destructive/10 disabled:opacity-50"
              >
                {removingId === doc._id ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">No additional documents yet.</p>
      )}
    </section>
  );
}
