import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'
import {
  ArrowLeft,
  Edit,
  CheckCircle,
  Clock,
  AlertTriangle,
  Calendar,
  User,
  FileText,
  MessageSquare,
  Paperclip,
  MoreVertical,
  Play,
  Pause,
  X,
  Save,
  Send
} from 'lucide-react'

const EMPTY_TASK = {
  title: '',
  description: '',
  caseId: '',
  assignedTo: '',
  department: 'documentation',
  category: 'document_review',
  status: 'pending',
  priority: 'medium',
  dueDate: '',
  progress: 0,
  estimatedHours: 0,
  documentation: {
    workType: 'document_collection',
    documentType: '',
    evidenceCategory: 'identity',
    instructions: '',
    reviewRequired: true,
    reviewStatus: 'not_started',
  },
}

const DEPARTMENTS = [
  ['documentation', 'Documentation'],
  ['case_management', 'Case Management'],
  ['legal', 'Legal'],
  ['client_services', 'Client Services'],
  ['finance', 'Finance'],
]

const TASK_CATEGORIES = [
  ['document_review', 'Document Review'],
  ['case_preparation', 'Case Preparation'],
  ['legal_review', 'Legal Review'],
  ['filing', 'Filing Package'],
  ['rfe_response', 'RFE Response'],
  ['client_communication', 'Client Communication'],
  ['follow_up', 'Follow Up'],
  ['finance', 'Finance'],
  ['administrative', 'Administrative'],
]

const DOCUMENT_WORK_TYPES = [
  ['intake_review', 'Intake Review'],
  ['document_request', 'Request Documents'],
  ['document_collection', 'Collect Documents'],
  ['ocr_verification', 'Verify OCR Extraction'],
  ['document_classification', 'Classify Document'],
  ['evidence_index', 'Build Evidence Index'],
  ['quality_control', 'Quality Control'],
  ['translation', 'Translation'],
  ['certification', 'Certification'],
  ['uscis_notice', 'Process USCIS Notice'],
  ['rfe_evidence', 'Prepare RFE Evidence'],
  ['filing_package', 'Prepare Filing Package'],
  ['client_follow_up', 'Client Follow-up'],
  ['other', 'Other Documentation Work'],
]

const EVIDENCE_CATEGORIES = [
  ['identity', 'Identity'],
  ['immigration', 'Immigration'],
  ['education', 'Education'],
  ['employment', 'Employment'],
  ['financial', 'Financial'],
  ['civil', 'Civil'],
  ['business', 'Business'],
  ['medical', 'Medical'],
  ['legal', 'Legal'],
  ['supporting', 'Supporting Evidence'],
  ['other', 'Other'],
]

const toDateTimeInput = (value) => {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  const offset = parsed.getTimezoneOffset() * 60000
  return new Date(parsed.getTime() - offset).toISOString().slice(0, 16)
}

