import { useState, useEffect, useRef } from 'react'
import api from '../services/api'
import { Filter, Eye, X, FolderOpen, CheckCircle2, MessageSquare, FileText, Briefcase } from 'lucide-react'
import EverydayPlanReport, { EverydayReadOnly } from '../components/EverydayPlanReport'
import { personName } from '../utils/everyday'

const ROLE_LABELS = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  team_lead: 'Team Lead',
  case_manager: 'Case Manager',
  paralegal: 'Paralegal',
  finance: 'Finance',
  hr: 'HR',
  reviewer: 'Reviewer',
}
const ROLE_DOTS = {
  super_admin: 'bg-purple-500',
  admin: 'bg-indigo-500',
  team_lead: 'bg-blue-500',
  case_manager: 'bg-teal-500',
}
const STATS = [
  { key: 'casesWorked', label: 'Cases worked', Icon: Briefcase, tone: 'text-blue-600', tile: 'bg-blue-500/10' },
  { key: 'casesClosed', label: 'Cases closed', Icon: CheckCircle2, tone: 'text-green-600', tile: 'bg-green-500/10' },
  { key: 'documentsReviewed', label: 'Docs reviewed', Icon: FileText, tone: 'text-purple-600', tile: 'bg-purple-500/10' },
  { key: 'messagesReplied', label: 'Messages', Icon: MessageSquare, tone: 'text-amber-600', tile: 'bg-amber-500/10' },
]

