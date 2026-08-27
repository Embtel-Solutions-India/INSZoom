import { useState, useEffect } from 'react'
import { casesApi, usersApi } from '../services/api'
import { X } from 'lucide-react'

const VISA_TYPE_OPTIONS = [
  { value: 'h1b', label: 'H-1B' },
  { value: 'h1b1', label: 'H-1B1' },
  { value: 'l1a', label: 'L-1A' },
  { value: 'l1b', label: 'L-1B' },
  { value: 'o1a', label: 'O-1A' },
  { value: 'o1b', label: 'O-1B' },
  { value: 'o2', label: 'O-2' },
  { value: 'p1a', label: 'P-1A' },
  { value: 'p1b', label: 'P-1B' },
  { value: 'p2', label: 'P-2' },
  { value: 'p3', label: 'P-3' },
  { value: 'tn', label: 'TN' },
  { value: 'e1', label: 'E-1' },
  { value: 'e2', label: 'E-2' },
  { value: 'e3', label: 'E-3' },
  { value: 'r1', label: 'R-1' },
  { value: 'k1', label: 'K-1' },
  { value: 'k3', label: 'K-3' },
  { value: 'i539cos', label: 'I-539-COS' },
  { value: 'i539ext', label: 'I-539-EXT' },
  { value: 'eb1a', label: 'EB-1A' },
  { value: 'eb2', label: 'EB-2' },
  { value: 'niw', label: 'EB-2 NIW' },
  { value: 'eb3', label: 'EB-3' },
]

const PACKAGE_OPTIONS = [
  { value: '', label: 'Not selected' },
  { value: 'Self Filing Package', label: 'Self Filing Package' },
  { value: 'Attorney Review Package', label: 'Attorney Review Package' },
  { value: 'Full Attorney Filing Package', label: 'Full Attorney Filing Package' },
]

const EMPLOYMENT_VISA_TYPES = new Set(['h1b', 'h1b1', 'l1a', 'l1b', 'o1a', 'o1b', 'o2', 'p1a', 'p1b', 'p2', 'p3', 'tn', 'e1', 'e2', 'e3', 'r1'])

const initialForm = {
  clientName: '',
  clientEmail: '',
  clientPhone: '',
  visaType: '',
  packageName: '',
  assignedCaseManager: '',
  employerName: '',
  employerEmail: '',
  employerCompletionMode: '',
  caseDetails: '',
}

const normalizeInitialVisaType = (value) => {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return ''
  const match = VISA_TYPE_OPTIONS.find((opt) => (
    opt.value.toLowerCase() === normalized ||
    opt.label.toLowerCase() === normalized
  ))
  return match?.value || ''
}

const buildInitialForm = (initialData) => ({
  ...initialForm,
  clientName: initialData?.clientName || '',
  clientEmail: initialData?.clientEmail || '',
  clientPhone: initialData?.clientPhone || '',
  visaType: normalizeInitialVisaType(initialData?.visaType),
})

// Available to admins and team leads through POST /cases. A team lead assigning
// here picks from the same case-manager roster as an admin would.
const CreateCaseModal = ({
  onClose,
  onCreated,
  initialData = null,
  leadId = null,
  creationSource = 'admin_direct',
}) => {
  const [form, setForm] = useState(() => buildInitialForm(initialData))
  const [caseManagers, setCaseManagers] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const showEmployerFields = EMPLOYMENT_VISA_TYPES.has(form.visaType)

  useEffect(() => {
    usersApi.caseManagers()
      .then((res) => setCaseManagers(res.data?.caseManagers || []))
      .catch((err) => console.error('Error fetching case managers:', err))
  }, [])

  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      // Send the display label ("H-1B"), not the raw code ("h1b") — matches
      // the visaType format BAIS's self-registration intake sends, so both
      // paths render identically in the cases table and downstream forms.
      const visaTypeLabel = VISA_TYPE_OPTIONS.find((opt) => opt.value === form.visaType)?.label || form.visaType
      const payload = {
        clientName: form.clientName.trim(),
        clientEmail: form.clientEmail.trim(),
        visaType: visaTypeLabel,
        childCaseCount: showEmployerFields ? Number(initialData?.childCaseCount || 1) : 0,
        creationSource,
      }
      if (leadId) payload.leadId = leadId
      if (form.clientPhone.trim()) payload.clientPhone = form.clientPhone.trim()
      if (initialData?.extension) payload.extension = initialData.extension
      if (initialData?.packageId) payload.packageId = initialData.packageId
      if (form.packageName) payload.packageName = form.packageName
      if (form.assignedCaseManager) payload.assignedCaseManager = form.assignedCaseManager
      if (form.caseDetails.trim()) payload.caseDetails = form.caseDetails.trim()
      if (showEmployerFields) {
        if (form.employerName.trim()) payload.employerName = form.employerName.trim()
        if (form.employerEmail.trim()) payload.employerEmail = form.employerEmail.trim()
        if (form.employerCompletionMode) payload.employerCompletionMode = form.employerCompletionMode
      }

      const res = await casesApi.create(payload)
      const result = res.data || {}
      onCreated?.({
        ...result,
        case: result.case || result.principalCase,
      })
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create case. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-gray-900">New Case</h3>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded-lg"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Client Name *</label>
            <input
              type="text"
              required
              value={form.clientName}
              onChange={handleChange('clientName')}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Jane Doe"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Client Email *</label>
            <input
              type="email"
              required
              value={form.clientEmail}
              onChange={handleChange('clientEmail')}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="jane@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Client Phone</label>
            <input
              type="tel"
              value={form.clientPhone}
              onChange={handleChange('clientPhone')}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="(555) 555-5555"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Visa Type *</label>
            <select
              required
              value={form.visaType}
              onChange={handleChange('visaType')}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="" disabled>Select visa type</option>
              {VISA_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Package</label>
            <select
              value={form.packageName}
              onChange={handleChange('packageName')}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {PACKAGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Assign Case Manager</label>
            <select
              value={form.assignedCaseManager}
              onChange={handleChange('assignedCaseManager')}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Unassigned (team lead queue)</option>
              {caseManagers.map((cm) => (
                <option key={cm._id} value={cm._id}>{cm.name || cm.displayName || cm.email}</option>
              ))}
            </select>
          </div>

          {showEmployerFields && (
            <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Employer</label>
                <input
                  type="text"
                  value={form.employerName}
                  onChange={handleChange('employerName')}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Company or organization name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Employer Email</label>
                <input
                  type="email"
                  value={form.employerEmail}
                  onChange={handleChange('employerEmail')}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="hr@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Employer Workflow</label>
                <select
                  value={form.employerCompletionMode}
                  onChange={handleChange('employerCompletionMode')}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Decide later</option>
                  <option value="employer_completes">Fill company information themselves</option>
                  <option value="invite_employees">Invite employees</option>
                </select>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Case Details</label>
            <textarea
              rows={3}
              value={form.caseDetails}
              onChange={handleChange('caseDetails')}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Internal notes, role details, deadlines, or filing context"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="btn-primary flex-1 disabled:opacity-50">
              {submitting ? 'Creating…' : 'Create Case'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default CreateCaseModal
