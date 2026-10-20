// Shared look for task statuses and priorities: a small coloured dot beside the name, never a filled pill.
export const STATUS_DOT = {
  pending: 'bg-slate-400',
  assigned: 'bg-sky-500',
  in_progress: 'bg-indigo-500',
  waiting: 'bg-amber-500',
  blocked: 'bg-red-500',
  completed: 'bg-emerald-500',
  cancelled: 'bg-slate-300'
}

export const PRIORITY_DOT = { low: 'bg-slate-400', medium: 'bg-sky-500', high: 'bg-amber-500', urgent: 'bg-red-500' }

export const formatLabel = (value, fallback = '') =>
  String(value || fallback).split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
