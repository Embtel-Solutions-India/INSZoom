import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { caseDataApi } from '../../../services/api'

export default function FormsTab() {
  const { caseId } = useParams()
  const [forms, setForms] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    caseDataApi
      .forms(caseId)
      .then(({ data }) => setForms(data.forms || data.caseForms || data.data || []))
      .catch((err) => setError(err.response?.data?.message || 'Could not load USCIS forms.'))
  }, [caseId])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!forms) return <Loader2 className="w-6 h-6 animate-spin text-primary" />
  if (!forms.length) {
    return <p className="text-sm text-muted-foreground card text-center">No USCIS forms generated for this case yet.</p>
  }

  return (
    <div className="card !p-0 divide-y divide-border">
      {forms.map((form) => (
        <div key={form._id} className="flex items-center justify-between px-5 py-3">
          <div>
            <p className="text-sm font-semibold text-foreground">{form.formNumber || form.formCode || form.name}</p>
            <p className="text-xs text-muted-foreground">{form.formTitle || form.title || ''}</p>
          </div>
          <span className="badge badge-info capitalize">{String(form.status || 'unknown').replace(/_/g, ' ')}</span>
        </div>
      ))}
    </div>
  )
}
