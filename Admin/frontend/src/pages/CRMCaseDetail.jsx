import { Suspense, lazy, useState, useEffect, useCallback, useMemo, useRef, Component } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import api from '../services/api'
import { resolveDisplayVisa } from '../utils/visaDisplay'
import InfoModal from '../components/InfoModal'
import { uscisFormsApi, eligibilityApi, casesApi, lifecycleApi, clientIntakeApi, employmentWorkflowApi, questionnairesApi, familyWorkflowApi, formGenerationApi, invalidateCachedGet, documentsApi, readFormWarnings } from '../services/api'
import QuestionnaireAnswersPanel from '../components/QuestionnaireAnswersPanel'
import Eb1aCriteriaPanel from '../components/Eb1aCriteriaPanel'
import CaseFeedbackChat from '../components/CaseFeedbackChat'
import useCaseQuestionnaire from '../hooks/useCaseQuestionnaire'
import { useAuth } from '../contexts/AuthContext'
import { useSocket } from '../contexts/SocketContext'
import { 
  ArrowLeft, 
  User,    
  Briefcase, 
  Calendar, 
  DollarSign, 
  FileText, 
  MessageSquare, 
  CheckCircle, 
  AlertTriangle, 
  Plus,
  Save,
  FolderOpen,
  Receipt,
  PenTool,
  Clock,
  TrendingUp,
  Bell,
  UserPlus,
  Eye,
  Upload,
  X,
  Download,
  ZoomIn,
  ZoomOut,
  Loader2,
  XCircle,
  Copy,
  Check,
  Scale
} from 'lucide-react'

const USCISFormRenderer = lazy(() => import('../components/uscis/USCISFormRenderer'))
const PetitionTab = lazy(() => import('./petition/PetitionTab'))

// Scoped to the forms tab (not the top-level App.jsx ErrorBoundary, which
// reloads the whole page) so a render exception inside USCISFormRenderer -
// e.g. an unexpected workspace shape - surfaces a visible message and a way
// back to the form list instead of blanking/crashing the entire case page.
class FormRendererErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('USCIS form renderer crashed:', error, errorInfo)
  }

  componentDidUpdate(prevProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null })
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="card border-red-200 bg-red-50 p-6 text-red-700">
          <p className="font-semibold">This form couldn't be displayed.</p>
          <p className="mt-1 text-sm">{this.state.error?.message || 'An unexpected error occurred while rendering the form.'}</p>
          <button type="button" onClick={this.props.onBack} className="btn-secondary mt-3">Back to forms</button>
        </div>
      )
    }
    return this.props.children
  }
}

const USCIS_STATUSES = [
  'draft', 'ready_to_file', 'filed', 'delivered', 'receipt_issued',
  'biometrics_scheduled', 'biometrics_completed', 'interview_scheduled',
  'interview_completed', 'rfe_issued', 'rfe_response_submitted',
  'transferred', 'approved', 'denied', 'withdrawn', 'closed'
]

const emptyTracking = {
  status: 'draft',
  filing: {
    filingDate: '', receiptNumber: '', serviceCenter: '', lockbox: '',
    filingMethod: '', carrier: '', trackingNumber: '',
    deliveryConfirmationDate: '', filingFeeCents: 0,
    premiumProcessing: false,
  },
  rfe: {
    issueDate: '', responseDueDate: '', responseSubmittedDate: '',
    responsibleCaseManager: '', assignedTo: '', documentReferences: [],
    aiSummary: '', responseStatus: '',
  },
  notes: '',
}

const dateInput = (value) => value ? new Date(value).toISOString().slice(0, 10) : ''
const displayStatus = (value = '') => value.replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase())

const TrackingField = ({ label, children }) => (
  <label className="block">
    <span className="mb-1 block text-sm font-medium text-muted-foreground">{label}</span>
    {children}
  </label>
)

const formatPaymentAmount = (amount, currency = 'USD') => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: String(currency || 'USD').toUpperCase()
}).format((Number(amount) || 0) / 100)

const formatOptionalDate = (...values) => {
  for (const value of values) {
    if (!value) continue
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleDateString()
  }
  return 'Not available'
}

