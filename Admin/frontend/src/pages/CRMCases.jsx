import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import api, { casesApi } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { useSocket } from '../contexts/SocketContext'
import { Download, Calendar, ArrowRight, ChevronLeft, ChevronRight, Bell, UserPlus, Plus, Inbox, List, LayoutGrid } from 'lucide-react'
import { resolveDisplayVisa } from '../utils/visaDisplay'
import CreateCaseModal from '../components/CreateCaseModal'
import CaseCreatedSuccessModal from '../components/CaseCreatedSuccessModal'
import Card from '../components/ui/Card'
import StatBadge from '../components/ui/StatBadge'
import SearchInput from '../components/ui/SearchInput'
import FilterBar, { FilterSelect } from '../components/ui/FilterBar'

// Board view groups the SAME page of cases already fetched via GET /cases
// (no new API call, no new params) client-side by `status` - a purely
// presentational second view of existing data, not a new data source.
// Matches the exact status enum the Status filter dropdown already offers.
const BOARD_COLUMNS = [
  { key: 'pending_assignment', label: 'Pending Assignment' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'active', label: 'Active' },
  { key: 'on_hold', label: 'On Hold' },
  { key: 'archived', label: 'Archived' },
  { key: 'closed', label: 'Closed' },
]

// Phase 5 case creation is restricted to admins and team leads.
const CAN_CREATE_CASE_ROLES = ['super_admin', 'admin', 'team_lead']
// Phase 7 — who sees the Pending Assignment queue panel. Matches the roles
// GET /cases/dashboard/team-lead itself scopes to (team leads see their own
// team's queue; admins see every team's).
const PENDING_QUEUE_ROLES = ['super_admin', 'admin', 'team_lead']

