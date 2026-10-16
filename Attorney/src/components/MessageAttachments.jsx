import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { FileTypeIcon, fileKind } from './AttachmentViewer'
import { formatFileSize } from '../utils/chunkedUpload'

// How one attachment looks inside a message bubble: an image thumbnail for
// pictures, otherwise a chip (type icon, name, size). Clicking either opens it
// in the AttachmentViewer (via onOpen) - nothing downloads by itself.
//
// While a big file is still being uploaded in chunks, `attachment.__upload`
// = { status: 'queued' | 'uploading' | 'done' | 'error', progress: 0..1 } and a
// progress bar (plus a cancel X) is drawn on it.

// Big images are not fetched just to draw a thumbnail; they show as a chip.
const THUMBNAIL_MAX_BYTES = 20 * 1024 * 1024

function useThumbnailUrl(enabled, attachment, feedbackId, loadBlob) {
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)
  const local = attachment.__localFile
  useEffect(() => {
    if (!enabled) return undefined
    let objectUrl = null
    let stale = false
    setFailed(false)
    const show = (blob) => { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl) }
    if (local) show(local)
    else if (feedbackId && attachment._id) {
      loadBlob(feedbackId, attachment._id).then((blob) => { if (!stale) show(blob) }).catch(() => { if (!stale) setFailed(true) })
    }
    return () => { stale = true; if (objectUrl) URL.revokeObjectURL(objectUrl); setUrl(null) }
  }, [enabled, local, feedbackId, attachment._id, loadBlob])
  return { url, failed }
}

function ProgressBar({ progress, className = '' }) {
  return (
    <div className={`h-1 bg-border/80 overflow-hidden ${className}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress || 0) * 100)}>
      <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${Math.round((progress || 0) * 100)}%` }} />
    </div>
  )
}

export default function MessageAttachment({ attachment, feedbackId, loadBlob, onOpen, onCancel }) {
  const name = attachment.originalName || 'attachment'
  const kind = fileKind(name, attachment.mimeType)
  const upload = attachment.__upload || null
  const inFlight = upload && (upload.status === 'queued' || upload.status === 'uploading')
  const showThumb = kind === 'image' && (!attachment.fileSize || attachment.fileSize <= THUMBNAIL_MAX_BYTES)
  const { url, failed } = useThumbnailUrl(showThumb, attachment, feedbackId, loadBlob)
  const local = attachment.__localFile
  const canOpen = Boolean(local || (feedbackId && attachment._id))

  const open = (event) => {
    event.stopPropagation()
    if (!canOpen) return
    onOpen({
      name,
      size: attachment.fileSize || local?.size,
      mimeType: attachment.mimeType || local?.type,
      getBlob: local
        ? async () => local
        : ({ signal, onProgress } = {}) => loadBlob(feedbackId, attachment._id, { signal, onDownloadProgress: (e) => { if (e.total) onProgress?.(e.loaded / e.total) } }),
    })
  }
  const cancel = (event) => { event.stopPropagation(); onCancel?.(attachment) }

  const cancelButton = inFlight && onCancel && (
    <button
      type="button"
      onClick={cancel}
      aria-label={`Cancel upload of ${name}`}
      title="Cancel upload"
      className="shrink-0 p-1 rounded-full text-muted-foreground hover:text-destructive hover:bg-secondary transition-colors"
    >
      <X className="w-3.5 h-3.5" />
    </button>
  )

  if (showThumb) {
    return (
      <div className="relative w-36 h-28 sm:w-40 sm:h-32 rounded-xl overflow-hidden border border-border bg-secondary">
        <button type="button" onClick={open} disabled={!canOpen} title={name} className="block w-full h-full hover:brightness-95 transition">
          {url ? (
            <img src={url} alt={name} className="w-full h-full object-cover" />
          ) : (
            <span className="w-full h-full flex items-center justify-center text-[11px] text-muted-foreground">
              {failed ? "Couldn't load" : 'Loading…'}
            </span>
          )}
        </button>
        {inFlight && (
          <>
            <div className="absolute top-1 right-1 rounded-full bg-card/90 text-foreground shadow">{cancelButton}</div>
            <ProgressBar progress={upload.progress} className="absolute inset-x-0 bottom-0" />
          </>
        )}
      </div>
    )
  }

  const sizeLabel = formatFileSize(attachment.fileSize || local?.size)
  let status = sizeLabel
  if (upload?.status === 'queued') status = `${sizeLabel} · Waiting…`
  else if (upload?.status === 'uploading') status = `${sizeLabel} · Uploading ${Math.round((upload.progress || 0) * 100)}%`
  else if (upload?.status === 'error') status = `${sizeLabel} · Upload failed`

  return (
    <div className="relative w-60 max-w-full rounded-lg border border-border bg-card text-foreground overflow-hidden">
      <div className="flex items-center gap-1 pr-1.5">
        <button type="button" onClick={open} disabled={!canOpen} title={name} className="flex items-center gap-2 min-w-0 flex-1 text-left px-2.5 py-2 hover:bg-accent transition-colors">
          <FileTypeIcon kind={kind} className="w-5 h-5 text-primary shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">{name}</span>
            {status ? <span className={`block truncate text-[11px] ${upload?.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{status}</span> : null}
          </span>
        </button>
        {cancelButton}
      </div>
      {inFlight && <ProgressBar progress={upload.progress} />}
    </div>
  )
}
