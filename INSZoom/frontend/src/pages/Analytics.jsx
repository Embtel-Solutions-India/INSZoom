import { useState, useEffect, useRef } from 'react'
import api from '../services/api'
import {
  BarChart3,
  DollarSign,
  Briefcase,
  TrendingUp,
  AlertTriangle,
  Calendar,
  Filter,
  Users,
  Clock,
  Brain,
  FileText
} from 'lucide-react'
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell,
  AreaChart,
  Area,
  LineChart,
  Line
} from 'recharts'

const COLORS = ['#10b981', '#0ea5e9', '#f59e0b', '#ef4444', '#8b5cf6', '#6366f1', '#ec4899', '#14b8a6']
const formatCents = (amount) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
}).format((Number(amount) || 0) / 100)

const Analytics = () => {
  const [activeTab, setActiveTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  
  // Date range state
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // Data states
  const [analyticsData, setAnalyticsData] = useState(null)
  const [dashboardStats, setDashboardStats] = useState(null)
  const [revenueData, setRevenueData] = useState([])
  const [paymentsData, setPaymentsData] = useState(null)
  const [processingTimeData, setProcessingTimeData] = useState([])
  const [rfeTrendsData, setRfeTrendsData] = useState([])

  // Only the very first load shows the full skeleton — changing the date
  // range afterwards updates the charts in place instead of blanking them.
  const hasLoadedOnce = useRef(false)
  useEffect(() => {
    fetchAllData()
  }, [startDate, endDate])

  const fetchAllData = async () => {
    try {
      if (!hasLoadedOnce.current) setLoading(true)
      const params = {}
      if (startDate) params.startDate = startDate
      if (endDate) params.endDate = endDate

      const [analyticsRes, dashboardRes, revenueRes, paymentsRes, processingRes, rfeRes] = await Promise.all([
        api.get('/analytics', { params }),
        api.get('/analytics/dashboard'),
        api.get('/analytics/revenue'),
        api.get('/analytics/payments'),
        api.get('/analytics/processing-time'),
        api.get('/analytics/rfe-trends')
      ])

      setAnalyticsData(analyticsRes.data.analytics)
      setDashboardStats(dashboardRes.data)
      setRevenueData((revenueRes.data.monthlyRevenue || []).map(item => ({
        ...item,
        amount: Number(item.value || item.amount || 0) / 100
      })))
      setPaymentsData(paymentsRes.data)
      setProcessingTimeData(processingRes.data.processingTimes || [])
      setRfeTrendsData(rfeRes.data.rfeTrends || [])
      setError('')
    } catch (error) {
      setError('Failed to load analytics data')
      console.error('Analytics error:', error)
    } finally {
      hasLoadedOnce.current = true
      setLoading(false)
    }
  }

  const renderLoadingSkeleton = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="h-32 bg-gray-200 rounded-lg animate-pulse" />
      ))}
    </div>
  )

  const renderEmptyState = (message) => (
    <div className="card text-center py-12 text-gray-500">
      <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-gray-300" />
      <p>{message}</p>
    </div>
  )

  // TAB 1: Overview
  const OverviewTab = () => {
    const casesByVisaTypeData = analyticsData?.casesByVisaType?.map(item => ({
      name: item._id,
      value: item.count
    })) || []

    const casesByStageData = analyticsData?.casesByStage?.map(item => ({
      name: item._id,
      value: item.count
    })) || []

    const casesByPackageData = analyticsData?.casesByPackage?.map(item => ({
      name: item._id,
      value: item.count
    })) || []

    const rfeRate = rfeTrendsData.length > 0 
      ? (rfeTrendsData.reduce((sum, item) => sum + item.rfeCount, 0) / rfeTrendsData.reduce((sum, item) => sum + item.totalCases, 0) * 100).toFixed(1)
      : 0

    const statCards = [
      { title: 'Total Cases', value: dashboardStats?.totalCases || 0, icon: Briefcase, color: 'from-blue-500 to-blue-600' },
      { title: 'Active Cases', value: dashboardStats?.activeCases || 0, icon: FileText, color: 'from-blue-500 to-cyan-600' },
      { title: 'Total Revenue', value: formatCents(dashboardStats?.totalRevenue), icon: DollarSign, color: 'from-purple-500 to-pink-600' },
      { title: 'RFE Rate', value: rfeRate + '%', icon: AlertTriangle, color: 'from-amber-500 to-orange-600' }
    ]

    return (
      <div className="space-y-6">
        {/* Date Range Filter */}
        <div className="card">
          <div className="flex items-center gap-4">
            <Filter className="w-5 h-5 text-gray-500" />
            <div className="flex gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="input-field"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {statCards.map((card, index) => {
            const Icon = card.icon
            return (
              <div key={index} className="card">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600 mb-1">{card.title}</p>
                    <p className="text-3xl font-bold text-gray-900">{card.value}</p>
                  </div>
                  <div className={`p-3 rounded-lg bg-gradient-to-br ${card.color}`}>
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Cases by Visa Type</h3>
            {casesByVisaTypeData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={casesByVisaTypeData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
            ) : renderEmptyState('No data available')}
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Cases by Stage</h3>
            {casesByStageData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={casesByStageData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {casesByStageData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : renderEmptyState('No data available')}
          </div>

          <div className="card lg:col-span-2">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Cases by Package</h3>
            {casesByPackageData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={casesByPackageData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="#8b5cf6" />
                </BarChart>
              </ResponsiveContainer>
            ) : renderEmptyState('No data available')}
          </div>
        </div>
      </div>
    )
  }

  // TAB 2: Revenue
  const RevenueTab = () => {
    const revenueByVisaTypeData = analyticsData?.revenueByVisaType?.map(item => ({
      name: item._id,
      totalRevenue: Number(item.totalRevenue || 0) / 100,
      pendingRevenue: Number(item.pendingRevenue || 0) / 100
    })) || []

    const revenueByPackageData = analyticsData?.revenueByPackage?.map(item => ({
      name: item._id,
      totalRevenue: Number(item.totalRevenue || 0) / 100,
      pendingRevenue: Number(item.pendingRevenue || 0) / 100
    })) || []

    return (
      <div className="space-y-6">
        {/* Monthly Revenue Chart */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Monthly Revenue</h3>
          {revenueData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={revenueData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Area type="monotone" dataKey="amount" stroke="#10b981" fill="#10b981" fillOpacity={0.3} />
              </AreaChart>
            </ResponsiveContainer>
          ) : renderEmptyState('No revenue data available')}
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="card">
            <p className="text-sm font-medium text-gray-600 mb-1">Total Revenue</p>
            <p className="text-2xl font-bold text-gray-900">{formatCents(paymentsData?.totalRevenue)}</p>
          </div>
          <div className="card">
            <p className="text-sm font-medium text-gray-600 mb-1">Pending Amount</p>
            <p className="text-2xl font-bold text-amber-600">{formatCents(paymentsData?.pendingAmount)}</p>
          </div>
          <div className="card">
            <p className="text-sm font-medium text-gray-600 mb-1">Overdue Amount</p>
            <p className="text-2xl font-bold text-red-600">{formatCents(paymentsData?.overdueAmount)}</p>
          </div>
          <div className="card">
            <p className="text-sm font-medium text-gray-600 mb-1">Payment Rate</p>
            <p className="text-2xl font-bold text-blue-600">{paymentsData?.paymentRate || 0}%</p>
          </div>
        </div>

        {/* Revenue Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Revenue by Visa Type</h3>
            {revenueByVisaTypeData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={revenueByVisaTypeData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="totalRevenue" fill="#0ea5e9" />
                </BarChart>
              </ResponsiveContainer>
            ) : renderEmptyState('No data available')}
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Revenue by Package</h3>
            {revenueByPackageData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={revenueByPackageData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="totalRevenue" fill="#8b5cf6" />
                </BarChart>
              </ResponsiveContainer>
            ) : renderEmptyState('No data available')}
          </div>
        </div>
      </div>
    )
  }

  // TAB 3: Team Performance
  const TeamPerformanceTab = () => {
    const caseManagerWorkload = analyticsData?.caseManagerWorkload || []

    return (
      <div className="space-y-6">
        {/* Case Manager Workload */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Case Manager Workload</h3>
          {caseManagerWorkload.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Name</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Active Cases</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Closed Cases</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {caseManagerWorkload.map((cm, index) => (
                    <tr key={index} className="border-b border-gray-100">
                      <td className="py-3 px-4">{cm.name}</td>
                      <td className="py-3 px-4">{cm.caseCount}</td>
                      <td className="py-3 px-4">{cm.completedCases || 0}</td>
                      <td className="py-3 px-4">{cm.score || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : renderEmptyState('No workload data available')}
        </div>

        {/* Processing Time */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Processing Time by Visa Type</h3>
          {processingTimeData.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Visa Type</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Avg Days</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Min</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Max</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {processingTimeData.map((pt, index) => (
                    <tr key={index} className="border-b border-gray-100">
                      <td className="py-3 px-4">{pt._id}</td>
                      <td className="py-3 px-4">{pt.avgProcessingDays?.toFixed(1) || 0}</td>
                      <td className="py-3 px-4">{pt.minProcessingDays || 0}</td>
                      <td className="py-3 px-4">{pt.maxProcessingDays || 0}</td>
                      <td className="py-3 px-4">{pt.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : renderEmptyState('No processing time data available')}
        </div>
      </div>
    )
  }

  // TAB 4: RFE & AI
  const RFEAITab = () => {
    const aiExtractionData = analyticsData?.aiExtractionSuccessRate?.map(item => ({
      name: item._id,
      value: item.count
    })) || []

    const evidenceAssemblyData = analyticsData?.evidenceAssemblyStats?.map(item => ({
      name: item._id,
      value: item.count,
      avgScore: item.avgReadinessScore
    })) || []

    return (
      <div className="space-y-6">
        {/* RFE Trends */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">RFE Trends</h3>
          {rfeTrendsData.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Visa Type</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">RFE Count</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">RFE Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {rfeTrendsData.map((rfe, index) => (
                    <tr key={index} className="border-b border-gray-100">
                      <td className="py-3 px-4">{rfe.visaType}</td>
                      <td className="py-3 px-4">{rfe.rfeCount}</td>
                      <td className="py-3 px-4">{rfe.rfeRate?.toFixed(1) || 0}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : renderEmptyState('No RFE trends data available')}
        </div>

        {/* AI Extraction Success */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">AI Extraction Success Rate</h3>
            {aiExtractionData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={aiExtractionData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {aiExtractionData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : renderEmptyState('No AI extraction data available')}
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Evidence Assembly Stats</h3>
            {evidenceAssemblyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={evidenceAssemblyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="#14b8a6" />
                </BarChart>
              </ResponsiveContainer>
            ) : renderEmptyState('No evidence assembly data available')}
          </div>
        </div>

        {/* Filing Readiness Distribution */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Filing Readiness Distribution</h3>
          {evidenceAssemblyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={evidenceAssemblyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="avgScore" fill="#ec4899" />
              </BarChart>
            </ResponsiveContainer>
          ) : renderEmptyState('No filing readiness data available')}
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="text-gray-600 mt-1">Comprehensive insights and performance metrics</p>
        </div>
        {renderLoadingSkeleton()}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
        <p className="text-gray-600 mt-1">Comprehensive insights and performance metrics</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-4 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeTab === 'overview'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          <BarChart3 className="w-4 h-4 inline mr-2" />
          Overview
        </button>
        <button
          onClick={() => setActiveTab('revenue')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeTab === 'revenue'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          <DollarSign className="w-4 h-4 inline mr-2" />
          Revenue
        </button>
        <button
          onClick={() => setActiveTab('team')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeTab === 'team'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          <Users className="w-4 h-4 inline mr-2" />
          Team Performance
        </button>
        <button
          onClick={() => setActiveTab('rfe-ai')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeTab === 'rfe-ai'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          <Brain className="w-4 h-4 inline mr-2" />
          RFE & AI
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && <OverviewTab />}
      {activeTab === 'revenue' && <RevenueTab />}
      {activeTab === 'team' && <TeamPerformanceTab />}
      {activeTab === 'rfe-ai' && <RFEAITab />}
    </div>
  )
}

export default Analytics
