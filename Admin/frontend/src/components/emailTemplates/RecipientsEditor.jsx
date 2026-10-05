import { useState } from 'react'
import { X, Plus } from 'lucide-react'

// To / CC / BCC rules. Role rows are resolved from the live case when the
// email is actually sent - only a "custom address" ever stores an address.
const LISTS = [
  { key: 'to', label: 'To', hint: 'Leave empty to send to the email\'s usual recipient.' },
  { key: 'cc', label: 'CC' },
  { key: 'bcc', label: 'BCC' },
]
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

// Anything typed here is a literal address or ONE email variable like [client.email].

function RuleList({ list, rules, recipientTypes, emailVariables, onChange }) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const roleTypes = recipientTypes.filter((entry) => entry.type !== 'custom')
  const has = (type) => rules.some((rule) => rule.type === type)
  const toggle = (type) => onChange(has(type) ? rules.filter((rule) => rule.type !== type) : [...rules, { type }])
  const customs = rules.filter((rule) => rule.type === 'custom')
  // Typing "[" (or part of a variable name) offers the email variables.
  const needle = draft.trim().toLowerCase().replace(/^\[/, '')
  const suggestions = draft.trim().startsWith('[')
    ? emailVariables.filter((variable) => variable.key.includes(needle.replace(/\]$/, '')) && !customs.some((rule) => rule.value === `[${variable.key}]`))
    : []
  const pick = (token) => { onChange([...rules, { type: 'custom', value: token }]); setDraft(''); setError('') }

  const addCustom = () => {
    const value = draft.trim().toLowerCase()
    if (!value) return
    if (!EMAIL_RE.test(value) && !emailVariables.some((variable) => `[${variable.key}]` === value)) {
      setError(value.startsWith('[') ? 'That variable is not an email variable — pick one from the list' : 'Enter a valid email address or a variable like [client.email]')
      return
    }
    if (customs.some((rule) => rule.value === value)) { setDraft(''); return }
    onChange([...rules, { type: 'custom', value }])
    setDraft('')
    setError('')
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-sm font-semibold text-foreground">{list.label}</span>
        {list.hint && <span className="text-xs text-muted-foreground">{list.hint}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {roleTypes.map((entry) => (
          <button
            key={entry.type}
            type="button"
            onClick={() => toggle(entry.type)}
            aria-pressed={has(entry.type)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${has(entry.type)
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {customs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {customs.map((rule) => (
            <span key={rule.value} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs text-foreground">
              {rule.value}
              <button type="button" aria-label={`Remove ${rule.value}`} onClick={() => onChange(rules.filter((r) => r !== rule))} className="text-muted-foreground hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative mt-2">
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setError('') }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
            placeholder="Type an email, or [ to pick a variable like [client.email]"
            className="input-field !py-1.5 !text-sm"
          />
          <button type="button" onClick={addCustom} className="btn-secondary flex items-center gap-1 text-xs"><Plus className="h-3.5 w-3.5" /> Add</button>
        </div>
        {suggestions.length > 0 && (
          <div className="absolute left-0 right-16 z-20 mt-1 rounded-lg border border-border bg-popover py-1 shadow-lg">
            {suggestions.map((variable) => (
              <button
                key={variable.key}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pick(`[${variable.key}]`) }}
                className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-secondary"
              >
                <span className="text-foreground">{variable.label}</span>
                <code className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">[{variable.key}]</code>
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}

export default function RecipientsEditor({ recipients, recipientTypes, variables = [], onChange }) {
  const emailVariables = variables.filter((variable) => variable.email)
  return (
    <div className="space-y-3">
      {LISTS.map((list) => (
        <RuleList
          key={list.key}
          list={list}
          rules={recipients[list.key] || []}
          recipientTypes={recipientTypes}
          emailVariables={emailVariables}
          onChange={(rules) => onChange({ ...recipients, [list.key]: rules })}
        />
      ))}
    </div>
  )
}
