import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import api from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { useSocket } from '../contexts/SocketContext'
import { Briefcase, Search, Filter, Download, User, Calendar, DollarSign, ArrowRight, ChevronLeft, ChevronRight, Bell, UserPlus, Plus } from 'lucide-react'
import { resolveDisplayVisa } from '../utils/visaDisplay'
import CreateCaseModal from '../components/CreateCaseModal'

// Case managers, team leads, and admins can create a case directly from this
// portal (see Backend's POST /cases/create-with-client authorizeRoles list).
const CAN_CREATE_CASE_ROLES = ['super_admin', 'admin', 'team_lead', 'case_manager']

const CRMCases = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const { subscribe, connected } = useSocket()
  const [cases, setCases] = useState([])
  const [loading, setLoading] = useState(true)
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
  const [showCreateModal, setShowCreateModal] = useState(false)
  const limit = 20

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
    const unsubscribeAssigned = subscribe('case:assigned', () => fetchCases())
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
      const params = { page, limit, ...deepLinkFilters }
      if (stageFilter) params.stage = stageFilter
      if (statusFilter) params.status = statusFilter
      if (appliedSearch) params.search = appliedSearch

      const response = await api.get('/cases', { params, signal: controller.signal })
      if (seq !== activeFetchRef.current.seq) return
      setCases(response.data.cases || [])
      // Handle the paginated response shape; fall back to a single page
      // when the endpoint does not return pagination metadata.
      setTotalPages(response.data.pages || 1)
    } catch (error) {
      if (error.code === 'ERR_CANCELED' || error.name === 'CanceledError') return
      console.error('Error fetching cases:', error)
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
      alert(`Case ${data.case.caseNumber} created. An activation email has been sent to the client.`)
    }
  }

  const getStageColor = (stage) => {
    const colors = {
      intake: 'bg-gray-100 text-gray-800',
      strategy: 'bg-blue-100 text-blue-800',
      evidence: 'bg-purple-100 text-purple-800',
      expert_letters: 'bg-pink-100 text-pink-800',
      review: 'bg-amber-100 text-amber-800',
      filing: 'bg-green-100 text-green-800',
      uscis_pending: 'bg-cyan-100 text-cyan-800',
      approved: 'bg-blue-100 text-blue-800',
      denied: 'bg-red-100 text-red-800'
    }
    return colors[stage] || 'bg-gray-100 text-gray-800'
  }

  const getStatusColor = (status) => {
    const colors = {
      active: 'bg-green-100 text-green-800',
      assigned: 'bg-green-100 text-green-800',
      pending_assignment: 'bg-amber-100 text-amber-800',
      archived: 'bg-gray-100 text-gray-800',
      closed: 'bg-blue-100 text-blue-800'
    }
    return colors[status] || 'bg-gray-100 text-gray-800'
  }

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
          <h1 className="text-2xl font-bold text-gray-900">CRM Cases</h1>
          <p className="text-gray-600 mt-1">Manage cases imported from Client Portal</p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
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

      {/* Filters */}
      <div className="card">
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:gap-4 sm:items-center">
          <div className="w-full sm:flex-1 sm:min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search cases..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
          <div className="w-full sm:w-auto">
            <select
              value={stageFilter}
              onChange={(e) => handleStageFilter(e.target.value)}
              className="w-full sm:w-auto px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Stages</option>
              <option value="intake">Intake</option>
              <option value="strategy">Strategy</option>
              <option value="evidence">Evidence</option>
              <option value="expert_letters">Expert Letters</option>
              <option value="review">Review</option>
              <option value="filing">Filing</option>
              <option value="uscis_pending">USCIS Pending</option>
              <option value="approved">Approved</option>
              <option value="denied">Denied</option>
            </select>
          </div>
          <div className="w-full sm:w-auto">
            <select
              value={statusFilter}
              onChange={(e) => handleStatusFilter(e.target.value)}
              className="w-full sm:w-auto px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Status</option>
              <option value="pending_assignment">Pending Assignment</option>
              <option value="assigned">Assigned</option>
              <option value="active">Active</option>
              <option value="on_hold">On Hold</option>
              <option value="archived">Archived</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        </div>
      </div>

      {/* Cases Table */}
      <div className="card !p-0 md:!p-5">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-600">Loading cases...</div>
          </div>
        ) : cases.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-500 text-sm">
            No cases found. Sync from Client Portal to get started.
          </div>
        ) : (
          <>
            {/* Mobile: stacked cards (below md) */}
            <div className="md:hidden divide-y divide-gray-100">
              {cases.map((caseItem) => {
                const awaitingAssignment = isAwaitingAssignment(caseItem)
                const caseManagerName = caseItem.assignedCaseManager?.name || caseItem.assignedCaseManager?.displayName
                const creator = getCreator(caseItem)
                return (
                  <div key={caseItem._id} className={`p-4 space-y-2.5 ${awaitingAssignment ? 'bg-amber-50/40' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-gray-900">{caseItem.caseNumber}</span>
                          {awaitingAssignment && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 shrink-0">
                              <Bell className="h-2.5 w-2.5" />
                              New
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-800 mt-0.5 truncate">{caseItem.clientName}</p>
                        <p className="text-xs text-gray-500 truncate">{caseItem.clientEmail}</p>
                      </div>
                      <span className={`shrink-0 px-2 py-1 text-xs font-medium rounded-full ${getStageColor(caseItem.stage)}`}>
                        {caseItem.stage?.replace('_', ' ')}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm text-gray-800 truncate">{resolveDisplayVisa(caseItem)}</p>
                        <p className="text-xs text-gray-500 capitalize truncate">
                          {getPackageLabel(caseItem)?.replace?.('_', ' ') || getPackageLabel(caseItem)}
                        </p>
                      </div>
                      <span className={`shrink-0 px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(caseItem.status)}`}>
                        {caseItem.status}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      {caseManagerName ? (
                        <p className="text-xs text-gray-500 truncate">{caseManagerName}</p>
                      ) : (
                        <span className="text-xs text-amber-700 font-medium">Awaiting assignment</span>
                      )}
                      <div className="flex items-center gap-2 shrink-0">
                        {awaitingAssignment && (
                          <button
                            onClick={() => navigate(`/crm-cases/${caseItem._id}?assign=case_manager`)}
                            title="Assign case manager"
                            className="p-1.5 rounded-lg text-amber-700 hover:bg-amber-100"
                          >
                            <UserPlus className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => navigate(`/crm-cases/${caseItem._id}`)}
                          className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-800 text-xs font-medium"
                        >
                          View <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 rounded-lg bg-white/70 px-2 py-1.5 text-xs text-gray-600">
                      <Calendar className="h-3.5 w-3.5 text-gray-400" />
                      <span className="font-medium text-gray-700">Created By</span>
                      <span className="truncate">{creator.name}</span>
                      {creator.role && <span className="shrink-0 text-gray-400">({formatRole(creator.role)})</span>}
                      {caseItem.createdAt && <span className="ml-auto shrink-0 text-gray-500">{formatCreatedDate(caseItem.createdAt)}</span>}
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
                <tr className="bg-gray-50">
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Case Number</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Client</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Visa / Package</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created By</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stage</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Case Manager</th>
                  <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((caseItem) => {
                    const awaitingAssignment = isAwaitingAssignment(caseItem)
                    const creator = getCreator(caseItem)
                    return (
                    <tr key={caseItem._id} className={`border-b hover:bg-gray-50 ${awaitingAssignment ? 'bg-amber-50/40' : ''}`}>
                      <td className="px-3 py-3 align-top">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-medium truncate" title={caseItem.caseNumber}>{caseItem.caseNumber}</span>
                          {awaitingAssignment && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 shrink-0">
                              <Bell className="h-2.5 w-2.5" />
                              New
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top min-w-0">
                        <p className="font-medium truncate" title={caseItem.clientName}>{caseItem.clientName}</p>
                        <p className="text-xs text-gray-500 truncate" title={caseItem.clientEmail}>{caseItem.clientEmail}</p>
                      </td>
                      <td className="px-3 py-3 align-top min-w-0">
                        <p className="truncate" title={resolveDisplayVisa(caseItem)}>{resolveDisplayVisa(caseItem)}</p>
                        <p className="text-xs text-gray-500 capitalize truncate">{getPackageLabel(caseItem)?.replace?.('_', ' ') || getPackageLabel(caseItem)}</p>
                      </td>
                      <td className="px-3 py-3 align-top min-w-0">
                        <p className="font-medium truncate" title={creator.name}>{creator.name}</p>
                        <p className="text-xs text-gray-500 truncate">
                          {formatRole(creator.role) || 'Creator'}{caseItem.createdAt ? ` - ${formatCreatedDate(caseItem.createdAt)}` : ''}
                        </p>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <span className={`inline-block max-w-full truncate px-2 py-1 text-xs font-medium rounded-full ${getStageColor(caseItem.stage)}`}>
                          {caseItem.stage?.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <span className={`inline-block max-w-full truncate px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(caseItem.status)}`}>
                          {caseItem.status}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-top min-w-0">
                        {caseItem.assignedCaseManager?.name || caseItem.assignedCaseManager?.displayName ? (
                          <p className="truncate" title={caseItem.assignedCaseManager?.name || caseItem.assignedCaseManager?.displayName}>
                            {caseItem.assignedCaseManager?.name || caseItem.assignedCaseManager?.displayName}
                          </p>
                        ) : (
                          <span className="text-amber-700 font-medium text-xs">Awaiting assignment</span>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="flex items-center justify-end gap-1.5">
                          {awaitingAssignment && (
                            <button
                              onClick={() => navigate(`/crm-cases/${caseItem._id}?assign=case_manager`)}
                              title="Assign case manager"
                              className="p-1.5 rounded-lg text-amber-700 hover:bg-amber-100 shrink-0"
                            >
                              <UserPlus className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            onClick={() => navigate(`/crm-cases/${caseItem._id}`)}
                            className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-800 text-xs font-medium shrink-0"
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
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="btn-secondary flex items-center gap-1 disabled:opacity-50"
          >
            <ChevronLeft className="w-4 h-4" />
            Previous
          </button>
          <span className="text-sm text-gray-600">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
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
