import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { formGovernanceApi } from '../services/api'
import UploadFormModal from '../components/UploadFormModal'
import { FileCheck2, Search, Download, ExternalLink, RefreshCw, Upload } from 'lucide-react'

const readErrorMessage = (error, fallback) => {
  const message = error?.response?.data?.message
  return typeof message === 'string' && message.trim() ? message : fallback
}

// Small, consistent color-coded pill - every status chip on this page uses
// the same handful of tones so the page stays scannable without a legend.
const Badge = ({ tone = 'gray', children }) => {
  const tones = {
    green: 'bg-green-100 text-green-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-800',
    gray: 'bg-gray-100 text-gray-700',
    blue: 'bg-blue-100 text-blue-800',
  }
  return <span className={`px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap ${tones[tone] || tones.gray}`}>{children}</span>
}

const FETCH_STATUS_LABELS = {
  fetched: { label: 'Fetched', tone: 'green' },
  not_fetched: { label: 'Not fetched', tone: 'amber' },
  not_fetchable: { label: 'Not a USCIS PDF', tone: 'gray' },
  fetch_failed: { label: 'Fetch failed', tone: 'red' },
}

const TEMPLATE_STATUS_TONES = { active: 'green', review: 'amber', draft: 'amber', pending_review: 'amber', retired: 'gray', archived: 'gray' }
const MAPPING_STATUS_LABELS = {
  active: { label: 'Fully mapped', tone: 'green' },
  biographic_active: { label: 'Basic autofill only', tone: 'amber' },
  needs_review: { label: 'Needs review', tone: 'amber' },
  draft: { label: 'Draft mapping', tone: 'amber' },
  unmapped: { label: 'Not mapped', tone: 'gray' },
  archived: { label: 'Archived', tone: 'gray' },
}

// Every VisaFormMapping.provisioningType shown in plain operator language -
// AUTO_CREATE is "Automatic", CONDITIONAL/LATER_STAGE both read as
// "Conditional" (both mean a human/case-stage decides when it applies),
// REFERENCE/NOT_APPLICABLE are called out explicitly rather than folded
// into "Conditional", which would misstate them.
export const associationLabel = (assoc) => {
  if (assoc.automatic) return 'Automatic'
  if (assoc.provisioningType === 'NOT_APPLICABLE') return 'Not applicable'
  if (assoc.provisioningType === 'REFERENCE') return 'Reference only'
  return 'Conditional'
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'fetched', label: 'Fetched' },
  { key: 'not_fetched', label: 'Not fetched' },
  { key: 'fetch_failed', label: 'Fetch failed' },
  { key: 'not_fetchable', label: 'Not a USCIS PDF' },
]

