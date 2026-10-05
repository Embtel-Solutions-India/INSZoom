import { useEffect, useMemo, useRef, useState } from 'react'
import { Braces, Search } from 'lucide-react'

// Insert Variable menu. The variable list comes from the backend registry
// (GET /email-templates/meta) - never hardcoded here - and is narrowed to the
// groups the chosen trigger's call sites can actually supply.
export default function VariablePicker({ variables, groups, allowedGroups, onPick, targetLabel }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const close = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    return groups
      .filter((group) => group === 'System' || !allowedGroups || allowedGroups.includes(group))
      .map((group) => ({
        group,
        items: variables.filter((variable) => variable.group === group && !variable.advanced
          && (!q || variable.key.includes(q) || variable.label.toLowerCase().includes(q))),
      }))
      .filter((entry) => entry.items.length)
  }, [variables, groups, allowedGroups, query])

  return (
    <div className="relative" ref={rootRef}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="btn-secondary flex items-center gap-2 text-sm">
        <Braces className="w-4 h-4" /> Insert variable
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-2 w-80 rounded-xl border border-border bg-popover shadow-lg">
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search variables…" className="input-field !py-1.5 !pl-8 !text-sm" />
            </div>
            <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">Inserts into the {targetLabel} field.</p>
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {grouped.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">No matching variables</p>}
            {grouped.map(({ group, items }) => (
              <div key={group}>
                <p className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
                {items.map((variable) => (
                  <button
                    key={variable.key}
                    type="button"
                    // mousedown keeps the caret in the field we're inserting into
                    onMouseDown={(e) => { e.preventDefault(); onPick(`[${variable.key}]`); setOpen(false) }}
                    className="flex w-full items-center justify-between gap-3 px-4 py-1.5 text-left hover:bg-secondary"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-foreground">{variable.label}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">e.g. {variable.sample}</span>
                    </span>
                    <code className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">[{variable.key}]</code>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
