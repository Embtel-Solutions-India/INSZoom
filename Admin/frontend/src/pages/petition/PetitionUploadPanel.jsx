import { useCallback, useEffect, useRef, useState } from 'react'
import { Upload, Loader2, FileText, Download, Eye, X, AlertCircle } from 'lucide-react'
import { documentsApi } from '../../services/api'

// Manual petition upload - separate from the auto-assembled
// PetitionPackage pipeline (PetitionVersionList/PetitionViewer above this on
// the page). Lets a case manager attach an actual petition PDF they
// authored outside the system; the resulting Document (documentType
// "petition_manual_upload") is what the Attorney Portal's Petition tab
// surfaces, centered, per the same-page spec.
export default function PetitionUploadPanel({ caseId, canUpload, refreshSignal }) {
  const inputRef = useRef(null)
  const [uploads, setUploads] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [previewDoc, setPreviewDoc] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await documentsApi.listPetitionUploads(caseId)
      setUploads(res.data.documents || res.data.data || [])
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load uploaded petitions')
    } finally {
      setLoading(false)
    }
  }, [caseId])

  useEffect(() => { load() }, [load, refreshSignal])

  const handleFile = async (file) => {
    if (!file) return
    setUploading(true)
    setError('')
    try {
      await documentsApi.uploadPetition(caseId, file)
      if (inputRef.current) inputRef.current.value = ''
      await load()
    } catch (e) {
      setError(e.response?.data?.message || 'Unable to upload the petition.')
    } finally {
      setUploading(false)
    }
  }

  if (loading) return null

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-foreground">Uploaded Petition</h3>
          <p className="text-xs text-muted-foreground">A petition document you attach directly (separate from an assembled version above).</p>
        </div>
        {canUpload && (
          <>
            <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
            <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading} className="btn-secondary inline-flex items-center gap-2 !py-1.5 !px-3 text-xs">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Upload Petition
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {uploads.length > 0 && (
        <div className="divide-y divide-border">
          {uploads.map((doc) => (
            <div key={doc._id} className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{doc.originalName || doc.fileName}</p>
                  <p className="text-xs text-muted-foreground">{doc.createdAt ? new Date(doc.createdAt).toLocaleString() : ''}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button onClick={() => setPreviewDoc(doc)} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                  <Eye className="h-3.5 w-3.5" /> View
                </button>
                <button
                  onClick={async () => {
                    const res = await documentsApi.download(doc._id)
                    const url = URL.createObjectURL(res.data)
                    const link = document.createElement('a')
                    link.href = url
                    link.download = doc.originalName || doc.fileName || 'petition.pdf'
                    link.click()
                    URL.revokeObjectURL(url)
                  }}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {previewDoc && (
        <PetitionUploadPreviewModal doc={previewDoc} onClose={() => setPreviewDoc(null)} />
      )}
    </div>
  )
}

// Centered modal viewer - shared shape with the Attorney Portal's own
// centered petition/form preview so the same uploaded PDF looks the same in
// both portals.
export function PetitionUploadPreviewModal({ doc, onClose }) {
  const [url, setUrl] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let objectUrl
    documentsApi
      .preview(doc._id)
      .then((res) => {
        objectUrl = URL.createObjectURL(res.data)
        setUrl(objectUrl)
      })
      .catch((e) => setError(e.response?.data?.message || 'Could not load this document.'))
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [doc._id])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-card w-full max-w-4xl h-[90vh] rounded-lg shadow-xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="text-sm font-semibold text-foreground truncate">{doc.originalName || doc.fileName}</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 bg-muted/30">
          {error && <p className="text-sm text-destructive p-4">{error}</p>}
          {!error && !url && <div className="h-full flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}
          {url && <iframe title="petition-preview" src={url} className="w-full h-full border-0" />}
        </div>
      </div>
    </div>
  )
}
