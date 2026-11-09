import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Target, Trophy, Plus, X, Check, Loader2, Pencil, Sparkles } from 'lucide-react'
import api from '../services/api'
import { announceEverydayChange } from '../utils/everyday'

// "Everyday plan" (left) and "Everyday report" (right) - the signed-in person's OWN current work day. Each side is a numbered list of points. The two sections
// carry ids so the reminder boxes can open the page straight at the one to write (?section=plan | report).
const SECTIONS = {
  plan: {
    title: 'Everyday plan',
    hint: "What you will work on today",
    emptyTitle: "Set your today's goal",
    emptyText: 'Write the goals you want to finish today, one point each.',
    placeholder: 'Write a goal',
    field: 'planItems',
    Icon: Target,
    tone: 'text-amber-700 bg-amber-400/15 dark:text-amber-300',
    card: 'border-amber-400/25 bg-amber-400/[0.07]',
    bullet: 'bg-amber-400/15 text-amber-800 dark:text-amber-200',
  },
  report: {
    title: 'Everyday report',
    hint: 'What you achieved today',
    emptyTitle: 'Your achieved goals will show here',
    emptyText: 'At the end of the day, write what you achieved, one point each.',
    placeholder: 'Write what you achieved',
    field: 'reportItems',
    Icon: Trophy,
    tone: 'text-green-700 bg-green-400/15 dark:text-green-300',
    card: 'border-green-400/25 bg-green-400/[0.07]',
    bullet: 'bg-green-400/15 text-green-800 dark:text-green-200',
  },
}

