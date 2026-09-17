import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, CheckCircle2, Plus } from 'lucide-react'
import { tasksApi } from '../../services/api'
import NewTaskModal from '../../components/NewTaskModal'

const STATUS_OPTIONS = ['pending', 'in_progress', 'waiting', 'blocked', 'completed']

const PRIORITY_TONE = {
  urgent: 'badge-danger',
  high: 'badge-warning',
  medium: 'badge-info',
  low: 'badge-neutral',
}

export default function TasksPage() {
  const [tasks, setTasks] = useState(null)
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState(null)
  const [showNewTask, setShowNewTask] = useState(false)

  const load = useCallback(
    () =>
      tasksApi
        .myTasks()
        .then(({ data }) => setTasks(data.items || data.data || data.tasks || []))
        .catch((err) => setError(err.response?.data?.message || 'Could not load your tasks.')),
    []
  )

  useEffect(() => { load() }, [load])

  const updateStatus = async (task, status) => {
    setSavingId(task._id)
    try {
      await tasksApi.updateStatus(task._id, status)
      await load()
    } catch {
      setError('That update failed. Please try again.')
    } finally {
      setSavingId(null)
    }
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!tasks) return <Loader2 className="w-6 h-6 animate-spin text-primary" />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground font-serif">Tasks</h1>
        <button onClick={() => setShowNewTask(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          New Task
        </button>
      </div>

      {showNewTask && (
        <NewTaskModal
          onClose={() => setShowNewTask(false)}
          onCreated={() => {
            setShowNewTask(false)
            load()
          }}
        />
      )}

      <div className="card !p-0">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <CheckCircle2 className="w-8 h-8 text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">No tasks assigned to you.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {tasks.map((task) => (
              <li key={task._id} className="px-5 py-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{task.title}</p>
                  {task.description && <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>}
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {task.caseId && (
                      <Link to={`/cases/${task.caseId._id || task.caseId}/overview`} className="text-xs font-medium text-primary hover:underline">
                        {task.caseId.caseNumber || task.caseId.caseId || 'Case'}
                      </Link>
                    )}
                    {task.priority && <span className={`badge capitalize ${PRIORITY_TONE[task.priority] || 'badge-neutral'}`}>{task.priority}</span>}
                    {task.dueDate && (
                      <span className="text-xs text-muted-foreground">Due {new Date(task.dueDate).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>

                <label htmlFor={`status-${task._id}`} className="sr-only">Status</label>
                <select
                  id={`status-${task._id}`}
                  value={task.status}
                  disabled={savingId === task._id}
                  onChange={(event) => updateStatus(task, event.target.value)}
                  className="input-field w-auto shrink-0 capitalize"
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
