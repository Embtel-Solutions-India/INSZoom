import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api, { documentsApi } from '../services/api'
import { resolveDisplayVisa } from '../utils/visaDisplay'
import { useAuth } from '../contexts/AuthContext'
import {
  ArrowLeft,
  Briefcase,
  CheckCircle,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  Upload,
  X,
  XCircle,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'

/* ── Helpers ──────────────────────────────────────────────────────────────── */
const fmt = (value) => (value ? value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'N/A')

const fmtDate = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—'

const fmtSize = (bytes) => {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

const REVIEW_BADGE = {
  approved:       'bg-green-100 text-green-800 border-green-200',
  pending:        'bg-yellow-100 text-yellow-800 border-yellow-200',
  uploaded:       'bg-blue-100 text-blue-800 border-blue-200',
  under_review:   'bg-violet-100 text-violet-800 border-violet-200',
  rejected:       'bg-red-100 text-red-800 border-red-200',
  needs_revision: 'bg-orange-100 text-orange-800 border-orange-200',
}

const DOC_ICON_COLOR = {
  identity:   'text-blue-500',
  education:  'text-violet-500',
  employment: 'text-blue-500',
  financial:  'text-amber-500',
  civil:      'text-pink-500',
  immigration:'text-cyan-500',
  business:   'text-orange-500',
  medical:    'text-red-500',
  supporting: 'text-slate-500',
  other:      'text-slate-400',
}

/* ── Document Viewer Modal ────────────────────────────────────────────────── */
function DocumentViewer({ document, onClose }) {
  const [blobUrl, setBlobUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [zoom, setZoom] = useState(100)

  useEffect(() => {
    if (!document?._id) return
    setLoading(true)
    setError(null)
    setBlobUrl(null)

    documentsApi.preview(document._id)
      .then((response) => {
        const url = URL.createObjectURL(response.data)
        setBlobUrl(url)
      })
      .catch(() => setError('Unable to preview this document. Try downloading it instead.'))
      .finally(() => setLoading(false))

    return () => {
      setBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
    }
  }, [document?._id])

  const handleDownload = async () => {
    if (blobUrl) {
      const anchor = window.document.createElement('a')
      anchor.href = blobUrl
      anchor.download = document.originalFileName || document.fileName || 'document'
      anchor.click()
      return
    }
    try {
      const response = await documentsApi.preview(document._id)
      const url = URL.createObjectURL(response.data)
      const anchor = window.document.createElement('a')
      anchor.href = url
      anchor.download = document.originalFileName || document.fileName || 'document'
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch {
      // silently fail
    }
  }

  const isPdf = document?.mimeType === 'application/pdf' ||
    (document?.originalFileName || document?.fileName || '').toLowerCase().endsWith('.pdf')
  const isImage = document?.mimeType?.startsWith('image/')

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/90 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 bg-slate-900 px-5 py-3 shadow-lg">
        <div className="flex items-center gap-3 min-w-0">
          <FileText className="h-5 w-5 shrink-0 text-blue-400" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">
              {document.originalFileName || document.fileName || 'Document'}
            </p>
            <p className="text-xs text-slate-400">
              {fmt(document.documentType)} · {fmt(document.category)} · {fmtSize(document.fileSize)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isImage && (
            <>
              <button
                onClick={() => setZoom((z) => Math.max(25, z - 25))}
                className="rounded-lg bg-slate-700 p-2 text-slate-300 hover:bg-slate-600"
                title="Zoom out"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="text-xs font-semibold text-slate-300 w-12 text-center">{zoom}%</span>
              <button
                onClick={() => setZoom((z) => Math.min(300, z + 25))}
                className="rounded-lg bg-slate-700 p-2 text-slate-300 hover:bg-slate-600"
                title="Zoom in"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
            </>
          )}
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
          >
            <Download className="h-4 w-4" /> Download
          </button>
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-700 p-2 text-slate-300 hover:bg-slate-600"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Viewer body */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-4">
        {loading && (
          <div className="flex flex-col items-center gap-3 text-slate-300">
            <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
            <p className="text-sm">Loading preview…</p>
          </div>
        )}
        {!loading && error && (
          <div className="flex flex-col items-center gap-4 text-center max-w-sm">
            <XCircle className="h-10 w-10 text-red-400" />
            <p className="text-slate-300 text-sm">{error}</p>
            <button onClick={handleDownload} className="btn-primary flex items-center gap-2">
              <Download className="h-4 w-4" /> Download instead
            </button>
          </div>
        )}
        {!loading && !error && blobUrl && isPdf && (
          <div className="flex h-full w-full items-center justify-center">
            <iframe
              src={blobUrl}
              title="Document preview"
              className="h-full min-h-[72vh] w-full max-w-6xl rounded-lg bg-white shadow-2xl"
            />
          </div>
        )}
        {!loading && !error && blobUrl && isImage && (
          <div className="flex min-h-full min-w-full items-center justify-center overflow-auto p-6">
            <img
              src={blobUrl}
              alt="Document preview"
              style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'center center' }}
              className="max-h-[78vh] max-w-[90vw] rounded-lg object-contain shadow-xl"
            />
          </div>
        )}
        {!loading && !error && blobUrl && !isPdf && !isImage && (
          <div className="flex flex-col items-center gap-4 text-center max-w-sm">
            <FileText className="h-10 w-10 text-slate-400" />
            <p className="text-slate-300 text-sm">
              Preview is not available for this file type. Download to open it.
            </p>
            <button onClick={handleDownload} className="btn-primary flex items-center gap-2">
              <Download className="h-4 w-4" /> Download file
            </button>
          </div>
        )}
      </div>

      {/* Meta footer */}
      <div className="border-t border-slate-700 bg-slate-800 px-5 py-2.5 flex flex-wrap items-center gap-x-6 gap-y-1">
        {[
          { label: 'Uploaded', value: fmtDate(document.createdAt) },
          { label: 'Type', value: fmt(document.documentType) },
          { label: 'Category', value: fmt(document.category) },
          { label: 'Review', value: fmt(document.reviewStatus || 'pending') },
          document.uploadedByUser?.name && { label: 'By', value: document.uploadedByUser.name },
        ].filter(Boolean).map(({ label, value }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className="text-[0.68rem] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
            <span className="text-xs text-slate-300">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Upload Panel ─────────────────────────────────────────────────────────── */
function UploadPanel({ caseId, caseNumber, onSuccess }) {
  const fileInputRef = useRef(null)
  const [selectedFiles, setSelectedFiles] = useState([])
  const [documentType, setDocumentType] = useState('supporting_evidence')
  const [category, setCategory] = useState('supporting')
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState({ completed: 0, total: 0 })
  const [message, setMessage] = useState('')

  const upload = async () => {
    if (!caseId || !selectedFiles.length) return
    setUploading(true)
    setMessage('')
    setProgress({ completed: 0, total: selectedFiles.length })
    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const fd = new FormData()
        fd.append('file', selectedFiles[i])
        fd.append('caseId', caseId)
        fd.append('documentType', documentType)
        fd.append('category', category)
        await api.post('/documents', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
        setProgress({ completed: i + 1, total: selectedFiles.length })
      }
      setSelectedFiles([])
      if (fileInputRef.current) fileInputRef.current.value = ''
      setMessage('success')
      onSuccess?.()
    } catch (err) {
      setMessage(err.response?.data?.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-900">Upload to Case {caseNumber || ''}</h3>
          <p className="text-xs text-gray-500 mt-0.5">Attach case documents on behalf of the client</p>
        </div>
        <span className="rounded-full bg-blue-50 border border-blue-200 px-3 py-1 text-xs font-semibold text-blue-700">
          Case Manager Upload
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className="mb-1 block text-xs font-medium text-gray-700">Document Type</span>
          <select value={documentType} onChange={(e) => setDocumentType(e.target.value)} className="input-field text-sm">
            {[
              ['passport','Passport'], ['visa','Visa'], ['i94','I-94'], ['resume','Resume / CV'],
              ['degree','Degree'], ['transcript','Transcript'], ['employment_letter','Employment Letter'],
              ['birth_certificate','Birth Certificate'], ['marriage_certificate','Marriage Certificate'],
              ['tax_return','Tax Return'], ['uscis_notice','USCIS Notice'],
              ['approval_notice','Approval Notice'], ['rfe','RFE Notice'],
              ['supporting_evidence','Supporting Evidence'], ['other','Other'],
            ].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-gray-700">Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="input-field text-sm">
            {['identity','education','employment','financial','civil','immigration','business','medical','legal','government','supporting','evidence','other']
              .map((v) => <option key={v} value={v}>{fmt(v)}</option>)}
          </select>
        </label>
      </div>

      <div
        className="rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/50 p-5 text-center cursor-pointer hover:bg-blue-50 transition"
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="mx-auto h-7 w-7 text-blue-500" />
        <p className="mt-1.5 text-sm font-semibold text-gray-800">Click to select files</p>
        <p className="text-xs text-gray-500 mt-0.5">PDF, JPG, PNG, DOC, DOCX up to 250MB each</p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,.doc,.docx,.txt,.csv,.zip"
          className="hidden"
          onChange={(e) => setSelectedFiles(Array.from(e.target.files || []))}
        />
      </div>

      {selectedFiles.length > 0 && (
        <ul className="space-y-1.5">
          {selectedFiles.map((file, i) => (
            <li key={i} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{file.name}</p>
                <p className="text-xs text-gray-500">{fmtSize(file.size)}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedFiles((f) => f.filter((_, j) => j !== i))}
                className="ml-2 rounded p-1 text-gray-400 hover:text-red-500"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {uploading && (
        <div>
          <div className="flex justify-between text-xs font-medium text-gray-600 mb-1">
            <span>Uploading…</span>
            <span>{progress.completed}/{progress.total}</span>
          </div>
          <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${progress.total ? (progress.completed / progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {message === 'success' && (
        <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800 border border-blue-200">
          <CheckCircle className="h-4 w-4 shrink-0" /> Documents uploaded successfully.
        </div>
      )}
      {message && message !== 'success' && (
        <p className="text-sm text-red-600">{message}</p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={upload}
          disabled={!selectedFiles.length || uploading}
          className="btn-primary flex items-center gap-2 disabled:opacity-50"
        >
          <Upload className="h-4 w-4" />
          {uploading ? 'Uploading…' : `Upload ${selectedFiles.length || ''} file${selectedFiles.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  )
}

/* ── Main Component ───────────────────────────────────────────────────────── */
const Documents = () => {
  const navigate = useNavigate()
  const { caseId: urlCaseId } = useParams()
  const { user } = useAuth()

  const [cases, setCases] = useState([])
  const [casesLoading, setCasesLoading] = useState(true)
  const [caseSearch, setCaseSearch] = useState('')

  const [selectedCase, setSelectedCase] = useState(null)
  const [documents, setDocuments] = useState([])
  const [docsLoading, setDocsLoading] = useState(false)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

  const [viewingDoc, setViewingDoc] = useState(null)
  const [showUpload, setShowUpload] = useState(false)

  const normalizedRole = String(user?.role || '').toLowerCase().replace(/[\s-]+/g, '_')
  const canUpload = ['case_manager', 'team_lead', 'super_admin', 'admin'].includes(normalizedRole)
  const canReview = ['case_manager', 'team_lead', 'super_admin', 'admin', 'paralegal', 'reviewer'].includes(normalizedRole)

  /* ── Load cases ── */
  // Search is server-side now (was always fetching 200 cases and filtering
  // client-side) — caseSearchRef lets loadCases read the current search box
  // value without needing it as a useCallback dependency.
  const caseSearchRef = useRef(caseSearch)
  useEffect(() => { caseSearchRef.current = caseSearch }, [caseSearch])

  const loadCases = useCallback(async () => {
    setCasesLoading(true)
    try {
      const params = { limit: 50, sort: '-updatedAt' }
      if (caseSearchRef.current) params.search = caseSearchRef.current
      const response = await api.get('/cases', { params })
      const list = response.data?.cases || response.data?.data || []
      setCases(list)
      // If URL has a caseId, auto-select that case
      if (urlCaseId) {
        const match = list.find((c) => c._id === urlCaseId)
        if (match) setSelectedCase(match)
        else {
          // Fallback: fetch the single case
          const r = await api.get(`/cases/${urlCaseId}`)
          const c = r.data?.case || r.data
          if (c) setSelectedCase(c)
        }
      }
    } catch (err) {
      console.error('Failed to load cases', err)
    } finally {
      setCasesLoading(false)
    }
  }, [urlCaseId])

  // Debounced server-side re-fetch as the case-search box changes.
  const isFirstCaseSearchRun = useRef(true)
  useEffect(() => {
    if (isFirstCaseSearchRun.current) {
      isFirstCaseSearchRun.current = false
      return
    }
    const handle = setTimeout(() => { loadCases() }, 300)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseSearch])

  /* ── Load documents for selected case ── */
  const loadDocuments = useCallback(async (caseObj) => {
    if (!caseObj?._id) {
      setDocuments([])
      return
    }
    setDocsLoading(true)
    try {
      const response = await api.get('/documents', { params: { caseId: caseObj._id, limit: 200 } })
      setDocuments(response.data?.documents || [])
    } catch (err) {
      console.error('Failed to load documents', err)
      setDocuments([])
    } finally {
      setDocsLoading(false)
    }
  }, [])

  useEffect(() => { loadCases() }, [loadCases])
  useEffect(() => { loadDocuments(selectedCase) }, [selectedCase, loadDocuments])

  const handleSelectCase = (caseObj) => {
    setSelectedCase(caseObj)
    setSearch('')
    setStatusFilter('')
    setCategoryFilter('')
    setShowUpload(false)
    // Update URL without navigating
    navigate(`/documents/${caseObj._id}`, { replace: true })
  }

  /* ── Filter documents ── */
  const filteredDocs = documents.filter((doc) => {
    const name = (doc.originalFileName || doc.fileName || '').toLowerCase()
    const matchSearch = !search || name.includes(search.toLowerCase()) || fmt(doc.documentType).toLowerCase().includes(search.toLowerCase())
    const matchStatus = !statusFilter || doc.reviewStatus === statusFilter
    const matchCategory = !categoryFilter || doc.category === categoryFilter
    return matchSearch && matchStatus && matchCategory
  })

  const caseLabel = (c) =>
    c.caseNumber || c.caseId || c._id?.slice(-6) || 'Case'

  const clientName = (c) =>
    c.beneficiaryName || c.clientName ||
    [c.beneficiary?.firstName, c.beneficiary?.lastName].filter(Boolean).join(' ') ||
    [c.client?.firstName, c.client?.lastName].filter(Boolean).join(' ') ||
    'Unknown Client'

  /* ── Review action ── */
  const reviewDocument = async (docId, status) => {
    try {
      await documentsApi.review(docId, { reviewStatus: status })
      setDocuments((prev) =>
        prev.map((d) => (d._id === docId ? { ...d, reviewStatus: status } : d))
      )
    } catch (err) {
      console.error('Review failed', err)
    }
  }

  /* ── Render ── */
  return (
    <>
      {/* Document viewer overlay */}
      {viewingDoc && (
        <DocumentViewer document={viewingDoc} onClose={() => setViewingDoc(null)} />
      )}

      {/* -m-6 cancels the Layout's p-6 padding so the split-pane fills the full content area */}
      <div className="-m-6 flex overflow-hidden" style={{ height: 'calc(100vh - 64px)' }}>
        {/* ── LEFT PANE: Case list ── */}
        <aside className="w-72 shrink-0 flex flex-col border-r border-gray-200 bg-white overflow-hidden">
          {/* Header */}
          <div className="border-b border-gray-100 px-4 py-4">
            <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-blue-600" /> Cases
            </h2>
            <div className="relative mt-2">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search cases…"
                value={caseSearch}
                onChange={(e) => setCaseSearch(e.target.value)}
                className="w-full rounded-lg border border-gray-200 py-1.5 pl-8 pr-3 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20"
              />
            </div>
          </div>

          {/* Case list */}
          <div className="flex-1 overflow-y-auto">
            {casesLoading ? (
              <div className="flex items-center justify-center py-10 text-gray-400">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
              </div>
            ) : cases.length === 0 ? (
              <p className="py-10 text-center text-sm text-gray-400">No cases found</p>
            ) : (
              cases.map((c) => {
                const active = selectedCase?._id === c._id
                const docCount = active ? documents.length : null
                return (
                  <button
                    key={c._id}
                    type="button"
                    onClick={() => handleSelectCase(c)}
                    className={`w-full text-left px-4 py-3 border-b border-gray-50 transition-colors ${
                      active ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-gray-50 border-l-2 border-l-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className={`text-sm font-semibold truncate ${active ? 'text-blue-800' : 'text-gray-900'}`}>
                          {caseLabel(c)}
                        </p>
                        <p className="text-xs text-gray-500 truncate mt-0.5">{clientName(c)}</p>
                      </div>
                      <div className="flex flex-col items-end shrink-0 gap-1">
                        <span className={`rounded-full px-2 py-0.5 text-[0.6rem] font-semibold border ${
                          c.status === 'approved' ? 'bg-green-50 text-green-700 border-green-200' :
                          c.status === 'active' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                          'bg-gray-50 text-gray-600 border-gray-200'
                        }`}>
                          {fmt(c.status || 'active')}
                        </span>
                        {active && docCount !== null && (
                          <span className="text-[0.6rem] text-blue-600 font-semibold">
                            {docCount} doc{docCount !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-[0.65rem] text-gray-400 mt-1">
                      {resolveDisplayVisa(c) || c.visaCategory || 'Visa type not set'}
                    </p>
                  </button>
                )
              })
            )}
          </div>
        </aside>

        {/* ── RIGHT PANE: Document list ── */}
        <main className="flex-1 flex flex-col overflow-hidden bg-gray-50">
          {!selectedCase ? (
            /* Empty state */
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
              <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mb-4">
                <FileText className="h-8 w-8 text-blue-500" />
              </div>
              <h3 className="text-lg font-semibold text-gray-800">Select a case</h3>
              <p className="text-sm text-gray-500 mt-1 max-w-xs">
                Choose a case from the list on the left to view its documents.
              </p>
            </div>
          ) : (
            <>
              {/* Case header bar */}
              <div className="shrink-0 bg-white border-b border-gray-200 px-6 py-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => { setSelectedCase(null); navigate('/documents', { replace: true }) }}
                        className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 lg:hidden"
                      >
                        <ArrowLeft className="h-4 w-4" />
                      </button>
                      <h1 className="text-lg font-semibold text-gray-900">
                        Case {caseLabel(selectedCase)}
                        <span className="ml-2 text-sm font-normal text-gray-500">
                          — {clientName(selectedCase)}
                        </span>
                      </h1>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {resolveDisplayVisa(selectedCase) || 'Visa type not set'} · {fmt(selectedCase.status || 'active')} ·{' '}
                      {filteredDocs.length} document{filteredDocs.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => loadDocuments(selectedCase)}
                      className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50"
                      title="Refresh"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/crm-cases/${selectedCase._id}`)}
                      className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Open Case <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                    {canUpload && (
                      <button
                        type="button"
                        onClick={() => setShowUpload((v) => !v)}
                        className="btn-primary flex items-center gap-1.5 text-xs"
                      >
                        <Upload className="h-4 w-4" /> Upload
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Upload panel */}
              {showUpload && canUpload && (
                <div className="shrink-0 px-6 pt-4">
                  <UploadPanel
                    caseId={selectedCase._id}
                    caseNumber={caseLabel(selectedCase)}
                    onSuccess={() => {
                      loadDocuments(selectedCase)
                      setShowUpload(false)
                    }}
                  />
                </div>
              )}

              {/* Filters */}
              <div className="shrink-0 px-6 py-3 flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-40">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search documents…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-8 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-gray-400" />
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="rounded-lg border border-gray-200 bg-white py-2 pl-3 pr-8 text-sm outline-none focus:border-blue-400"
                  >
                    <option value="">All statuses</option>
                    {['uploaded','under_review','pending','approved','rejected','needs_revision'].map((s) => (
                      <option key={s} value={s}>{fmt(s)}</option>
                    ))}
                  </select>
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="rounded-lg border border-gray-200 bg-white py-2 pl-3 pr-8 text-sm outline-none focus:border-blue-400"
                  >
                    <option value="">All categories</option>
                    {['identity','education','employment','financial','civil','immigration','business','medical','legal','supporting','evidence','other'].map((c) => (
                      <option key={c} value={c}>{fmt(c)}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Document list */}
              <div className="flex-1 overflow-y-auto px-6 pb-6">
                {docsLoading ? (
                  <div className="flex items-center justify-center py-16 text-gray-400">
                    <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading documents…
                  </div>
                ) : filteredDocs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <FileText className="h-10 w-10 text-gray-300 mb-3" />
                    <p className="font-medium text-gray-600">No documents found</p>
                    <p className="text-sm text-gray-400 mt-1">
                      {documents.length === 0
                        ? 'The client has not uploaded any documents for this case yet.'
                        : 'No documents match the current filters.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredDocs.map((doc) => (
                      <div
                        key={doc._id}
                        className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3 hover:border-blue-200 hover:shadow-sm transition-all"
                      >
                        {/* Icon */}
                        <div className={`shrink-0 w-9 h-9 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center ${DOC_ICON_COLOR[doc.category] || 'text-gray-400'}`}>
                          <FileText className="h-5 w-5" />
                        </div>

                        {/* Name + meta */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">
                            {doc.originalFileName || doc.fileName || 'Untitled Document'}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                            <span className="text-xs text-gray-500">{fmt(doc.documentType)}</span>
                            <span className="text-[0.65rem] text-gray-400">·</span>
                            <span className="text-xs text-gray-500">{fmt(doc.category)}</span>
                            <span className="text-[0.65rem] text-gray-400">·</span>
                            <span className="text-xs text-gray-400">{fmtSize(doc.fileSize)}</span>
                            <span className="text-[0.65rem] text-gray-400">·</span>
                            <span className="text-xs text-gray-400">{fmtDate(doc.createdAt)}</span>
                          </div>
                        </div>

                        {/* Review status badge */}
                        <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[0.68rem] font-semibold ${REVIEW_BADGE[doc.reviewStatus] || REVIEW_BADGE.pending}`}>
                          {fmt(doc.reviewStatus || 'pending')}
                        </span>

                        {/* Actions */}
                        <div className="flex items-center gap-1 shrink-0">
                          {/* Preview / Open */}
                          <button
                            type="button"
                            onClick={() => setViewingDoc(doc)}
                            className="flex items-center gap-1 rounded-lg bg-gray-50 border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition"
                            title="View document"
                          >
                            <Eye className="h-3.5 w-3.5" /> View
                          </button>

                          {/* Review actions for staff */}
                          {canReview && doc.reviewStatus !== 'approved' && (
                            <button
                              type="button"
                              onClick={() => reviewDocument(doc._id, 'approved')}
                              className="rounded-lg bg-green-50 border border-green-200 px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 transition"
                              title="Approve document"
                            >
                              Approve
                            </button>
                          )}
                          {canReview && !['rejected','needs_revision'].includes(doc.reviewStatus) && (
                            <button
                              type="button"
                              onClick={() => reviewDocument(doc._id, 'needs_revision')}
                              className="rounded-lg bg-orange-50 border border-orange-200 px-2.5 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100 transition"
                              title="Request revision"
                            >
                              Revise
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </>
  )
}

export default Documents