function Section({ kind, items, saving, onSave, focusSignal }) {
  const cfg = SECTIONS[kind]
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState([''])
  const [error, setError] = useState('')
  const refs = useRef([])
  const rootRef = useRef(null)

  const startEdit = useCallback(() => {
    setDraft(items.length ? [...items] : [''])
    setError('')
    setEditing(true)
  }, [items])

  // Opened from a reminder box: scroll to this section and start writing.
  useEffect(() => {
    if (!focusSignal) return
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    startEdit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSignal])

  useEffect(() => {
    if (editing) refs.current[Math.max(0, draft.length - 1)]?.focus?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  const setPoint = (index, value) => setDraft((list) => list.map((entry, i) => (i === index ? value : entry)))
  const addPoint = (after = draft.length - 1) => {
    setDraft((list) => [...list.slice(0, after + 1), '', ...list.slice(after + 1)])
    setTimeout(() => refs.current[after + 1]?.focus?.(), 0)
  }
  const removePoint = (index) => setDraft((list) => (list.length > 1 ? list.filter((_, i) => i !== index) : ['']))

  const save = async () => {
    const points = draft.map((entry) => entry.trim()).filter(Boolean)
    try {
      setError('')
      await onSave(cfg.field, points)
      setEditing(false)
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Could not save')
    }
  }

  const { Icon } = cfg
  return (
    <section ref={rootRef} id={`everyday-${kind}`} data-testid={`everyday-${kind}`} className={`flex min-h-[16rem] flex-col rounded-xl border ${cfg.card}`}>
      <header className="flex items-center justify-between gap-3 border-b border-black/5 px-4 py-3 sm:px-5 dark:border-white/10">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${cfg.tone}`}><Icon className="h-5 w-5" /></span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">{cfg.title}</h2>
            <p className="text-xs text-muted-foreground">{cfg.hint}</p>
          </div>
        </div>
        {!editing && items.length > 0 && (
          <button type="button" onClick={startEdit} aria-label="Edit" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-sm font-medium text-foreground hover:bg-secondary sm:px-3">
            <Pencil className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Edit</span>
          </button>
        )}
      </header>

      <div className="min-w-0 flex-1 px-4 py-4 sm:px-5">
        {editing ? (
          <div className="space-y-2">
            {draft.map((value, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-right text-sm font-medium text-muted-foreground">{index + 1}.</span>
                <input
                  ref={(node) => { refs.current[index] = node }}
                  value={value}
                  maxLength={500}
                  placeholder={cfg.placeholder}
                  aria-label={`${cfg.title} point ${index + 1}`}
                  onChange={(event) => setPoint(index, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); addPoint(index) }
                    if (event.key === 'Backspace' && !value && draft.length > 1) { event.preventDefault(); removePoint(index); setTimeout(() => refs.current[Math.max(0, index - 1)]?.focus?.(), 0) }
                  }}
                  className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button type="button" onClick={() => removePoint(index)} aria-label="Remove point" className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => addPoint()} className="ml-8 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:opacity-80">
              <Plus className="h-4 w-4" /> Add point
            </button>
            {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditing(false)} disabled={saving} className="btn-secondary">Cancel</button>
              <button type="button" onClick={save} disabled={saving} className="btn-primary inline-flex items-center gap-2 disabled:opacity-60">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
              </button>
            </div>
          </div>
        ) : items.length ? (
          <ol className="space-y-2.5">
            {items.map((entry, index) => (
              <li key={index} className="flex gap-3 text-sm text-foreground">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${cfg.bullet}`}>{index + 1}</span>
                <span className="min-w-0 break-words pt-0.5">{entry}</span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-6 text-center">
            <span className={`flex h-12 w-12 items-center justify-center rounded-full ${cfg.tone}`}><Sparkles className="h-6 w-6" /></span>
            <div>
              <p className="font-semibold text-foreground">{cfg.emptyTitle}</p>
              <p className="mt-1 text-sm text-muted-foreground">{cfg.emptyText}</p>
            </div>
            <button type="button" onClick={startEdit} className="btn-primary inline-flex items-center gap-2">
              <Plus className="h-4 w-4" /> {kind === 'plan' ? 'Write goals' : 'Write achievements'}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

export { SECTIONS as EVERYDAY_SECTIONS }

export default function EverydayPlanReport() {
  const location = useLocation()
  const [mine, setMine] = useState({ planItems: [], reportItems: [] })
  const [loaded, setLoaded] = useState(false)
  const [forbidden, setForbidden] = useState(false)
  const [saving, setSaving] = useState('')
  const [focus, setFocus] = useState({ plan: 0, report: 0 })
  const lastSection = useRef('')

  const load = useCallback(async () => {
    try {
      const response = await api.get('/reports/everyday/me')
      setMine(response.data.data)
    } catch (error) {
      if (error.response?.status === 403) setForbidden(true)
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // ?section=plan|report (from a reminder box): open that section for writing. The page can stay mounted, so this follows the URL.
  useEffect(() => {
    if (!loaded) return
    const section = new URLSearchParams(location.search).get('section')
    if (!['plan', 'report'].includes(section)) { lastSection.current = ''; return }
    const key = `${section}|${location.key}`
    if (lastSection.current === key) return
    lastSection.current = key
    setFocus((current) => ({ ...current, [section]: current[section] + 1 }))
  }, [loaded, location.search, location.key])

  const save = async (field, items) => {
    setSaving(field)
    try {
      const response = await api.put('/reports/everyday/me', { [field]: items })
      setMine(response.data.data)
      announceEverydayChange()
    } finally {
      setSaving('')
    }
  }

  if (forbidden) return null
  return (
    <div className="space-y-3" data-testid="everyday-today">
      <div>
        <h2 className="text-lg font-bold text-foreground">Today</h2>
        <p className="text-sm text-muted-foreground">Write your own goals and achievements for today. Everyone on the team can read them.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section kind="plan" items={mine.planItems || []} saving={saving === 'planItems'} onSave={save} focusSignal={focus.plan} />
        <Section kind="report" items={mine.reportItems || []} saving={saving === 'reportItems'} onSave={save} focusSignal={focus.report} />
      </div>
    </div>
  )
}

// Read-only, side by side: another person's (or one's own past) plan and report. Used first thing in the EOD report "View".
export function EverydayReadOnly({ planItems = [], reportItems = [], loading = false }) {
  const columns = [
    { kind: 'plan', items: planItems },
    { kind: 'report', items: reportItems },
  ]
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="everyday-readonly">
      {columns.map(({ kind, items }) => {
        const cfg = SECTIONS[kind]
        const { Icon } = cfg
        return (
          <div key={kind} className={`rounded-xl border p-4 ${cfg.card}`} data-testid={`everyday-view-${kind}`}>
            <div className="mb-3 flex items-center gap-2.5">
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${cfg.tone}`}><Icon className="h-4 w-4" /></span>
              <h4 className="font-semibold text-foreground">{cfg.title}</h4>
            </div>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : items.length ? (
              <ol className="space-y-2">
                {items.map((entry, index) => (
                  <li key={index} className="flex gap-2.5 text-sm text-foreground">
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-semibold ${cfg.bullet}`}>{index + 1}</span>
                    <span className="min-w-0 break-words">{entry}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">{kind === 'plan' ? 'No goals were set for this day.' : 'No achievements were written for this day.'}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
