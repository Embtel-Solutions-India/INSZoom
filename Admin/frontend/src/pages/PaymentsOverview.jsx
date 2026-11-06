import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { useSocket } from '../contexts/SocketContext'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { resolveDisplayVisa } from '../utils/visaDisplay'
import RevenueTrendChart from '../components/RevenueTrendChart'
import StatusDot from '../components/ui/StatusDot'
import { FINANCE_COLORS, FINANCE_STATUS } from '../utils/financeColors'
import { ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'

// Payments Overview. Every figure is read live from each case's GoHighLevel card, in US DOLLARS:
//   Total = the card's Value (the company's own fees, USCIS fees not included), USCIS Fee = the USCIS fees,
//   Paid = QB Amount Paid, Outstanding = Total - Paid.
// LIVE: the whole page (cards, every chart, the table) is re-read from the database the moment any case's figures change (the server announces it as
// payment:updated), and again every 30 seconds and whenever the tab is shown, so nothing here is ever stale.
const usd = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(amount) || 0)
const short = (value) => `$${Math.round(Number(value) || 0).toLocaleString('en-US')}`
const clip = (text, max = 18) => (String(text || '').length > max ? `${String(text).slice(0, max - 1)}…` : String(text || ''))
const TOOLTIP_STYLE = { fontSize: 12, borderRadius: 8 }
const REFRESH_MS = 30000
// each chart has its own palette, so the page is not just blue, green and red everywhere
const SHARE_COLORS = ['#8B5CF6', '#06B6D4', '#F59E0B', '#EC4899', '#84CC16', '#F97316', '#6366F1'] // paid by case type
const TYPE_BAR_COLORS = ['#06B6D4', '#F59E0B', '#8B5CF6', '#EC4899', '#84CC16', '#F97316', '#6366F1', '#14B8A6'] // outstanding by case type
const CASE_BAR_COLORS = ['#F97316', '#EC4899', '#8B5CF6', '#06B6D4', '#84CC16', '#EAB308', '#6366F1', '#14B8A6', '#F43F5E', '#3B82F6'] // outstanding by case
const MANAGER_COLORS = { total: '#6366F1', paid: '#14B8A6', outstanding: '#F97316' } // case managers

function Panel({ title, subtitle, children, empty, height = 230 }) {
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {subtitle ? <p className="mb-2 text-xs text-muted-foreground">{subtitle}</p> : <div className="mb-2" />}
      {empty ? <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>No data yet</div> : children}
    </div>
  )
}

// a donut with a legend of colour dots and dollar amounts
function Donut({ data, height = 170 }) {
  const total = data.reduce((sum, item) => sum + item.value, 0)
  return (
    <>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={70} paddingAngle={2} stroke="none">
            {data.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
          </Pie>
          <Tooltip formatter={(value, name) => [usd(value), name]} contentStyle={TOOLTIP_STYLE} />
        </PieChart>
      </ResponsiveContainer>
      <ul className="mt-1 space-y-1">
        {data.map((entry) => (
          <li key={entry.name} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="flex min-w-0 items-center gap-1.5"><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} aria-hidden="true" /><span className="truncate" title={entry.name}>{entry.name}</span></span>
            <span className="shrink-0 tabular-nums text-foreground">{usd(entry.value)}{total ? <span className="text-muted-foreground"> · {Math.round((entry.value / total) * 100)}%</span> : null}</span>
          </li>
        ))}
      </ul>
    </>
  )
}

