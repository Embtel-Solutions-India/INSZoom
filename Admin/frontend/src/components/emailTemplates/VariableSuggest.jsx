import { forwardRef, useState } from 'react'

// Type-ahead for [variables]: typing "[" (optionally followed by part of a
// name, e.g. "[cli" or "[client.n") offers the matching variables from the
// central registry. Shared by the subject/heading inputs and the body editor.
const OPEN_TOKEN_RE = /\[([a-z_.]*)$/

// Returns { query, length } when the text before the caret ends in an
// unfinished "[token", else null. `length` is how many characters to replace.
export function findOpenToken(textBeforeCaret) {
  const match = OPEN_TOKEN_RE.exec(textBeforeCaret || '')
  return match ? { query: match[1], length: match[0].length } : null
}

export function filterVariables(variables, query, limit = 8) {
  const q = (query || '').toLowerCase()
  return variables
    .filter((variable) => !variable.advanced && (!q || variable.key.includes(q) || variable.label.toLowerCase().includes(q)))
    .slice(0, limit)
}

export function SuggestMenu({ items, activeIndex, onPick, style, className = '' }) {
  if (!items.length) return null
  return (
    <div role="listbox" aria-label="Variables" style={style} className={`z-40 w-72 rounded-xl border border-border bg-popover py-1 shadow-lg ${className}`}>
      {items.map((variable, index) => (
        <button
          key={variable.key}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          // mousedown (not click) keeps focus - and the caret - in the field
          onMouseDown={(e) => { e.preventDefault(); onPick(variable) }}
          className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left ${index === activeIndex ? 'bg-secondary' : 'hover:bg-secondary'}`}
        >
          <span className="min-w-0">
            <span className="block truncate text-sm text-foreground">{variable.label}</span>
            <span className="block truncate text-[11px] text-muted-foreground">e.g. {variable.sample}</span>
          </span>
          <code className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">[{variable.key}]</code>
        </button>
      ))}
    </div>
  )
}

// Keyboard handling shared by both surfaces. Returns true when it consumed the key.
export function handleSuggestKey(event, { items, activeIndex, setActiveIndex, onPick, close }) {
  if (!items.length) return false
  if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((activeIndex + 1) % items.length); return true }
  if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((activeIndex - 1 + items.length) % items.length); return true }
  if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); onPick(items[activeIndex] || items[0]); return true }
  if (event.key === 'Escape') { event.preventDefault(); close(); return true }
  return false
}

// <input> with the type-ahead attached. Behaves like a normal controlled
// input (value / onChange(value)); the forwarded ref is the real <input>.
export const VariableInput = forwardRef(function VariableInput({ value, onChange, variables, className, onFocus, ...rest }, ref) {
  const [token, setToken] = useState(null) // { query, length } | null
  const [activeIndex, setActiveIndex] = useState(0)
  const items = token ? filterVariables(variables, token.query) : []

  const detect = (input) => {
    const caret = input.selectionStart ?? input.value.length
    setToken(findOpenToken(input.value.slice(0, caret)))
    setActiveIndex(0)
  }

  const pick = (variable) => {
    const input = ref?.current
    if (!input || !token) return
    const caret = input.selectionStart ?? input.value.length
    const start = caret - token.length
    const insert = `[${variable.key}]`
    onChange(input.value.slice(0, start) + insert + input.value.slice(caret))
    setToken(null)
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(start + insert.length, start + insert.length) })
  }

  return (
    <div className="relative">
      <input
        {...rest}
        ref={ref}
        value={value}
        className={className}
        autoComplete="off"
        onChange={(e) => { onChange(e.target.value); detect(e.target) }}
        onKeyDown={(e) => { handleSuggestKey(e, { items, activeIndex, setActiveIndex, onPick: pick, close: () => setToken(null) }) }}
        onKeyUp={(e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) detect(e.target) }}
        onClick={(e) => detect(e.target)}
        onFocus={onFocus}
        onBlur={() => setToken(null)}
      />
      <SuggestMenu items={items} activeIndex={activeIndex} onPick={pick} className="absolute left-0 top-full mt-1" />
    </div>
  )
})