const TaskDetails = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isCreating = !id || id === 'create'
  const [task, setTask] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)
  const [editData, setEditData] = useState({})
  const [newComment, setNewComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [assignableUsers, setAssignableUsers] = useState([])
  const [cases, setCases] = useState([])

  // Role helper
  const is = (roles) => roles.includes(user?.role)

  useEffect(() => {
    fetchTask()
  }, [id])

  useEffect(() => {
    if (!isCreating) return
    const currentUser = user ? [{
      _id: user._id || user.id,
      name: user.name || user.displayName,
      email: user.email,
      role: user.role,
    }] : []
    Promise.allSettled([
      api.get('/users/assignable'),
      api.get('/cases', { params: { limit: 200, sortBy: 'updatedAt', sortOrder: 'desc' } }),
    ]).then(([usersResult, casesResult]) => {
      const users = usersResult.status === 'fulfilled' ? usersResult.value.data.users || [] : currentUser
      setAssignableUsers(users.length ? users : currentUser)
      if (casesResult.status === 'fulfilled') {
        setCases(casesResult.value.data.cases || casesResult.value.data.items || casesResult.value.data.data || [])
      }
    })
  }, [isCreating, user])

  const fetchTask = async () => {
    // Don't fetch if we're creating a new task
    if (isCreating) {
      const initial = {
        ...EMPTY_TASK,
        assignedTo: user?._id || user?.id || '',
        documentation: { ...EMPTY_TASK.documentation },
      }
      setTask(initial)
      setEditData(initial)
      setEditing(true)
      setError(null)
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      const response = await api.get(`/tasks/${id}`)
      const nextTask = response.data.task || {}
      setTask(nextTask)
      setEditData({
        title: nextTask.title || '',
        description: nextTask.description || '',
        status: nextTask.status || 'pending',
        priority: nextTask.priority || 'medium',
        dueDate: toDateTimeInput(nextTask.dueDate),
        progress: nextTask.progress || 0,
        category: nextTask.category || 'case_preparation',
        department: nextTask.department || '',
        caseId: nextTask.caseId?._id || nextTask.caseId || '',
        assignedTo: nextTask.assignedTo?._id || nextTask.assignedTo || '',
        estimatedHours: nextTask.estimatedHours || 0,
        documentation: {
          ...EMPTY_TASK.documentation,
          ...(nextTask.documentation || {}),
        },
      })
      setError(null)
    } catch (error) {
      console.error('Error fetching task:', error)
      setError('Failed to load task details')
    } finally {
      setLoading(false)
    }
  }

  const handleSaveEdit = async () => {
    try {
      if (!String(editData.title || '').trim()) {
        setError('Task title is required')
        return
      }
      if (isCreating && !editData.assignedTo) {
        setError('Select an employee responsible for this task')
        return
      }
      setSubmitting(true)
      setError(null)
      
      if (isCreating) {
        const taskData = {
          ...editData,
          title: editData.title.trim(),
          description: String(editData.description || '').trim(),
          dueDate: editData.dueDate || undefined,
          caseId: editData.caseId || undefined,
        }
        const response = await api.post('/tasks', taskData)
        const createdTask = response.data.task || response.data.data
        if (!createdTask?._id) throw new Error('Task was created without a valid identifier')
        navigate(`/tasks/${createdTask._id}`, { replace: true })
      } else {
        await api.put(`/tasks/${id}`, editData)
        setEditing(false)
        fetchTask()
      }
    } catch (error) {
      console.error('Error saving task:', error)
      setError(error.response?.data?.message || (isCreating ? 'Failed to create task' : 'Failed to update task'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleAddComment = async () => {
    if (!newComment.trim()) return

    try {
      setSubmitting(true)
      await api.post(`/tasks/${id}/comments`, { text: newComment })
      setNewComment('')
      fetchTask()
    } catch (error) {
      console.error('Error adding comment:', error)
      setError('Failed to add comment')
    } finally {
      setSubmitting(false)
    }
  }

  const handleStatusChange = async (newStatus) => {
    try {
      setSubmitting(true)
      await api.put(`/tasks/${id}`, { status: newStatus })
      fetchTask()
    } catch (error) {
      console.error('Error updating status:', error)
      setError('Failed to update status')
    } finally {
      setSubmitting(false)
    }
  }

  const getStatusColor = (status) => {
    const colors = {
      pending: 'bg-gray-100 text-gray-800',
      assigned: 'bg-blue-100 text-blue-800',
      in_progress: 'bg-yellow-100 text-yellow-800',
      waiting: 'bg-orange-100 text-orange-800',
      completed: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800'
    }
    return colors[status] || 'bg-gray-100 text-gray-800'
  }

  const getPriorityColor = (priority) => {
    const colors = {
      low: 'bg-gray-100 text-gray-800',
      medium: 'bg-blue-100 text-blue-800',
      high: 'bg-orange-100 text-orange-800',
      urgent: 'bg-red-100 text-red-800'
    }
    return colors[priority] || 'bg-gray-100 text-gray-800'
  }

  const formatStatus = (status) => {
    return String(status || 'pending').split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
  }

  const formatDate = (date) => {
    if (!date) return 'Not set'
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const canAssignOthers = is(['super_admin', 'admin', 'team_lead'])
  const assigneeOptions = canAssignOthers
    ? assignableUsers
    : assignableUsers.filter((member) => String(member._id) === String(user?._id || user?.id))
  const showDocumentationFields = editData.department === 'documentation' || editData.category === 'document_review'

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (!task) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Task Not Found</h2>
        <button
          onClick={() => navigate('/tasks')}
          className="text-blue-600 hover:text-blue-700"
        >
          Back to Tasks
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{isCreating ? 'Create Immigration Task' : 'Task Details'}</h1>
            <p className="text-gray-600 mt-1">
              {isCreating ? 'Assign structured case and documentation work' : `Task ID: ${task._id}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isCreating && !editing && (
            <>
              {is(['super_admin', 'admin', 'team_lead', 'case_manager']) && (
                <button
                  onClick={() => setEditing(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Edit className="w-4 h-4" />
                  Edit
                </button>
              )}
              {is(['super_admin', 'admin']) && (
                <button className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">
                  <X className="w-4 h-4" />
                  Delete
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className={`${isCreating ? 'lg:col-span-3' : 'lg:col-span-2'} space-y-6`}>
          {/* Task Information */}
          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
            {editing ? (
              <div className="space-y-4">
                {isCreating && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Related Case</label>
                      <select
                        value={editData.caseId || ''}
                        onChange={(event) => setEditData({ ...editData, caseId: event.target.value })}
                        className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">General task (no case)</option>
                        {cases.map((caseItem) => (
                          <option key={caseItem._id} value={caseItem._id}>
                            {caseItem.caseNumber || caseItem.caseId} - {caseItem.clientName || caseItem.clientEmail || 'Client'}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Assigned Employee</label>
                      <select
                        value={editData.assignedTo || ''}
                        onChange={(event) => setEditData({ ...editData, assignedTo: event.target.value })}
                        className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">Select employee</option>
                        {assigneeOptions.map((member) => (
                          <option key={member._id} value={member._id}>
                            {member.name || member.displayName || member.email} ({formatStatus(member.role)})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                  <input
                    type="text"
                    value={editData.title}
                    onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    value={editData.description}
                    onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={4}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
                    <select
                      value={editData.department || ''}
                      onChange={(event) => setEditData({ ...editData, department: event.target.value })}
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {DEPARTMENTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Task Category</label>
                    <select
                      value={editData.category || 'case_preparation'}
                      onChange={(event) => setEditData({ ...editData, category: event.target.value })}
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {TASK_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </div>
                </div>
                {showDocumentationFields && (
                  <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4 space-y-4">
                    <div>
                      <h3 className="font-semibold text-gray-900">Documentation Work Details</h3>
                      <p className="text-sm text-gray-600">Define the document operation and evidence review required.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Work Type</label>
                        <select
                          value={editData.documentation?.workType || ''}
                          onChange={(event) => setEditData({
                            ...editData,
                            documentation: { ...editData.documentation, workType: event.target.value },
                          })}
                          className="w-full px-4 py-2 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {DOCUMENT_WORK_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Evidence Category</label>
                        <select
                          value={editData.documentation?.evidenceCategory || ''}
                          onChange={(event) => setEditData({
                            ...editData,
                            documentation: { ...editData.documentation, evidenceCategory: event.target.value },
                          })}
                          className="w-full px-4 py-2 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {EVIDENCE_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Document Type</label>
                      <input
                        type="text"
                        value={editData.documentation?.documentType || ''}
                        onChange={(event) => setEditData({
                          ...editData,
                          documentation: { ...editData.documentation, documentType: event.target.value },
                        })}
                        placeholder="e.g. Passport, Degree, I-797 Notice, Employment Letter"
                        className="w-full px-4 py-2 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Processing Instructions</label>
                      <textarea
                        value={editData.documentation?.instructions || ''}
                        onChange={(event) => setEditData({
                          ...editData,
                          documentation: { ...editData.documentation, instructions: event.target.value },
                        })}
                        rows={3}
                        placeholder="Required checks, naming standards, USCIS relevance, and delivery expectations"
                        className="w-full px-4 py-2 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                      <input
                        type="checkbox"
                        checked={editData.documentation?.reviewRequired !== false}
                        onChange={(event) => setEditData({
                          ...editData,
                          documentation: { ...editData.documentation, reviewRequired: event.target.checked },
                        })}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      Require case manager review
                    </label>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                    <select
                      value={editData.status}
                      onChange={(e) => setEditData({ ...editData, status: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="pending">Pending</option>
                      <option value="assigned">Assigned</option>
                      <option value="in_progress">In Progress</option>
                      <option value="waiting">Waiting</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                    <select
                      value={editData.priority}
                      onChange={(e) => setEditData({ ...editData, priority: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                    <input
                      type="datetime-local"
                      value={editData.dueDate}
                      onChange={(e) => setEditData({ ...editData, dueDate: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Progress (%)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={editData.progress}
                      onChange={(e) => setEditData({ ...editData, progress: parseInt(e.target.value) })}
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Estimated Hours</label>
                  <input
                    type="number"
                    min="0"
                    step="0.25"
                    value={editData.estimatedHours || 0}
                    onChange={(event) => setEditData({ ...editData, estimatedHours: Number(event.target.value) })}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveEdit}
                    disabled={submitting}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    {submitting ? 'Saving...' : isCreating ? 'Create Task' : 'Save Changes'}
                  </button>
                  <button
                    onClick={() => isCreating ? navigate('/tasks') : setEditing(false)}
                    className="px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-start justify-between mb-4">
                  <h2 className="text-xl font-bold text-gray-900">{task.title}</h2>
                  <div className="flex items-center gap-2">
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${getPriorityColor(task.priority)}`}>
                      {String(task.priority || 'medium').charAt(0).toUpperCase() + String(task.priority || 'medium').slice(1)} Priority
                    </span>
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(task.status)}`}>
                      {formatStatus(task.status)}
                    </span>
                  </div>
                </div>

                {task.description && (
                  <p className="text-gray-600 mb-4">{task.description}</p>
                )}

                {task.documentation?.workType && (
                  <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50/50 p-4">
                    <p className="font-semibold text-gray-900">Documentation Work</p>
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-gray-600">
                      <span>Work type: {formatStatus(task.documentation.workType)}</span>
                      <span>Evidence: {formatStatus(task.documentation.evidenceCategory)}</span>
                      {task.documentation.documentType && <span>Document: {task.documentation.documentType}</span>}
                      <span>Review: {task.documentation.reviewRequired === false ? 'Not required' : formatStatus(task.documentation.reviewStatus)}</span>
                    </div>
                    {task.documentation.instructions && <p className="mt-2 text-sm text-gray-700">{task.documentation.instructions}</p>}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Calendar className="w-4 h-4" />
                    <span>Due: {formatDate(task.dueDate)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <User className="w-4 h-4" />
                    <span>Assigned to: {task.assignedTo?.name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <User className="w-4 h-4" />
                    <span>Assigned by: {task.assignedBy?.name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <FileText className="w-4 h-4" />
                    <span>Category: {formatStatus(task.category || 'general')}</span>
                  </div>
                </div>

                {/* Progress Bar */}
                <div>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium text-gray-700">Progress</span>
                    <span className="text-gray-600">{task.progress || 0}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all"
                      style={{ width: `${Math.min(Math.max(Number(task.progress) || 0, 0), 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Case Information */}
          {task.caseId && (
            <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Linked Case</h3>
              <div className="p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-gray-900">{task.caseId.caseNumber}</p>
                    <p className="text-sm text-gray-600">{task.caseId.clientName}</p>
                  </div>
                  <button
                    onClick={() => navigate(`/crm-cases/${task.caseId._id}`)}
                    className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                  >
                    View Case
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Comments */}
          {!isCreating && <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Comments ({task.comments?.length || 0})</h3>
            
            <div className="space-y-3 mb-4">
              {task.comments && task.comments.length > 0 ? (
                (task.comments || []).map(comment => (
                  <div key={comment._id} className="p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-start justify-between mb-1">
                      <span className="font-medium text-gray-900">{comment.author?.name}</span>
                      <span className="text-xs text-gray-500">
                        {new Date(comment.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600">{comment.text}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500 text-center py-4">No comments yet</p>
              )}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment..."
                className="flex-1 px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                onKeyPress={(e) => e.key === 'Enter' && handleAddComment()}
              />
              <button
                onClick={handleAddComment}
                disabled={submitting || !newComment.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                {submitting ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>}
        </div>

        {/* Sidebar */}
        {!isCreating && <div className="space-y-6">
          {/* Quick Actions */}
          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
            <div className="space-y-2">
              {task.status !== 'completed' && (
                <button
                  onClick={() => handleStatusChange('completed')}
                  disabled={submitting}
                  className="w-full flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  <CheckCircle className="w-4 h-4" />
                  Mark Complete
                </button>
              )}
              {task.status !== 'in_progress' && task.status !== 'completed' && (
                <button
                  onClick={() => handleStatusChange('in_progress')}
                  disabled={submitting}
                  className="w-full flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  <Play className="w-4 h-4" />
                  Start Progress
                </button>
              )}
              {task.status === 'in_progress' && (
                <button
                  onClick={() => handleStatusChange('waiting')}
                  disabled={submitting}
                  className="w-full flex items-center gap-2 px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors disabled:opacity-50"
                >
                  <Pause className="w-4 h-4" />
                  Pause
                </button>
              )}
              {is(['super_admin', 'admin', 'team_lead']) && task.status !== 'cancelled' && (
                <button
                  onClick={() => handleStatusChange('cancelled')}
                  disabled={submitting}
                  className="w-full flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  <X className="w-4 h-4" />
                  Cancel Task
                </button>
              )}
            </div>
          </div>

          {/* Attachments */}
          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Attachments ({task.attachments?.length || 0})</h3>
            {task.attachments && task.attachments.length > 0 ? (
              <div className="space-y-2">
                {(task.attachments || []).map((attachment, index) => (
                  <div key={index} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                    <Paperclip className="w-4 h-4 text-gray-600" />
                    <span className="text-sm text-gray-700 flex-1">{attachment.fileName}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 text-center py-4">No attachments</p>
            )}
          </div>

          {/* Task Metadata */}
          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Task Information</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Created</span>
                <span className="text-gray-900">{formatDate(task.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Last Updated</span>
                <span className="text-gray-900">{formatDate(task.updatedAt)}</span>
              </div>
              {task.completionDate && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Completed</span>
                  <span className="text-gray-900">{formatDate(task.completionDate)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-600">Estimated Hours</span>
                <span className="text-gray-900">{task.estimatedHours}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Actual Hours</span>
                <span className="text-gray-900">{task.actualHours}</span>
              </div>
            </div>
          </div>
        </div>}
      </div>
    </div>
  )
}

export default TaskDetails
