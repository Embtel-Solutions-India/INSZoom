import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'
import { resolveDisplayVisa } from '../utils/visaDisplay'
import { useAuth } from '../contexts/AuthContext'
import { useSocket } from '../contexts/SocketContext'
import {
  Briefcase,
  Users,
  DollarSign,
  FileText,
  AlertTriangle,
  TrendingUp,
  Clock,
  CheckCircle,
  Brain,
  Calendar,
  User,
  Target,
  Award,
  RefreshCw,
  Settings,
  MessageSquare,
  Bell
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import CaseManagerAnalyticsPanel from '../components/CaseManagerAnalyticsPanel'

const COLORS = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#64748b', '#0ea5e9']

const STAGE_COLORS = {
  draft: '#94a3b8',
  intake: '#2563eb',
  waiting_for_client: '#f59e0b',
  documents_pending: '#f59e0b',
  questionnaire_complete: '#0ea5e9',
  strategy: '#2563eb',
  evidence: '#0ea5e9',
  letters: '#0ea5e9',
  legal_review: '#f59e0b',
  form_preparation: '#2563eb',
  petition_preparation: '#2563eb',
  ready_for_filing: '#4ade80',
  filing: '#2563eb',
  filed: '#0ea5e9',
  processing: '#64748b',
  rfe: '#ef4444',
  uscis_pending: '#f59e0b',
  approved: '#10b981',
  denied: '#ef4444',
  closed: '#64748b',
  archived: '#94a3b8',
  on_hold: '#f59e0b'
}

const REASON_COLORS = {
  red: { bg: '#fee2e2', text: '#b91c1c', dot: '#ef4444' },
  orange: { bg: '#fef3c7', text: '#b45309', dot: '#f59e0b' },
  green: { bg: '#dcfce7', text: '#15803d', dot: '#10b981' },
  blue: { bg: '#dbeafe', text: '#1d4ed8', dot: '#2563eb' },
  grey: { bg: '#f1f5f9', text: '#475569', dot: '#64748b' }
}

const AVATAR_PALETTE = [
  { bg: '#dbeafe', text: '#1d4ed8' },
  { bg: '#dcfce7', text: '#15803d' },
  { bg: '#fef3c7', text: '#b45309' },
  { bg: '#fee2e2', text: '#b91c1c' },
  { bg: '#f1f5f9', text: '#475569' },
  { bg: '#e0f2fe', text: '#0369a1' },
  { bg: '#ecfccb', text: '#4d7c0f' },
  { bg: '#ffedd5', text: '#c2410c' }
]
const avatarColor = (seed) => {
  const str = String(seed || '?')
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]
}

const stageKey = (name) => String(name || '').toLowerCase().trim().replace(/[\s-]+/g, '_')
const stageColor = (name) => STAGE_COLORS[stageKey(name)] || '#2563eb'
const stageLabel = (name) => String(name || 'Unknown').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

const formatCents = (amount) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
}).format((Number(amount) || 0) / 100)

const timeAgo = (date) => {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago'
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago'
  if (seconds < 604800) return Math.floor(seconds / 86400) + 'd ago'
  return new Date(date).toLocaleDateString()
}

const EmptyChartState = ({ label = 'No chart data available' }) => (
  <div className="flex h-[240px] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500">
    {label}
  </div>
)

const DASHBOARD_CACHE_TTL_MS = 15000
const dashboardRequestCache = new Map()

const cachedDashboardGet = async (key, path, { force = false } = {}) => {
  const now = Date.now()
  const cached = dashboardRequestCache.get(key)

  if (!force && cached?.data && cached.expiresAt > now) {
    return cached.data
  }

  if (!force && cached?.promise) {
    return cached.promise
  }

  const promise = api.get(path)
    .then((response) => {
      dashboardRequestCache.set(key, {
        data: response.data,
        expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS
      })
      return response.data
    })
    .catch((error) => {
      dashboardRequestCache.delete(key)
      throw error
    })

  dashboardRequestCache.set(key, { ...cached, promise })
  return promise
}

