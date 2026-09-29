import { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { formGovernanceApi } from '../services/api'
import { associationLabel } from './FormGovernance'
import UploadFormModal from '../components/UploadFormModal'
import { ArrowLeft, ExternalLink, Wand2, CheckCircle2, RefreshCw, PlayCircle, Plus, Upload } from 'lucide-react'

const readErrorMessage = (error, fallback) => {
  const message = error?.response?.data?.message
  return typeof message === 'string' && message.trim() ? message : fallback
}

const Badge = ({ tone = 'gray', children }) => {
  const tones = {
    green: 'bg-green-100 text-green-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-800',
    gray: 'bg-gray-100 text-gray-700',
  }
  return <span className={`px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap ${tones[tone] || tones.gray}`}>{children}</span>
}

const FormGovernanceDetail = () => {
  const { formCode } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = ['super_admin', 'admin'].includes(user?.role)

  const [catalogEntry, setCatalogEntry] = useState(null)
  const [graph, setGraph] = useState(null)
  const [mappingStatus, setMappingStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [banner, setBanner] = useState(null)
  const [savingFieldId, setSavingFieldId] = useState(null)
  const [busy, setBusy] = useState(false)

  const [previewCaseId, setPreviewCaseId] = useState('')
  const [previewValues, setPreviewValues] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState(null)

  const [defects, setDefects] = useState(null)

  const [visaOptions, setVisaOptions] = useState([])
  const [showAddCaseType, setShowAddCaseType] = useState(false)
  const [newVisaType, setNewVisaType] = useState('')
  const [newAssignmentType, setNewAssignmentType] = useState('AUTO_CREATE')
  const [addingCaseType, setAddingCaseType] = useState(false)
  const [addCaseTypeError, setAddCaseTypeError] = useState(null)
  const [showReplace, setShowReplace] = useState(false)
  // Which edition this page is actively reviewing - the live/active one by
  // default, or the newer draft ("Replace Form" and edition-change scans
  // both leave the prior active template untouched, so a fresh, un-reviewed
  // draft can sit alongside it under the same formCode).
  const [viewPending, setViewPending] = useState(false)
  const [checklistTrace, setChecklistTrace] = useState(null)

  const load = useCallback(async () => {
    try {
      const catalog = await formGovernanceApi.catalog()
      const entry = (catalog.data.data || []).find((form) => form.formCode === formCode)
      if (!entry) { setError(`${formCode} was not found in the form catalog.`); setLoading(false); return }
      setCatalogEntry(entry)
      const targetTemplateId = viewPending && entry.pendingTemplateId ? entry.pendingTemplateId : entry.templateId
      if (!targetTemplateId) { setError(`${formCode} has not been fetched from uscis.gov yet — go back and fetch it first.`); setLoading(false); return }
      const preview = await formGovernanceApi.mappingPreview(targetTemplateId)
      setGraph(preview.data.graph)
      setMappingStatus(preview.data.template.mappingStatus)
      setError(null)
      try {
        const trace = await formGovernanceApi.checklistTraceFields(targetTemplateId)
        const byTarget = new Map((trace.data.fields || []).map((row) => [row.targetFieldId, row.checklistMatches || []]))
        setChecklistTrace(byTarget)
      } catch (err) {
        setChecklistTrace(new Map())
      }
      try {
        const defectsResponse = await formGovernanceApi.governanceDefects(targetTemplateId)
        setDefects(defectsResponse.data)
      } catch (err) {
        setDefects(null)
      }
    } catch (err) {
      setError(readErrorMessage(err, 'Unable to load this form.'))
    } finally {
      setLoading(false)
    }
  }, [formCode, viewPending])

  useEffect(() => { load() }, [load])

  const viewedTemplateId = viewPending && catalogEntry?.pendingTemplateId ? catalogEntry.pendingTemplateId : catalogEntry?.templateId
  const viewedTemplateStatus = viewPending && catalogEntry?.pendingTemplateId ? catalogEntry.pendingTemplateStatus : catalogEntry?.templateStatus
  const viewedApprovedAt = viewPending && catalogEntry?.pendingTemplateId ? catalogEntry.pendingApprovedAt : catalogEntry?.approvedAt

  const openAddCaseType = async () => {
    setShowAddCaseType(true)
    setAddCaseTypeError(null)
    if (visaOptions.length) return
    try {
      const response = await formGovernanceApi.visaRegistry()
      setVisaOptions(response.data.visaTypes || [])
    } catch (err) {
      setAddCaseTypeError(readErrorMessage(err, 'Could not load the visa type list.'))
    }
  }

  const submitAddCaseType = async () => {
    if (!catalogEntry?.templateId || !newVisaType) return
    setAddingCaseType(true)
    setAddCaseTypeError(null)
    try {
      await formGovernanceApi.addCaseType(catalogEntry.templateId, { visaType: newVisaType, provisioningType: newAssignmentType })
      setShowAddCaseType(false)
      setNewVisaType('')
      setBanner({ tone: 'green', message: `${formCode} is now mapped to ${newVisaType} (${newAssignmentType === 'AUTO_CREATE' ? 'Automatic' : 'Conditional'}).` })
      await load()
    } catch (err) {
      setAddCaseTypeError(readErrorMessage(err, 'Could not add this case type.'))
    } finally {
      setAddingCaseType(false)
    }
  }

  const fieldsWithMapping = useMemo(() => {
    if (!graph) return []
    const edgesByTarget = new Map((graph.edges || []).map((edge) => [edge.targetFieldId, edge]))
    return (graph.nodes?.form || []).map((field) => ({ field, edge: edgesByTarget.get(field.fieldId) }))
  }, [graph])

  const canonicalOptions = graph?.nodes?.canonical || []

  // Phase 3H per-field defect flags - reuses governanceDefects(templateId)'s
  // read-only result, resolving each defect's mappingId (when it has one,
  // not a targetFieldId directly) to a field via the graph's own edges, so
  // the same defect data both this per-field column and the summary panel
  // below use is never re-derived twice.
  const defectsByField = useMemo(() => {
    const map = new Map()
    if (!defects || !graph) return map
    const targetByMappingId = new Map((graph.edges || []).map((edge) => [edge.mappingId, edge.targetFieldId]))
    const add = (targetFieldId, defect) => {
      if (!targetFieldId) return
      if (!map.has(targetFieldId)) map.set(targetFieldId, [])
      map.get(targetFieldId).push(defect)
    }
    defects.defects.forEach((defect) => {
      const targetFieldId = defect.targetFieldId || defect.detail?.targetFieldId || (defect.detail?.mappingId ? targetByMappingId.get(defect.detail.mappingId) : null)
      add(targetFieldId, defect)
    })
    return map
  }, [defects, graph])

  const runAutoSuggest = async () => {
    if (!viewedTemplateId) return
    setBusy(true)
    setBanner(null)
    try {
      const response = await formGovernanceApi.generateMapping(viewedTemplateId, true)
      setGraph(response.data.graph)
      setBanner({ tone: 'green', message: `Auto-suggested mappings for ${response.data.graph.summary.mappedFields} of ${response.data.graph.summary.formFields} fields.` })
    } catch (err) {
      setBanner({ tone: 'red', message: readErrorMessage(err, 'Could not auto-suggest mappings.') })
    } finally {
      setBusy(false)
    }
  }

  const saveMapping = async (targetFieldId, sourcePath) => {
    if (!viewedTemplateId) return
    setSavingFieldId(targetFieldId)
    setBanner(null)
    try {
      const response = await formGovernanceApi.upsertMapping(viewedTemplateId, targetFieldId, { sourcePath })
      setGraph(response.data.graph)
    } catch (err) {
      setBanner({ tone: 'red', message: readErrorMessage(err, 'Could not save that mapping.') })
    } finally {
      setSavingFieldId(null)
    }
  }

  const activateMapping = async () => {
    if (!viewedTemplateId) return
    setBusy(true)
    setBanner(null)
    try {
      await formGovernanceApi.activateMapping(viewedTemplateId)
      setBanner({ tone: 'green', message: 'Mapping activated — this form now autofills fully from case data.' })
      await load()
    } catch (err) {
      setBanner({ tone: 'red', message: readErrorMessage(err, 'Could not activate — resolve the errors below first.') })
    } finally {
      setBusy(false)
    }
  }

  const approveTemplate = async () => {
    if (!viewedTemplateId) return
    setBusy(true)
    setBanner(null)
    try {
      await formGovernanceApi.approveTemplate(viewedTemplateId)
      setBanner({ tone: 'green', message: `${formCode}'s current edition is approved. It can now be activated once its mapping is fully active too.` })
      await load()
    } catch (err) {
      setBanner({ tone: 'red', message: readErrorMessage(err, 'Could not approve this USCIS edition.') })
    } finally {
      setBusy(false)
    }
  }

  const activateTemplate = async () => {
    if (!viewedTemplateId) return
    setBusy(true)
    setBanner(null)
    try {
      await formGovernanceApi.activateTemplate(viewedTemplateId)
      setBanner({ tone: 'green', message: `${formCode} edition is now active and ready for real cases.` })
      // The just-activated edition is now the active one - switch off
      // "viewing the pending draft" so the page (and its dependent load()
      // effect) reloads against it as the new active template.
      setViewPending(false)
    } catch (err) {
      setBanner({ tone: 'red', message: readErrorMessage(err, 'Could not activate this USCIS edition — approve it first, and make sure the mapping is fully active.') })
    } finally {
      setBusy(false)
    }
  }

  const openPdf = async () => {
    if (!viewedTemplateId) return
    try {
      const response = await formGovernanceApi.templateUrl(viewedTemplateId)
      const base = new URL(response.config?.baseURL || '', window.location.origin)
      window.open(`${base.origin}${response.data.url}`, '_blank', 'noopener')
    } catch (err) {
      setBanner({ tone: 'red', message: readErrorMessage(err, 'Could not open this PDF.') })
    }
  }

  const runAutofillPreview = async () => {
    if (!viewedTemplateId || !previewCaseId.trim()) return
    setPreviewLoading(true)
    setPreviewError(null)
    setPreviewValues(null)
    try {
      const response = await formGovernanceApi.autofillPreview(viewedTemplateId, previewCaseId.trim())
      setPreviewValues(response.data.fieldValues || {})
    } catch (err) {
      setPreviewError(readErrorMessage(err, 'Could not preview autofill for that case.'))
    } finally {
      setPreviewLoading(false)
    }
  }

  if (loading) return <div className="text-muted-foreground">Loading...</div>

  return (
    <div className="space-y-6">
      <button onClick={() => navigate('/form-governance')} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Back to Form Governance
      </button>

      <div>
        <h1 className="text-2xl font-bold text-foreground">{formCode}</h1>
        <p className="text-muted-foreground mt-1">{catalogEntry?.title}</p>
      </div>

      {error ? (
        <div className="card text-center py-12"><p className="text-muted-foreground">{error}</p></div>
      ) : (
        <>
          {banner && (
            <div className={`card ${banner.tone === 'red' ? 'border-red-300' : 'border-green-300'}`}>
              <p className={banner.tone === 'red' ? 'text-red-700' : 'text-green-700'}>{banner.message}</p>
            </div>
          )}

          {catalogEntry?.pendingTemplateId && (
            <div className="card border-amber-300 flex flex-wrap items-center gap-3">
              <p className="text-amber-800 text-sm">
                {viewPending
                  ? `You're viewing the newer, not-yet-active draft edition. The prior edition stays in service for real cases until this one is approved and activated.`
                  : `A newer draft edition of ${formCode} is awaiting review (uploaded via Replace Form or an edition-change check). The edition below is still the one in service.`}
              </p>
              <div className="flex-1" />
              <button onClick={() => setViewPending(!viewPending)} className="btn-secondary text-sm shrink-0">
                {viewPending ? 'View active edition' : 'Review the pending edition'}
              </button>
            </div>
          )}

          <div className="card flex flex-wrap items-center gap-3">
            <Badge tone={viewedTemplateStatus === 'active' ? 'green' : 'amber'}>Edition: {viewedTemplateStatus}</Badge>
            <Badge tone={mappingStatus === 'active' ? 'green' : 'amber'}>Mapping: {mappingStatus}</Badge>
            {graph?.validation && (
              <Badge tone={graph.validation.readyForActivation ? 'green' : 'amber'}>
                {graph.summary?.mappedFields}/{graph.summary?.formFields} fields mapped
                {graph.validation.summary.unmapped ? ` · ${graph.validation.summary.unmapped} unmapped` : ''}
                {graph.validation.summary.reviewRequired ? ` · ${graph.validation.summary.reviewRequired} need review` : ''}
              </Badge>
            )}
            <div className="flex-1" />
            <button onClick={openPdf} className="btn-secondary text-sm flex items-center gap-1"><ExternalLink className="w-4 h-4" /> Open PDF</button>
            {isAdmin && (
              <button onClick={() => setShowReplace(true)} className="btn-secondary text-sm flex items-center gap-1" title="Upload a new PDF for this same form (e.g. a new USCIS edition) — existing case-type mappings keep working automatically">
                <Upload className="w-4 h-4" /> Replace Form
              </button>
            )}
            <button onClick={runAutoSuggest} disabled={busy} className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
              <Wand2 className="w-4 h-4" /> Auto-suggest mappings
            </button>
            <button
              onClick={activateMapping}
              disabled={busy || !graph?.validation?.readyForActivation || mappingStatus === 'active'}
              className="btn-primary text-sm flex items-center gap-1 disabled:opacity-50"
              title={!graph?.validation?.readyForActivation ? 'Every field must be mapped before approving' : ''}
            >
              <CheckCircle2 className="w-4 h-4" /> Approve mapping
            </button>
          </div>

          {/* This USCIS edition itself — separate from the field mapping above.
              Approve records a human sign-off on this specific edition; Activate
              (which requires that sign-off, and a fully-active mapping) is what
              actually puts it into service for real cases. Both admin-only —
              this is the step that makes a form trusted for legal filings. */}
          {isAdmin && (
            <div className="card flex flex-wrap items-center gap-3">
              <div>
                <div className="font-medium text-foreground">Approve this form for legal use</div>
                <p className="text-sm text-muted-foreground">
                  {viewedTemplateStatus === 'active'
                    ? 'This edition is approved and active — it is in service for real cases.'
                    : viewedApprovedAt
                      ? 'Edition approved. Activate once its mapping is fully approved too.'
                      : 'Approve this USCIS edition, then activate it once its mapping is fully approved.'}
                </p>
              </div>
              <div className="flex-1" />
              {!viewedApprovedAt && viewedTemplateStatus !== 'active' && (
                <button onClick={approveTemplate} disabled={busy} className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
                  <CheckCircle2 className="w-4 h-4" /> Approve edition
                </button>
              )}
              {viewedTemplateStatus !== 'active' && (
                <button
                  onClick={activateTemplate}
                  disabled={busy || !viewedApprovedAt || mappingStatus !== 'active'}
                  className="btn-primary text-sm flex items-center gap-1 disabled:opacity-50"
                  title={!viewedApprovedAt ? 'Approve the edition first' : mappingStatus !== 'active' ? 'Approve the mapping first' : ''}
                >
                  <RefreshCw className="w-4 h-4" /> Activate for real cases
                </button>
              )}
            </div>
          )}

          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-foreground">Used by these case types</h2>
              {isAdmin && !showAddCaseType && (
                <button onClick={openAddCaseType} className="btn-secondary text-sm flex items-center gap-1"><Plus className="w-4 h-4" /> Add case type</button>
              )}
            </div>
            {catalogEntry?.associations?.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground uppercase">
                      <th className="pr-4 py-1">Case type</th>
                      <th className="pr-4 py-1">Assignment</th>
                      <th className="pr-4 py-1">Checklist(s) sent to the client</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catalogEntry.associations.map((assoc, index) => (
                      <tr key={`${assoc.visaType}-${index}`} className="border-t">
                        <td className="pr-4 py-2 font-medium text-foreground whitespace-nowrap">{assoc.visaType}</td>
                        <td className="pr-4 py-2 whitespace-nowrap">{associationLabel(assoc)}</td>
                        <td className="pr-4 py-2">
                          {assoc.checklistMappings?.length ? (
                            <div className="flex flex-wrap gap-1">
                              {assoc.checklistMappings.map((cl) => (
                                <span
                                  key={cl.checklistKey}
                                  className={`px-2 py-0.5 rounded text-xs ${cl.assignmentType === 'AUTO' ? 'bg-green-100 text-green-800' : cl.assignmentType === 'CONDITIONAL' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}
                                  title={cl.assignmentType === 'AUTO' ? 'Sent automatically at case creation' : cl.assignmentType === 'CONDITIONAL' ? 'Sent only when its condition is met' : 'Never automatic - a case manager adds it'}
                                >
                                  {cl.checklistKey}{cl.role ? ` (${cl.role})` : ''} · {cl.assignmentType}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">No checklist mapped yet</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">No case types are mapped to this form yet.</span>
            )}

            {showAddCaseType && (
              <div className="mt-4 pt-4 border-t flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Case type / visa</label>
                  <select value={newVisaType} onChange={(e) => setNewVisaType(e.target.value)} className="border rounded px-3 py-2 text-sm w-56">
                    <option value="">Select a visa type...</option>
                    {visaOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Assignment</label>
                  <select value={newAssignmentType} onChange={(e) => setNewAssignmentType(e.target.value)} className="border rounded px-3 py-2 text-sm w-48">
                    <option value="AUTO_CREATE">Automatic — created on the case immediately</option>
                    <option value="CONDITIONAL">Conditional — created only when it applies</option>
                  </select>
                </div>
                <button onClick={submitAddCaseType} disabled={addingCaseType || !newVisaType} className="btn-primary text-sm disabled:opacity-50">
                  {addingCaseType ? 'Saving...' : 'Save'}
                </button>
                <button onClick={() => setShowAddCaseType(false)} className="btn-secondary text-sm">Cancel</button>
              </div>
            )}
            {addCaseTypeError && <p className="text-red-700 text-sm mt-2">{addCaseTypeError}</p>}
          </div>

          {defects && (defects.defects.length > 0 || defects.intentionalGaps.length > 0) && (
            <div className="card">
              <h2 className="font-semibold text-foreground mb-1">Governance defects</h2>
              <p className="text-sm text-muted-foreground mb-3">
                Read-only diagnostics for this form's real registry rows and mapping graph — nothing here can be
                auto-fixed from this page. Intentional, documented gaps (checklistMappings.seed.js's own scope
                notes) are shown separately from genuine defects.
              </p>
              {defects.defects.length > 0 && (
                <div className="mb-3">
                  <div className="flex flex-wrap gap-2">
                    {defects.defects.map((d, i) => (
                      <span key={i} className="px-2 py-1 text-xs rounded bg-red-100 text-red-800" title={JSON.stringify(d.detail || d)}>
                        {d.category}{d.visaType ? ` · ${d.visaType}` : ''}{d.checklistKey ? ` · ${d.checklistKey}` : ''}{d.questionKey ? ` · ${d.questionKey}` : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {defects.intentionalGaps.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground uppercase mb-1">Intentional gaps (not defects)</div>
                  <div className="flex flex-wrap gap-2">
                    {defects.intentionalGaps.map((g, i) => (
                      <span key={i} className="px-2 py-1 text-xs rounded bg-gray-100 text-gray-700">
                        {g.category}{g.visaType ? ` · ${g.visaType}` : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="px-2 pb-3">
              <h2 className="font-semibold text-foreground">Field mapping</h2>
              <p className="text-sm text-muted-foreground">Each row is one field on the PDF. Choose which piece of case data should fill it in. "Auto-suggest" fills these in automatically where it's confident; anything left blank or marked "needs review" should be checked by a human before activating.</p>
            </div>
            <div className="overflow-x-auto max-h-[32rem] overflow-y-auto">
              <table className="min-w-full">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Field</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Section / Page</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Mapped to</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Status</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Checklist source</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Defects</th>
                  </tr>
                </thead>
                <tbody>
                  {fieldsWithMapping.map(({ field, edge }) => (
                    <tr key={field.fieldId} className="border-b hover:bg-muted">
                      <td className="px-4 py-2">
                        <div className="font-medium text-foreground text-sm">{field.label}</div>
                        {field.required && <span className="text-xs text-red-600">Required</span>}
                      </td>
                      <td className="px-4 py-2 text-sm text-muted-foreground whitespace-nowrap">{field.section}{field.pageNumber ? ` · p.${field.pageNumber}` : ''}</td>
                      <td className="px-4 py-2">
                        <select
                          value={edge?.sourcePath || ''}
                          onChange={(e) => saveMapping(field.fieldId, e.target.value)}
                          disabled={savingFieldId === field.fieldId}
                          className="w-full max-w-xs border rounded px-2 py-1 text-sm"
                        >
                          <option value="">— not mapped —</option>
                          {canonicalOptions.map((option) => (
                            <option key={option.path} value={option.path}>{option.path}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        {edge ? (
                          <Badge tone={edge.status === 'active' ? 'green' : 'amber'}>{edge.status === 'active' ? 'Mapped' : 'Needs review'}</Badge>
                        ) : (
                          <Badge tone="gray">Unmapped</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {(() => {
                          const matches = checklistTrace?.get(field.fieldId) || []
                          if (!matches.length) return <span className="text-xs text-muted-foreground">—</span>
                          return (
                            <div className="flex flex-col gap-0.5">
                              {matches.slice(0, 3).map((match, index) => (
                                <span key={index} className="text-xs text-foreground" title={match.questionnaireTitle}>
                                  {match.questionnaireKey}: {match.label}
                                </span>
                              ))}
                              {matches.length > 3 && (
                                <span className="text-xs text-muted-foreground">+{matches.length - 3} more</span>
                              )}
                            </div>
                          )
                        })()}
                      </td>
                      <td className="px-4 py-2">
                        {(() => {
                          const fieldDefects = defectsByField.get(field.fieldId) || []
                          if (!fieldDefects.length) return <span className="text-xs text-muted-foreground">—</span>
                          return (
                            <div className="flex flex-col gap-0.5">
                              {fieldDefects.map((d, i) => (
                                <span key={i} className="text-xs text-red-700" title={d.category}>{d.code || d.category}</span>
                              ))}
                            </div>
                          )
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2 className="font-semibold text-foreground">Preview autofill on a real case</h2>
            <p className="text-sm text-muted-foreground mt-1 mb-3">Paste a Case ID (visible in that case's URL) to see what this form's fields would be filled in with, without changing anything.</p>
            <div className="flex flex-wrap gap-2 items-center">
              <input
                type="text"
                placeholder="Case ID"
                value={previewCaseId}
                onChange={(e) => setPreviewCaseId(e.target.value)}
                className="border rounded px-3 py-2 text-sm w-72"
              />
              <button onClick={runAutofillPreview} disabled={previewLoading || !previewCaseId.trim()} className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
                <PlayCircle className="w-4 h-4" /> Preview
              </button>
            </div>
            {previewError && <p className="text-red-700 text-sm mt-3">{previewError}</p>}
            {previewValues && (
              <div className="mt-4 overflow-x-auto max-h-96 overflow-y-auto border rounded">
                <table className="min-w-full">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Field</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase">Value that would be filled in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(previewValues).length ? Object.entries(previewValues).map(([fieldId, value]) => (
                      <tr key={fieldId} className="border-b">
                        <td className="px-4 py-2 text-sm text-foreground">{fieldId}</td>
                        <td className="px-4 py-2 text-sm text-muted-foreground">{String(value ?? '')}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={2} className="px-4 py-6 text-center text-muted-foreground text-sm">No fields would be filled in for this case with the current mapping.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {showReplace && (
        <UploadFormModal
          lockedFormCode={formCode}
          onClose={() => setShowReplace(false)}
          onPublished={({ duplicate, comparisonReport }) => {
            setShowReplace(false)
            setBanner({
              tone: 'green',
              message: duplicate
                ? 'That exact file is already registered — nothing new was created.'
                : `A new draft edition of ${formCode} was published${comparisonReport ? ` (${comparisonReport.summary?.changed ?? 0} field change(s) detected vs. the current edition)` : ''}. Review its mapping and approve/activate it below when ready.`,
            })
            load()
          }}
        />
      )}
    </div>
  )
}

export default FormGovernanceDetail
