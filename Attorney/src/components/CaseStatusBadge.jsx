// Same .badge-* component classes (src/index.css) every portal uses.
const TONE = {
  active: 'badge-success',
  in_progress: 'badge-warning',
  on_hold: 'badge-warning',
  pending: 'badge-warning',
  closed: 'badge-neutral',
  completed: 'badge-info',
  cancelled: 'badge-danger',
  rejected: 'badge-danger',
}

export default function CaseStatusBadge({ status }) {
  const label = String(status || 'unknown').replace(/_/g, ' ')
  return <span className={`badge capitalize ${TONE[status] || 'badge-neutral'}`}>{label}</span>
}
