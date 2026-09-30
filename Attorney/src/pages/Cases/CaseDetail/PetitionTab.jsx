import { useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { Loader2, Eye, FileText, X } from 'lucide-react'
import { caseDataApi } from '../../../services/api'

const STATUS_TONE = {
  draft: 'badge-neutral',
  assembling: 'badge-info',
  assembled: 'badge-info',
  needs_revision: 'badge-warning',
  finalized: 'badge-success',
  filed: 'badge-success',
  superseded: 'badge-neutral',
  failed: 'badge-danger',
}

// Centered in-app preview - the only way to view a petition here, per
// explicit product decision (no "Download" action on this tab). `fetcher`
// is either caseDataApi.previewDocument (a manual upload) or
// caseDataApi.previewPetitionPackage (an assembled version).
function PetitionPreviewModal({ title, fetcher, onClose }) {
  const [url, setUrl] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let objectUrl
    fetcher()
      .then(({ data }) => {
        objectUrl = URL.createObjectURL(data)
        setUrl(objectUrl)
      })
      .catch((err) => setError(err.response?.data?.message || 'Could not load this document.'))
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [fetcher])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-card w-full max-w-4xl h-[90vh] rounded-lg shadow-xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="text-sm font-semibold text-foreground truncate">{title}</p>
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

// Read-only view of the same petition package versions the case manager's
// Petition tab shows (PetitionVersionList) — no assemble/finalize/unlock
// actions, matching this portal's view + feedback/messages-only scope. Also
// surfaces any petition the case manager manually uploaded (separate from
// the assembled-package pipeline) in the same centered-preview shape.
export default function PetitionTab() {
  const { caseId } = useParams()
  const { refreshToken } = useOutletContext()
  const [packages, setPackages] = useState(null)
  const [uploads, setUploads] = useState([])
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null)

  useEffect(() => {
    caseDataApi
      .petitionPackages(caseId)
      .then(({ data }) => setPackages(data.data || []))
      .catch((err) => setError(err.response?.data?.message || 'Could not load petition packages.'))
    caseDataApi
      .petitionUploads(caseId)
      .then(({ data }) => setUploads(data.documents || data.data || []))
      .catch(() => {})
  }, [caseId, refreshToken])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!packages) return <Loader2 className="w-6 h-6 animate-spin text-primary" />

  return (
    <div className="space-y-4">
      {uploads.length > 0 && (
        <div className="card !p-0 divide-y divide-border">
          {uploads.map((doc) => (
            <button
              key={doc._id}
              onClick={() => setPreview({ title: doc.originalName || doc.fileName, fetcher: () => caseDataApi.previewDocument(doc._id) })}
              className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-muted/50"
            >
              <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground truncate">{doc.originalName || doc.fileName}</p>
                <p className="text-xs text-muted-foreground">Uploaded petition {doc.createdAt ? `· ${new Date(doc.createdAt).toLocaleString()}` : ''}</p>
              </div>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary shrink-0"><Eye className="w-3.5 h-3.5" /> Preview</span>
            </button>
          ))}
        </div>
      )}

      {!packages.length && !uploads.length ? (
        <p className="text-sm text-muted-foreground card text-center">No petition package has been assembled for this case yet.</p>
      ) : (
        packages.length > 0 && (
          <div className="card !p-0 divide-y divide-border">
            {packages.map((pkg) => (
              <div key={pkg._id} className="flex items-center justify-between px-5 py-4">
                <div>
                  <p className="text-sm font-semibold text-foreground">Version {pkg.versionNumber}</p>
                  <p className="text-xs text-muted-foreground">
                    {pkg.packageDefinitionKey}
                    {pkg.filing?.receiptNumber ? ` · Receipt ${pkg.filing.receiptNumber}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`badge capitalize ${STATUS_TONE[pkg.status] || 'badge-neutral'}`}>{String(pkg.status || 'unknown').replace(/_/g, ' ')}</span>
                  {pkg.outputs?.mailingPdfDocumentId && (
                    <button
                      onClick={() => setPreview({ title: `Petition — Version ${pkg.versionNumber}`, fetcher: () => caseDataApi.previewPetitionPackage(pkg._id) })}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                    >
                      <Eye className="w-3.5 h-3.5" /> Preview
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {preview && <PetitionPreviewModal title={preview.title} fetcher={preview.fetcher} onClose={() => setPreview(null)} />}
    </div>
  )
}
