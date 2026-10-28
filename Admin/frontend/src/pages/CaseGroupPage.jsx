import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, UserRound, Search, ChevronLeft, ChevronRight, Users, UserPlus, Calendar, Mail, ArrowUpRight, FolderOpen, List, LayoutGrid } from 'lucide-react'
import api from '../services/api'
import { useRouteRevisit } from '../components/KeepAliveOutlet'
import { resolveDisplayVisa } from '../utils/visaDisplay'

// The Corporations and Clients sidebar pages. Read-only lists of one kind of case each (GET /cases?caseGroup=...), laid out as
// cards (default) or a list - deliberately not the table screen the all-cases page uses. Cases are created from the Cases page only.
const GROUPS = {
  corporations: {
    title: 'Corporations',
    subtitle: 'Employer matters, with every employee case inside them',
    Icon: Building2,
    searchPlaceholder: 'Search by company, employee name, email or case number…',
    emptyTitle: 'No corporation cases yet',
    emptyText: 'Every employer matter lives here: the company, its petition and all of its employees together in one case. Employee cases are never listed on their own — open the company to see each employee, their documents and their forms.',
  },
  clients: {
    title: 'Clients',
    subtitle: 'Family-based and single-applicant cases',
    Icon: UserRound,
    searchPlaceholder: 'Search by client name, email or case number…',
    emptyTitle: 'No client cases yet',
    emptyText: 'Family-based cases and cases filed by one person on their own are listed here. A family case carries the petitioner and the beneficiary together in the same case, and a single-applicant case belongs to one client.',
  },
}

const PAGE_SIZE = 25

const titleCase = (value) => String(value || '').replace(/_/g, ' ')
const formatDate = (value) => {
  if (!value) return ''
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
  } catch {
    return ''
  }
}
const personName = (item) => item.clientName || item.employeeContact?.name || 'Unnamed'
const personEmail = (item) => item.clientEmail || item.employeeContact?.email || ''

