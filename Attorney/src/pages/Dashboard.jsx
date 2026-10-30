import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Briefcase, Activity, MessageSquare, CheckCircle2, ListChecks, AlertTriangle, Loader2, TrendingUp, TrendingDown, ArrowRight } from 'lucide-react'
import { attorneyApi } from '../services/api'
import CaseStatusBadge from '../components/CaseStatusBadge'
import WorkStateBadge, { isNotableCaseStatus } from '../components/WorkStateBadge'
import { Panel, Empty, Donut, BarList, Columns, StatusDonut, Sparkline, weekDelta, SERIES, NEUTRAL } from '../components/DashboardCharts'

// Green when the week moved the good way, red when the bad way, muted when flat.
function deltaTone(direction, upIsGood) {
  if (direction === 0) return 'text-muted-foreground'
  return (direction > 0) === upIsGood ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
}

function waitingFor(value) {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000)
  if (!(days >= 1)) return 'since today'
  return `for ${days} ${days === 1 ? 'day' : 'days'}`
}

function StatCard({ icon: Icon, label, value, hint, tone, dot, delta, upIsGood = true, trend, trendColor, footer }) {
  return (
    <div className="card flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {dot && <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />}
          {label}
        </span>
        <Icon className={`w-4 h-4 ${tone || 'text-muted-foreground'}`} />
      </div>
      <p className="text-3xl font-bold text-foreground font-serif tabular-nums">{value}</p>
      {delta && (
        <p className={`mt-1 inline-flex items-center gap-1 text-xs font-medium ${deltaTone(delta.direction, upIsGood)}`}>
          {delta.direction > 0 && <TrendingUp className="w-3.5 h-3.5" />}
          {delta.direction < 0 && <TrendingDown className="w-3.5 h-3.5" />}
          {delta.text}
        </p>
      )}
      {/* a card with a week-over-week trend shows just that line; the extra hint is only for cards without one */}
      {hint && !delta && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      {trend && <div className="mt-auto pt-3 -mx-1"><Sparkline values={trend} color={trendColor} /></div>}
      {footer && <div className="mt-auto pt-3 flex items-end min-h-[48px]">{footer}</div>}
    </div>
  )
}

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    attorneyApi
      .dashboard()
      .then(({ data: body }) => setData(body))
      .catch((err) => setError(err.response?.data?.message || 'Could not load your dashboard.'))
  }, [])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!data?.stats) return <Loader2 className="w-6 h-6 animate-spin text-primary" />

  const { stats, insights } = data
  const trends = insights?.trends || null
  const pct = stats.totalCases && insights ? Math.round((insights.reviewed.reviewed / stats.totalCases) * 100) : 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground font-serif">Dashboard</h1>
        <p className="text-xs text-muted-foreground mt-0.5">A live overview of the cases assigned to you.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard icon={Briefcase} label="Assigned cases" dot="bg-sky-500" value={stats.totalCases} hint="Cases you have access to"
          delta={trends?.assigned && weekDelta(trends.assigned.current, trends.assigned.previous)} trend={trends?.assigned?.series} trendColor="#0ea5e9" />
        <StatCard icon={Activity} label="Active cases" dot="bg-emerald-500" value={insights?.workCounts ? insights.workCounts.active : stats.activeCases}
          hint={insights?.workCounts ? `${insights.workCounts.assigned} awaiting your first action` : undefined}
          delta={trends?.active && weekDelta(trends.active.current, trends.active.previous)} trend={trends?.active?.series} trendColor="#10b981" />
        <StatCard icon={MessageSquare} label="Unread messages" dot="bg-amber-500" value={stats.pendingFeedback}
          hint={insights ? (stats.pendingFeedback > 0
            ? `Across ${insights.casesWithUnread} ${insights.casesWithUnread === 1 ? 'case' : 'cases'}${insights.oldestUnreadAt ? ` · oldest waiting ${waitingFor(insights.oldestUnreadAt)}` : ''}`
            : 'All caught up') : undefined}
          footer={<Link to="/messages" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Open messages <ArrowRight className="w-3.5 h-3.5" /></Link>} />
        {insights && (
          <StatCard icon={CheckCircle2} label="Reviewed" dot="bg-indigo-500" value={insights.reviewed.reviewed} hint={`${pct}% of ${stats.totalCases} ${stats.totalCases === 1 ? 'case' : 'cases'} reviewed`} tone="text-primary"
            delta={trends?.reviewed && weekDelta(trends.reviewed.current, trends.reviewed.previous)} trend={trends?.reviewed?.series} trendColor="#6366f1" />
        )}
      </div>

      {insights && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Panel title="Review progress" subtitle="Cases you marked review complete vs. still in review">
              <Donut
                centerValue={stats.totalCases}
                centerLabel="cases"
                parts={[
                  { label: 'Reviewed', value: insights.reviewed.reviewed, color: SERIES[0] },
                  { label: 'In review', value: insights.reviewed.notReviewed, color: NEUTRAL },
                ]}
              />
            </Panel>

            <Panel title="Cases assigned over time" subtitle="Last 6 months" className="lg:col-span-2">
              <Columns items={insights.assignedByMonth} />
            </Panel>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Panel title="Cases by visa type" subtitle="Most frequent types">
              {insights.byVisaType.length ? <BarList items={insights.byVisaType} colorIndex={1} /> : <Empty />}
            </Panel>
            <Panel title="Case status">
              <StatusDonut items={insights.byStatus} />
            </Panel>
            <Panel title="Case priority">
              {insights.byPriority.length ? <BarList items={insights.byPriority} colorIndex={1} /> : <Empty />}
            </Panel>
          </div>

          <Panel title="My tasks" subtitle="Tasks assigned to you">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="grid grid-cols-3 md:grid-cols-1 gap-3">
                <div className="flex items-center gap-2 text-sm"><ListChecks className="w-4 h-4 text-primary" /><span className="text-muted-foreground">Open</span><b className="ml-auto tabular-nums">{insights.tasks.open}</b></div>
                <div className="flex items-center gap-2 text-sm"><CheckCircle2 className="w-4 h-4 text-muted-foreground" /><span className="text-muted-foreground">Completed</span><b className="ml-auto tabular-nums">{insights.tasks.completed}</b></div>
                <div className="flex items-center gap-2 text-sm"><AlertTriangle className="w-4 h-4 text-destructive" /><span className="text-muted-foreground">Overdue</span><b className="ml-auto tabular-nums">{insights.tasks.overdue}</b></div>
              </div>
              <div className="md:col-span-2">
                {insights.tasks.byStatus.length ? <BarList items={insights.tasks.byStatus} colorIndex={2} /> : <Empty>No tasks yet.</Empty>}
              </div>
            </div>
          </Panel>
        </>
      )}

      <section className="card !p-0 overflow-hidden">
        <h2 className="px-4 sm:px-5 py-3 border-b border-border text-sm font-semibold text-foreground">Recent cases</h2>
        {stats.recentCases?.length ? (
          <ul>
            {stats.recentCases.map((item) => (
              <li key={item._id} className="border-b border-border last:border-0">
                <Link to={`/cases/${item._id}/overview`} className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 hover:bg-secondary transition-colors">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{item.caseNumber || item.caseId}</p>
                    <p className="text-xs text-muted-foreground truncate">{item.clientName} · {item.visaType}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {item.unreadFeedback > 0 && (
                      <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
                        {item.unreadFeedback}
                      </span>
                    )}
                    <WorkStateBadge state={item.workState} />
                    {isNotableCaseStatus(item.status) && <CaseStatusBadge status={item.status} />}
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