// Defined once, outside Dashboard, so React keeps the same component type
// across re-renders. If these lived inside Dashboard's render body, every
// state update (there are several independent fetches) would redefine them,
// forcing React to unmount/remount the whole subtree - including the
// recharts charts, which replays their mount-in animation each time.
const AdminPanel = ({
  navigate, statCards, casesByStageData, maxStageValue, casesByVisaTypeData,
  paymentStatusData, needsAttention, recentActivity, connected, teamWorkload, stats
}) => (
  <div className="space-y-5">
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {statCards.map((card, index) => (
        <div key={index} className="card !p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="stage-dot" style={{ backgroundColor: card.dot }} />
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide truncate">{card.title}</p>
          </div>
          <p className="text-2xl font-bold text-gray-900 leading-tight">{card.value}</p>
          <p className="text-xs text-gray-500 mt-1 truncate">{card.sub}</p>
        </div>
      ))}
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Pipeline by stage */}
      <div className="card lg:col-span-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-900">Pipeline by stage</h3>
          <span className="text-xs text-gray-400">click a stage to filter</span>
        </div>
        {casesByStageData.length > 0 ? (
          <div className="space-y-3">
            {casesByStageData.map((stage, index) => (
              <button
                key={index}
                onClick={() => navigate('/crm-cases')}
                className="w-full flex items-center gap-3 group"
              >
                <span className="flex items-center gap-1.5 w-28 shrink-0 text-left">
                  <span className="stage-dot" style={{ backgroundColor: stageColor(stage.name) }} />
                  <span className="text-xs text-gray-600 truncate">{stageLabel(stage.name)}</span>
                </span>
                <span className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <span
                    className="block h-full rounded-full transition-all"
                    style={{ width: `${(stage.value / maxStageValue) * 100}%`, backgroundColor: stageColor(stage.name) }}
                  />
                </span>
                <span className="w-8 text-right text-xs font-semibold text-gray-700">{stage.value}</span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyChartState label="No case stage data yet" />
        )}
      </div>

      {/* Cases by category */}
      <div className="card lg:col-span-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Cases by category</h3>
        {casesByVisaTypeData.length > 0 ? (
          <ResponsiveContainer width="100%" height={Math.max(180, casesByVisaTypeData.length * 26)}>
            <BarChart data={casesByVisaTypeData} layout="vertical" margin={{ left: 8, right: 8, top: 0, bottom: 0 }}>
              <XAxis type="number" hide />
              <YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 11, fill: '#4b5563' }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: '#f9fafb' }} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="value" fill="#2563eb" radius={[0, 4, 4, 0]} barSize={10} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyChartState label="No category data yet" />
        )}
      </div>

      {/* Payment status */}
      <div className="card lg:col-span-3">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Payment status</h3>
        {(paymentStatusData[0].value + paymentStatusData[1].value) > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie
                  data={paymentStatusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={65}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {paymentStatusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-col gap-1.5 mt-2">
              {paymentStatusData.map((entry, index) => (
                <div key={index} className="flex items-center gap-1.5 text-xs text-gray-600">
                  <span className="stage-dot" style={{ backgroundColor: entry.color }} />
                  {entry.name} · {entry.value}
                </div>
              ))}
            </div>
          </>
        ) : (
          <EmptyChartState label="No payment data yet" />
        )}
      </div>
    </div>

    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Needs attention */}
      <div className="card lg:col-span-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-900">Needs attention</h3>
          <span className="text-xs text-gray-400">{needsAttention.length} to chase</span>
        </div>
        {needsAttention.length > 0 ? (
          <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
            {needsAttention.map((item) => (
              <button
                key={item._id}
                onClick={() => navigate(`/crm-cases/${item._id}`)}
                className="w-full text-left border-l-2 pl-3 py-1.5 hover:bg-gray-50 rounded-r-lg transition-colors"
                style={{ borderColor: REASON_COLORS[item.reasons[0]?.color || 'grey'].dot }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-gray-900 truncate">{item.clientName || item.caseNumber}</span>
                  <div className="flex gap-1 shrink-0">
                    {item.reasons.map((r, i) => (
                      <span
                        key={i}
                        className="px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                        style={{ backgroundColor: REASON_COLORS[r.color].bg, color: REASON_COLORS[r.color].text }}
                      >
                        {r.label}
                      </span>
                    ))}
                  </div>
                </div>
                <p className="text-[11px] text-gray-500 truncate">{item.caseNumber} · {resolveDisplayVisa(item) || item.visaCategory} · {item.caseManagerName}</p>
                {item.lastActivity && <p className="text-[11px] text-gray-400 truncate">{item.lastActivity}</p>}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-10 text-gray-400">
            <AlertTriangle className="w-6 h-6 mb-2" />
            <p className="text-xs">Nothing needs attention right now</p>
          </div>
        )}
      </div>

      {/* Recent activity */}
      <div className="card lg:col-span-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-900">Recent activity</h3>
          <span className="text-xs text-gray-400">{connected ? 'Live' : 'Connecting…'} · latest log entries</span>
        </div>
        {recentActivity.length > 0 ? (
          <div className="divide-y divide-gray-100 max-h-[360px] overflow-y-auto">
            {recentActivity.slice(0, 10).map((a) => (
              <button
                key={a._id}
                onClick={() => navigate(`/crm-cases/${a.caseId}`)}
                className="w-full flex items-start gap-3 py-2.5 px-1 text-left hover:bg-gray-50 rounded-lg transition-colors"
              >
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0"
                  style={{ backgroundColor: avatarColor(a.performedBy).bg, color: avatarColor(a.performedBy).text }}
                >
                  {(a.performedBy || 'S').charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-900 truncate">{a.performedBy} · {a.caseNumber}</p>
                  <p className="text-xs text-gray-500 truncate">{a.description || a.title}</p>
                </div>
                <span className="text-[11px] text-gray-400 shrink-0">{timeAgo(a.performedAt)}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-10 text-gray-400">
            <Bell className="w-6 h-6 mb-2" />
            <p className="text-xs">No recent activity yet</p>
          </div>
        )}
      </div>
    </div>

    {/* Team workload */}
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900">Team workload</h3>
        <span className="text-xs text-gray-400">active cases per case manager</span>
      </div>
      {teamWorkload.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {teamWorkload.map((member) => {
            const activeCount = member.activeCasesCount || 0
            const maxActive = Math.max(1, ...teamWorkload.map(m => m.activeCasesCount || 0))
            return (
              <button
                key={member._id}
                onClick={() => navigate(`/case-managers/${member._id}`)}
                className="text-left border border-gray-100 rounded-lg p-3 hover:border-primary-200 hover:bg-primary-50/30 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="w-5 h-5 rounded-full text-[10px] font-semibold flex items-center justify-center shrink-0"
                      style={{ backgroundColor: avatarColor(member.name).bg, color: avatarColor(member.name).text }}
                    >
                      {(member.name || '?').charAt(0)}
                    </span>
                    <span className="text-xs font-medium text-gray-900 truncate">{member.name}</span>
                  </div>
                  <span className="text-xs font-bold text-gray-900 shrink-0">{activeCount}</span>
                </div>
                <span className="block h-1 rounded-full bg-gray-100 overflow-hidden mb-2">
                  <span className="block h-full rounded-full bg-primary-600" style={{ width: `${(activeCount / maxActive) * 100}%` }} />
                </span>
                <p className="text-[11px] text-gray-400">
                  {activeCount} active · {member.completedCasesCount || 0} filed
                </p>
              </button>
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-gray-400 text-center py-6">No case manager workload data</p>
      )}
    </div>

    {/* Top performers */}
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">Top performers</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="flex items-center justify-between border border-gray-100 rounded-lg px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="stage-dot" style={{ backgroundColor: '#2563eb' }} />
            <div>
              <p className="text-xs text-gray-500">Top Case Manager</p>
              <p className="text-sm font-semibold text-gray-900">{stats?.topCaseManager || 'N/A'}</p>
            </div>
          </div>
          <span className="text-xs font-medium text-gray-500">{stats?.topCaseManagerScore || 0} pts</span>
        </div>
      </div>
    </div>

    <div className="card">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">Quick actions</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <button onClick={() => navigate('/crm-cases')} className="btn-primary flex items-center justify-center gap-2">
          <Briefcase className="w-4 h-4" />
          View Cases
        </button>
        <button onClick={() => navigate('/analytics')} className="btn-secondary flex items-center justify-center gap-2">
          <TrendingUp className="w-4 h-4" />
          View Analytics
        </button>
        <button onClick={() => navigate('/leaderboard')} className="btn-secondary flex items-center justify-center gap-2">
          <Award className="w-4 h-4" />
          View Leaderboard
        </button>
      </div>
    </div>
  </div>
)

const CaseManagerPanel = ({ navigate, roleStats }) => {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 mb-1">My Active Cases</p>
              <p className="text-3xl font-bold text-gray-900">{roleStats?.activeCases || 0}</p>
            </div>
            <div className="p-3 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600">
              <Briefcase className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 mb-1">Pending Review</p>
              <p className="text-3xl font-bold text-gray-900">{roleStats?.pendingReview || 0}</p>
            </div>
            <div className="p-3 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600">
              <Clock className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>
        <div className="card">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600 mb-1">Documents Pending Review</p>
              <p className="text-3xl font-bold text-gray-900">{roleStats?.pendingDocumentReview || 0}</p>
            </div>
            <div className="p-3 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-600">
              <FileText className="w-6 h-6 text-white" />
            </div>
          </div>
        </div>
      </div>

      <CaseManagerAnalyticsPanel />

      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">My Cases (By Priority)</h3>
        <div className="space-y-3">
          {roleStats?.urgentCases?.slice(0, 5).map((caseItem) => (
            <div key={caseItem._id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div>
                <p className="font-medium text-gray-900">{caseItem.caseNumber}</p>
                <p className="text-sm text-gray-600">{caseItem.clientName}</p>
              </div>
              <button onClick={() => navigate(`/crm-cases/${caseItem._id}`)} className="btn-secondary text-sm">
                View
              </button>
            </div>
          ))}
          {(!roleStats?.urgentCases || roleStats.urgentCases.length === 0) && (
            <p className="text-gray-500 text-center py-4">No urgent cases</p>
          )}
        </div>
      </div>
    </div>
  )
}

const TeamLeadPanel = ({
  navigate, teamStatCards, casesByStageData, maxStageValue, casesByVisaTypeData,
  paymentStatusData, needsAttention, recentActivity, connected, roleStats
}) => {
  const teamMaxActive = Math.max(1, ...(roleStats?.caseManagerWorkload || []).map(m => m.activeCases || 0))

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {teamStatCards.map((card, index) => (
          <div key={index} className="card !p-4">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="stage-dot" style={{ backgroundColor: card.dot }} />
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide truncate">{card.title}</p>
            </div>
            <p className="text-2xl font-bold text-gray-900 leading-tight">{card.value}</p>
            <p className="text-xs text-gray-500 mt-1 truncate">{card.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Pipeline by stage */}
        <div className="card lg:col-span-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900">Pipeline by stage</h3>
            <span className="text-xs text-gray-400">click a stage to filter</span>
          </div>
          {casesByStageData.length > 0 ? (
            <div className="space-y-3">
              {casesByStageData.map((stage, index) => (
                <button
                  key={index}
                  onClick={() => navigate('/crm-cases')}
                  className="w-full flex items-center gap-3 group"
                >
                  <span className="flex items-center gap-1.5 w-28 shrink-0 text-left">
                    <span className="stage-dot" style={{ backgroundColor: stageColor(stage.name) }} />
                    <span className="text-xs text-gray-600 truncate">{stageLabel(stage.name)}</span>
                  </span>
                  <span className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <span
                      className="block h-full rounded-full transition-all"
                      style={{ width: `${(stage.value / maxStageValue) * 100}%`, backgroundColor: stageColor(stage.name) }}
                    />
                  </span>
                  <span className="w-8 text-right text-xs font-semibold text-gray-700">{stage.value}</span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyChartState label="No case stage data yet" />
          )}
        </div>

        {/* Cases by category */}
        <div className="card lg:col-span-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Cases by category</h3>
          {casesByVisaTypeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(180, casesByVisaTypeData.length * 26)}>
              <BarChart data={casesByVisaTypeData} layout="vertical" margin={{ left: 8, right: 8, top: 0, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 11, fill: '#4b5563' }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: '#f9fafb' }} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="value" fill="#2563eb" radius={[0, 4, 4, 0]} barSize={10} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChartState label="No category data yet" />
          )}
        </div>

        {/* Payment status */}
        <div className="card lg:col-span-3">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Payment status</h3>
          {(paymentStatusData[0].value + paymentStatusData[1].value) > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={paymentStatusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={65}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {paymentStatusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-1.5 mt-2">
                {paymentStatusData.map((entry, index) => (
                  <div key={index} className="flex items-center gap-1.5 text-xs text-gray-600">
                    <span className="stage-dot" style={{ backgroundColor: entry.color }} />
                    {entry.name} · {entry.value}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <EmptyChartState label="No payment data yet" />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Needs attention */}
        <div className="card lg:col-span-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900">Needs attention</h3>
            <span className="text-xs text-gray-400">{needsAttention.length} to chase</span>
          </div>
          {needsAttention.length > 0 ? (
            <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
              {needsAttention.map((item) => (
                <button
                  key={item._id}
                  onClick={() => navigate(`/crm-cases/${item._id}`)}
                  className="w-full text-left border-l-2 pl-3 py-1.5 hover:bg-gray-50 rounded-r-lg transition-colors"
                  style={{ borderColor: REASON_COLORS[item.reasons[0]?.color || 'grey'].dot }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-gray-900 truncate">{item.clientName || item.caseNumber}</span>
                    <div className="flex gap-1 shrink-0">
                      {item.reasons.map((r, i) => (
                        <span
                          key={i}
                          className="px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                          style={{ backgroundColor: REASON_COLORS[r.color].bg, color: REASON_COLORS[r.color].text }}
                        >
                          {r.label}
                        </span>
                      ))}
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-500 truncate">{item.caseNumber} · {resolveDisplayVisa(item) || item.visaCategory} · {item.caseManagerName}</p>
                  {item.lastActivity && <p className="text-[11px] text-gray-400 truncate">{item.lastActivity}</p>}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-gray-400">
              <AlertTriangle className="w-6 h-6 mb-2" />
              <p className="text-xs">Nothing needs attention right now</p>
            </div>
          )}
        </div>

        {/* Recent activity */}
        <div className="card lg:col-span-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900">Recent activity</h3>
            <span className="text-xs text-gray-400">{connected ? 'Live' : 'Connecting…'} · latest log entries</span>
          </div>
          {recentActivity.length > 0 ? (
            <div className="divide-y divide-gray-100 max-h-[360px] overflow-y-auto">
              {recentActivity.slice(0, 10).map((a) => (
                <button
                  key={a._id}
                  onClick={() => navigate(`/crm-cases/${a.caseId}`)}
                  className="w-full flex items-start gap-3 py-2.5 px-1 text-left hover:bg-gray-50 rounded-lg transition-colors"
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0"
                    style={{ backgroundColor: avatarColor(a.performedBy).bg, color: avatarColor(a.performedBy).text }}
                  >
                    {(a.performedBy || 'S').charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-900 truncate">{a.performedBy} · {a.caseNumber}</p>
                    <p className="text-xs text-gray-500 truncate">{a.description || a.title}</p>
                  </div>
                  <span className="text-[11px] text-gray-400 shrink-0">{timeAgo(a.performedAt)}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-gray-400">
              <Bell className="w-6 h-6 mb-2" />
              <p className="text-xs">No recent activity yet</p>
            </div>
          )}
        </div>
      </div>

      {/* New Cases Queue */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-900">New cases queue</h3>
          <span className="text-xs text-gray-400">
            {connected ? 'Live' : 'Connecting…'} · {roleStats?.unassignedCaseList?.length || 0} awaiting assignment
          </span>
        </div>
        {roleStats?.unassignedCaseList?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wide border-b border-gray-100">
                  <th className="py-2 pr-4">Case Number</th>
                  <th className="py-2 pr-4">Client</th>
                  <th className="py-2 pr-4">Visa</th>
                  <th className="py-2 pr-4">Package</th>
                  <th className="py-2 pr-4">Created</th>
                  <th className="py-2 pr-4">Priority</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {roleStats.unassignedCaseList.map((c) => (
                  <tr key={c._id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2.5 pr-4 font-medium text-gray-900">{c.caseNumber || c.caseId}</td>
                    <td className="py-2.5 pr-4 text-gray-700">{c.clientName || c.clientEmail || 'Unknown'}</td>
                    <td className="py-2.5 pr-4 text-gray-600">{resolveDisplayVisa(c) || '—'}</td>
                    <td className="py-2.5 pr-4 text-gray-600">{c.plan?.tier || c.package || '—'}</td>
                    <td className="py-2.5 pr-4 text-gray-500">{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—'}</td>
                    <td className="py-2.5 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        ['high', 'urgent', 'Premium Processing'].includes(c.priority)
                          ? 'bg-red-50 text-red-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {c.priority || 'medium'}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-gray-600 capitalize">{(c.status || '').replace(/_/g, ' ')}</td>
                    <td className="py-2.5 pr-4 text-right">
                      <button
                        onClick={() => navigate(`/crm-cases/${c._id}?assign=case_manager`)}
                        className="text-primary-600 hover:text-primary-700 font-medium text-xs"
                      >
                        Assign →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-gray-400 text-center py-6">No new cases awaiting assignment</p>
        )}
      </div>

      {/* Team workload */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-900">Team workload</h3>
          <span className="text-xs text-gray-400">click a case manager for their full caseload</span>
        </div>
        {roleStats?.caseManagerWorkload?.length ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {roleStats.caseManagerWorkload.map((entry, index) => {
              const activeCount = entry.activeCases || 0
              return (
                <button
                  key={entry.caseManagerId || index}
                  onClick={() => entry.caseManagerId && navigate(`/case-managers/${entry.caseManagerId}`)}
                  className="text-left border border-gray-100 rounded-lg p-3 hover:border-primary-200 hover:bg-primary-50/30 transition-colors"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className="w-5 h-5 rounded-full text-[10px] font-semibold flex items-center justify-center shrink-0"
                        style={{ backgroundColor: avatarColor(entry.caseManagerName).bg, color: avatarColor(entry.caseManagerName).text }}
                      >
                        {(entry.caseManagerName || '?').charAt(0)}
                      </span>
                      <span className="text-xs font-medium text-gray-900 truncate">{entry.caseManagerName || 'Unassigned'}</span>
                    </div>
                    <span className="text-xs font-bold text-gray-900 shrink-0">{entry.totalCases || 0}</span>
                  </div>
                  <span className="block h-1 rounded-full bg-gray-100 overflow-hidden mb-2">
                    <span className="block h-full rounded-full bg-primary-600" style={{ width: `${(activeCount / teamMaxActive) * 100}%` }} />
                  </span>
                  <p className="text-[11px] text-gray-400">
                    {activeCount} active · {entry.pendingCases || 0} pending
                  </p>
                </button>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-gray-400 text-center py-6">No workload data</p>
        )}
      </div>
    </div>
  )
}

const ClientPanel = ({ navigate, roleStats }) => (
  <div className="space-y-6">
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="card">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-gray-600 mb-1">My Cases</p>
            <p className="text-3xl font-bold text-gray-900">{roleStats?.myCases || 0}</p>
          </div>
          <div className="p-3 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600">
            <Briefcase className="w-6 h-6 text-white" />
          </div>
        </div>
      </div>
      <div className="card">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-gray-600 mb-1">Pending Documents</p>
            <p className="text-3xl font-bold text-gray-900">{roleStats?.pendingDocuments || 0}</p>
          </div>
          <div className="p-3 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600">
            <FileText className="w-6 h-6 text-white" />
          </div>
        </div>
      </div>
      <div className="card">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-gray-600 mb-1">Unread Messages</p>
            <p className="text-3xl font-bold text-gray-900">{roleStats?.unreadMessages || 0}</p>
          </div>
          <div className="p-3 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-600">
            <MessageSquare className="w-6 h-6 text-white" />
          </div>
        </div>
      </div>
    </div>

    <div className="card">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">My Cases</h3>
      <div className="space-y-3">
        {roleStats?.myCasesList?.slice(0, 5).map((caseItem) => (
          <div key={caseItem._id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div>
              <p className="font-medium text-gray-900">{caseItem.caseNumber}</p>
              <p className="text-sm text-gray-600">{resolveDisplayVisa(caseItem)} - {caseItem.visaCategory}</p>
            </div>
            <span className={`badge ${caseItem.stage === 'approved' ? 'bg-green-100 text-green-800' : caseItem.stage === 'uscis_pending' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>
              {caseItem.stage.replace('_', ' ')}
            </span>
          </div>
        ))}
        {(!roleStats?.myCasesList || roleStats.myCasesList.length === 0) && (
          <p className="text-gray-500 text-center py-4">No cases found</p>
        )}
      </div>
    </div>

    <div className="card">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button onClick={() => navigate('/crm-cases')} className="btn-primary flex items-center justify-center gap-2">
          <Briefcase className="w-4 h-4" />
          View My Cases
        </button>
        <button onClick={() => navigate('/messages')} className="btn-secondary flex items-center justify-center gap-2">
          <MessageSquare className="w-4 h-4" />
          View Messages
        </button>
      </div>
    </div>
  </div>
)

const Dashboard = () => {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { subscribe, connected } = useSocket()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [revenueData, setRevenueData] = useState([])
  const [roleStats, setRoleStats] = useState(null)
  const [leaderboard, setLeaderboard] = useState([])
  const [teamWorkload, setTeamWorkload] = useState([])
  const [needsAttention, setNeedsAttention] = useState([])
  const [recentActivity, setRecentActivity] = useState([])

  // Role helper
  const is = (roles) => roles.includes(user?.role)
  const seesAnalytics = is(['super_admin', 'admin', 'team_lead'])

  useEffect(() => {
    if (is(['super_admin', 'admin'])) {
      fetchDashboardStats()
      fetchRevenueData()
      fetchTeamWorkload()
    } else if (is(['case_manager'])) {
      fetchCaseManagerStats()
    } else if (is(['team_lead'])) {
      fetchDashboardStats()
      fetchTeamLeadStats()
    } else if (is(['client'])) {
      fetchClientStats()
    }
    if (seesAnalytics) {
      fetchNeedsAttention()
      fetchRecentActivity()
    }
  }, [user?.role])

  // Live-update Recent Activity and Needs Attention the instant any case
  // action happens anywhere in the CRM, without requiring a page refresh.
  useEffect(() => {
    if (!seesAnalytics || !connected) return
    return subscribe('case:activity', (activity) => {
      setRecentActivity((prev) => [
        {
          _id: `${activity.caseId}-${activity.performedAt}`,
          caseId: activity.caseId,
          caseNumber: activity.caseNumber,
          clientName: activity.clientName,
          title: activity.action,
          description: activity.description,
          performedBy: activity.performedBy?.name,
          performedAt: activity.performedAt
        },
        ...prev
      ].slice(0, 20))
      fetchNeedsAttention({ force: true })
    })
  }, [connected, user?.role])

  // Live-update the "New Cases Queue" the instant a case is created and
  // routed to this Team Lead, without requiring a page refresh.
  useEffect(() => {
    if (!is(['team_lead']) || !connected) return
    return subscribe('case:created', (newCase) => {
      setRoleStats((prev) => {
        if (!prev) return prev
        const alreadyPresent = (prev.unassignedCaseList || []).some((item) => item._id === newCase._id)
        if (alreadyPresent) return prev
        return {
          ...prev,
          unassignedCases: (prev.unassignedCases || 0) + 1,
          unassignedCaseList: [newCase, ...(prev.unassignedCaseList || [])],
        }
      })
    })
  }, [connected, user?.role])

  const fetchNeedsAttention = async ({ force = false } = {}) => {
    try {
      const data = await cachedDashboardGet('needs-attention', '/cases/dashboard/needs-attention', { force })
      setNeedsAttention(data.data || [])
    } catch (error) {
      setNeedsAttention([])
    }
  }

  const fetchRecentActivity = async ({ force = false } = {}) => {
    try {
      const data = await cachedDashboardGet('recent-activity', '/cases/dashboard/recent-activity', { force })
      setRecentActivity(data.data || [])
    } catch (error) {
      setRecentActivity([])
    }
  }

  const fetchDashboardStats = async ({ force = false } = {}) => {
    try {
      const data = await cachedDashboardGet('analytics-dashboard', '/analytics/dashboard', { force })
      setStats(data)
      setError(null)
    } catch (error) {
      setError('Failed to load dashboard data: ' + (error.response?.data?.message || error.message))
      // Set default stats to prevent blank screen
      setStats({
        totalCases: 0,
        closedCases: 0,
        activeCases: 0,
        pendingPayments: 0,
        pendingAmount: 0,
        totalRevenue: 0,
        casesByStage: [],
        casesByVisaType: [],
        topCaseManager: 'N/A',
        topCaseManagerScore: 0
      })
    } finally {
      setLoading(false)
    }
  }

  const fetchRevenueData = async ({ force = false } = {}) => {
    try {
      const data = await cachedDashboardGet('analytics-revenue', '/analytics/revenue', { force })
      setRevenueData((data.monthlyRevenue || []).map(item => ({
        ...item,
        amount: Number(item.value || item.amount || 0) / 100
      })))
    } catch (error) {
      setRevenueData([])
    }
  }

  const fetchTeamWorkload = async ({ force = false } = {}) => {
    try {
      const data = await cachedDashboardGet('case-managers', '/case-managers', { force })
      setTeamWorkload(data.data || data.caseManagers || [])
    } catch (error) {
      setTeamWorkload([])
    }
  }

  const fetchCaseManagerStats = async ({ force = false } = {}) => {
    try {
      const data = await cachedDashboardGet('case-dashboard-stats', '/cases/dashboard/stats', { force })
      setRoleStats(data)
      setError(null)
    } catch (error) {
      setError('Failed to load case manager stats')
    } finally {
      setLoading(false)
    }
  }

  const fetchTeamLeadStats = async ({ force = false } = {}) => {
    try {
      const data = await cachedDashboardGet('team-lead-dashboard', '/cases/dashboard/team-lead', { force })
      setRoleStats(data)
      setError(null)
    } catch (error) {
      setError('Failed to load team stats')
    } finally {
      setLoading(false)
    }
  }

  const fetchClientStats = async ({ force = false } = {}) => {
    try {
      const data = await cachedDashboardGet('case-dashboard-stats', '/cases/dashboard/stats', { force })
      setRoleStats({
        myCases: data.totalCases || 0,
        pendingDocuments: data.pendingDocumentReview || 0,
        unreadMessages: 0,
        myCasesList: data.urgentCases || []
      })
      setError(null)
    } catch (error) {
      setError('Failed to load client stats')
    } finally {
      setLoading(false)
    }
  }

  const retryCurrentDashboard = () => {
    setLoading(true)
    if (is(['super_admin', 'admin'])) {
      fetchDashboardStats({ force: true })
      fetchRevenueData({ force: true })
      fetchTeamWorkload({ force: true })
    } else if (is(['case_manager'])) { fetchCaseManagerStats({ force: true }) }
    else if (is(['team_lead'])) { fetchDashboardStats({ force: true }); fetchTeamLeadStats({ force: true }) }
    else if (is(['client'])) fetchClientStats({ force: true })
    else setLoading(false)
    if (seesAnalytics) {
      fetchNeedsAttention({ force: true })
      fetchRecentActivity({ force: true })
    }
  }

  const casesByStageData = useMemo(() => stats?.casesByStage?.map(item => ({
    name: item.key ?? item._id,
    value: item.count
  })) || [], [stats?.casesByStage])

  const casesByVisaTypeData = useMemo(() => (stats?.casesByVisaType?.map(item => ({
    name: item.key ?? item._id ?? 'Unknown',
    value: item.count
  })) || []).sort((a, b) => b.value - a.value), [stats?.casesByVisaType])

  const maxStageValue = Math.max(1, ...casesByStageData.map(s => s.value))
  const onHoldCount = casesByStageData.find(s => stageKey(s.name) === 'on_hold')?.value ?? 0
  const paidCount = Math.max(0, (stats?.totalCases || 0) - (stats?.pendingPayments || 0))
  const paymentStatusData = useMemo(() => [
    { name: 'Paid / Cleared', value: paidCount, color: '#10b981' },
    { name: 'Outstanding', value: stats?.pendingPayments || 0, color: '#ef4444' }
  ], [paidCount, stats?.pendingPayments])

  const statCards = [
    { title: 'Cases Tracked', value: stats?.totalCases || 0, sub: `across ${casesByVisaTypeData.length || 0} categories`, dot: '#2563eb' },
    { title: 'Active Cases', value: stats?.activeCases || 0, sub: 'in the pipeline now', dot: '#0ea5e9' },
    { title: 'On Hold', value: onHoldCount, sub: 'paused by client/internal', dot: '#ef4444' },
    { title: 'Pending Payments', value: stats?.pendingPayments || 0, sub: formatCents(stats?.pendingAmount), dot: '#f59e0b' },
    { title: 'Closed Cases', value: stats?.closedCases || 0, sub: 'this period', dot: '#10b981' },
    { title: 'Total Revenue', value: formatCents(stats?.totalRevenue), sub: 'this period', dot: '#8b5cf6' }
  ]

  const teamStatCards = [
    { title: 'New Cases', value: roleStats?.newCases || 0, sub: 'added to the team queue', dot: '#2563eb' },
    { title: 'Unassigned', value: roleStats?.unassignedCases || 0, sub: 'awaiting a case manager', dot: '#f59e0b' },
    { title: 'Assigned', value: roleStats?.assignedCases || 0, sub: 'in the pipeline now', dot: '#0ea5e9' },
    { title: 'Aging Cases', value: roleStats?.agingCases || 0, sub: 'unassigned 7+ days', dot: '#ef4444' },
    { title: 'Active Cases', value: stats?.activeCases || 0, sub: 'across the org pipeline', dot: '#10b981' },
    { title: 'Pending Payments', value: stats?.pendingPayments || 0, sub: formatCents(stats?.pendingAmount), dot: '#8b5cf6' }
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500 text-sm">Loading dashboard...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="card">
          <div className="text-center py-12">
            <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-4" />
            <h3 className="text-base font-semibold text-gray-900 mb-2">Unable to load dashboard data</h3>
            <p className="text-sm text-gray-600">{error}</p>
            <button
              onClick={retryCurrentDashboard}
              className="mt-4 btn-primary"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {!is(['super_admin', 'admin']) && (
        <div>
          <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500">Welcome back! Here's what's happening today.</p>
        </div>
      )}

      {error && (
        <div className="card">
          <div className="text-center py-12">
            <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-4" />
            <h3 className="text-base font-semibold text-gray-900 mb-2">Unable to load dashboard data</h3>
            <p className="text-sm text-gray-600">{error}</p>
          </div>
        </div>
      )}

      {is(['super_admin', 'admin']) && (
        <AdminPanel
          navigate={navigate}
          statCards={statCards}
          casesByStageData={casesByStageData}
          maxStageValue={maxStageValue}
          casesByVisaTypeData={casesByVisaTypeData}
          paymentStatusData={paymentStatusData}
          needsAttention={needsAttention}
          recentActivity={recentActivity}
          connected={connected}
          teamWorkload={teamWorkload}
          stats={stats}
        />
      )}
      {is(['case_manager']) && (
        <CaseManagerPanel navigate={navigate} roleStats={roleStats} />
      )}
      {is(['team_lead']) && (
        <TeamLeadPanel
          navigate={navigate}
          teamStatCards={teamStatCards}
          casesByStageData={casesByStageData}
          maxStageValue={maxStageValue}
          casesByVisaTypeData={casesByVisaTypeData}
          paymentStatusData={paymentStatusData}
          needsAttention={needsAttention}
          recentActivity={recentActivity}
          connected={connected}
          roleStats={roleStats}
        />
      )}
      {is(['client']) && <ClientPanel navigate={navigate} roleStats={roleStats} />}
    </div>
  )
}

export default Dashboard
