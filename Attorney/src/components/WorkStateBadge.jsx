// The attorney's own working state on a case (not the staff-owned case status):
// assigned = nothing done yet, active = they have done something on it, reviewed = they marked review complete.
export const WORK_STATE = {
  assigned: { label: 'Assigned', tone: 'badge-neutral' },
  active: { label: 'Active', tone: 'badge-success' },
  reviewed: { label: 'Review complete', tone: 'badge-info' },
}

// The case's own status is only worth showing next to the work state when it says something more than "this case is in play".
const ROUTINE_CASE_STATUS = ['assigned', 'active', 'pending_assignment', 'pending', '']
export const isNotableCaseStatus = (status) => !ROUTINE_CASE_STATUS.includes(String(status || ''))

export default function WorkStateBadge({ state }) {
  const entry = WORK_STATE[state] || WORK_STATE.assigned
  return <span className={`badge ${entry.tone}`}>{entry.label}</span>
}
