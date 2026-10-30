import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import api from '../services/api'
import { useSocket } from '../contexts/SocketContext'
import { AlertTriangle, Briefcase, CheckCircle2, DollarSign, FileText, TrendingDown, TrendingUp, Minus } from 'lucide-react'

// Reuses the exact status colors already established elsewhere on this
// dashboard (Dashboard.jsx's paymentStatusData / REASON_COLORS) so the panel
// reads as one system rather than a new palette: green = good/collected,
// amber = warning/aging, red = critical/overdue-or-stale, blue = neutral info.
const STATUS_COLORS = { good: '#10b981', warning: '#f59e0b', critical: '#ef4444', info: '#2563eb', neutral: '#64748b' }

// Mostly clean blues with a few green/purple/orange accents; two stages may share a color. The color follows the stage's position so it stays the same across periods.
const STAGE_COLORS = ['#2563eb', '#3b82f6', '#0ea5e9', '#2563eb', '#8b5cf6', '#0ea5e9', '#3b82f6', '#10b981', '#2563eb', '#f59e0b', '#0ea5e9', '#8b5cf6', '#3b82f6']

// Visa-type bars use their own set so they read differently from the stage bars.
const VISA_COLORS = ['#10b981', '#8b5cf6', '#f59e0b', '#0ea5e9', '#ec4899', '#14b8a6', '#6366f1', '#f97316']

const PRIORITY_COLORS = { urgent: '#ef4444', high: '#f97316', 'Premium Processing': '#8b5cf6', medium: '#3b82f6', 'Standard Processing': '#14b8a6', low: '#10b981' }

const formatCents = (amount) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
}).format((Number(amount) || 0) / 100)

export const PERIODS = [
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: '1y', label: 'Last year' },
]

// Case-related socket events that mean this case manager's numbers may have
// changed - same events Dashboard.jsx already listens to for "Needs
// attention"/"Recent activity", plus payment:updated for the Payments
// section. Scoping happens server-side (assignedCaseManager); here we just
// need to know "something in my portal moved" and refetch.
const REALTIME_EVENTS = ['case:activity', 'case:assigned', 'case:client_submitted', 'payment:updated']