const FormGovernance = () => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = ['super_admin', 'admin'].includes(user?.role)
  const [forms, setForms] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [fetchingCode, setFetchingCode] = useState(null)
  const [fetchResult, setFetchResult] = useState(null)
  const [showUpload, setShowUpload] = useState(false)
  const [coverage, setCoverage] = useState(null)
  const [coverageLoading, setCoverageLoading] = useState(false)
  const [showCoverage, setShowCoverage] = useState(false)
  const [health, setHealth] = useState(null)
  const [healthLoading, setHealthLoading] = useState(false)
  const [showHealth, setShowHealth] = useState(false)
  const [healthFilter, setHealthFilter] = useState('all')

  const loadCoverage = async () => {
    setShowCoverage(true)
    if (coverage) return
    setCoverageLoading(true)
    try {
      const response = await formGovernanceApi.checklistTraceCoverageAll()
      setCoverage(response.data.results || [])
    } catch (err) {
      setCoverage([])
    } finally {
      setCoverageLoading(false)
    }
  }

  // Phase 3I "Checklist Health" - one row per production checklist/
  // questionnaire, read-only, reusing ChecklistFieldTraceabilityService.
  // checklistHealth() (never a parallel diagnostics system).
  const loadHealth = async () => {
    setShowHealth(true)
    if (health) return
    setHealthLoading(true)
    try {
      const response = await formGovernanceApi.checklistHealth()
      setHealth(response.data.rows || [])
    } catch (err) {
      setHealth([])
    } finally {
      setHealthLoading(false)
    }
  }

  const HEALTH_FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'orphan', label: 'Orphans' },
    { key: 'scaffold', label: 'Scaffold-only' },
    { key: 'notLive', label: 'Not on a live workflow' },
    { key: 'invalidPaths', label: 'Invalid canonical paths' },
    { key: 'noConsumer', label: 'No form consumer' },
  ]

  const filteredHealth = useMemo(() => {
    if (!health) return []
    switch (healthFilter) {
      case 'orphan': return health.filter((r) => r.orphan)
      case 'scaffold': return health.filter((r) => r.scaffold)
      case 'notLive': return health.filter((r) => r.notAssignedToLiveWorkflow)
      case 'invalidPaths': return health.filter((r) => r.invalidCanonicalPaths?.length)
      case 'noConsumer': return health.filter((r) => r.canonicalFieldsNoConsumer?.length)
      default: return health
    }
  }, [health, healthFilter])

  const load = async () => {
    try {
      const response = await formGovernanceApi.catalog()
      setForms(response.data.data || [])
      setError(null)
    } catch (err) {
      setError(readErrorMessage(err, 'Unable to load the form catalog.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return forms.filter((form) => {
      if (filter !== 'all' && form.fetchStatus !== filter) return false
      if (!term) return true
      return form.formCode.toLowerCase().includes(term) || (form.title || '').toLowerCase().includes(term)
    })
  }, [forms, search, filter])

  const openPdf = async (form) => {
    try {
      if (form.isSupplement) {
        // Supplements share the parent's template but have their own
        // sliced-out pages - there's no signed-URL route for a slice, only
        // a direct (blob) download, so open it via an object URL instead.
        const response = await formGovernanceApi.componentPdf(form.templateId, form.componentCode)
        const blobUrl = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }))
        window.open(blobUrl, '_blank', 'noopener')
        return
      }
      const response = await formGovernanceApi.templateUrl(form.templateId)
      const base = new URL(response.config?.baseURL || '', window.location.origin)
      window.open(`${base.origin}${response.data.url}`, '_blank', 'noopener')
    } catch (err) {
      setFetchResult({ tone: 'red', message: readErrorMessage(err, 'Could not open this PDF.') })
    }
  }

  const fetchFromUscis = async (formCode) => {
    setFetchingCode(formCode)
    setFetchResult(null)
    try {
      const response = await formGovernanceApi.fetchFromUSCIS(formCode)
      const { requiresActivation, biographicReady, activationBlockedReason } = response.data.data
      setFetchResult({
        tone: 'green',
        message: requiresActivation
          ? `${formCode} was fetched from uscis.gov. ${biographicReady ? 'Basic autofill is enabled — ' : ''}${activationBlockedReason || 'A field-mapping review is still required before it fully activates.'}`
          : `${formCode} was fetched and is already fully active.`,
      })
      await load()
    } catch (err) {
      setFetchResult({ tone: 'red', message: readErrorMessage(err, `Could not fetch ${formCode} from uscis.gov.`) })
    } finally {
      setFetchingCode(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><FileCheck2 className="w-6 h-6" /> Form Governance</h1>
          <p className="text-muted-foreground mt-1">Every USCIS form this system knows about — whether it's been fetched from uscis.gov, how it's mapped and autofilled, and which visa types use it.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => (showCoverage ? setShowCoverage(false) : loadCoverage())}
            className="btn-secondary text-sm flex items-center gap-1 shrink-0"
          >
            <FileCheck2 className="w-4 h-4" /> {showCoverage ? 'Hide' : 'Show'} Checklist Coverage
          </button>
          <button
            onClick={() => (showHealth ? setShowHealth(false) : loadHealth())}
            className="btn-secondary text-sm flex items-center gap-1 shrink-0"
          >
            <FileCheck2 className="w-4 h-4" /> {showHealth ? 'Hide' : 'Show'} Checklist Health
          </button>
          {isAdmin && (
            <button onClick={() => setShowUpload(true)} className="btn-primary text-sm flex items-center gap-1 shrink-0">
              <Upload className="w-4 h-4" /> Upload Form
            </button>
          )}
        </div>
      </div>

      {showCoverage && (
        <div className="card">
          <h2 className="text-lg font-semibold text-foreground mb-1">Checklist Traceability Coverage — All Forms</h2>
          <p className="text-sm text-muted-foreground mb-3">
            For every active USCIS form template, how many of its mapped PDF fields trace back to a real checklist
            question (Immiglance/Client questionnaire), across every visa type and checklist in the registry — not
            just one form.
          </p>
          {coverageLoading ? (
            <p className="text-sm text-muted-foreground">Loading coverage…</p>
          ) : !coverage || coverage.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active form templates found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4">Form</th>
                    <th className="py-2 pr-4">Checklists mapped</th>
                    <th className="py-2 pr-4">Mapped PDF fields</th>
                    <th className="py-2 pr-4">Traced to a checklist question</th>
                    <th className="py-2 pr-4">Mapped, no checklist question</th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.map((row) => (
                    <tr key={row.templateId || row.formCode} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">
                        {row.error ? (
                          <span>{row.formCode || row.title}</span>
                        ) : (
                          <button className="text-blue-600 hover:underline" onClick={() => navigate(`/form-governance/${row.formCode}`)}>
                            {row.formCode} — {row.title}
                          </button>
                        )}
                      </td>
                      {row.error ? (
                        <td colSpan={4} className="py-2 text-red-600">{row.error}</td>
                      ) : (
                        <>
                          <td className="py-2 pr-4">
                            {row.checklistKeys?.length ? <Badge tone="blue">{row.checklistKeys.length}</Badge> : <Badge tone="gray">0</Badge>}
                          </td>
                          <td className="py-2 pr-4">{row.totalMappedFields}</td>
                          <td className="py-2 pr-4">
                            <Badge tone={row.tracedToChecklistQuestion > 0 ? 'green' : 'gray'}>{row.tracedToChecklistQuestion}</Badge>
                          </td>
                          <td className="py-2 pr-4">
                            <Badge tone={row.mappedWithNoChecklistQuestion > 0 ? 'amber' : 'gray'}>{row.mappedWithNoChecklistQuestion}</Badge>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showHealth && (
        <div className="card">
          <h2 className="text-lg font-semibold text-foreground mb-1">Checklist Health — Every Production Checklist</h2>
          <p className="text-sm text-muted-foreground mb-3">
            One row per questionnaire (latest version): which visa(s)/form(s) it applies to, how much of it is
            canonically mapped, and whether it's an orphan, scaffold-only, or otherwise not wired into a live
            case-creation path. Read-only — nothing here can be fixed from this page.
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            {HEALTH_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setHealthFilter(f.key)}
                className={`px-3 py-1.5 text-sm rounded-lg border ${healthFilter === f.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-muted-foreground border-gray-200 hover:bg-muted'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          {healthLoading ? (
            <p className="text-sm text-muted-foreground">Loading checklist health…</p>
          ) : !filteredHealth.length ? (
            <p className="text-sm text-muted-foreground">No checklists match this filter.</p>
          ) : (
            <div className="overflow-x-auto max-h-[36rem] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4">Checklist</th>
                    <th className="py-2 pr-4">Participant</th>
                    <th className="py-2 pr-4">Applies to</th>
                    <th className="py-2 pr-4">Questions</th>
                    <th className="py-2 pr-4">Canonical / Unmapped</th>
                    <th className="py-2 pr-4">Conditional sections</th>
                    <th className="py-2 pr-4">Documents</th>
                    <th className="py-2 pr-4">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHealth.map((row) => (
                    <tr key={row.key} className="border-b last:border-0 align-top">
                      <td className="py-2 pr-4">
                        <div className="font-medium">{row.key}</div>
                        <div className="text-xs text-muted-foreground max-w-xs truncate">{row.title}</div>
                        <Badge tone={row.active ? 'green' : 'gray'}>{row.active ? 'Active' : 'Inactive'}</Badge>
                      </td>
                      <td className="py-2 pr-4 whitespace-nowrap">{row.checklistRole || '—'}</td>
                      <td className="py-2 pr-4">
                        {row.applicable.length ? (
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {row.applicable.slice(0, 3).map((a, i) => (
                              <span key={i} className="px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-700 whitespace-nowrap">{a.visaType} · {a.formNumber}</span>
                            ))}
                            {row.applicable.length > 3 && <span className="text-xs text-muted-foreground">+{row.applicable.length - 3} more</span>}
                          </div>
                        ) : <span className="text-muted-foreground">None</span>}
                      </td>
                      <td className="py-2 pr-4">{row.questionCount}</td>
                      <td className="py-2 pr-4">
                        <Badge tone={row.canonicalMappingCount > 0 ? 'green' : 'gray'}>{row.canonicalMappingCount}</Badge>
                        {' / '}
                        <Badge tone={row.unmappedQuestionCount > 0 ? 'amber' : 'gray'}>{row.unmappedQuestionCount}</Badge>
                      </td>
                      <td className="py-2 pr-4">{row.conditionalSectionCount}</td>
                      <td className="py-2 pr-4">{row.documentRequirementCount}</td>
                      <td className="py-2 pr-4">
                        <div className="flex flex-wrap gap-1 max-w-[16rem]">
                          {row.orphan && <Badge tone="red">Orphan</Badge>}
                          {row.scaffold && <Badge tone="amber">Scaffold</Badge>}
                          {row.notAssignedToLiveWorkflow && <Badge tone="amber">Not live</Badge>}
                          {row.directLegacyBinding && <Badge tone="blue">Direct binding</Badge>}
                          {row.invalidCanonicalPaths?.length > 0 && (
                            <Badge tone="red">{row.invalidCanonicalPaths.length} invalid path{row.invalidCanonicalPaths.length > 1 ? 's' : ''}</Badge>
                          )}
                          {row.canonicalFieldsNoConsumer?.length > 0 && (
                            <Badge tone="amber">{row.canonicalFieldsNoConsumer.length} no consumer</Badge>
                          )}
                          {!row.orphan && !row.scaffold && !row.notAssignedToLiveWorkflow && !row.invalidCanonicalPaths?.length && !row.canonicalFieldsNoConsumer?.length && (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showUpload && (
        <UploadFormModal
          onClose={() => setShowUpload(false)}
          onPublished={({ template }) => {
            setShowUpload(false)
            load()
            if (template?.formCode) navigate(`/form-governance/${template.formCode}`)
          }}
        />
      )}

      {fetchResult && (
        <div className={`card ${fetchResult.tone === 'red' ? 'border-red-300' : 'border-green-300'}`}>
          <p className={fetchResult.tone === 'red' ? 'text-red-700' : 'text-green-700'}>{fetchResult.message}</p>
        </div>
      )}

      <div className="card">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <input
                type="text"
                placeholder="Search by form code or title..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 text-sm rounded-lg border ${filter === f.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-muted-foreground border-gray-200 hover:bg-muted'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-muted-foreground">Loading forms...</div>
      ) : error ? (
        <div className="card text-center py-12">
          <p className="text-muted-foreground">{error}</p>
          <button onClick={load} className="mt-4 btn-primary">Retry</button>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-muted">
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Form</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Fetched?</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Template</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Mapping / Autofill</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Used by</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length ? filtered.map((form) => {
                  const fetchInfo = FETCH_STATUS_LABELS[form.fetchStatus] || FETCH_STATUS_LABELS.not_fetched
                  const mappingInfo = MAPPING_STATUS_LABELS[form.mappingStatus] || MAPPING_STATUS_LABELS.unmapped
                  const visibleAssociations = form.associations.slice(0, 3)
                  const remaining = form.associations.length - visibleAssociations.length
                  return (
                    <tr key={form.formCode} className="border-b hover:bg-muted">
                      <td className="px-6 py-4">
                        <div className="font-medium text-foreground flex items-center gap-2">
                          {form.formCode}
                          {form.isSupplement && <Badge tone="blue">Supplement</Badge>}
                        </div>
                        <div className="text-sm text-muted-foreground max-w-xs truncate">{form.title}</div>
                        {form.pendingTemplateId && (
                          <div className="text-xs text-amber-700 mt-0.5">A newer edition is awaiting review</div>
                        )}
                      </td>
                      <td className="px-6 py-4"><Badge tone={fetchInfo.tone}>{fetchInfo.label}</Badge></td>
                      <td className="px-6 py-4">
                        {form.templateStatus ? <Badge tone={TEMPLATE_STATUS_TONES[form.templateStatus] || 'gray'}>{form.templateStatus}</Badge> : <span className="text-muted-foreground text-sm">—</span>}
                      </td>
                      <td className="px-6 py-4"><Badge tone={mappingInfo.tone}>{mappingInfo.label}</Badge></td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {visibleAssociations.map((assoc, index) => (
                            <span key={`${assoc.visaType}-${index}`} className="px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-700 whitespace-nowrap">
                              {assoc.visaType} · {associationLabel(assoc)}
                            </span>
                          ))}
                          {remaining > 0 && <span className="text-xs text-muted-foreground">+{remaining} more</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-2">
                          {form.fetchStatus === 'fetched' && (
                            <button onClick={() => openPdf(form)} className="btn-secondary text-xs flex items-center gap-1">
                              <ExternalLink className="w-3.5 h-3.5" /> Open
                            </button>
                          )}
                          {form.templateId && (
                            <button onClick={() => navigate(`/form-governance/${form.isSupplement ? form.parentFormCode : form.formCode}`)} className="btn-secondary text-xs flex items-center gap-1">
                              Review mapping
                            </button>
                          )}
                          {/* A supplement has nothing of its own to fetch - it's
                              sliced out of its parent's PDF once the parent is
                              fetched and activated, never fetched independently. */}
                          {!form.isSupplement && form.fetchStatus !== 'fetched' && form.fetchStatus !== 'not_fetchable' && (
                            <button
                              onClick={() => fetchFromUscis(form.formCode)}
                              disabled={fetchingCode === form.formCode}
                              className="btn-primary text-xs flex items-center gap-1 disabled:opacity-50"
                            >
                              {fetchingCode === form.formCode ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                              Fetch from USCIS.gov
                            </button>
                          )}
                          {form.isSupplement && form.fetchStatus !== 'fetched' && (
                            <span className="text-xs text-muted-foreground self-center">Waiting on {form.parentFormCode}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                }) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">No forms match this filter</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default FormGovernance
