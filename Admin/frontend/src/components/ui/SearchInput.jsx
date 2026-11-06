import { useRef } from 'react'
import { Search, X } from 'lucide-react'

// A search box with a cross to clear it (also: Escape clears). The cross only shows while there is text.
export default function SearchInput({ value, onChange, placeholder = 'Search…', className = '' }) {
  const inputRef = useRef(null)
  const clear = () => { onChange(''); inputRef.current?.focus() }
  return (
    <div className={`relative ${className}`}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape' && value) { e.preventDefault(); onChange('') } }}
        placeholder={placeholder}
        className="input-field pl-9 pr-9"
      />
      {value ? (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          title="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  )
}