// "2026-11-07" -> "Sat, 7 Nov 2026" (the key is a calendar date, so it is formatted in UTC to never shift a day).
const dayLabel = (key) => new Date(`${key}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

function Preview({ items, kind }) {
  const tone = kind === 'plan' ? 'border-amber-400/25 bg-amber-400/[0.07]' : 'border-green-400/25 bg-green-400/[0.07]'
  if (!items.length) return <p className="truncate text-xs text-muted-foreground">{kind === 'plan' ? 'No goal set' : 'No achievements yet'}</p>
  return (
    <div className={`min-w-0 rounded-lg border px-2.5 py-1.5 ${tone}`}>
      <p className="truncate text-xs text-foreground">{items[0]}</p>
      {items.length > 1 && <p className="text-[0.7rem] text-muted-foreground">+{items.length - 1} more</p>}
    </div>
  )
}

const EODReports = () => {
  const [board, setBoard] = useState({ today: '', days: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [period, setPeriod] = useState('this_month')
  const [role, setRole] = useState('')
  const [selected, setSelected] = useState(null)
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 })
  const hasLoadedOnce = useRef(false)

  // The board re-syncs from the database every 30s, and when a plan / report is saved on this page.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        if (!hasLoadedOnce.current) setLoading(true)
        const params = {}
        if (period) params.period = period
        if (role) params.role = role
        params.page = page
        const response = await api.get('/reports/everyday/board', { params })
        if (!cancelled) { setBoard(response.data.data || { today: '', days: [] }); if (response.data.data?.pagination) setPagination(response.data.data.pagination); setError(null) }
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.message || err.message || 'Failed to load EOD reports')
      } finally {
        hasLoadedOnce.current = true
        if (!cancelled) setLoading(false)
      }
    }
    load()
    const timer = setInterval(load, 30000)
    window.addEventListener('everyday-updated', load)
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('everyday-updated', load) }
  }, [period, role, page])

  useEffect(() => { setPage(1) }, [period, role])

  const empty = !loading && board.days.every((day) => !day.rows.length)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">EOD Reports</h1>
        <p className="mt-1 text-muted-foreground">Everyone's goals, achievements and numbers for each day</p>
      </div>

      <EverydayPlanReport />

      <div className="card">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">Filters:</span>
          </div>
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-lg border px-4 py-2 focus:border-ring focus:ring-2 focus:ring-ring">
            <option value="">All Time</option>
            <option value="today">Today</option>
            <option value="this_week">This Week</option>
            <option value="this_month">This Month</option>
          </select>
          <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-lg border px-4 py-2 focus:border-ring focus:ring-2 focus:ring-ring">
            <option value="">All Roles</option>
            <option value="admin">Admin</option>
            <option value="team_lead">Team Lead</option>
            <option value="case_manager">Case Manager</option>
          </select>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="card flex h-48 items-center justify-center text-muted-foreground">Loading reports...</div>
      ) : empty ? (
        <div className="card flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground"><FolderOpen className="h-8 w-8" />No reports found</div>
      ) : (
        <div className="space-y-6" data-testid="eod-board">
          {board.days.filter((day) => day.rows.length).map((day) => (
            <section key={day.date} data-testid={`eod-day-${day.date}`}>
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className={`rounded-full px-3 py-1 text-sm font-semibold ${day.date === board.today ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground'}`}>
                  {day.date === board.today ? `Today · ${dayLabel(day.date)}` : dayLabel(day.date)}
                </span>
                <span className="hidden h-px flex-1 bg-border sm:block" />
                <span className="text-xs text-muted-foreground">{day.rows.length} {day.rows.length === 1 ? 'person' : 'people'}</span>
              </div>
              <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {day.rows.map((row) => (
                  <div
                    key={`${row.staff._id}|${row.date}`}
                    role="button"
                    tabIndex={0}
                    data-testid="eod-row"
                    onClick={() => setSelected(row)}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(row) } }}
                    className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-2 hover:bg-muted/60 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_auto_auto] md:gap-2 md:py-1.5"
                  >
                    <div className="col-start-1 row-start-1 min-w-0 md:col-start-auto md:row-start-auto">
                      <p className="truncate font-medium text-foreground">{personName(row.staff)}</p>
                      <span className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground"><span className={`h-2 w-2 rounded-full ${ROLE_DOTS[row.staff.role] || 'bg-gray-400'}`} aria-hidden="true" />{ROLE_LABELS[row.staff.role] || row.staff.role}</span>
                    </div>
                    <div className="col-span-2 min-w-0 md:col-span-1"><Preview items={row.planItems} kind="plan" /></div>
                    <div className="col-span-2 min-w-0 md:col-span-1"><Preview items={row.reportItems} kind="report" /></div>
                    <div className="col-start-2 row-start-1 flex items-center gap-2.5 text-xs md:col-start-auto md:row-start-auto md:gap-3">
                      {STATS.map(({ key, label, Icon, tone }) => (
                        <span key={key} title={label} className={`inline-flex items-center gap-1 font-semibold ${tone}`}><Icon className="h-3.5 w-3.5" />{row.stats[key]}</span>
                      ))}
                    </div>
                    <button type="button" onClick={(event) => { event.stopPropagation(); setSelected(row) }} className="col-span-2 inline-flex items-center gap-1.5 justify-self-start rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-primary hover:bg-secondary md:col-span-1 md:justify-self-end">
                      <Eye className="h-4 w-4" /> View
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {pagination.pages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>Page {pagination.page} of {pagination.pages} · 7 days per page</span>
          <div className="flex gap-2">
            <button className="btn-secondary disabled:opacity-50" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
            <button className="btn-secondary disabled:opacity-50" disabled={page >= pagination.pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4" onClick={() => setSelected(null)}>
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-card p-4 sm:p-6" role="dialog" aria-label="Report details" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-xl font-bold text-foreground">{personName(selected.staff)}</h3>
                <p className="text-sm text-muted-foreground">{ROLE_LABELS[selected.staff.role] || selected.staff.role} · {dayLabel(selected.date)}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} aria-label="Close" className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"><X className="h-5 w-5" /></button>
            </div>
            <EverydayReadOnly planItems={selected.planItems} reportItems={selected.reportItems} />
            <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4 sm:grid-cols-4">
              {STATS.map(({ key, label, Icon, tone, tile }) => (
                <div key={key} className={`rounded-lg p-3 ${tile}`}>
                  <p className={`flex items-center gap-1.5 text-xs ${tone}`}><Icon className="h-3.5 w-3.5" />{label}</p>
                  <p className={`mt-1 text-xl font-bold ${tone}`}>{selected.stats[key]}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default EODReports
