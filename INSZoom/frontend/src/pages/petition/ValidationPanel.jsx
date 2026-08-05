import { AlertCircle, AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react'

const STATUS_META = {
  passed: { label: 'Ready to finalize', icon: CheckCircle2, tone: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  warnings: { label: 'Warnings present', icon: AlertTriangle, tone: 'text-amber-700 bg-amber-50 border-amber-200' },
  blocked: { label: 'Blocked — errors must be resolved', icon: AlertCircle, tone: 'text-red-700 bg-red-50 border-red-200' },
}

function IssueRow({ issue, onJump }) {
  const Icon = issue.severity === 'error' ? AlertCircle : AlertTriangle
  const tone = issue.severity === 'error' ? 'text-red-500' : 'text-amber-500'
  const clickable = Boolean(issue.sectionKey)
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => clickable && onJump(issue.sectionKey)}
      className={`flex w-full items-start gap-2 rounded-md border border-transparent px-2 py-2 text-left text-xs ${clickable ? 'hover:border-gray-200 hover:bg-gray-50' : 'cursor-default'}`}
    >
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone}`} />
      <span className="text-gray-700">{issue.message}</span>
    </button>
  )
}

// Right rail (§5.3): package-level validation status, errors/warnings with
// click-to-scroll (using the same sectionKey the canvas/outline key off of).
// The draft-letter-review acknowledgement itself happens in FinalizeModal
// (which already knows how to gate a "warnings" vs "blocked" status) rather
// than being duplicated here.
export default function ValidationPanel({ validation, onJump }) {
  if (!validation) {
    return (
      <aside className="w-72 shrink-0 border-l border-gray-200 bg-white p-4">
        <p className="text-xs text-gray-400">Validation not yet available.</p>
      </aside>
    )
  }

  const meta = STATUS_META[validation.status] || STATUS_META.blocked
  const StatusIcon = meta.icon
  const errors = (validation.issues || []).filter((i) => i.severity === 'error')
  const warnings = (validation.issues || []).filter((i) => i.severity === 'warning')

  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-gray-200 bg-white p-4">
      <div className={`mb-4 flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${meta.tone}`}>
        <StatusIcon className="h-4 w-4 shrink-0" />
        {meta.label}
      </div>

      {errors.length > 0 && (
        <div className="mb-4">
          <p className="mb-1 px-2 text-[0.68rem] font-bold uppercase tracking-wide text-red-500">Errors ({errors.length})</p>
          <div className="space-y-0.5">
            {errors.map((issue, idx) => <IssueRow key={idx} issue={issue} onJump={onJump} />)}
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="mb-4">
          <p className="mb-1 px-2 text-[0.68rem] font-bold uppercase tracking-wide text-amber-500">Warnings ({warnings.length})</p>
          <div className="space-y-0.5">
            {warnings.map((issue, idx) => <IssueRow key={idx} issue={issue} onJump={onJump} />)}
          </div>
        </div>
      )}

      {errors.length === 0 && warnings.length === 0 && (
        <p className="px-2 text-xs text-gray-400">No issues found.</p>
      )}

      <div className="mt-4 flex items-center gap-1.5 border-t border-gray-100 pt-3 text-[0.68rem] text-gray-400">
        <ShieldCheck className="h-3.5 w-3.5" />
        Validated {validation.validatedAt ? new Date(validation.validatedAt).toLocaleString() : '—'}
      </div>
    </aside>
  )
}
