import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'
import { STATUS_DOT, PRIORITY_DOT } from '../components/tasks/taskStyle'
import {
  ArrowUpRight,
  TrendingUp,
  TrendingDown,
  ChevronRight,
  Calendar,
  ListChecks,
  Users,
  Plus
} from 'lucide-react'

const formatStatus = (status) => String(status || '').split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')

// One strip of four figures (no coloured icon tiles): a label, a large number and a quiet trend line
const Kpi = ({ title, value, trend, higherIsBad = false }) => {
  const worse = trend != null && trend !== 0 && (trend > 0) === higherIsBad
  return (
    <div className="px-6 py-5">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-foreground">{value}</p>
      {trend != null && (
        <p className={`mt-2 flex items-center gap-1.5 text-sm tabular-nums ${trend === 0 ? 'text-muted-foreground' : worse ? 'text-red-600' : 'text-emerald-600'}`}>
          {trend < 0 ? <TrendingDown className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
          {Math.abs(trend)}% from last week
        </p>
      )}
    </div>
  )
}

// A breakdown as plain rows: name on the left, share and count on the right (a coloured dot, no bars)
const Breakdown = ({ title, rows, total, dot }) => (
  <section className="rounded-xl border border-border bg-card">
    <div className="flex items-baseline justify-between border-b border-border px-6 py-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <span className="text-xs tabular-nums text-muted-foreground">{total} total</span>
    </div>
    <ul className="divide-y divide-border/60">
      {rows.map(([key, count]) => {
        const share = total ? Math.round((count / total) * 100) : 0
        const shareLabel = !count ? '' : share < 1 ? '<1%' : `${share}%`
        return (
          <li key={key} className="flex items-center justify-between gap-3 px-6 py-3 text-sm">
            <span className={`flex items-center gap-2.5 ${count ? 'text-foreground' : 'text-muted-foreground'}`}>
              <span className={`h-2 w-2 rounded-full ${dot[key] || 'bg-slate-300'} ${count ? '' : 'opacity-50'}`} aria-hidden="true" />
              {formatStatus(key)}
            </span>
            <span className="flex items-baseline gap-4 tabular-nums">
              <span className="w-10 text-right text-xs text-muted-foreground">{shareLabel}</span>
              <span className={`w-10 text-right font-medium ${count ? 'text-foreground' : 'text-muted-foreground'}`}>{count}</span>
            </span>
          </li>
        )
      })}
    </ul>
  </section>
)

const TaskDashboard = () => {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [recentTasks, setRecentTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const defaultStats = {
    statusCounts: {
      pending: 0,
      assigned: 0,
      in_progress: 0,
      waiting: 0,
      blocked: 0,
      completed: 0,
      cancelled: 0
    },
    priorityCounts: {
      low: 0,
      medium: 0,
      high: 0,
      urgent: 0
    },
    overdueCount: 0,
    upcomingCount: 0,
    total: 0
  }

  // Role helper
  const is = (roles) => roles.includes(user?.role)

  useEffect(() => {
    fetchTaskStats()
    fetchRecentTasks()
    const timer = setInterval(() => {
      fetchTaskStats()
      fetchRecentTasks()
    }, 30000)
    return () => clearInterval(timer)
  }, [user?.role])

  const fetchTaskStats = async () => {
    try {
      const response = await api.get('/tasks/stats/dashboard')
      setStats({
        ...defaultStats,
        ...(response.data.stats || {}),
        statusCounts: { ...defaultStats.statusCounts, ...(response.data.stats?.statusCounts || {}) },
        priorityCounts: { ...defaultStats.priorityCounts, ...(response.data.stats?.priorityCounts || {}) }
      })
      setError(null)
    } catch (error) {
      console.error('Error fetching task stats:', error)
      setError('Failed to load task statistics')
      setStats(defaultStats)
    } finally {
      setLoading(false)
    }
  }

  const fetchRecentTasks = async () => {
    try {
      const response = await api.get('/tasks', {
        params: { limit: 5, sort: '-createdAt' }
      })
      setRecentTasks(response.data.tasks || response.data.items || response.data.data || [])
    } catch (error) {
      console.error('Error fetching recent tasks:', error)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    )
  }

  const statusRows = Object.entries(stats?.statusCounts || defaultStats.statusCounts)
  const priorityRows = Object.entries(stats?.priorityCounts || defaultStats.priorityCounts)
  const sum = (rows) => rows.reduce((total, [, count]) => total + Number(count || 0), 0)

  const shortcuts = [
    { label: 'My tasks', hint: 'Assigned to you', path: '/tasks/my-tasks', icon: ListChecks, show: true },
    { label: 'Team tasks', hint: 'Across your team', path: '/tasks/team-tasks', icon: Users, show: is(['super_admin', 'admin', 'team_lead']) },
    { label: 'Calendar', hint: 'Due dates by day', path: '/tasks/calendar', icon: Calendar, show: true },
    { label: 'All tasks', hint: 'Every task, filterable', path: '/tasks/all', icon: ListChecks, show: true }
  ].filter((item) => item.show)

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Task overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">Workload, deadlines and priorities across your cases</p>
        </div>
        {is(['super_admin', 'admin', 'team_lead', 'case_manager']) && (
          <button
            onClick={() => navigate('/tasks/create')}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Create task
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {stats && (
        <>
          {/* Key figures: one card, four columns, hairline dividers */}
          <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-4 [&>*]:border-border [&>*:nth-child(even)]:border-l [&>*:nth-child(n+3)]:border-t lg:[&>*]:border-t-0 lg:[&>*:not(:first-child)]:border-l">
            <Kpi title="Total tasks" value={stats.total} trend={stats.trends?.total} />
            <Kpi title="Overdue" value={stats.overdueCount} trend={stats.trends?.overdue} higherIsBad />
            <Kpi title="Upcoming" value={stats.upcomingCount} trend={stats.trends?.upcoming} />
            <Kpi title="Completed" value={stats.statusCounts?.completed || 0} trend={stats.trends?.completed} />
          </div>

          {/* Breakdowns */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Breakdown title="By status" rows={statusRows} total={sum(statusRows)} dot={STATUS_DOT} />
            <Breakdown title="By priority" rows={priorityRows} total={sum(priorityRows)} dot={PRIORITY_DOT} />
          </div>
        </>
      )}

      {/* Shortcuts */}
      <section className="rounded-xl border border-border bg-card">
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 [&>*]:border-border [&>*:not(:first-child)]:border-t sm:[&>*:nth-child(even)]:border-l sm:[&>*:nth-child(2)]:border-t-0 lg:[&>*]:border-t-0 lg:[&>*:not(:first-child)]:border-l">
          {shortcuts.map(({ label, hint, path, icon: Icon }) => (
            <li key={path}>
              <button onClick={() => navigate(path)} className="group flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/60">
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">{label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{hint}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Recent tasks */}
      {recentTasks.length > 0 && (
        <section className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <h3 className="text-sm font-semibold text-foreground">Recent tasks</h3>
            <button onClick={() => navigate('/tasks/all')} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80">
              View all <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <ul className="divide-y divide-border/60">
            {recentTasks.map((task) => (
              <li key={task._id}>
                <button onClick={() => navigate(`/tasks/${task._id}`)} className="flex w-full items-center justify-between gap-4 px-6 py-3.5 text-left transition-colors hover:bg-muted/50">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{task.title}</p>
                    <p className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[task.status] || 'bg-slate-300'}`} aria-hidden="true" />{formatStatus(task.status)}</span>
                      <span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[task.priority] || 'bg-slate-300'}`} aria-hidden="true" />{formatStatus(task.priority)} priority</span>
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    <p>{task.dueDate ? `Due ${new Date(task.dueDate).toLocaleDateString()}` : 'No due date'}</p>
                    {task.assignedTo?.name && <p className="mt-1">{task.assignedTo.name}</p>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

export default TaskDashboard
