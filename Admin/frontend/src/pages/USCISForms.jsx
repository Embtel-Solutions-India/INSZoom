import { useState, useEffect, useMemo, useCallback } from 'react'
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
  AlertTriangle,
  ShieldCheck,
  Copy,
  ExternalLink,
  XCircle,
  Upload
} from 'lucide-react'
import InfoModal from '../components/InfoModal'

// ── Registry helpers ────────────────────────────────────────────────────────
// The signed PDF URL the backend mints (GET /:id/url) is a backend path
// ("/api/uscis-forms/<id>/pdf?token=..."), which is only correct relative to
// the API origin — opening it against the Vite dev origin would 404. Resolve
// it against the axios baseURL instead of assuming same-origin.
const resolveApiUrl = (path) => {
  if (!path) return ''
  if (/^https?:\/\//i.test(path)) return path
  try {
    const base = new URL(api.defaults.baseURL, window.location.origin)
    return `${base.origin}${path}`
  } catch {
    return path
  }
}

const readErrorMessage = (error, fallback) => {
  const message = error?.response?.data?.message || error?.userMessage
  return typeof message === 'string' && message.trim() ? message : fallback
}

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'N/A'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : 'N/A')
const formatDateTime = (value) => (value ? new Date(value).toLocaleString() : 'N/A')

const getStorageKey = (template) => template?.artifacts?.form?.storageKey || template?.pdfStorageKey || ''
const getChecksum = (template) => template?.artifacts?.form?.checksum || template?.importMetadata?.checksum || ''
const getFieldCount = (template) => (template?.formFields || []).length
const isFillable = (template) => getFieldCount(template) > 0
const getPageCount = (template) =>
  template?.pdfMetadata?.pageCount ?? template?.pdfMetadata?.pages ?? template?.parserMetadata?.pageCount ?? null
const getEdition = (template) =>
  template?.editionDate ? new Date(template.editionDate).toLocaleDateString() : (template?.version || 'N/A')
const getFormNumber = (template) => template?.formNumber || template?.formCode || 'N/A'
const getSource = (template) =>
  template?.importMetadata?.source || template?.artifacts?.form?.sourceUrl || template?.officialPdfUrl || 'Unknown'

const HEALTH_BADGE = {
  ok: 'bg-emerald-100 text-emerald-800',
  warning: 'bg-amber-100 text-amber-800',
  error: 'bg-red-100 text-red-800'
}

const HEALTH_LABEL = { ok: 'Available', warning: 'Warning', error: 'Unavailable' }

const CheckIcon = ({ status }) => {
  if (status === 'ok') return <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
  if (status === 'warning') return <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
  return <XCircle className="w-4 h-4 text-red-600 shrink-0" />
}

