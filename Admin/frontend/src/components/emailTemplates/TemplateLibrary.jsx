import { useMemo, useState } from 'react'
import { Plus, Lock, Mail, BellRing } from 'lucide-react'
import SearchInput from '../ui/SearchInput'
import EmptyState, { LoadingState, ErrorState } from '../ui/EmptyState'

const AUDIENCE_LABEL = { client: 'Client', case_manager: 'Case Manager', team_lead: 'Team Lead', admin: 'Admin', super_admin: 'Super Admin', attorney: 'Attorney' }
const AUDIENCE_HELP = {
  client: 'Emails and alerts sent to the client on the case.',
  case_manager: 'Sent to the case manager assigned to the case.',
  team_lead: 'Sent to the team lead assigned to the case.',
  admin: 'Sent to administrators.',
  super_admin: 'Critical and system alerts only.',
  attorney: 'Sent to attorneys with access to the case.',
}
const RECIPIENT_LABEL = { client: 'Client', team_member: 'Internal team', attorney: 'Attorney' }
const STATUS_META = {
  default: { label: 'Built-in', className: 'bg-secondary text-muted-foreground' },
  active: { label: 'Active', className: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  draft: { label: 'Draft', className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  inactive: { label: 'Inactive', className: 'bg-secondary text-muted-foreground' },
  archived: { label: 'Archived', className: 'bg-secondary text-muted-foreground line-through' },
}
const STATUS_FILTERS = [
  ['all', 'All statuses'], ['active', 'Active'], ['draft', 'Draft'], ['inactive', 'Inactive'], ['default', 'Built-in (not customized)'], ['archived', 'Archived'],
]
const SORTS = [['name', 'Name (A–Z)'], ['updated', 'Recently updated'], ['category', 'Category']]

export default function TemplateLibrary({ rows, meta, loading, error, onRetry, onOpen, onCreate }) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [trigger, setTrigger] = useState('all')
  const [audience, setAudience] = useState('all')
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState('name')

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = rows.filter((row) => {
      if (status === 'all' ? row.status === 'archived' : row.status !== status) return false
      if (category !== 'all' && row.category !== category) return false
      if (trigger !== 'all' && row.triggerKey !== trigger) return false
      if (audience !== 'all' && row.audience !== audience) return false
      return !q || `${row.name} ${row.triggerLabel || ''} ${row.category} ${row.description || ''}`.toLowerCase().includes(q)
    })
    return filtered.sort((a, b) => {
      if (sort === 'updated') return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
      if (sort === 'category') return a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
      return a.name.localeCompare(b.name)
    })
  }, [rows, search, category, trigger, audience, status, sort])

  // One section per audience, in a fixed order; templates not attached to a trigger yet go last.
  const sections = useMemo(() => {
    const order = (meta?.audiences || []).map((a) => a.key)
    const known = new Set(order)
    const groups = [...order.map((key) => ({ key, label: AUDIENCE_LABEL[key] || key, description: AUDIENCE_HELP[key], rows: visible.filter((row) => row.audience === key) })),
      { key: 'other', label: 'Not attached to a trigger', description: 'Drafts that are not linked to an email yet.', rows: visible.filter((row) => !known.has(row.audience)) }]
    return groups.filter((group) => group.rows.length)
  }, [visible, meta])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Email Templates</h1>
          <p className="mt-1 text-sm text-muted-foreground">Customize the automated emails Immiglance sends. Built-in emails keep being sent until you activate your own version.</p>
        </div>
        <button onClick={onCreate} className="btn-primary flex items-center gap-2 text-sm"><Plus className="h-4 w-4" /> Create New Template</button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search templates…" className="w-full sm:w-72" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="input-field !w-auto" aria-label="Category">
          <option value="all">All categories</option>
          {(meta?.categories || []).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={audience} onChange={(e) => setAudience(e.target.value)} className="input-field !w-auto" aria-label="Audience">
          <option value="all">All audiences</option>
          {(meta?.audiences || []).map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
        </select>
        <select value={trigger} onChange={(e) => setTrigger(e.target.value)} className="input-field !w-auto max-w-[16rem]" aria-label="Trigger">
          <option value="all">All triggers</option>
          {(meta?.triggers || []).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="input-field !w-auto" aria-label="Status">
          {STATUS_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="input-field !w-auto" aria-label="Sort">
          {SORTS.map(([value, label]) => <option key={value} value={value}>Sort: {label}</option>)}
        </select>
      </div>

      {loading ? <div className="rounded-xl border border-border bg-card"><LoadingState label="Loading templates…" /></div>
        : error ? <div className="rounded-xl border border-border bg-card"><ErrorState message={error} onRetry={onRetry} /></div>
        : visible.length === 0 ? (
          <div className="rounded-xl border border-border bg-card"><EmptyState icon={Mail} title="No templates match" description="Try clearing a filter, or create a new template." /></div>
        ) : sections.map((section) => (
          <section key={section.key} className="overflow-hidden rounded-xl border border-border bg-card">
            <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border bg-secondary/40 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">{section.label}</h2>
                <p className="text-xs text-muted-foreground">{section.description}</p>
              </div>
              <span className="text-xs text-muted-foreground">{section.rows.length} {section.rows.length === 1 ? 'template' : 'templates'}</span>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Template</th>
                    <th className="px-4 py-2.5 font-medium">Trigger</th>
                    <th className="px-4 py-2.5 font-medium">Email</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row) => {
                    const badge = STATUS_META[row.status] || STATUS_META.draft
                    return (
                      <tr
                        key={row.id || row.triggerKey}
                        onClick={() => !row.locked && onOpen(row)}
                        title={row.locked ? 'Security email — cannot be customized' : undefined}
                        className={`border-b border-border last:border-0 ${row.locked ? 'opacity-60' : 'cursor-pointer hover:bg-secondary/50'}`}
                      >
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                            {row.locked && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
                            {row.name}
                            {row.sendsPush && <span title="Also sends an in-app and browser push notification" className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700"><BellRing className="h-3 w-3" /> Push</span>}
                          </div>
                          {row.description && <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{row.description}</p>}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{row.triggerLabel || <span className="italic">Not attached</span>}</td>
                        <td className="px-4 py-3 text-xs" title={row.sendRule ? `Sent when: ${row.sendRule.when}\nNot sent when: ${row.sendRule.unless}` : undefined}>
                          {row.sendEmail === false
                            ? <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">Off</span>
                            : row.emailAuto
                              ? <span className="rounded-full bg-green-50 px-2 py-0.5 font-medium text-green-700">Automatic</span>
                              : <span className="rounded-full bg-secondary px-2 py-0.5 font-medium text-muted-foreground">On activation</span>}
                        </td>
                        <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.className}`}>{badge.label}</span></td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{row.updatedAt ? new Date(row.updatedAt).toLocaleDateString() : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}
    </div>
  )
}
