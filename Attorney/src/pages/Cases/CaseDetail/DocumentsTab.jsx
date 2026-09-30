import { useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { Loader2, FileText, Clock, X } from 'lucide-react'
import { caseDataApi, questionnairesApi } from '../../../services/api'

// Centered in-app preview, the ONLY way to view a document here - per
// explicit product decision, an attorney should not be pushed toward
// downloading a copy of client documents by default. (Nothing stops a
// browser's own PDF viewer toolbar from offering a save action, but this
// portal never surfaces its own "Download" button for these.)
function DocumentPreviewModal({ doc, onClose }) {
  const [url, setUrl] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let objectUrl
    caseDataApi
      .previewDocument(doc._id)
      .then(({ data }) => {
        objectUrl = URL.createObjectURL(data)
        setUrl(objectUrl)
      })
      .catch((err) => setError(err.response?.data?.message || 'Could not load this document.'))
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
          {url && <iframe title="document-preview" src={url} className="w-full h-full border-0" />}
        </div>
      </div>
    </div>
  )
}

export default function DocumentsTab() {
  const { caseId } = useParams()
  const { refreshToken } = useOutletContext()
  const [documents, setDocuments] = useState(null)
  const [pending, setPending] = useState([])
  const [error, setError] = useState('')
  const [openDoc, setOpenDoc] = useState(null)

  useEffect(() => {
    caseDataApi
      .documents(caseId)
      .then(({ data }) => {
        // Mirrors CRMCaseDetail.jsx's own Documents tab exactly: system-
        // generated artifacts (petition cover letters, exhibits, etc.)
        // belong on the Petition tab, not here.
        const docs = (data.documents || data.data || []).filter((doc) => doc.uploadedBy !== 'system')
        setDocuments(docs)
      })
      .catch((err) => setError(err.response?.data?.message || 'Could not load documents.'))

    // "Pending" = every checklist's still-required, unanswered file
    // question (documentProgress.missingRequired) - the same data
    // CRMCaseDetail.jsx's own documentsProgress panel computes from, just
    // aggregated across every checklist on the case instead of one at a
    // time. "Sent" is simply the documents list above.
    questionnairesApi
      .listChecklists(caseId)
      .then(({ data }) => {
        const checklists = data.data?.checklists || []
        const missing = checklists.flatMap((checklist) =>
          (checklist.documentProgress?.missingRequired || []).map((item) => ({
            ...item,
            checklistTitle: checklist.title,
          }))
        )
        setPending(missing)
      })
      .catch(() => {})
  }, [caseId, refreshToken])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!documents) return <Loader2 className="w-6 h-6 animate-spin text-primary" />

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Sent</h3>
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground card text-center">No documents submitted on this case yet.</p>
        ) : (
          <div className="card !p-0 divide-y divide-border">
            {documents.map((doc) => (
              <button
                key={doc._id}
                onClick={() => setOpenDoc(doc)}
                className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-muted/50"
              >
                <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground truncate">{doc.originalName || doc.fileName || doc.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {doc.documentType || doc.category || 'Document'}
                    {doc.createdAt ? ` · ${new Date(doc.createdAt).toLocaleDateString()}` : ''}
                  </p>
                </div>
                <span className="text-xs font-semibold text-primary shrink-0">Preview</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {pending.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Pending</h3>
          <div className="card !p-0 divide-y divide-border">
            {pending.map((item, index) => (
              <div key={`${item.key}-${index}`} className="flex items-center gap-3 px-5 py-3">
                <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground truncate">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.checklistTitle}</p>
                </div>
                <span className="badge badge-warning shrink-0">Not yet submitted</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {openDoc && <DocumentPreviewModal doc={openDoc} onClose={() => setOpenDoc(null)} />}
    </div>
  )
}
