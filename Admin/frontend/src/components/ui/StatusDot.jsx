// A quiet status marker: a small coloured dot and neutral text (the dot carries the state, not a coloured pill).
export default function StatusDot({ color = '#94A3B8', children, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-foreground ${className}`}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
      {children}
    </span>
  )
}
