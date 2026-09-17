import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Download, Loader2 } from 'lucide-react'
import { caseDataApi } from '../../../services/api'

export default function DocumentsTab() {
  const { caseId } = useParams()
  const [documents, setDocuments] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    caseDataApi
      .documents(caseId)
      .then(({ data }) => setDocuments(data.documents || data.data || []))
      .catch((err) => setError(err.response?.data?.message || 'Could not load documents.'))
  }, [caseId])

  const download = async (doc) => {
    try {
      const response = await caseDataApi.downloadDocument(doc._id)
      const url = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = doc.originalName || doc.fileName || 'document'
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('That download failed. Please try again.')
    }
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!documents) return <Loader2 className="w-6 h-6 animate-spin text-primary" />
  if (!documents.length) {
    return <p className="text-sm text-muted-foreground card text-center">No documents on this case yet.</p>
  }

  return (
    <div className="card !p-0 divide-y divide-border">
      {documents.map((doc) => (
        <div key={doc._id} className="flex items-center justify-between px-5 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{doc.originalName || doc.fileName || doc.name}</p>
            <p className="text-xs text-muted-foreground">
              {doc.documentType || doc.category || 'Document'}
              {doc.createdAt ? ` · ${new Date(doc.createdAt).toLocaleDateString()}` : ''}
            </p>
          </div>
          <button onClick={() => download(doc)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
            <Download className="w-4 h-4" /> Download
          </button>
        </div>
      ))}
    </div>
  )
}
