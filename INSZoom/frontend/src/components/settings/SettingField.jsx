import { useState } from 'react'
import { X } from 'lucide-react'

// Renders one settings-v2 registry entry, by `entry.type`. Deliberately
// reuses this app's EXISTING form conventions (`.input-field`, plain
// checkbox + label, same as the old Settings.jsx notifyOn* fields) rather
// than introducing a new "toggle switch" component — this is the smallest
// visual delta from what INSZoom already looks like.
export default function SettingField({ entry, value, onChange, error, disabled }) {
  if (entry.type === 'secretRef') {
    return (
      <div>
        <FieldLabel entry={entry} />
        <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-sm">
          <span className={`inline-block h-2 w-2 rounded-full ${value?.configured ? 'bg-green-500' : 'bg-red-400'}`} />
          <span className="text-muted-foreground">
            {value?.configured ? 'Configured' : 'Not configured'} — env var <code className="font-mono">{value?.envVar}</code>
          </span>
        </div>
      </div>
    )
  }

  if (entry.readOnly) {
    return (
      <div>
        <FieldLabel entry={entry} />
        <p className="text-sm text-muted-foreground italic">{JSON.stringify(value)}</p>
      </div>
    )
  }

  if (entry.type === 'boolean') {
    return (
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id={entry.key}
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="w-4 h-4 text-blue-600 rounded"
        />
        <label htmlFor={entry.key} className="text-sm text-foreground">{entry.label}</label>
        {entry.description && <span className="text-xs text-muted-foreground">— {entry.description}</span>}
      </div>
    )
  }

  if (entry.type === 'number') {
    return (
      <div>
        <FieldLabel entry={entry} />
        <input
          id={entry.key}
          type="number"
          value={value ?? ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className="input-field"
        />
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    )
  }

  if (entry.type === 'enum') {
    return (
      <div>
        <FieldLabel entry={entry} />
        <select id={entry.key} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="input-field">
          {(entry.enumValues || []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </div>
    )
  }

  if (entry.type === 'color') {
    return (
      <div>
        <FieldLabel entry={entry} />
        <div className="flex items-center gap-3">
          <input type="color" value={value || '#000000'} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="h-9 w-14 rounded border border-input cursor-pointer" />
          <input id={entry.key} type="text" value={value || ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="input-field w-32" />
        </div>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    )
  }

  if (entry.type === 'stringArray') {
    return <TagArrayField entry={entry} value={value} onChange={onChange} disabled={disabled} />
  }

  if (entry.type === 'json') {
    return (
      <div>
        <FieldLabel entry={entry} />
        <textarea
          id={entry.key}
          rows={4}
          value={typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2)}
          disabled={disabled}
          onChange={(e) => {
            try { onChange(JSON.parse(e.target.value)) } catch { /* keep raw text until valid JSON */ }
          }}
          className="input-field font-mono text-xs"
        />
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    )
  }

  // string (default) — long text fields (descriptions mentioning "message"/
  // "note"/"text") get a textarea, everything else a single-line input. No
  // rich text editor library was added — none of INSZoom's dependencies
  // include one (checked before writing this), so a styled textarea is used
  // for the long-form fields the spec calls "rich text".
  const isLong = /message|note|text|signature|address/i.test(entry.key) || (value && value.length > 80)
  return (
    <div>
      <FieldLabel entry={entry} />
      {isLong ? (
        <textarea id={entry.key} rows={3} value={value || ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="input-field" />
      ) : (
        <input id={entry.key} type="text" value={value || ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="input-field" />
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

function FieldLabel({ entry }) {
  return (
    <label htmlFor={entry.key} className="block text-sm font-medium text-muted-foreground mb-1.5">
      {entry.label}
      {entry.description && <span className="block text-xs font-normal text-muted-foreground/70 mt-0.5">{entry.description}</span>}
    </label>
  )
}

function TagArrayField({ entry, value, onChange, disabled }) {
  const [draft, setDraft] = useState('')
  const tags = Array.isArray(value) ? value : []
  const addTag = () => {
    const trimmed = draft.trim()
    if (trimmed && !tags.includes(trimmed)) onChange([...tags, trimmed])
    setDraft('')
  }
  return (
    <div>
      <FieldLabel entry={entry} />
      <div className="flex flex-wrap gap-2 mb-2">
        {tags.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs text-foreground">
            {tag}
            {!disabled && (
              <button type="button" onClick={() => onChange(tags.filter((t) => t !== tag))} className="cursor-pointer">
                <X className="w-3 h-3" />
              </button>
            )}
          </span>
        ))}
      </div>
      {!disabled && (
        <input
          type="text"
          value={draft}
          placeholder="Type and press Enter"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
          className="input-field"
        />
      )}
    </div>
  )
}
