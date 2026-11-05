import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { useSocket } from '../contexts/SocketContext'
import { useNavigate } from 'react-router-dom'
import { DollarSign, TrendingUp, Clock, Search, ExternalLink, Landmark } from 'lucide-react'
import { resolveDisplayVisa } from '../utils/visaDisplay'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

// Payments Overview. Every figure is read live from each case's GoHighLevel card, in US DOLLARS:
//   Total = the card's Value (the company's own fees, USCIS fees not included), USCIS Fee = the USCIS fees,
//   Paid = QB Amount Paid, Outstanding = Total - Paid.
// (The old Stripe payment records are no longer used for these numbers.)
const usd = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(amount) || 0)
const STATUS_LABELS = { paid: 'Paid', partially_paid: 'Partially paid', pending: 'Unpaid', no_fee: 'No fee set' }
const STATUS_COLORS = { paid: 'bg-green-100 text-green-800', partially_paid: 'bg-amber-100 text-amber-800', pending: 'bg-red-100 text-red-800', no_fee: 'bg-secondary text-foreground' }
const formatDate = (value) => {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

const PaymentsOverview = () => {
  const { user } = useAuth()
  const { subscribe, connected } = useSocket()
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 })
  const [page, setPage] = useState(1)
  const [stats, setStats] = useState(null)
  const [revenueData, setRevenueData] = useState([])
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
      const [totals, revenue] = await Promise.all([api.get('/analytics/payments'), api.get('/analytics/revenue')])
      setStats(totals.data)
      setRevenueData((revenue.data.monthlyRevenue || []).map((item) => ({ ...item, amount: Number(item.value || 0) })))
    } catch (err) {
      console.error('Error fetching payment totals:', err)
    }
  }, [canViewAnalytics])

  useEffect(() => { fetchRows() }, [fetchRows])
  useEffect(() => { fetchSummary() }, [fetchSummary])

  // Live: the server announces every change of a case's GoHighLevel figures (payment:updated); the timer is only a safety net.
  useEffect(() => {
    const refresh = () => { fetchRows(); fetchSummary() }
    const unsubscribe = subscribe('payment:updated', refresh)
    const interval = window.setInterval(refresh, 120000)
    const onVisibilityChange = () => { if (!document.hidden) refresh() }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      unsubscribe()
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [fetchRows, fetchSummary, subscribe, connected])

  const collectionRate = stats?.paymentRate || 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Payments Overview</h1>
        <p className="text-muted-foreground mt-1">Case fees, USCIS fees and what clients have paid (from GoHighLevel, in US dollars)</p>
      </div>

      {canViewAnalytics && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
          {[
            { label: 'Total Fees', value: usd(stats?.total), sub: `${stats?.count || 0} cases`, Icon: DollarSign, tone: 'from-blue-500 to-blue-600' },
            { label: 'USCIS Fees', value: usd(stats?.uscisFees), sub: 'tracked separately', Icon: Landmark, tone: 'from-purple-500 to-indigo-600' },
            { label: 'Collected', value: usd(stats?.totalRevenue), sub: 'paid by clients', Icon: TrendingUp, tone: 'from-green-500 to-emerald-600' },
            { label: 'Outstanding', value: usd(stats?.pendingAmount), sub: 'total fees not yet paid', Icon: Clock, tone: 'from-amber-500 to-orange-600' },
            { label: 'Collection Rate', value: `${collectionRate}%`, sub: 'collected / total fees', Icon: TrendingUp, tone: 'from-blue-500 to-cyan-600' },
          ].map(({ label, value, sub, Icon, tone }) => (
            <div key={label} className="card">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">{label}</p>
                  <p className="text-2xl font-bold text-foreground">{value}</p>
                  <p className="text-sm text-muted-foreground mt-1">{sub}</p>
                </div>
                <div className={`p-3 rounded-lg bg-gradient-to-br ${tone}`}><Icon className="w-6 h-6 text-white" /></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {canViewAnalytics && (
        <div className="card">
          <h3 className="text-lg font-semibold text-foreground mb-4">Collected by Month</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={revenueData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis tickFormatter={(value) => `$${Number(value).toLocaleString()}`} />
              <Tooltip formatter={(value) => usd(value)} />
              <Bar dataKey="amount" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>
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
        <h3 className="text-lg font-semibold text-foreground mb-1">Case Payments</h3>
        <p className="text-sm text-muted-foreground mb-4">Only cases whose GoHighLevel card has a Value, USCIS Fee or QB Amount Paid are listed.</p>
        {error ? <p className="mb-3 text-sm text-red-700">{error}</p> : null}
        {loading ? (
          <div className="flex items-center justify-center h-64"><div className="text-muted-foreground">Loading payments…</div></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-muted">
                  {['Client', 'Case', 'Invoice (QB)', 'Total Fees', 'USCIS Fee', 'Paid', 'Outstanding', 'Status', 'Updated', ''].map((heading) => (
                    <th key={heading || 'action'} className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length > 0 ? rows.map((row) => (
                  <tr key={row._id} className="border-b hover:bg-muted">
                    <td className="px-6 py-4">
                      <p className="font-semibold text-foreground">{row.clientName || '—'}</p>
                      <p className="text-xs text-muted-foreground">{row.clientEmail || ''}</p>
                      <span className="mt-1 inline-block rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{resolveDisplayVisa(row) || '—'}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-xs text-muted-foreground">{row.caseNumber}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{row.invoiceNo || '—'}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{usd(row.totalAmount)}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{usd(row.uscisFee)}</td>
                    <td className="px-6 py-4 whitespace-nowrap font-semibold text-green-600">{usd(row.amountPaid)}</td>
                    <td className="px-6 py-4 whitespace-nowrap font-semibold text-amber-600">{usd(row.outstanding)}</td>
                    <td className="px-6 py-4 whitespace-nowrap"><span className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[row.status] || STATUS_COLORS.no_fee}`}>{STATUS_LABELS[row.status] || row.status}</span></td>
                    <td className="px-6 py-4 whitespace-nowrap text-xs text-muted-foreground">{formatDate(row.updatedAt)}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <button type="button" onClick={() => navigate(`/crm-cases/${row._id}`)} className="inline-flex items-center gap-1.5 font-medium text-blue-700 hover:text-blue-900"><ExternalLink className="h-4 w-4" /> Open case</button>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={10} className="px-6 py-12 text-center text-muted-foreground">No payments found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {pagination.pages > 1 ? (
          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
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
