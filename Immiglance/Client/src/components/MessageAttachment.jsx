import { useEffect, useState } from "react";
import { FileTypeIcon } from "./AttachmentViewer";
import { fileKind } from "../utils/attachmentKind";
import { formatFileSize } from "../utils/chunkedUpload";

// How one attachment looks inside a message bubble: an image thumbnail for pictures, otherwise a chip
// (type icon, name, size). Clicking either opens it in the AttachmentViewer (via onOpen) - nothing downloads by itself.
//
// A just-sent attachment carries its local File (`__localFile`), so it is visible and openable instantly.
// While it is still going up, `attachment.__upload` = { status: 'queued' | 'uploading' | 'done' | 'error', progress: 0..1 }
// and a progress bar (plus a cancel X) is drawn on it.

// Big images are not fetched just to draw a thumbnail; they show as a chip.
const THUMBNAIL_MAX_BYTES = 20 * 1024 * 1024;

function useThumbnailUrl(enabled, attachment, messageId, loadBlob) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  const local = attachment.__localFile;
  useEffect(() => {
    if (!enabled) return undefined;
    let objectUrl = null;
    let stale = false;
    const show = (blob) => { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); };
    if (local) show(local);
    else if (messageId && attachment._id) {
      loadBlob(messageId, attachment._id).then((blob) => { if (!stale) show(blob); }).catch(() => { if (!stale) setFailed(true); });
    }
    return () => { stale = true; if (objectUrl) URL.revokeObjectURL(objectUrl); setUrl(null); };
  }, [enabled, local, messageId, attachment._id, loadBlob]);
  return { url, failed };
}

function ProgressBar({ progress, className = "" }) {
  const percent = Math.round((progress || 0) * 100);
  return (
    <div className={`h-1 bg-border/80 overflow-hidden ${className}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${percent}%` }} />
    </div>
  );
}

const CloseIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.25" d="M6 6l12 12M18 6L6 18" /></svg>
);

// `messageId` is null while the message is still local (sending / failed): only its local File can be opened then.
export default function MessageAttachment({ attachment, messageId, loadBlob, onOpen, onCancel }) {
  const name = attachment.originalName || "attachment";
  const kind = fileKind(name, attachment.mimeType);
  const upload = attachment.__upload || null;
  const inFlight = upload && (upload.status === "queued" || upload.status === "uploading");
  const bytes = attachment.fileSize || attachment.size || attachment.__localFile?.size;
  const showThumb = kind === "image" && (!bytes || bytes <= THUMBNAIL_MAX_BYTES);
  const { url, failed } = useThumbnailUrl(showThumb, attachment, messageId, loadBlob);
  const local = attachment.__localFile;
  const canOpen = Boolean(local || (messageId && attachment._id));

  const open = (event) => {
    event.stopPropagation();
    if (!canOpen) return;
    onOpen({
      name,
      size: bytes,
      mimeType: attachment.mimeType || local?.type,
      getBlob: local
        ? async () => local
        : ({ signal, onProgress } = {}) => loadBlob(messageId, attachment._id, { signal, onProgress }),
    });
  };
  const cancel = (event) => { event.stopPropagation(); onCancel?.(attachment); };

  const cancelButton = inFlight && onCancel && (
    <button type="button" onClick={cancel} aria-label={`Cancel upload of ${name}`} title="Cancel upload"
      className="shrink-0 p-1 rounded-full text-muted-foreground hover:text-destructive hover:bg-secondary transition-colors">
      <CloseIcon />
    </button>
  );

  if (showThumb) {
    return (
      <div className="relative w-36 h-28 sm:w-40 sm:h-32 rounded-xl overflow-hidden border border-border bg-secondary">
        <button type="button" onClick={open} disabled={!canOpen} title={name} className="block w-full h-full hover:brightness-95 transition">
          {url ? (
            <img src={url} alt={name} className="w-full h-full object-cover" />
          ) : (
            <span className="w-full h-full flex items-center justify-center text-[11px] text-muted-foreground">
              {failed ? "Couldn't load" : "Loading…"}
            </span>
          )}
        </button>
        {inFlight && (
          <>
            <div className="absolute top-1 right-1 rounded-full bg-card/90 text-foreground shadow">{cancelButton}</div>
            <ProgressBar progress={upload.progress} className="absolute inset-x-0 bottom-0" />
          </>
        )}
        {upload?.status === "error" && (
          <span className="absolute inset-x-0 bottom-0 bg-destructive/90 text-destructive-foreground text-[10px] font-semibold text-center py-0.5">Upload failed</span>
        )}
      </div>
    );
  }

  const sizeLabel = formatFileSize(bytes);
  let status = sizeLabel;
  if (upload?.status === "queued") status = `${sizeLabel} · Waiting…`;
  else if (upload?.status === "uploading") status = `${sizeLabel} · Uploading ${Math.round((upload.progress || 0) * 100)}%`;
  else if (upload?.status === "error") status = `${sizeLabel} · Upload failed`;

  return (
    <div className="relative w-60 max-w-full rounded-lg border border-border bg-card text-foreground overflow-hidden">
      <div className="flex items-center gap-1 pr-1.5">
        <button type="button" onClick={open} disabled={!canOpen} title={name}
          className="flex items-center gap-2 min-w-0 flex-1 text-left px-2.5 py-2 hover:bg-accent transition-colors">
          <FileTypeIcon kind={kind} className="w-5 h-5 text-primary shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">{name}</span>
            {status ? <span className={`block truncate text-[11px] ${upload?.status === "error" ? "text-destructive" : "text-muted-foreground"}`}>{status}</span> : null}
          </span>
        </button>
        {cancelButton}
      </div>
      {inFlight && <ProgressBar progress={upload.progress} />}
    </div>
  );
}
