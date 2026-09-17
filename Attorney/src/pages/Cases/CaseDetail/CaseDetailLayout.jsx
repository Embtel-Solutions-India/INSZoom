import { useEffect, useState } from 'react'
import { NavLink, Outlet, useParams, Link } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { attorneyApi } from '../../../services/api'
import CaseStatusBadge from '../../../components/CaseStatusBadge'

// Case-related tabs only — no Payments (no billing access, see
// permissions.registry.js's attorney grant), no Expert Letters (a stub
// upstream — fetchLetters() there never actually loads any data), no
// Strategy (a deliberate product decision, not an access gap), no
// Questionnaire (not something an attorney needs — a client-intake
// artifact, not case-review material) and no Notes (redundant with
// Feedback). "Messages" is deliberately NOT a tab here — it lives only in
// the top-level nav (see pages/Messages/) since it's cross-case, not
// case-scoped. Feedback IS case-scoped (attorney <-> case manager review
// dialogue on this one case specifically), so it stays a tab.
const TABS = [
  { to: 'overview', label: 'Overview' },
  { to: 'documents', label: 'Documents' },
  { to: 'forms', label: 'USCIS Forms' },
  { to: 'petition', label: 'Petition' },
  { to: 'tracking', label: 'USCIS Tracking' },
  { to: 'feedback', label: 'Feedback' },
  { to: 'timeline', label: 'Timeline' },
]

export default function CaseDetailLayout() {
  const { caseId } = useParams()
  const [caseData, setCaseData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setCaseData(null)
    setError('')
    attorneyApi
      .case(caseId)
      .then(({ data }) => setCaseData(data.case))
      .catch((err) => {
        setError(
          err.response?.status === 403
            ? 'You do not have access to this case.'
            : err.response?.data?.message || 'Could not load this case.'
        )
      })
  }, [caseId])

  if (error) {
    return (
      <div className="space-y-4">
        <Link to="/cases" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
          <ArrowLeft className="w-4 h-4" /> Back to my cases
        </Link>
        <div className="card text-center py-10">
          <h1 className="text-lg font-bold text-foreground font-serif mb-1">Access denied</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    )
  }
  if (!caseData) return <Loader2 className="w-6 h-6 animate-spin text-primary" />

  return (
    <div className="space-y-4">
      <Link to="/cases" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
        <ArrowLeft className="w-4 h-4" /> Back to my cases
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground font-serif">{caseData.caseNumber || caseData.caseId}</h1>
          <p className="text-sm text-muted-foreground">{caseData.clientName} · {caseData.visaType}</p>
        </div>
        <CaseStatusBadge status={caseData.status} />
      </div>

      <nav className="flex gap-1 border-b border-border overflow-x-auto">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                isActive ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Outlet context={{ caseData }} />
    </div>
  )
}
