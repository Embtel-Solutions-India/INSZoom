import { useState, useEffect, useRef } from 'react'
import api from '../services/api'
import { FileText, Calendar, User, CheckCircle, Clock, MessageSquare, Briefcase, Filter, Plus } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const EODReports = () => {
  const { user } = useAuth()
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [period, setPeriod] = useState('this_month')
  const [role, setRole] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedReport, setSelectedReport] = useState(null)
  const [reviewComment, setReviewComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 })

  const [newReport, setNewReport] = useState({
    casesWorked: 0,
    casesClosed: 0,
    documentsReviewed: 0,
    messagesReplied: 0,
    pendingTasks: 0,
    notes: ''
  })

  // Filters restart from page 1; the list also re-syncs from the database every 30s.
  useEffect(() => { setPage(1) }, [period, role])

  useEffect(() => {
    fetchReports()
    const timer = setInterval(fetchReports, 30000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, role, page])

  const isManager = ['super_admin', 'admin', 'team_lead'].includes(user?.role)
  const canCreate = ['team_lead', 'case_manager'].includes(user?.role)
  const isWeekend = [0, 6].includes(new Date(Date.now() + 330 * 60 * 1000).getUTCDay())
  const updateMetric = (field, value) => {
    const parsed = value === '' ? 0 : Number(value)
    setNewReport((current) => ({
      ...current,
      [field]: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
    }))
  }

  // Only the very first load blocks the list — changing period/role
  // afterwards updates the rows in place.
  const hasLoadedOnce = useRef(false)

  const fetchReports = async () => {
    try {
      if (!hasLoadedOnce.current) setLoading(true)
      const params = { page, limit: 25 }
      if (period) params.period = period
      if (role) params.role = role

      const response = await api.get('/reports/eod', { params })
      setReports(response.data.reports || response.data.items || response.data.data || [])
      if (response.data.pagination) {
        setPagination(response.data.pagination)
        if (response.data.pagination.page > response.data.pagination.pages) setPage(response.data.pagination.pages)
      }
      setError(null)
    } catch (error) {
      console.error('Error fetching EOD reports:', error)
      setError(error.response?.data?.message || error.message || 'Failed to load EOD reports')
      setReports([])
    } finally {
      hasLoadedOnce.current = true
      setLoading(false)
    }
  }

  const handleGenerateReport = async () => {
    try {
      setGenerating(true)
      setError(null)
      await api.post('/reports/eod/generate')
      fetchReports()
    } catch (error) {
      setError(error.response?.data?.message || error.message || 'Failed to generate EOD report')
    } finally {
      setGenerating(false)
    }
  }

  const handleCreateReport = async (e) => {
    e.preventDefault()
    try {
      setSubmitting(true)
      setError(null)
      await api.post('/reports/eod', newReport)
      setShowCreateModal(false)
      setNewReport({
        casesWorked: 0,
        casesClosed: 0,
        documentsReviewed: 0,
        messagesReplied: 0,
        pendingTasks: 0,
        notes: ''
      })
      fetchReports()
    } catch (error) {
      console.error('Error creating EOD report:', error)
      setError(error.response?.data?.message || error.message || 'Failed to create EOD report')
    } finally {
      setSubmitting(false)
    }
  }

  const handleMarkAsReviewed = async (reportId) => {
    try {
      await api.put(`/reports/eod/${reportId}/review`, { reviewComment })
      setSelectedReport(null)
      setReviewComment('')
      fetchReports()
    } catch (error) {
      console.error('Error marking report as reviewed:', error)
      setError(error.response?.data?.message || error.message || 'Failed to review EOD report')
    }
  }

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  const getRoleLabel = (r) => {
    const labels = {
      case_manager: 'Case Manager',
      finance: 'Finance',
      paralegal: 'Paralegal',
      reviewer: 'Reviewer',
      hr: 'HR',
      team_lead: 'Team Lead',
      sales_manager: 'Sales Manager',
    }
    return labels[r] || r
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">EOD Reports</h1>
          <p className="text-muted-foreground mt-1">Auto-generated at 6:15 AM IST on weekdays, or generate manually</p>
        </div>
        {canCreate && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleGenerateReport}
              disabled={generating || isWeekend}
              title={isWeekend ? 'EOD reports are not generated on Saturday or Sunday' : undefined}
              className="btn-primary flex items-center gap-2 disabled:opacity-60"
            >
              <FileText className="w-4 h-4" />
              {generating ? 'Generating...' : "Generate Today's Report"}
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              disabled={isWeekend}
              className="btn-secondary flex items-center gap-2 disabled:opacity-60"
            >
              <Plus className="w-4 h-4" />
              Create My Report
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">Filters:</span>
          </div>
          <div>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring"
            >
              <option value="">All Time</option>
              <option value="today">Today</option>
              <option value="this_week">This Week</option>
              <option value="this_month">This Month</option>
            </select>
          </div>
          {isManager && (
            <div>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring"
              >
                <option value="">All Roles</option>
                <option value="case_manager">Case Manager</option>
                <option value="team_lead">Team Lead</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Reports Table */}
      <div className="card">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-muted-foreground">Loading reports...</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-muted">
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Staff</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Role</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Cases Worked</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Cases Closed</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Docs Reviewed</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Messages</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Pending</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Source</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reports.length > 0 ? (
                  reports.map((report) => (
                    <tr key={report._id} className="border-b hover:bg-muted">
                      <td className="px-6 py-4 whitespace-nowrap font-medium">{report.staff?.name || report.staff?.displayName || report.staff?.email || 'Staff member'}</td>
                      <td className="px-6 py-4 whitespace-nowrap">{getRoleLabel(report.role)}</td>
                      <td className="px-6 py-4 whitespace-nowrap">{formatDate(report.date)}</td>
                      <td className="px-6 py-4 whitespace-nowrap">{report.casesWorked}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-green-600">{report.casesClosed}</td>
                      <td className="px-6 py-4 whitespace-nowrap">{report.documentsReviewed}</td>
                      <td className="px-6 py-4 whitespace-nowrap">{report.messagesReplied}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-amber-600">{report.pendingTasks}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {report.reviewed ? (
                          <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                            Reviewed
                          </span>
                        ) : (
                          <span className="px-2 py-1 text-xs font-medium bg-amber-100 text-amber-800 rounded-full">
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                          report.source === 'automatic' ? 'bg-primary/10 text-primary' : 'bg-secondary text-muted-foreground'
                        }`}>
                          {report.source === 'automatic' ? 'Auto-generated' : 'Manual'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          onClick={() => setSelectedReport(report)}
                          className="text-primary hover:text-primary/80 mr-2"
                        >
                          View
                        </button>
                        {isManager && !report.reviewed && (
                          <button
                            onClick={() => setSelectedReport(report)}
                            className="text-primary hover:text-primary/80"
                          >
                            Review
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={11} className="px-6 py-12 text-center text-muted-foreground">
                      No reports found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pagination.pages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {pagination.page} of {pagination.pages} · {pagination.total} reports</span>
          <div className="flex gap-2">
            <button className="btn-secondary disabled:opacity-50" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
            <button className="btn-secondary disabled:opacity-50" disabled={page >= pagination.pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      )}

      {/* Create Report Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-card rounded-2xl p-4 sm:p-6 w-full max-w-md">
            <h3 className="text-xl font-bold text-foreground mb-4">Create EOD Report</h3>
            <form onSubmit={handleCreateReport} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Cases Worked</label>
                <input
                  type="number"
                  value={newReport.casesWorked}
                  onChange={(e) => updateMetric('casesWorked', e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-ring"
                  min="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Cases Closed</label>
                <input
                  type="number"
                  value={newReport.casesClosed}
                  onChange={(e) => updateMetric('casesClosed', e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-ring"
                  min="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Documents Reviewed</label>
                <input
                  type="number"
                  value={newReport.documentsReviewed}
                  onChange={(e) => updateMetric('documentsReviewed', e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-ring"
                  min="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Messages Replied</label>
                <input
                  type="number"
                  value={newReport.messagesReplied}
                  onChange={(e) => updateMetric('messagesReplied', e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-ring"
                  min="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Pending Tasks</label>
                <input
                  type="number"
                  value={newReport.pendingTasks}
                  onChange={(e) => updateMetric('pendingTasks', e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-ring"
                  min="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Notes</label>
                <textarea
                  value={newReport.notes}
                  onChange={(e) => setNewReport({ ...newReport, notes: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-ring"
                  rows="3"
                />
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowCreateModal(false)} className="btn-secondary flex-1">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="btn-primary flex-1 disabled:opacity-60">
                  {submitting ? 'Creating...' : 'Submit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View/Review Report Modal */}
      {selectedReport && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-card rounded-2xl p-4 sm:p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-foreground mb-4">Report Details</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Staff</p>
                  <p className="font-medium">{selectedReport.staff?.name || selectedReport.staff?.displayName || selectedReport.staff?.email || 'Staff member'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Role</p>
                  <p className="font-medium">{getRoleLabel(selectedReport.role)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Date</p>
                  <p className="font-medium">{formatDate(selectedReport.date)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <p className="font-medium">{selectedReport.reviewed ? 'Reviewed' : 'Pending'}</p>
                </div>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t">
                <div className="p-3 bg-primary/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">Cases Worked</p>
                  <p className="text-xl font-bold text-primary">{selectedReport.casesWorked}</p>
                </div>
                <div className="p-3 bg-green-50 rounded-lg">
                  <p className="text-sm text-muted-foreground">Cases Closed</p>
                  <p className="text-xl font-bold text-green-600">{selectedReport.casesClosed}</p>
                </div>
                <div className="p-3 bg-primary/10 rounded-lg">
                  <p className="text-sm text-muted-foreground">Docs Reviewed</p>
                  <p className="text-xl font-bold text-primary">{selectedReport.documentsReviewed}</p>
                </div>
                <div className="p-3 bg-purple-50 rounded-lg">
                  <p className="text-sm text-muted-foreground">Messages Replied</p>
                  <p className="text-xl font-bold text-purple-600">{selectedReport.messagesReplied}</p>
                </div>
                <div className="p-3 bg-amber-50 rounded-lg col-span-2">
                  <p className="text-sm text-muted-foreground">Pending Tasks</p>
                  <p className="text-xl font-bold text-amber-600">{selectedReport.pendingTasks}</p>
                </div>
              </div>

              {selectedReport.notes && (
                <div className="pt-4 border-t">
                  <p className="text-sm text-muted-foreground mb-1">Notes</p>
                  <p className="text-foreground">{selectedReport.notes}</p>
                </div>
              )}

              {selectedReport.reviewed && (
                <div className="pt-4 border-t">
                  <p className="text-sm text-muted-foreground mb-1">Review Comment</p>
                  <p className="text-foreground">{selectedReport.reviewComment}</p>
                  <p className="text-sm text-muted-foreground mt-2">Reviewed by: {selectedReport.reviewedBy?.name}</p>
                </div>
              )}

              {isManager && !selectedReport.reviewed && (
                <div className="pt-4 border-t">
                  <label className="block text-sm font-medium text-muted-foreground mb-1">Review Comment</label>
                  <textarea
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-ring"
                    rows="3"
                    placeholder="Add your review comment..."
                  />
                  <button
                    onClick={() => handleMarkAsReviewed(selectedReport._id)}
                    className="btn-primary w-full mt-3"
                  >
                    Mark as Reviewed
                  </button>
                </div>
              )}

              <button
                onClick={() => {
                  setSelectedReport(null)
                  setReviewComment('')
                }}
                className="btn-secondary w-full"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default EODReports
