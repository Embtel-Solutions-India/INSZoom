// Same task status/priority look as the Admin portal (Admin/frontend/src/components/tasks/taskStyle.js):
// a small coloured dot beside the name, never a filled pill.
export const STATUS_DOT = {
  pending: 'bg-slate-400',
  assigned: 'bg-sky-500',
  in_progress: 'bg-indigo-500',
  waiting: 'bg-amber-500',
  blocked: 'bg-red-500',
  completed: 'bg-emerald-500',
  cancelled: 'bg-slate-300',
}

export const PRIORITY_DOT = { low: 'bg-slate-400', medium: 'bg-sky-500', high: 'bg-amber-500', urgent: 'bg-red-500' }

export const formatLabel = (value, fallback = '') =>
  String(value || fallback).split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')

export const isOverdue = (task) => {
  if (!task?.dueDate || task.status === 'completed' || task.status === 'cancelled') return false
  const due = new Date(task.dueDate)
  return !Number.isNaN(due.getTime()) && due < new Date()
}

export const formatDate = (date) => {
  if (!date) return 'Not set'
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return 'Not set'
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
