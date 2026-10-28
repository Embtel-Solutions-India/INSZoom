import { useState, useEffect, useRef, useMemo } from 'react'
import { ChevronDown, Search } from 'lucide-react'

// A drop-down for long option labels: the list wraps each label onto as many lines as it needs (a native <select> clips them to the width of
// the field) and can be searched. Keeps native form validation through a hidden `required` input, so a parent <form> behaves as before.
// options: [{ value, label, group? }] - an option's `group` is shown once, as a small grey heading, above the first option of that group.
export default function WrappingSelect({ value, onChange, options, placeholder = 'Select…', required = false, disabled = false, className = '' }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef(null)
  const selected = options.find((option) => option.value === value)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => { if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false) }
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? options.filter((option) => String(option.label).toLowerCase().includes(needle)) : options
  }, [options, query])

  const pick = (option) => {
    onChange(option.value)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
      >
        <span className={`whitespace-normal break-words ${selected ? '' : 'text-muted-foreground'}`}>{selected ? selected.label : placeholder}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {required && <input tabIndex={-1} aria-hidden="true" required value={value || ''} onChange={() => {}} className="pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-0" />}
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-card shadow-lg">
          <div className="relative border-b border-border p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (visible[0]) pick(visible[0]) } }}
              placeholder="Search…"
              className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
            {visible.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No match</li>}
            {visible.map((option, index) => (
              <li key={option.value}>
                {option.group && option.group !== visible[index - 1]?.group && (
                  <p className={`border-b border-border/60 bg-muted px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground ${index > 0 ? 'mt-1 border-t' : ''}`}>{option.group}</p>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  onClick={() => pick(option)}
                  className={`block w-full whitespace-normal break-words px-3 py-2 text-left text-sm transition-colors hover:bg-secondary ${option.value === value ? 'bg-primary/10 font-medium text-primary' : 'text-foreground'}`}
                >
                  {option.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
