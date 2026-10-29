import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, Search, Plus, Calendar } from 'lucide-react'
import { tasksApi } from '../../services/api'
import NewTaskModal from '../../components/NewTaskModal'
import { STATUS_DOT, PRIORITY_DOT, formatLabel, formatDate, isOverdue } from '../../components/taskStyle'

// Same layout as the Admin portal's "My tasks" (key figures, filters, one clickable list). An attorney
// only ever sees tasks assigned to them, and can only create tasks for themselves.
const CONTROL = 'rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring'
const EMPTY_FILTERS = { status: '', priority: '', category: '', search: '' }

const STATUSES = ['pending', 'assigned', 'in_progress', 'waiting', 'blocked', 'completed']
const PRIORITIES = ['urgent', 'high', 'medium', 'low']
const CATEGORIES = [
  'case_preparation', 'document_review', 'legal_review', 'expert_letter', 'filing', 'rfe_response',
  'follow_up', 'administrative', 'finance', 'client_communication',
]

export default function TasksPage() {
  const navigate = useNavigate()
  const [tasks, setTasks] = useState(null)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [showNewTask, setShowNewTask] = useState(false)

  const load = useCallback(
    () =>
      tasksApi
        .myTasks()
        .then(({ data }) => {
          setTasks(Array.isArray(data.tasks) ? data.tasks : data.items || data.data || [])
          setError('')
        })
        .catch((err) => setError(err.response?.data?.message || 'Could not load your tasks.')),
    []
  )

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const term = filters.search.trim().toLowerCase()
    return (tasks || []).filter((task) =>
      (!filters.status || task.status === filters.status) &&
      (!filters.priority || task.priority === filters.priority) &&
      (!filters.category || task.category === filters.category) &&
      (!term || String(task.title || '').toLowerCase().includes(term) || String(task.description || '').toLowerCase().includes(term))
    )
  }, [tasks, filters])

  const setFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }))

  if (!tasks) {
    return error ? <p className="text-sm text-destructive">{error}</p> : <Loader2 className="w-6 h-6 animate-spin text-primary" />
  }

  const overdueCount = tasks.filter(isOverdue).length
  const summary = [
    { label: 'Total tasks', value: tasks.length },
    { label: 'In progress', value: tasks.filter((t) => t.status === 'in_progress').length },
    { label: 'Completed', value: tasks.filter((t) => t.status === 'completed').length },
    { label: 'Overdue', value: overdueCount, bad: overdueCount > 0 },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => navigate('/tasks')} className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Back to task overview">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">My tasks</h1>
            <p className="mt-1 text-sm text-muted-foreground">Manage your assigned tasks</p>
          </div>
        </div>
        <button onClick={() => setShowNewTask(true)} className="btn-primary inline-flex items-center gap-2">
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
        {summary.map(({ label, value, bad }) => (
          <div key={label} className="px-4 sm:px-6 py-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className={`mt-1.5 text-2xl font-semibold tabular-nums tracking-tight ${bad ? 'text-destructive' : 'text-foreground'}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input type="text" placeholder="Search tasks..." value={filters.search} onChange={(e) => setFilter('search', e.target.value)} className={`${CONTROL} w-full pl-9`} />
        </div>
        <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={CONTROL} aria-label="Status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{formatLabel(s)}</option>)}
        </select>
        <select value={filters.priority} onChange={(e) => setFilter('priority', e.target.value)} className={CONTROL} aria-label="Priority">
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{formatLabel(p)}</option>)}
        </select>
        <select value={filters.category} onChange={(e) => setFilter('category', e.target.value)} className={CONTROL} aria-label="Category">
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{formatLabel(c)}</option>)}
        </select>
        <button onClick={() => setFilters(EMPTY_FILTERS)} className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
          Clear filters
        </button>
      </div>

      <section className="rounded-xl border border-border bg-card">
        <div className="flex items-baseline justify-between border-b border-border px-4 sm:px-6 py-4">
          <h3 className="text-sm font-semibold text-foreground">Tasks</h3>
          <span className="text-xs tabular-nums text-muted-foreground">{filtered.length} of {tasks.length}</span>
        </div>
        {filtered.length === 0 ? (
          <div className="py-14 text-center">
            <Calendar className="mx-auto h-6 w-6 text-muted-foreground/60" />
            <h3 className="mt-3 text-sm font-semibold text-foreground">No tasks found</h3>
            <p className="mt-1 text-sm text-muted-foreground">Try adjusting your filters or create a new task</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {filtered.map((task) => {
              const overdue = isOverdue(task)
              const progress = Math.min(Math.max(Number(task.progress) || 0, 0), 100)
              return (
                <li key={task._id}>
                  <button type="button" onClick={() => navigate(`/tasks/${task._id}`)}
                    className="flex w-full flex-col sm:flex-row items-start justify-between gap-2 sm:gap-6 px-4 sm:px-6 py-4 text-left transition-colors hover:bg-muted/50">
                    <div className="min-w-0 w-full">
                      <p className="truncate text-sm font-medium text-foreground">{task.title}</p>
                      {task.description && <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{task.description}</p>}
                      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[task.priority] || 'bg-slate-300'}`} aria-hidden="true" />{formatLabel(task.priority, 'medium')} priority</span>
                        <span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[task.status] || 'bg-slate-300'}`} aria-hidden="true" />{formatLabel(task.status, 'pending')}</span>
                        <span>{formatLabel(task.category, 'general')}</span>
                        {task.caseId && <span>Case <span className="text-foreground">{task.caseId.caseNumber || task.caseId.caseId}{task.caseId.clientName ? ` · ${task.caseId.clientName}` : ''}</span></span>}
                        <span className="tabular-nums">Progress <span className="text-foreground">{progress}%</span></span>
                      </p>
                    </div>
                    <div className="shrink-0 sm:text-right text-xs tabular-nums">
                      <p className={overdue ? 'font-medium text-destructive' : 'text-muted-foreground'}>{task.dueDate ? `Due ${formatDate(task.dueDate)}` : 'No due date'}</p>
                      {overdue && <p className="mt-1 text-destructive">Overdue</p>}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
