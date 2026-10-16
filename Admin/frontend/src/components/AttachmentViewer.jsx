import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, FileText, Loader2, X } from 'lucide-react'
import { PREVIEW_MAX_BYTES, attachmentKind } from '../utils/chatAttachments'
import { formatFileSize } from '../utils/chunkedUpload'

const TRANSITION_MS = 200

// Centered modal that previews a chat attachment (image / PDF / video / audio)
// and offers Download. The parent mounts it while it should be open; closing
// (Close button, Esc, backdrop click) plays the exit transition and only then
// calls `onClose`, so the parent simply unmounts it.
//
//   name, size, mimeType - what the header shows (and what picks the preview)
//   url   - an object URL that already exists (owned by the caller, never revoked here)
//   load  - async (onProgress(fraction), signal) => Blob. The viewer owns the object
//           URL it makes from the result and revokes it on close.
export default function AttachmentViewer({ name, size, mimeType, url: readyUrl, load, onClose }) {
  const kind = attachmentKind(mimeType, name)
  const tooBigToPreview = !readyUrl && size > PREVIEW_MAX_BYTES
  const previewable = kind !== 'other' && !tooBigToPreview

  const [visible, setVisible] = useState(false)
  const [objectUrl, setObjectUrl] = useState(readyUrl || null)
  const [status, setStatus] = useState(readyUrl || !previewable ? 'idle' : 'loading') // idle | loading | error
  const [progress, setProgress] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const ownedUrlRef = useRef(null)
  const abortRef = useRef(null)
  const closeTimerRef = useRef(null)
  const closeButtonRef = useRef(null)

  // Fetches the bytes (with progress) and returns an object URL; remembers it so it is revoked on close.
  const fetchOwnedUrl = useCallback(async () => {
    if (ownedUrlRef.current) return ownedUrlRef.current
    if (!load) throw new Error('Nothing to load')
    const controller = new AbortController()
    abortRef.current = controller
    const blob = await load((fraction) => setProgress(fraction), controller.signal)
    if (controller.signal.aborted) throw Object.assign(new Error('canceled'), { cancelled: true })
    // Servers sometimes label files application/octet-stream; trust the recorded type so PDFs/videos still render.
    const typed = mimeType && (!blob.type || blob.type === 'application/octet-stream') ? new Blob([blob], { type: mimeType }) : blob
    const created = URL.createObjectURL(typed)
    ownedUrlRef.current = created
    return created
  }, [load, mimeType])

  // Fade/scale in a frame after mounting so the transition has a starting state.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setVisible(true)
      closeButtonRef.current?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    if (readyUrl || !previewable || !load) return undefined
    let cancelled = false
    fetchOwnedUrl()
      .then((created) => { if (!cancelled) { setObjectUrl(created); setStatus('idle') } })
      .catch((error) => { if (!cancelled && !error?.cancelled) setStatus('error') })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Free everything on unmount.
  useEffect(() => () => {
    clearTimeout(closeTimerRef.current)
    abortRef.current?.abort()
    if (ownedUrlRef.current) URL.revokeObjectURL(ownedUrlRef.current)
  }, [])

  const requestClose = useCallback(() => {
    setVisible(false)
    clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => onClose?.(), TRANSITION_MS)
  }, [onClose])

  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape') requestClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [requestClose])

  const saveUrl = (href) => {
    const link = document.createElement('a')
    link.href = href
    link.download = name || 'download'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleDownload = async () => {
    if (downloading) return
    try {
      if (objectUrl) { saveUrl(objectUrl); return }
      setDownloading(true)
      setProgress(0)
      const created = await fetchOwnedUrl()
      setObjectUrl(created)
      saveUrl(created)
    } catch (error) {
      if (!error?.cancelled) setStatus('error')
    } finally {
      setDownloading(false)
    }
  }

  const loading = status === 'loading' || (downloading && !objectUrl)
  const percent = typeof progress === 'number' ? Math.round(progress * 100) : null
  const canDownload = Boolean(objectUrl || load)

  let body
  if (loading) {
    body = (
      <div className="flex flex-col items-center justify-center gap-3 py-20 px-10 text-muted-foreground" role="status">
        <Loader2 className="w-7 h-7 animate-spin text-primary" />
        <p className="text-sm">{downloading ? 'Downloading' : 'Loading preview'}{percent !== null ? ` - ${percent}%` : '...'}</p>
        {percent !== null && (
          <div className="w-48 h-1.5 rounded-full bg-secondary overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
          </div>
        )}
      </div>
    )
  } else if (status === 'error') {
    body = (
      <div className="flex flex-col items-center justify-center gap-2 py-16 px-10 text-center">
        <FileText className="w-9 h-9 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Could not load this file</p>
        <p className="text-xs text-muted-foreground">Check your connection and try again.</p>
      </div>
    )
  } else if (objectUrl && previewable && kind === 'image') {
    body = <img src={objectUrl} alt={name} className="block max-w-full max-h-full object-contain" />
  } else if (objectUrl && previewable && kind === 'pdf') {
    body = <iframe src={objectUrl} title={name} className="block w-full h-full border-0 bg-background" />
  } else if (objectUrl && previewable && kind === 'video') {
    body = <video src={objectUrl} controls className="block max-w-full max-h-full bg-black" />
  } else if (objectUrl && previewable && kind === 'audio') {
    body = <div className="w-full px-8 py-14"><audio src={objectUrl} controls className="w-full" /></div>
  } else {
    body = (
      <div className="flex flex-col items-center justify-center gap-3 py-14 px-10 text-center">
        <FileText className="w-10 h-10 text-muted-foreground" />
        <div>
          <p className="text-sm font-semibold text-foreground">Preview not available</p>
          <p className="text-xs text-muted-foreground mt-1">
            {tooBigToPreview && kind !== 'other' ? 'This file is too large to preview here - download it to open it.' : 'This file type cannot be previewed here.'}
          </p>
        </div>
        {canDownload && (
          <button type="button" onClick={handleDownload} className="btn-primary inline-flex items-center gap-2">
            <Download className="w-4 h-4" />
            Download
          </button>
        )}
      </div>
    )
  }

  // PDFs, images and video open almost full screen; everything else stays compact.
  const sizing = previewable && kind === 'pdf'
    ? 'w-full h-full'
    : previewable && (kind === 'image' || kind === 'video') && objectUrl
      ? 'w-full h-full'
      : 'w-full max-w-lg'

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name || 'Attachment'}
      onClick={requestClose}
      className={`fixed inset-0 z-[100] flex items-center justify-center p-1 bg-black/60 backdrop-blur-[2px] transition-opacity duration-200 ease-out ${visible ? 'opacity-100' : 'opacity-0'}`}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className={`flex flex-col ${sizing} max-h-full overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-2xl transition-all duration-200 ease-out ${visible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-2'}`}
      >
        <div className="flex items-center gap-2 px-3 py-1 border-b border-border shrink-0">
          <p className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground" title={name}>
            {name || 'Attachment'}{size ? <span className="ml-2 font-normal text-muted-foreground">{formatFileSize(size)}</span> : null}
          </p>
          {canDownload && (
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className="btn-secondary inline-flex items-center gap-1.5 !px-2.5 !py-1 text-xs disabled:opacity-60"
            >
              {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Download
            </button>
          )}
          <button
            ref={closeButtonRef}
            type="button"
            onClick={requestClose}
            className="btn-secondary inline-flex items-center gap-1.5 !px-2.5 !py-1 text-xs"
          >
            <X className="w-3.5 h-3.5" />
            Close
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto bg-muted flex items-center justify-center">
          {body}
        </div>
      </div>
    </div>,
    document.body
  )
}
