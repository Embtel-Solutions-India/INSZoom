import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'
import { Search, Plus, Users, ArrowLeft } from 'lucide-react'
import { STATUS_DOT, PRIORITY_DOT, formatLabel } from '../components/tasks/taskStyle'

const CONTROL = 'rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring'

const TeamTasks = () => {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [tasks, setTasks] = useState([])
  const [filteredTasks, setFilteredTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filters, setFilters] = useState({
    status: '',
    priority: '',
    category: '',
    assignedTo: '',
    search: ''
  })

  useEffect(() => {
    fetchTeamTasks()
  }, [user?.role])

  useEffect(() => {
    applyFilters()
  }, [tasks, filters])

  const fetchTeamTasks = async () => {
    try {
      setLoading(true)
      const response = await api.get('/tasks/team-tasks')
      setTasks(Array.isArray(response.data?.tasks) ? response.data.tasks : [])
      setError(null)
    } catch (error) {
      console.error('Error fetching team tasks:', error)
      setError('Failed to load team tasks')
    } finally {
      setLoading(false)
    }
  }

  const applyFilters = () => {
    let filtered = Array.isArray(tasks) ? [...tasks] : []

    if (filters.status) {
      filtered = filtered.filter(task => task.status === filters.status)
    }

    if (filters.priority) {
      filtered = filtered.filter(task => task.priority === filters.priority)
    }

    if (filters.category) {
      filtered = filtered.filter(task => task.category === filters.category)
    }

    if (filters.assignedTo) {
      filtered = filtered.filter(task => task.assignedTo?._id === filters.assignedTo)
    }

    if (filters.search) {
      const searchLower = filters.search.toLowerCase()
      filtered = filtered.filter(task =>
        String(task.title || '').toLowerCase().includes(searchLower) ||
        (task.description && task.description.toLowerCase().includes(searchLower))
      )
    }

    setFilteredTasks(filtered)
  }

  const isOverdue = (dueDate) => {
    if (!dueDate) return false
    const parsed = new Date(dueDate)
    return !Number.isNaN(parsed.getTime()) && parsed < new Date()
  }

  const formatStatus = (status) => formatLabel(status, 'pending')

  const formatDate = (date) => {
    if (!date) return 'Not set'
    const parsed = new Date(date)
    if (Number.isNaN(parsed.getTime())) return 'Not set'
    return parsed.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    )
  }

  const overdueCount = tasks.filter(t => isOverdue(t.dueDate) && t.status !== 'completed').length
  const summary = [
    { label: 'Total tasks', value: tasks.length },
    { label: 'In progress', value: tasks.filter(t => t.status === 'in_progress').length },
    { label: 'Completed', value: tasks.filter(t => t.status === 'completed').length },
    { label: 'Overdue', value: overdueCount, bad: overdueCount > 0 }
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/tasks')}
            className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Back to task dashboard"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Team tasks</h1>
            <p className="mt-1 text-sm text-muted-foreground">Monitor and manage tasks across your team</p>
          </div>
        </div>
        <button
          onClick={() => navigate('/tasks/create')}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Create task
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Key figures */}
      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-4 [&>*]:border-border [&>*:nth-child(even)]:border-l [&>*:nth-child(n+3)]:border-t lg:[&>*]:border-t-0 lg:[&>*:not(:first-child)]:border-l">
        {summary.map(({ label, value, bad }) => (
          <div key={label} className="px-6 py-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className={`mt-1.5 text-2xl font-semibold tabular-nums tracking-tight ${bad ? 'text-red-600' : 'text-foreground'}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search team tasks..."
            value={filters.search}
            onChange={(e) => handleFilterChange('search', e.target.value)}
            className={`${CONTROL} w-full pl-9`}
          />
        </div>

        <select value={filters.assignedTo} onChange={(e) => handleFilterChange('assignedTo', e.target.value)} className={CONTROL}>
          <option value="">All team members</option>
          {(tasks || [])
            .map(task => task.assignedTo)
            .filter(member => member?._id)
            .filter((member, index, members) => members.findIndex(item => item._id === member._id) === index)
            .map(member => (
              <option key={member._id} value={member._id}>{member.name || member.displayName || member.email || 'Team member'}</option>
            ))}
        </select>

        <select value={filters.status} onChange={(e) => handleFilterChange('status', e.target.value)} className={CONTROL}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="assigned">Assigned</option>
          <option value="in_progress">In Progress</option>
          <option value="waiting">Waiting</option>
          <option value="completed">Completed</option>
        </select>

        <select value={filters.priority} onChange={(e) => handleFilterChange('priority', e.target.value)} className={CONTROL}>
          <option value="">All priorities</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        <select value={filters.category} onChange={(e) => handleFilterChange('category', e.target.value)} className={CONTROL}>
          <option value="">All categories</option>
          <option value="case_preparation">Case Preparation</option>
          <option value="document_review">Document Review</option>
          <option value="legal_review">Legal Review</option>
          <option value="expert_letter">Expert Letter</option>
          <option value="filing">Filing</option>
          <option value="rfe_response">RFE Response</option>
          <option value="follow_up">Follow Up</option>
          <option value="administrative">Administrative</option>
          <option value="finance">Finance</option>
          <option value="client_communication">Client Communication</option>
        </select>

        <button
          onClick={() => setFilters({ status: '', priority: '', category: '', assignedTo: '', search: '' })}
          className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          Clear filters
        </button>
      </div>

      {/* Team tasks list */}
      <section className="rounded-xl border border-border bg-card">
        <div className="flex items-baseline justify-between border-b border-border px-6 py-4">
          <h3 className="text-sm font-semibold text-foreground">Tasks</h3>
          <span className="text-xs tabular-nums text-muted-foreground">{filteredTasks.length} of {tasks.length}</span>
        </div>
        {filteredTasks.length === 0 ? (
          <div className="py-14 text-center">
            <Users className="mx-auto h-6 w-6 text-muted-foreground/60" />
            <h3 className="mt-3 text-sm font-semibold text-foreground">No team tasks found</h3>
            <p className="mt-1 text-sm text-muted-foreground">Try adjusting your filters or create a new task</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {filteredTasks.map(task => {
              const overdue = isOverdue(task.dueDate) && task.status !== 'completed' && task.status !== 'cancelled'
              const progress = Math.min(Math.max(Number(task.progress) || 0, 0), 100)
              return (
                <li key={task._id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/tasks/${task._id}`)}
                    className="flex w-full items-start justify-between gap-6 px-6 py-4 text-left transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{task.title}</p>
                      {task.description && (
                        <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{task.description}</p>
                      )}
                      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${PRIORITY_DOT[task.priority] || 'bg-slate-300'}`} aria-hidden="true" />{formatLabel(task.priority, 'medium')} priority</span>
                        <span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[task.status] || 'bg-slate-300'}`} aria-hidden="true" />{formatStatus(task.status)}</span>
                        <span>{formatLabel(task.category, 'general')}</span>
                      </p>
                      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>Assigned to <span className="text-foreground">{task.assignedTo?.name || task.assignedTo?.displayName || 'Unassigned'}</span></span>
                        {task.caseId && <span>Case <span className="text-foreground">{task.caseId.caseNumber} · {task.caseId.clientName}</span></span>}
                        <span className="tabular-nums">Progress <span className="text-foreground">{progress}%</span></span>
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-xs tabular-nums">
                      <p className={overdue ? 'font-medium text-red-600' : 'text-muted-foreground'}>{task.dueDate ? `Due ${formatDate(task.dueDate)}` : 'No due date'}</p>
                      {overdue && <p className="mt-1 text-red-600">Overdue</p>}
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

export default TeamTasks