const PaymentsOverview = () => {
  const { user } = useAuth()
  const { subscribe, connected } = useSocket()
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 })
  const [page, setPage] = useState(1)
  const [stats, setStats] = useState(null)
  const [breakdown, setBreakdown] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const normalizedRole = String(user?.role || '').toLowerCase().replace(/[\s-]+/g, '_')
  const canViewAnalytics = ['super_admin', 'admin', 'team_lead'].includes(normalizedRole)
  const hasLoadedOnce = useRef(false)

  // the search box waits a moment after typing
  useEffect(() => {
    const timer = setTimeout(() => { setAppliedSearch(searchTerm.trim()); setPage(1) }, 350)
    return () => clearTimeout(timer)
  }, [searchTerm])

  const fetchRows = useCallback(async () => {
    try {
      if (!hasLoadedOnce.current) setLoading(true)
      const response = await api.get('/analytics/payments/cases', { params: { page, limit: 25, search: appliedSearch || undefined, status: statusFilter || undefined } })
      setRows(response.data.items || [])
      setPagination(response.data.pagination || { page: 1, pages: 1, total: 0 })
      setError('')
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load the payments.')
    } finally {
      hasLoadedOnce.current = true
      setLoading(false)
    }
  }, [page, appliedSearch, statusFilter])

  const fetchSummary = useCallback(async () => {
    if (!canViewAnalytics) return
    try {
      const [totals, parts] = await Promise.all([api.get('/analytics/payments'), api.get('/analytics/payments/breakdown')])
      setStats(totals.data)
      setBreakdown(parts.data)
    } catch (err) {
      console.error('Error fetching payment totals:', err)
    }
  }, [canViewAnalytics])

  useEffect(() => { fetchRows() }, [fetchRows])
  useEffect(() => { fetchSummary() }, [fetchSummary])

  // Live refresh of everything on the page (the trend chart refreshes itself the same way)
  useEffect(() => {
    const refresh = () => { fetchRows(); fetchSummary() }
    const unsubscribe = subscribe('payment:updated', refresh)
    const interval = window.setInterval(() => { if (!document.hidden) refresh() }, REFRESH_MS)
    const onVisibilityChange = () => { if (!document.hidden) refresh() }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      unsubscribe()
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [fetchRows, fetchSummary, subscribe, connected])

  const collectionRate = stats?.paymentRate || 0

  // ---- chart data ----
  const types = breakdown?.byVisaType || []
  const paidByType = (() => {
    const sorted = types.filter((item) => item.paid > 0).sort((a, b) => b.paid - a.paid)
    const head = sorted.slice(0, 7).map((item, index) => ({ name: item.visaType, value: item.paid, color: SHARE_COLORS[index % SHARE_COLORS.length] }))
    const rest = sorted.slice(7).reduce((sum, item) => sum + item.paid, 0)
    return rest > 0 ? [...head, { name: 'Other', value: rest, color: FINANCE_COLORS.neutral }] : head
  })()
  const outstandingByType = types.filter((item) => item.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding).slice(0, 8).map((item) => ({ name: clip(item.visaType, 16), full: item.visaType, outstanding: item.outstanding }))
  // each bar is named by the petitioner only (no case number), cut with … to stay on one line; the tooltip has the full name and the case type
  const topCases = (breakdown?.topOutstandingCases || []).map((item) => ({ name: clip(item.petitioner || item.name, 22), full: `${item.petitioner || item.name}${item.visaType ? ` · ${item.visaType}` : ''}`, outstanding: item.outstanding }))
  const managers = (breakdown?.byCaseManager || []).slice(0, 8).map((item) => ({ name: clip(item.name, 12), full: item.name, cases: item.cases, total: item.total, paid: item.paid, outstanding: item.outstanding, average: item.averageCaseValue }))
  const overallDonut = [
    { name: 'Paid', value: Number(stats?.totalRevenue) || 0, color: FINANCE_COLORS.paid },
    { name: 'Outstanding', value: Number(stats?.pendingAmount) || 0, color: FINANCE_COLORS.outstanding },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Payments Overview</h1>
        <p className="text-muted-foreground mt-1">Case fees, USCIS fees and what clients have paid (live from GoHighLevel, in US dollars)</p>
      </div>

      {canViewAnalytics && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {[
              { label: 'Total Fees', value: usd(stats?.total), sub: `${stats?.count || 0} case${stats?.count === 1 ? '' : 's'}`, dot: FINANCE_COLORS.total },
              { label: 'USCIS Fees', value: usd(stats?.uscisFees), sub: 'tracked separately', dot: FINANCE_COLORS.uscis },
              { label: 'Collected', value: usd(stats?.totalRevenue), sub: 'paid by clients', dot: FINANCE_COLORS.paid },
              { label: 'Outstanding', value: usd(stats?.pendingAmount), sub: 'total fees not yet paid', dot: FINANCE_COLORS.outstanding },
              { label: 'Collection Rate', value: `${collectionRate}%`, sub: 'collected / total fees', dot: FINANCE_COLORS.partial },
            ].map(({ label, value, sub, dot }) => (
              <div key={label} className="card">
                <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: dot }} aria-hidden="true" />{label}
                </p>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
              </div>
            ))}
          </div>

          <RevenueTrendChart title="Collected per day" />

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <Panel title="Paid vs outstanding" subtitle="All cases" empty={overallDonut[0].value + overallDonut[1].value === 0}>
              <Donut data={overallDonut} />
            </Panel>
            <Panel title="Paid by case type" subtitle="Share of what has been collected" empty={paidByType.length === 0}>
              <Donut data={paidByType} />
            </Panel>
            <Panel title="Outstanding by case type" subtitle="Still to be paid" empty={outstandingByType.length === 0}>
              <ResponsiveContainer width="100%" height={Math.max(200, outstandingByType.length * 34 + 20)}>
                <BarChart data={outstandingByType} layout="vertical" margin={{ left: 0, right: 12, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={short} />
                  <YAxis dataKey="name" type="category" width={92} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(value) => usd(value)} labelFormatter={(label, items) => items?.[0]?.payload?.full || label} contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                  <Bar dataKey="outstanding" name="Outstanding" radius={[0, 4, 4, 0]} barSize={14}>
                    {outstandingByType.map((entry, index) => <Cell key={entry.full} fill={TYPE_BAR_COLORS[index % TYPE_BAR_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Panel title="Outstanding by case" subtitle="The 10 cases with the most still to pay" empty={topCases.length === 0}>
              <ResponsiveContainer width="100%" height={Math.max(220, topCases.length * 32 + 20)}>
                <BarChart data={topCases} layout="vertical" margin={{ left: 0, right: 12, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={short} />
                  <YAxis dataKey="name" type="category" width={150} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(value) => usd(value)} labelFormatter={(label, items) => items?.[0]?.payload?.full || label} contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                  <Bar dataKey="outstanding" name="Outstanding" radius={[0, 4, 4, 0]} barSize={14}>
                    {topCases.map((entry, index) => <Cell key={`${entry.full}-${index}`} fill={CASE_BAR_COLORS[index % CASE_BAR_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>
            <Panel title="Case managers: fees handled vs collected" subtitle="By the case manager assigned to each case: who handles the most valuable cases" empty={managers.length === 0}>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={managers} margin={{ left: 0, right: 8, top: 6, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={short} width={64} />
                  <Tooltip formatter={(value, name) => [usd(value), name]} labelFormatter={(label, items) => { const p = items?.[0]?.payload; return p ? `${p.full} · ${p.cases} case${p.cases === 1 ? '' : 's'} · average ${usd(p.average)}` : label }} contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} formatter={(value) => <span className="text-muted-foreground">{value}</span>} />
                  <Bar dataKey="total" name="Total fees" fill={MANAGER_COLORS.total} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="paid" name="Collected" fill={MANAGER_COLORS.paid} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="outstanding" name="Outstanding" fill={MANAGER_COLORS.outstanding} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          </div>
        </>
      )}

      <div className="card">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input type="text" placeholder="Search name, email, case, invoice or visa…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
            </div>
          </div>
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }} className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
            <option value="">All Status</option>
            <option value="paid">Paid</option>
            <option value="partially_paid">Partially paid</option>
            <option value="pending">Unpaid</option>
          </select>
        </div>
      </div>

      <div className="card">
        <h3 className="text-sm font-semibold text-foreground">Case Payments</h3>
        <p className="mb-3 text-xs text-muted-foreground">Cases whose GoHighLevel card has a Value, USCIS Fee or QB Amount Paid. Click a row to open the case.</p>
        {error ? <p className="mb-3 text-sm text-red-700">{error}</p> : null}
        {loading ? (
          <div className="flex items-center justify-center h-40"><div className="text-muted-foreground">Loading payments…</div></div>
        ) : (
          // fits the page width (no sideways scroll); scrolls up and down after 10 rows
          <div className="overflow-x-hidden overflow-y-auto rounded-lg border border-border" style={{ maxHeight: 570 }}>
            <table className="w-full table-fixed text-[13px]">
              <colgroup>
                <col style={{ width: '24%' }} /><col style={{ width: '13%' }} /><col style={{ width: '12%' }} /><col style={{ width: '11%' }} /><col style={{ width: '9%' }} /><col style={{ width: '11%' }} /><col style={{ width: '11%' }} /><col style={{ width: '9%' }} />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-muted">
                <tr>
                  {['Client', 'Case type', 'Case', 'Total fees', 'USCIS', 'Paid', 'Outstanding', 'Status'].map((heading) => (
                    <th key={heading} className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length > 0 ? rows.map((row) => {
                  const status = FINANCE_STATUS[row.status] || FINANCE_STATUS.no_fee
                  const visa = resolveDisplayVisa(row) || '—'
                  return (
                    <tr key={row._id} onClick={() => navigate(`/crm-cases/${row._id}`)} className="cursor-pointer border-t border-border hover:bg-muted/60">
                      <td className="px-3 py-2">
                        <p className="truncate font-medium text-foreground" title={row.clientName}>{row.clientName || '—'}</p>
                        <p className="truncate text-[11px] text-muted-foreground" title={row.clientEmail}>{row.clientEmail || ''}</p>
                      </td>
                      <td className="px-3 py-2"><p className="truncate text-foreground" title={visa}>{visa}</p></td>
                      <td className="px-3 py-2">
                        <p className="truncate text-foreground" title={row.caseNumber}>{row.caseNumber}</p>
                        {row.invoiceNo ? <p className="truncate text-[11px] text-muted-foreground" title={`Invoice ${row.invoiceNo}`}>{row.invoiceNo}</p> : null}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{usd(row.totalAmount)}</td>
                      <td className="px-3 py-2 tabular-nums">{usd(row.uscisFee)}</td>
                      <td className="px-3 py-2 font-medium tabular-nums text-foreground">{usd(row.amountPaid)}</td>
                      <td className="px-3 py-2 font-medium tabular-nums text-foreground">{usd(row.outstanding)}</td>
                      <td className="px-3 py-2"><StatusDot color={status.color}>{status.label}</StatusDot></td>
                    </tr>
                  )
                }) : (
                  <tr><td colSpan={8} className="px-6 py-10 text-center text-muted-foreground">No payments found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {pagination.pages > 1 ? (
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>{pagination.total} cases · page {pagination.page} of {pagination.pages}</span>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
              <button type="button" className="btn-secondary" disabled={page >= pagination.pages} onClick={() => setPage((current) => Math.min(pagination.pages, current + 1))}>Next</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default PaymentsOverview
