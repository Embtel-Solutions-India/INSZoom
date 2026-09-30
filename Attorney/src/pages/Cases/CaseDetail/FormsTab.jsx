import { useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { Download, Eye, Loader2, X } from 'lucide-react'
import { caseDataApi } from '../../../services/api'

function statusBadgeClass(status) {
  if (status === 'locked' || status === 'filed') return 'badge-success'
  if (status === 'ready_for_review' || status === 'reviewed') return 'badge-info'
  if (status === 'in_progress') return 'badge-warning'
  return 'badge-neutral'
}

// Shows the actual rendered PDF (with whatever's currently autofilled) in a
// centered modal - the same /forms/:caseFormId/preview endpoint
// CRMCaseDetail's USCISFormRenderer uses, so an attorney sees the real
// filled-in data, not just a status badge.
function FormPreviewModal({ form, onClose }) {
  const [url, setUrl] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let objectUrl
    caseDataApi
      .previewForm(form._id)
      .then(({ data }) => {
        objectUrl = URL.createObjectURL(data)
        setUrl(objectUrl)
      })
      .catch((err) => setError(err.response?.data?.message || 'Could not load this form.'))
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [form._id])

  const download = async () => {
    try {
      const { data } = await caseDataApi.downloadForm(form._id)
      const blobUrl = URL.createObjectURL(data)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = `${form.formNumber || form.formCode || 'form'}.pdf`
      link.click()
      URL.revokeObjectURL(blobUrl)
    } catch {
      setError('That download failed. Please try again.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-card w-full max-w-4xl h-[90vh] rounded-lg shadow-xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <p className="text-sm font-semibold text-foreground">{form.formNumber || form.formCode}</p>
            <p className="text-xs text-muted-foreground">{form.formTitle || form.title || ''}</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={download} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
              <Download className="w-4 h-4" /> Download
            </button>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 bg-muted/30">
          {error && <p className="text-sm text-destructive p-4">{error}</p>}
          {!error && !url && (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          )}
          {url && <iframe title={`${form.formNumber || 'form'}-preview`} src={url} className="w-full h-full border-0" />}
        </div>
      </div>
    </div>
  )
}

export default function FormsTab() {
  const { caseId } = useParams()
  const { refreshToken } = useOutletContext()
  const [forms, setForms] = useState(null)
  const [error, setError] = useState('')
  const [openForm, setOpenForm] = useState(null)

  useEffect(() => {
    caseDataApi
      .forms(caseId)
      .then(({ data }) => setForms(data.forms || data.caseForms || data.data || []))
      .catch((err) => setError(err.response?.data?.message || 'Could not load USCIS forms.'))
  }, [caseId, refreshToken])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!forms) return <Loader2 className="w-6 h-6 animate-spin text-primary" />
  if (!forms.length) {
    return <p className="text-sm text-muted-foreground card text-center">No USCIS forms generated for this case yet.</p>
  }

  return (
    <>
      <div className="card !p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground uppercase">
            <tr>
              <th className="text-left px-5 py-2.5 font-medium">Form</th>
              <th className="text-left px-5 py-2.5 font-medium">Edition</th>
              <th className="text-left px-5 py-2.5 font-medium">Completion</th>
              <th className="text-left px-5 py-2.5 font-medium">Status</th>
              <th className="text-left px-5 py-2.5 font-medium">Last Modified</th>
              <th className="text-right px-5 py-2.5 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {forms.map((form) => (
              <tr key={form._id}>
                <td className="px-5 py-3">
                  <p className="font-semibold text-foreground">{form.formNumber || form.formCode || form.name}</p>
                  <p className="text-xs text-muted-foreground">{form.formTitle || form.title || ''}</p>
                </td>
                <td className="px-5 py-3 text-muted-foreground">
                  {form.formEditionDate ? new Date(form.formEditionDate).toLocaleDateString() : '—'}
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-1.5 bg-primary rounded-full" style={{ width: `${form.completion?.percent || 0}%` }} />
                    </div>
                    <span className="text-xs font-medium">{form.completion?.percent || 0}%</span>
                  </div>
                </td>
                <td className="px-5 py-3">
                  <span className={`badge ${statusBadgeClass(form.status)} capitalize`}>{String(form.status || 'unknown').replace(/_/g, ' ')}</span>
                </td>
                <td className="px-5 py-3 text-muted-foreground">
                  {form.lastModifiedAt || form.updatedAt ? new Date(form.lastModifiedAt || form.updatedAt).toLocaleString() : 'Not started'}
                </td>
                <td className="px-5 py-3 text-right">
                  <button
                    onClick={() => setOpenForm(form)}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
                  >
                    <Eye className="w-4 h-4" /> View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {openForm && <FormPreviewModal form={openForm} onClose={() => setOpenForm(null)} />}
    </>
  )
}
