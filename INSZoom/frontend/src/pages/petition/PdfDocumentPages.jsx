import { useEffect, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { documentsApi } from '../../services/api'
// react-pdf@10 bundles its OWN pdfjs-dist (react-pdf/node_modules/pdfjs-dist,
// 5.4.296), a different major version than this project's top-level
// pdfjs-dist dependency (^6.2.108, used server-side for PDF field
// scanning). Pointing the worker at the top-level package throws "API
// version does not match Worker version" and pages never render (confirmed
// empirically) - worse, `pdfjs.GlobalWorkerOptions.workerSrc` is a shared
// singleton across every module using react-pdf's `pdfjs` export, so this
// same fix has to live everywhere that sets it (see
// components/uscis/USCISFormRenderer.jsx's own copy of this note) or
// whichever one evaluates last silently wins and breaks the other.
import pdfWorkerUrl from 'react-pdf/node_modules/pdfjs-dist/build/pdf.worker.min.mjs?url'

// The worker must be configured in the SAME module that renders
// <Document>/<Page> (react-pdf's own README warning) — never in a separate
// "setup once" file, or module execution order can silently overwrite it.
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

// Fetches one Document's PDF as a blob and renders every page as its own
// "sheet" (a plain div per page — the page-shell/shadow styling is applied
// by the caller, e.g. FormSheet/ExhibitSheet, so this stays a pure content
// renderer). Falls back to a labeled red placeholder if the fetch/parse
// fails, per the "never a crashed canvas" requirement.
export default function PdfDocumentPages({ documentId, width = 816, renderSheet, onPageCount }) {
  const [blobUrl, setBlobUrl] = useState(null)
  const [isImage, setIsImage] = useState(false)
  const [pageCount, setPageCount] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    let objectUrl = null
    setError('')
    setBlobUrl(null)
    setIsImage(false)
    if (!documentId) return undefined
    documentsApi.preview(documentId)
      .then((res) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(res.data)
        setIsImage(/^image\//.test(res.headers?.['content-type'] || res.data?.type || ''))
        setBlobUrl(objectUrl)
      })
      .catch(() => { if (!cancelled) { setError('Unable to load this document.'); onPageCount?.(1) } })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [documentId])

  if (error) {
    return renderSheet(
      <div className="flex h-[300px] items-center justify-center text-center text-sm font-semibold text-red-600">
        {error}
      </div>,
      'error'
    )
  }

  if (!blobUrl) {
    return renderSheet(
      <div className="flex h-[300px] items-center justify-center text-sm text-gray-400">Loading…</div>,
      'loading'
    )
  }

  if (isImage) {
    return (
      <ImagePage src={blobUrl} width={width} onPageCount={onPageCount} renderSheet={renderSheet} />
    )
  }

  return (
    <Document
      file={blobUrl}
      loading={renderSheet(<div className="flex h-[300px] items-center justify-center text-sm text-gray-400">Loading…</div>, 'loading')}
      error={renderSheet(<div className="flex h-[300px] items-center justify-center text-sm font-semibold text-red-600">Unable to render this document.</div>, 'error')}
      onLoadSuccess={({ numPages }) => { setPageCount(numPages); onPageCount?.(numPages) }}
      onLoadError={() => onPageCount?.(1)}
    >
      {Array.from({ length: pageCount }, (_, i) => i + 1).map((pageNumber) => (
        <div key={pageNumber}>
          {renderSheet(<Page pageNumber={pageNumber} width={width} loading="" />, `page-${pageNumber}`)}
        </div>
      ))}
    </Document>
  )
}

function ImagePage({ src, width, onPageCount, renderSheet }) {
  useEffect(() => { onPageCount?.(1) }, [])
  return renderSheet(<img src={src} alt="" style={{ width: width - 2, height: 'auto' }} />, 'page-1')
}
