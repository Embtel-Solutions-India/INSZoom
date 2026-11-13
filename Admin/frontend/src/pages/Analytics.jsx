import { useState, useEffect, useRef } from 'react'
import api from '../services/api'
import { useOptionalSocket } from '../contexts/SocketContext'
import RevenueTrendChart from '../components/RevenueTrendChart'
import { FINANCE_COLORS, CATEGORY_COLORS, TEAM_COLORS } from '../utils/financeColors'
import MonthlyRevenueBars from '../components/MonthlyRevenueBars'
import { CasesSubmittedChart, MonthlyFlowChart } from '../components/CaseTrendCharts'
import { packageRows, NOT_ASSIGNED } from '../utils/packages'
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
  Line,
  Legend
} from 'recharts'

const COLORS = ['#10b981', '#0ea5e9', '#f59e0b', '#ef4444', '#8b5cf6', '#6366f1', '#ec4899', '#14b8a6']
const formatUsd = (amount) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
}).format(Number(amount) || 0) // US dollars (the payment figures come from GoHighLevel in dollars, never cents)

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
  const [caseManagerWorkload, setCaseManagerWorkload] = useState([])
  const [caseTrends, setCaseTrends] = useState(null)

  // Only the very first load shows the full skeleton — changing the date
  // range afterwards updates the charts in place instead of blanking them.
  const hasLoadedOnce = useRef(false)
  useEffect(() => {
    fetchAllData()
  }, [startDate, endDate])

  // Live: everything on this page (including the payment figures and charts) is re-read from the database when any case's GoHighLevel figures change,
  // and every minute as a safety net.
  const socket = useOptionalSocket()
  useEffect(() => {
    const refresh = () => { if (!document.hidden) fetchAllData() }
    const unsubscribers = socket?.connected && socket?.subscribe
      ? ['payment:updated', 'ghl:pipeline:updated', 'case:created', 'case:assigned'].map((event) => socket.subscribe(event, refresh))
      : []
    const timer = window.setInterval(refresh, 60000)
    return () => { unsubscribers.forEach((unsubscribe) => unsubscribe && unsubscribe()); window.clearInterval(timer) }
  }, [socket?.connected, startDate, endDate])

  const fetchAllData = async () => {
    try {
      if (!hasLoadedOnce.current) setLoading(true)
      const params = {}
      if (startDate) params.startDate = startDate
      if (endDate) params.endDate = endDate

      const [analyticsRes, dashboardRes, revenueRes, paymentsRes, processingRes, rfeRes, caseManagersRes, caseTrendsRes] = await Promise.all([
        api.get('/analytics', { params }),
        api.get('/analytics/dashboard'),
        api.get('/analytics/revenue'),
        api.get('/analytics/payments'),
        api.get('/analytics/processing-time'),
        api.get('/analytics/rfe-trends'),
        // Case manager workload isn't part of /analytics at all — it's the
        // same real-time per-manager active/completed case counts the admin
        // Dashboard's "Team Workload" panel already uses (see Dashboard.jsx's
        // fetchTeamWorkload), reused here instead of re-deriving it.
        api.get('/case-managers'),
        // cases submitted per month + the active / on-hold trend; a failure here never blanks the rest of the page
        api.get('/analytics/case-trends').catch(() => null)
      ])

      setAnalyticsData(analyticsRes.data.analytics)
      setCaseTrends(caseTrendsRes?.data || null)
      setDashboardStats(dashboardRes.data)
      setRevenueData((revenueRes.data.monthlyRevenue || []).map(item => ({
        ...item,
        amount: Number(item.value || item.amount || 0)
      })))
      setPaymentsData(paymentsRes.data)
      setProcessingTimeData(processingRes.data.processingTimes || [])
      setRfeTrendsData(rfeRes.data.rfeTrends || [])
      const managers = caseManagersRes.data.data || caseManagersRes.data.caseManagers || []
      setCaseManagerWorkload(managers.map(cm => {
        const caseCount = cm.activeCasesCount || 0
        const completedCases = cm.completedCasesCount || 0
        const decided = caseCount + completedCases
        const onHold = cm.onHoldCasesCount || 0
        return {
          name: cm.displayName || cm.name || 'Unassigned',
          role: cm.role,
          caseCount,
          completedCases,
          onHold,
          total: cm.totalCasesCount ?? (caseCount + completedCases + onHold),
          openTasks: cm.openTasksCount || 0,
          overdueTasks: cm.overdueTasksCount || 0,
          score: decided > 0 ? Math.round((completedCases / decided) * 100) : 0,
        }
      }))
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
        <div key={i} className="h-32 bg-muted rounded-lg animate-pulse" />
      ))}
    </div>
  )

  const renderEmptyState = (message) => (
    <div className="card text-center py-12 text-muted-foreground">
      <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
      <p>{message}</p>
    </div>
  )

  // TAB 1: Overview
  const OverviewTab = () => {
    // analyticsData is GET /analytics's response — a domain-nested object
    // (analyticsData.cases.byVisaType, not a flat analyticsData.casesByVisaType),
    // and each row's name is `key` (see dashboard.service.js's groupCount/
    // mapGroups), with `_id` kept as a fallback for any raw-aggregate array
    // that never went through groupCount — same defensive read the admin
    // Dashboard page already uses for this exact data shape.
    const casesByStageData = analyticsData?.cases?.byStage?.map(item => ({
      name: item.key ?? item._id ?? 'Unspecified',
      value: item.count
    })) || []

    // exactly the three packages of the New case dropdown, plus "Not assigned" for cases with no package yet (every one listed, even at 0)
    const casesByPackageData = packageRows(
      (analyticsData?.cases?.byPackage || []).map(item => ({ name: item.key ?? item._id, value: item.count })),
      ['value']
    )

    const rfeRate = rfeTrendsData.length > 0 
      ? (rfeTrendsData.reduce((sum, item) => sum + item.rfeCount, 0) / rfeTrendsData.reduce((sum, item) => sum + item.totalCases, 0) * 100).toFixed(1)
      : 0

    const statCards = [
      { title: 'Total Cases', value: dashboardStats?.totalCases || 0, icon: Briefcase, color: 'from-blue-500 to-blue-600' },
      { title: 'Active Cases', value: dashboardStats?.activeCases || 0, icon: FileText, color: 'from-blue-500 to-cyan-600' },
      { title: 'Total Revenue', value: formatUsd(dashboardStats?.totalRevenue), icon: DollarSign, color: 'from-purple-500 to-pink-600' },
      { title: 'RFE Rate', value: rfeRate + '%', icon: AlertTriangle, color: 'from-amber-500 to-orange-600' }
    ]

    return (
      <div className="space-y-6">
        {/* Date Range Filter */}
        <div className="card">
          <div className="flex items-center gap-4">
            <Filter className="w-5 h-5 text-muted-foreground" />
            <div className="flex gap-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">End Date</label>
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
                    <p className="text-sm font-medium text-muted-foreground mb-1">{card.title}</p>
                    <p className="text-3xl font-bold text-foreground">{card.value}</p>
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
        <div className="grid grid-cols-1 gap-6">
          <CasesSubmittedChart months={caseTrends?.submittedByMonth} />

          <div className="card">
            <h3 className="text-lg font-semibold text-foreground mb-4">Cases by Stage</h3>
            {casesByStageData.length > 0 ? (
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                <div className="w-full sm:w-1/2">
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        isAnimationActive={false}
                        data={casesByStageData}
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        dataKey="value"
                        nameKey="name"
                        labelLine={false}
                      >
                        {casesByStageData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      {/* hovering a slice shows its stage name; no slice is ever made active or dimmed */}
                      <Tooltip formatter={(value, name) => [value, name]} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                {/* legend: colour box + stage name, top right of the card */}
                <ul className="w-full sm:w-1/2 max-h-64 space-y-1 overflow-y-auto pr-1 text-sm">
                  {(() => {
                    const total = casesByStageData.reduce((sum, item) => sum + (Number(item.value) || 0), 0) || 1
                    return casesByStageData.map((entry, index) => (
                      <li
                        key={`legend-${index}`}
                        className="flex items-center justify-between gap-3 rounded-md px-2 py-1"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                          <span className="text-foreground" title={entry.name}>{entry.name}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">{entry.value} &middot; {((entry.value / total) * 100).toFixed(0)}%</span>
                      </li>
                    ))
                  })()}
                </ul>
              </div>
            ) : renderEmptyState('No data available')}
          </div>

          <div className="lg:col-span-2">
            <MonthlyFlowChart months={caseTrends?.monthlyFlow} />
          </div>

          <div className="card lg:col-span-2">
            <h3 className="text-lg font-semibold text-foreground mb-4">Cases by Package</h3>
            {casesByPackageData.some((item) => item.value > 0) ? (
              <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-2">
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={casesByPackageData.filter((item) => item.value > 0)} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={62} outerRadius={100} paddingAngle={2} stroke="none">
                      {casesByPackageData.filter((item) => item.value > 0).map((entry) => (
                        <Cell key={entry.name} fill={entry.name === NOT_ASSIGNED ? FINANCE_COLORS.neutral : CATEGORY_COLORS[casesByPackageData.findIndex((item) => item.name === entry.name) % CATEGORY_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value, name) => [`${value} case${value === 1 ? '' : 's'}`, name]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
                <ul className="space-y-2.5">
                  {casesByPackageData.map((entry, index) => {
                    const total = casesByPackageData.reduce((sum, item) => sum + item.value, 0)
                    return (
                      <li key={entry.name} className="flex items-center justify-between gap-3 text-sm">
                        <span className="flex min-w-0 items-center gap-2 text-foreground">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: entry.name === NOT_ASSIGNED ? FINANCE_COLORS.neutral : CATEGORY_COLORS[index % CATEGORY_COLORS.length] }} aria-hidden="true" />
                          <span className="truncate">{entry.name}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground"><span className="font-semibold text-foreground">{entry.value}</span>{total ? ` · ${Math.round((entry.value / total) * 100)}%` : ''}</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : renderEmptyState('No data available')}
          </div>
        </div>
      </div>
    )
  }

  // TAB 2: Revenue
  const RevenueTab = () => {
    // analyticsData.revenue.byVisaType/byPackage (dashboard.service.js's
    // revenueAnalytics) use `revenue`/`outstanding` field names, not
    // `totalRevenue`/`pendingRevenue` — mapped here rather than renamed on
    // the backend since /analytics/revenue's existing byPackage shape is
    // also read as-is elsewhere (PaymentsOverview.jsx).
    const revenueByVisaTypeData = analyticsData?.revenue?.byVisaType?.map(item => ({
      name: item._id ?? 'Unspecified',
      totalRevenue: Number(item.revenue || 0),
      pendingRevenue: Number(item.outstanding || 0)
    })) || []

    // the three packages of the New case dropdown plus "Not assigned", all listed
    const revenueByPackageData = packageRows(
      (analyticsData?.revenue?.byPackage || []).map(item => ({ name: item._id, totalRevenue: Number(item.revenue || 0), pendingRevenue: Number(item.outstanding || 0) })),
      ['totalRevenue', 'pendingRevenue']
    )

    return (
      <div className="space-y-6">
        {/* Monthly revenue: fees set next to what was paid, per month, as bars */}
        <MonthlyRevenueBars />

        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            ['Total Revenue', formatUsd(paymentsData?.totalRevenue), FINANCE_COLORS.paid],
            ['Pending Amount', formatUsd(paymentsData?.pendingAmount), FINANCE_COLORS.outstanding],
            ['Total Fees', formatUsd(paymentsData?.total), FINANCE_COLORS.total],
            ['Payment Rate', `${paymentsData?.paymentRate || 0}%`, FINANCE_COLORS.partial],
          ].map(([label, value, dot]) => (
            <div key={label} className="card">
              <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: dot }} aria-hidden="true" />{label}</p>
              <p className="text-2xl font-semibold tabular-nums text-foreground">{value}</p>
            </div>
          ))}
        </div>

        <RevenueTrendChart />

        {/* Revenue Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="text-lg font-semibold text-foreground mb-4">Revenue by Visa Type</h3>
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
            <h3 className="text-lg font-semibold text-foreground mb-4">Revenue by Package</h3>
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
    const shortName = (name) => (String(name || '').length > 14 ? `${String(name).slice(0, 13)}…` : String(name || ''))
    const team = caseManagerWorkload.map((cm) => ({ ...cm, shortName: shortName(cm.name) }))
    // team totals count case managers only (a case is counted once, for the person it is assigned to); team leads are still shown in the rankings
    const managersOnly = team.filter((cm) => cm.role !== 'team_lead')
    const sum = (rows, key) => rows.reduce((total, cm) => total + (Number(cm[key]) || 0), 0)
    const totals = { total: sum(managersOnly, 'total'), active: sum(managersOnly, 'caseCount'), onHold: sum(managersOnly, 'onHold'), closed: sum(managersOnly, 'completedCases'), openTasks: sum(managersOnly, 'openTasks'), overdueTasks: sum(managersOnly, 'overdueTasks') }
    const statusSplit = [
      { name: 'Active', value: totals.active, color: TEAM_COLORS.active },
      { name: 'On hold', value: totals.onHold, color: TEAM_COLORS.onHold },
      { name: 'Closed', value: totals.closed, color: TEAM_COLORS.closed },
    ]
    const statusTotal = statusSplit.reduce((acc, item) => acc + item.value, 0)
    const topAssigned = [...team].sort((x, y) => y.total - x.total).slice(0, 10)
    const topClosed = [...team].sort((x, y) => (y.completedCases || 0) - (x.completedCases || 0)).slice(0, 8)
    const byRate = [...team].filter((cm) => cm.total > 0).sort((x, y) => y.score - x.score).slice(0, 10)
    return (
      <div className="space-y-6">
        {team.length > 0 && (
          <>
            {/* Team totals (case managers; a case is counted once for the person it is assigned to) */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              {[
                ['Assigned cases', totals.total, 'all cases on a case manager', TEAM_COLORS.assigned],
                ['Active cases', totals.active, 'being worked on', TEAM_COLORS.active],
                ['On hold', totals.onHold, 'in the On Hold stage', TEAM_COLORS.onHold],
                ['Cases closed', totals.closed, 'submitted, approved or disapproved', TEAM_COLORS.closed],
                ['Open tasks', totals.openTasks, `${totals.overdueTasks} overdue`, TEAM_COLORS.tasks],
              ].map(([label, value, sub, dot]) => (
                <div key={label} className="card">
                  <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: dot }} aria-hidden="true" />{label}</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="card lg:col-span-2">
                <h3 className="text-lg font-semibold text-foreground">Highest assigned cases</h3>
                <p className="mb-3 text-xs text-muted-foreground">Who has the most cases assigned, split into active, on hold and closed</p>
                <ResponsiveContainer width="100%" height={Math.max(240, topAssigned.length * 34 + 30)}>
                  <BarChart data={topAssigned} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                    <YAxis dataKey="shortName" type="category" width={110} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} cursor={{ fill: 'rgba(148,163,184,0.12)' }} labelFormatter={(label, items) => items?.[0]?.payload?.name || label} />
                    <Legend wrapperStyle={{ fontSize: 12 }} formatter={(value) => <span className="text-muted-foreground">{value}</span>} />
                    <Bar dataKey="caseCount" name="Active" stackId="cases" fill={TEAM_COLORS.active} barSize={16} />
                    <Bar dataKey="onHold" name="On hold" stackId="cases" fill={TEAM_COLORS.onHold} barSize={16} />
                    <Bar dataKey="completedCases" name="Closed" stackId="cases" fill={TEAM_COLORS.closed} radius={[0, 4, 4, 0]} barSize={16} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="card">
                <h3 className="text-lg font-semibold text-foreground">Case status</h3>
                <p className="mb-2 text-xs text-muted-foreground">All assigned cases</p>
                <ResponsiveContainer width="100%" height={190}>
                  <PieChart>
                    <Pie data={statusSplit} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={52} outerRadius={78} paddingAngle={2} stroke="none">
                      {statusSplit.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
                <ul className="mt-2 space-y-1.5">
                  {statusSplit.map((entry) => (
                    <li key={entry.name} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-foreground"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} aria-hidden="true" />{entry.name}</span>
                      <span className="tabular-nums text-muted-foreground"><span className="font-semibold text-foreground">{entry.value}</span>{statusTotal ? ` · ${Math.round((entry.value / statusTotal) * 100)}%` : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="card">
                <h3 className="text-lg font-semibold text-foreground">Cases closed</h3>
                <p className="mb-3 text-xs text-muted-foreground">Submitted, approved or disapproved, by person</p>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={topClosed} margin={{ left: 0, right: 8, top: 6, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="shortName" tick={{ fontSize: 11 }} interval={0} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} cursor={{ fill: 'rgba(148,163,184,0.12)' }} labelFormatter={(label, items) => items?.[0]?.payload?.name || label} />
                    <Bar dataKey="completedCases" name="Closed" radius={[4, 4, 0, 0]}>
                      {topClosed.map((entry, index) => <Cell key={entry.name} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="card">
                <h3 className="text-lg font-semibold text-foreground">Completion rate</h3>
                <p className="mb-3 text-xs text-muted-foreground">Closed cases as a share of closed + active (%), by person</p>
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={byRate} margin={{ left: 0, right: 12, top: 6, bottom: 0 }}>
                    <defs>
                      <linearGradient id="rateFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={TEAM_COLORS.assigned} stopOpacity={0.22} />
                        <stop offset="100%" stopColor={TEAM_COLORS.assigned} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="shortName" tick={{ fontSize: 11 }} interval={0} />
                    <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 11 }} width={40} />
                    <Tooltip formatter={(value) => `${value}%`} contentStyle={{ fontSize: 12, borderRadius: 8 }} labelFormatter={(label, items) => items?.[0]?.payload?.name || label} />
                    <Area type="monotone" dataKey="score" name="Completion rate" stroke={TEAM_COLORS.assigned} strokeWidth={2.5} fill="url(#rateFill)" dot={{ r: 3, strokeWidth: 0, fill: TEAM_COLORS.assigned }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}

        {/* Case Manager Workload */}
        <div className="card">
          <h3 className="text-lg font-semibold text-foreground mb-4">Case Manager Workload</h3>
          {caseManagerWorkload.length > 0 ? (
            <div className="overflow-x-hidden overflow-y-auto rounded-lg border border-border" style={{ maxHeight: 440 }}>
              <table className="w-full table-fixed text-sm">
                <thead className="sticky top-0 z-10 bg-muted">
                  <tr>
                    {['Name', 'Assigned', 'Active', 'On hold', 'Closed', 'Open tasks', 'Completion'].map((heading) => (
                      <th key={heading} className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...caseManagerWorkload].sort((x, y) => y.total - x.total).map((cm, index) => (
                    <tr key={index} className="border-t border-border">
                      <td className="px-3 py-2"><p className="truncate font-medium text-foreground" title={cm.name}>{cm.name}</p>{cm.role === 'team_lead' ? <p className="text-[11px] text-muted-foreground">Team Lead</p> : null}</td>
                      <td className="px-3 py-2 tabular-nums">{cm.total}</td>
                      <td className="px-3 py-2 tabular-nums">{cm.caseCount}</td>
                      <td className="px-3 py-2 tabular-nums">{cm.onHold}</td>
                      <td className="px-3 py-2 tabular-nums">{cm.completedCases || 0}</td>
                      <td className="px-3 py-2 tabular-nums">{cm.openTasks}</td>
                      <td className="px-3 py-2 tabular-nums">{cm.score || 0}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : renderEmptyState('No workload data available')}
        </div>

        {/* Processing Time */}
        <div className="card">
          <h3 className="text-lg font-semibold text-foreground mb-4">Processing Time by Visa Type</h3>
          {processingTimeData.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Visa Type</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Avg Days</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Min</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Max</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {processingTimeData.map((pt, index) => (
                    <tr key={index} className="border-b border-border">
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

  // TAB 4: RFE & AE
  const RFEAITab = () => {
    // analyticsData.evidence (dashboard.service.js's evidenceAnalytics):
    // aiExtraction groups DocumentExtraction by processingStatus (via
    // groupCount, so `key` not `_id`); evidenceAssembly is a raw Case
    // aggregate grouped by stage, so it genuinely is `_id`.
    const aiExtractionData = analyticsData?.evidence?.aiExtraction?.map(item => ({
      name: item.key ?? item._id ?? 'unknown',
      value: item.count
    })) || []

    const evidenceAssemblyData = analyticsData?.evidence?.evidenceAssembly?.map(item => ({
      name: item._id ?? 'Unspecified',
      value: item.count,
      avgScore: Math.round((item.avgReadinessScore || 0) * 10) / 10
    })) || []

    return (
      <div className="space-y-6">
        {/* RFE Trends */}
        <div className="card">
          <h3 className="text-lg font-semibold text-foreground mb-4">RFE Trends</h3>
          {rfeTrendsData.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Visa Type</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">RFE Count</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">RFE Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {rfeTrendsData.map((rfe, index) => (
                    <tr key={index} className="border-b border-border">
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
            <h3 className="text-lg font-semibold text-foreground mb-4">AI Extraction Success Rate</h3>
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
            <h3 className="text-lg font-semibold text-foreground mb-4">Evidence Assembly Stats</h3>
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
          <h3 className="text-lg font-semibold text-foreground mb-4">Filing Readiness Distribution</h3>
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
          <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
          <p className="text-muted-foreground mt-1">Comprehensive insights and performance metrics</p>
        </div>
        {renderLoadingSkeleton()}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
        <p className="text-muted-foreground mt-1">Comprehensive insights and performance metrics</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-4 border-b border-border overflow-x-auto whitespace-nowrap [&>button]:shrink-0">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeTab === 'overview'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-muted-foreground hover:text-foreground'
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
              : 'border-transparent text-muted-foreground hover:text-foreground'
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
              : 'border-transparent text-muted-foreground hover:text-foreground'
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
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Brain className="w-4 h-4 inline mr-2" />
          RFE & AE
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
