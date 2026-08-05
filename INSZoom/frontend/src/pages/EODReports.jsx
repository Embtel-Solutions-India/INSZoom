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

  const [newReport, setNewReport] = useState({
    casesWorked: 0,
    casesClosed: 0,
    documentsReviewed: 0,
    messagesReplied: 0,
    pendingTasks: 0,
    notes: ''
  })

  useEffect(() => {
    fetchReports()
  }, [period, role])

  const isManager = ['super_admin', 'admin', 'team_lead'].includes(user?.role)
  const canCreate = ['team_lead', 'sales_manager', 'case_manager', 'finance', 'paralegal', 'reviewer', 'hr'].includes(user?.role)
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
      const params = {}
      if (period) params.period = period
      if (role) params.role = role

      const response = await api.get('/reports/eod', { params })
      setReports(response.data.reports || response.data.items || response.data.data || [])
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">EOD Reports</h1>
          <p className="text-gray-600 mt-1">Daily, weekly, and monthly staff reports</p>
        </div>
        {canCreate && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Create My Report
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">Filters:</span>
          </div>
          <div>
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">All Roles</option>
                <option value="case_manager">Case Manager</option>
                <option value="finance">Finance</option>
                <option value="paralegal">Paralegal</option>
                <option value="reviewer">Reviewer</option>
                <option value="hr">HR</option>
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
            <div className="text-gray-600">Loading reports...</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Staff</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cases Worked</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cases Closed</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Docs Reviewed</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Messages</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Pending</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reports.length > 0 ? (
                  reports.map((report) => (
                    <tr key={report._id} className="border-b hover:bg-gray-50">
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
                          report.source === 'automatic' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'
                        }`}>
                          {report.source === 'automatic' ? 'Auto-generated' : 'Manual'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          onClick={() => setSelectedReport(report)}
                          className="text-blue-600 hover:text-blue-900 mr-2"
                        >
                          View
                        </button>
                        {isManager && !report.reviewed && (
                          <button
                            onClick={() => setSelectedReport(report)}
                            className="text-blue-600 hover:text-blue-900"
                          >
                            Review
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={11} className="px-6 py-12 text-center text-gray-500">
                      No reports found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Report Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Create EOD Report</h3>
            <form onSubmit={handleCreateReport} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cases Worked</label>
                <input
                  type="number"
                  value={newReport.casesWorked}
                  onChange={(e) => updateMetric('casesWorked', e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  min="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cases Closed</label>
                <input
                  type="number"
                  value={newReport.casesClosed}
                  onChange={(e) => updateMetric('casesClosed', e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  min="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Documents Reviewed</label>
                <input
                  type="number"
                  value={newReport.documentsReviewed}
                  onChange={(e) => updateMetric('documentsReviewed', e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  min="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Messages Replied</label>
                <input
                  type="number"
                  value={newReport.messagesReplied}
                  onChange={(e) => updateMetric('messagesReplied', e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  min="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Pending Tasks</label>
                <input
                  type="number"
                  value={newReport.pendingTasks}
                  onChange={(e) => updateMetric('pendingTasks', e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  min="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={newReport.notes}
                  onChange={(e) => setNewReport({ ...newReport, notes: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Report Details</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Staff</p>
                  <p className="font-medium">{selectedReport.staff?.name || selectedReport.staff?.displayName || selectedReport.staff?.email || 'Staff member'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Role</p>
                  <p className="font-medium">{getRoleLabel(selectedReport.role)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Date</p>
                  <p className="font-medium">{formatDate(selectedReport.date)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Status</p>
                  <p className="font-medium">{selectedReport.reviewed ? 'Reviewed' : 'Pending'}</p>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                <div className="p-3 bg-blue-50 rounded-lg">
                  <p className="text-sm text-gray-500">Cases Worked</p>
                  <p className="text-xl font-bold text-blue-600">{selectedReport.casesWorked}</p>
                </div>
                <div className="p-3 bg-green-50 rounded-lg">
                  <p className="text-sm text-gray-500">Cases Closed</p>
                  <p className="text-xl font-bold text-green-600">{selectedReport.casesClosed}</p>
                </div>
                <div className="p-3 bg-blue-50 rounded-lg">
                  <p className="text-sm text-gray-500">Docs Reviewed</p>
                  <p className="text-xl font-bold text-blue-600">{selectedReport.documentsReviewed}</p>
                </div>
                <div className="p-3 bg-purple-50 rounded-lg">
                  <p className="text-sm text-gray-500">Messages Replied</p>
                  <p className="text-xl font-bold text-purple-600">{selectedReport.messagesReplied}</p>
                </div>
                <div className="p-3 bg-amber-50 rounded-lg col-span-2">
                  <p className="text-sm text-gray-500">Pending Tasks</p>
                  <p className="text-xl font-bold text-amber-600">{selectedReport.pendingTasks}</p>
                </div>
              </div>

              {selectedReport.notes && (
                <div className="pt-4 border-t">
                  <p className="text-sm text-gray-500 mb-1">Notes</p>
                  <p className="text-gray-900">{selectedReport.notes}</p>
                </div>
              )}

              {selectedReport.reviewed && (
                <div className="pt-4 border-t">
                  <p className="text-sm text-gray-500 mb-1">Review Comment</p>
                  <p className="text-gray-900">{selectedReport.reviewComment}</p>
                  <p className="text-sm text-gray-500 mt-2">Reviewed by: {selectedReport.reviewedBy?.name}</p>
                </div>
              )}

              {isManager && !selectedReport.reviewed && (
                <div className="pt-4 border-t">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Review Comment</label>
                  <textarea
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
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
