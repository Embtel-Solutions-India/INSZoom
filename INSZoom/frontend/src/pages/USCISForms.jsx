import { useState, useEffect } from 'react'
import api from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import {
  FileText,
  Plus,
  RefreshCw,
  CheckCircle,
  X,
  Edit,
  Trash2,
  Search,
  Filter,
  Eye,
  AlertTriangle
} from 'lucide-react'

const USCISForms = () => {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState('templates')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Tab 1: Form Templates
  const [templates, setTemplates] = useState([])
  const [lifecycle, setLifecycle] = useState({ forms: [], dashboard: {} })
  const [selectedLifecycleForm, setSelectedLifecycleForm] = useState(null)
  const [comparisonReport, setComparisonReport] = useState(null)
  const [showAddTemplateModal, setShowAddTemplateModal] = useState(false)
  const [showEditTemplateModal, setShowEditTemplateModal] = useState(false)
  const [showImportDefinitionModal, setShowImportDefinitionModal] = useState(false)
  const [showImportPdfModal, setShowImportPdfModal] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [definitionJson, setDefinitionJson] = useState('')
  const [definitionValidation, setDefinitionValidation] = useState(null)
  const [pdfImportFile, setPdfImportFile] = useState(null)
  const [pdfImportResult, setPdfImportResult] = useState(null)
  const [pdfImportData, setPdfImportData] = useState({
    pdfUrl: '',
    formType: '',
    editionDate: '',
    provider: 'uscis'
  })
  const [templateFormData, setTemplateFormData] = useState({
    formCode: '',
    title: '',
    description: '',
    version: '',
    editionDate: '',
    effectiveDate: '',
    officialPdfUrl: '',
    visaTypes: []
  })

  // Tab 2: Case Forms
  const [caseForms, setCaseForms] = useState([])
  const [cases, setCases] = useState([])
  const [filterCaseId, setFilterCaseId] = useState('')
  const [searchCaseNumber, setSearchCaseNumber] = useState('')
  const [showFillFormModal, setShowFillFormModal] = useState(false)
  const [showViewFormModal, setShowViewFormModal] = useState(false)
  const [selectedCaseForm, setSelectedCaseForm] = useState(null)
  const [fillFormData, setFillFormData] = useState({
    caseId: '',
    formTemplateId: ''
  })

  useEffect(() => {
    if (activeTab === 'templates') {
      fetchTemplates()
    } else if (activeTab === 'lifecycle') {
      fetchLifecycle()
    } else {
      fetchCases()
    }
  }, [activeTab])

  const fetchTemplates = async () => {
    try {
      setLoading(true)
      const response = await api.get('/uscis-forms')
      setTemplates(response.data.forms || response.data.items || response.data.data || [])
    } catch (error) {
      setError('Failed to load form templates')
    } finally {
      setLoading(false)
    }
  }

  const fetchLifecycle = async () => {
    try {
      setLoading(true)
      const response = await api.get('/uscis/forms')
      setLifecycle(response.data.data || { forms: [], dashboard: {} })
    } catch (error) {
      setError('Failed to load USCIS lifecycle dashboard')
    } finally {
      setLoading(false)
    }
  }

  const fetchCases = async () => {
    try {
      const response = await api.get('/cases')
      setCases(response.data.cases || [])
    } catch (error) {
      console.error('Error fetching cases:', error)
    }
  }

  const fetchCaseForms = async () => {
    try {
      setLoading(true)
      let url = '/uscis-forms/case'
      if (filterCaseId) {
        url += `/${filterCaseId}`
      }
      const response = await api.get(url)
      setCaseForms(response.data.caseForms || response.data.forms || response.data.data || [])
    } catch (error) {
      setError('Failed to load case forms')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'forms') {
      fetchCaseForms()
    }
  }, [activeTab, filterCaseId])

  const handleCheckUpdates = async () => {
    try {
      const response = await api.post('/uscis/forms/scan')
      alert(response.data.message || 'Form update check completed')
      fetchTemplates()
      if (activeTab === 'lifecycle') fetchLifecycle()
    } catch (error) {
      setError('Failed to check for updates')
    }
  }

  const handleLifecycleAction = async (templateId, action) => {
    try {
      await api.post(`/uscis/forms/${templateId}/${action}`)
      fetchLifecycle()
      fetchTemplates()
    } catch (error) {
      setError(`Failed to ${action} form version`)
    }
  }

  const handleCompareVersion = async (template) => {
    try {
      const response = await api.get(`/uscis/forms/${template.formCode}/compare/${template._id}`)
      setSelectedLifecycleForm(template)
      setComparisonReport(response.data.data)
    } catch (error) {
      setError('Failed to compare form version')
    }
  }

  const handleApproveVersion = async (templateId) => {
    try {
      await api.put(`/uscis-forms/${templateId}/approve`)
      alert('Form version approved successfully')
      fetchTemplates()
    } catch (error) {
      setError('Failed to approve form version')
    }
  }

  const handleArchiveVersion = async (templateId) => {
    try {
      await api.put(`/uscis-forms/${templateId}/archive`)
      fetchTemplates()
    } catch (error) {
      setError('Failed to archive form version')
    }
  }

  const parseDefinitionJson = () => {
    try {
      return JSON.parse(definitionJson)
    } catch {
      setDefinitionValidation({ valid: false, errors: ['Definition must be valid JSON'] })
      return null
    }
  }

  const handleValidateDefinition = async () => {
    const definition = parseDefinitionJson()
    if (!definition) return
    try {
      const response = await api.post('/uscis-forms/definitions/validate', { definition })
      setDefinitionValidation({ valid: true, summary: response.data.validation, errors: [] })
    } catch (error) {
      setDefinitionValidation({ valid: false, errors: error.response?.data?.errors || ['Definition validation failed'] })
    }
  }

  const handleImportDefinition = async () => {
    const definition = parseDefinitionJson()
    if (!definition) return
    try {
      await api.post('/uscis-forms/definitions/import', { definition })
      setShowImportDefinitionModal(false)
      setDefinitionJson('')
      setDefinitionValidation(null)
      fetchTemplates()
    } catch (error) {
      setDefinitionValidation({ valid: false, errors: error.response?.data?.details || error.response?.data?.errors || ['Definition import failed'] })
    }
  }

  const handlePdfUploadImport = async () => {
    if (!pdfImportFile) {
      setPdfImportResult({ success: false, message: 'Select a USCIS PDF to import' })
      return
    }
    try {
      const formData = new FormData()
      formData.append('pdf', pdfImportFile)
      Object.entries(pdfImportData).forEach(([key, value]) => {
        if (value) formData.append(key, value)
      })
      const response = await api.post('/uscis/forms/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      setPdfImportResult({
        success: true,
        message: response.data.duplicate ? 'Duplicate detected; existing template returned.' : 'PDF imported successfully.',
        template: response.data.template,
        fieldCount: response.data.fieldCount,
        comparisonReport: response.data.comparisonReport
      })
      fetchTemplates()
      if (activeTab === 'lifecycle') fetchLifecycle()
    } catch (error) {
      setPdfImportResult({
        success: false,
        message: error.response?.data?.message || 'PDF import failed',
        details: error.response?.data?.details || []
      })
    }
  }

  const handlePdfUrlImport = async () => {
    if (!pdfImportData.pdfUrl) {
      setPdfImportResult({ success: false, message: 'Enter an official USCIS PDF URL' })
      return
    }
    try {
      const response = await api.post('/uscis/forms/import', pdfImportData)
      setPdfImportResult({
        success: true,
        message: response.data.duplicate ? 'Duplicate detected; existing template returned.' : 'PDF imported successfully.',
        template: response.data.template,
        fieldCount: response.data.fieldCount,
        comparisonReport: response.data.comparisonReport
      })
      fetchTemplates()
      if (activeTab === 'lifecycle') fetchLifecycle()
    } catch (error) {
      setPdfImportResult({
        success: false,
        message: error.response?.data?.message || 'PDF import failed',
        details: error.response?.data?.details || []
      })
    }
  }

  const handleCreateTemplate = async (e) => {
    e.preventDefault()
    try {
      await api.post('/uscis-forms', templateFormData)
      setShowAddTemplateModal(false)
      setTemplateFormData({
        formCode: '',
        title: '',
        description: '',
        version: '',
        editionDate: '',
        effectiveDate: '',
        officialPdfUrl: '',
        visaTypes: []
      })
      fetchTemplates()
    } catch (error) {
      setError('Failed to create template')
    }
  }

  const handleUpdateTemplate = async (e) => {
    e.preventDefault()
    try {
      await api.put(`/uscis-forms/${selectedTemplate._id}`, templateFormData)
      setShowEditTemplateModal(false)
      setSelectedTemplate(null)
      fetchTemplates()
    } catch (error) {
      setError('Failed to update template')
    }
  }

  const handleDeleteTemplate = async (templateId) => {
    if (!confirm('Are you sure you want to delete this template?')) return
    try {
      await api.delete(`/uscis-forms/${templateId}`)
      fetchTemplates()
    } catch (error) {
      setError('Failed to delete template')
    }
  }

  const handleFillForm = async (e) => {
    e.preventDefault()
    try {
      await api.post(`/uscis-forms/case/${fillFormData.caseId}`, {
        formTemplateId: fillFormData.formTemplateId
      })
      setShowFillFormModal(false)
      setFillFormData({ caseId: '', formTemplateId: '' })
      fetchCaseForms()
    } catch (error) {
      setError('Failed to initiate form fill')
    }
  }

  const getTemplateStatusColor = (status) => {
      const colors = {
      draft: 'bg-slate-100 text-slate-800',
      review: 'bg-blue-100 text-blue-800',
      active: 'bg-blue-100 text-blue-800',
      retired: 'bg-purple-100 text-purple-800',
      archived: 'bg-gray-100 text-gray-800',
      pending_review: 'bg-amber-100 text-amber-800'
    }
    return colors[status] || 'bg-gray-100 text-gray-800'
  }

  const getCaseFormStatusColor = (status) => {
    const colors = {
      pending: 'bg-gray-100 text-gray-800',
      ai_filled: 'bg-blue-100 text-blue-800',
      under_review: 'bg-amber-100 text-amber-800',
      approved: 'bg-blue-100 text-blue-800',
      rejected: 'bg-red-100 text-red-800',
      locked: 'bg-purple-100 text-purple-800'
    }
    return colors[status] || 'bg-gray-100 text-gray-800'
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-600">Loading USCIS forms...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">USCIS Forms</h1>
        <p className="text-gray-600 mt-1">Manage USCIS form templates and case forms</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('templates')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeTab === 'templates'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          <FileText className="w-4 h-4 inline mr-2" />
          Form Templates
        </button>
        <button
          onClick={() => setActiveTab('forms')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeTab === 'forms'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          <FileText className="w-4 h-4 inline mr-2" />
          Case Forms
        </button>
        <button
          onClick={() => setActiveTab('lifecycle')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeTab === 'lifecycle'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          <RefreshCw className="w-4 h-4 inline mr-2" />
          Lifecycle
        </button>
      </div>

      {activeTab === 'lifecycle' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {['active', 'draft', 'review', 'retired', 'pendingReviews'].map((key) => (
              <div key={key} className="card">
                <p className="text-sm text-gray-500 capitalize">{key.replace(/([A-Z])/g, ' $1')}</p>
                <p className="text-2xl font-bold text-gray-900">{lifecycle.dashboard?.[key] || 0}</p>
              </div>
            ))}
          </div>
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">USCIS Version Review Dashboard</h3>
              {['super_admin', 'admin'].includes(user.role) && (
                <button onClick={handleCheckUpdates} className="btn-secondary flex items-center gap-2">
                  <RefreshCw className="w-4 h-4" />
                  Run Scanner
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Form</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Version</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Edition</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Status</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Changes</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(lifecycle.forms || []).map((template) => (
                    <tr key={template._id} className="border-b border-gray-100">
                      <td className="py-3 px-4 font-medium">{template.formCode}</td>
                      <td className="py-3 px-4">{template.version}</td>
                      <td className="py-3 px-4">{template.editionDate ? new Date(template.editionDate).toLocaleDateString() : 'N/A'}</td>
                      <td className="py-3 px-4">
                        <span className={`badge ${getTemplateStatusColor(template.status)}`}>{template.status}</span>
                      </td>
                      <td className="py-3 px-4">
                        {template.lifecycle?.comparisonReport?.fieldDiff?.summary?.totalChanges ?? 0}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => handleCompareVersion(template)} className="btn-secondary text-sm">Compare</button>
                          {['draft', 'pending_review'].includes(template.status) && ['super_admin', 'admin'].includes(user.role) && (
                            <button onClick={() => handleLifecycleAction(template._id, 'approve')} className="btn-secondary text-sm">Approve</button>
                          )}
                          {['review', 'draft'].includes(template.status) && ['super_admin', 'admin'].includes(user.role) && (
                            <button onClick={() => handleLifecycleAction(template._id, 'activate')} className="btn-primary text-sm">Activate</button>
                          )}
                          {template.status === 'active' && ['super_admin', 'admin'].includes(user.role) && (
                            <button onClick={() => handleLifecycleAction(template._id, 'retire')} className="btn-secondary text-sm">Retire</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {comparisonReport && (
              <div className="mt-6 bg-slate-50 rounded-xl p-4">
                <h4 className="font-semibold text-gray-900 mb-2">
                  Comparison: {selectedLifecycleForm?.formCode} {selectedLifecycleForm?.version}
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>Added: {comparisonReport.fieldDiff?.summary?.added || 0}</div>
                  <div>Removed: {comparisonReport.fieldDiff?.summary?.removed || 0}</div>
                  <div>Renamed: {comparisonReport.fieldDiff?.summary?.renamed || 0}</div>
                  <div>Modified: {comparisonReport.fieldDiff?.summary?.modified || 0}</div>
                </div>
                <p className="text-sm text-gray-600 mt-2">
                  Migration suggestions: {comparisonReport.migrationSuggestions?.length || 0}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 1: Form Templates */}
      {activeTab === 'templates' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Form Templates</h3>
            <div className="flex gap-2">
              {user.role === 'super_admin' && (
                <>
                  <button
                    onClick={handleCheckUpdates}
                    className="btn-secondary flex items-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Check for Updates
                  </button>
                  <button
                    onClick={() => {
                      setShowImportPdfModal(true)
                      setPdfImportResult(null)
                    }}
                    className="btn-secondary flex items-center gap-2"
                  >
                    <FileText className="w-4 h-4" />
                    Import PDF
                  </button>
                  <button
                    onClick={() => setShowImportDefinitionModal(true)}
                    className="btn-secondary flex items-center gap-2"
                  >
                    <FileText className="w-4 h-4" />
                    Import Definition
                  </button>
                  <button
                    onClick={() => setShowAddTemplateModal(true)}
                    className="btn-primary flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Add Template
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Form Code</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Title</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Version</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Last Updated</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Status</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((template) => (
                  <tr key={template._id} className="border-b border-gray-100">
                    <td className="py-3 px-4 font-medium">{template.formCode}</td>
                    <td className="py-3 px-4">{template.title}</td>
                    <td className="py-3 px-4">{template.version}</td>
                    <td className="py-3 px-4">
                      {template.updatedAt ? new Date(template.updatedAt).toLocaleDateString() : 'N/A'}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`badge ${getTemplateStatusColor(template.status)}`}>
                        {template.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        {template.status === 'pending_review' && user.role === 'super_admin' && (
                          <button
                            onClick={() => handleApproveVersion(template._id)}
                            className="btn-secondary text-sm flex items-center gap-1"
                          >
                            <CheckCircle className="w-4 h-4" />
                            Approve
                          </button>
                        )}
                        {user.role === 'super_admin' && (
                          <>
                            {template.status !== 'archived' && (
                              <button
                                onClick={() => handleArchiveVersion(template._id)}
                                className="btn-secondary text-sm flex items-center gap-1"
                              >
                                Archive
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setSelectedTemplate(template)
                                setTemplateFormData({
                                  formCode: template.formCode,
                                  title: template.title,
                                  description: template.description || '',
                                  version: template.version,
                                  editionDate: template.editionDate ? new Date(template.editionDate).toISOString().split('T')[0] : '',
                                  effectiveDate: template.effectiveDate ? new Date(template.effectiveDate).toISOString().split('T')[0] : '',
                                  officialPdfUrl: template.officialPdfUrl,
                                  visaTypes: template.visaTypes || []
                                })
                                setShowEditTemplateModal(true)
                              }}
                              className="btn-secondary text-sm flex items-center gap-1"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteTemplate(template._id)}
                              className="bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600 flex items-center gap-1"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {templates.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>No form templates found</p>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Case Forms */}
      {activeTab === 'forms' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Case Forms</h3>
            <div className="flex gap-2">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-gray-500" />
                <select
                  value={filterCaseId}
                  onChange={(e) => setFilterCaseId(e.target.value)}
                  className="input-field text-sm py-1"
                >
                  <option value="">All Cases</option>
                  {cases.map(caseItem => (
                    <option key={caseItem._id} value={caseItem._id}>
                      {caseItem.caseNumber}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => setShowFillFormModal(true)}
                className="btn-primary flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Fill Form
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Case Number</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Form Code</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Form Title</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Version</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Status</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Filled Date</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {caseForms.map((caseForm) => (
                  <tr key={caseForm._id} className="border-b border-gray-100">
                    <td className="py-3 px-4 font-medium">
                      {cases.find(c => c._id === caseForm.caseId)?.caseNumber || 'N/A'}
                    </td>
                    <td className="py-3 px-4">{caseForm.formCode}</td>
                    <td className="py-3 px-4">{caseForm.formTemplateId?.title || 'N/A'}</td>
                    <td className="py-3 px-4">{caseForm.formVersion}</td>
                    <td className="py-3 px-4">
                      <span className={`badge ${getCaseFormStatusColor(caseForm.status)}`}>
                        {caseForm.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {caseForm.createdAt ? new Date(caseForm.createdAt).toLocaleDateString() : 'N/A'}
                    </td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => {
                          setSelectedCaseForm(caseForm)
                          setShowViewFormModal(true)
                        }}
                        className="btn-secondary text-sm flex items-center gap-1"
                      >
                        <Eye className="w-4 h-4" />
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {caseForms.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-gray-300" />
              <p>No case forms found</p>
            </div>
          )}
        </div>
      )}

      {/* Import PDF Modal */}
      {showImportPdfModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Import Official USCIS PDF</h3>
                <p className="text-sm text-gray-500">Upload a fillable PDF or import from an official HTTPS URL. Metadata is auto-detected when possible.</p>
              </div>
              <button onClick={() => setShowImportPdfModal(false)} className="text-gray-500 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Form Type</label>
                <input
                  type="text"
                  value={pdfImportData.formType}
                  onChange={(e) => setPdfImportData({ ...pdfImportData, formType: e.target.value })}
                  className="input-field"
                  placeholder="I-129"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Edition Date</label>
                <input
                  type="date"
                  value={pdfImportData.editionDate}
                  onChange={(e) => setPdfImportData({ ...pdfImportData, editionDate: e.target.value })}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Provider</label>
                <input
                  type="text"
                  value={pdfImportData.provider}
                  onChange={(e) => setPdfImportData({ ...pdfImportData, provider: e.target.value })}
                  className="input-field"
                  placeholder="uscis"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">PDF Upload</label>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => setPdfImportFile(e.target.files?.[0] || null)}
                  className="input-field"
                />
              </div>
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Official PDF URL</label>
              <input
                type="url"
                value={pdfImportData.pdfUrl}
                onChange={(e) => setPdfImportData({ ...pdfImportData, pdfUrl: e.target.value })}
                className="input-field"
                placeholder="https://www.uscis.gov/sites/default/files/document/forms/i-129.pdf"
              />
            </div>
            {pdfImportResult && (
              <div className={`mt-4 p-3 rounded-lg ${pdfImportResult.success ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700'}`}>
                <p className="text-sm font-medium">{pdfImportResult.message}</p>
                {pdfImportResult.template && (
                  <p className="text-sm mt-1">
                    {pdfImportResult.template.formCode} {pdfImportResult.template.version} · {pdfImportResult.fieldCount || pdfImportResult.template.formFields?.length || 0} fields · {pdfImportResult.template.status}
                  </p>
                )}
                {(pdfImportResult.details || []).length > 0 && (
                  <ul className="text-sm list-disc pl-5 mt-2">
                    {pdfImportResult.details.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                )}
                {pdfImportResult.comparisonReport && (
                  <p className="text-sm mt-1">
                    Changes: {pdfImportResult.comparisonReport.fieldDiff?.summary?.totalChanges || 0}
                  </p>
                )}
              </div>
            )}
            <div className="flex gap-3 mt-4">
              <button onClick={() => setShowImportPdfModal(false)} className="btn-secondary flex-1">Close</button>
              <button onClick={handlePdfUrlImport} className="btn-secondary flex-1">Import From URL</button>
              <button onClick={handlePdfUploadImport} className="btn-primary flex-1">Upload PDF</button>
            </div>
          </div>
        </div>
      )}

      {/* Import Definition Modal */}
      {showImportDefinitionModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Import USCIS Form Definition</h3>
                <p className="text-sm text-gray-500">Paste metadata JSON with sections, fields, mappings, validation, conditions, and repeatable groups.</p>
              </div>
              <button onClick={() => setShowImportDefinitionModal(false)} className="text-gray-500 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <textarea
              value={definitionJson}
              onChange={(e) => {
                setDefinitionJson(e.target.value)
                setDefinitionValidation(null)
              }}
              className="input-field min-h-[360px] font-mono text-sm"
              placeholder='{"metadata":{"formNumber":"I-129","formName":"Petition for a Nonimmigrant Worker","version":"01/17/25"},"sections":[{"sectionId":"part1","title":"Petitioner Information"}],"fields":[{"fieldId":"part1.companyName","sectionId":"part1","label":"Company Name","type":"text","required":true,"mapping":{"company":"name"}}]}'
            />
            {definitionValidation && (
              <div className={`mt-4 p-3 rounded-lg ${definitionValidation.valid ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700'}`}>
                {definitionValidation.valid ? (
                  <p className="text-sm">Definition valid: {definitionValidation.summary?.sections} sections, {definitionValidation.summary?.fields} fields, {definitionValidation.summary?.mappings} mappings.</p>
                ) : (
                  <ul className="text-sm list-disc pl-5">
                    {(definitionValidation.errors || []).map((item) => <li key={item}>{item}</li>)}
                  </ul>
                )}
              </div>
            )}
            <div className="flex gap-3 mt-4">
              <button onClick={() => setShowImportDefinitionModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleValidateDefinition} className="btn-secondary flex-1">Validate</button>
              <button onClick={handleImportDefinition} className="btn-primary flex-1">Import Definition</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Template Modal */}
      {showAddTemplateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900">Add Form Template</h3>
              <button onClick={() => setShowAddTemplateModal(false)} className="text-gray-500 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateTemplate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Form Code</label>
                  <input
                    type="text"
                    value={templateFormData.formCode}
                    onChange={(e) => setTemplateFormData({ ...templateFormData, formCode: e.target.value })}
                    className="input-field"
                    placeholder="e.g., I-129"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Version</label>
                  <input
                    type="text"
                    value={templateFormData.version}
                    onChange={(e) => setTemplateFormData({ ...templateFormData, version: e.target.value })}
                    className="input-field"
                    placeholder="e.g., 03/24/24"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input
                  type="text"
                  value={templateFormData.title}
                  onChange={(e) => setTemplateFormData({ ...templateFormData, title: e.target.value })}
                  className="input-field"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={templateFormData.description}
                  onChange={(e) => setTemplateFormData({ ...templateFormData, description: e.target.value })}
                  className="input-field min-h-[80px]"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Edition Date</label>
                  <input
                    type="date"
                    value={templateFormData.editionDate}
                    onChange={(e) => setTemplateFormData({ ...templateFormData, editionDate: e.target.value })}
                    className="input-field"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Effective Date</label>
                  <input
                    type="date"
                    value={templateFormData.effectiveDate}
                    onChange={(e) => setTemplateFormData({ ...templateFormData, effectiveDate: e.target.value })}
                    className="input-field"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Official PDF URL</label>
                <input
                  type="url"
                  value={templateFormData.officialPdfUrl}
                  onChange={(e) => setTemplateFormData({ ...templateFormData, officialPdfUrl: e.target.value })}
                  className="input-field"
                  required
                />
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowAddTemplateModal(false)} className="btn-secondary flex-1">
                  Cancel
                </button>
                <button type="submit" className="btn-primary flex-1">
                  Add Template
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Template Modal */}
      {showEditTemplateModal && selectedTemplate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900">Edit Form Template</h3>
              <button onClick={() => setShowEditTemplateModal(false)} className="text-gray-500 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleUpdateTemplate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Form Code</label>
                  <input
                    type="text"
                    value={templateFormData.formCode}
                    onChange={(e) => setTemplateFormData({ ...templateFormData, formCode: e.target.value })}
                    className="input-field"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Version</label>
                  <input
                    type="text"
                    value={templateFormData.version}
                    onChange={(e) => setTemplateFormData({ ...templateFormData, version: e.target.value })}
                    className="input-field"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input
                  type="text"
                  value={templateFormData.title}
                  onChange={(e) => setTemplateFormData({ ...templateFormData, title: e.target.value })}
                  className="input-field"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={templateFormData.description}
                  onChange={(e) => setTemplateFormData({ ...templateFormData, description: e.target.value })}
                  className="input-field min-h-[80px]"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Edition Date</label>
                  <input
                    type="date"
                    value={templateFormData.editionDate}
                    onChange={(e) => setTemplateFormData({ ...templateFormData, editionDate: e.target.value })}
                    className="input-field"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Effective Date</label>
                  <input
                    type="date"
                    value={templateFormData.effectiveDate}
                    onChange={(e) => setTemplateFormData({ ...templateFormData, effectiveDate: e.target.value })}
                    className="input-field"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Official PDF URL</label>
                <input
                  type="url"
                  value={templateFormData.officialPdfUrl}
                  onChange={(e) => setTemplateFormData({ ...templateFormData, officialPdfUrl: e.target.value })}
                  className="input-field"
                  required
                />
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowEditTemplateModal(false)} className="btn-secondary flex-1">
                  Cancel
                </button>
                <button type="submit" className="btn-primary flex-1">
                  Update Template
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Fill Form Modal */}
      {showFillFormModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900">Fill Form for Case</h3>
              <button onClick={() => setShowFillFormModal(false)} className="text-gray-500 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleFillForm} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Select Case</label>
                <select
                  value={fillFormData.caseId}
                  onChange={(e) => setFillFormData({ ...fillFormData, caseId: e.target.value })}
                  className="input-field"
                  required
                >
                  <option value="">Select a case</option>
                  {cases.map(caseItem => (
                    <option key={caseItem._id} value={caseItem._id}>
                      {caseItem.caseNumber} - {caseItem.clientName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Select Form Template</label>
                <select
                  value={fillFormData.formTemplateId}
                  onChange={(e) => setFillFormData({ ...fillFormData, formTemplateId: e.target.value })}
                  className="input-field"
                  required
                >
                  <option value="">Select a template</option>
                  {templates.filter(t => t.status === 'active').map(template => (
                    <option key={template._id} value={template._id}>
                      {template.formCode} - {template.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowFillFormModal(false)} className="btn-secondary flex-1">
                  Cancel
                </button>
                <button type="submit" className="btn-primary flex-1">
                  Initiate Fill
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Form Modal */}
      {showViewFormModal && selectedCaseForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900">Case Form Details</h3>
              <button onClick={() => setShowViewFormModal(false)} className="text-gray-500 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Form Code</p>
                  <p className="font-medium">{selectedCaseForm.formCode}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Version</p>
                  <p className="font-medium">{selectedCaseForm.formVersion}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Status</p>
                  <span className={`badge ${getCaseFormStatusColor(selectedCaseForm.status)}`}>
                    {selectedCaseForm.status.replace('_', ' ')}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Created</p>
                  <p className="font-medium">{new Date(selectedCaseForm.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
              {selectedCaseForm.filledData && (
                <div>
                  <p className="text-sm font-medium text-gray-900 mb-2">Filled Data</p>
                  <pre className="bg-gray-50 p-4 rounded-lg overflow-x-auto text-sm">
                    {JSON.stringify(selectedCaseForm.filledData, null, 2)}
                  </pre>
                </div>
              )}
              {selectedCaseForm.reviewComments && (
                <div>
                  <p className="text-sm font-medium text-gray-900 mb-2">Review Comments</p>
                  <p className="text-sm text-gray-600">{selectedCaseForm.reviewComments}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default USCISForms
