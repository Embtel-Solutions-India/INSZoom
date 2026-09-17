// Shared card shell used across the redesigned Case Manager Portal pages.
// Wraps the existing global `.card` class (index.css) rather than
// reintroducing its own color/border/shadow values, so it stays visually
// consistent with any page still using the raw class directly.
export default function Card({ children, className = '', padded = true, ...rest }) {
  return (
    <div className={`card ${padded ? '' : '!p-0'} ${className}`} {...rest}>
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, action, className = '' }) {
  return (
    <div className={`flex items-start justify-between gap-3 mb-4 ${className}`}>
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-card-foreground truncate">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