const formatFileSize = (size) => {
  const bytes = Number(size || 0)
  if (!bytes) return 'Size unavailable'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const getDocumentName = (document = {}) => document.originalFileName || document.originalName || document.fileName || document.name || 'Document'

function CaseDocumentViewer({ document, onClose }) {
  const [blobUrl, setBlobUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(100)
  const name = getDocumentName(document)
  const isPdf = document?.mimeType === 'application/pdf' || name.toLowerCase().endsWith('.pdf')
  const isImage = document?.mimeType?.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(name)

  useEffect(() => {
    if (!document?._id) return undefined
    setLoading(true)
    setError('')
    api.get(`/documents/${document._id}/preview`, { responseType: 'blob' })
      .then((response) => setBlobUrl(URL.createObjectURL(response.data)))
      .catch(() => setError('Unable to preview this document. Download it to open the file.'))
      .finally(() => setLoading(false))
    return () => {
      setBlobUrl((current) => {
        if (current) URL.revokeObjectURL(current)
        return ''
      })
    }
  }, [document?._id])

  const download = async () => {
    try {
      const url = blobUrl || URL.createObjectURL((await api.get(`/documents/${document._id}/preview`, { responseType: 'blob' })).data)
      const anchor = window.document.createElement('a')
      anchor.href = url
      anchor.download = name
      anchor.click()
      if (!blobUrl) setTimeout(() => URL.revokeObjectURL(url), 3000)
    } catch {
      setError('Unable to download this document.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/90 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-4 bg-slate-950 px-5 py-3 shadow-lg">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{name}</p>
          <p className="text-xs text-slate-400">{displayStatus(document?.documentType || 'document')} · {formatFileSize(document?.fileSize || document?.size)}</p>
        </div>
        <div className="flex items-center gap-2">
          {isImage && (
            <>
              <button type="button" onClick={() => setZoom((value) => Math.max(25, value - 25))} className="rounded-lg bg-slate-800 p-2 text-slate-200 hover:bg-slate-700" title="Zoom out">
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="w-12 text-center text-xs font-semibold text-slate-300">{zoom}%</span>
              <button type="button" onClick={() => setZoom((value) => Math.min(300, value + 25))} className="rounded-lg bg-slate-800 p-2 text-slate-200 hover:bg-slate-700" title="Zoom in">
                <ZoomIn className="h-4 w-4" />
              </button>
            </>
          )}
          <button type="button" onClick={download} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">
            <Download className="h-4 w-4" /> Download
          </button>
          <button type="button" onClick={onClose} className="rounded-lg bg-slate-800 p-2 text-slate-200 hover:bg-slate-700" title="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-5">
        {loading && (
          <div className="flex flex-col items-center gap-3 text-slate-300">
            <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
            <p className="text-sm">Loading preview...</p>
          </div>
        )}
        {!loading && error && (
          <div className="flex max-w-sm flex-col items-center gap-4 text-center">
            <XCircle className="h-10 w-10 text-red-400" />
            <p className="text-sm text-slate-300">{error}</p>
          </div>
        )}
        {!loading && !error && blobUrl && isPdf && (
          <div className="flex h-full w-full items-center justify-center">
            <iframe src={blobUrl} title="Document preview" className="h-full min-h-[72vh] w-full max-w-6xl rounded-lg bg-card shadow-2xl" />
          </div>
        )}
        {!loading && !error && blobUrl && isImage && (
          <div className="flex min-h-full min-w-full items-center justify-center p-6">
            <img
              src={blobUrl}
              alt="Document preview"
              style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'center center' }}
              className="max-h-[78vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            />
          </div>
        )}
        {!loading && !error && blobUrl && !isPdf && !isImage && (
          <div className="flex max-w-sm flex-col items-center gap-4 text-center">
            <FileText className="h-10 w-10 text-slate-400" />
            <p className="text-sm text-slate-300">Preview is not available for this file type.</p>
            <button type="button" onClick={download} className="btn-primary inline-flex items-center gap-2">
              <Download className="h-4 w-4" /> Download file
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function CaseDocumentUploadPanel({ caseId, checklistItems = [], onUploaded }) {
  const inputRef = useRef(null)
  const [selectedFiles, setSelectedFiles] = useState([])
  const [documentType, setDocumentType] = useState(checklistItems[0]?.documentType || 'supporting_evidence')
  const [category, setCategory] = useState(checklistItems[0]?.category || 'supporting')
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')

  const upload = async () => {
    if (!caseId || !selectedFiles.length) return
    setUploading(true)
    setMessage('')
    try {
      for (const file of selectedFiles) {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('caseId', caseId)
        formData.append('documentType', documentType)
        formData.append('category', category)
        formData.append('legacySource', 'INSZoom')
        await api.post('/documents', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
      }
      setSelectedFiles([])
      if (inputRef.current) inputRef.current.value = ''
      setMessage('Documents uploaded successfully.')
      onUploaded?.()
    } catch (error) {
      setMessage(error.response?.data?.message || 'Unable to upload document.')
    } finally {
      setUploading(false)
    }
  }

  const documentTypeOptions = checklistItems.length
    ? checklistItems.map((item) => [item.documentType || item.type || item.name, item.name || item.title || item.documentType]).filter(([value]) => value)
    : [['supporting_evidence', 'Supporting Evidence'], ['passport', 'Passport'], ['i94', 'I-94'], ['resume', 'Resume / CV'], ['other', 'Other']]

  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <label>
          <span className="mb-1 block text-xs font-semibold text-blue-900">Document Type</span>
          <select value={documentType} onChange={(event) => setDocumentType(event.target.value)} className="input-field bg-card text-sm">
            {documentTypeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold text-blue-900">Category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)} className="input-field bg-card text-sm">
            {['identity', 'education', 'employment', 'financial', 'civil', 'immigration', 'business', 'legal', 'government', 'supporting', 'evidence', 'other'].map((value) => (
              <option key={value} value={value}>{displayStatus(value)}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => inputRef.current?.click()} className="btn-secondary inline-flex items-center justify-center gap-2">
          <Upload className="h-4 w-4" /> Choose Files
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,.doc,.docx,.txt,.csv,.zip"
        className="hidden"
        onChange={(event) => setSelectedFiles(Array.from(event.target.files || []))}
      />
      {selectedFiles.length > 0 && (
        <div className="mt-3 space-y-2">
          {selectedFiles.map((file, index) => (
            <div key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 rounded-lg bg-card px-3 py-2 text-sm">
              <span className="min-w-0 truncate font-medium text-foreground">{file.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatFileSize(file.size)}</span>
            </div>
          ))}
        </div>
      )}
      {message && <p className={`mt-3 text-sm font-semibold ${message.includes('success') ? 'text-blue-800' : 'text-red-600'}`}>{message}</p>}
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={upload} disabled={!selectedFiles.length || uploading} className="btn-primary inline-flex items-center gap-2 disabled:opacity-50">
          <Upload className="h-4 w-4" /> {uploading ? 'Uploading...' : 'Upload Document'}
        </button>
      </div>
    </div>
  )
}

const CRMCaseDetail = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { subscribe, connected } = useSocket()
  const [liveUpdateBanner, setLiveUpdateBanner] = useState('')
  const [activeTab, setActiveTab] = useState('overview')
  const [caseData, setCaseData] = useState(null)
  // Same SSOT questionnaire resolution the client portal uses (server-side
  // visa-type matching — no H-1B/L-1A detection lives on this frontend).
  // Overview vs. Documents restructuring: everything that requires reading
  // questionnaire answers or document types (all QuestionnaireAnswersPanel
  // variants, the Document Checklist grid) now lives on the Documents tab,
  // not Overview — Overview
  // is summary-only (case type, filing/petition type, employee count,
  // status/stage, assigned staff, key dates). documentsActive gates every
  // hook that feeds those blocks (previously gated on the Overview tab).
  const documentsActive = activeTab === 'documents'
  // BUG (fixed): a principal case (the employer-side container in an
  // employer_employee matter) has no employee Answers of its own — those
  // live on each CHILD case (caseRole: 'employee'), keyed by the CHILD's own
  // caseId/responseId. Querying targetRole="employee" against the
  // PRINCIPAL's own caseId can never find them, so this panel always
  // rendered empty ("Needed" on every field) on the principal's own
  // Overview — not lost data, just the wrong case being asked. The
  // principal's Overview already has a dedicated "Employees (N)" section
  // (below) linking to each child's own page, where this same hook/panel
  // correctly shows THAT employee's real data (caseData._id there IS the
  // child's id). A non-principal case (a plain single-entity case, or a
  // child case itself) still queries normally — this only skips the
  // redundant, structurally-always-empty query on the container case.
  const isPrincipalContainer = caseData?.caseRole === 'principal'
  const employerQuestionnaire = useCaseQuestionnaire(caseData?._id, 'employer', { enabled: documentsActive })
  const employeeQuestionnaire = useCaseQuestionnaire(caseData?._id, 'employee', { enabled: documentsActive && !isPrincipalContainer })
  const businessPlanQuestionnaire = useCaseQuestionnaire(caseData?._id, 'business_plan', { enabled: documentsActive })
  // E-2 Treaty Investor's third checklist (Backend
  // src/modules/employment-workflow/questionnaires/e2.js /
  // src/modules/questionnaires/employmentChecklists.js — checklistRole
  // "supporting_documents"). The E-2 Visa checklist itself reuses the
  // existing "employer" role/hook above; only this document-only checklist
  // needed its own role.
  const supportingDocumentsQuestionnaire = useCaseQuestionnaire(caseData?._id, 'supporting_documents', { enabled: documentsActive })
  // Family/sponsor (K-1/K-3) cases carry the petitioner/beneficiary pair of
  // checklists instead of employer/employee (see Backend
  // src/modules/questionnaires/familyChecklists.js — checklistRole "petitioner"
  // / "beneficiary"). Without these two the staff overview rendered nothing at
  // all for a K-1 case. Gated on the case actually being a family case so no
  // other visa type pays for two extra requests or shows extra loading cards;
  // the same three shapes the client portal's resolveApplicableChecklistRoles
  // treats as "family".
  const isFamilyCase = Boolean(
    caseData && (caseData.caseStructure === 'family' || caseData.petitionerUser || caseData.beneficiaryUser)
  )
  // "Renew, Replace, Correct or Update Green Card" (Form I-90) - an
  // EXISTING Green Card holder's own single-party service, unrelated to
  // the family petition/AOS/GC-NVC workflows above (no petitioner/
  // beneficiary split - checklistRole "client", same single-party
  // mechanism as EB-1A/EB-2 NIW/etc.).
  const isGreenCardRenewalCase = caseData?.visaType === 'Green Card Renewal'
  const greenCardRenewalQuestionnaire = useCaseQuestionnaire(caseData?._id, 'client', { enabled: documentsActive && isGreenCardRenewalCase })
  const petitionerQuestionnaire = useCaseQuestionnaire(caseData?._id, 'petitioner', { enabled: documentsActive && isFamilyCase })
  const beneficiaryQuestionnaire = useCaseQuestionnaire(caseData?._id, 'beneficiary', { enabled: documentsActive && isFamilyCase })
  // I-864 joint sponsor - a third party distinct from the petitioner, only
  // ever present once one is actually added to the case (Case.jointSponsorUser).
  // Same pattern as the two panels above, gated additionally on that field
  // so a case with no joint sponsor never pays for the extra request.
  const showJointSponsorPanel = isFamilyCase && Boolean(caseData?.jointSponsorUser)
  const jointSponsorQuestionnaire = useCaseQuestionnaire(caseData?._id, 'joint_sponsor', { enabled: documentsActive && showJointSponsorPanel })
  // Filing Path (Case.processingPath) - which of the I-130/Green-Card/I-864
  // checklists apply (see family-workflow.controller.js's
  // ensureFamilyChecklistReferences, re-run server-side when this changes).
  const [filingPath, setFilingPath] = useState('')
  const [savingFilingPath, setSavingFilingPath] = useState(false)
  useEffect(() => { setFilingPath(caseData?.processingPath || '') }, [caseData?.processingPath])
  const handleSaveFilingPath = async () => {
    setSavingFilingPath(true)
    try {
      await casesApi.update(id, { processingPath: filingPath })
      await fetchCaseDetail()
    } catch (err) {
      console.error('Error saving filing path:', err)
    } finally {
      setSavingFilingPath(false)
    }
  }
  // Server-computed checklist completeness (calculateDetailedProgress, via
  // listCaseChecklists) — the same numbers Immiglance's client portal shows, matched
  // by responseId to the questionnaires resolved above.
  const [checklistsProgress, setChecklistsProgress] = useState([])
  // Pulled out of the effect below so the client-submitted socket handler
  // (further down this file) can force the same refresh on demand, bypassing
  // questionnairesApi.listCaseChecklists' own 5s cachedGet TTL via
  // invalidateCachedGet - otherwise a case manager already viewing this case
  // could keep seeing pre-submission checklist progress for up to 5s (or
  // until they navigate away and back) after the client submits.
  const fetchChecklistsProgress = useCallback(async (caseId) => {
    if (!caseId) { setChecklistsProgress([]); return }
    try {
      const response = await questionnairesApi.listCaseChecklists(caseId)
      setChecklistsProgress(response.data?.data?.checklists || [])
    } catch {
      setChecklistsProgress([])
    }
  }, [])
  useEffect(() => {
    if (!documentsActive || !caseData?._id) { setChecklistsProgress([]); return }
    fetchChecklistsProgress(caseData._id)
  }, [caseData?._id, documentsActive, fetchChecklistsProgress])
  // Optional "Green Card – National Visa Center (NVC) / Consular Processing
  // Checklist" (gc_nvc_<slug>_checklist) - exists as a template for every
  // CONSULAR-eligible family case, but is only ASSIGNED (and therefore only
  // findable in checklistsProgress) once a Case Manager explicitly approves
  // it via approveGcNvcChecklist. It shares checklistRole "beneficiary"
  // with the Green Card checklist, so it's looked up by its own
  // referenceId (from checklistsProgress) rather than by role alone - see
  // useCaseQuestionnaire's referenceId option.
  const gcNvcEligible = isFamilyCase && caseData?.processingPath === 'CONSULAR'
  const gcNvcChecklistEntry = checklistsProgress.find((item) => item.key?.startsWith('gc_nvc_'))
  const gcNvcApproved = Boolean(caseData?.gcNvcChecklist?.approved)
  const gcNvcQuestionnaire = useCaseQuestionnaire(caseData?._id, 'beneficiary', {
    enabled: documentsActive && gcNvcApproved && Boolean(gcNvcChecklistEntry),
    referenceId: gcNvcChecklistEntry?.referenceId,
  })
  const [approvingGcNvc, setApprovingGcNvc] = useState(false)
  const handleApproveGcNvcChecklist = async () => {
    setApprovingGcNvc(true)
    try {
      await familyWorkflowApi.approveGcNvcChecklist(caseData._id)
      await fetchCaseDetail()
    } catch (err) {
      console.error('Error approving GC-NVC checklist:', err)
    } finally {
      setApprovingGcNvc(false)
    }
  }
  const relevantResponseIds = [employerQuestionnaire.responseId, employeeQuestionnaire.responseId, businessPlanQuestionnaire.responseId, supportingDocumentsQuestionnaire.responseId].filter(Boolean)
  const relevantChecklistProgress = checklistsProgress.filter((c) => relevantResponseIds.includes(c.responseId) && c.documentProgress)
  // Scoped to upload (file-type) questions only — c.progress mixes in
  // questionnaire field answers, which QuestionnaireAnswersPanel already
  // renders separately, so using it here double-counted field answers as
  // "documents pending".
  const documentsProgress = {
    totalRequired: relevantChecklistProgress.reduce((sum, c) => sum + (c.documentProgress.totalRequired || 0), 0),
    answeredRequired: relevantChecklistProgress.reduce((sum, c) => sum + (c.documentProgress.answeredRequired || 0), 0),
    missingRequired: relevantChecklistProgress.flatMap((c) => c.documentProgress.missingRequired || []),
  }
  const [loading, setLoading] = useState(true)
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [showStaffDetailsModal, setShowStaffDetailsModal] = useState(false)
  const [assignmentPrompted, setAssignmentPrompted] = useState(false)
  const [assignType, setAssignType] = useState('case_manager')
  const [assigneeId, setAssigneeId] = useState('')
  const [assignPriority, setAssignPriority] = useState('')
  const [assignInternalNote, setAssignInternalNote] = useState('')
  const [assignError, setAssignError] = useState('')
  const [assigning, setAssigning] = useState(false)
  // P12-S2: replaces a window.alert() previously fired here.
  const [infoModal, setInfoModal] = useState(null)
  // P12-S3: Case ID copy-to-clipboard feedback (case header).
  const [caseIdCopied, setCaseIdCopied] = useState(false)
  const [users, setUsers] = useState([])
  // Attorneys are deliberately NOT in ASSIGNABLE_ROLES (Backend/src/modules/
  // users/user.service.js) — mixing them into the general staff dropdown
  // would let someone assign an attorney as "Case Manager"/"Team Lead" by
  // mistake. Fetched separately, only for the attorney row of this same
  // modal.
  const [attorneyUsers, setAttorneyUsers] = useState([])
  // Phase 7 — populated only for principal cases (childCaseCount > 0); holds
  // the child cases returned by GET /cases/:id/related, which — unlike the
  // parentCase/childCases already embedded on caseData via casesApi.get —
  // also carries assignedCaseManager and assignmentOverridden per child.
  const [childCases, setChildCases] = useState(null)
  // Employer data is shared with every child case (see Backend's
  // sharedCaseRoles.js) — a child's own checklistItems only ever holds its
  // OWN (employee-side) required documents (filterChecklistForRole at
  // addEmployeeSlot). Fetched once per case so the Documents tab can show
  // the principal's required items alongside this employee's own, tagged
  // "Employer • Shared" instead of only ever showing half the picture.
  const [parentChecklistItems, setParentChecklistItems] = useState([])
  const [showRemovedEmployees, setShowRemovedEmployees] = useState(false)
  const [employeeActionBusy, setEmployeeActionBusy] = useState('')
  const [employeeActionMessage, setEmployeeActionMessage] = useState('')

  // Tab-specific data and loading states
  const [fetched, setFetched] = useState({ overview: true, documents: false, forms: false, petition: true, strategy: false, payments: false, letters: false, notes: false, tracking: false })
  const [tabLoading, setTabLoading] = useState({ documents: false, forms: false, strategy: false, payments: false, letters: false, notes: false, tracking: false })
  const [documents, setDocuments] = useState([])
  const [viewingDocument, setViewingDocument] = useState(null)
  // In-place text editing (client-uploaded .txt/.csv/.md files) - case
  // manager view/edit/save, versioned exactly like any other document
  // replace (documentsApi.saveContent -> addDocumentVersion under the hood).
  const [editingDocument, setEditingDocument] = useState(null)
  const [editingContent, setEditingContent] = useState('')
  const [editingLoading, setEditingLoading] = useState(false)
  const [editingSaving, setEditingSaving] = useState(false)
  const [editingError, setEditingError] = useState('')
  const isTextEditableDocument = (doc) => (
    ['text/plain', 'text/csv', 'text/markdown'].includes(doc?.mimeType) ||
    /\.(txt|csv|md)$/i.test(doc?.originalName || doc?.fileName || '')
  )
  const openDocumentEditor = async (doc) => {
    setEditingDocument(doc)
    setEditingError('')
    setEditingContent('')
    setEditingLoading(true)
    try {
      const response = await documentsApi.getContent(doc._id)
      setEditingContent(response.data.content || '')
    } catch (error) {
      setEditingError(error.response?.data?.message || 'Unable to load document content')
    } finally {
      setEditingLoading(false)
    }
  }
  const saveDocumentEditor = async () => {
    setEditingSaving(true)
    setEditingError('')
    try {
      await documentsApi.saveContent(editingDocument._id, editingContent)
      setEditingDocument(null)
      await fetchDocuments(true)
    } catch (error) {
      setEditingError(error.response?.data?.message || 'Unable to save document content')
    } finally {
      setEditingSaving(false)
    }
  }
  const [showCaseDocumentUpload, setShowCaseDocumentUpload] = useState(false)
  const [intakeBundle, setIntakeBundle] = useState(null)
  const [caseForms, setCaseForms] = useState([])
  // uscis-form.service.js's listCaseForms returns every CaseForm (parent AND
  // supplement/component, e.g. I-129's H Classification Supplement) as one
  // flat array with no ordering guarantee - the Forms table below used to
  // render them in whatever order the DB returned, so a component form
  // (componentCode set, parentFormCode pointing back at "I-129") could show
  // up several rows away from its parent with nothing distinguishing it from
  // an unrelated standalone form. Groups each component row directly under
  // its parent (matched by formCode <-> parentFormCode, the only linking
  // fields listCaseForms' .select() projection actually returns - it omits
  // parentCaseFormId) and indents/labels it, purely a display grouping; the
  // underlying data and download/autofill actions per row are unchanged.
  // BUG (fixed): grouped parent/component nesting purely by formCode string
  // match (form.parentFormCode === some standalone form's own formCode),
  // with no caseId awareness at all. For an ordinary single case that's
  // fine (one CaseForm per formCode). But listCaseForms (uscis-form.service.js)
  // deliberately aggregates every CHILD case's own CaseForms into this same
  // flat array for a caseRole=principal case (each employee gets their own
  // full I-129/I-907/I-539/supplement set, all sharing the same formCodes) -
  // so this grouping silently nested Employee A's H-1B supplement under
  // Employee B's I-129 row whenever iteration order put them together,
  // and the flat list as a whole just looked like the same forms
  // duplicated over and over with no indication of whose they were.
  // Grouping first by caseId (falling back to the form's own caseId when
  // there's no case-owner map, i.e. every non-principal case) fixes the
  // display; see the USCISFormRenderer caseId fix below for the matching
  // "Open Form" 404 this same aggregation caused.
  const caseFormGroups = useMemo(() => {
    const byOwner = new Map()
    caseForms.forEach((form) => {
      const ownerId = String(form.caseId?._id || form.caseId || id)
      if (!byOwner.has(ownerId)) byOwner.set(ownerId, [])
      byOwner.get(ownerId).push(form)
    })
    const ownerLabel = (ownerId) => {
      if (ownerId === String(id)) return childCases?.length ? 'Petitioner / Company' : null
      const child = (childCases || []).find((c) => String(c._id) === ownerId)
      return child ? (child.clientName || child.caseNumber || 'Employee') : null
    }
    return [...byOwner.entries()].map(([ownerId, forms]) => {
      const byParentCode = new Map()
      const standalone = []
      forms.forEach((form) => {
        if (form.parentFormCode) {
          if (!byParentCode.has(form.parentFormCode)) byParentCode.set(form.parentFormCode, [])
          byParentCode.get(form.parentFormCode).push(form)
        } else {
          standalone.push(form)
        }
      })
      const ordered = []
      standalone.forEach((form) => {
        ordered.push({ form, isComponent: false })
        const children = byParentCode.get(form.formCode)
        if (children) children.forEach((child) => ordered.push({ form: child, isComponent: true }))
        byParentCode.delete(form.formCode)
      })
      byParentCode.forEach((children) => children.forEach((child) => ordered.push({ form: child, isComponent: true })))
      return { ownerId, label: ownerLabel(ownerId), rows: ordered }
    })
  }, [caseForms, childCases, id])
  // Unchanged shape for every caller that doesn't need owner grouping
  // (an ordinary single case only ever has one group anyway).
  const sortedCaseForms = useMemo(() => caseFormGroups.flatMap((group) => group.rows), [caseFormGroups])
  const [formsError, setFormsError] = useState('')
  const [selectedCaseForm, setSelectedCaseForm] = useState(null)
  const [formActionMessage, setFormActionMessage] = useState('')
  const [formsWarning, setFormsWarning] = useState('')
  // Phase 1: the full registry-resolved form set for this case's visa
  // (provisioned or not) - the Forms tab's single source of truth for "what
  // forms this case needs". caseForms (above) stays as-is; it's still what
  // the interactive workspace opens by _id.
  const [formsOverview, setFormsOverview] = useState({ items: [], diagnostics: [] })
  const [formsOverviewError, setFormsOverviewError] = useState('')
  // mappingId/formNumber currently mid-action, so only that row's buttons
  // show a busy state rather than disabling the whole table.
  const [rowActionPending, setRowActionPending] = useState('')
  const [eligibility, setEligibility] = useState(null)
  const [payments, setPayments] = useState([])
  const [letters, setLetters] = useState([])
  const [tracking, setTracking] = useState(emptyTracking)
  const [trackingDocuments, setTrackingDocuments] = useState([])
  const [trackingTimeline, setTrackingTimeline] = useState([])
  const [trackingMessage, setTrackingMessage] = useState('')
  const [savingTracking, setSavingTracking] = useState(false)

  // Modal states
  const [showStageUpdateModal, setShowStageUpdateModal] = useState(false)
  const [newStage, setNewStage] = useState('')
  const [showRecordPaymentModal, setShowRecordPaymentModal] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [paymentError, setPaymentError] = useState('')
  const [recordingPayment, setRecordingPayment] = useState(false)
  const [manualPaymentRequestId, setManualPaymentRequestId] = useState('')
  const [selectedPaymentId, setSelectedPaymentId] = useState('')
  const [showCreateLetterModal, setShowCreateLetterModal] = useState(false)
  const [letterType, setLetterType] = useState('')
  const [infoRequestForm, setInfoRequestForm] = useState({
    target: 'employee',
    requestType: 'profile',
    title: '',
    description: '',
  })
  const [infoRequestMessage, setInfoRequestMessage] = useState('')
  const [sendingInfoRequest, setSendingInfoRequest] = useState(false)

  const STAGES = ['intake', 'strategy', 'evidence', 'letters', 'form_preparation', 'filing', 'uscis_pending', 'approved', 'denied']
  const normalizedRole = String(user?.role || '').toLowerCase().replace(/[\s-]+/g, '_')
  const canRecordPayment = ['super_admin', 'admin', 'team_lead'].includes(normalizedRole)

  useEffect(() => {
    setFetched({ overview: true, documents: false, forms: false, petition: true, strategy: false, payments: false, letters: false, notes: false, tracking: false })
    setDocuments([])
    setCaseForms([])
    setSelectedCaseForm(null)
    setEligibility(null)
    setPayments([])
    setLetters([])
    setTracking(emptyTracking)
    fetchCaseDetail()
  }, [id])

  // Perf fix: /users/assignable used to fire unconditionally on every case
  // open even though it's only ever needed for the assignment modal or the
  // tracking tab's RFE "Responsible Case Manager" select. Deferred to first
  // actual need via ensureUsers() below - watching showAssignModal (rather
  // than editing every setShowAssignModal(true) call site individually)
  // guarantees every place that opens the modal is covered, including any
  // added later.
  const usersLoaded = useRef(false)
  const ensureUsers = useCallback(async () => {
    if (usersLoaded.current || users.length > 0) return
    usersLoaded.current = true
    try {
      const response = await api.get('/users/assignable')
      setUsers(response.data.users || [])
    } catch (error) {
      usersLoaded.current = false
      console.error('Error fetching users:', error)
    }
  }, [users.length])

  const attorneysLoaded = useRef(false)
  const ensureAttorneys = useCallback(async () => {
    if (attorneysLoaded.current || attorneyUsers.length > 0) return
    attorneysLoaded.current = true
    try {
      const response = await api.get('/users/assignable', { params: { role: 'attorney' } })
      setAttorneyUsers(response.data.users || [])
    } catch (error) {
      attorneysLoaded.current = false
      console.error('Error fetching attorneys:', error)
    }
  }, [attorneyUsers.length])

  useEffect(() => {
    if (showAssignModal) {
      ensureUsers()
      ensureAttorneys()
    }
  }, [showAssignModal, ensureUsers, ensureAttorneys])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const requestedTab = params.get('tab')
    if (['overview', 'documents', 'forms', 'petition', 'tracking', 'feedback'].includes(requestedTab)) {
      setActiveTab(requestedTab)
    }
    if (!assignmentPrompted && params.get('assign')) {
      setAssignType(params.get('assign'))
      setShowAssignModal(true)
      setAssignmentPrompted(true)
    }
  }, [location.search, assignmentPrompted])

  const fetchCaseDetail = async () => {
    try {
      setLoading(true)
      const [response, intakeResponse] = await Promise.all([
        casesApi.get(id),
        clientIntakeApi.caseIntake(id).catch(() => null)
      ])
      const nextCase = response.data.case
      setCaseData(nextCase)
      setIntakeBundle(intakeResponse?.data?.intake || null)
      if (nextCase.caseRole === 'principal' && nextCase.childCaseCount > 0) {
        casesApi.getRelated(id)
          .then((relatedResponse) => setChildCases(relatedResponse.data.childCases || []))
          .catch((error) => {
            console.error('Error fetching child cases:', error)
            setChildCases([])
          })
      } else {
        setChildCases(null)
      }
    } catch (error) {
      console.error('Error fetching case detail:', error)
    } finally {
      setLoading(false)
    }
  }

  const refetchChildCases = async () => {
    try {
      const relatedResponse = await casesApi.getRelated(id)
      setChildCases(relatedResponse.data.childCases || [])
    } catch (error) {
      console.error('Error refetching child cases:', error)
    }
  }

  const runEmployeeAction = async (actionKey, fn, successMessage) => {
    setEmployeeActionBusy(actionKey)
    setEmployeeActionMessage('')
    try {
      const response = await fn()
      setEmployeeActionMessage(response?.data?.message || successMessage)
      await refetchChildCases()
    } catch (error) {
      setEmployeeActionMessage(error.response?.data?.message || 'The action could not be completed')
    } finally {
      setEmployeeActionBusy('')
    }
  }

  const handleAddEmployee = () => runEmployeeAction('add', () => casesApi.addEmployeeSlot(id), 'Employee slot added')
  const handleResendInvite = (childCaseId) => runEmployeeAction(`resend:${childCaseId}`, () => casesApi.resendEmployeeInvite(id, childCaseId), 'Invitation re-sent')
  const handleRestoreEmployee = (childCaseId) => runEmployeeAction(`restore:${childCaseId}`, () => casesApi.restoreEmployee(childCaseId), 'Employee restored')
  const handleRemoveEmployee = (childCaseId) => {
    if (!window.confirm('Remove this employee from the matter? Their data is kept and this can be undone.')) return
    runEmployeeAction(`remove:${childCaseId}`, () => casesApi.removeEmployee(childCaseId), 'Employee removed')
  }

  const handleCreateInformationRequest = async () => {
    if (!infoRequestForm.title.trim()) {
      setInfoRequestMessage('Add a request title before sending.')
      return
    }
    try {
      setSendingInfoRequest(true)
      setInfoRequestMessage('')
      const response = await employmentWorkflowApi.createRequest(id, infoRequestForm)
      setCaseData(response.data.case || caseData)
      setInfoRequestForm({
        target: 'employee',
        requestType: 'profile',
        title: '',
        description: '',
      })
      setInfoRequestMessage('Information request sent and task created.')
    } catch (error) {
      setInfoRequestMessage(error.response?.data?.message || 'Unable to send information request.')
    } finally {
      setSendingInfoRequest(false)
    }
  }

  const fetchDocuments = useCallback(async (force = false) => {
    if (fetched.documents && !force) return
    try {
      setTabLoading(prev => ({ ...prev, documents: true }))
      const response = await api.get('/documents', { params: { caseId: id } })
      // This table is for what a client uploaded or a case manager manually
      // added — not petition-generated artifacts (cover letters, itineraries,
      // position-description letters, PetitionWordPackageService exports).
      // Those are auto-created system-side (Document.uploadedBy: "system" -
      // the schema's own marker; every real upload, including a case
      // manager's own manual add via CaseDocumentUploadPanel, is labeled
      // with the actual uploader's role instead) and belong on the Petition
      // tab, not here.
      setDocuments((response.data.documents || []).filter((doc) => doc.uploadedBy !== 'system'))
      setFetched(prev => ({ ...prev, documents: true }))
    } catch (error) {
      console.error('Error fetching documents:', error)
    } finally {
      setTabLoading(prev => ({ ...prev, documents: false }))
    }
  }, [id, fetched.documents])

  const parentCaseId = caseData?.parentCase?._id || caseData?.parentCase
  useEffect(() => {
    if (!documentsActive || !parentCaseId) { setParentChecklistItems([]); return }
    let cancelled = false
    casesApi.get(parentCaseId).then((response) => {
      if (cancelled) return
      const parentCase = response.data?.case || response.data
      const items = Array.isArray(parentCase?.checklistItems) ? parentCase.checklistItems
        : Array.isArray(parentCase?.documentChecklist) ? parentCase.documentChecklist
        : []
      setParentChecklistItems(items.map((item) => ({ ...item, sharedFromEmployer: true })))
    }).catch((error) => {
      console.error('Error fetching shared employer checklist:', error)
      if (!cancelled) setParentChecklistItems([])
    })
    return () => { cancelled = true }
  }, [documentsActive, parentCaseId])

  const fetchPayments = useCallback(async (force = false) => {
    if (fetched.payments && !force) return
    try {
      setTabLoading(prev => ({ ...prev, payments: true }))
      const response = await api.get('/payments', { params: { caseId: id } })
      setPayments(response.data.payments || [])
      setFetched(prev => ({ ...prev, payments: true }))
    } catch (error) {
      console.error('Error fetching payments:', error)
    } finally {
      setTabLoading(prev => ({ ...prev, payments: false }))
    }
  }, [id, fetched.payments])

  useEffect(() => {
    if (activeTab !== 'payments') return undefined
    fetchPayments(true)
    // Live-refresh on the backend's existing payment:updated socket event
    // instead of relying solely on polling; the interval below is now only
    // a safety net.
    const unsubscribe = subscribe('payment:updated', () => fetchPayments(true))
    const interval = window.setInterval(() => fetchPayments(true), 120000)
    const refreshOnFocus = () => fetchPayments(true)
    window.addEventListener('focus', refreshOnFocus)
    return () => {
      unsubscribe()
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshOnFocus)
    }
  }, [activeTab, fetchPayments, subscribe, connected])

  const fetchCaseForms = useCallback(async (force = false) => {
    if (fetched.forms && !force) return
    try {
      setTabLoading(prev => ({ ...prev, forms: true }))
      const response = await uscisFormsApi.caseForms(id)
      setCaseForms(response.data.forms || [])
      setFormsError('')
      setFetched(prev => ({ ...prev, forms: true }))
    } catch (error) {
      console.error('Error fetching case forms:', error)
      // FIX: this used to setCaseForms([]) on ANY failure - a genuine 500/
      // database-unavailable response then looked pixel-identical to "this
      // case really has zero USCIS forms" (renderEmptyState below), which is
      // actively misleading during a real outage. Track the failure
      // separately and leave caseForms as whatever was last successfully
      // loaded (if anything) instead of wiping it out from under the user.
      const data = error.response?.data || {}
      setFormsError(data.message || error.message || 'Unable to load USCIS forms.')
      setFetched(prev => ({ ...prev, forms: false }))
    } finally {
      setTabLoading(prev => ({ ...prev, forms: false }))
    }
  }, [id, fetched.forms])

  const generateCaseForms = async () => {
    try {
      setTabLoading(prev => ({ ...prev, forms: true }))
      setFormActionMessage('')
      setFormsWarning('')
      const response = await casesApi.generateForms(id)
      setFetched(prev => ({ ...prev, forms: false }))
      await fetchCaseForms(true)
      const payload = response?.data || {}
      // blockingIssues carries both real failures (severity 'error', or no
      // severity at all — the shape older callers already produced) and
      // non-blocking advisories (severity 'info'/'warning', e.g. no case
      // manager assigned yet, or fields still incomplete on a new case).
      // Only the former belongs in the same banner as an actual failure;
      // the latter goes to formsWarning so it renders as an amber advisory
      // instead of looking like the request failed.
      const errorBlockers = (payload.blockingIssues || []).filter(item => !item.severity || item.severity === 'error')
      const infoBlockers = (payload.blockingIssues || []).filter(item => item.severity === 'info' || item.severity === 'warning')
      const failures = payload.failed?.length ? ` ${payload.failed.map(item => `${item.formCode}: ${item.message}`).join(' ')}` : ''
      const errorMessages = errorBlockers.length ? ` ${errorBlockers.map(item => item.message).join(' ')}` : ''
      setFormActionMessage(`${payload.message || 'USCIS forms were assigned and auto-filled from the canonical profile.'}${failures}${errorMessages}`)
      if (infoBlockers.length) setFormsWarning(infoBlockers.map(item => item.message).join(' '))
      await fetchFormsOverview(true)
    } catch (error) {
      const data = error.response?.data || {}
      if (data.code === 'CANONICAL_NEEDS_REVIEW') {
        // data.details.validation.conflicts carries the actual competing
        // values per field (CanonicalValidationService.validate) — naming
        // them beats the generic "conflicts must be resolved" message, since
        // the CM otherwise has to go find the conflict UI just to see what's
        // even disagreeing.
        const conflicts = data.details?.validation?.conflicts || []
        const conflictDetail = conflicts.length
          ? ` ${conflicts.map(item => {
              const values = [...new Set((item.candidates || []).map(candidate => candidate.value))]
              return `${item.path}: ${values.map(value => `"${value}"`).join(' vs ')}`
            }).join('; ')}`
          : ''
        setFormActionMessage(`${data.message || 'Canonical profile conflicts must be resolved before generating forms.'}${conflictDetail}`)
        return
      }
      if (data.code === 'USCIS_FORMS_UNRESOLVED') {
        // details.forms is visaFormMapping.service.js's own templateDiagnostics()
        // output — a per-form reason (TEMPLATE_MISSING/TEMPLATE_RULE_CONFLICT/...)
        // for why a mapped form never became a CaseForm.
        const { resolvedVisaType, usedParentFallback, unresolved, forms } = data.details || {}
        const formDetail = forms?.length
          ? ` Forms affected: ${forms.map(item => `${item.formNumber} (${item.reason})`).join(', ')}.`
          : ''
        const resolutionDetail = unresolved
          ? ' This visa type has no configured USCIS forms — check that the case’s visa type is set correctly.'
          : usedParentFallback
            ? ` Resolved via ${resolvedVisaType}'s form set, but none of those forms have an active template yet.`
            : ''
        setFormActionMessage(`${data.message || 'No active USCIS form templates are configured for this visa type.'}${resolutionDetail}${formDetail}`)
        return
      }
      const issues = data.issues?.length ? ` ${data.issues.map(item => item.message).join(' ')}` : ''
      // data.details is an internal readiness metrics object — never user-facing
      setFormActionMessage(`${data.message || error.message || 'Unable to generate USCIS forms'}${issues}`)
    } finally {
      setTabLoading(prev => ({ ...prev, forms: false }))
    }
  }

  // Phase 1: the full registry-resolved form set (provisioned or not) -
  // read-only, never mutates anything itself.
  const fetchFormsOverview = useCallback(async (force = false) => {
    try {
      const response = await uscisFormsApi.formsOverview(id)
      setFormsOverview(response.data.data || { items: [], diagnostics: [] })
      setFormsOverviewError('')
    } catch (error) {
      const data = error.response?.data || {}
      setFormsOverviewError(data.message || error.message || 'Unable to load the full USCIS forms overview.')
    }
  }, [id])

  // As soon as the client submits (or updates) their profile information
  // against this case, refresh the client info section immediately so the
  // Case Manager sees it without a manual page refresh.
  //
  // This is also the one moment (today) a questionnaire/checklist answer
  // save actually happens against this case - see questionnaire.service.js's
  // saveAnswers, which is what writes masterData, flips
  // questionnaireReferences status, and calls markCaseFormsStale/
  // canonicalSyncService.syncCase. None of that pushes its own socket event,
  // so without forcing a refetch here a Case Manager already sitting on this
  // page would keep seeing pre-submission Documents/Forms/checklist-progress
  // data - the Documents tab wouldn't show newly-uploaded file-type answers,
  // and the Forms tab wouldn't reflect the new syncState.stale/completion
  // numbers - until they left the tab and came back (which re-fetches from
  // scratch) or clicked the tab's own manual Refresh button. Also
  // invalidates questionnairesApi.getForCase/listCaseChecklists' 5s
  // cachedGet TTL so the re-fetch below can't itself serve back the same
  // stale response.
  useEffect(() => {
    if (!connected) return
    return subscribe('case:client_submitted', (payload) => {
      if (String(payload?._id) !== String(id)) return
      setLiveUpdateBanner(
        payload.isFirstSubmission
          ? 'The client just submitted their profile information.'
          : 'The client just updated their profile information.'
      )
      invalidateCachedGet(`/questionnaires/case/${id}`)
      fetchCaseDetail()
      fetchChecklistsProgress(id)
      fetchDocuments(true)
      fetchCaseForms(true)
      fetchFormsOverview(true)
      setTimeout(() => setLiveUpdateBanner(''), 8000)
    })
  }, [connected, id, fetchChecklistsProgress, fetchDocuments, fetchCaseForms, fetchFormsOverview])

  // Phase 2: on-demand live fetch from uscis.gov for a mapped form whose
  // template doesn't exist yet.
  const handleAcquireForm = async (item) => {
    try {
      setRowActionPending(item.mappingId)
      setFormActionMessage('')
      const response = await uscisFormsApi.acquireForm(id, item.formNumber)
      const payload = response?.data?.data || {}
      if (payload.requiresActivation) {
        const reason = payload.activationBlockedReason ? ` (${payload.activationBlockedReason})` : ''
        setFormActionMessage(`${item.formNumber} was imported from uscis.gov and is awaiting admin review before it can be filed${reason}.`)
      } else {
        setFormActionMessage(`${item.formNumber} was fetched from uscis.gov, added to this case, and auto-filled.`)
      }
      setFetched(prev => ({ ...prev, forms: false }))
      await Promise.all([fetchCaseForms(true), fetchFormsOverview(true)])
    } catch (error) {
      const data = error.response?.data || {}
      setFormActionMessage(data.message || error.message || `Could not fetch ${item.formNumber} from USCIS.`)
    } finally {
      setRowActionPending('')
    }
  }

  // Phase 3: curated + biographic-fallback autofill for one already-
  // provisioned form (distinct from generateCaseForms' bulk pass, which
  // does not run the biographic fallback).
  const handleAutofillForm = async (item) => {
    if (!item.caseForm?.id) return
    try {
      setRowActionPending(item.mappingId)
      setFormActionMessage('')
      // BUG (fixed): same class of issue as USCISFormRenderer's caseId prop
      // below - hardcoded to this page's own URL id, which only matches
      // when the form actually belongs to THIS case. For a
      // caseRole=principal case, listCaseForms aggregates every child
      // (employee) case's own CaseForms into one list, so Autofill on an
      // employee-owned form 404'd against AutoFillService's own
      // caseId-scoped CaseForm lookup. item.caseId (now passed from the
      // row's own form.caseId) is the fix.
      await uscisFormsApi.autofill(item.caseId || id, item.caseForm.id)
      setFormActionMessage(`${item.formNumber} was re-autofilled from the canonical profile.`)
      setFetched(prev => ({ ...prev, forms: false }))
      await Promise.all([fetchCaseForms(true), fetchFormsOverview(true)])
    } catch (error) {
      const data = error.response?.data || {}
      setFormActionMessage(data.message || error.message || `Could not autofill ${item.formNumber}.`)
    } finally {
      setRowActionPending('')
    }
  }

  // "Add" for an AVAILABLE_TO_PROVISION row - single-form, conflict-
  // independent provisioning (visaFormMappingService.provisionAvailableMapping),
  // distinct from generateCaseForms' bulk endpoint, which is correctly
  // blocked by any unresolved canonical-profile conflict on the case even
  // when it has nothing to do with this specific form. Autofills the newly
  // created form immediately after, via the same already-conflict-independent
  // per-form Autofill call handleAutofillForm uses, so this still behaves
  // like "Add & Autofill" from the case manager's point of view.
  const handleProvisionMapping = async (item) => {
    try {
      setRowActionPending(item.mappingId)
      setFormActionMessage('')
      const response = await uscisFormsApi.provisionMapping(id, item.mappingId)
      const created = response?.data?.data?.created || []
      setFetched(prev => ({ ...prev, forms: false }))
      await Promise.all([fetchCaseForms(true), fetchFormsOverview(true)])
      const newCaseFormId = created[0]?._id
      if (newCaseFormId) {
        await uscisFormsApi.autofill(id, newCaseFormId).catch(() => null)
        await Promise.all([fetchCaseForms(true), fetchFormsOverview(true)])
      }
      setFormActionMessage(`${item.formNumber} was added to this case and auto-filled.`)
    } catch (error) {
      const data = error.response?.data || {}
      setFormActionMessage(data.message || error.message || `Could not add ${item.formNumber}.`)
    } finally {
      setRowActionPending('')
    }
  }

  // "Add"/"Not applicable" for a CONDITIONAL_PENDING row - the existing
  // recordConditionalDecision endpoint.
  const handleDecideMapping = async (item, decision) => {
    try {
      setRowActionPending(item.mappingId)
      setFormActionMessage('')
      await uscisFormsApi.decideMapping(id, item.mappingId, decision)
      setFetched(prev => ({ ...prev, forms: false }))
      await Promise.all([fetchCaseForms(true), fetchFormsOverview(true)])
    } catch (error) {
      const data = error.response?.data || {}
      setFormActionMessage(data.message || error.message || `Could not update ${item.formNumber}.`)
    } finally {
      setRowActionPending('')
    }
  }

  // Biographic Activation tier: notifies admins a template needs a full
  // curated mapping review - no state change, so no overview refresh needed.
  const handleRequestMappingReview = async (item) => {
    if (!item.caseForm?.id) return
    try {
      setRowActionPending(item.mappingId)
      setFormActionMessage('')
      const linkedForm = caseForms.find(f => f._id === item.caseForm.id)
      const templateId = linkedForm?.formTemplateId?._id || linkedForm?.formTemplateId
      if (!templateId) throw new Error('Could not resolve this form\'s template.')
      await uscisFormsApi.requestMappingReview(templateId)
      setFormActionMessage(`Requested a full mapping review for ${item.formNumber}.`)
    } catch (error) {
      const data = error.response?.data || {}
      setFormActionMessage(data.message || error.message || `Could not request a mapping review for ${item.formNumber}.`)
    } finally {
      setRowActionPending('')
    }
  }

  const generateFilingPackage = async () => {
    try {
      setTabLoading(prev => ({ ...prev, forms: true }))
      setFormActionMessage('')
      await casesApi.generatePackage(id)
      setFormActionMessage('Filing package generated from approved USCIS forms and reviewed evidence.')
      await fetchCaseDetail()
      await fetchCaseForms(true)
    } catch (error) {
      setFormActionMessage(error.response?.data?.message || 'Unable to generate the filing package')
    } finally {
      setTabLoading(prev => ({ ...prev, forms: false }))
    }
  }

  const fetchLetters = useCallback(async () => {
    setLetters([])
    setFetched(prev => ({ ...prev, letters: true }))
  }, [])

  const fetchEligibility = useCallback(async (force = false) => {
    if (fetched.strategy && !force) return
    try {
      setTabLoading(prev => ({ ...prev, strategy: true }))
      const response = await eligibilityApi.results(id)
      setEligibility(response.data.data)
      setFetched(prev => ({ ...prev, strategy: true }))
    } catch (error) {
      console.error('Error fetching eligibility results:', error)
    } finally {
      setTabLoading(prev => ({ ...prev, strategy: false }))
    }
  }, [id, fetched.strategy])

  const handleEvaluateEligibility = async () => {
    try {
      setTabLoading(prev => ({ ...prev, strategy: true }))
      const response = await eligibilityApi.evaluate(id)
      setEligibility(response.data.data)
      setFetched(prev => ({ ...prev, strategy: true }))
      fetchCaseDetail()
    } catch (error) {
      console.error('Error evaluating eligibility:', error)
    } finally {
      setTabLoading(prev => ({ ...prev, strategy: false }))
    }
  }

  const fetchTracking = useCallback(async (force = false) => {
    if (fetched.tracking && !force) return
    try {
      setTabLoading(prev => ({ ...prev, tracking: true }))
      const response = await lifecycleApi.tracking(id)
      const value = response.data.tracking || emptyTracking
      setTracking({
        ...emptyTracking,
        ...value,
        filing: {
          ...emptyTracking.filing,
          ...(value.filing || {}),
          filingDate: dateInput(value.filing?.filingDate),
          deliveryConfirmationDate: dateInput(value.filing?.deliveryConfirmationDate),
        },
        rfe: {
          ...emptyTracking.rfe,
          ...(value.rfe || {}),
          issueDate: dateInput(value.rfe?.issueDate),
          responseDueDate: dateInput(value.rfe?.responseDueDate),
          responseSubmittedDate: dateInput(value.rfe?.responseSubmittedDate),
          responsibleCaseManager: value.rfe?.responsibleCaseManager?._id || value.rfe?.responsibleCaseManager || '',
          assignedTo: value.rfe?.assignedTo?._id || value.rfe?.assignedTo || '',
        },
      })
      setTrackingDocuments(response.data.governmentDocuments || [])
      setTrackingTimeline(response.data.timeline || [])
      setFetched(prev => ({ ...prev, tracking: true }))
    } catch (error) {
      setTrackingMessage(error.response?.data?.message || 'Unable to load USCIS tracking')
    } finally {
      setTabLoading(prev => ({ ...prev, tracking: false }))
    }
  }, [id, fetched.tracking])

  const updateTracking = (section, field, value) => {
    setTracking(current => section
      ? { ...current, [section]: { ...current[section], [field]: value } }
      : { ...current, [field]: value })
  }

  const saveTracking = async () => {
    try {
      setSavingTracking(true)
      setTrackingMessage('')
      await lifecycleApi.saveTracking(id, tracking)
      setTrackingMessage('USCIS tracking changes saved successfully.')
      setFetched(prev => ({ ...prev, tracking: false }))
      await Promise.all([fetchCaseDetail(), fetchTracking(true)])
    } catch (error) {
      setTrackingMessage(error.response?.data?.message || 'Unable to save USCIS tracking changes')
    } finally {
      setSavingTracking(false)
    }
  }

  useEffect(() => {
    if (!id) return
    if (activeTab === 'documents' && !fetched.documents) fetchDocuments()
    if (activeTab === 'forms' && !fetched.forms) { fetchCaseForms(); fetchFormsOverview() }
    if (activeTab === 'tracking' && !fetched.tracking) { fetchTracking(); ensureUsers() }
  }, [activeTab, id, fetched.documents, fetched.forms, fetched.strategy, fetched.letters, fetched.tracking, fetchDocuments, fetchCaseForms, fetchFormsOverview, fetchEligibility, fetchLetters, fetchTracking, ensureUsers])

  const handleTabChange = (tab) => {
    setActiveTab(tab)
  }

  const handleAssign = async (e) => {
    e.preventDefault()
    setAssignError('')
    setAssigning(true)
    try {
      let response
      if (assignType === 'case_manager') {
        response = await casesApi.assignCaseManager(id, assigneeId, 'Assigned from CRM case detail', {
          priority: assignPriority || undefined,
          internalNote: assignInternalNote || undefined,
        })
      } else if (assignType === 'team_lead') {
        response = await casesApi.assignTeamLead(id, assigneeId, 'Assigned from CRM case detail')
      } else if (assignType === 'attorney') {
        response = await casesApi.grantAttorneyAccess(id, assigneeId)
      }
      const cascaded = response?.data?.childrenCascaded || 0
      setShowAssignModal(false)
      setAssigneeId('')
      setAssignPriority('')
      setAssignInternalNote('')
      fetchCaseDetail()
      if (cascaded > 0) {
        setInfoModal({ message: `Assignment also applied to ${cascaded} child case${cascaded === 1 ? '' : 's'}.` })
      }
    } catch (error) {
      console.error('Error assigning staff:', error)
      setAssignError(error.response?.data?.message || error.message || 'Failed to assign staff. Please try again.')
    } finally {
      setAssigning(false)
    }
  }

  const handleStageUpdate = async () => {
    try {
      await api.put(`/cases/${id}/stage`, { stage: newStage })
      setShowStageUpdateModal(false)
      setNewStage('')
      fetchCaseDetail()
    } catch (error) {
      console.error('Error updating stage:', error)
    }
  }

  const handleDocumentReview = async (docId, reviewStatus, reviewNotes) => {
    try {
      await api.put(`/documents/${docId}/review`, { reviewStatus, reviewNotes })
      fetchDocuments(true)
    } catch (error) {
      console.error('Error reviewing document:', error)
    }
  }

  const handleRecordPayment = async (event) => {
    event?.preventDefault()
    const amount = Number(paymentAmount)
    const currentPayment = payments.find(payment => payment._id === selectedPaymentId)
    if (!currentPayment) {
      setPaymentError('The selected payment record is no longer available. Refresh and try again.')
      return
    }
    const remainingDollars = Number(currentPayment?.remainingAmount || 0) / 100
    if (!Number.isFinite(amount) || amount <= 0) {
      setPaymentError('Enter a payment amount greater than zero.')
      return
    }
    if (amount > remainingDollars) {
      setPaymentError(`Payment cannot exceed the remaining balance of ${formatPaymentAmount(currentPayment.remainingAmount, currentPayment.currency)}.`)
      return
    }
    if (!paymentMethod) {
      setPaymentError('Select a payment method.')
      return
    }
    try {
      setRecordingPayment(true)
      setPaymentError('')
      await api.post(`/payments/${currentPayment?._id}/payment`, {
        amount,
        amountUnit: 'dollars',
        paymentMethod,
        notes: paymentNotes,
        transactionId: manualPaymentRequestId
      })
      setShowRecordPaymentModal(false)
      setPaymentAmount('')
      setPaymentMethod('')
      setPaymentNotes('')
      setManualPaymentRequestId('')
      setSelectedPaymentId('')
      await Promise.all([fetchPayments(true), fetchCaseDetail()])
    } catch (error) {
      setPaymentError(error.response?.data?.message || 'Unable to record payment')
    } finally {
      setRecordingPayment(false)
    }
  }

  const handleCreateLetter = async () => {
    setShowCreateLetterModal(false)
    setLetterType('')
  }


  const getStageColor = (stage) => {
    const colors = {
      intake: 'bg-secondary text-foreground',
      strategy: 'bg-blue-100 text-blue-800',
      evidence: 'bg-purple-100 text-purple-800',
      letters: 'bg-pink-100 text-pink-800',
      form_preparation: 'bg-amber-100 text-amber-800',
      filing: 'bg-green-100 text-green-800',
      uscis_pending: 'bg-cyan-100 text-cyan-800',
      approved: 'bg-blue-100 text-blue-800',
      denied: 'bg-red-100 text-red-800'
    }
    return colors[stage] || 'bg-secondary text-foreground'
  }

  const getStatusColor = (status) => {
    const colors = {
      active: 'bg-green-100 text-green-800',
      archived: 'bg-secondary text-foreground',
      closed: 'bg-blue-100 text-blue-800'
    }
    return colors[status] || 'bg-secondary text-foreground'
  }

  const getPriorityColor = (priority) => {
    const colors = {
      low: 'bg-secondary text-foreground',
      medium: 'bg-blue-100 text-blue-800',
      high: 'bg-amber-100 text-amber-800',
      urgent: 'bg-red-100 text-red-800'
    }
    return colors[priority] || 'bg-secondary text-foreground'
  }

  const getDocumentReviewColor = (status) => {
    const colors = {
      pending: 'bg-secondary text-foreground',
      approved: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
      needs_revision: 'bg-amber-100 text-amber-800'
    }
    return colors[status] || 'bg-secondary text-foreground'
  }

  const getFormStatusColor = (status) => {
    const colors = {
      pending: 'badge-info',
      draft: 'badge-warning',
      ai_filled: 'badge-info',
      in_review: 'badge-warning',
      under_review: 'badge-warning',
      form_preparation: 'badge-warning',
      needs_revision: 'badge-warning',
      approved: 'badge-success',
      ready_for_pdf: 'badge-success',
      rejected: 'badge-danger',
      generated: 'badge-success',
      locked: 'badge-info'
    }
    return colors[status] || 'badge-info'
  }

  // Phase 1: status chip for a forms-overview row (see form-registry.
  // controller.js's deriveUiStatus for the server-side derivation this mirrors).
  const UI_STATUS_LABEL = {
    AUTOFILLED: 'Autofilled',
    PROVISIONED: 'Added',
    AVAILABLE_TO_PROVISION: 'Ready to add',
    ACQUIRE_FROM_USCIS: 'Not on file yet',
    CONDITIONAL_PENDING: 'Needs a decision',
    LATER_STAGE: 'Later stage',
    REFERENCE: 'Reference only',
    RULE_CONFLICT: 'Configuration issue',
    // Not a USCIS form (DOS/DOL, e.g. DS-160/ETA-9035) - never fetchable via
    // "Fetch from USCIS", which only ever pulls from uscis.gov.
    NOT_FETCHABLE_HERE: 'Not a USCIS form',
    // Biographic Activation tier: a real, provisioned CaseForm exists and
    // biographic-core fields (name/DOB/address/...) are autofillable, but
    // the template hasn't passed a full curated mapping review yet - never
    // shown as plain "Autofilled" (that implies full production activation).
    BIOGRAPHIC_READY: 'Biographic autofill ready'
  }
  const getUiStatusColor = (uiStatus) => {
    const colors = {
      AUTOFILLED: 'badge-info',
      PROVISIONED: 'bg-secondary text-foreground',
      AVAILABLE_TO_PROVISION: 'badge-success',
      ACQUIRE_FROM_USCIS: 'badge-warning',
      CONDITIONAL_PENDING: 'badge-warning',
      LATER_STAGE: 'bg-secondary text-foreground',
      REFERENCE: 'bg-secondary text-foreground',
      RULE_CONFLICT: 'badge-danger',
      NOT_FETCHABLE_HERE: 'bg-secondary text-foreground',
      BIOGRAPHIC_READY: 'badge-warning'
    }
    return colors[uiStatus] || 'bg-secondary text-foreground'
  }

  const getLetterStatusColor = (status) => {
    const colors = {
      assigned: 'bg-secondary text-foreground',
      draft_generated: 'bg-blue-100 text-blue-800',
      revision_needed: 'bg-red-100 text-red-800',
      signed: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800'
    }
    return colors[status] || 'bg-secondary text-foreground'
  }

  const getFilingReadinessColor = (score) => {
    if (score < 40) return 'bg-red-500'
    if (score < 70) return 'bg-amber-500'
    return 'bg-blue-500'
  }

  const getFilteredUsers = () => {
    if (assignType === 'case_manager') {
      const caseManagers = users.filter(u => u.role === 'case_manager')
      if (user?.role === 'team_lead' && !caseManagers.some(u => u._id === user._id)) {
        return [{ ...user, name: `${user.name || user.displayName || 'Me'} (assign to myself)` }, ...caseManagers]
      }
      return caseManagers
    }
    if (assignType === 'team_lead') {
      return users.filter(u => u.role === 'team_lead')
    }
    if (assignType === 'attorney') {
      return attorneyUsers
    }
    return users
  }

  const isAwaitingAssignment = () => (
    caseData?.status === 'pending_assignment' || !caseData?.assignedCaseManager
  )

  const getChecklistItems = () => {
    const ownItems = Array.isArray(caseData?.checklistItems) ? caseData.checklistItems :
      Array.isArray(caseData?.documentChecklist) ? caseData.documentChecklist :
      []
    // The employer's own required items are shared with every employee/
    // child case (see Backend's sharedCaseRoles.js) — merge them in here so
    // this employee's Documents tab shows the whole picture, not just their
    // own half of it. Never applies the other direction: the principal case
    // never shows any one employee's own items.
    return parentChecklistItems.length ? [...ownItems, ...parentChecklistItems] : ownItems
  }

  // BUG (fixed): this only ever read item.status/item.uploadedFiles directly
  // off the Case.checklistItems subdocument — a field nothing updates when a
  // real Document actually gets uploaded (confirmed live: a case with 4 real,
  // uploaded documents whose documentType exactly matched 4 required items
  // still showed all of them "Pending", because checklistItems[].status was
  // never synced). Rather than add yet another place that has to remember to
  // write that field, check the ACTUAL documents array (already fetched for
  // the "Uploaded Documents" table below) live, by documentType — this can
  // never go stale since it's the same real data the Documents table itself
  // shows, for any case, automatically.
  const getChecklistStatus = (item) => {
    if (item?.documentType && documents.some((doc) => doc.documentType === item.documentType && !doc.deletedAt)) return 'uploaded'
    return item?.status || item?.uploadStatus || (item?.uploadedFiles?.length || item?.files?.length ? 'uploaded' : 'pending')
  }

  // Server-computed completeness (calculateDetailedProgress) is authoritative
  // when this case's visa type has a canonical DB questionnaire (H-1B/L-1A
  // today); falls back to raw checklistItems status for other visa types,
  // whose checklist content isn't DB-backed yet (see Phase 2 notes).
  const hasServerDocumentsProgress = documentsProgress.totalRequired > 0

  const getUploadedChecklistCount = () => (
    hasServerDocumentsProgress
      ? documentsProgress.answeredRequired
      : getChecklistItems().filter((item) => ['uploaded', 'submitted', 'approved', 'received', 'complete', 'completed'].includes(getChecklistStatus(item))).length
  )

  const getPendingChecklistItems = () => (
    hasServerDocumentsProgress
      ? documentsProgress.missingRequired.map((item) => ({ name: item.label, documentType: item.key, required: true }))
      : getChecklistItems().filter((item) => !['uploaded', 'submitted', 'approved', 'received', 'complete', 'completed'].includes(getChecklistStatus(item)))
  )

  const getPackageLabel = () => (
    caseData?.packageName ||
    caseData?.plan?.packageName ||
    caseData?.plan?.tier ||
    caseData?.package ||
    'Not selected'
  )

  const formatCurrency = (value) => {
    const amount = Number(value || 0)
    if (!amount) return 'Not set'
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
  }

  const renderInformationRequestsPanel = () => {
    const requests = caseData?.informationRequests || []
    return (
      <div className="card">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Request Missing Information</h3>
            <p className="text-sm text-muted-foreground">Send employee or employer tasks from this case review.</p>
          </div>
          <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-muted-foreground">
            {requests.filter((request) => request.status !== 'completed').length} open
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <select
            value={infoRequestForm.target}
            onChange={(event) => setInfoRequestForm((current) => ({ ...current, target: event.target.value }))}
            className="input-field"
          >
            <option value="employee">Employee</option>
            <option value="employer">Employer</option>
          </select>
          <select
            value={infoRequestForm.requestType}
            onChange={(event) => setInfoRequestForm((current) => ({ ...current, requestType: event.target.value }))}
            className="input-field"
          >
            <option value="profile">Profile information</option>
            <option value="questionnaire">Questionnaire</option>
            <option value="document">Document</option>
            <option value="approval">Approval</option>
          </select>
          <input
            value={infoRequestForm.title}
            onChange={(event) => setInfoRequestForm((current) => ({ ...current, title: event.target.value }))}
            className="input-field md:col-span-2"
            placeholder="Example: Upload clearer passport"
          />
          <textarea
            value={infoRequestForm.description}
            onChange={(event) => setInfoRequestForm((current) => ({ ...current, description: event.target.value }))}
            className="input-field md:col-span-3 min-h-[88px]"
            placeholder="Add details for the employee or employer..."
          />
          <button
            type="button"
            onClick={handleCreateInformationRequest}
            disabled={sendingInfoRequest}
            className="btn-primary self-start md:self-stretch"
          >
            {sendingInfoRequest ? 'Sending...' : 'Send Request'}
          </button>
        </div>
        {infoRequestMessage && (
          <p className="mt-3 text-sm font-medium text-muted-foreground">{infoRequestMessage}</p>
        )}

        {requests.length > 0 && (
          <div className="mt-5 space-y-2">
            {requests.slice().reverse().slice(0, 5).map((request, index) => (
              <div key={request._id || index} className="rounded-lg border border-border bg-muted px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{request.title}</p>
                  <span className="rounded-full bg-card px-2 py-1 text-[11px] font-bold uppercase text-muted-foreground">
                    {request.target} · {String(request.status || 'open').replace(/_/g, ' ')}
                  </span>
                </div>
                {request.description && <p className="mt-1 text-sm text-muted-foreground">{request.description}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const getClientProfileEntries = () => {
    const profile = intakeBundle?.client || caseData?.clientProfile || {}
    const beneficiary = caseData?.beneficiary || {}
    return [
      ['Full Name', profile.fullName || profile.name || beneficiary.fullName || caseData?.clientName],
      ['Email', profile.email || beneficiary.email || caseData?.clientEmail],
      ['Phone', profile.primaryPhone || profile.phone || profile.phoneNumber || beneficiary.phone],
      ['Date of Birth', profile.dateOfBirth || beneficiary.dateOfBirth],
      ['Nationality', profile.nationality || beneficiary.nationality],
      ['Passport Number', profile.passportNumber || beneficiary.passportNumber],
      ['Current Visa Status', profile.currentVisaStatus],
      ['Emergency Contact', profile.emergencyName && `${profile.emergencyName} (${profile.emergencyPhone || 'no phone'})`],
    ].filter(([, value]) => value)
  }

  const renderSkeleton = () => (
    <div className="space-y-4">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
      ))}
    </div>
  )

  const renderEmptyState = (message) => (
    <div className="text-center py-8 text-muted-foreground">
      <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
      <p>{message}</p>
    </div>
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading case details...</div>
      </div>
    )
  }

  if (!caseData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Case not found</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {viewingDocument && (
        <CaseDocumentViewer document={viewingDocument} onClose={() => setViewingDocument(null)} />
      )}
      {editingDocument && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h3 className="text-lg font-semibold text-foreground truncate">
                Edit — {getDocumentName(editingDocument)}
              </h3>
              <button type="button" onClick={() => setEditingDocument(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {editingError && (
                <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{editingError}</div>
              )}
              {editingLoading ? (
                renderSkeleton()
              ) : (
                <textarea
                  value={editingContent}
                  onChange={(event) => setEditingContent(event.target.value)}
                  className="input-field h-96 w-full font-mono text-sm"
                  spellCheck={false}
                />
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
              <button type="button" onClick={() => setEditingDocument(null)} className="btn-secondary text-sm" disabled={editingSaving}>
                Cancel
              </button>
              <button type="button" onClick={saveDocumentEditor} className="btn-primary text-sm disabled:opacity-50" disabled={editingSaving || editingLoading}>
                {editingSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
      {liveUpdateBanner && (
        <div className="flex items-center gap-2 rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-sm font-medium text-blue-800">
          <Bell className="w-4 h-4 shrink-0" />
          {liveUpdateBanner}
        </div>
      )}
      {/* Header */}
      <div>
        <button
          onClick={() => navigate('/crm-cases')}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Cases
        </button>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-foreground break-words">{caseData.caseNumber}</h1>
            <p className="text-muted-foreground mt-1">{caseData.clientName}</p>
            {/* P12-S3: Case ID + copy button — the admin's fastest path to
                share the client's Immiglance portal login ID, no DB lookup needed. */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500">
                  Client Case ID
                </span>
                <span className="font-mono text-sm font-bold text-indigo-900">
                  {caseData.caseNumber}
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(caseData.caseNumber)
                    setCaseIdCopied(true)
                    setTimeout(() => setCaseIdCopied(false), 2500)
                  }}
                  title="Copy Case ID — share with client for Immiglance portal login"
                  className={`flex items-center rounded p-0.5 transition-colors ${caseIdCopied ? 'text-emerald-600' : 'text-indigo-400 hover:text-indigo-700'}`}
                >
                  {caseIdCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
                {caseIdCopied && <span className="text-[11px] font-semibold text-emerald-600">Copied!</span>}
              </div>
              <span className="text-xs text-muted-foreground">Share with client for Immiglance portal login</span>
            </div>
          </div>
          <button
            onClick={() => {
              if (isAwaitingAssignment()) {
                setAssignError('')
                setShowAssignModal(true)
              } else {
                setShowStaffDetailsModal(true)
              }
            }}
            className="btn-primary flex items-center justify-center gap-2 w-full sm:w-auto shrink-0"
          >
            <User className="w-4 h-4" />
            {isAwaitingAssignment() ? 'Assign Staff' : 'Edit Staff'}
          </button>
        </div>
      </div>

      {isAwaitingAssignment() && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-lg border border-amber-200 border-l-4 border-l-amber-500 bg-amber-50/70 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <Bell className="h-4 w-4 shrink-0 text-amber-600" />
            <p className="min-w-0 text-sm text-amber-950">
              <span className="font-semibold">Awaiting staff assignment</span>
              <span className="hidden text-amber-800 md:inline"> &middot; Review the intake, package and document checklist, then assign an owner.</span>
            </p>
          </div>
          <button
            onClick={() => {
              setAssignType('case_manager')
              setAssignError('')
              setShowAssignModal(true)
            }}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Assign Staff
          </button>
        </div>
      )}

      {/* Phase 7 — a child case links back to the matter it belongs to */}
      {['employee', 'beneficiary'].includes(caseData.caseRole) && caseData.parentCase && (
        <div className="rounded-2xl border border-border bg-muted p-4 flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Part of matter <span className="font-semibold">{caseData.parentCase.caseNumber}</span>
            {caseData.parentCase.clientName ? ` — ${caseData.parentCase.clientName}` : ''}
            {caseData.assignmentOverridden && (
              <span className="ml-2 px-2 py-0.5 text-xs font-semibold rounded-full bg-orange-100 text-orange-800">
                Assignment overridden
              </span>
            )}
          </p>
          <button
            onClick={() => navigate(`/crm-cases/${caseData.parentCase._id}`)}
            className="text-sm font-semibold text-primary-600 hover:text-primary-700 shrink-0"
          >
            View matter →
          </button>
        </div>
      )}

      {/* Phase 7 — a principal case shows its child cases and who's assigned
          to each; overridden children are skipped by any future cascade from
          this principal's own assignment. */}
      {caseData.caseRole === 'principal' && caseData.childCaseCount > 0 && (() => {
        const visibleChildCases = (childCases || []).filter((child) => showRemovedEmployees || child.status !== 'removed')
        const removedCount = (childCases || []).filter((child) => child.status === 'removed').length
        const isEmployerMatter = caseData.caseStructure === 'employer_employee'
        // 'removed' is the pill emails/panels elsewhere call "withdrawn" —
        // same status, this codebase's own established term (see
        // case.constants.js's CASE_STATUSES comment on removeEmployee).
        const childStatusPill = (child) => {
          if (child.status === 'removed') return { label: 'Withdrawn', className: 'bg-secondary text-muted-foreground line-through' }
          if (!child.clientName && !child.clientEmail) return { label: 'Not Identified', className: 'bg-secondary text-foreground' }
          if (child.user && String(child.user) !== String(caseData.user?._id || caseData.user)) {
            return { label: 'Invited', className: 'bg-blue-100 text-blue-800' }
          }
          return { label: child.status, className: getStatusColor(child.status) }
        }
        return (
          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-foreground">Employees ({caseData.childCaseCount})</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Assigning this matter's case manager applies to every child case below except those marked overridden.
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {removedCount > 0 && (
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                    <input type="checkbox" checked={showRemovedEmployees} onChange={(e) => setShowRemovedEmployees(e.target.checked)} />
                    Show withdrawn ({removedCount})
                  </label>
                )}
                {isEmployerMatter && (
                  <button
                    type="button"
                    onClick={handleAddEmployee}
                    disabled={employeeActionBusy === 'add'}
                    className="text-sm font-semibold text-primary-600 hover:text-primary-700 disabled:opacity-50"
                  >
                    {employeeActionBusy === 'add' ? 'Adding…' : '+ Add Employee'}
                  </button>
                )}
              </div>
            </div>
            {employeeActionMessage && (
              <div className="px-5 py-2 text-sm bg-secondary/50 text-foreground border-b border-border">{employeeActionMessage}</div>
            )}
            {childCases === null ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">Loading…</p>
            ) : visibleChildCases.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">No child cases yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-5 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Case</th>
                      <th className="px-5 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Name</th>
                      <th className="px-5 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                      <th className="px-5 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Case Manager</th>
                      <th className="px-5 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {visibleChildCases.map((child) => {
                      const pill = childStatusPill(child)
                      const isRemoved = child.status === 'removed'
                      const isInvitedPending = pill.label === 'Invited'
                      return (
                        <tr key={child._id} className={isRemoved ? 'opacity-60' : ''}>
                          <td className="px-5 py-3 whitespace-nowrap text-sm font-medium text-foreground">{child.caseNumber}</td>
                          <td className="px-5 py-3 whitespace-nowrap text-sm text-muted-foreground">{child.clientName || 'Employee Slot'}</td>
                          <td className="px-5 py-3 whitespace-nowrap">
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${pill.className}`}>{pill.label}</span>
                          </td>
                          <td className="px-5 py-3 whitespace-nowrap text-sm text-muted-foreground">
                            {child.assignedCaseManager?.name || child.assignedCaseManager?.displayName || 'Unassigned'}
                            {child.assignmentOverridden && (
                              <span className="ml-2 px-2 py-0.5 text-xs font-semibold rounded-full bg-orange-100 text-orange-800">
                                Overridden
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3 whitespace-nowrap text-right space-x-3">
                            {isRemoved ? (
                              <button
                                type="button"
                                onClick={() => handleRestoreEmployee(child._id)}
                                disabled={employeeActionBusy === `restore:${child._id}`}
                                className="text-sm font-semibold text-primary-600 hover:text-primary-700 disabled:opacity-50"
                              >
                                {employeeActionBusy === `restore:${child._id}` ? 'Restoring…' : 'Restore'}
                              </button>
                            ) : (
                              <>
                                {isEmployerMatter && isInvitedPending && (
                                  <button
                                    type="button"
                                    onClick={() => handleResendInvite(child._id)}
                                    disabled={employeeActionBusy === `resend:${child._id}`}
                                    className="text-sm font-semibold text-primary-600 hover:text-primary-700 disabled:opacity-50"
                                  >
                                    {employeeActionBusy === `resend:${child._id}` ? 'Resending…' : 'Resend Invite'}
                                  </button>
                                )}
                                <button
                                  onClick={() => navigate(`/crm-cases/${child._id}`)}
                                  className="text-sm font-semibold text-primary-600 hover:text-primary-700"
                                >
                                  View →
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveEmployee(child._id)}
                                  disabled={employeeActionBusy === `remove:${child._id}`}
                                  className="text-sm font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
                                >
                                  Withdraw
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })()}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border overflow-x-auto">
        <button
          onClick={() => handleTabChange('overview')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'overview'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <FolderOpen className="w-4 h-4 inline mr-2" />
          Overview
        </button>
        <button
          onClick={() => handleTabChange('documents')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'documents'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <FileText className="w-4 h-4 inline mr-2" />
          Documents
        </button>
        <button
          onClick={() => handleTabChange('forms')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'forms'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Receipt className="w-4 h-4 inline mr-2" />
          Forms
        </button>
        <button
          onClick={() => handleTabChange('petition')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'petition'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Briefcase className="w-4 h-4 inline mr-2" />
          Petition
        </button>
        <button
          onClick={() => handleTabChange('tracking')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'tracking'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Clock className="w-4 h-4 inline mr-2" />
          USCIS Tracking
        </button>
        <button
          onClick={() => handleTabChange('feedback')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'feedback'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <MessageSquare className="w-4 h-4 inline mr-2" />
          Feedback
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Info */}
            <div className="lg:col-span-2 space-y-6">
              <div className="card">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                  <h3 className="text-lg font-semibold text-foreground">Case Information</h3>
                  <button
                    onClick={() => setShowStageUpdateModal(true)}
                    className="btn-secondary text-sm flex items-center justify-center gap-2 w-full sm:w-auto"
                  >
                    <Save className="w-4 h-4" />
                    Update Stage
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-muted-foreground">Client Email</p>
                    <p className="font-medium break-words">{caseData.clientEmail}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-muted-foreground">Visa Type</p>
                    <p className="font-medium break-words">{resolveDisplayVisa(caseData)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Visa Category</p>
                    <p className="font-medium">{caseData.visaCategory}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Package</p>
                    <p className="font-medium capitalize">{getPackageLabel()?.replace?.('_', ' ') || getPackageLabel()}</p>
                    <p className="text-xs text-muted-foreground">{formatCurrency(caseData.plan?.amount || caseData.packageAmount)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Case Type</p>
                    <p className="font-medium">{caseData.caseType || '—'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Filing / Petition Type</p>
                    <p className="font-medium">{caseData.petitionType || '—'}</p>
                  </div>
                  {caseData.caseStructure === 'employer_employee' && (
                    <div>
                      <p className="text-sm text-muted-foreground">Employees</p>
                      <p className="font-medium">{caseData.childCaseCount || (caseData.childCases || []).length || 0}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-sm text-muted-foreground">Stage</p>
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStageColor(caseData.stage)}`}>
                      {caseData.stage?.replace('_', ' ')}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Status</p>
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(caseData.status)}`}>
                      {caseData.status}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Priority</p>
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${getPriorityColor(caseData.priority)}`}>
                      {caseData.priority}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Created</p>
                    <p className="font-medium">{new Date(caseData.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
              </div>

              {/* Petitioner / Beneficiary — family-workflow (I-130/Green Card)
                  cases only. BUG (fixed): Case.clientName/clientEmail are set
                  to the BENEFICIARY (createFamilyCase), and the Case
                  Information card above only ever reads those two generic
                  fields - so a case manager looking at a family case's
                  Overview tab previously saw only the beneficiary's contact
                  info, with no way to even find the petitioner's from this
                  page. petitionerUser/beneficiaryUser are now populated by
                  populateCaseQuery (case.service.js) specifically so this
                  card has real name/email/phone to show, not bare ObjectIds. */}
              {(caseData.petitionerUser || caseData.beneficiaryUser) && (
                <div className="card">
                  <h3 className="text-lg font-semibold text-foreground mb-4">Petitioner &amp; Beneficiary</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="min-w-0">
                      <p className="text-sm text-muted-foreground">Petitioner</p>
                      <p className="font-medium break-words">{caseData.petitionerUser?.name || caseData.petitionerUser?.displayName || '—'}</p>
                      <p className="text-sm text-muted-foreground break-words">{caseData.petitionerUser?.email || '—'}</p>
                      {caseData.petitionerUser?.phone && <p className="text-sm text-muted-foreground">{caseData.petitionerUser.phone}</p>}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-muted-foreground">Beneficiary</p>
                      <p className="font-medium break-words">{caseData.beneficiaryUser?.name || caseData.beneficiaryUser?.displayName || caseData.clientName || '—'}</p>
                      <p className="text-sm text-muted-foreground break-words">{caseData.beneficiaryUser?.email || caseData.clientEmail || '—'}</p>
                      {caseData.beneficiaryInvite?.phone && <p className="text-sm text-muted-foreground">{caseData.beneficiaryInvite.phone}</p>}
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Who's completing the beneficiary section</p>
                      <p className="font-medium">
                        {caseData.familyCompletionMode === 'petitioner_completes' ? 'Petitioner (filling it themselves)' : 'Beneficiary (invited to fill their own)'}
                      </p>
                    </div>
                    {caseData.beneficiaryInvite?.status && (
                      <div>
                        <p className="text-sm text-muted-foreground">Beneficiary invite status</p>
                        <p className="font-medium capitalize">{caseData.beneficiaryInvite.status}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Filing Readiness Score */}
              <div className="card">
                <h3 className="text-lg font-semibold text-foreground mb-4">Filing Readiness Score</h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Overall Score</span>
                    <span className="text-2xl font-bold text-foreground">{caseData.filingReadinessScore || 0}%</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-3">
                    <div
                      className={`h-3 rounded-full transition-all ${getFilingReadinessColor(caseData.filingReadinessScore || 0)}`}
                      style={{ width: `${caseData.filingReadinessScore || 0}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* USCIS Tracking */}
              <div className="card">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-foreground">USCIS Tracking</h3>
                    <p className="mt-1 text-sm text-muted-foreground break-words">
                      {caseData.uscisReceiptNumber
                        ? `Receipt ${caseData.uscisReceiptNumber}`
                        : 'Post-filing tracking begins when this case is filed.'}
                    </p>
                  </div>
                  <button type="button" onClick={() => handleTabChange('tracking')} className="btn-secondary text-sm w-full sm:w-auto shrink-0">
                    Open Tracking
                  </button>
                </div>
              </div>

              {/* Assigned Staff — two independent assignments: the case
                  manager who works the case, and (optionally) the attorney
                  granted portal access to it. Both are set from the same
                  "Assign Staff" modal (Role: Case Manager / Team Lead /
                  Attorney) above, not a separate flow. */}
              <div className="card">
                <h3 className="text-lg font-semibold text-foreground mb-4">Assigned Staff</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <div className="flex items-center gap-3">
                      <Briefcase className="w-5 h-5 text-blue-600" />
                      <div>
                        <p className="text-sm font-medium text-foreground">Case Manager</p>
                        <p className="text-sm text-muted-foreground">{caseData.assignedCaseManager?.name || 'Unassigned'}</p>
                      </div>
                    </div>
                  </div>
                  {(caseData.attorneyAccess || []).filter(grant => grant.status === 'active').map(grant => (
                    <div key={grant._id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div className="flex items-center gap-3">
                        <Scale className="w-5 h-5 text-blue-600" />
                        <div>
                          <p className="text-sm font-medium text-foreground">Attorney</p>
                          <p className="text-sm text-muted-foreground">
                            {grant.attorneyId?.name || grant.attorneyId?.displayName || grant.attorneyId?.email}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          await casesApi.revokeAttorneyAccess(id, grant.attorneyId?._id || grant.attorneyId)
                          fetchCaseDetail()
                        }}
                        className="text-xs font-semibold text-red-600 hover:underline"
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                  {(caseData.attorneyAccess || []).every(grant => grant.status !== 'active') && (
                    <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div className="flex items-center gap-3">
                        <Scale className="w-5 h-5 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium text-foreground">Attorney</p>
                          <p className="text-sm text-muted-foreground">Unassigned</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Quick Actions */}
              <div className="card">
                <h3 className="text-lg font-semibold text-foreground mb-4">Quick Actions</h3>
                <div className="space-y-2">
                  <button 
                    className="btn-secondary w-full flex items-center justify-center gap-2"
                    onClick={() => navigate(`/messages/${id}`, { 
                      state: { 
                        caseId: id,
                        clientName: caseData?.clientName,
                        caseNumber: caseData?.caseNumber,
                        clientEmail: caseData?.clientEmail,
                        openChat: true 
                      } 
                    })}
                  >
                    <MessageSquare className="w-4 h-4" />
                    Send Message
                  </button>
                  <button 
                    className="btn-secondary w-full flex items-center justify-center gap-2"
                    onClick={() => navigate(`/documents/${id}`, { state: { caseId: id, caseNumber: caseData?.caseNumber } })}
                  >
                    <FileText className="w-4 h-4" />
                    Upload Document
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'tracking' && (
        <div className="space-y-6">
          <div className="card">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Post-Filing Case Monitoring</p>
                <h3 className="mt-1 text-xl font-semibold text-foreground">USCIS Tracking</h3>
                <p className="mt-1 text-sm text-muted-foreground">Government processing details remain separate from case-preparation workflow.</p>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <TrackingField label="Current USCIS Status">
                  <select value={tracking.status} onChange={event => updateTracking(null, 'status', event.target.value)} className="input-field min-w-60">
                    {USCIS_STATUSES.map(status => <option key={status} value={status}>{displayStatus(status)}</option>)}
                  </select>
                </TrackingField>
                <button type="button" onClick={saveTracking} disabled={savingTracking || tabLoading.tracking}
                  className="btn-primary inline-flex items-center gap-2 disabled:opacity-50">
                  <Save className="h-4 w-4" />
                  {savingTracking ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
            {trackingMessage && (
              <div className={`mt-4 rounded-lg px-4 py-3 text-sm font-medium ${
                trackingMessage.includes('successfully') ? 'bg-blue-50 text-blue-800' : 'bg-amber-50 text-amber-800'
              }`}>{trackingMessage}</div>
            )}
            {tracking.status === 'draft' && (
              <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                This case has not been filed yet. You can prepare tracking details now; government-processing fields become primary after filing.
              </div>
            )}
          </div>

          {tabLoading.tracking ? (
            <div className="card py-12 text-center text-muted-foreground">Loading USCIS tracking…</div>
          ) : (
            <>
              <div className="card">
                <div className="mb-5 flex items-center gap-3">
                  <div className="rounded-lg bg-blue-100 p-2 text-blue-700"><Receipt className="h-5 w-5" /></div>
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">Filing Information</h3>
                    <p className="text-sm text-muted-foreground">Submission, delivery, receipt, and fee information.</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <TrackingField label="Filing Date">
                    <input type="date" value={tracking.filing.filingDate} onChange={event => updateTracking('filing', 'filingDate', event.target.value)} className="input-field" />
                  </TrackingField>
                  <TrackingField label="USCIS Receipt Number">
                    <input type="text" value={tracking.filing.receiptNumber} onChange={event => updateTracking('filing', 'receiptNumber', event.target.value.toUpperCase())} maxLength={13} className="input-field" placeholder="IOE1234567890" />
                  </TrackingField>
                  <TrackingField label="Service Center">
                    <input type="text" value={tracking.filing.serviceCenter} onChange={event => updateTracking('filing', 'serviceCenter', event.target.value)} className="input-field" placeholder="California Service Center" />
                  </TrackingField>
                  <TrackingField label="USCIS Lockbox">
                    <input type="text" value={tracking.filing.lockbox} onChange={event => updateTracking('filing', 'lockbox', event.target.value)} className="input-field" placeholder="Phoenix Lockbox" />
                  </TrackingField>
                  <TrackingField label="Filing Method">
                    <select value={tracking.filing.filingMethod} onChange={event => updateTracking('filing', 'filingMethod', event.target.value)} className="input-field">
                      <option value="">Select method</option>
                      <option value="paper">Paper</option>
                      <option value="online">Online</option>
                    </select>
                  </TrackingField>
                  <TrackingField label="Shipping Carrier">
                    <select value={tracking.filing.carrier} onChange={event => updateTracking('filing', 'carrier', event.target.value)} className="input-field">
                      <option value="">Select carrier</option>
                      <option value="fedex">FedEx</option>
                      <option value="ups">UPS</option>
                      <option value="usps">USPS</option>
                      <option value="other">Other</option>
                    </select>
                  </TrackingField>
                  <TrackingField label="Shipment Tracking Number">
                    <input type="text" value={tracking.filing.trackingNumber} onChange={event => updateTracking('filing', 'trackingNumber', event.target.value)} className="input-field" />
                  </TrackingField>
                  <TrackingField label="Delivery Confirmation">
                    <input type="date" value={tracking.filing.deliveryConfirmationDate} onChange={event => updateTracking('filing', 'deliveryConfirmationDate', event.target.value)} className="input-field" />
                  </TrackingField>
                  <TrackingField label="Filing Fee">
                    <input type="number" min="0" step="0.01" value={(Number(tracking.filing.filingFeeCents || 0) / 100).toFixed(2)}
                      onChange={event => updateTracking('filing', 'filingFeeCents', Math.round(Number(event.target.value || 0) * 100))} className="input-field" />
                  </TrackingField>
                  <label className="flex items-center gap-3 rounded-lg border border-border px-4 py-3 md:mt-6">
                    <input type="checkbox" checked={tracking.filing.premiumProcessing} onChange={event => updateTracking('filing', 'premiumProcessing', event.target.checked)} className="h-4 w-4 rounded border-border text-blue-600" />
                    <span className="text-sm font-medium text-muted-foreground">Premium Processing</span>
                  </label>
                </div>
              </div>

              <div className="card">
                <div className="mb-5 flex items-center gap-3">
                  <div className="rounded-lg bg-amber-100 p-2 text-amber-700"><AlertTriangle className="h-5 w-5" /></div>
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">RFE Management</h3>
                    <p className="text-sm text-muted-foreground">Response dates, ownership, review status, and AI-assisted summary.</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <TrackingField label="RFE Issue Date">
                    <input type="date" value={tracking.rfe.issueDate} onChange={event => updateTracking('rfe', 'issueDate', event.target.value)} className="input-field" />
                  </TrackingField>
                  <TrackingField label="Response Due Date">
                    <input type="date" value={tracking.rfe.responseDueDate} onChange={event => updateTracking('rfe', 'responseDueDate', event.target.value)} className="input-field" />
                  </TrackingField>
                  <TrackingField label="Response Submitted Date">
                    <input type="date" value={tracking.rfe.responseSubmittedDate} onChange={event => updateTracking('rfe', 'responseSubmittedDate', event.target.value)} className="input-field" />
                  </TrackingField>
                  <TrackingField label="Responsible Case Manager">
                    <select value={tracking.rfe.responsibleCaseManager} onChange={event => updateTracking('rfe', 'responsibleCaseManager', event.target.value)} className="input-field">
                      <option value="">Select case manager</option>
                      {users.filter(item => ['case_manager', 'team_lead'].includes(item.role)).map(item => <option key={item._id} value={item._id}>{item.name || item.displayName || item.email}</option>)}
                    </select>
                  </TrackingField>
                  <TrackingField label="Response Status">
                    <select value={tracking.rfe.responseStatus} onChange={event => updateTracking('rfe', 'responseStatus', event.target.value)} className="input-field">
                      <option value="">Not applicable</option>
                      {['pending', 'preparing', 'under_review', 'ready_to_submit', 'submitted', 'accepted', 'closed'].map(status => <option key={status} value={status}>{displayStatus(status)}</option>)}
                    </select>
                  </TrackingField>
                </div>
                <TrackingField label="AI-Generated RFE Summary">
                  <textarea rows={4} value={tracking.rfe.aiSummary} onChange={event => updateTracking('rfe', 'aiSummary', event.target.value)} className="input-field mt-4" placeholder="AI extraction or case manager-reviewed RFE summary" />
                </TrackingField>
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <div className="card">
                  <h3 className="text-lg font-semibold text-foreground">USCIS Documents</h3>
                  <p className="mt-1 text-sm text-muted-foreground">Receipt, approval, biometrics, interview, RFE, and transfer notices attach automatically after classification.</p>
                  <div className="mt-4 space-y-3">
                    {trackingDocuments.length ? trackingDocuments.map(document => (
                      <div key={document._id} className="flex items-center justify-between rounded-lg border border-border p-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">{document.originalName}</p>
                          <p className="text-xs text-muted-foreground">{displayStatus(document.documentType)} · {new Date(document.createdAt).toLocaleDateString()}</p>
                        </div>
                        <span className="badge bg-blue-100 text-blue-800">{displayStatus(document.reviewStatus)}</span>
                      </div>
                    )) : <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">No USCIS notices have been classified for this case yet.</p>}
                  </div>
                </div>

                <div className="card">
                  <h3 className="text-lg font-semibold text-foreground">Case Timeline</h3>
                  <p className="mt-1 text-sm text-muted-foreground">Questionnaire, filing, receipt, RFE, interview, and decision events.</p>
                  <div className="mt-4 max-h-96 space-y-4 overflow-y-auto pr-2">
                    {trackingTimeline.length ? trackingTimeline.map((event, index) => (
                      <div key={event._id || `${event.type}-${index}`} className="relative border-l-2 border-blue-200 pl-4">
                        <span className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-blue-500" />
                        <p className="text-xs font-semibold text-blue-700">{new Date(event.createdAt || event.occurredAt).toLocaleDateString()}</p>
                        <p className="text-sm font-semibold text-foreground">{event.title || displayStatus(event.type)}</p>
                        {event.description && <p className="text-xs text-muted-foreground">{event.description}</p>}
                      </div>
                    )) : <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">No timeline activity recorded yet.</p>}
                  </div>
                </div>
              </div>

              <div className="card">
                <TrackingField label="Tracking Notes">
                  <textarea rows={3} value={tracking.notes} onChange={event => updateTracking(null, 'notes', event.target.value)} className="input-field" placeholder="Internal notes about filing or USCIS processing" />
                </TrackingField>
                <div className="mt-4 flex justify-end">
                  <button type="button" onClick={saveTracking} disabled={savingTracking} className="btn-primary inline-flex items-center gap-2 disabled:opacity-50">
                    <Save className="h-4 w-4" /> {savingTracking ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'documents' && (
        <div className="space-y-6">
        {renderInformationRequestsPanel()}
        <QuestionnaireAnswersPanel
          title="Employer Questionnaire"
          questionnaire={employerQuestionnaire.questionnaire}
          fieldQuestions={employerQuestionnaire.fieldQuestions}
          documentQuestions={employerQuestionnaire.documentQuestions}
          answerMap={employerQuestionnaire.answerMap}
          filesByKey={employerQuestionnaire.filesByKey}
          loading={employerQuestionnaire.loading}
          onSaveAnswer={employerQuestionnaire.saveAnswer}
          onSaveFile={employerQuestionnaire.saveFileAnswer}
          onAutofill={employerQuestionnaire.autofillFromDocument}
        />
        <QuestionnaireAnswersPanel
          title="Employee Questionnaire"
          questionnaire={employeeQuestionnaire.questionnaire}
          fieldQuestions={employeeQuestionnaire.fieldQuestions}
          documentQuestions={employeeQuestionnaire.documentQuestions}
          answerMap={employeeQuestionnaire.answerMap}
          filesByKey={employeeQuestionnaire.filesByKey}
          loading={employeeQuestionnaire.loading}
          onSaveAnswer={employeeQuestionnaire.saveAnswer}
          onSaveFile={employeeQuestionnaire.saveFileAnswer}
          onAutofill={employeeQuestionnaire.autofillFromDocument}
        />
        <QuestionnaireAnswersPanel
          title="Business Plan Checklist"
          questionnaire={businessPlanQuestionnaire.questionnaire}
          fieldQuestions={businessPlanQuestionnaire.fieldQuestions}
          documentQuestions={businessPlanQuestionnaire.documentQuestions}
          answerMap={businessPlanQuestionnaire.answerMap}
          filesByKey={businessPlanQuestionnaire.filesByKey}
          loading={businessPlanQuestionnaire.loading}
          onSaveAnswer={businessPlanQuestionnaire.saveAnswer}
          onSaveFile={businessPlanQuestionnaire.saveFileAnswer}
          onAutofill={businessPlanQuestionnaire.autofillFromDocument}
        />
        <QuestionnaireAnswersPanel
          title="E-2 Supporting Documents"
          questionnaire={supportingDocumentsQuestionnaire.questionnaire}
          fieldQuestions={supportingDocumentsQuestionnaire.fieldQuestions}
          documentQuestions={supportingDocumentsQuestionnaire.documentQuestions}
          answerMap={supportingDocumentsQuestionnaire.answerMap}
          filesByKey={supportingDocumentsQuestionnaire.filesByKey}
          loading={supportingDocumentsQuestionnaire.loading}
          onSaveAnswer={supportingDocumentsQuestionnaire.saveAnswer}
          onSaveFile={supportingDocumentsQuestionnaire.saveFileAnswer}
          onAutofill={supportingDocumentsQuestionnaire.autofillFromDocument}
        />
        <QuestionnaireAnswersPanel
          title={`${caseData.visaType || 'Family'} Visa — Petitioner Checklist`}
          questionnaire={petitionerQuestionnaire.questionnaire}
          fieldQuestions={petitionerQuestionnaire.fieldQuestions}
          documentQuestions={petitionerQuestionnaire.documentQuestions}
          answerMap={petitionerQuestionnaire.answerMap}
          filesByKey={petitionerQuestionnaire.filesByKey}
          loading={petitionerQuestionnaire.loading}
          onSaveAnswer={petitionerQuestionnaire.saveAnswer}
          onSaveFile={petitionerQuestionnaire.saveFileAnswer}
          onAutofill={petitionerQuestionnaire.autofillFromDocument}
        />
        <QuestionnaireAnswersPanel
          title={`${caseData.visaType || 'Family'} Visa — Beneficiary Checklist`}
          questionnaire={beneficiaryQuestionnaire.questionnaire}
          fieldQuestions={beneficiaryQuestionnaire.fieldQuestions}
          documentQuestions={beneficiaryQuestionnaire.documentQuestions}
          answerMap={beneficiaryQuestionnaire.answerMap}
          filesByKey={beneficiaryQuestionnaire.filesByKey}
          loading={beneficiaryQuestionnaire.loading}
          onSaveAnswer={beneficiaryQuestionnaire.saveAnswer}
          onSaveFile={beneficiaryQuestionnaire.saveFileAnswer}
          onAutofill={beneficiaryQuestionnaire.autofillFromDocument}
        />
        {showJointSponsorPanel && (
          <QuestionnaireAnswersPanel
            title={`${caseData.visaType || 'Family'} Visa — Joint Sponsor (I-864) Checklist`}
            questionnaire={jointSponsorQuestionnaire.questionnaire}
            fieldQuestions={jointSponsorQuestionnaire.fieldQuestions}
            documentQuestions={jointSponsorQuestionnaire.documentQuestions}
            answerMap={jointSponsorQuestionnaire.answerMap}
            filesByKey={jointSponsorQuestionnaire.filesByKey}
            loading={jointSponsorQuestionnaire.loading}
            onSaveAnswer={jointSponsorQuestionnaire.saveAnswer}
            onSaveFile={jointSponsorQuestionnaire.saveFileAnswer}
            onAutofill={jointSponsorQuestionnaire.autofillFromDocument}
          />
        )}

        {isGreenCardRenewalCase && (
          <QuestionnaireAnswersPanel
            title="Green Card Renewal / Replacement / Correction / Update — Form I-90"
            questionnaire={greenCardRenewalQuestionnaire.questionnaire}
            fieldQuestions={greenCardRenewalQuestionnaire.fieldQuestions}
            documentQuestions={greenCardRenewalQuestionnaire.documentQuestions}
            answerMap={greenCardRenewalQuestionnaire.answerMap}
            filesByKey={greenCardRenewalQuestionnaire.filesByKey}
            loading={greenCardRenewalQuestionnaire.loading}
            onSaveAnswer={greenCardRenewalQuestionnaire.saveAnswer}
            onSaveFile={greenCardRenewalQuestionnaire.saveFileAnswer}
            onAutofill={greenCardRenewalQuestionnaire.autofillFromDocument}
          />
        )}

        {gcNvcEligible && !gcNvcApproved && (
          <div className="card">
            <h3 className="text-lg font-semibold text-foreground">Green Card – National Visa Center (NVC) / Consular Processing Checklist</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Optional beneficiary checklist for the DS-260 / NVC process. It is not visible to the client
              until you approve it here — approving assigns it to the beneficiary and does not affect the
              Green Card checklist already assigned.
            </p>
            <button
              type="button"
              onClick={handleApproveGcNvcChecklist}
              disabled={approvingGcNvc}
              className="btn-primary text-sm mt-3 disabled:opacity-50"
            >
              {approvingGcNvc ? 'Approving…' : 'Approve / Enable GC-NVC Checklist'}
            </button>
          </div>
        )}
        {gcNvcApproved && (
          <QuestionnaireAnswersPanel
            title="Green Card – National Visa Center (NVC) / Consular Processing Checklist"
            questionnaire={gcNvcQuestionnaire.questionnaire}
            fieldQuestions={gcNvcQuestionnaire.fieldQuestions}
            documentQuestions={gcNvcQuestionnaire.documentQuestions}
            answerMap={gcNvcQuestionnaire.answerMap}
            filesByKey={gcNvcQuestionnaire.filesByKey}
            loading={gcNvcQuestionnaire.loading}
            onSaveAnswer={gcNvcQuestionnaire.saveAnswer}
            onSaveFile={gcNvcQuestionnaire.saveFileAnswer}
            onAutofill={gcNvcQuestionnaire.autofillFromDocument}
          />
        )}

        {isFamilyCase && (
          <div className="card">
            <h3 className="text-lg font-semibold text-foreground">Filing Path</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Which of the I-130/Green-Card/I-864 checklists apply. Changing this assigns any newly-applicable
              checklist(s) - it never removes or duplicates one already assigned.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <select
                value={filingPath}
                onChange={(event) => setFilingPath(event.target.value)}
                className="input-field text-sm"
              >
                <option value="">Not selected</option>
                <option value="PETITION_ONLY">Petition Only (I-130)</option>
                <option value="ADJUSTMENT_OF_STATUS">Adjustment of Status / Green Card (I-485)</option>
                <option value="CONSULAR">Consular Processing / Green Card (DS-260)</option>
              </select>
              <button
                type="button"
                onClick={handleSaveFilingPath}
                disabled={savingFilingPath || filingPath === (caseData.processingPath || '')}
                className="btn-primary text-sm disabled:opacity-50"
              >
                {savingFilingPath ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}

        <div className="card">
          <h3 className="text-lg font-semibold text-foreground mb-4">Client Intake Summary</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {getClientProfileEntries().map(([label, value]) => (
              <div key={label} className="rounded-lg bg-muted p-3">
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="font-medium text-foreground">
                  {label === 'Date of Birth' && value ? new Date(value).toLocaleDateString() : value}
                </p>
              </div>
            ))}
            <div className="rounded-lg bg-blue-50 p-3">
              <p className="text-sm text-blue-700">Selected Visa</p>
              <p className="font-medium text-blue-950">{resolveDisplayVisa(caseData) || caseData.visaCategory || 'Not selected'}</p>
            </div>
            <div className="rounded-lg bg-blue-50 p-3">
              <p className="text-sm text-blue-700">Selected Package</p>
              <p className="font-medium text-blue-950 capitalize">{getPackageLabel()?.replace?.('_', ' ') || getPackageLabel()}</p>
            </div>
          </div>
        </div>

        {/* EB-1A is a "satisfy at least 3 of 10 criteria" classification,
            not a flat document list — Case Managers review/mark criteria
            here instead of the generic flat "Required Documents" card. See
            Backend's config/eb1a.js / eb1aChecklist.service.js. */}
        {String(caseData?.visaType || '').replace(/[\s_-]+/g, '').toUpperCase() === 'EB1A' ? (
          <Eb1aCriteriaPanel caseId={id} />
        ) : (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-foreground">Required Documents</h3>
            <span className="text-sm text-muted-foreground">{getUploadedChecklistCount()} sent · {getPendingChecklistItems().length} pending</span>
          </div>
          {getChecklistItems().length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {getChecklistItems().map((item, index) => {
                const status = getChecklistStatus(item)
                const completed = ['uploaded', 'submitted', 'approved', 'received', 'complete', 'completed'].includes(status)
                return (
                  // FIX (duplicate React key): checklistItems is a Mongoose
                  // subdocument array (Case.checklistItems, `_id: true` in
                  // checklistItemSchema) - each item already has a stable,
                  // unique _id. The old key used item.name, which broke as
                  // soon as two items shared a display name (e.g. two
                  // "Copy of I-94 (Arrival-Departure record)" requests) -
                  // that's a real, valid case (a document requested for more
                  // than one participant/role), not a data bug to work around.
                  // Merged list (this case's own items + parentChecklistItems)
                  // - the same static per-visa document-requirements template
                  // seeds both a principal's and its children's checklistItems
                  // independently, so identical items on each side can carry
                  // the SAME literal _id. Scope-prefixing the key keeps every
                  // row unique even when both lists render together.
                  <div key={`${item.sharedFromEmployer ? 'employer' : 'own'}-${item._id || item.documentType || item.name || "item"}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{item.name || item.title || item.documentType || `Document ${index + 1}`}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.required === false ? 'Optional' : 'Required'}
                        {item.sharedFromEmployer && <span className="ml-2 font-semibold text-blue-600">Employer • Shared</span>}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${completed ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'}`}>
                      {completed ? 'Sent' : 'Pending'}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            renderEmptyState('No required document checklist')
          )}
        </div>
        )}

        <div className="card">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Uploaded Documents ({documents.length})</h3>
              <p className="text-sm text-muted-foreground">View, upload, and review documents attached to this case.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowCaseDocumentUpload((current) => !current)}
              className="btn-primary inline-flex items-center justify-center gap-2 text-sm"
            >
              <Upload className="h-4 w-4" />
              {showCaseDocumentUpload ? 'Hide Upload' : 'Upload Document'}
            </button>
          </div>
          {showCaseDocumentUpload && (
            <div className="mb-5">
              <CaseDocumentUploadPanel caseId={id} checklistItems={getChecklistItems()} onUploaded={() => fetchDocuments(true)} />
            </div>
          )}
          {tabLoading.documents ? (
            renderSkeleton()
          ) : documents.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Filename</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Type</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Uploaded By</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">AI Status</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Review Status</th>
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <tr key={doc._id} className="border-b border-border">
                      <td className="py-3 px-4">
                        <button type="button" onClick={() => setViewingDocument(doc)} className="max-w-xs truncate text-left font-medium text-blue-700 hover:text-blue-900 hover:underline">
                          {getDocumentName(doc)}
                        </button>
                      </td>
                      <td className="py-3 px-4">
                        {doc.documentType}
                        {String(doc.caseId?._id || doc.caseId) !== String(id) && (
                          <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">Employer • Shared</span>
                        )}
                      </td>
                      <td className="py-3 px-4">{doc.uploadedByUser?.name || doc.uploadedByUser?.email || doc.uploadedBy || 'Staff'}</td>
                      <td className="py-3 px-4">
                        <span className={`badge ${doc.aiExtractionStatus === 'completed' ? 'badge-success' : doc.aiExtractionStatus === 'failed' ? 'badge-danger' : 'badge-info'}`}>
                          {doc.aiExtractionStatus || doc.intelligenceStatus || 'pending'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`badge ${getDocumentReviewColor(doc.reviewStatus)}`}>
                          {doc.reviewStatus}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setViewingDocument(doc)}
                            className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                          >
                            <Eye className="h-3.5 w-3.5" /> View
                          </button>
                          {isTextEditableDocument(doc) && (
                            <button
                              type="button"
                              onClick={() => openDocumentEditor(doc)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              <Save className="h-3.5 w-3.5" /> Edit
                            </button>
                          )}
                          <select
                            className="input-field min-w-32 text-sm py-1"
                            defaultValue=""
                            onChange={(e) => e.target.value && handleDocumentReview(doc._id, e.target.value, '')}
                          >
                            <option value="">Review...</option>
                            <option value="approved">Approve</option>
                            <option value="rejected">Reject</option>
                            <option value="needs_revision">Needs Revision</option>
                          </select>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            renderEmptyState('No documents uploaded')
          )}
        </div>
        </div>
      )}

      {activeTab === 'forms' && (
        selectedCaseForm ? (
          <FormRendererErrorBoundary resetKey={selectedCaseForm._id} onBack={() => setSelectedCaseForm(null)}>
            <Suspense fallback={renderSkeleton()}>
              <USCISFormRenderer
                // BUG (fixed): hardcoded to this page's own URL id, which is
                // only correct for a form that actually belongs to THIS case.
                // For a caseRole=principal case, listCaseForms
                // (uscis-form.service.js) deliberately aggregates every
                // child (employee) case's own CaseForms into this same
                // list - opening one of those always 404'd ("Case form not
                // found"), because every workspace call this component
                // makes (openInteractiveForm -> renderCaseForm) looks the
                // form up via CaseForm.findOne({ _id: caseFormId, caseId }),
                // requiring an exact match on the caseId actually passed
                // in. form.caseId (already present on every row from that
                // same aggregated list) is the one real fix.
                caseId={selectedCaseForm.caseId?._id || selectedCaseForm.caseId || id}
                caseForm={selectedCaseForm}
                onClose={() => setSelectedCaseForm(null)}
                onSaved={() => fetchCaseForms(true)}
              />
            </Suspense>
          </FormRendererErrorBoundary>
        ) : (
          <div className="card">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-foreground">USCIS Forms ({caseForms.length})</h3>
                <p className="text-sm text-muted-foreground">Automatically assigned, edition-locked, and populated from canonical case data.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => fetchCaseForms(true)} className="btn-secondary text-sm">Refresh</button>
                <button onClick={generateCaseForms} disabled={tabLoading.forms} className="btn-primary text-sm">
                  {tabLoading.forms ? 'Generating…' : caseForms.length ? 'Refresh Auto Fill' : 'Generate USCIS Forms'}
                </button>
                {caseForms.length > 0 && caseForms.every(form => form.generatedPdfDocument) && (
                  <button onClick={generateFilingPackage} disabled={tabLoading.forms} className="btn-secondary text-sm">
                    Generate Filing Package
                  </button>
                )}
              </div>
            </div>
            {formActionMessage && (
              <div className={`mb-3 rounded-lg border px-3 py-2 text-sm ${/^(USCIS|Filing)/.test(formActionMessage) ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                {formActionMessage}
              </div>
            )}
            {formsWarning && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {formsWarning}
              </div>
            )}
            {caseData?.knowledgePlan?.status === 'needs_configuration' && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {(caseData.knowledgePlan.configurationIssues || []).map((issue) => issue.message).join(' ')}
              </div>
            )}
            {formsError && caseForms.length > 0 && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <span>Showing the last successfully loaded forms — refreshing failed: {formsError}</span>
                <button onClick={() => fetchCaseForms(true)} className="shrink-0 btn-secondary text-xs">Retry</button>
              </div>
            )}
            {tabLoading.forms ? (
              renderSkeleton()
            ) : formsError && caseForms.length === 0 ? (
              // FIX: a database/API failure must never render identically to
              // "this case genuinely has zero USCIS forms" - it gets its own
              // state with a Retry action instead of falling into
              // renderEmptyState below.
              <div className="text-center py-8">
                <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-red-300" />
                <p className="text-red-600 font-medium">Unable to load USCIS forms.</p>
                <p className="mt-1 text-sm text-muted-foreground">{formsError}</p>
                <button onClick={() => fetchCaseForms(true)} className="btn-secondary text-sm mt-4">Retry</button>
              </div>
            ) : caseForms.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Form</th>
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Edition</th>
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Completion</th>
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Status</th>
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Last Modified</th>
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  {caseFormGroups.map((group) => (
                  <tbody key={group.ownerId}>
                    {group.label && (
                      <tr className="bg-muted/40">
                        <td colSpan={6} className="py-2 px-4 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                          {group.label}
                        </td>
                      </tr>
                    )}
                    {group.rows.map(({ form, isComponent }) => (
                      <tr key={form._id} className="border-b border-border">
                        <td className="py-3 px-4">
                          <p className={`font-medium text-foreground ${isComponent ? 'pl-4' : ''}`}>
                            {isComponent && <span className="text-muted-foreground mr-1">&#8627;</span>}
                            {form.formCode}
                          </p>
                          <p className={`text-xs text-muted-foreground ${isComponent ? 'pl-4' : ''}`}>
                            {isComponent
                              ? `Supplement of ${form.parentFormCode}${form.formTemplateId?.title ? ` — ${form.formTemplateId.title}` : ''}`
                              : form.formTemplateId?.title}
                          </p>
                        </td>
                        <td className="py-3 px-4">{form.formVersion}</td>
                        <td className="py-3 px-4 min-w-[180px]">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-muted rounded-full">
                              <div className="h-2 bg-blue-500 rounded-full" style={{ width: `${form.completion?.percent || 0}%` }} />
                            </div>
                            <span className="text-sm font-medium">{form.completion?.percent || 0}%</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{form.completion?.missingRequiredFields || 0} required missing</p>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`badge ${getFormStatusColor(form.status)}`}>{form.status?.replace('_', ' ')}</span>
                        </td>
                        <td className="py-3 px-4 text-sm text-muted-foreground">
                          {form.lastModifiedAt || form.updatedAt ? new Date(form.lastModifiedAt || form.updatedAt).toLocaleString() : 'Not started'}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <button onClick={() => setSelectedCaseForm(form)} className="btn-primary text-sm">
                              Open Form
                            </button>
                            <button
                              onClick={() => handleAutofillForm({ mappingId: `caseform-${form._id}`, formNumber: form.formCode, caseForm: { id: form._id }, caseId: form.caseId?._id || form.caseId })}
                              disabled={rowActionPending === `caseform-${form._id}`}
                              className="btn-secondary text-sm"
                              title="Re-run curated + biographic-fallback autofill for this form"
                            >
                              {rowActionPending === `caseform-${form._id}` ? 'Filling…' : 'Autofill'}
                            </button>
                            <button
                              onClick={async () => {
                                try {
                                  const response = await formGenerationApi.downloadForm(form._id)
                                  const blob = new Blob([response.data], { type: 'application/pdf' })
                                  const url = URL.createObjectURL(blob)
                                  const link = document.createElement('a')
                                  link.href = url
                                  const date = new Date().toISOString().slice(0, 10)
                                  link.download = `${form.formCode}_${date}.pdf`
                                  document.body.appendChild(link)
                                  link.click()
                                  document.body.removeChild(link)
                                  URL.revokeObjectURL(url)
                                  const formWarnings = readFormWarnings(response)
                                  if (formWarnings.length) setFormActionMessage(`Downloaded. Please review these fields on the PDF: ${formWarnings.join('; ')}`)
                                } catch (error) {
                                  setFormActionMessage(error.response?.data?.message || 'Unable to download this form.')
                                }
                              }}
                              className="btn-secondary text-sm"
                              title="Download the official, filled PDF (sliced to this form's own pages only)"
                            >
                              Download
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  ))}
                </table>
              </div>
            ) : (
              <div className="text-center py-8">
                <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground font-medium">No USCIS forms yet</p>
                <p className="mt-1 text-sm text-muted-foreground max-w-xs mx-auto">
                  Click <strong>Generate USCIS Forms</strong> to auto-fill forms from the
                  available case data. Fields will be blank where information hasn't been
                  provided yet — fill them in manually, or they'll populate automatically
                  as the client completes their questionnaire.
                </p>
              </div>
            )}

            {/* Phase 1: every OTHER form the VisaFormMapping registry says this
                case's visa needs, not yet a CaseForm above - mapped-but-not-
                provisioned and mapped-but-not-yet-fetched-from-USCIS forms are
                otherwise completely invisible. Rows already represented in the
                table above (a CaseForm exists) are excluded here on purpose. */}
            {formsOverview.items.some((item) => !item.caseForm) && (
              <div className="mt-6 pt-6 border-t border-border">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="font-semibold text-foreground">Other Forms for This Visa</h4>
                  <button onClick={() => fetchFormsOverview(true)} className="btn-secondary text-xs">Refresh</button>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  Every other form the registry maps to {caseData?.visaType || 'this visa type'} — not yet on this case.
                </p>
                {formsOverviewError && (
                  <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{formsOverviewError}</div>
                )}
                <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                  Autofill covers biographic identity, contact, and address fields only — deeper, form-specific
                  fields still need manual review. Forms are downloaded directly from the current version published
                  on uscis.gov; always confirm the edition date matches the latest USCIS release before filing.
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-3 font-medium text-muted-foreground text-sm">Form</th>
                        <th className="text-left py-2 px-3 font-medium text-muted-foreground text-sm">Status</th>
                        <th className="text-left py-2 px-3 font-medium text-muted-foreground text-sm">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {formsOverview.items.filter((item) => item.uiStatus !== 'AUTOFILLED' && item.uiStatus !== 'PROVISIONED').map((item) => (
                        <tr key={item.mappingId} className="border-b border-border">
                          <td className="py-2 px-3">
                            <p className="font-medium text-foreground text-sm">{item.formNumber}</p>
                            <p className="text-xs text-muted-foreground">{item.formName}</p>
                          </td>
                          <td className="py-2 px-3">
                            <span className={`badge ${getUiStatusColor(item.uiStatus)}`}>
                              {UI_STATUS_LABEL[item.uiStatus] || item.uiStatus}
                            </span>
                            {item.uiStatus === 'RULE_CONFLICT' && (
                              <p className="text-xs text-red-600 mt-1">This form's template can't be applied to this case yet — contact a registry admin.</p>
                            )}
                            {item.uiStatus === 'NOT_FETCHABLE_HERE' && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Issued by {item.agency} — no downloadable PDF on uscis.gov. Import it manually via the form registry.
                              </p>
                            )}
                            {item.uiStatus === 'BIOGRAPHIC_READY' && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Autofill covers biographic identity, contact, and address fields only. A full field
                                mapping review is required before this form is ready for filing.
                              </p>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            <div className="flex flex-wrap items-center gap-2">
                              {/* Only shown when there's no in-app action yet (no CaseForm on
                                  file) - once a CaseForm exists (BIOGRAPHIC_READY/AUTOFILLED/
                                  PROVISIONED), "Open"/"Open (Biographic Autofill)" below is the
                                  real, correct action. Confirmed this external link sitting next
                                  to "Open (Biographic Autofill)" was what case managers were
                                  clicking for newly-fetched forms, landing on the raw uscis.gov
                                  page instead of the in-app viewer. */}
                              {item.officialPageUrl && !item.caseForm && (
                                <a href={item.officialPageUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                                  View on USCIS.gov
                                </a>
                              )}
                              {item.uiStatus === 'ACQUIRE_FROM_USCIS' && (
                                <button
                                  onClick={() => handleAcquireForm(item)}
                                  disabled={rowActionPending === item.mappingId}
                                  className="btn-primary text-xs"
                                >
                                  {rowActionPending === item.mappingId ? 'Fetching…' : 'Fetch from USCIS'}
                                </button>
                              )}
                              {item.uiStatus === 'AVAILABLE_TO_PROVISION' && (
                                <button
                                  onClick={() => handleProvisionMapping(item)}
                                  disabled={rowActionPending === item.mappingId}
                                  className="btn-primary text-xs"
                                  title="Adds and auto-fills this one form, independently of any unresolved canonical conflict elsewhere on the case"
                                >
                                  Add &amp; Autofill
                                </button>
                              )}
                              {item.uiStatus === 'CONDITIONAL_PENDING' && (
                                <>
                                  <button
                                    onClick={() => handleDecideMapping(item, 'ADD')}
                                    disabled={rowActionPending === item.mappingId}
                                    className="btn-primary text-xs"
                                  >
                                    Add
                                  </button>
                                  <button
                                    onClick={() => handleDecideMapping(item, 'NOT_APPLICABLE')}
                                    disabled={rowActionPending === item.mappingId}
                                    className="btn-secondary text-xs"
                                  >
                                    Not Applicable
                                  </button>
                                </>
                              )}
                              {item.uiStatus === 'BIOGRAPHIC_READY' && (
                                <>
                                  <button
                                    onClick={() => {
                                      const form = caseForms.find(f => f._id === item.caseForm.id)
                                      if (form) setSelectedCaseForm(form)
                                    }}
                                    className="btn-primary text-xs"
                                  >
                                    Open (Biographic Autofill)
                                  </button>
                                  <button
                                    onClick={() => handleRequestMappingReview(item)}
                                    disabled={rowActionPending === item.mappingId}
                                    className="btn-secondary text-xs"
                                  >
                                    Request Full Mapping Review
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
              </div>
            )}
          </div>
        )
      )}

      {activeTab === 'petition' && (
        <Suspense fallback={renderSkeleton()}>
          <PetitionTab caseId={id} />
        </Suspense>
      )}

      {activeTab === 'feedback' && (
        <CaseFeedbackChat caseId={id} />
      )}

      {/* Staff Details Modal */}
      {showStaffDetailsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-card rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-xl font-bold text-foreground mb-4">Staff Assignment</h3>
            <div className="space-y-3 mb-6">
              <div>
                <p className="text-sm text-muted-foreground">Case Number</p>
                <p className="font-medium text-foreground break-words">{caseData.caseNumber}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Current Case Manager</p>
                <p className="font-medium text-foreground">
                  {caseData.assignedCaseManager?.name || caseData.assignedCaseManager?.displayName || 'Unassigned'}
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowStaffDetailsModal(false)}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowStaffDetailsModal(false)
                  setAssignError('')
                  setAssigneeId(caseData.assignedCaseManager?._id || caseData.assignedCaseManager?.id || '')
                  setShowAssignModal(true)
                }}
                className="btn-primary flex-1"
              >
                Edit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Staff Modal */}
      {showAssignModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-card rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-xl font-bold text-foreground mb-4">Assign Staff</h3>
            {assignError && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{assignError}</span>
              </div>
            )}
            <form onSubmit={handleAssign} className="space-y-4">
              {caseData.caseRole === 'principal' && (
                <p className="text-sm text-muted-foreground bg-muted border border-border rounded-lg px-3 py-2">
                  This will also apply to every child case in this matter, except any already individually overridden.
                </p>
              )}
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Role</label>
                <select
                  value={assignType}
                  onChange={(e) => setAssignType(e.target.value)}
                  className="input-field"
                >
                  <option value="case_manager">Case Manager</option>
                  <option value="team_lead">Team Lead</option>
                  <option value="attorney">Attorney</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">
                  {assignType === 'attorney' ? 'Attorney' : 'Staff Member'}
                </label>
                <select
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  className="input-field"
                  required
                >
                  <option value="">{assignType === 'attorney' ? 'Select attorney' : 'Select staff member'}</option>
                  {getFilteredUsers().map(user => (
                    <option key={user._id} value={user._id}>{user.name || user.displayName || user.email}</option>
                  ))}
                </select>
                {assignType === 'attorney' && attorneyUsers.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">No attorney accounts exist yet.</p>
                )}
              </div>
              {assignType === 'attorney' && (
                <p className="text-sm text-muted-foreground bg-muted border border-border rounded-lg px-3 py-2">
                  This grants the attorney access to this case in the Attorney Portal — a separate assignment from the case manager, and revocable independently.
                </p>
              )}
              {assignType === 'case_manager' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-1">Priority (optional)</label>
                    <select
                      value={assignPriority}
                      onChange={(e) => setAssignPriority(e.target.value)}
                      className="input-field"
                    >
                      <option value="">Keep current priority</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                      <option value="Standard Processing">Standard Processing</option>
                      <option value="Premium Processing">Premium Processing</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-muted-foreground mb-1">Internal Note (optional)</label>
                    <textarea
                      value={assignInternalNote}
                      onChange={(e) => setAssignInternalNote(e.target.value)}
                      className="input-field"
                      rows={3}
                      placeholder="Context for the case manager taking this case…"
                    />
                  </div>
                </>
              )}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowAssignModal(false)
                    setAssigneeId('')
                    setAssignPriority('')
                    setAssignInternalNote('')
                    setAssignError('')
                  }}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button type="submit" disabled={assigning} className="btn-primary flex-1 disabled:opacity-50">
                  {assigning ? 'Assigning…' : 'Assign'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Stage Update Modal */}
      {showStageUpdateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-card rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-xl font-bold text-foreground mb-4">Update Stage</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">New Stage</label>
                <select
                  value={newStage}
                  onChange={(e) => setNewStage(e.target.value)}
                  className="input-field"
                >
                  <option value="">Select stage</option>
                  {STAGES.map(stage => (
                    <option key={stage} value={stage}>{stage.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowStageUpdateModal(false)} className="btn-secondary flex-1">
                  Cancel
                </button>
                <button onClick={handleStageUpdate} className="btn-primary flex-1" disabled={!newStage}>
                  Update
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Record Payment Modal */}
      {showRecordPaymentModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-card rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-xl font-bold text-foreground mb-4">Record Payment</h3>
            <form onSubmit={handleRecordPayment} className="space-y-4">
              <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{payments.find(payment => payment._id === selectedPaymentId)?.invoiceNumber}</span>
                {' · '}Remaining {formatPaymentAmount(payments.find(payment => payment._id === selectedPaymentId)?.remainingAmount, payments.find(payment => payment._id === selectedPaymentId)?.currency)}
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Amount</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={Number(payments.find(payment => payment._id === selectedPaymentId)?.remainingAmount || 0) / 100}
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="input-field"
                  placeholder="Enter amount"
                  disabled={recordingPayment}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Payment Method</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="input-field"
                  disabled={recordingPayment}
                >
                  <option value="">Select method</option>
                  <option value="card_terminal">Card Terminal</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="check">Check</option>
                  <option value="cash">Cash</option>
                  <option value="wire">Wire Transfer</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Notes</label>
                <textarea
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  className="input-field"
                  placeholder="Optional notes"
                  disabled={recordingPayment}
                />
              </div>
              {paymentError && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{paymentError}</div>}
              <div className="flex gap-3">
                <button type="button" onClick={() => {
                  setShowRecordPaymentModal(false)
                  setPaymentError('')
                }} className="btn-secondary flex-1" disabled={recordingPayment}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary flex-1" disabled={!paymentAmount || !paymentMethod || recordingPayment}>
                  {recordingPayment ? 'Recording…' : 'Record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Letter Modal */}
      {showCreateLetterModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-card rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-xl font-bold text-foreground mb-4">Create Letter</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">Letter Type</label>
                <select
                  value={letterType}
                  onChange={(e) => setLetterType(e.target.value)}
                  className="input-field"
                >
                  <option value="">Select type</option>
                  <option value="recommendation">Recommendation</option>
                  <option value="support_letter">Support Letter</option>
                </select>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowCreateLetterModal(false)} className="btn-secondary flex-1">
                  Cancel
                </button>
                <button onClick={handleCreateLetter} className="btn-primary flex-1" disabled={!letterType}>
                  Create
                </button>
              </div>
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

export default CRMCaseDetail
