import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Briefcase, Activity, MessageSquare, Loader2 } from 'lucide-react'
import { attorneyApi } from '../services/api'
import CaseStatusBadge from '../components/CaseStatusBadge'

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        <Icon className="w-4 h-4" />
        <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-3xl font-bold text-foreground font-serif">{value}</p>
    </div>
  )
}

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    attorneyApi
      .dashboard()
      .then(({ data }) => setStats(data.stats))
      .catch((err) => setError(err.response?.data?.message || 'Could not load your dashboard.'))
  }, [])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!stats) return <Loader2 className="w-6 h-6 animate-spin text-primary" />

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-foreground font-serif">Dashboard</h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={Briefcase} label="Assigned cases" value={stats.totalCases} />
        <StatCard icon={Activity} label="Active cases" value={stats.activeCases} />
        <StatCard icon={MessageSquare} label="Unread messages" value={stats.pendingFeedback} />
      </div>

      <section className="card !p-0 overflow-hidden">
        <h2 className="px-5 py-3 border-b border-border text-sm font-semibold text-foreground">Recent cases</h2>
        {stats.recentCases?.length ? (
          <ul>
            {stats.recentCases.map((item) => (
              <li key={item._id} className="border-b border-border last:border-0">
                <Link to={`/cases/${item._id}/overview`} className="flex items-center justify-between px-5 py-3 hover:bg-secondary transition-colors">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{item.caseNumber || item.caseId}</p>
                    <p className="text-xs text-muted-foreground">{item.clientName} · {item.visaType}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {item.unreadFeedback > 0 && (
                      <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
                        {item.unreadFeedback}
                      </span>
                    )}
                    <CaseStatusBadge status={item.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-8 text-sm text-muted-foreground text-center">No cases have been assigned to you yet.</p>
        )}
      </section>
    </div>
  )
}
