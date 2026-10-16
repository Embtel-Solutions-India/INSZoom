import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, Loader2, X, File as FileIcon, FileText, FileImage, FileVideo, FileAudio, FileArchive, FileSpreadsheet } from 'lucide-react'
import { formatFileSize } from '../utils/chunkedUpload'

// Reusable centered attachment viewer (modal): dimmed backdrop, header with
// file name + size, Download and Close. Esc or a backdrop click closes it.
// Open and close both animate (fade + slight scale/translate, ~200 ms).
//
// It does not know where the file comes from: the caller passes
//   getBlob({ signal, onProgress(0..1) }) => Promise<Blob>
// (a server download for received files, the local File for just-sent ones).
// The viewer owns the object URL it creates and revokes it on close.

const TRANSITION_MS = 200
const MAX_TEXT_CHARS = 200_000

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif']
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'm4v', 'ogv']
const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'ogg', 'oga', 'aac', 'flac']
const TEXT_EXT = ['txt', 'csv', 'json', 'md', 'log', 'xml', 'yml', 'yaml', 'tsv']
const ARCHIVE_EXT = ['zip', 'rar', '7z', 'gz', 'tar']
const SHEET_EXT = ['xls', 'xlsx', 'ods']
const DOC_EXT = ['doc', 'docx', 'odt', 'rtf', 'ppt', 'pptx']

const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif',
  pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4', ogv: 'video/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', oga: 'audio/ogg', aac: 'audio/aac', flac: 'audio/flac',
}

const extOf = (name = '') => (name.includes('.') ? name.split('.').pop().toLowerCase() : '')

// What a file is, for its icon and for whether it can be previewed in the browser.
export function fileKind(name = '', mimeType = '') {
  const mime = (mimeType || '').toLowerCase()
  const ext = extOf(name)
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf'
  // Only formats a browser can really draw: HEIC/TIFF etc. fall through to "other".
  if (IMAGE_EXT.includes(ext) || (!ext && mime.startsWith('image/'))) return 'image'
  if (VIDEO_EXT.includes(ext) || (!ext && mime.startsWith('video/'))) return 'video'
  if (AUDIO_EXT.includes(ext) || (!ext && mime.startsWith('audio/'))) return 'audio'
  if (TEXT_EXT.includes(ext) || (!ext && mime.startsWith('text/'))) return 'text'
  if (ARCHIVE_EXT.includes(ext)) return 'archive'
  if (SHEET_EXT.includes(ext)) return 'sheet'
  if (DOC_EXT.includes(ext)) return 'doc'
  if (mime.startsWith('image/')) return 'otherImage'
  if (mime.startsWith('video/')) return 'otherVideo'
  if (mime.startsWith('audio/')) return 'otherAudio'
  return 'other'
}

export const isPreviewable = (kind) => ['image', 'pdf', 'video', 'audio', 'text'].includes(kind)

const ICONS = {
  pdf: FileText, text: FileText, doc: FileText,
  image: FileImage, otherImage: FileImage,
  video: FileVideo, otherVideo: FileVideo,
  audio: FileAudio, otherAudio: FileAudio,
  archive: FileArchive, sheet: FileSpreadsheet,
}

export function FileTypeIcon({ kind, className = 'w-5 h-5' }) {
  const Icon = ICONS[kind] || FileIcon
  return <Icon className={className} aria-hidden="true" />
}

// A blob from the server may carry a generic type; the browser only renders a PDF/image/video from the right one.
function withUsableType(blob, kind, name, mimeType) {
  const wantedPrefix = { image: 'image/', video: 'video/', audio: 'audio/' }[kind]
  const current = blob.type || ''
  if (kind === 'pdf' ? current === 'application/pdf' : wantedPrefix ? current.startsWith(wantedPrefix) : true) return blob
  const fallback = MIME_BY_EXT[extOf(name)] || mimeType || current
  return fallback && fallback !== current ? new Blob([blob], { type: fallback }) : blob
}

