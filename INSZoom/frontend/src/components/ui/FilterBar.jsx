// Thin layout wrapper for a row of search/filter controls - purely
// presentational, does not own filter state. Pages keep their existing
// filter `<select>`s/handlers; this just gives them consistent spacing.
export default function FilterBar({ children, className = '' }) {
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      {children}
    </div>
  )
}

export function FilterSelect({ value, onChange, options, className = '' }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`input-field !w-auto ${className}`}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  )
}
