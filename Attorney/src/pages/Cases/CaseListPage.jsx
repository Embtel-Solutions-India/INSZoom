import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowUpRight, Briefcase, Building2, Calendar, CheckCircle2, ChevronLeft, ChevronRight, FolderOpen, LayoutGrid, List, Mail, Search, UserRound, Users,
} from 'lucide-react'
import { attorneyApi } from '../../services/api'
import { caseIdentity } from '../../utils/caseIdentity'
import CaseMeta from '../../components/CaseMeta'
import WorkStateBadge, { WORK_STATE, isNotableCaseStatus } from '../../components/WorkStateBadge'

// The attorney's cases as cards (default) or a list, laid out like the Admin portal's Corporations / Clients pages.
// Search, sort and paging all run on the server (GET /attorney/cases).
const PAGE_SIZE = 24
const titleCase = (value) => String(value || '').replace(/_/g, ' ')
const formatDate = (value) => {
  if (!value) return ''
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
  } catch {
    return ''
  }
}

const Segmented = ({ label, options, value, onChange }) => (
  <div className="inline-flex shrink-0 rounded-full border border-border bg-card p-0.5" role="group" aria-label={label}>
    {options.map(([optionValue, optionLabel, OptionIcon]) => (
      <button
        key={optionValue}
        type="button"
        aria-pressed={value === optionValue}
        onClick={() => onChange(optionValue)}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${value === optionValue ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
      >
        {OptionIcon && <OptionIcon className="h-3.5 w-3.5" />}
        {optionLabel}
      </button>
    ))}
  </div>
)

export default function CaseListPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [urlParams] = useSearchParams()
  const urlSearch = (urlParams.get('q') || '').trim()
  const [cases, setCases] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // The navbar search sends people here as /cases?q=...; start from that term.
  const [search, setSearch] = useState(urlSearch)
  const [appliedSearch, setAppliedSearch] = useState(urlSearch)
  const [sortOrder, setSortOrder] = useState('desc')
  const [view, setView] = useState('cards')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [overallTotal, setOverallTotal] = useState(null)
  const fetchSeq = useRef(0)

  const fetchCases = useCallback(async () => {
    const seq = ++fetchSeq.current
    try {
      setError('')
      const params = { page, limit: PAGE_SIZE, sortOrder }
      if (appliedSearch) params.search = appliedSearch
      const { data } = await attorneyApi.cases(params)
      if (seq !== fetchSeq.current) return
      setCases(data.cases || [])
      setTotal(data.total ?? 0)
    } catch (err) {
      if (seq !== fetchSeq.current) return
      setError(err.response?.data?.message || 'Could not load your cases.')
      setCases([])
    } finally {
      if (seq === fetchSeq.current) setLoading(false)
    }
  }, [page, appliedSearch, sortOrder])

  // The banner total ignores search and filters.
  useEffect(() => {
    attorneyApi.cases({ page: 1, limit: 1 }).then(({ data }) => setOverallTotal(data.total ?? 0)).catch(() => {})
  }, [])

  useEffect(() => { fetchCases() }, [fetchCases])

  // Searching again from the navbar while already on this page (same or new term) re-applies it.
  useEffect(() => {
    if (urlSearch) setSearch(urlSearch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key])

  useEffect(() => {
    const handle = setTimeout(() => {
      setPage(1)
      setAppliedSearch(search.trim())
    }, 300)
    return () => clearTimeout(handle)
  }, [search])

  const change = (setter) => (value) => { setLoading(true); setPage(1); setter(value) }
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const filtering = Boolean(appliedSearch)
  const firstShown = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const lastShown = Math.min(total, page * PAGE_SIZE)
  const open = (item) => navigate(`/cases/${item._id}/overview`)

  return (
    <div className="flex min-h-[calc(100vh-8.5rem)] flex-col gap-5">
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Briefcase className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-foreground">My Cases</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Cases you have been given access to review</p>
          </div>
        </div>
        <div>
          <p className="text-3xl font-bold leading-none text-foreground tabular-nums">{overallTotal ?? '–'}</p>
          <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Total cases</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by client, email, visa type or case number…"
            className="w-full rounded-full border border-border bg-card py-2 pl-10 pr-4 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <Segmented label="Sort by creation date" options={[['desc', 'Newest first'], ['asc', 'Oldest first']]} value={sortOrder} onChange={change(setSortOrder)} />
          <Segmented label="Switch view" options={[['cards', 'Cards', LayoutGrid], ['list', 'List', List]]} value={view} onChange={setView} />
        </div>
      </div>

      <div className="flex flex-1 flex-col">
        {loading ? (
          <div className="flex flex-1 items-center justify-center rounded-2xl border border-border bg-card text-sm text-muted-foreground">Loading cases…</div>
        ) : error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card px-6 text-center">
            <p className="text-sm font-medium text-destructive">{error}</p>
            <button type="button" onClick={() => { setLoading(true); fetchCases() }} className="btn-secondary">Try again</button>
          </div>
        ) : cases.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              {filtering ? <FolderOpen className="h-8 w-8" /> : <Briefcase className="h-8 w-8" />}
            </span>
            {filtering ? (
              <>
                <h2 className="mt-5 text-lg font-semibold text-foreground">No cases match</h2>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">None of your cases match the current search or filter.</p>
                <button type="button" onClick={() => { setSearch(''); setAppliedSearch(''); setPage(1); setLoading(true) }} className="btn-secondary mt-5">Clear search</button>
              </>
            ) : (
              <>
                <h2 className="mt-5 text-lg font-semibold text-foreground">No cases yet</h2>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">No cases have been assigned to you yet. When a case manager grants you access to a case, it appears here.</p>
              </>
            )}
          </div>
        ) : view === 'list' ? (
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Visa</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Case manager</th>
                  <th className="px-4 py-3">Assigned</th>
                  <th className="px-4 py-3">Messages</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {cases.map((item) => (
                  <tr key={item._id} onClick={() => open(item)} className="cursor-pointer transition-colors hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-foreground">{caseIdentity(item).name}</p>
                      <CaseMeta email={caseIdentity(item).email} caseId={item.caseNumber || item.caseId} className="text-xs" extra={item.employeeCount > 0 ? `${item.employeeCount} ${item.employeeCount === 1 ? 'employee' : 'employees'}` : ''} />
                    </td>
                    <td className="px-4 py-3 text-foreground">{item.visaType}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <WorkStateBadge state={item.workState} />
                        {isNotableCaseStatus(item.status) && <span className="text-xs capitalize text-muted-foreground">{titleCase(item.status)}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-foreground">{item.caseManagerName || <span className="text-muted-foreground">—</span>}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDate(item.assignedAt) || '—'}</td>
                    <td className="px-4 py-3">
                      {item.unreadFeedback > 0
                        ? <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-bold text-destructive-foreground">{item.unreadFeedback}</span>
                        : <span className="text-muted-foreground/50">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {cases.map((item) => {
              const corporate = item.caseStructure === 'employer_employee'
              const CardIcon = corporate ? Building2 : UserRound
              return (
                <div
                  key={item._id}
                  role="button"
                  tabIndex={0}
                  onClick={() => open(item)}
                  onKeyDown={(e) => { if (e.key === 'Enter') open(item) }}
                  className="group flex cursor-pointer flex-col rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <CardIcon className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-foreground">{caseIdentity(item).name}</p>
                        <CaseMeta email={caseIdentity(item).email} caseId={item.caseNumber || item.caseId} className="text-xs" />
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {item.unreadFeedback > 0 && (
                        <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-bold text-destructive-foreground" title="Unread messages">{item.unreadFeedback}</span>
                      )}
                      <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-1.5">
                    {item.visaType && <span className="rounded-md bg-secondary px-2 py-1 text-xs font-semibold text-foreground">{item.visaType}</span>}
                    {item.stage && <span className="rounded-md border border-border px-2 py-1 text-xs capitalize text-muted-foreground">{titleCase(item.stage)}</span>}
                    <WorkStateBadge state={item.workState} />
                    {isNotableCaseStatus(item.status) && (
                      <span className={`rounded-md px-2 py-1 text-xs font-medium capitalize ${item.status === 'on_hold' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400' : 'border border-border text-muted-foreground'}`}>{titleCase(item.status)}</span>
                    )}
                  </div>

                  <div className="my-4 space-y-1.5 text-xs text-muted-foreground">
                    {item.clientEmail && <p className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{item.clientEmail}</span></p>}
                    {item.employeeCount > 0 && <p className="flex items-center gap-2"><Users className="h-3.5 w-3.5 shrink-0" />{item.employeeCount} {item.employeeCount === 1 ? 'employee' : 'employees'}</p>}
                    {item.assignedAt && <p className="flex items-center gap-2"><Calendar className="h-3.5 w-3.5 shrink-0" />Assigned {formatDate(item.assignedAt)}</p>}
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-3">
                    {item.caseManagerName ? (
                      <p className="flex min-w-0 items-center gap-2 text-xs text-foreground">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold uppercase text-primary">{item.caseManagerName.charAt(0)}</span>
                        <span className="truncate">{item.caseManagerName}</span>
                      </p>
                    ) : <span className="text-xs text-muted-foreground">Case manager not assigned</span>}
                    {item.workState === 'reviewed' && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" /> {WORK_STATE.reviewed.label}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {!error && total > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground">
          <span>{loading ? 'Loading…' : `Showing ${firstShown}–${lastShown} of ${total}`}</span>
          <div className="flex items-center gap-1">
            <button type="button" disabled={loading || page <= 1} onClick={() => { setLoading(true); setPage((p) => p - 1); window.scrollTo({ top: 0 }) }} className="rounded-lg p-1.5 hover:bg-secondary disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
            <span className="px-2 text-xs tabular-nums">Page {page} of {totalPages}</span>
            <button type="button" disabled={loading || page >= totalPages} onClick={() => { setLoading(true); setPage((p) => p + 1); window.scrollTo({ top: 0 }) }} className="rounded-lg p-1.5 hover:bg-secondary disabled:opacity-40" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </div>
  )
}
