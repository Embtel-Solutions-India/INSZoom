import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpRight, ChevronRight, ListChecks, Loader2, Plus, TrendingDown, TrendingUp } from 'lucide-react'
import { tasksApi } from '../../services/api'
import NewTaskModal from '../../components/NewTaskModal'
import { STATUS_DOT, PRIORITY_DOT, formatLabel } from '../../components/taskStyle'

// The Admin portal's "Task overview" page, scoped to the signed-in attorney: the server returns the
// counts and week-over-week trends for this attorney's own tasks only (GET /tasks/stats/dashboard).
const EMPTY_STATS = {
  statusCounts: { pending: 0, assigned: 0, in_progress: 0, waiting: 0, blocked: 0, completed: 0, cancelled: 0 },
  priorityCounts: { low: 0, medium: 0, high: 0, urgent: 0 },
  overdueCount: 0,
  upcomingCount: 0,
  total: 0,
}

// One strip of four figures: a label, a large number and a quiet trend line.
function Kpi({ title, value, trend, higherIsBad = false }) {
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

// A breakdown as plain rows: name on the left, share and count on the right.
function Breakdown({ title, rows, total, dot }) {
  return (
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
                {formatLabel(key)}
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
}

export default function TaskOverviewPage() {
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [recentTasks, setRecentTasks] = useState([])
  const [error, setError] = useState('')
  const [showNewTask, setShowNewTask] = useState(false)

  const load = useCallback(async () => {
    try {
      const { data } = await tasksApi.stats()
      const s = data.stats || {}
      setStats({
        ...EMPTY_STATS,
        ...s,
        statusCounts: { ...EMPTY_STATS.statusCounts, ...(s.statusCounts || {}) },
        priorityCounts: { ...EMPTY_STATS.priorityCounts, ...(s.priorityCounts || {}) },
      })
      setError('')
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load task statistics')
      setStats((prev) => prev || EMPTY_STATS)
    }
    try {
      const { data } = await tasksApi.myTasks()
      const list = Array.isArray(data.tasks) ? data.tasks : data.items || data.data || []
      setRecentTasks([...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5))
    } catch {
      // the recent list simply stays as it was
    }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, 30000)
    return () => clearInterval(timer)
  }, [load])

  if (!stats) return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>

  const statusRows = Object.entries(stats.statusCounts)
  const priorityRows = Object.entries(stats.priorityCounts)
  const sum = (rows) => rows.reduce((total, [, count]) => total + Number(count || 0), 0)

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Task overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">Workload, deadlines and priorities across your cases</p>
        </div>
        <button onClick={() => setShowNewTask(true)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90">
          <Plus className="h-4 w-4" />
          Create task
        </button>
      </div>

      {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

      {showNewTask && (
        <NewTaskModal
          onClose={() => setShowNewTask(false)}
          onCreated={() => {
            setShowNewTask(false)
            load()
          }}
        />
      )}

      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-4 [&>*]:border-border [&>*:nth-child(even)]:border-l [&>*:nth-child(n+3)]:border-t lg:[&>*]:border-t-0 lg:[&>*:not(:first-child)]:border-l">
        <Kpi title="Total tasks" value={stats.total} trend={stats.trends?.total} />
        <Kpi title="Overdue" value={stats.overdueCount} trend={stats.trends?.overdue} higherIsBad />
        <Kpi title="Upcoming" value={stats.upcomingCount} trend={stats.trends?.upcoming} />
        <Kpi title="Completed" value={stats.statusCounts.completed || 0} trend={stats.trends?.completed} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Breakdown title="By status" rows={statusRows} total={sum(statusRows)} dot={STATUS_DOT} />
        <Breakdown title="By priority" rows={priorityRows} total={sum(priorityRows)} dot={PRIORITY_DOT} />
      </div>

      <section className="rounded-xl border border-border bg-card">
        <button onClick={() => navigate('/tasks/my-tasks')} className="group flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/60">
          <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-foreground">My tasks</span>
            <span className="block truncate text-xs text-muted-foreground">Assigned to you</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
        </button>
      </section>

      {recentTasks.length > 0 && (
        <section className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <h3 className="text-sm font-semibold text-foreground">Recent tasks</h3>
            <button onClick={() => navigate('/tasks/my-tasks')} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80">
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
                      <span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[task.status] || 'bg-slate-300'}`} aria-hidden="true" />{formatLabel(task.status)}</span>
                      <span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[task.priority] || 'bg-slate-300'}`} aria-hidden="true" />{formatLabel(task.priority)} priority</span>
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    <p>{task.dueDate ? `Due ${new Date(task.dueDate).toLocaleDateString()}` : 'No due date'}</p>
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
