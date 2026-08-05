import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import api from '../services/api'
import { useSocket } from '../contexts/SocketContext'
import { AlertTriangle, Briefcase, DollarSign } from 'lucide-react'

// Reuses the exact status colors already established elsewhere on this
// dashboard (Dashboard.jsx's paymentStatusData / REASON_COLORS) so the panel
// reads as one system rather than a new palette: green = good/collected,
// amber = warning/aging, red = critical/overdue-or-stale, blue = neutral info.
const STATUS_COLORS = { good: '#10b981', warning: '#f59e0b', critical: '#ef4444', info: '#2563eb', neutral: '#64748b' }

const formatCents = (amount) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
}).format((Number(amount) || 0) / 100)

const PERIODS = [
  { key: '90d', label: 'Last 90 days' },
  { key: 'ytd', label: 'Year to date' },
  { key: 'all', label: 'All time' },
]

// Case-related socket events that mean this case manager's numbers may have
// changed - same events Dashboard.jsx already listens to for "Needs
// attention"/"Recent activity", plus payment:updated for the Payments
// section. Scoping happens server-side (assignedCaseManager); here we just
// need to know "something in my portal moved" and refetch.
const REALTIME_EVENTS = ['case:activity', 'case:assigned', 'case:client_submitted', 'payment:updated']

const SectionHeader = ({ title, sub }) => (
  <div className="mb-3">
    <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
    {sub && <p className="text-xs text-gray-500">{sub}</p>}
  </div>
)

