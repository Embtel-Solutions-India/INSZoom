import { useCallback, useEffect, useState } from 'react'
import { FileText, Film, Image as ImageIcon, Music } from 'lucide-react'
import AttachmentViewer from './AttachmentViewer'
import { attachmentKind, canThumbnail, sizeOfAttachment } from '../utils/chatAttachments'
import { formatFileSize } from '../utils/chunkedUpload'

// Thumbnails are fetched once as a blob through the authenticated download
// endpoint and the object URL is reused for the life of the page, so a
// re-render never re-downloads an image.
const thumbnailCache = new Map()

const KIND_ICON = { image: ImageIcon, video: Film, audio: Music }

// One attachment inside a chat bubble: an image thumbnail or a file chip (name +
// size). Clicking opens AttachmentViewer. A just-sent attachment carries its own
// local data (`__localUrl` for images, `__file` for everything) so it shows - and
// opens - instantly, before any upload has finished; `__progress` (0-100) draws
// the per-file upload bar.
//
//   cacheKey  - stable id of the server copy (message id + attachment id)
//   fetchBlob - async (onProgress(fraction), signal) => Blob, the authenticated download
export default function ChatAttachment({ attachment, cacheKey, fetchBlob }) {
  const name = attachment.originalName || 'attachment'
  const size = sizeOfAttachment(attachment)
  const kind = attachmentKind(attachment.mimeType, name)
  const showThumbnail = canThumbnail(attachment)
  const uploading = typeof attachment.__progress === 'number' && attachment.__progress < 100
  const isLocal = Boolean(attachment.__file || attachment.__localUrl)

  const [thumbUrl, setThumbUrl] = useState(attachment.__localUrl || thumbnailCache.get(cacheKey) || null)
  const [thumbStatus, setThumbStatus] = useState(thumbUrl ? 'ready' : 'idle')
  const [viewerOpen, setViewerOpen] = useState(false)

  useEffect(() => {
    if (!showThumbnail || thumbUrl || isLocal || !fetchBlob) return undefined
    let cancelled = false
    setThumbStatus('loading')
    fetchBlob(null, undefined)
      .then((blob) => {
        const url = URL.createObjectURL(blob)
        thumbnailCache.set(cacheKey, url)
        if (!cancelled) { setThumbUrl(url); setThumbStatus('ready') }
      })
      .catch(() => { if (!cancelled) setThumbStatus('error') })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showThumbnail, cacheKey])

  // Local sources never touch the network; server copies go through fetchBlob.
  const load = useCallback(
    async (onProgress, signal) => {
      if (attachment.__file) return attachment.__file
      return fetchBlob(onProgress, signal)
    },
    [attachment.__file, fetchBlob]
  )

  const open = (event) => {
    event.stopPropagation() // a failed bubble is tap-to-retry; opening a file must not trigger that
    setViewerOpen(true)
  }

  const progressBar = uploading && (
    <div className="h-1 w-full bg-black/15 rounded-full overflow-hidden" role="progressbar" aria-valuenow={attachment.__progress} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full bg-primary transition-all duration-200" style={{ width: `${attachment.__progress}%` }} />
    </div>
  )

  const viewer = viewerOpen && (
    <AttachmentViewer
      name={name}
      size={size}
      mimeType={attachment.mimeType}
      url={thumbUrl || undefined}
      load={load}
      onClose={() => setViewerOpen(false)}
    />
  )

  if (showThumbnail) {
    return (
      <>
        <button
          type="button"
          onClick={open}
          title={name}
          className="relative block w-40 h-32 rounded-xl overflow-hidden border border-border bg-secondary hover:brightness-95 transition"
        >
          {thumbStatus === 'ready' && thumbUrl ? (
            <img src={thumbUrl} alt={name} className={`w-full h-full object-cover ${uploading ? 'opacity-70' : ''}`} />
          ) : (
            <span className="w-full h-full flex flex-col items-center justify-center gap-1 px-2 text-center text-[11px] text-muted-foreground">
              <ImageIcon className="w-5 h-5" />
              <span className="truncate max-w-full">{thumbStatus === 'error' ? "Couldn't load image" : name}</span>
            </span>
          )}
          {/* name + size caption so an image reads like every other attachment */}
          <span className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/55 px-2 py-1 text-[10px] leading-tight text-white">
            <span className="truncate">{name}</span>
            {size ? <span className="shrink-0 opacity-80">{formatFileSize(size)}</span> : null}
          </span>
          {uploading && <span className="absolute inset-x-2 bottom-7">{progressBar}</span>}
        </button>
        {viewer}
      </>
    )
  }

  const Icon = KIND_ICON[kind] || FileText
  return (
    <>
      <button
        type="button"
        onClick={open}
        title={name}
        className="flex flex-col gap-1 w-full max-w-[17rem] text-left rounded-xl border border-border bg-card text-foreground px-3 py-2 hover:bg-secondary transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Icon className="w-4 h-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold">{name}</span>
            {size ? <span className="block text-[11px] text-muted-foreground">{formatFileSize(size)}{uploading ? ` - ${attachment.__progress}%` : ''}</span> : null}
          </span>
        </span>
        {progressBar}
      </button>
      {viewer}
    </>
  )
}