const USCISForms = () => {
  const { user } = useAuth()
  // Backend authority (uscis-form.routes.js): mappings / activate / archive /
  // approve accept super_admin + admin; template create/update/delete are
  // super_admin only. The UI mirrors both tiers rather than one blanket flag.
  const isAdmin = ['super_admin', 'admin'].includes(user?.role)
  const isSuperAdmin = user?.role === 'super_admin'
  const [activeTab, setActiveTab] = useState('templates')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // P12-S2: replaces window.alert() calls previously fired below.
  const [infoModal, setInfoModal] = useState(null)

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

  // ── Registry: health, mappings, visa vocabulary ──────────────────────────
  const [registryHealth, setRegistryHealth] = useState({})
  const [healthLoading, setHealthLoading] = useState(false)
  const [healthError, setHealthError] = useState('')
  // Mapping cache keyed by template id. Populated ONLY when a form's detail
  // panel is opened, so the initial table render issues zero /mappings calls
  // (no N+1 request storm across the registry).
  const [mappingsByTemplate, setMappingsByTemplate] = useState({})
  const [visaRegistry, setVisaRegistry] = useState({
    visaTypes: [],
    provisioningTypes: [],
    componentTypes: []
  })

  // ── Registry list filters ────────────────────────────────────────────────
  const [registrySearch, setRegistrySearch] = useState('')
  const [filterVisa, setFilterVisa] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterFillable, setFilterFillable] = useState('')
  const [filterStorage, setFilterStorage] = useState('')

  // ── Form details panel ───────────────────────────────────────────────────
  const [detailTemplate, setDetailTemplate] = useState(null)
  const [detailHealth, setDetailHealth] = useState(null)
  const [detailDeepLoading, setDetailDeepLoading] = useState(false)
  const [detailVersions, setDetailVersions] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [copiedField, setCopiedField] = useState('')
  const [mappingDraft, setMappingDraft] = useState(null)
  const [mappingError, setMappingError] = useState('')
  const [mappingSaving, setMappingSaving] = useState(false)

  // ── Import wizard (pick → analyze → review → publish) ────────────────────
  const [importStep, setImportStep] = useState('select')
  const [analysis, setAnalysis] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [importError, setImportError] = useState('')
  const [confirmDetails, setConfirmDetails] = useState({ formType: '', editionDate: '' })
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
      // The registry list is filtered/searched client-side below, so pull the
      // full page (server caps `limit` at 200) rather than the 25-row default.
      const response = await api.get('/uscis-forms', { params: { limit: 200 } })
      setTemplates(response.data.forms || response.data.items || response.data.data || [])
    } catch (error) {
      setError('Failed to load form templates')
    } finally {
      setLoading(false)
    }
  }

  // Registry-wide S3/health sweep. Deliberately NOT awaited by fetchTemplates:
  // a cold sweep costs ~9s (one S3 HEAD per object) against ~330ms cached, so
  // the table renders immediately and the health column fills in on arrival.
  const fetchRegistryHealth = useCallback(async (force = false) => {
    try {
      setHealthLoading(true)
      setHealthError('')
      const response = await api.get('/uscis-forms/registry/health', {
        params: force ? { force: true } : {}
      })
      setRegistryHealth(response.data.health || response.data.data || {})
    } catch (error) {
      setHealthError(readErrorMessage(error, 'Storage health could not be checked right now.'))
    } finally {
      setHealthLoading(false)
    }
  }, [])

  const fetchVisaRegistry = useCallback(async () => {
    try {
      const response = await api.get('/uscis-forms/registry/visa-registry')
      setVisaRegistry({
        visaTypes: response.data.visaTypes || [],
        provisioningTypes: response.data.provisioningTypes || [],
        componentTypes: response.data.componentTypes || []
      })
    } catch {
      // Non-fatal: the mapping editor stays disabled rather than falling back
      // to a second, hardcoded visa list.
      setVisaRegistry({ visaTypes: [], provisioningTypes: [], componentTypes: [] })
    }
  }, [])

  useEffect(() => {
    if (activeTab !== 'templates') return
    fetchRegistryHealth(false)
    fetchVisaRegistry()
  }, [activeTab, fetchRegistryHealth, fetchVisaRegistry])

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
      setInfoModal({ message: response.data.message || 'Form update check completed' })
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
      setInfoModal({ message: 'Form version approved successfully' })
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

  // ── Import wizard: pick → analyze → review → publish → activate ──────────
  const resetImportWizard = () => {
    setImportStep('select')
    setAnalysis(null)
    setAnalyzing(false)
    setPublishing(false)
    setImportError('')
    setPdfImportFile(null)
    setPdfImportResult(null)
    setConfirmDetails({ formType: '', editionDate: '' })
  }

  // Step 2 — stores nothing server-side; produces the review report only.
  const handleAnalyzePdf = async () => {
    if (!pdfImportFile) {
      setImportError('Select a USCIS PDF to analyze.')
      return
    }
    try {
      setAnalyzing(true)
      setImportError('')
      const formData = new FormData()
      formData.append('pdf', pdfImportFile)
      const response = await api.post('/uscis/forms/analyze', formData)
      const result = response.data.analysis || response.data.data
      setAnalysis(result)
      setConfirmDetails({
        formType: result?.detected?.formNumber || result?.detected?.formCode || '',
        editionDate: ''
      })
      setImportStep('review')
    } catch (error) {
      setImportError(readErrorMessage(error, 'This PDF could not be analyzed.'))
    } finally {
      setAnalyzing(false)
    }
  }

  // Step 4 — persists as `draft`. expectedSha256 makes the server reject a
  // file that changed between analysis and publish (409 checksum mismatch).
  const handlePublishAnalyzedPdf = async () => {
    if (!pdfImportFile || !analysis) return
    try {
      setPublishing(true)
      setImportError('')
      const formData = new FormData()
      formData.append('pdf', pdfImportFile)
      formData.append('expectedSha256', analysis.sha256 || '')
      if (confirmDetails.formType) formData.append('formType', confirmDetails.formType)
      if (confirmDetails.editionDate) formData.append('editionDate', confirmDetails.editionDate)
      if (pdfImportData.provider) formData.append('provider', pdfImportData.provider)
      const response = await api.post('/uscis/forms/upload', formData)
      setPdfImportResult({
        success: true,
        message: response.data.duplicate
          ? 'Duplicate detected; the existing template was returned.'
          : 'Imported as a draft. Activate it to make it available for filing.',
        template: response.data.template,
        fieldCount: response.data.fieldCount
      })
      setImportStep('done')
      fetchTemplates()
      fetchRegistryHealth(true)
      if (activeTab === 'lifecycle') fetchLifecycle()
    } catch (error) {
      setImportError(readErrorMessage(error, 'Publishing this PDF failed.'))
    } finally {
      setPublishing(false)
    }
  }

  // Step 5 — explicit, separate activation (import alone never publishes).
  const handleActivateTemplate = async (templateId) => {
    try {
      await api.put(`/uscis-forms/${templateId}/activate`)
      setInfoModal({ message: 'Form activated and available for filing.' })
      setPdfImportResult((prev) => (prev ? { ...prev, activated: true } : prev))
      fetchTemplates()
      fetchRegistryHealth(true)
    } catch (error) {
      setError(readErrorMessage(error, 'Failed to activate this form.'))
    }
  }

  // ── Form details panel ───────────────────────────────────────────────────
  // Mappings and version history are fetched HERE, once per opened form, and
  // cached — never per table row.
  const openFormDetails = async (template) => {
    setDetailTemplate(template)
    setDetailHealth(registryHealth[template._id] || null)
    setDetailVersions([])
    setDetailError('')
    setMappingDraft(null)
    setMappingError('')
    setDetailLoading(true)
    const [mappingsResult, versionsResult] = await Promise.allSettled([
      api.get(`/uscis-forms/${template._id}/mappings`),
      api.get(`/uscis-forms/registry/${encodeURIComponent(template.formCode)}/versions`)
    ])
    if (mappingsResult.status === 'fulfilled') {
      const mappings = mappingsResult.value.data.mappings || mappingsResult.value.data.data || []
      setMappingsByTemplate((prev) => ({ ...prev, [template._id]: mappings }))
    } else {
      setDetailError('Some details could not be loaded. Visa mappings are unavailable right now.')
    }
    if (versionsResult.status === 'fulfilled') {
      setDetailVersions(versionsResult.value.data.versions || versionsResult.value.data.data || [])
    }
    setDetailLoading(false)
  }

  const closeFormDetails = () => {
    setDetailTemplate(null)
    setDetailHealth(null)
    setDetailVersions([])
    setDetailError('')
    setMappingDraft(null)
  }

  const refreshDetailMappings = async (templateId) => {
    try {
      const response = await api.get(`/uscis-forms/${templateId}/mappings`)
      setMappingsByTemplate((prev) => ({
        ...prev,
        [templateId]: response.data.mappings || response.data.data || []
      }))
    } catch {
      setMappingError('Mappings were changed but the list could not be refreshed.')
    }
  }

  const handleRunDeepVerification = async (templateId) => {
    try {
      setDetailDeepLoading(true)
      setDetailError('')
      const response = await api.get(`/uscis-forms/${templateId}/health`, { params: { deep: true } })
      const health = response.data.health || response.data.data
      setDetailHealth(health)
      setRegistryHealth((prev) => ({ ...prev, [templateId]: health }))
    } catch (error) {
      setDetailError(readErrorMessage(error, 'Deep verification could not be completed.'))
    } finally {
      setDetailDeepLoading(false)
    }
  }

  // Opens the backend-signed, short-lived PDF link. The bytes are never pulled
  // into JS memory — the browser streams them straight from the API.
  const handleViewPdf = async (templateId) => {
    try {
      const response = await api.get(`/uscis-forms/${templateId}/url`)
      const target = resolveApiUrl(response.data.url)
      if (target) window.open(target, '_blank', 'noopener')
    } catch (error) {
      setDetailError(readErrorMessage(error, 'A secure link to this PDF could not be created.'))
    }
  }

  const handleSaveMapping = async () => {
    if (!detailTemplate || !mappingDraft) return
    if (!mappingDraft.visaType || !mappingDraft.provisioningType) {
      setMappingError('Select both a visa type and an assignment type.')
      return
    }
    try {
      setMappingSaving(true)
      setMappingError('')
      const payload = {
        provisioningType: mappingDraft.provisioningType,
        triggerCondition: mappingDraft.triggerCondition || undefined,
        displayOrder: mappingDraft.displayOrder === '' ? undefined : Number(mappingDraft.displayOrder),
        notes: mappingDraft.notes || undefined
      }
      if (mappingDraft._id) {
        await api.patch(`/uscis-forms/${detailTemplate._id}/mappings/${mappingDraft._id}`, payload)
      } else {
        await api.post(`/uscis-forms/${detailTemplate._id}/mappings`, {
          ...payload,
          visaType: mappingDraft.visaType,
          componentType: mappingDraft.componentType || undefined
        })
      }
      setMappingDraft(null)
      await refreshDetailMappings(detailTemplate._id)
    } catch (error) {
      setMappingError(readErrorMessage(error, 'This visa mapping could not be saved.'))
    } finally {
      setMappingSaving(false)
    }
  }

  const handleRemoveMapping = async (mappingId) => {
    if (!detailTemplate) return
    if (!confirm('Deactivate this visa mapping?')) return
    try {
      setMappingError('')
      await api.delete(`/uscis-forms/${detailTemplate._id}/mappings/${mappingId}`)
      await refreshDetailMappings(detailTemplate._id)
    } catch (error) {
      setMappingError(readErrorMessage(error, 'This visa mapping could not be removed.'))
    }
  }

  const handleCopy = async (value, key) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedField(key)
      setTimeout(() => setCopiedField(''), 1500)
    } catch {
      setCopiedField('')
    }
  }

  // Visa types shown on a row: the cached mappings when the form has been
  // opened, otherwise the template's own visaTypes already present in the list
  // payload. Either way, no extra request per row.
  const visaTypesFor = useCallback((template) => {
    const cached = mappingsByTemplate[template._id]
    if (cached) return [...new Set(cached.filter((m) => m.active !== false).map((m) => m.visaType))]
    return template.visaTypes || []
  }, [mappingsByTemplate])

  const assignmentTypesFor = useCallback((template) => {
    const cached = mappingsByTemplate[template._id]
    if (!cached) return null
    return [...new Set(cached.filter((m) => m.active !== false).map((m) => m.provisioningType))]
  }, [mappingsByTemplate])

  const filteredTemplates = useMemo(() => {
    const term = registrySearch.trim().toLowerCase()
    return templates.filter((template) => {
      if (term) {
        const haystack = [getFormNumber(template), template.title, template.version, getEdition(template)]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(term)) return false
      }
      if (filterStatus && template.status !== filterStatus) return false
      if (filterFillable) {
        const fillable = isFillable(template)
        if (filterFillable === 'yes' && !fillable) return false
        if (filterFillable === 'no' && fillable) return false
      }
      if (filterStorage) {
        const health = registryHealth[template._id]
        if (!health) return false
        if (filterStorage === 'available' && !health.storageAvailable) return false
        if (filterStorage === 'unavailable' && health.storageAvailable) return false
      }
      if (filterVisa && !visaTypesFor(template).includes(filterVisa)) return false
      return true
    })
  }, [templates, registrySearch, filterStatus, filterFillable, filterStorage, filterVisa, registryHealth, visaTypesFor])

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
      archived: 'bg-secondary text-foreground',
      pending_review: 'bg-amber-100 text-amber-800'
    }
    return colors[status] || 'bg-secondary text-foreground'
  }

  const getCaseFormStatusColor = (status) => {
    const colors = {
      pending: 'bg-secondary text-foreground',
      ai_filled: 'bg-blue-100 text-blue-800',
      under_review: 'bg-amber-100 text-amber-800',
      approved: 'bg-blue-100 text-blue-800',
      rejected: 'bg-red-100 text-red-800',
      locked: 'bg-purple-100 text-purple-800'
    }
    return colors[status] || 'bg-secondary text-foreground'
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading USCIS forms...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">USCIS Forms</h1>
        <p className="text-muted-foreground mt-1">Manage USCIS form templates and case forms</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border">
        <button
          onClick={() => setActiveTab('templates')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeTab === 'templates'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-muted-foreground hover:text-foreground'
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
              : 'border-transparent text-muted-foreground hover:text-foreground'
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
              : 'border-transparent text-muted-foreground hover:text-foreground'
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
                <p className="text-sm text-muted-foreground capitalize">{key.replace(/([A-Z])/g, ' $1')}</p>
                <p className="text-2xl font-bold text-foreground">{lifecycle.dashboard?.[key] || 0}</p>
              </div>
            ))}
          </div>
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">USCIS Version Review Dashboard</h3>
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
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Form</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Version</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Edition</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Status</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Changes</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(lifecycle.forms || []).map((template) => (
                    <tr key={template._id} className="border-b border-border">
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
                <h4 className="font-semibold text-foreground mb-2">
                  Comparison: {selectedLifecycleForm?.formCode} {selectedLifecycleForm?.version}
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>Added: {comparisonReport.fieldDiff?.summary?.added || 0}</div>
                  <div>Removed: {comparisonReport.fieldDiff?.summary?.removed || 0}</div>
                  <div>Renamed: {comparisonReport.fieldDiff?.summary?.renamed || 0}</div>
                  <div>Modified: {comparisonReport.fieldDiff?.summary?.modified || 0}</div>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
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
            <div>
              <h3 className="text-lg font-semibold text-foreground">Forms Registry</h3>
              <p className="text-sm text-muted-foreground">
                {filteredTemplates.length} of {templates.length} form{templates.length === 1 ? '' : 's'}
                {healthLoading && ' · checking storage health…'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => fetchRegistryHealth(true)}
                disabled={healthLoading}
                className="btn-secondary flex items-center gap-2 disabled:opacity-60"
              >
                <ShieldCheck className="w-4 h-4" />
                {healthLoading ? 'Checking…' : 'Re-check health'}
              </button>
              {isAdmin && (
                <button
                  onClick={() => {
                    resetImportWizard()
                    setShowImportPdfModal(true)
                  }}
                  className="btn-primary flex items-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  Upload PDF
                </button>
              )}
              {isSuperAdmin && (
                <>
                  <button
                    onClick={handleCheckUpdates}
                    className="btn-secondary flex items-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Check for Updates
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
                    className="btn-secondary flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Add Template
                  </button>
                </>
              )}
            </div>
          </div>

          {healthError && (
            <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2 rounded-lg text-sm">
              {healthError}
            </div>
          )}

          {/* Search + filters (client-side over the loaded registry) */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={registrySearch}
                onChange={(e) => setRegistrySearch(e.target.value)}
                placeholder="Search form number, title or edition"
                className="input-field pl-9"
              />
            </div>
            <select value={filterVisa} onChange={(e) => setFilterVisa(e.target.value)} className="input-field text-sm py-1 w-auto">
              <option value="">All visas</option>
              {visaRegistry.visaTypes.map((visa) => (
                <option key={visa.value} value={visa.value}>{visa.label}</option>
              ))}
            </select>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="input-field text-sm py-1 w-auto">
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
            <select value={filterFillable} onChange={(e) => setFilterFillable(e.target.value)} className="input-field text-sm py-1 w-auto">
              <option value="">Fillable: any</option>
              <option value="yes">Fillable: yes</option>
              <option value="no">Fillable: no</option>
            </select>
            <select value={filterStorage} onChange={(e) => setFilterStorage(e.target.value)} className="input-field text-sm py-1 w-auto">
              <option value="">Storage: any</option>
              <option value="available">Storage: available</option>
              <option value="unavailable">Storage: unavailable</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Form Number</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Title</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Edition</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Status</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Visa Types</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Assignment Type</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Fillable</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">S3 Status</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Updated</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTemplates.map((template) => {
                  const health = registryHealth[template._id]
                  const visas = visaTypesFor(template)
                  const assignments = assignmentTypesFor(template)
                  const failing = (health?.checks || [])
                    .filter((item) => item.status !== 'ok')
                    .map((item) => `${item.label}: ${item.detail || item.status}`)
                    .join('\n')
                  return (
                    <tr
                      key={template._id}
                      onClick={() => openFormDetails(template)}
                      className="border-b border-border hover:bg-muted/50 cursor-pointer"
                    >
                      <td className="py-3 px-4 font-medium">{getFormNumber(template)}</td>
                      <td className="py-3 px-4">{template.title}</td>
                      <td className="py-3 px-4">{getEdition(template)}</td>
                      <td className="py-3 px-4">
                        <span className={`badge ${getTemplateStatusColor(template.status)}`}>
                          {(template.status || 'unknown').replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm">
                        {visas.length === 0 ? (
                          <span className="text-muted-foreground">None</span>
                        ) : (
                          <span title={visas.join(', ')}>
                            {visas.slice(0, 3).join(', ')}{visas.length > 3 ? ` +${visas.length - 3}` : ''}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-sm">
                        {assignments === null ? (
                          <span className="text-muted-foreground" title="Open this form to load its visa mappings">—</span>
                        ) : assignments.length === 0 ? (
                          <span className="text-muted-foreground">Unmapped</span>
                        ) : (
                          <span title={assignments.join(', ')}>{assignments.join(', ')}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-sm">{isFillable(template) ? 'Yes' : 'No'}</td>
                      <td className="py-3 px-4">
                        {health ? (
                          <span
                            className={`badge ${HEALTH_BADGE[health.status] || 'bg-secondary text-foreground'}`}
                            title={failing || 'All storage checks passed'}
                          >
                            {HEALTH_LABEL[health.status] || health.status}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">{healthLoading ? 'Checking…' : '—'}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-sm">{formatDate(template.updatedAt)}</td>
                      <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openFormDetails(template)}
                            className="btn-secondary text-sm flex items-center gap-1"
                          >
                            <Eye className="w-4 h-4" />
                            Details
                          </button>
                          {isAdmin && template.status === 'pending_review' && (
                            <button
                              onClick={() => handleApproveVersion(template._id)}
                              className="btn-secondary text-sm flex items-center gap-1"
                            >
                              <CheckCircle className="w-4 h-4" />
                              Approve
                            </button>
                          )}
                          {isAdmin && template.status !== 'active' && (
                            <button
                              onClick={() => handleActivateTemplate(template._id)}
                              className="btn-secondary text-sm"
                            >
                              Activate
                            </button>
                          )}
                          {isAdmin && template.status !== 'archived' && (
                            <button
                              onClick={() => handleArchiveVersion(template._id)}
                              className="btn-secondary text-sm"
                            >
                              Archive
                            </button>
                          )}
                          {isSuperAdmin && (
                            <>
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
                  )
                })}
              </tbody>
            </table>
          </div>

          {filteredTemplates.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p>{templates.length === 0 ? 'No form templates found' : 'No forms match the current filters'}</p>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Case Forms */}
      {activeTab === 'forms' && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-foreground">Case Forms</h3>
            <div className="flex gap-2">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-muted-foreground" />
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
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Case Number</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Form Code</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Form Title</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Version</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Status</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Filled Date</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {caseForms.map((caseForm) => (
                  <tr key={caseForm._id} className="border-b border-border">
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
            <div className="text-center py-8 text-muted-foreground">
              <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p>No case forms found</p>
            </div>
          )}
        </div>
      )}

      {/* Upload → analyze → review → publish → activate */}
      {showImportPdfModal && isAdmin && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-card rounded-2xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-xl font-bold text-foreground">Add Official USCIS PDF</h3>
                <p className="text-sm text-muted-foreground">
                  {importStep === 'select' && 'Step 1 of 3 — choose the PDF. Nothing is stored until you publish.'}
                  {importStep === 'review' && 'Step 2 of 3 — review what was detected before publishing.'}
                  {importStep === 'done' && 'Step 3 of 3 — imported as a draft.'}
                </p>
              </div>
              <button onClick={() => { setShowImportPdfModal(false); resetImportWizard() }} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            {importError && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
                {importError}
              </div>
            )}

            {/* Step 1 — pick a file */}
            {importStep === 'select' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">USCIS PDF</label>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={(e) => { setPdfImportFile(e.target.files?.[0] || null); setImportError('') }}
                    className="input-field"
                  />
                  {pdfImportFile && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {pdfImportFile.name} · {formatBytes(pdfImportFile.size)}
                    </p>
                  )}
                </div>
                <div className="border-t border-border pt-4">
                  <label className="block text-sm font-medium text-muted-foreground mb-1">
                    Or import directly from an official USCIS URL
                  </label>
                  <input
                    type="url"
                    value={pdfImportData.pdfUrl}
                    onChange={(e) => setPdfImportData({ ...pdfImportData, pdfUrl: e.target.value })}
                    className="input-field"
                    placeholder="https://www.uscis.gov/sites/default/files/document/forms/i-129.pdf"
                  />
                  {pdfImportResult && !pdfImportResult.success && (
                    <p className="text-sm text-red-700 mt-2">{pdfImportResult.message}</p>
                  )}
                </div>
                <div className="flex gap-3">
                  <button onClick={() => { setShowImportPdfModal(false); resetImportWizard() }} className="btn-secondary flex-1">
                    Cancel
                  </button>
                  <button onClick={handlePdfUrlImport} className="btn-secondary flex-1">Import From URL</button>
                  <button
                    onClick={handleAnalyzePdf}
                    disabled={!pdfImportFile || analyzing}
                    className="btn-primary flex-1 disabled:opacity-60"
                  >
                    {analyzing ? 'Analyzing…' : 'Analyze PDF'}
                  </button>
                </div>
              </div>
            )}

            {/* Step 3 — the analysis review screen */}
            {importStep === 'review' && analysis && (() => {
              const detected = analysis.detected || {}
              const pdfInfo = analysis.pdf || {}
              const confidence = analysis.confidence || {}
              const registry = analysis.registry || {}
              const isDuplicate = registry.disposition === 'exact_duplicate'
              const needsConfirm = Boolean(confidence.requiresConfirmation)
              const confirmed = !needsConfirm || (confirmDetails.formType.trim() && confirmDetails.editionDate)
              return (
                <div className="space-y-4">
                  {isDuplicate && (
                    <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg text-sm font-medium">
                      This exact PDF is already registered. There is nothing new to publish.
                    </div>
                  )}
                  {needsConfirm && !isDuplicate && (
                    <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg text-sm">
                      <p className="font-semibold">Could not auto-identify this form — confirm the details before publishing.</p>
                      <p className="mt-1">Enter the form number and edition date exactly as printed on the PDF.</p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Form</p>
                      <p className="font-medium">{detected.formNumber || detected.formCode || 'Unidentified'}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Title</p>
                      <p className="font-medium">{detected.title || 'Unknown'}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Edition</p>
                      <p className="font-medium">{detected.edition || formatDate(detected.editionDate)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Pages</p>
                      <p className="font-medium">{detected.pageCount ?? 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Fillable</p>
                      <p className="font-medium">{pdfInfo.fillable ? 'Yes' : 'No'}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Detected fields</p>
                      <p className="font-medium">{pdfInfo.fieldCount ?? 0}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">File size</p>
                      <p className="font-medium">{formatBytes(analysis.fileSize)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Identified via</p>
                      <p className="font-medium">{(detected.identitySource || 'unknown').replace(/_/g, ' ')}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Registry disposition</p>
                      <p className="font-medium">{(registry.disposition || 'unknown').replace(/_/g, ' ')}</p>
                    </div>
                  </div>

                  <div>
                    <p className="text-sm text-muted-foreground">SHA-256</p>
                    <p className="font-mono text-xs break-all">{analysis.sha256 || 'N/A'}</p>
                  </div>

                  {(pdfInfo.warnings || []).length > 0 && (
                    <ul className="text-sm text-amber-800 list-disc pl-5">
                      {pdfInfo.warnings.map((item, index) => <li key={index}>{String(item)}</li>)}
                    </ul>
                  )}
                  {(pdfInfo.errors || []).length > 0 && (
                    <ul className="text-sm text-red-700 list-disc pl-5">
                      {pdfInfo.errors.map((item, index) => <li key={index}>{String(item)}</li>)}
                    </ul>
                  )}

                  <div>
                    <p className="text-sm font-medium text-foreground mb-1">Suggested visa types</p>
                    {(analysis.suggestedVisaTypes || []).length === 0 ? (
                      <p className="text-sm text-muted-foreground">None suggested — map visas after publishing.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {analysis.suggestedVisaTypes.map((item) => (
                          <span key={`${item.visaType}-${item.provisioningType}`} className="badge bg-secondary text-foreground">
                            {item.visaType} · {item.provisioningType}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {(registry.existingVersions || []).length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-foreground mb-1">Existing versions of this form</p>
                      <ul className="text-sm text-muted-foreground list-disc pl-5">
                        {registry.existingVersions.map((item) => (
                          <li key={item.id}>{item.version} · {formatDate(item.editionDate)} · {item.status}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {needsConfirm && !isDuplicate && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-border pt-4">
                      <div>
                        <label className="block text-sm font-medium text-muted-foreground mb-1">Form Number</label>
                        <input
                          type="text"
                          value={confirmDetails.formType}
                          onChange={(e) => setConfirmDetails({ ...confirmDetails, formType: e.target.value })}
                          className="input-field"
                          placeholder="I-129"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-muted-foreground mb-1">Edition Date</label>
                        <input
                          type="date"
                          value={confirmDetails.editionDate}
                          onChange={(e) => setConfirmDetails({ ...confirmDetails, editionDate: e.target.value })}
                          className="input-field"
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button onClick={() => { setImportStep('select'); setImportError('') }} className="btn-secondary flex-1">
                      Back
                    </button>
                    <button
                      onClick={handlePublishAnalyzedPdf}
                      disabled={isDuplicate || !confirmed || publishing}
                      className="btn-primary flex-1 disabled:opacity-60"
                      title={isDuplicate ? 'This exact PDF is already registered' : undefined}
                    >
                      {publishing ? 'Publishing…' : 'Publish'}
                    </button>
                  </div>
                </div>
              )
            })()}

            {/* Step 5 — imported as draft; activation is explicit */}
            {importStep === 'done' && pdfImportResult && (
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg text-sm">
                  <p className="font-medium">{pdfImportResult.message}</p>
                  {pdfImportResult.template && (
                    <p className="mt-1">
                      {pdfImportResult.template.formCode} {pdfImportResult.template.version} ·{' '}
                      {pdfImportResult.fieldCount || 0} fields · status {pdfImportResult.template.status}
                    </p>
                  )}
                </div>
                <div className="flex gap-3">
                  <button onClick={() => { setShowImportPdfModal(false); resetImportWizard() }} className="btn-secondary flex-1">
                    Close
                  </button>
                  {pdfImportResult.template?._id && pdfImportResult.template?.status !== 'active' && !pdfImportResult.activated && (
                    <button onClick={() => handleActivateTemplate(pdfImportResult.template._id)} className="btn-primary flex-1">
                      Activate now
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Form details */}
      {detailTemplate && (() => {
        const template = detailTemplate
        const health = detailHealth
        const mappings = mappingsByTemplate[template._id] || []
        const storageKey = getStorageKey(template)
        const checksum = getChecksum(template)
        return (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-card rounded-2xl p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto space-y-6">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xl font-bold text-foreground">{getFormNumber(template)}</h3>
                  <p className="text-sm text-muted-foreground">{template.title}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleViewPdf(template._id)} className="btn-secondary text-sm flex items-center gap-1">
                    <ExternalLink className="w-4 h-4" />
                    View PDF
                  </button>
                  <button onClick={closeFormDetails} className="text-muted-foreground hover:text-foreground">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {detailError && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2 rounded-lg text-sm">
                  {detailError}
                </div>
              )}

              {/* Basic info */}
              <div>
                <h4 className="font-semibold text-foreground mb-2">Basic information</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Form Number</p>
                    <p className="font-medium">{getFormNumber(template)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Edition</p>
                    <p className="font-medium">{getEdition(template)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Status</p>
                    <span className={`badge ${getTemplateStatusColor(template.status)}`}>
                      {(template.status || 'unknown').replace('_', ' ')}
                    </span>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Source</p>
                    <p className="font-medium break-all">{getSource(template)}</p>
                  </div>
                </div>
              </div>

              {/* Storage */}
              <div>
                <h4 className="font-semibold text-foreground mb-2">Storage</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Storage status</p>
                    <p className="font-medium">
                      {health ? (health.storageAvailable ? 'Available' : 'Unavailable') : 'Not checked'}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Provider</p>
                    <p className="font-medium uppercase">{health?.storageProvider || template.artifacts?.form?.storageProvider || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">File size</p>
                    <p className="font-medium">{formatBytes(template.artifacts?.form?.fileSize)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Uploaded</p>
                    <p className="font-medium">{formatDate(template.artifacts?.form?.downloadedAt || template.createdAt)}</p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-muted-foreground">SHA-256</p>
                    {checksum ? (
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs" title={checksum}>{checksum.slice(0, 16)}…{checksum.slice(-8)}</span>
                        <button
                          onClick={() => handleCopy(checksum, 'checksum')}
                          className="text-muted-foreground hover:text-foreground"
                          title="Copy full SHA-256"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        {copiedField === 'checksum' && <span className="text-xs text-emerald-600">Copied</span>}
                      </div>
                    ) : (
                      <p className="font-medium">Not recorded</p>
                    )}
                  </div>
                  <div>
                    <p className="text-muted-foreground">Last validated</p>
                    <p className="font-medium">{formatDateTime(health?.checkedAt || template.lastChecked)}</p>
                  </div>
                  {/* Raw object key is infrastructure detail — admins only. */}
                  {isAdmin && (
                    <div className="md:col-span-4">
                      <p className="text-muted-foreground">S3 object key</p>
                      {storageKey ? (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs break-all">{storageKey}</span>
                          <button
                            onClick={() => handleCopy(storageKey, 'key')}
                            className="text-muted-foreground hover:text-foreground shrink-0"
                            title="Copy storage key"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          {copiedField === 'key' && <span className="text-xs text-emerald-600">Copied</span>}
                        </div>
                      ) : (
                        <p className="font-medium">Not recorded</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* PDF info */}
              <div>
                <h4 className="font-semibold text-foreground mb-2">PDF</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Pages</p>
                    <p className="font-medium">{getPageCount(template) ?? 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Fillable</p>
                    <p className="font-medium">{isFillable(template) ? 'Yes' : 'No'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Detected fields</p>
                    <p className="font-medium">{getFieldCount(template)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Validation</p>
                    <p className="font-medium">{template.parserMetadata?.status || 'Not parsed'}</p>
                  </div>
                </div>
              </div>

              {/* Health checklist */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-foreground">Health checks</h4>
                  <button
                    onClick={() => handleRunDeepVerification(template._id)}
                    disabled={detailDeepLoading}
                    className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-60"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    {detailDeepLoading ? 'Verifying…' : 'Run deep verification'}
                  </button>
                </div>
                {!health ? (
                  <p className="text-sm text-muted-foreground">
                    Health has not been checked for this form yet. Run deep verification to check it now.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {(health.checks || []).map((item) => (
                      <li key={item.id} className="flex items-start gap-2 text-sm">
                        <CheckIcon status={item.status} />
                        <span>
                          <span className="font-medium">{item.label}</span>
                          {item.detail && <span className="text-muted-foreground"> — {item.detail}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Visa mappings */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-foreground">Visa mappings</h4>
                  {isAdmin && !mappingDraft && (
                    <button
                      onClick={() => setMappingDraft({
                        visaType: '',
                        provisioningType: '',
                        componentType: '',
                        triggerCondition: '',
                        displayOrder: '',
                        notes: ''
                      })}
                      className="btn-secondary text-sm flex items-center gap-1"
                      disabled={visaRegistry.visaTypes.length === 0}
                      title={visaRegistry.visaTypes.length === 0 ? 'The visa registry is unavailable' : undefined}
                    >
                      <Plus className="w-4 h-4" />
                      Add mapping
                    </button>
                  )}
                </div>

                {mappingError && (
                  <div className="mb-2 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
                    {mappingError}
                  </div>
                )}

                {detailLoading ? (
                  <p className="text-sm text-muted-foreground">Loading mappings…</p>
                ) : mappings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No visa mappings — this form is never auto-assigned to a case.</p>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-3 font-medium text-muted-foreground text-sm">Visa</th>
                        <th className="text-left py-2 px-3 font-medium text-muted-foreground text-sm">Assignment Type</th>
                        <th className="text-left py-2 px-3 font-medium text-muted-foreground text-sm">Component</th>
                        <th className="text-left py-2 px-3 font-medium text-muted-foreground text-sm">Active</th>
                        {isAdmin && <th className="text-left py-2 px-3 font-medium text-muted-foreground text-sm">Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {mappings.map((mapping) => (
                        <tr key={mapping._id} className="border-b border-border text-sm">
                          <td className="py-2 px-3 font-medium">{mapping.visaType}</td>
                          <td className="py-2 px-3">{mapping.provisioningType}</td>
                          <td className="py-2 px-3">{mapping.componentType || '—'}</td>
                          <td className="py-2 px-3">{mapping.active === false ? 'No' : 'Yes'}</td>
                          {isAdmin && (
                            <td className="py-2 px-3">
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => setMappingDraft({
                                    _id: mapping._id,
                                    visaType: mapping.visaType,
                                    provisioningType: mapping.provisioningType,
                                    componentType: mapping.componentType || '',
                                    triggerCondition: mapping.triggerCondition || '',
                                    displayOrder: mapping.displayOrder ?? '',
                                    notes: mapping.notes || ''
                                  })}
                                  className="btn-secondary text-sm flex items-center gap-1"
                                >
                                  <Edit className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleRemoveMapping(mapping._id)}
                                  className="bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {isAdmin && mappingDraft && (
                  <div className="mt-3 border border-border rounded-xl p-4 space-y-3">
                    <p className="font-medium text-foreground text-sm">
                      {mappingDraft._id ? 'Edit mapping' : 'New mapping'}
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-muted-foreground mb-1">Visa Type</label>
                        <select
                          value={mappingDraft.visaType}
                          onChange={(e) => setMappingDraft({ ...mappingDraft, visaType: e.target.value })}
                          className="input-field"
                          disabled={Boolean(mappingDraft._id)}
                        >
                          <option value="">Select a visa type</option>
                          {visaRegistry.visaTypes.map((visa) => (
                            <option key={visa.value} value={visa.value}>{visa.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-muted-foreground mb-1">Assignment Type</label>
                        <select
                          value={mappingDraft.provisioningType}
                          onChange={(e) => setMappingDraft({ ...mappingDraft, provisioningType: e.target.value })}
                          className="input-field"
                        >
                          <option value="">Select an assignment type</option>
                          {visaRegistry.provisioningTypes.map((item) => (
                            <option key={item} value={item}>{item}</option>
                          ))}
                        </select>
                      </div>
                      {!mappingDraft._id && (
                        <div>
                          <label className="block text-sm font-medium text-muted-foreground mb-1">Component Type</label>
                          <select
                            value={mappingDraft.componentType}
                            onChange={(e) => setMappingDraft({ ...mappingDraft, componentType: e.target.value })}
                            className="input-field"
                          >
                            <option value="">Default</option>
                            {visaRegistry.componentTypes.map((item) => (
                              <option key={item} value={item}>{item}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div>
                        <label className="block text-sm font-medium text-muted-foreground mb-1">Display Order</label>
                        <input
                          type="number"
                          value={mappingDraft.displayOrder}
                          onChange={(e) => setMappingDraft({ ...mappingDraft, displayOrder: e.target.value })}
                          className="input-field"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-muted-foreground mb-1">Trigger Condition</label>
                        <input
                          type="text"
                          value={mappingDraft.triggerCondition}
                          onChange={(e) => setMappingDraft({ ...mappingDraft, triggerCondition: e.target.value })}
                          className="input-field"
                          placeholder="Optional — only for CONDITIONAL assignments"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-muted-foreground mb-1">Notes</label>
                        <input
                          type="text"
                          value={mappingDraft.notes}
                          onChange={(e) => setMappingDraft({ ...mappingDraft, notes: e.target.value })}
                          className="input-field"
                        />
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button onClick={() => { setMappingDraft(null); setMappingError('') }} className="btn-secondary flex-1">
                        Cancel
                      </button>
                      <button onClick={handleSaveMapping} disabled={mappingSaving} className="btn-primary flex-1 disabled:opacity-60">
                        {mappingSaving ? 'Saving…' : 'Save mapping'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Version history */}
              <div>
                <h4 className="font-semibold text-foreground mb-2">Version history</h4>
                {detailLoading ? (
                  <p className="text-sm text-muted-foreground">Loading versions…</p>
                ) : detailVersions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No other versions recorded for this form.</p>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-3 font-medium text-muted-foreground text-sm">Version</th>
                        <th className="text-left py-2 px-3 font-medium text-muted-foreground text-sm">Edition</th>
                        <th className="text-left py-2 px-3 font-medium text-muted-foreground text-sm">Status</th>
                        <th className="text-left py-2 px-3 font-medium text-muted-foreground text-sm">Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailVersions.map((item) => (
                        <tr key={item._id || item.id || item.version} className="border-b border-border text-sm">
                          <td className="py-2 px-3 font-medium">{item.version}</td>
                          <td className="py-2 px-3">{formatDate(item.editionDate)}</td>
                          <td className="py-2 px-3">
                            <span className={`badge ${getTemplateStatusColor(item.status)}`}>
                              {(item.status || 'unknown').replace('_', ' ')}
                            </span>
                          </td>
                          <td className="py-2 px-3">{formatDate(item.updatedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Import Definition Modal */}
      {showImportDefinitionModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-card rounded-2xl p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-xl font-bold text-foreground">Import USCIS Form Definition</h3>
                <p className="text-sm text-muted-foreground">Paste metadata JSON with sections, fields, mappings, validation, conditions, and repeatable groups.</p>
              </div>
              <button onClick={() => setShowImportDefinitionModal(false)} className="text-muted-foreground hover:text-muted-foreground">
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
          <div className="bg-card rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-foreground">Add Form Template</h3>
              <button onClick={() => setShowAddTemplateModal(false)} className="text-muted-foreground hover:text-muted-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateTemplate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">Form Code</label>
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
                  <label className="block text-sm font-medium text-muted-foreground mb-1">Version</label>
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
                <label className="block text-sm font-medium text-muted-foreground mb-1">Title</label>
                <input
                  type="text"
                  value={templateFormData.title}
                  onChange={(e) => setTemplateFormData({ ...templateFormData, title: e.target.value })}
                  className="input-field"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Description</label>
                <textarea
                  value={templateFormData.description}
                  onChange={(e) => setTemplateFormData({ ...templateFormData, description: e.target.value })}
                  className="input-field min-h-[80px]"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">Edition Date</label>
                  <input
                    type="date"
                    value={templateFormData.editionDate}
                    onChange={(e) => setTemplateFormData({ ...templateFormData, editionDate: e.target.value })}
                    className="input-field"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">Effective Date</label>
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
                <label className="block text-sm font-medium text-muted-foreground mb-1">Official PDF URL</label>
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
          <div className="bg-card rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-foreground">Edit Form Template</h3>
              <button onClick={() => setShowEditTemplateModal(false)} className="text-muted-foreground hover:text-muted-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleUpdateTemplate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">Form Code</label>
                  <input
                    type="text"
                    value={templateFormData.formCode}
                    onChange={(e) => setTemplateFormData({ ...templateFormData, formCode: e.target.value })}
                    className="input-field"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">Version</label>
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
                <label className="block text-sm font-medium text-muted-foreground mb-1">Title</label>
                <input
                  type="text"
                  value={templateFormData.title}
                  onChange={(e) => setTemplateFormData({ ...templateFormData, title: e.target.value })}
                  className="input-field"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Description</label>
                <textarea
                  value={templateFormData.description}
                  onChange={(e) => setTemplateFormData({ ...templateFormData, description: e.target.value })}
                  className="input-field min-h-[80px]"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">Edition Date</label>
                  <input
                    type="date"
                    value={templateFormData.editionDate}
                    onChange={(e) => setTemplateFormData({ ...templateFormData, editionDate: e.target.value })}
                    className="input-field"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted-foreground mb-1">Effective Date</label>
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
                <label className="block text-sm font-medium text-muted-foreground mb-1">Official PDF URL</label>
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
          <div className="bg-card rounded-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-foreground">Fill Form for Case</h3>
              <button onClick={() => setShowFillFormModal(false)} className="text-muted-foreground hover:text-muted-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleFillForm} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Select Case</label>
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
                <label className="block text-sm font-medium text-muted-foreground mb-1">Select Form Template</label>
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
          <div className="bg-card rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-foreground">Case Form Details</h3>
              <button onClick={() => setShowViewFormModal(false)} className="text-muted-foreground hover:text-muted-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Form Code</p>
                  <p className="font-medium">{selectedCaseForm.formCode}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Version</p>
                  <p className="font-medium">{selectedCaseForm.formVersion}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <span className={`badge ${getCaseFormStatusColor(selectedCaseForm.status)}`}>
                    {selectedCaseForm.status.replace('_', ' ')}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Created</p>
                  <p className="font-medium">{new Date(selectedCaseForm.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
              {selectedCaseForm.filledData && (
                <div>
                  <p className="text-sm font-medium text-foreground mb-2">Filled Data</p>
                  <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
                    {JSON.stringify(selectedCaseForm.filledData, null, 2)}
                  </pre>
                </div>
              )}
              {selectedCaseForm.reviewComments && (
                <div>
                  <p className="text-sm font-medium text-foreground mb-2">Review Comments</p>
                  <p className="text-sm text-muted-foreground">{selectedCaseForm.reviewComments}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {infoModal && (
        <InfoModal
          title={infoModal.title}
          message={infoModal.message}
          variant={infoModal.variant}
          onClose={() => setInfoModal(null)}
        />
      )}
    </div>
  )
}

export default USCISForms
