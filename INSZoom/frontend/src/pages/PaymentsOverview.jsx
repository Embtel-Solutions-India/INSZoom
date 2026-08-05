import { useState, useEffect, useRef } from 'react'
import api from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { useSocket } from '../contexts/SocketContext'
import { useNavigate } from 'react-router-dom'
import { DollarSign, TrendingUp, AlertTriangle, Clock, Search, Eye, ExternalLink, X } from 'lucide-react'
import { resolveDisplayVisa } from '../utils/visaDisplay'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

const PaymentsOverview = () => {
  const { user } = useAuth()
  const { subscribe, connected } = useSocket()
  const navigate = useNavigate()
  const [payments, setPayments] = useState([])
  const [stats, setStats] = useState(null)
  const [revenueData, setRevenueData] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')                    
  const [statusFilter, setStatusFilter] = useState('')
  const [period, setPeriod] = useState('this_month')
  const [selectedPayment, setSelectedPayment] = useState(null)
  const normalizedRole = String(user?.role || '').toLowerCase().replace(/[\s-]+/g, '_')
  const canViewAnalytics = ['super_admin', 'admin', 'team_lead'].includes(normalizedRole)

  useEffect(() => {
    fetchPayments()
    if (canViewAnalytics) {
      fetchStats()
      fetchRevenueData()
    }
  }, [statusFilter, period, canViewAnalytics])

  useEffect(() => {
    const refresh = () => {
      fetchPayments()
      if (canViewAnalytics) {
        fetchStats()
        fetchRevenueData()
      }
    }
    // Live-refresh on the backend's existing payment:updated socket event
    // (payment.service.js already emits it) instead of relying solely on
    // polling; the interval below now only exists as a safety net.
    const unsubscribe = subscribe('payment:updated', refresh)
    const interval = window.setInterval(refresh, 120000)
    const onVisibilityChange = () => {
      if (!document.hidden) refresh()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      unsubscribe()
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [statusFilter, period, canViewAnalytics, subscribe, connected])

  // Only the very first load blocks the table — filter changes, socket-driven
  // refreshes, and the safety-net poll all update the rows in place.
  const hasLoadedOnce = useRef(false)

  const fetchPayments = async () => {
    try {
      if (!hasLoadedOnce.current) setLoading(true)
      const params = {}
      if (statusFilter) params.paymentStatus = statusFilter

      const response = await api.get('/payments', { params })
      setPayments(response.data.payments || [])
    } catch (error) {
      console.error('Error fetching payments:', error)
    } finally {
      hasLoadedOnce.current = true
      setLoading(false)
    }
  }

  const fetchStats = async () => {
    try {
      const response = await api.get('/analytics/payments')
      setStats(response.data)
    } catch (error) {
      console.error('Error fetching payment stats:', error)
    }
  }

  const fetchRevenueData = async () => {
    try {
      const response = await api.get('/analytics/revenue')
      setRevenueData((response.data.monthlyRevenue || []).map(item => ({
        ...item,
        amount: Number(item.value || item.amount || 0) / 100
      })))
    } catch (error) {
      console.error('Error fetching revenue data:', error)
    }
  }

  const filteredPayments = payments.filter(payment => {
    const caseData = payment.caseId || payment.case
    const query = searchTerm.toLowerCase()
    const matchesSearch = !query ||
      payment.invoiceNumber?.toLowerCase().includes(query) ||
      caseData?.caseNumber?.toLowerCase().includes(query) ||
      caseData?.clientName?.toLowerCase().includes(query) ||
      payment.user?.email?.toLowerCase().includes(query)
    return matchesSearch
  })

  const getStatusColor = (status) => {
    const colors = {
      paid: 'bg-green-100 text-green-800',
      partially_paid: 'bg-amber-100 text-amber-800',
      not_started: 'bg-red-100 text-red-800',
      overdue: 'bg-red-100 text-red-800'
    }
    return colors[status] || 'bg-gray-100 text-gray-800'
  }

  const formatCurrency = (amount, currency = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: String(currency || 'USD').toUpperCase()
    }).format((Number(amount) || 0) / 100)
  }

  const formatDate = (...values) => {
    for (const value of values) {
      if (!value) continue
      const parsed = new Date(value)
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
      }
    }
    return 'Not available'
  }

  const paymentDate = (payment) => {
    const paidTransaction = [...(payment.transactions || [])]
      .filter((transaction) => transaction.paidAt || ['paid', 'succeeded'].includes(transaction.status))
      .sort((left, right) => new Date(right.paidAt || right.createdAt || 0) - new Date(left.paidAt || left.createdAt || 0))[0]
    const paymentHistory = [...(payment.paymentHistory || [])]
      .sort((left, right) => new Date(right.paymentDate || 0) - new Date(left.paymentDate || 0))[0]
    const paidDate = formatDate(payment.paymentDate, paidTransaction?.paidAt, paymentHistory?.paymentDate)
    return paidDate === 'Not available' ? 'Not paid yet' : paidDate
  }

  const activityDate = (payment) => {
    const paidDate = paymentDate(payment)
    return paidDate === 'Not paid yet' ? formatDate(payment.updatedAt, payment.createdAt) : paidDate
  }

  const caseFor = (payment) => payment.caseId || payment.case || null
  const packageFor = (payment) => payment.packageName || payment.plan?.packageName || payment.package || caseFor(payment)?.plan?.packageName || caseFor(payment)?.package || 'Not assigned'
  const displayText = (value) => String(value || 'Not available').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
  const selectedCase = selectedPayment ? caseFor(selectedPayment) : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Payments Overview</h1>
        <p className="text-gray-600 mt-1">
          {canViewAnalytics ? 'Track case payments, balances, and revenue' : 'Review case invoices, payments, and outstanding balances'}
        </p>
      </div>

      {/* Manager Payment Analytics */}
      {canViewAnalytics && <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="card">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 mb-1">Total Revenue</p>
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(stats?.totalRevenue || 0)}</p>
              <p className="text-sm text-blue-600 mt-1">This month</p>
            </div>
            <div className="p-3 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600">
              <DollarSign className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 mb-1">Pending Payments</p>
              <p className="text-2xl font-bold text-gray-900">{stats?.pendingPayments || 0}</p>
              <p className="text-sm text-amber-600 mt-1">{formatCurrency(stats?.pendingAmount || 0)}</p>
            </div>
            <div className="p-3 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600">
              <Clock className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 mb-1">Overdue Payments</p>
              <p className="text-2xl font-bold text-gray-900">{stats?.overduePayments || 0}</p>
              <p className="text-sm text-red-600 mt-1">{formatCurrency(stats?.overdueAmount || 0)}</p>
            </div>
            <div className="p-3 rounded-lg bg-gradient-to-br from-red-500 to-pink-600">
              <AlertTriangle className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 mb-1">Payment Rate</p>
              <p className="text-2xl font-bold text-gray-900">{stats?.paymentRate || 0}%</p>
              <p className="text-sm text-green-600 mt-1">Collection rate</p>
            </div>
            <div className="p-3 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-600">
              <TrendingUp className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>
      </div>}

      {/* Revenue Chart */}
      {canViewAnalytics && <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Revenue by Month</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={revenueData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="amount" fill="#10b981" />
          </BarChart>
        </ResponsiveContainer>
      </div>}

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search payments..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Status</option>
              <option value="paid">Paid</option>
              <option value="partially_paid">Partially Paid</option>
              <option value="not_started">Not Started</option>
              <option value="overdue">Overdue</option>
            </select>
          </div>
          {canViewAnalytics && <div>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="this_month">This Month</option>
              <option value="this_week">This Week</option>
              <option value="today">Today</option>
            </select>
          </div>}
        </div>
      </div>

      {/* Payments Table */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-1">Case Payment Accounts</h3>
        <p className="text-sm text-gray-500 mb-4">Each account is linked to its immigration case, invoice, package, and current balance.</p>
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-600">Loading payments...</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Case</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Client</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Package</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Paid</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Remaining</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Activity Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredPayments.length > 0 ? (
                  filteredPayments.map((payment) => {
                    const caseData = caseFor(payment)
                    const currency = payment.currency || 'USD'
                    return (
                    <tr key={payment._id} className="border-b hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <p className="font-semibold text-gray-900">{caseData?.caseNumber || caseData?.caseId || 'Unlinked case'}</p>
                        <p className="text-xs text-gray-500">{displayText(caseData?.status || caseData?.stage)}</p>
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-medium text-gray-900">{caseData?.clientName || payment.user?.name || payment.user?.displayName || 'Client unavailable'}</p>
                        <p className="text-xs text-gray-500">{caseData?.clientEmail || payment.user?.email || ''}</p>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap font-medium">{payment.invoiceNumber || payment.invoices?.[0]?.invoiceNumber || 'Pending invoice'}</td>
                      <td className="px-6 py-4 max-w-[180px]">{displayText(packageFor(payment))}</td>
                      <td className="px-6 py-4 whitespace-nowrap">{formatCurrency(payment.totalAmount || payment.totalFee, currency)}</td>
                      <td className="px-6 py-4 whitespace-nowrap font-semibold text-green-600">{formatCurrency(payment.amountPaid ?? payment.paidAmount, currency)}</td>
                      <td className="px-6 py-4 whitespace-nowrap font-semibold text-amber-600">{formatCurrency(payment.remainingAmount, currency)}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(payment.paymentStatus)}`}>
                          {displayText(payment.paymentStatus)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">{activityDate(payment)}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setSelectedPayment(payment)}
                          className="inline-flex items-center gap-1.5 font-medium text-blue-700 hover:text-blue-900"
                        >
                          <Eye className="h-4 w-4" /> View Details
                        </button>
                      </td>
                    </tr>
                  )})
                ) : (
                  <tr>
                    <td colSpan={10} className="px-6 py-12 text-center text-gray-500">
                      No payments found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Case Payment Details</h2>
                <p className="text-sm text-gray-500">{selectedPayment.invoiceNumber || 'Invoice pending'}</p>
              </div>
              <button type="button" onClick={() => setSelectedPayment(null)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="Close payment details">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-6 p-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  ['Case Number', selectedCase?.caseNumber || selectedCase?.caseId || 'Unlinked'],
                  ['Client Name', selectedCase?.clientName || selectedPayment.user?.name || selectedPayment.user?.displayName || 'Not available'],
                  ['Case Status', displayText(selectedCase?.status || selectedCase?.stage)],
                  ['Invoice Number', selectedPayment.invoiceNumber || selectedPayment.invoices?.[0]?.invoiceNumber || 'Pending'],
                  ['Package', displayText(packageFor(selectedPayment))],
                  ['Visa Type', resolveDisplayVisa(selectedCase) || 'Not available'],
                  ['Payment Status', displayText(selectedPayment.paymentStatus)],
                  ['Payment Date', paymentDate(selectedPayment)],
                  ['Next Due Date', formatDate(selectedPayment.nextPaymentDueDate)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
                    <p className="mt-1 font-semibold text-gray-900">{value}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-xl bg-slate-100 p-4">
                  <p className="text-sm text-slate-600">Total Invoice</p>
                  <p className="mt-1 text-xl font-bold text-slate-900">{formatCurrency(selectedPayment.totalAmount || selectedPayment.totalFee, selectedPayment.currency)}</p>
                </div>
                <div className="rounded-xl bg-blue-50 p-4">
                  <p className="text-sm text-blue-700">Amount Paid</p>
                  <p className="mt-1 text-xl font-bold text-blue-800">{formatCurrency(selectedPayment.amountPaid ?? selectedPayment.paidAmount, selectedPayment.currency)}</p>
                </div>
                <div className="rounded-xl bg-amber-50 p-4">
                  <p className="text-sm text-amber-700">Remaining Balance</p>
                  <p className="mt-1 text-xl font-bold text-amber-800">{formatCurrency(selectedPayment.remainingAmount, selectedPayment.currency)}</p>
                </div>
              </div>

              {selectedPayment.invoices?.length > 0 && (
                <div>
                  <h3 className="mb-3 font-semibold text-gray-900">Invoices</h3>
                  <div className="space-y-2">
                    {selectedPayment.invoices.map((invoice) => (
                      <div key={invoice._id || invoice.invoiceNumber} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 p-3 text-sm">
                        <div>
                          <p className="font-semibold text-gray-900">{invoice.invoiceNumber}</p>
                          <p className="text-gray-500">Issued {formatDate(invoice.issuedAt)} · Due {formatDate(invoice.dueDate)}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">{formatCurrency(invoice.total, invoice.currency || selectedPayment.currency)}</p>
                          <p className="text-gray-500">{displayText(invoice.status)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap justify-end gap-3 border-t border-gray-200 pt-4">
                <button type="button" onClick={() => setSelectedPayment(null)} className="btn-secondary">Close</button>
                {selectedCase?._id && (
                  <button
                    type="button"
                    onClick={() => navigate(`/crm-cases/${selectedCase._id}?tab=payments`)}
                    className="btn-primary inline-flex items-center gap-2"
                  >
                    <ExternalLink className="h-4 w-4" /> Open Case Payments
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default PaymentsOverview
