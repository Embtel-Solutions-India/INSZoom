import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'
import { resolveDisplayVisa } from '../utils/visaDisplay'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import {
  ArrowLeft,
  User,
  Mail,
  Phone,
  Calendar,
  Building,
  Briefcase,
  DollarSign,
  CheckCircle,
  Clock,
  TrendingUp,
  Activity,
  FileText,
  CreditCard,
  Users as UsersIcon,
  BarChart3,
  Search,
  Filter,
  ChevronRight,
  Star,
  Award,
  Target,
  Zap,
  X,
  Download
} from 'lucide-react'

const formatPaymentAmount = (amount, currency = 'USD') => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: String(currency || 'USD').toUpperCase()
}).format((Number(amount) || 0) / 100)

const CHART_COLORS = ['#2563eb', '#f97316', '#16a34a', '#9333ea', '#dc2626', '#0891b2', '#eab308', '#db2777']

const formatLabel = (value = '') => String(value || 'Uncategorized')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (char) => char.toUpperCase())

const EmptyChart = ({ label = 'No analytics data available' }) => (
  <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500">
    {label}
  </div>
)

const ChartCard = ({ title, subtitle, children }) => (
  <div className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
    <div className="mb-4">
      <h4 className="font-semibold text-gray-900">{title}</h4>
      {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
    </div>
    {children}
  </div>
)

const AnalyticsTile = ({ label, value, sub, color, icon: Icon }) => (
  <div className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
        {sub && <p className="mt-1 text-xs text-gray-500">{sub}</p>}
      </div>
      <div className="rounded-lg p-2 text-white" style={{ backgroundColor: color }}>
        <Icon className="h-5 w-5" />
      </div>
    </div>
  </div>
)

const CaseManagerDetails = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  
  const [caseManager, setCaseManager] = useState(null)
  const [stats, setStats] = useState(null)
  const [cases, setCases] = useState([])
  const [activities, setActivities] = useState([])
  const [payments, setPayments] = useState([])
  const [paymentSummary, setPaymentSummary] = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  
  // Filters
  const [caseStatusFilter, setCaseStatusFilter] = useState('')
  const [caseSearch, setCaseSearch] = useState('')
  const [activityDateFilter, setActivityDateFilter] = useState('')
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('')
  
  // Pagination
  const [casesPage, setCasesPage] = useState(1)
  const [activitiesPage, setActivitiesPage] = useState(1)
  const [paymentsPage, setPaymentsPage] = useState(1)
  
  const [casesPagination, setCasesPagination] = useState(null)
  const [activitiesPagination, setActivitiesPagination] = useState(null)
  const [paymentsPagination, setPaymentsPagination] = useState(null)

  useEffect(() => {
    fetchCaseManagerDetails()
  }, [id])

  useEffect(() => {
    if (activeTab === 'cases') {
      fetchCases()
    } else if (activeTab === 'activities') {
      fetchActivities()
    } else if (activeTab === 'payments') {
      fetchPayments()
    } else if (activeTab === 'analytics') {
      fetchAnalytics()
    }
  }, [activeTab, caseStatusFilter, caseSearch, activityDateFilter, paymentStatusFilter, casesPage, activitiesPage, paymentsPage])

  const fetchCaseManagerDetails = async () => {
    try {
      setLoading(true)
      const response = await api.get(`/case-managers/${id}`)
      setCaseManager(response.data.data.caseManager)
      setStats(response.data.data.stats)
    } catch (error) {
      console.error('Error fetching case manager details:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchCases = async () => {
    try {
      const params = {
        status: caseStatusFilter,
        search: caseSearch,
        page: casesPage,
        limit: 10
      }
      const response = await api.get(`/case-managers/${id}/cases`, { params })
      setCases(response.data.data)
      setCasesPagination(response.data.pagination)
    } catch (error) {
      console.error('Error fetching cases:', error)
    }
  }

  const fetchActivities = async () => {
    try {
      const params = {
        dateRange: activityDateFilter,
        page: activitiesPage,
        limit: 20
      }
      const response = await api.get(`/case-managers/${id}/activities`, { params })
      setActivities(response.data.data)
      setActivitiesPagination(response.data.pagination)
    } catch (error) {
      console.error('Error fetching activities:', error)
    }
  }

  const fetchPayments = async () => {
    try {
      const params = {
        status: paymentStatusFilter,
        page: paymentsPage,
        limit: 10
      }
      const response = await api.get(`/case-managers/${id}/payments`, { params })
      setPayments(response.data.data)
      setPaymentSummary(response.data.summary)
      setPaymentsPagination(response.data.pagination)
    } catch (error) {
      console.error('Error fetching payments:', error)
    }
  }

  const fetchAnalytics = async () => {
    try {
      const response = await api.get(`/case-managers/${id}/analytics`)
      setAnalytics(response.data.data)
    } catch (error) {
      console.error('Error fetching analytics:', error)
    }
  }

  const getStageProgress = (stage) => {
    const stages = ['intake', 'strategy', 'evidence', 'expert_letters', 'review', 'filing', 'uscis_pending', 'approved', 'denied']
    const index = stages.indexOf(stage)
    return ((index + 1) / stages.length) * 100
  }

  const getStageLabel = (stage) => {
    const labels = {
      intake: 'Intake',
      strategy: 'Strategy',
      evidence: 'Evidence',
      expert_letters: 'Expert Letters',
      review: 'Review',
      filing: 'Filing',
      uscis_pending: 'USCIS Pending',
      approved: 'Approved',
      denied: 'Denied'
    }
    return labels[stage] || stage
  }

  const getPaymentStatusBadge = (status) => {
    const badges = {
      paid: 'bg-green-100 text-green-800',
      partially_paid: 'bg-yellow-100 text-yellow-800',
      not_started: 'bg-gray-100 text-gray-800',
      overdue: 'bg-red-100 text-red-800',
      refunded: 'bg-purple-100 text-purple-800'
    }
    const labels = {
      paid: 'Paid',
      partially_paid: 'Partially Paid',
      not_started: 'Pending',
      overdue: 'Overdue',
      refunded: 'Refunded'
    }
    return (
      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${badges[status] || badges.not_started}`}>
        {labels[status] || status}
      </span>
    )
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-32 bg-gray-200 rounded"></div>
            ))}
          </div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    )
  }

  if (!caseManager) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <User className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Case manager not found</h3>
          <button
            onClick={() => navigate('/case-managers')}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Back to Case Managers
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate('/case-managers')}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Case Manager Details</h1>
          <p className="text-gray-600 mt-1">{caseManager.name}</p>
        </div>
      </div>

      {/* Profile Header */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="flex-shrink-0">
            <div className="w-24 h-24 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white text-3xl font-bold">
              {caseManager.name?.charAt(0).toUpperCase()}
            </div>
          </div>
          <div className="flex-1">
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">{caseManager.name}</h2>
                <p className="text-gray-600">Employee ID: {caseManager._id?.slice(-6).toUpperCase()}</p>
                <div className="flex flex-wrap gap-4 mt-3">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Mail className="w-4 h-4" />
                    {caseManager.email}
                  </div>
                  {caseManager.phone && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Phone className="w-4 h-4" />
                      {caseManager.phone}
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Calendar className="w-4 h-4" />
                    Joined: {new Date(caseManager.createdAt).toLocaleDateString()}
                  </div>
                  {caseManager.department && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Building className="w-4 h-4" />
                      {caseManager.department}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <p className="text-sm text-gray-600">Status</p>
                  <span className={`px-3 py-1 text-sm font-semibold rounded-full ${caseManager.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                    {caseManager.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                {caseManager.lastLogin && (
                  <div className="text-center">
                    <p className="text-sm text-gray-600">Last Login</p>
                    <p className="text-sm font-semibold text-gray-900">{new Date(caseManager.lastLogin).toLocaleDateString()}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-4 border-l-4 border-blue-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Assigned</p>
                <p className="text-2xl font-bold text-gray-900">{stats.totalAssignedCases}</p>
              </div>
              <Briefcase className="w-8 h-8 text-blue-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 border-l-4 border-green-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Active Cases</p>
                <p className="text-2xl font-bold text-gray-900">{stats.activeCases}</p>
              </div>
              <Clock className="w-8 h-8 text-green-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 border-l-4 border-orange-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Completed</p>
                <p className="text-2xl font-bold text-gray-900">{stats.completedCases}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-orange-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 border-l-4 border-blue-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Revenue</p>
                <p className="text-2xl font-bold text-gray-900">${(stats.totalRevenue || 0).toLocaleString()}</p>
              </div>
              <DollarSign className="w-8 h-8 text-blue-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 border-l-4 border-purple-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Collected</p>
                <p className="text-2xl font-bold text-gray-900">${(stats.collectedRevenue || 0).toLocaleString()}</p>
              </div>
              <TrendingUp className="w-8 h-8 text-purple-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 border-l-4 border-yellow-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Collection Rate</p>
                <p className="text-2xl font-bold text-gray-900">{stats.collectionPercentage}%</p>
              </div>
              <Target className="w-8 h-8 text-yellow-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 border-l-4 border-indigo-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Avg Processing</p>
                <p className="text-2xl font-bold text-gray-900">{Math.round(stats.avgProcessingTime || 0)} days</p>
              </div>
              <Zap className="w-8 h-8 text-indigo-500" />
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 border-l-4 border-pink-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Pending</p>
                <p className="text-2xl font-bold text-gray-900">{stats.pendingCases}</p>
              </div>
              <Activity className="w-8 h-8 text-pink-500" />
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white rounded-lg shadow mb-6">
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px">
            {[
              { id: 'overview', label: 'Overview', icon: User },
              { id: 'cases', label: 'Assigned Cases', icon: Briefcase },
              { id: 'activities', label: 'Activity Log', icon: Activity },
              { id: 'payments', label: 'Payments', icon: CreditCard },
              { id: 'analytics', label: 'Analytics', icon: BarChart3 }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id)
                  setCasesPage(1)
                  setActivitiesPage(1)
                  setPaymentsPage(1)
                }}
                className={`flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Overview</h3>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-medium text-gray-900 mb-3">Recent Activity</h4>
                {activities.slice(0, 5).map((activity) => (
                  <div key={activity._id} className="flex items-start gap-3 py-2 border-b border-gray-200 last:border-0">
                    <Activity className="w-4 h-4 text-gray-400 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm text-gray-900">{activity.action}</p>
                      <p className="text-xs text-gray-500">{new Date(activity.createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-medium text-gray-900 mb-3">Recent Cases</h4>
                {cases.slice(0, 5).map((caseItem) => (
                  <div key={caseItem._id} className="flex items-start gap-3 py-2 border-b border-gray-200 last:border-0">
                    <Briefcase className="w-4 h-4 text-gray-400 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm text-gray-900">{caseItem.caseNumber}</p>
                      <p className="text-xs text-gray-500">{caseItem.clientName}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Cases Tab */}
        {activeTab === 'cases' && (
          <div className="p-6">
            <div className="flex flex-col lg:flex-row gap-4 mb-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search cases..."
                  value={caseSearch}
                  onChange={(e) => setCaseSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <select
                value={caseStatusFilter}
                onChange={(e) => setCaseStatusFilter(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">All Status</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="pending">Pending</option>
                <option value="on_hold">On Hold</option>
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Case Number</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Client</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Visa Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stage</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Progress</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Priority</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {cases.map((caseItem) => (
                    <tr key={caseItem._id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {caseItem.caseNumber}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {caseItem.clientName}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {resolveDisplayVisa(caseItem)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {getStageLabel(caseItem.stage)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-blue-600 h-2 rounded-full"
                            style={{ width: `${getStageProgress(caseItem.stage)}%` }}
                          ></div>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">{Math.round(getStageProgress(caseItem.stage))}%</p>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                          caseItem.priority === 'urgent' ? 'bg-red-100 text-red-800' :
                          caseItem.priority === 'high' ? 'bg-orange-100 text-orange-800' :
                          caseItem.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {caseItem.priority}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {casesPagination && (
              <div className="mt-4 flex items-center justify-between">
                <p className="text-sm text-gray-700">
                  Showing {(casesPage - 1) * casesPagination.limit + 1} to {Math.min(casesPage * casesPagination.limit, casesPagination.totalCount)} of {casesPagination.totalCount}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCasesPage(Math.max(1, casesPage - 1))}
                    disabled={casesPage === 1}
                    className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setCasesPage(Math.min(casesPagination.totalPages, casesPage + 1))}
                    disabled={casesPage === casesPagination.totalPages}
                    className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Activities Tab */}
        {activeTab === 'activities' && (
          <div className="p-6">
            <div className="flex gap-4 mb-4">
              <select
                value={activityDateFilter}
                onChange={(e) => setActivityDateFilter(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">All Time</option>
                <option value="today">Today</option>
                <option value="7days">Last 7 Days</option>
                <option value="30days">Last 30 Days</option>
              </select>
            </div>

            <div className="space-y-4">
              {activities.map((activity) => (
                <div key={activity._id} className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg">
                  <Activity className="w-5 h-5 text-gray-400 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">{activity.action}</p>
                    <p className="text-sm text-gray-600">{activity.description}</p>
                    {activity.caseId && (
                      <p className="text-xs text-gray-500 mt-1">Case: {activity.caseId.caseNumber}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">{new Date(activity.createdAt).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>

            {activitiesPagination && (
              <div className="mt-4 flex items-center justify-between">
                <p className="text-sm text-gray-700">
                  Showing {(activitiesPage - 1) * activitiesPagination.limit + 1} to {Math.min(activitiesPage * activitiesPagination.limit, activitiesPagination.totalCount)} of {activitiesPagination.totalCount}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setActivitiesPage(Math.max(1, activitiesPage - 1))}
                    disabled={activitiesPage === 1}
                    className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setActivitiesPage(Math.min(activitiesPagination.totalPages, activitiesPage + 1))}
                    disabled={activitiesPage === activitiesPagination.totalPages}
                    className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Payments Tab */}
        {activeTab === 'payments' && (
          <div className="p-6">
            {paymentSummary && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div className="bg-blue-50 rounded-lg p-4">
                  <p className="text-sm text-gray-600">Total Assigned</p>
                  <p className="text-xl font-bold text-gray-900">{formatPaymentAmount(paymentSummary.totalRevenueAssigned)}</p>
                </div>
                <div className="bg-green-50 rounded-lg p-4">
                  <p className="text-sm text-gray-600">Collected</p>
                  <p className="text-xl font-bold text-gray-900">{formatPaymentAmount(paymentSummary.totalRevenueCollected)}</p>
                </div>
                <div className="bg-orange-50 rounded-lg p-4">
                  <p className="text-sm text-gray-600">Outstanding</p>
                  <p className="text-xl font-bold text-gray-900">{formatPaymentAmount(paymentSummary.outstandingRevenue)}</p>
                </div>
                <div className="bg-purple-50 rounded-lg p-4">
                  <p className="text-sm text-gray-600">Collection Rate</p>
                  <p className="text-xl font-bold text-gray-900">{paymentSummary.collectionRate}%</p>
                </div>
              </div>
            )}

            <div className="flex gap-4 mb-4">
              <select
                value={paymentStatusFilter}
                onChange={(e) => setPaymentStatusFilter(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">All Status</option>
                <option value="paid">Paid</option>
                <option value="partially_paid">Partially Paid</option>
                <option value="not_started">Pending</option>
                <option value="overdue">Overdue</option>
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Case</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Package</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Paid</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Remaining</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {payments.map((payment) => (
                    <tr key={payment._id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {payment.invoiceNumber}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {payment.caseId?.caseNumber || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {payment.package}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatPaymentAmount(payment.totalFee, payment.currency)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatPaymentAmount(payment.paidAmount, payment.currency)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatPaymentAmount(payment.remainingAmount, payment.currency)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getPaymentStatusBadge(payment.paymentStatus)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {paymentsPagination && (
              <div className="mt-4 flex items-center justify-between">
                <p className="text-sm text-gray-700">
                  Showing {(paymentsPage - 1) * paymentsPagination.limit + 1} to {Math.min(paymentsPage * paymentsPagination.limit, paymentsPagination.totalCount)} of {paymentsPagination.totalCount}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPaymentsPage(Math.max(1, paymentsPage - 1))}
                    disabled={paymentsPage === 1}
                    className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setPaymentsPage(Math.min(paymentsPagination.totalPages, paymentsPage + 1))}
                    disabled={paymentsPage === paymentsPagination.totalPages}
                    className="px-3 py-1 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Analytics Tab */}
        {activeTab === 'analytics' && (
          <div className="space-y-6 p-6">
            {!analytics ? (
              <EmptyChart label="Loading case manager analytics..." />
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
                  <AnalyticsTile label="Active" value={analytics.summary?.active || 0} sub="open assigned cases" color="#2563eb" icon={Briefcase} />
                  <AnalyticsTile label="Attention" value={analytics.summary?.attention || 0} sub="overdue, blocked, urgent" color="#f97316" icon={Clock} />
                  <AnalyticsTile label="Closed" value={analytics.summary?.closed || 0} sub={`${analytics.closed?.completionRate || 0}% completion rate`} color="#16a34a" icon={CheckCircle} />
                  <AnalyticsTile label="Payments" value={formatPaymentAmount(analytics.summary?.payments || 0)} sub={`${analytics.payments?.collectionRate || 0}% collected`} color="#9333ea" icon={CreditCard} />
                  <AnalyticsTile label="Activity" value={analytics.summary?.activity || 0} sub="recent task events" color="#0891b2" icon={Activity} />
                  <AnalyticsTile label="Category" value={analytics.summary?.categories || 0} sub="case groupings" color="#db2777" icon={BarChart3} />
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <ChartCard title="Case Manager Trend" subtitle="Last 6 months">
                    {(analytics.trend || []).length ? (
                      <div className="h-56 sm:h-60">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={analytics.trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                            <YAxis yAxisId="left" tick={{ fontSize: 11 }} allowDecimals={false} />
                            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} hide />
                            <Tooltip formatter={(value, name) => [name === 'payments' ? `$${Number(value || 0).toLocaleString()}` : value, formatLabel(name)]} />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Line yAxisId="left" type="monotone" dataKey="active" stroke="#2563eb" strokeWidth={2} dot={{ r: 2 }} />
                            <Line yAxisId="left" type="monotone" dataKey="attention" stroke="#f97316" strokeWidth={2} dot={{ r: 2 }} />
                            <Line yAxisId="left" type="monotone" dataKey="closed" stroke="#16a34a" strokeWidth={2} dot={{ r: 2 }} />
                            <Line yAxisId="right" type="monotone" dataKey="payments" stroke="#9333ea" strokeWidth={2} dot={{ r: 2 }} />
                            <Line yAxisId="left" type="monotone" dataKey="activity" stroke="#0891b2" strokeWidth={2} dot={{ r: 2 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    ) : <EmptyChart />}
                  </ChartCard>

                  <ChartCard title="Active Cases" subtitle="Open workload by stage">
                    {(analytics.active?.byStage || []).length ? (
                      <div className="h-56 sm:h-60">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={analytics.active.byStage.map((item) => ({ ...item, stage: formatLabel(item.stage) }))} layout="vertical" margin={{ left: 0, right: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis type="number" allowDecimals={false} />
                            <YAxis dataKey="stage" type="category" width={96} tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Bar dataKey="count" radius={[0, 8, 8, 0]}>
                              {analytics.active.byStage.map((_, index) => <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : <EmptyChart label="No active case data" />}
                  </ChartCard>

                  <ChartCard title="Attention" subtitle="Items that need follow-up">
                    {(analytics.attention?.byReason || []).length ? (
                      <div className="h-56 sm:h-60">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={analytics.attention.byReason.map((item) => ({ ...item, reason: formatLabel(item.reason) }))}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis dataKey="reason" tick={{ fontSize: 11 }} />
                            <YAxis allowDecimals={false} />
                            <Tooltip />
                            <Bar dataKey="count" radius={[8, 8, 0, 0]} fill="#f97316" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : <EmptyChart label="No attention items" />}
                  </ChartCard>

                  <ChartCard title="Closed" subtitle="Closed cases compared with active workload">
                    <div className="h-56 sm:h-60">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={(analytics.trend || []).map((item) => ({ month: item.month, Closed: item.closed, Active: item.active }))}>
                          <defs>
                            <linearGradient id="closedTrend" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#16a34a" stopOpacity={0.45} />
                              <stop offset="95%" stopColor="#16a34a" stopOpacity={0.05} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="month" />
                          <YAxis allowDecimals={false} />
                          <Tooltip />
                          <Area type="monotone" dataKey="Closed" stroke="#16a34a" fill="url(#closedTrend)" strokeWidth={3} />
                          <Line type="monotone" dataKey="Active" stroke="#2563eb" strokeWidth={2} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </ChartCard>

                  <ChartCard title="Payments" subtitle="Collection status for assigned cases">
                    {(analytics.payments?.byStatus || []).length ? (
                      <div className="h-56 sm:h-60">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={analytics.payments.byStatus.map((item) => ({ ...item, status: formatLabel(item.status) }))} dataKey="count" nameKey="status" innerRadius={42} outerRadius={72} paddingAngle={4}>
                              {analytics.payments.byStatus.map((_, index) => <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                            </Pie>
                            <Tooltip />
                            <Legend />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    ) : <EmptyChart label="No payment data" />}
                  </ChartCard>

                  <ChartCard title="Activity Status" subtitle="Task activity status for this case manager">
                    {(analytics.activityStatus?.byStatus || []).length ? (
                      <div className="h-56 sm:h-60">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={analytics.activityStatus.byStatus.map((item) => ({ ...item, status: formatLabel(item.status) }))}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis dataKey="status" tick={{ fontSize: 12 }} />
                            <YAxis allowDecimals={false} />
                            <Tooltip />
                            <Bar dataKey="count" radius={[8, 8, 0, 0]} fill="#0891b2" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : <EmptyChart label="No activity status data" />}
                  </ChartCard>

                  <ChartCard title="Category" subtitle="Case mix by visa/category">
                    {(analytics.category?.byVisaType || []).length ? (
                      <div className="h-56 sm:h-60">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={analytics.category.byVisaType.map((item) => ({ ...item, category: formatLabel(item.category) }))} layout="vertical" margin={{ left: 0, right: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis type="number" allowDecimals={false} />
                            <YAxis dataKey="category" type="category" width={96} tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Bar dataKey="count" radius={[0, 8, 8, 0]} fill="#db2777" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    ) : <EmptyChart label="No category data" />}
                  </ChartCard>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default CaseManagerDetails