const CRMCases = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const { subscribe, connected } = useSocket()
  const [cases, setCases] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchTerm, setSearchTerm] = useState(searchParams.get('q') || '')
  const [appliedSearch, setAppliedSearch] = useState(searchTerm)
  const [stageFilter, setStageFilter] = useState(searchParams.get('stage') || '')
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || '')
  // Deep-link-only filters from the case manager analytics panel's
  // Attention cards (rfeOverdue / attention) and visa-type breakdown - not
  // exposed as dropdowns, just forwarded straight through to the API.
  const [deepLinkFilters] = useState({
    rfeOverdue: searchParams.get('rfeOverdue') || undefined,
    attention: searchParams.get('attention') || undefined,
    visaType: searchParams.get('visaType') || undefined,
  })
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 5,
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  })
  const [viewMode, setViewMode] = useState('list') // 'list' | 'board' - presentational only, no data implications
  const [showCreateModal, setShowCreateModal] = useState(false)
  // P12-S2: replaces the browser-native alert() previously shown here — see
  // handleCaseCreated below.
  const [createdCaseNumber, setCreatedCaseNumber] = useState(null)
  const limit = 5

  // Phase 7 — Pending Assignment queue, sourced from the team-lead dashboard
  // endpoint (already scoped to the calling team lead's own cases, or all
  // cases for admins) and already caseRole-filtered server-side so child
  // cases never appear here as independent items.
  const [pendingQueue, setPendingQueue] = useState([])
  const [pendingQueueLoading, setPendingQueueLoading] = useState(true)
  const canSeePendingQueue = PENDING_QUEUE_ROLES.includes(user?.role)

  const fetchPendingQueue = async () => {
    if (!canSeePendingQueue) return
    try {
      const response = await casesApi.getTeamLeadDashboard()
      setPendingQueue(response.data.unassignedCases || response.data.dashboard?.unassignedCases || [])
    } catch (error) {
      console.error('Error fetching pending assignment queue:', error)
    } finally {
      setPendingQueueLoading(false)
    }
  }

  useEffect(() => {
    fetchPendingQueue()
  }, [user?.role])

  useEffect(() => {
    fetchCases()
  }, [stageFilter, statusFilter, page, appliedSearch])

  // Search now happens server-side (the API already supported it) instead of
  // filtering only the current page's rows in the browser — debounced, and
  // resets to page 1 like the other filters do (setPage/setAppliedSearch here
  // batch into one render, so the fetch above fires once per change).
  useEffect(() => {
    const handle = setTimeout(() => {
      setPage(1)
      setAppliedSearch(searchTerm)
    }, 300)
    return () => clearTimeout(handle)
  }, [searchTerm])

  useEffect(() => {
    const q = searchParams.get('q')
    if (q !== null) setSearchTerm(q)
  }, [searchParams])

  // "My Assigned Cases" should update the instant a Team Lead assigns a new
  // case to this case manager, or a client submits information on one of
  // their cases, without needing a manual refresh.
  useEffect(() => {
    if (!connected) return
    const unsubscribeAssigned = subscribe('case:assigned', () => { fetchCases(); fetchPendingQueue() })
    const unsubscribeSubmitted = subscribe('case:client_submitted', () => fetchCases())
    return () => {
      unsubscribeAssigned()
      unsubscribeSubmitted()
    }
  }, [connected, user?._id])

  // Only the very first load blocks the table with a full loading state;
  // subsequent refetches (search, filters, pagination, socket-driven
  // refreshes) update the rows in place instead of blanking the page.
  const hasLoadedOnce = useRef(false)
  const activeFetchRef = useRef({ seq: 0, controller: null })

  useEffect(() => () => {
    activeFetchRef.current.controller?.abort()
  }, [])

  const fetchCases = async () => {
    const seq = activeFetchRef.current.seq + 1
    activeFetchRef.current.controller?.abort()
    const controller = new AbortController()
    activeFetchRef.current = { seq, controller }
    try {
      if (!hasLoadedOnce.current) setLoading(true)
      setError('')
      const params = { page, limit, ...deepLinkFilters }
      if (stageFilter) params.stage = stageFilter
      if (statusFilter) params.status = statusFilter
      if (appliedSearch) params.search = appliedSearch

      const response = await api.get('/cases', { params, signal: controller.signal })
      if (seq !== activeFetchRef.current.seq) return
      setCases(response.data.cases || [])
      const meta = response.data.pagination || {
        page: response.data.page || page,
        limit,
        total: response.data.total || 0,
        totalPages: response.data.pages || 1,
        hasNextPage: (response.data.page || page) < (response.data.pages || 1),
        hasPreviousPage: (response.data.page || page) > 1,
      }
      setPagination(meta)
      setTotalPages(meta.totalPages || 1)
    } catch (error) {
      if (error.code === 'ERR_CANCELED' || error.name === 'CanceledError') return
      console.error('Error fetching cases:', error)
      setError(error.userMessage || 'Unable to load cases. Please try again.')
      setCases([])
    } finally {
      if (seq !== activeFetchRef.current.seq) return
      hasLoadedOnce.current = true
      setLoading(false)
    }
  }

  // Reset to the first page whenever filters change
  const handleStageFilter = (value) => {
    setPage(1)
    setStageFilter(value)
  }

  const handleStatusFilter = (value) => {
    setPage(1)
    setStatusFilter(value)
  }

  const handleRefreshCases = () => {
    // Matches the navbar's Refresh button (Layout.jsx) — a full page reload,
    // not a silent in-place refetch.
    window.location.reload()
  }

  const handleCaseCreated = (data) => {
    setShowCreateModal(false)
    setPage(1)
    fetchCases()
    if (data?.case?.caseNumber) {
      setCreatedCaseNumber(data.case.caseNumber)
    }
  }

  const retryFetchCases = () => {
    hasLoadedOnce.current = false
    fetchCases()
  }

  const getVisiblePages = () => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1)
    const pages = new Set([1, totalPages, page - 1, page, page + 1])
    if (page <= 3) {
      pages.add(2)
      pages.add(3)
      pages.add(4)
    }
    if (page >= totalPages - 2) {
      pages.add(totalPages - 3)
      pages.add(totalPages - 2)
      pages.add(totalPages - 1)
    }
    return Array.from(pages)
      .filter((value) => value >= 1 && value <= totalPages)
      .sort((left, right) => left - right)
      .reduce((items, value, index, array) => {
        if (index > 0 && value - array[index - 1] > 1) items.push('ellipsis')
        items.push(value)
        return items
      }, [])
  }

  // Stage/status pill colors now come from the shared StatBadge component
  // (components/ui/StatBadge.jsx), which carries this exact same mapping -
  // this was the single source of truth Phase 1 consolidated from.

  const isAwaitingAssignment = (caseItem) => (
    caseItem.status === 'pending_assignment' || !caseItem.assignedCaseManager
  )

  const getPackageLabel = (caseItem) => (
    caseItem.packageName ||
    caseItem.plan?.packageName ||
    caseItem.plan?.tier ||
    caseItem.package ||
    'Not selected'
  )

  const getCreator = (caseItem) => {
    const creator = caseItem.createdBy || caseItem.creator || {}
    const name = creator.name || creator.displayName || creator.email || caseItem.createdByName || 'Unknown'
    const role = creator.role || caseItem.createdByRole || ''
    return { name, role }
  }

  const formatRole = (role) => (
    String(role || '')
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  )

  const formatCreatedDate = (value) => {
    if (!value) return ''
    try {
      return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
    } catch {
      return ''
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">CRM Cases</h1>
          <p className="text-muted-foreground mt-1">Manage cases imported from Client Portal</p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="hidden sm:flex items-center rounded-lg border border-border bg-card p-0.5">
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${viewMode === 'list' ? 'bg-primary-600 text-white' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <List className="w-3.5 h-3.5" /> List
            </button>
            <button
              onClick={() => setViewMode('board')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${viewMode === 'board' ? 'bg-primary-600 text-white' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <LayoutGrid className="w-3.5 h-3.5" /> Board
            </button>
          </div>
          {CAN_CREATE_CASE_ROLES.includes(user?.role) && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-secondary flex items-center justify-center gap-2 w-full sm:w-auto"
            >
              <Plus className="w-4 h-4" />
              New Case
            </button>
          )}
          <button
            onClick={handleRefreshCases}
            className="btn-primary flex items-center justify-center gap-2 w-full sm:w-auto"
          >
            <Download className="w-4 h-4" />
            Refresh Cases
          </button>
        </div>
      </div>

      {showCreateModal && (
        <CreateCaseModal
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCaseCreated}
        />
      )}

      {createdCaseNumber && (
        <CaseCreatedSuccessModal
          caseNumber={createdCaseNumber}
          onClose={() => setCreatedCaseNumber(null)}
        />
      )}

      {/* Phase 7 — Pending Assignment queue: principal/single cases only,
          never child cases (enforced server-side by getTeamLeadDashboard). */}
      {canSeePendingQueue && !pendingQueueLoading && pendingQueue.length > 0 && (
        <div className="rounded-2xl border border-border bg-muted overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center gap-2">
            <Inbox className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-bold uppercase tracking-wide text-foreground">
              Pending Assignment ({pendingQueue.length})
            </h2>
          </div>
          <div className="divide-y divide-border">
            {pendingQueue.map((caseItem) => (
              <div
                key={caseItem._id}
                className="px-5 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 cursor-pointer hover:bg-secondary"
                onClick={() => navigate(`/crm-cases/${caseItem._id}?assign=case_manager`)}
              >
                <div className="min-w-0">
                  <span className="text-sm font-semibold text-foreground">{caseItem.caseNumber}</span>
                  <span className="text-sm text-muted-foreground"> — {caseItem.clientName || 'Unknown'}</span>
                  <span className="text-xs text-muted-foreground ml-2">{resolveDisplayVisa(caseItem)}</span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); navigate(`/crm-cases/${caseItem._id}?assign=case_manager`) }}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-700 shrink-0"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  Assign Case Manager
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <Card>
        <FilterBar>
          <SearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search cases…"
            className="w-full sm:flex-1 sm:min-w-[200px]"
          />
          <FilterSelect
            value={stageFilter}
            onChange={handleStageFilter}
            className="w-full sm:w-auto"
            options={[
              { value: '', label: 'All Stages' },
              { value: 'intake', label: 'Intake' },
              { value: 'strategy', label: 'Strategy' },
              { value: 'evidence', label: 'Evidence' },
              { value: 'expert_letters', label: 'Expert Letters' },
              { value: 'review', label: 'Review' },
              { value: 'filing', label: 'Filing' },
              { value: 'uscis_pending', label: 'USCIS Pending' },
              { value: 'approved', label: 'Approved' },
              { value: 'denied', label: 'Denied' },
            ]}
          />
          <FilterSelect
            value={statusFilter}
            onChange={handleStatusFilter}
            className="w-full sm:w-auto"
            options={[
              { value: '', label: 'All Status' },
              { value: 'pending_assignment', label: 'Pending Assignment' },
              { value: 'assigned', label: 'Assigned' },
              { value: 'active', label: 'Active' },
              { value: 'on_hold', label: 'On Hold' },
              { value: 'archived', label: 'Archived' },
              { value: 'closed', label: 'Closed' },
            ]}
          />
        </FilterBar>
      </Card>

      {/* Cases Table */}
      <div className="card !p-0 md:!p-5">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-muted-foreground">Loading cases...</div>
          </div>
        ) : error ? (
          <div className="px-6 py-12 text-center text-sm">
            <p className="font-medium text-red-700 dark:text-red-400">{error}</p>
            <button type="button" onClick={retryFetchCases} className="btn-secondary mt-4">
              Try Again
            </button>
          </div>
        ) : cases.length === 0 ? (
          <div className="px-6 py-12 text-center text-muted-foreground text-sm">
            No cases found. Sync from Client Portal to get started.
          </div>
        ) : viewMode === 'board' ? (
          // Groups this SAME page of already-fetched `cases` by status - no
          // extra API call. A case whose status isn't one of the known
          // columns (rare/legacy data) still gets its own column so nothing
          // silently disappears from the board.
          <div className="overflow-x-auto pb-2">
            <div className="flex gap-4 min-w-max">
              {[
                ...BOARD_COLUMNS,
                ...Array.from(new Set(cases.map((c) => c.status).filter((s) => !BOARD_COLUMNS.some((col) => col.key === s))))
                  .map((s) => ({ key: s, label: (s || 'Unknown').replace(/_/g, ' ') })),
              ].map((column) => {
                const columnCases = cases.filter((c) => c.status === column.key)
                return (
                  <div key={column.key} className="w-72 shrink-0">
                    <div className="flex items-center justify-between mb-2 px-1">
                      <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{column.label}</h3>
                      <span className="text-xs font-semibold text-muted-foreground">{columnCases.length}</span>
                    </div>
                    <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
                      {columnCases.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">No cases</div>
                      ) : columnCases.map((caseItem) => {
                        const awaitingAssignment = isAwaitingAssignment(caseItem)
                        const caseManagerName = caseItem.assignedCaseManager?.name || caseItem.assignedCaseManager?.displayName
                        return (
                          <Card
                            key={caseItem._id}
                            className="!p-3 cursor-pointer hover:shadow-md transition-shadow"
                            onClick={() => navigate(`/crm-cases/${caseItem._id}`)}
                          >
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <span className="text-sm font-semibold text-foreground truncate">{caseItem.caseNumber}</span>
                              <StatBadge value={caseItem.stage} kind="stage" className="shrink-0" />
                            </div>
                            <p className="text-xs text-muted-foreground truncate">{caseItem.clientName}</p>
                            <p className="text-xs text-muted-foreground truncate">{resolveDisplayVisa(caseItem)}</p>
                            <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
                              {caseManagerName ? (
                                <span className="text-[11px] text-muted-foreground truncate">{caseManagerName}</span>
                              ) : awaitingAssignment ? (
                                <button
                                  onClick={(e) => { e.stopPropagation(); navigate(`/crm-cases/${caseItem._id}?assign=case_manager`) }}
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300"
                                >
                                  <UserPlus className="w-3 h-3" /> Assign
                                </button>
                              ) : <span />}
                            </div>
                          </Card>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <>
            {/* Mobile: stacked cards (below md) */}
            <div className="md:hidden divide-y divide-border">
              {cases.map((caseItem) => {
                const awaitingAssignment = isAwaitingAssignment(caseItem)
                const caseManagerName = caseItem.assignedCaseManager?.name || caseItem.assignedCaseManager?.displayName
                const creator = getCreator(caseItem)
                return (
                  <div key={caseItem._id} className={`p-4 space-y-2.5 ${awaitingAssignment ? 'bg-amber-50/40 dark:bg-amber-950/20' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-foreground">{caseItem.caseNumber}</span>
                          {awaitingAssignment && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 shrink-0 dark:bg-amber-950/40 dark:text-amber-400">
                              <Bell className="h-2.5 w-2.5" />
                              New
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-foreground mt-0.5 truncate">{caseItem.clientName}</p>
                        <p className="text-xs text-muted-foreground truncate">{caseItem.clientEmail}</p>
                      </div>
                      <StatBadge value={caseItem.stage} kind="stage" className="shrink-0" />
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm text-foreground truncate">{resolveDisplayVisa(caseItem)}</p>
                        <p className="text-xs text-muted-foreground capitalize truncate">
                          {getPackageLabel(caseItem)?.replace?.('_', ' ') || getPackageLabel(caseItem)}
                        </p>
                      </div>
                      <StatBadge value={caseItem.status} kind="status" className="shrink-0" />
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      {caseManagerName ? (
                        <p className="text-xs text-muted-foreground truncate">{caseManagerName}</p>
                      ) : (
                        <span className="text-xs text-amber-700 font-medium dark:text-amber-400">Awaiting assignment</span>
                      )}
                      <div className="flex items-center gap-2 shrink-0">
                        {awaitingAssignment && (
                          <button
                            onClick={() => navigate(`/crm-cases/${caseItem._id}?assign=case_manager`)}
                            title="Assign case manager"
                            className="p-1.5 rounded-lg text-amber-700 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-950/40"
                          >
                            <UserPlus className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => navigate(`/crm-cases/${caseItem._id}`)}
                          className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-800 text-xs font-medium dark:text-primary-400 dark:hover:text-primary-300"
                        >
                          View <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 rounded-lg bg-card/70 px-2 py-1.5 text-xs text-muted-foreground">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-medium text-muted-foreground">Created By</span>
                      <span className="truncate">{creator.name}</span>
                      {creator.role && <span className="shrink-0 text-muted-foreground">({formatRole(creator.role)})</span>}
                      {caseItem.createdAt && <span className="ml-auto shrink-0 text-muted-foreground">{formatCreatedDate(caseItem.createdAt)}</span>}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Desktop: full table (md and up) */}
            <div className="hidden md:block overflow-x-auto">
            <table className="w-full table-fixed">
              <colgroup>
                <col className="w-[13%]" />
                <col className="w-[17%]" />
                <col className="w-[14%]" />
                <col className="w-[13%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[13%]" />
                <col className="w-[10%]" />
              </colgroup>
              <thead>
                <tr className="bg-muted">
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Case Number</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Client</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Visa / Package</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Created By</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Stage</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Case Manager</th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((caseItem) => {
                    const awaitingAssignment = isAwaitingAssignment(caseItem)
                    const creator = getCreator(caseItem)
                    return (
                    <tr key={caseItem._id} className={`border-b border-border hover:bg-muted ${awaitingAssignment ? 'bg-amber-50/40 dark:bg-amber-950/20' : ''}`}>
                      <td className="px-3 py-3 align-top">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-medium truncate" title={caseItem.caseNumber}>{caseItem.caseNumber}</span>
                          {awaitingAssignment && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 shrink-0 dark:bg-amber-950/40 dark:text-amber-400">
                              <Bell className="h-2.5 w-2.5" />
                              New
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top min-w-0">
                        <p className="font-medium truncate" title={caseItem.clientName}>{caseItem.clientName}</p>
                        <p className="text-xs text-muted-foreground truncate" title={caseItem.clientEmail}>{caseItem.clientEmail}</p>
                      </td>
                      <td className="px-3 py-3 align-top min-w-0">
                        <p className="truncate" title={resolveDisplayVisa(caseItem)}>{resolveDisplayVisa(caseItem)}</p>
                        <p className="text-xs text-muted-foreground capitalize truncate">{getPackageLabel(caseItem)?.replace?.('_', ' ') || getPackageLabel(caseItem)}</p>
                      </td>
                      <td className="px-3 py-3 align-top min-w-0">
                        <p className="font-medium truncate" title={creator.name}>{creator.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {formatRole(creator.role) || 'Creator'}{caseItem.createdAt ? ` - ${formatCreatedDate(caseItem.createdAt)}` : ''}
                        </p>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <StatBadge value={caseItem.stage} kind="stage" className="max-w-full truncate" />
                      </td>
                      <td className="px-3 py-3 align-top">
                        <StatBadge value={caseItem.status} kind="status" className="max-w-full truncate" />
                      </td>
                      <td className="px-3 py-3 align-top min-w-0">
                        {caseItem.assignedCaseManager?.name || caseItem.assignedCaseManager?.displayName ? (
                          <p className="truncate" title={caseItem.assignedCaseManager?.name || caseItem.assignedCaseManager?.displayName}>
                            {caseItem.assignedCaseManager?.name || caseItem.assignedCaseManager?.displayName}
                          </p>
                        ) : (
                          <span className="text-amber-700 font-medium text-xs dark:text-amber-400">Awaiting assignment</span>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="flex items-center justify-end gap-1.5">
                          {awaitingAssignment && (
                            <button
                              onClick={() => navigate(`/crm-cases/${caseItem._id}?assign=case_manager`)}
                              title="Assign case manager"
                              className="p-1.5 rounded-lg text-amber-700 hover:bg-amber-100 shrink-0 dark:text-amber-400 dark:hover:bg-amber-950/40"
                            >
                              <UserPlus className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => navigate(`/crm-cases/${caseItem._id}`)}
                            className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-800 text-xs font-medium shrink-0 dark:text-primary-400 dark:hover:text-primary-300"
                          >
                            View <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )})}
              </tbody>
            </table>
            </div>
          </>
        )}
      </div>

      {/* Pagination controls */}
      {!loading && !error && totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={!pagination.hasPreviousPage}
            className="btn-secondary flex items-center gap-1 disabled:opacity-50"
          >
            <ChevronLeft className="w-4 h-4" />
            Previous
          </button>
          {getVisiblePages().map((item, index) => (
            item === 'ellipsis' ? (
              <span key={`ellipsis-${index}`} className="px-2 text-sm text-muted-foreground">...</span>
            ) : (
              <button
                key={item}
                type="button"
                onClick={() => setPage(item)}
                aria-current={item === page ? 'page' : undefined}
                className={`h-9 min-w-9 rounded-lg px-3 text-sm font-semibold ${
                  item === page
                    ? 'bg-primary-600 text-white'
                    : 'border border-border bg-card text-muted-foreground hover:bg-muted'
                }`}
              >
                {item}
              </button>
            )
          ))}
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={!pagination.hasNextPage}
            className="btn-secondary flex items-center gap-1 disabled:opacity-50"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}

export default CRMCases