const MetricCard = ({ label, value, sub, dot, onClick }) => {
  const Component = onClick ? 'button' : 'div'
  return (
    <Component
      onClick={onClick}
      className={`text-left rounded-lg border border-gray-100 bg-white p-3 transition min-w-0 ${onClick ? 'hover:-translate-y-0.5 hover:border-gray-200 hover:shadow-sm cursor-pointer' : ''}`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className="stage-dot shrink-0" style={{ backgroundColor: dot }} />
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide truncate">{label}</span>
      </div>
      <p className="text-2xl font-bold text-gray-900 leading-tight truncate">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1 truncate">{sub}</p>}
    </Component>
  )
}

const CaseManagerAnalyticsPanel = () => {
  const navigate = useNavigate()
  const { subscribe, connected } = useSocket()
  const [period, setPeriod] = useState('90d')
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
        <span className="text-sm text-gray-500">Loading analytics...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="card">
        <div className="text-center py-10">
          <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
          <p className="text-sm text-gray-600 mb-4">{error}</p>
          <button onClick={() => { setLoading(true); fetchPanel() }} className="btn-primary">Retry</button>
        </div>
      </div>
    )
  }

  if (!data || data.totalCasesInScope === 0) {
    return (
      <div className="card">
        <div className="flex flex-col items-center justify-center py-10 text-gray-400">
          <Briefcase className="w-8 h-8 mb-3" />
          <p className="text-sm">No cases assigned</p>
        </div>
      </div>
    )
  }

  const { active, attention, close, payments, activity, byVisaType } = data
  const maxVisaCount = Math.max(1, ...byVisaType.map((v) => v.count))

  const activityChartData = [
    { name: '≤ 7 days', value: activity.distribution.d7, fill: STATUS_COLORS.good },
    { name: '8–30 days', value: activity.distribution.d30, fill: STATUS_COLORS.warning },
    { name: '> 30 days', value: activity.distribution.d30plus, fill: STATUS_COLORS.critical },
  ]

  const paymentsChartData = [
    { name: 'Collected', value: payments.collected, color: STATUS_COLORS.good },
    { name: 'Outstanding', value: payments.outstanding, color: STATUS_COLORS.critical },
  ]
  const hasPaymentsData = paymentsChartData.some((d) => d.value > 0)

  return (
    <div className="space-y-6">
      {/* Panel header: title, live status, shared period toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Case Manager Analytics</h2>
          <p className="text-xs text-gray-500">
            {connected ? 'Live' : 'Connecting…'} · updates automatically as your cases change
          </p>
        </div>
        <div className="flex gap-1 self-start sm:self-auto">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${period === p.key ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* CASE ANALYTICS */}
      <section className="rounded-xl border border-gray-100 bg-gray-50/60 p-4 sm:p-5 space-y-5">
        <SectionHeader title="Case Analytics" sub="Where your caseload stands right now" />

        {/* KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard label="Active cases" value={active.total} dot={STATUS_COLORS.info} onClick={() => navigate('/crm-cases')} />
          <MetricCard
            label="On hold"
            value={attention.onHold.total}
            sub={`${attention.onHold.byReason.nonPayment} non-payment · ${attention.onHold.byReason.other} other`}
            dot={STATUS_COLORS.warning}
            onClick={() => navigate('/crm-cases?status=on_hold')}
          />
          <MetricCard
            label="Overdue RFE"
            value={attention.overdueRfe.total}
            sub={attention.overdueRfe.items[0] ? `next due in ${attention.overdueRfe.items[0].daysRemaining}d` : 'none pending'}
            dot={STATUS_COLORS.critical}
            onClick={() => navigate('/crm-cases?rfeOverdue=1')}
          />
          <MetricCard
            label="Needs attention"
            value={attention.needsAttentionTotal}
            sub="deduplicated by case"
            dot={STATUS_COLORS.critical}
            onClick={() => navigate('/crm-cases?attention=1')}
          />
        </div>

        {/* Two cards per row: Close outcomes | Activity distribution chart */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="card !bg-white">
            <SectionHeader title="Close" sub="Outcomes for the selected period" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <MetricCard label="Approved" value={close.approved} dot={STATUS_COLORS.good} />
              <MetricCard label="Approval ratio" value={close.approvalRatio === null ? '—' : `${close.approvalRatio}%`} dot={STATUS_COLORS.info} />
              <MetricCard label="Closed" value={close.closed} dot={STATUS_COLORS.neutral} onClick={() => navigate('/crm-cases?status=closed')} />
            </div>
          </div>

          <div className="card !bg-white">
            <SectionHeader title="Activity status" sub="No update in 14+ days is flagged stale" />
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={activityChartData} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#4b5563' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#4b5563' }} axisLine={false} tickLine={false} width={28} />
                <Tooltip cursor={{ fill: '#f9fafb' }} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {activityChartData.map((entry, index) => <Cell key={index} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="text-xs text-gray-500 mt-1">{activity.stale} case{activity.stale === 1 ? '' : 's'} stale overall</p>
          </div>
        </div>

        {/* Two cards per row: visa-type breakdown | overdue RFE detail */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="card !bg-white">
            <SectionHeader title="Cases by visa type" />
            {byVisaType.length > 0 ? (
              <div className="space-y-2.5">
                {byVisaType.map((row) => (
                  <button
                    key={row.visaType}
                    onClick={() => navigate(`/crm-cases?visaType=${encodeURIComponent(row.visaType)}`)}
                    className="w-full flex items-center gap-3 group"
                  >
                    <span className="w-24 shrink-0 text-left text-xs text-gray-600 truncate">{row.visaType}</span>
                    <span className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <span className="block h-full rounded-full bg-primary-600" style={{ width: `${Math.max(8, (row.count / maxVisaCount) * 100)}%` }} />
                    </span>
                    <span className="w-8 text-right text-xs font-semibold text-gray-700">{row.count}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center py-6">No active cases yet</p>
            )}
          </div>

          <div className="card !bg-white">
            <SectionHeader title="Overdue RFE detail" sub="Most urgent first" />
            {attention.overdueRfe.items.length > 0 ? (
              <div className="divide-y divide-gray-100">
                {attention.overdueRfe.items.slice(0, 6).map((item) => (
                  <button
                    key={item.caseId}
                    onClick={() => navigate(`/crm-cases/${item.caseId}`)}
                    className="w-full flex items-center justify-between py-2 text-left hover:bg-gray-50 rounded-lg px-1"
                  >
                    <span className="text-xs font-medium text-gray-800 truncate">{item.caseNumber} · {item.clientName}</span>
                    <span className={`text-xs font-semibold shrink-0 ${item.daysRemaining < 0 ? 'text-red-600' : 'text-amber-600'}`}>
                      {item.daysRemaining < 0 ? `${Math.abs(item.daysRemaining)}d overdue` : `${item.daysRemaining}d left`}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center py-6">No RFEs due soon</p>
            )}
          </div>
        </div>
      </section>

      {/* PAYMENTS - separate section, distinct from case analytics */}
      <section className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-3">
          <DollarSign className="w-4 h-4 text-emerald-600" />
          <SectionHeader title="Payments" sub="What's come in and what's still owed" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="card !bg-white">
            {hasPaymentsData ? (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={paymentsChartData} cx="50%" cy="50%" innerRadius={45} outerRadius={65} paddingAngle={2} dataKey="value">
                      {paymentsChartData.map((entry, index) => <Cell key={index} fill={entry.color} stroke="none" />)}
                    </Pie>
                    <Tooltip formatter={(value) => formatCents(value)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Legend iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </>
            ) : (
              <div className="flex h-[180px] items-center justify-center text-sm text-gray-400">No payment activity yet</div>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-3">
            <MetricCard label="Collected" value={formatCents(payments.collected)} dot={STATUS_COLORS.good} />
            <MetricCard label="Outstanding" value={formatCents(payments.outstanding)} dot={STATUS_COLORS.critical} />
            <MetricCard label="Balance due" value={payments.casesWithBalance} sub="cases" dot={STATUS_COLORS.warning} />
          </div>
        </div>
      </section>
    </div>
  )
}

export default CaseManagerAnalyticsPanel
