// Matches the reference portal's flat, neutral bordered pill style (no
// per-status background color) rather than the "traffic light" colored
// badges this component started as - the reference deliberately keeps
// color usage minimal/professional across the whole admin surface, and a
// case's stage/status is legible from its text alone, not its color.
// `stageColor`/`statusColor` are kept exported (now returning the single
// neutral class set regardless of input) so every existing call site that
// imported them keeps working without a second migration.
const NEUTRAL_PILL = 'border border-border text-foreground bg-transparent'

export function stageColor() {
  return NEUTRAL_PILL
}

export function statusColor() {
  return NEUTRAL_PILL
}

// `kind` is kept for call-site clarity/back-compat; both resolve to the
// same neutral style today. Pass a raw className via `color` for the rare
// one-off badge that genuinely needs to carry a color (e.g. a real
// paid/unpaid signal), matching the reference's own sparing use of color.
export default function StatBadge({ value, kind = 'status', color, className = '' }) {
  const resolved = color || NEUTRAL_PILL
  const label = typeof value === 'string' ? value.replace(/_/g, ' ') : value
  return (
    <span className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full capitalize ${resolved} ${className}`}>
      {label}
    </span>
  )
}
