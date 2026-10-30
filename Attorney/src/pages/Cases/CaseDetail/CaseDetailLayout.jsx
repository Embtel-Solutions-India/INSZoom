import { Suspense, useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useParams, Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react'
import { attorneyApi } from '../../../services/api'
import CaseStatusBadge from '../../../components/CaseStatusBadge'
import WorkStateBadge, { isNotableCaseStatus } from '../../../components/WorkStateBadge'
import { useSocket } from '../../../context/SocketContext'

// Case-related tabs only — no Payments (no billing access, see
// permissions.registry.js's attorney grant), no Expert Letters (a stub
// upstream — fetchLetters() there never actually loads any data), no
// Strategy (a deliberate product decision, not an access gap), and no Notes
// (redundant with Feedback). "Messages" is deliberately NOT a tab here — it
// lives only in the top-level nav (see pages/Messages/) since it's
// cross-case, not case-scoped. Feedback IS case-scoped (attorney <-> case
// manager review dialogue on this one case specifically), so it stays a
// tab. Checklists (questionnaire answers) WAS excluded for the same
// "client-intake, not case-review material" reason as Strategy — reversed
// by explicit product decision so an attorney sees the same
// employer/employee, petitioner/beneficiary, and single-client checklist
// data the case manager does (questionnaires:read re-added to the attorney
// role's permission grant + questionnaire.routes.js's caseReaderRoles).
// USCIS Forms was tried and then explicitly reversed back out by product
// decision - an attorney should not see the forms tab at all, not even
// read-only (see FormsTab.jsx's removal + services/api.js's
// previewForm/downloadForm removal in the same change).
const TABS = [
  { to: 'overview', label: 'Overview' },
  { to: 'documents', label: 'Documents' },
  { to: 'checklists', label: 'Checklists' },
  { to: 'petition', label: 'Petition' },
  { to: 'tracking', label: 'USCIS Tracking' },
  { to: 'feedback', label: 'Feedback' },
  { to: 'timeline', label: 'Timeline' },
]

export default function CaseDetailLayout() {
  const { caseId } = useParams()
  const [caseData, setCaseData] = useState(null)
  const [error, setError] = useState('')
  // Bumped on every live case:updated/case:client_submitted push for this
  // case - every tab's own data-fetching useEffect depends on it (via
  // outlet context, same shape as `caseData`) so a case manager's edit
  // shows up here the same way it already does in Admin, instead of only
  // on next manual reload.
  const [refreshToken, setRefreshToken] = useState(0)
  const { subscribe, connected } = useSocket()
  // This attorney's own "review complete" state for the case (separate from the case's status).
  const [review, setReview] = useState({ status: 'in_review', workState: 'assigned' })
  const { pathname } = useLocation()
  const [reviewBusy, setReviewBusy] = useState(false)
  const [reviewError, setReviewError] = useState('')

  const toggleReview = async () => {
    const done = review.status === 'reviewed'
    setReviewBusy(true)
    setReviewError('')
    try {
      const { data } = await (done ? attorneyApi.reopenReview(caseId) : attorneyApi.completeReview(caseId))
      setReview({ ...data.review, workState: done ? 'active' : 'reviewed' })
    } catch (err) {
      setReviewError(err.response?.data?.message || 'Could not update the review. Please try again.')
    } finally {
      setReviewBusy(false)
    }
  }

  const fetchCase = useCallback(() => {
    return attorneyApi
      .case(caseId)
      .then(({ data }) => {
        setCaseData(data.case)
        // Keep "active" if the activity ping already landed while this request was in flight.
        setReview((prev) => {
          const incoming = data.review || { status: 'in_review', workState: 'assigned' }
          return prev.workState === 'active' && incoming.workState === 'assigned' ? { ...incoming, workState: 'active' } : incoming
        })
      })
      .catch((err) => {
        setError(
          err.response?.status === 403
            ? 'You do not have access to this case.'
            : err.response?.data?.message || 'Could not load this case.'
        )
      })
  }, [caseId])

  useEffect(() => {
    setCaseData(null)
    setError('')
    fetchCase()
  }, [caseId, fetchCase])

  // Opening the case, or moving to another tab of it, counts as work on it: the case becomes active for this attorney.
  // Fire-and-forget - a failed ping must never get in the way of reading the case.
  useEffect(() => {
    attorneyApi
      .recordActivity(caseId)
      .then(({ data }) => setReview((prev) => (prev.workState === 'reviewed' ? prev : { ...prev, workState: data.workState || 'active' })))
      .catch(() => {})
  }, [caseId, pathname])

  useEffect(() => {
    if (!connected) return
    const unsubUpdated = subscribe('case:updated', (payload) => {
      if (String(payload?.caseId) !== String(caseId)) return
      fetchCase()
      setRefreshToken((t) => t + 1)
    })
    const unsubSubmitted = subscribe('case:client_submitted', (payload) => {
      if (String(payload?._id) !== String(caseId)) return
      fetchCase()
      setRefreshToken((t) => t + 1)
    })
    // An answer saved, a document uploaded / reviewed or a checklist approved on this case (client portal or Admin): the tabs re-read it
    // (refreshToken). Bursts are coalesced server-side; this just re-reads.
    const unsubDataChanged = subscribe('case:data_changed', (payload) => {
      if (String(payload?.caseId) !== String(caseId)) return
      setRefreshToken((t) => t + 1)
    })
    return () => {
      unsubUpdated()
      unsubSubmitted()
      unsubDataChanged()
    }
  }, [connected, subscribe, caseId, fetchCase])

  if (error) {
    return (
      <div className="space-y-4">
        <Link to="/cases" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
          <ArrowLeft className="w-4 h-4" /> Back to my cases
        </Link>
        <div className="card text-center py-10">
          <h1 className="text-lg font-bold text-foreground font-serif mb-1">Access denied</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    )
  }
  if (!caseData) return <Loader2 className="w-6 h-6 animate-spin text-primary" />

  return (
    <div className="space-y-4">
      <Link to="/cases" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
        <ArrowLeft className="w-4 h-4" /> Back to my cases
      </Link>

      <div className="flex items-start sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-foreground font-serif break-words">{caseData.caseNumber || caseData.caseId}</h1>
          <p className="text-sm text-muted-foreground">{caseData.clientName} · {caseData.visaType}</p>
        </div>
        <div className="shrink-0 flex flex-col sm:flex-row items-end sm:items-center gap-2">
          <WorkStateBadge state={review.workState} />
          {isNotableCaseStatus(caseData.status) && <CaseStatusBadge status={caseData.status} />}
          {review.status === 'reviewed' ? (
            <div className="flex items-center gap-2">
              <span className="badge badge-success inline-flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Review complete{review.reviewedAt ? ` · ${new Date(review.reviewedAt).toLocaleDateString()}` : ''}
              </span>
              <button type="button" onClick={toggleReview} disabled={reviewBusy} className="text-xs text-muted-foreground hover:text-foreground underline disabled:opacity-50">
                Reopen
              </button>
            </div>
          ) : (
            <button type="button" onClick={toggleReview} disabled={reviewBusy} className="btn-primary inline-flex items-center gap-1.5 text-sm disabled:opacity-60">
              {reviewBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Review complete
            </button>
          )}
        </div>
      </div>
      {reviewError && <p className="text-xs text-destructive">{reviewError}</p>}

      <nav className="flex gap-1 border-b border-border overflow-x-auto overflow-y-hidden -mx-1 px-1 sm:mx-0 sm:px-0">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `px-3 sm:px-4 py-2.5 sm:py-2 text-sm font-medium whitespace-nowrap shrink-0 border-b-2 -mb-px transition-colors ${
                isActive ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Suspense fallback={<Loader2 className="w-6 h-6 animate-spin text-primary" />}>
        <Outlet context={{ caseData, refreshToken }} />
      </Suspense>
    </div>
  )
}
