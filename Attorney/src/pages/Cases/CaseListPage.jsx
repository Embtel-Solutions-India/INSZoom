import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { attorneyApi } from '../../services/api'
import CaseStatusBadge from '../../components/CaseStatusBadge'

export default function CaseListPage() {
  const [cases, setCases] = useState(null)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    attorneyApi
      .cases()
      .then(({ data }) => setCases(data.cases || []))
      .catch((err) => setError(err.response?.data?.message || 'Could not load your cases.'))
  }, [])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!cases) return <Loader2 className="w-6 h-6 animate-spin text-primary" />

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-foreground font-serif">My Cases</h1>

      <div className="card !p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-muted-foreground text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left font-semibold px-5 py-3">Case</th>
              <th className="text-left font-semibold px-5 py-3">Client</th>
              <th className="text-left font-semibold px-5 py-3">Visa</th>
              <th className="text-left font-semibold px-5 py-3">Status</th>
              <th className="text-left font-semibold px-5 py-3">Assigned</th>
              <th className="text-left font-semibold px-5 py-3">Messages</th>
            </tr>
          </thead>
          <tbody>
            {cases.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">No cases have been assigned to you yet.</td></tr>
            )}
            {cases.map((item) => (
              <tr
                key={item._id}
                onClick={() => navigate(`/cases/${item._id}/overview`)}
                className="border-t border-border hover:bg-secondary transition-colors cursor-pointer"
              >
                <td className="px-5 py-3">
                  <Link
                    to={`/cases/${item._id}/overview`}
                    onClick={(event) => event.stopPropagation()}
                    className="font-semibold text-primary hover:underline"
                  >
                    {item.caseNumber || item.caseId}
                  </Link>
                </td>
                <td className="px-5 py-3 text-foreground">{item.clientName}</td>
                <td className="px-5 py-3 text-foreground">{item.visaType}</td>
                <td className="px-5 py-3"><CaseStatusBadge status={item.status} /></td>
                <td className="px-5 py-3 text-muted-foreground">
                  {item.assignedAt ? new Date(item.assignedAt).toLocaleDateString() : '—'}
                </td>
                <td className="px-5 py-3">
                  {item.unreadFeedback > 0
                    ? <span className="rounded-full bg-destructive text-destructive-foreground text-xs font-bold px-2 py-0.5">{item.unreadFeedback}</span>
                    : <span className="text-muted-foreground/50">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