const SectionHeader = ({ title, sub }) => (
  <div className="mb-3">
    <h3 className="text-sm font-semibold text-foreground">{title}</h3>
    {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
  </div>
)

const MetricCard = ({ label, value, sub, dot, onClick }) => {
  const Component = onClick ? 'button' : 'div'
  return (
    <Component
      onClick={onClick}
      className={`text-left rounded-lg border border-border bg-card p-3 transition min-w-0 ${onClick ? 'hover:-translate-y-0.5 hover:border-border hover:shadow-sm cursor-pointer' : ''}`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className="stage-dot shrink-0" style={{ backgroundColor: dot }} />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">{label}</span>
      </div>
      <p className="text-2xl font-bold text-foreground leading-tight truncate">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1 truncate">{sub}</p>}
    </Component>
  )
}

const TrendBadge = ({ trend }) => {
  if (!trend) return null
  const { direction, percent, isNew } = trend
  const Icon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Minus
  const color = direction === 'up' ? 'text-emerald-600' : direction === 'down' ? 'text-red-600' : 'text-muted-foreground'
  const text = isNew ? 'New this month' : direction === 'flat' ? 'No change from last month' : `${percent}% ${direction === 'up' ? 'increase' : 'decrease'} from last month`
  return (
    <p className={`mt-1 flex items-center gap-1 text-xs font-medium ${color}`}>
      <Icon className="w-3.5 h-3.5" />
      {text}
    </p>
  )
}

const HeadlineCard = ({ label, value, trend, icon: Icon, onClick }) => (
  <button onClick={onClick} className="card text-left transition hover:-translate-y-0.5 hover:shadow-sm">
    <div className="flex items-start justify-between">
      <div>
        <p className="text-sm font-medium text-muted-foreground mb-1">{label}</p>
        <p className="text-3xl font-bold text-foreground">{value}</p>
        <TrendBadge trend={trend} />
      </div>
      <div className="p-3 bg-secondary rounded-lg"><Icon className="w-6 h-6 text-muted-foreground" /></div>
    </div>
  </button>
)

const CaseManagerAnalyticsPanel = () => {
  const navigate = useNavigate()
  const { subscribe, connected } = useSocket()
  const [period, setPeriod] = useState('30d')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchPanel = async () => {
    try {
      setError(null)
      const response = await api.get('/case-managers/analytics-panel', { params: { period } })
      setData(response.data)
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    fetchPanel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period])

  // Real-time: refetch the instant any case/payment activity happens
  // anywhere in this case manager's portal, without a manual refresh.
  useEffect(() => {
    if (!connected) return
    const unsubscribes = REALTIME_EVENTS.map((event) => subscribe(event, () => fetchPanel()))
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, period])

  if (loading) {
    return (
      <div className="card flex items-center justify-center h-40">
        <span className="text-sm text-muted-foreground">Loading analytics...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card">
        <div className="text-center py-10">
          <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground mb-4">{error}</p>
          <button onClick={() => { setLoading(true); fetchPanel() }} className="btn-primary">Retry</button>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="card">
        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <Briefcase className="w-8 h-8 mb-3" />
          <p className="text-sm">No cases assigned</p>
        </div>
      </div>
    )
  }

  const { active, attention, close, payments, activity, byVisaType, byStage = [], assignedCases = [], trend = { granularity: 'day', points: [] }, summary, outcomes = { approved: 0, rejected: 0, rfe: 0, needsAttention: 0 } } = data
  const maxVisaCount = Math.max(1, ...byVisaType.map((v) => v.count))
  const stageRows = byStage.map((row, index) => ({ ...row, color: STAGE_COLORS[index % STAGE_COLORS.length] })).filter((row) => row.count > 0)
  const maxStageCount = Math.max(1, ...stageRows.map((v) => v.count))

  const paymentsChartData = [
    { name: 'Collected', value: payments.collected, color: STATUS_COLORS.good },
    { name: 'Outstanding', value: payments.outstanding, color: STATUS_COLORS.critical },
  ]
  const hasPaymentsData = paymentsChartData.some((d) => d.value > 0)

  return (
    <div className="space-y-6">
      {/* Headline cards: total / active / closed with month-over-month trend */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <HeadlineCard label="Total Cases" value={summary.total.value} trend={summary.total.trend} icon={Briefcase} onClick={() => navigate('/crm-cases')} />
          <HeadlineCard label="Active Cases" value={summary.active.value} trend={summary.active.trend} icon={FileText} onClick={() => navigate('/crm-cases')} />
          <HeadlineCard label="Closed Cases" value={summary.closed.value} trend={summary.closed.trend} icon={CheckCircle2} onClick={() => navigate('/crm-cases?status=closed')} />
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Case Manager Analytics</h2>
          <p className="text-xs text-muted-foreground">{connected ? 'Live' : 'Connecting…'} · updates automatically as your cases change</p>
        </div>
        <div className="flex gap-1 self-start sm:self-auto">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${period === p.key ? 'bg-primary-600 text-white' : 'bg-secondary text-muted-foreground hover:bg-muted'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* CASE ANALYTICS */}
      <section className="rounded-xl border border-border bg-muted/60 p-4 sm:p-5 space-y-5">
        <SectionHeader title="Case Analytics" sub="Cases assigned to you that came in during the selected period" />

        {/* KPI strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard label="Approved" value={outcomes.approved} sub="moved to Approved" dot={STATUS_COLORS.good} />
          <MetricCard label="Rejected" value={outcomes.rejected} sub="moved to Disapproved" dot={STATUS_COLORS.critical} />
          <MetricCard label="RFE" value={outcomes.rfe} sub="moved to RFE" dot={STATUS_COLORS.warning} onClick={() => navigate('/crm-cases?rfeOverdue=1')} />
          <MetricCard label="Needs attention" value={outcomes.needsAttention} sub="cases that received an RFE" dot={STATUS_COLORS.critical} onClick={() => navigate('/crm-cases?attention=1')} />
        </div>

        {/* Two cards per row: Close outcomes | Activity distribution chart */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="card !bg-card">
            <SectionHeader title="Cases by stage" />
            {stageRows.length > 0 ? (
              <div className="space-y-2.5">
                {stageRows.map((row) => (
                  <div key={row.stage} className="flex items-center gap-3">
                    <span className="w-36 shrink-0 flex items-center gap-2 text-left text-xs text-muted-foreground" title={row.stage}>
                      <span className="stage-dot shrink-0" style={{ backgroundColor: row.color }} />
                      <span className="truncate">{row.stage}</span>
                    </span>
                    <span className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                      <span className="block h-full rounded-full" style={{ width: `${Math.max(8, (row.count / maxStageCount) * 100)}%`, backgroundColor: row.color }} />
                    </span>
                    <span className="w-8 text-right text-xs font-semibold text-muted-foreground">{row.count}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-6">No cases in any stage for this period</p>
            )}
          </div>

          <div className="card !bg-card">
            <SectionHeader title="Cases assigned" sub={`Per ${trend.granularity} · ${PERIODS.find((p) => p.key === period)?.label.toLowerCase()}`} />
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={trend.points} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="assignedTrendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" strokeOpacity={0.6} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} width={28} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(value) => [value, 'Cases']} />
                <Area type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2.5} fill="url(#assignedTrendFill)" dot={false} activeDot={{ r: 4 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Two cards per row: visa-type breakdown | overdue RFE detail */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="card !bg-card">
            <SectionHeader title="Cases by visa type" />
            {byVisaType.length > 0 ? (
              <div className="space-y-2.5">
                {byVisaType.map((row, index) => (
                  <button
                    key={row.visaType}
                    onClick={() => navigate(`/crm-cases?visaType=${encodeURIComponent(row.visaType)}`)}
                    className="w-full flex items-center gap-3 group"
                  >
                    <span className="w-28 shrink-0 flex items-center gap-2 text-left text-xs text-muted-foreground">
                      <span className="stage-dot shrink-0" style={{ backgroundColor: VISA_COLORS[index % VISA_COLORS.length] }} />
                      <span className="truncate">{row.visaType}</span>
                    </span>
                    <span className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                      <span className="block h-full rounded-full" style={{ width: `${Math.max(8, (row.count / maxVisaCount) * 100)}%`, backgroundColor: VISA_COLORS[index % VISA_COLORS.length] }} />
                    </span>
                    <span className="w-8 text-right text-xs font-semibold text-muted-foreground">{row.count}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-6">No cases in this period</p>
            )}
          </div>

          <div className="card !bg-card">
            <SectionHeader title="Overdue RFE detail" sub="Most urgent first" />
            {attention.overdueRfe.items.length > 0 ? (
              <div className="divide-y divide-border">
                {attention.overdueRfe.items.slice(0, 6).map((item) => (
                  <button
                    key={item.caseId}
                    onClick={() => navigate(`/crm-cases/${item.caseId}`)}
                    className="w-full flex items-center justify-between py-2 text-left hover:bg-muted rounded-lg px-1"
                  >
                    <span className="text-xs font-medium text-foreground truncate">{item.caseNumber} · {item.clientName}</span>
                    <span className={`text-xs font-semibold shrink-0 ${item.daysRemaining < 0 ? 'text-red-600' : 'text-amber-600'}`}>
                      {item.daysRemaining < 0 ? `${Math.abs(item.daysRemaining)}d overdue` : `${item.daysRemaining}d left`}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-6">No RFEs due soon</p>
            )}
          </div>
        </div>
      </section>

      {/* PAYMENTS - separate section, distinct from case analytics */}
      <section className="rounded-xl border border-border bg-muted/60 p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15">
            <DollarSign className="w-4 h-4 text-emerald-500" />
          </span>
          <SectionHeader title="Payments" sub="What's come in and what's still owed" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="card !bg-card">
            {hasPaymentsData ? (
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={paymentsChartData} cx="50%" cy="50%" innerRadius={45} outerRadius={65} paddingAngle={2} dataKey="value">
                    {paymentsChartData.map((entry, index) => <Cell key={index} fill={entry.color} stroke="none" />)}
                  </Pie>
                  <Tooltip formatter={(value) => formatCents(value)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">No payment activity yet</div>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-3">
            <MetricCard label="Collected" value={formatCents(payments.collected)} dot={STATUS_COLORS.good} />
            <MetricCard label="Outstanding" value={formatCents(payments.outstanding)} dot={STATUS_COLORS.critical} />
            <MetricCard label="Balance due" value={payments.casesWithBalance} sub="cases" dot={STATUS_COLORS.warning} />
          </div>
        </div>
      </section>

      {/* MY CASES - currently assigned, highest priority first, then newest */}
      <section className="card">
        <div className="mb-4">
          <h3 className="text-xl font-bold text-foreground">My Cases</h3>
          <p className="text-sm text-muted-foreground">Currently assigned to you, by priority then newest</p>
        </div>
        {assignedCases.length > 0 ? (
          <div className="space-y-2">
            {assignedCases.map((c) => {
              const color = PRIORITY_COLORS[c.priority] || PRIORITY_COLORS.medium
              const subtitle = [c.clientName, c.visaType].filter(Boolean).join(' · ')
              return (
                <div
                  key={c._id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 shadow-sm"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{c.caseNumber}</p>
                    {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize" style={{ color, backgroundColor: `${color}26` }}>{c.priority}</span>
                    <button onClick={() => navigate(`/crm-cases/${c._id}`)} className="btn-secondary text-sm">View</button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-6">No cases currently assigned</p>
        )}
      </section>
    </div>
  )
}

export default CaseManagerAnalyticsPanel
