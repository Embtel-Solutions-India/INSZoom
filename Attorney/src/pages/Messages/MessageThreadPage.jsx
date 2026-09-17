import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { attorneyApi } from '../../services/api'
import MessageThread from '../../components/MessageThread'

// Standalone page at /messages/:caseId — deliberately NOT nested under
// /cases/:caseId (CaseDetailLayout's tab bar), per the product decision
// that Messages lives only in the top-level nav, never as a case subpage.
export default function MessageThreadPage() {
  const { caseId } = useParams()
  const [caseData, setCaseData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    attorneyApi
      .case(caseId)
      .then(({ data }) => setCaseData(data.case))
      .catch((err) => setError(err.response?.status === 403 ? 'You do not have access to this case.' : err.response?.data?.message || 'Could not load this case.'))
  }, [caseId])

  return (
    <div className="space-y-4">
      <Link to="/messages" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
        <ArrowLeft className="w-4 h-4" /> Back to Messages
      </Link>

      {error ? (
        <div className="card text-center py-10">
          <h1 className="text-lg font-bold text-foreground font-serif mb-1">Access denied</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      ) : !caseData ? (
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      ) : (
        <>
          <div>
            <h1 className="text-xl font-bold text-foreground font-serif">{caseData.caseNumber || caseData.caseId}</h1>
            <p className="text-sm text-muted-foreground">{caseData.clientName} · {caseData.visaType}</p>
          </div>
          <MessageThread caseId={caseId} />
        </>
      )}
    </div>
  )
}