export default function CaseGroupPage({ caseGroup }) {
  const group = GROUPS[caseGroup]
  const { Icon } = group
  const navigate = useNavigate()
  const [cases, setCases] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [view, setView] = useState('cards') // 'cards' | 'list'
  const [sortOrder, setSortOrder] = useState('desc')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [overallTotal, setOverallTotal] = useState(null)
  const fetchSeq = useRef(0)

  const baseParams = { excludeChildCases: true, caseGroup }

  const fetchCases = useCallback(async () => {
    const seq = ++fetchSeq.current
    try {
      setError('')
      const params = { ...baseParams, page, limit: PAGE_SIZE, sortOrder }
      if (appliedSearch) params.search = appliedSearch
      const response = await api.get('/cases', { params })
      if (seq !== fetchSeq.current) return
      setCases(response.data.cases || [])
      setTotal(response.data.pagination?.total ?? response.data.total ?? 0)
    } catch (err) {
      if (seq !== fetchSeq.current) return
      setError(err.userMessage || 'Unable to load cases. Please try again.')
      setCases([])
    } finally {
      if (seq === fetchSeq.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseGroup, page, appliedSearch, sortOrder])

  // total shown in the banner (independent of search)
  const fetchOverallTotal = useCallback(async () => {
    try {
      const response = await api.get('/cases', { params: { ...baseParams, page: 1, limit: 1 } })
      setOverallTotal(response.data.pagination?.total ?? response.data.total ?? 0)
    } catch {
      // the banner simply shows a dash
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseGroup])

  useEffect(() => { fetchCases() }, [fetchCases])
  useEffect(() => { fetchOverallTotal() }, [fetchOverallTotal])
  useRouteRevisit(() => { fetchCases(); fetchOverallTotal() })

  useEffect(() => {
    const handle = setTimeout(() => {
      setPage(1)
      setAppliedSearch(search.trim())
    }, 300)
    return () => clearTimeout(handle)
  }, [search])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const filtering = Boolean(appliedSearch)
  const firstShown = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const lastShown = Math.min(total, page * PAGE_SIZE)

  return (
    <div className="flex min-h-[calc(100vh-8.5rem)] flex-col gap-5">
      {/* Banner */}
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Icon className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{group.title}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{group.subtitle}</p>
          </div>
        </div>
        <div>
          <p className="text-3xl font-bold leading-none text-foreground tabular-nums">{overallTotal ?? '–'}</p>
          <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Total cases</p>
        </div>
      </div>

      {/* Toolbar: search, sort and the Cards / List switch */}
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={group.searchPlaceholder}
              className="w-full rounded-full border border-border bg-card py-2.5 pl-10 pr-4 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
          </div>
          <div className="inline-flex shrink-0 rounded-full border border-border bg-card p-0.5" role="group" aria-label="Sort by creation date">
            {[['desc', 'Newest first'], ['asc', 'Oldest first']].map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={sortOrder === value}
                onClick={() => { if (value !== sortOrder) { setLoading(true); setPage(1); setSortOrder(value) } }}
                className={`rounded-full px-4 py-2 text-xs font-semibold transition-colors ${sortOrder === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="inline-flex shrink-0 rounded-full border border-border bg-card p-0.5" role="group" aria-label="Switch view">
            {[['cards', 'Cards', LayoutGrid], ['list', 'List', List]].map(([value, label, ViewIcon]) => (
              <button
                key={value}
                type="button"
                aria-pressed={view === value}
                onClick={() => setView(value)}
                className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold transition-colors ${view === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <ViewIcon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results - this block grows to the bottom of the page */}
      <div className="flex flex-1 flex-col">
        {loading ? (
          <div className="flex flex-1 items-center justify-center rounded-2xl border border-border bg-card text-sm text-muted-foreground">Loading cases…</div>
        ) : error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card px-6 text-center">
            <p className="text-sm font-medium text-red-700 dark:text-red-400">{error}</p>
            <button type="button" onClick={() => { setLoading(true); fetchCases() }} className="btn-secondary">Try again</button>
          </div>
        ) : cases.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              {filtering ? <FolderOpen className="h-8 w-8" /> : <Icon className="h-8 w-8" />}
            </span>
            {filtering ? (
              <>
                <h2 className="mt-5 text-lg font-semibold text-foreground">No cases match</h2>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">Nothing in {group.title} matches the current search. Clear it to see every case again.</p>
                <button type="button" onClick={() => { setSearch(''); setAppliedSearch(''); setPage(1) }} className="btn-secondary mt-5">Clear search</button>
              </>
            ) : (
              <>
                <h2 className="mt-5 text-lg font-semibold text-foreground">{group.emptyTitle}</h2>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">{group.emptyText}</p>
                <p className="mt-4 text-sm text-muted-foreground">As soon as a case of this kind is created, it is listed on this page automatically.</p>
              </>
            )}
          </div>
        ) : view === 'list' ? (
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3">Case</th>
                  <th className="px-4 py-3">{caseGroup === 'corporations' ? 'Company' : 'Client'}</th>
                  <th className="px-4 py-3">Visa</th>
                  <th className="px-4 py-3">Stage</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Case manager</th>
                  <th className="px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {cases.map((item) => {
                  const manager = item.assignedCaseManager?.name || item.assignedCaseManager?.displayName
                  const employees = item.caseStructure === 'employer_employee' ? item.childCaseCount : 0
                  return (
                    <tr key={item._id} onClick={() => navigate(`/crm-cases/${item._id}`)} className="cursor-pointer transition-colors hover:bg-muted/40">
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-foreground">{item.caseNumber}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{personName(item)}</p>
                        <p className="text-xs text-muted-foreground">{personEmail(item)}{employees > 0 ? `${personEmail(item) ? ' · ' : ''}${employees} ${employees === 1 ? 'employee' : 'employees'}` : ''}</p>
                      </td>
                      <td className="px-4 py-3 text-foreground">{resolveDisplayVisa(item)}</td>
                      <td className="px-4 py-3 capitalize text-muted-foreground">{titleCase(item.pipelineStage || item.stage)}</td>
                      <td className="px-4 py-3 capitalize text-muted-foreground">{titleCase(item.status)}</td>
                      <td className="px-4 py-3 text-foreground">{manager || <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Awaiting assignment</span>}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDate(item.createdAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {cases.map((item) => {
              const manager = item.assignedCaseManager?.name || item.assignedCaseManager?.displayName
              const awaiting = item.status === 'pending_assignment' || !item.assignedCaseManager
              const employees = item.caseStructure === 'employer_employee' ? item.childCaseCount : 0
              return (
                <div
                  key={item._id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/crm-cases/${item._id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/crm-cases/${item._id}`) }}
                  className="group flex cursor-pointer flex-col rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-foreground">{personName(item)}</p>
                        <p className="text-xs text-muted-foreground">{item.caseNumber}</p>
                      </div>
                    </div>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md bg-secondary px-2 py-1 text-xs font-semibold text-foreground">{resolveDisplayVisa(item)}</span>
                    <span className="rounded-md border border-border px-2 py-1 text-xs capitalize text-muted-foreground">{titleCase(item.pipelineStage || item.stage)}</span>
                    <span className={`rounded-md px-2 py-1 text-xs font-medium capitalize ${item.status === 'on_hold' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400' : 'border border-border text-muted-foreground'}`}>{titleCase(item.status)}</span>
                  </div>

                  <div className="my-4 space-y-1.5 text-xs text-muted-foreground">
                    {personEmail(item) && (
                      <p className="flex items-center gap-2"><Mail className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{personEmail(item)}</span></p>
                    )}
                    {employees > 0 && (
                      <p className="flex items-center gap-2"><Users className="h-3.5 w-3.5 shrink-0" />{employees} {employees === 1 ? 'employee' : 'employees'}</p>
                    )}
                    {item.createdAt && (
                      <p className="flex items-center gap-2"><Calendar className="h-3.5 w-3.5 shrink-0" />Created {formatDate(item.createdAt)}</p>
                    )}
                  </div>

                  <div className="mt-auto flex items-center justify-between border-t border-border pt-3">
                    {manager ? (
                      <p className="flex min-w-0 items-center gap-2 text-xs text-foreground">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold uppercase text-primary">{manager.charAt(0)}</span>
                        <span className="truncate">{manager}</span>
                      </p>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-400"><UserPlus className="h-3.5 w-3.5" />{awaiting ? 'Awaiting assignment' : 'Unassigned'}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Pager */}
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