function saveUrl(url, name) {
  const link = document.createElement('a')
  link.href = url
  link.download = name || 'attachment'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export default function AttachmentViewer({ name, size, mimeType, getBlob, onClose }) {
  const kind = fileKind(name, mimeType)
  const previewable = isPreviewable(kind)
  const [shown, setShown] = useState(false)
  const [status, setStatus] = useState(previewable ? 'loading' : 'idle') // idle | loading | ready | error
  const [progress, setProgress] = useState(null)
  const [url, setUrl] = useState(null)
  const [text, setText] = useState('')
  const [truncated, setTruncated] = useState(false)
  const closeTimer = useRef(null)
  const closeButtonRef = useRef(null)

  // Enter transition: mount hidden, then flip on the next frames so the browser animates it.
  useEffect(() => {
    let second
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setShown(true)) })
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second) }
  }, [])

  const requestClose = useCallback(() => {
    setShown(false)
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(onClose, TRANSITION_MS)
  }, [onClose])

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') { event.stopPropagation(); requestClose() } }
    document.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = previousOverflow }
  }, [requestClose])

  // Fetch the file; the object URL lives only as long as the viewer. Types we
  // cannot preview are only fetched when Download is pressed (they can be 400 MB).
  const [fetchNow, setFetchNow] = useState(previewable)
  useEffect(() => {
    if (!fetchNow) return undefined
    const controller = new AbortController()
    let objectUrl = null
    let stale = false
    setStatus('loading'); setProgress(null); setUrl(null); setText('')
    ;(async () => {
      try {
        const raw = await getBlob({ signal: controller.signal, onProgress: (fraction) => { if (!stale) setProgress(fraction) } })
        if (stale) return
        const blob = withUsableType(raw, kind, name, mimeType)
        if (kind === 'text') {
          const slice = blob.size > MAX_TEXT_CHARS ? blob.slice(0, MAX_TEXT_CHARS) : blob
          const content = await slice.text()
          if (stale) return
          setText(content); setTruncated(blob.size > MAX_TEXT_CHARS)
        }
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
        setStatus('ready')
        if (!previewable) saveUrl(objectUrl, name)
      } catch {
        if (!stale) setStatus('error')
      }
    })()
    return () => { stale = true; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [fetchNow, getBlob, kind, name, mimeType, previewable])

  const download = () => {
    if (url) saveUrl(url, name)
    else if (!fetchNow) setFetchNow(true)
  }

  const percent = progress != null ? Math.round(progress * 100) : null

  let body
  if (status === 'loading') {
    body = (
      <div className="flex flex-col items-center gap-3 text-muted-foreground" role="status">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm">{percent != null ? `Loading… ${percent}%` : 'Loading…'}</p>
        {percent != null && (
          <div className="w-48 h-1.5 rounded-full bg-border overflow-hidden">
            <div className="h-full bg-primary transition-[width] duration-150" style={{ width: `${percent}%` }} />
          </div>
        )}
      </div>
    )
  } else if (status === 'error') {
    body = (
      <div className="flex flex-col items-center gap-2 text-center px-6">
        <FileTypeIcon kind={kind} className="w-12 h-12 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Couldn't load this file</p>
        <p className="text-xs text-muted-foreground">Close the viewer and try again.</p>
      </div>
    )
  } else if (!previewable) {
    body = (
      <div className="flex flex-col items-center gap-3 text-center px-6">
        <FileTypeIcon kind={kind} className="w-14 h-14 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Preview not available</p>
        <p className="text-xs text-muted-foreground max-w-xs">This file type can't be shown here. Download it to open it on your device.</p>
        <button type="button" onClick={download} className="btn-primary inline-flex items-center gap-1.5 text-sm">
          <Download className="w-4 h-4" /> Download
        </button>
      </div>
    )
  } else if (kind === 'image') {
    body = <img src={url} alt={name} className="max-w-full max-h-full object-contain" />
  } else if (kind === 'pdf') {
    body = <iframe src={url} title={name} className="w-full h-full border-0 bg-white" />
  } else if (kind === 'video') {
    body = <video src={url} controls className="max-w-full max-h-full" />
  } else if (kind === 'audio') {
    body = (
      <div className="flex flex-col items-center gap-4 px-6 w-full max-w-md">
        <FileTypeIcon kind={kind} className="w-14 h-14 text-primary" />
        <audio src={url} controls className="w-full" />
      </div>
    )
  } else if (kind === 'text') {
    body = (
      <pre className="w-full h-full overflow-auto p-4 text-xs leading-relaxed text-foreground whitespace-pre-wrap break-words font-mono text-left">
        {text}
        {truncated ? '\n\n… (preview truncated — download the file to see everything)' : ''}
      </pre>
    )
  }

  return createPortal(
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center p-1 bg-black/60 transition-opacity duration-200 ease-out motion-reduce:transition-none ${shown ? 'opacity-100' : 'opacity-0'}`}
      onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose() }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={name}
        className={`flex flex-col w-full h-full rounded-lg border border-border bg-card text-foreground shadow-2xl overflow-hidden transition-all duration-200 ease-out motion-reduce:transition-none ${shown ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-2'}`}
      >
        <div className="flex items-center gap-2 px-3 py-1 border-b border-border shrink-0">
          <FileTypeIcon kind={kind} className="w-4 h-4 text-primary shrink-0" />
          <p className="min-w-0 flex-1 truncate text-xs font-semibold" title={name}>
            {name}{size ? <span className="ml-2 font-normal text-muted-foreground">{formatFileSize(size)}</span> : null}
          </p>
          <button
            type="button"
            onClick={download}
            disabled={previewable ? !url : status === 'loading'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Download</span>
          </button>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={requestClose}
            aria-label="Close"
            title="Close"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-accent transition-colors"
          >
            <X className="w-4 h-4" />
            <span className="hidden sm:inline">Close</span>
          </button>
        </div>
        <div className={`flex-1 min-h-0 flex items-center justify-center bg-muted/40 ${kind === 'text' || kind === 'pdf' ? '' : 'p-3 sm:p-4'}`}>
          {body}
        </div>
      </div>
    </div>,
    document.body
  )
}
