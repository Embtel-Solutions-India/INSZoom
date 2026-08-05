import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Download,
  FileCheck2,
  FileText,
  History,
  Link2,
  Lock,
  MessageSquare,
  PanelRight,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  SplitSquareHorizontal,
  Unlock,
  UserCheck,
  XCircle,
} from 'lucide-react'
import { formGenerationApi, uscisFormsApi } from '../../services/api'

const getByPath = (source, path) => {
  if (!source || !path) return undefined
  const nested = String(path).split('.').reduce((current, part) => (current == null ? undefined : current[part]), source)
  return nested !== undefined ? nested : source[path]
}

const setByPath = (source, path, value) => {
  const next = structuredClone(source || {})
  if (String(path).includes('.') && Object.prototype.hasOwnProperty.call(next, path)) delete next[path]
  const parts = String(path).split('.')
  let cursor = next
  parts.slice(0, -1).forEach((part) => {
    cursor[part] = cursor[part] && typeof cursor[part] === 'object' ? cursor[part] : {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
  return next
}

const hasValue = (value) => value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0)
const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const labelize = (value) => String(value || '').replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase())
const displayValue = (value) => {
  if (value === undefined || value === null || value === '') return 'Not provided'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const statusTone = {
  approved: 'bg-blue-100 text-blue-800 border-blue-200',
  verified: 'bg-blue-100 text-blue-800 border-blue-200',
  ready_for_pdf: 'bg-blue-100 text-blue-800 border-blue-200',
  complete: 'bg-blue-100 text-blue-800 border-blue-200',
  rejected: 'bg-red-100 text-red-800 border-red-200',
  needs_review: 'bg-amber-100 text-amber-800 border-amber-200',
  needs_revision: 'bg-amber-100 text-amber-800 border-amber-200',
  review: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  locked: 'bg-slate-200 text-slate-800 border-slate-300',
  auto_filled: 'bg-blue-100 text-blue-800 border-blue-200',
  manual_override: 'bg-violet-100 text-violet-800 border-violet-200',
}

function StatusBadge({ status, children }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusTone[status] || 'border-slate-200 bg-slate-100 text-slate-700'}`}>
      {children || labelize(status || 'not started')}
    </span>
  )
}

function FieldInput({ field, value, disabled, invalid, onChange, onBlur }) {
  const common = `w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:ring-2 ${invalid ? 'border-red-400 focus:border-red-500 focus:ring-red-100' : 'border-slate-300 focus:border-blue-600 focus:ring-blue-100'} disabled:bg-slate-50 disabled:text-slate-500`
  const options = field.options || []
  const isDisabled = disabled || field.readOnly || field.readonly

  if (field.hidden) return null
  if (field.fieldType === 'signature' || field.semanticType === 'signature') {
    return (
      <div className="rounded-md border border-dashed border-slate-400 bg-slate-50 px-3 py-4 text-sm text-slate-500">
        Signature field reserved for final USCIS package execution
      </div>
    )
  }
  if (field.fieldType === 'textarea') {
    return <textarea rows={4} className={common} value={value ?? ''} placeholder={field.placeholder || ''} disabled={isDisabled} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} />
  }
  if (field.fieldType === 'select' || field.fieldType === 'dropdown') {
    return (
      <select className={common} value={value ?? ''} disabled={isDisabled} onChange={(event) => onChange(event.target.value)} onBlur={onBlur}>
        <option value="">Select an option</option>
        {options.map((option) => {
          const optionValue = option.value ?? option.exportValue ?? option
          return <option key={String(optionValue)} value={optionValue}>{option.label || optionValue}</option>
        })}
      </select>
    )
  }
  if (field.fieldType === 'radio') {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const optionValue = option.value ?? option.exportValue ?? option
          return (
            <label key={String(optionValue)} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${value === optionValue ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white'}`}>
              <input type="radio" checked={value === optionValue} disabled={isDisabled} onChange={() => onChange(optionValue)} onBlur={onBlur} />
              {option.label || optionValue}
            </label>
          )
        })}
      </div>
    )
  }
  if (field.fieldType === 'checkbox') {
    return (
      <label className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm ${value ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white'}`}>
        <input type="checkbox" checked={Boolean(value)} disabled={isDisabled} onChange={(event) => onChange(event.target.checked)} onBlur={onBlur} />
        Selected
      </label>
    )
  }
  if (field.fieldType === 'multiselect') {
    const selected = Array.isArray(value) ? value : []
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const optionValue = option.value ?? option.exportValue ?? option
          return (
            <label key={String(optionValue)} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${selected.includes(optionValue) ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white'}`}>
              <input
                type="checkbox"
                checked={selected.includes(optionValue)}
                disabled={isDisabled}
                onChange={(event) => onChange(event.target.checked ? [...selected, optionValue] : selected.filter((item) => item !== optionValue))}
                onBlur={onBlur}
              />
              {option.label || optionValue}
            </label>
          )
        })}
      </div>
    )
  }
  if (field.fieldType === 'address') {
    const address = value && typeof value === 'object' ? value : {}
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {['addressLine1', 'addressLine2', 'city', 'state', 'zipCode', 'country'].map((key) => (
          <input
            key={key}
            className={common}
            value={address[key] || ''}
            placeholder={labelize(key)}
            disabled={isDisabled}
            onChange={(event) => onChange({ ...address, [key]: event.target.value })}
            onBlur={onBlur}
          />
        ))}
      </div>
    )
  }
  if (field.fieldType === 'table' || field.fieldType === 'repeatable_group') {
    const rows = Array.isArray(value) ? value : []
    const columns = field.repeatableConfig?.fields || field.columns || [{ fieldId: 'value', label: 'Value' }]
    const updateRow = (rowIndex, key, nextValue) => onChange(rows.map((row, index) => index === rowIndex ? { ...row, [key]: nextValue } : row))
    return (
      <div className="space-y-3">
        {rows.map((row, rowIndex) => (
          <div key={`${field.fieldName}-${rowIndex}`} className="rounded-md border border-slate-300 bg-slate-50 p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {columns.map((column) => {
                const key = column.fieldId || column.fieldName || column.key
                return <input key={key} className={common} value={row[key] || ''} placeholder={column.label || labelize(key)} disabled={isDisabled} onChange={(event) => updateRow(rowIndex, key, event.target.value)} onBlur={onBlur} />
              })}
            </div>
            {!isDisabled && <button type="button" className="mt-2 text-xs font-semibold text-red-600" onClick={() => onChange(rows.filter((_, index) => index !== rowIndex))}>Remove entry</button>}
          </div>
        ))}
        {!isDisabled && <button type="button" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700" onClick={() => onChange([...rows, {}])}>Add entry</button>}
      </div>
    )
  }
  const inputType = field.fieldType === 'number' || field.fieldType === 'currency' ? 'number' : field.fieldType === 'date' ? 'date' : field.fieldType === 'email' ? 'email' : field.fieldType === 'phone' ? 'tel' : 'text'
  return <input type={inputType} className={common} value={value ?? ''} placeholder={field.placeholder || ''} disabled={isDisabled} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} />
}

export default function USCISFormRenderer({ caseId, caseForm, onClose, onSaved }) {
  const [loading, setLoading] = useState(true)
  const [workspace, setWorkspace] = useState(null)
  const [values, setValues] = useState({})
  const [activeSection, setActiveSection] = useState('')
  const [selectedFieldName, setSelectedFieldName] = useState('')
  const [search, setSearch] = useState('')
  const [rightTab, setRightTab] = useState('review')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [comment, setComment] = useState('')
  const [decisionReason, setDecisionReason] = useState('')
  const [comparison, setComparison] = useState(false)
  const [undoStack, setUndoStack] = useState([])
  const [redoStack, setRedoStack] = useState([])
  const lastSaved = useRef({})

  const loadWorkspace = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const response = await uscisFormsApi.workspace(caseId, caseForm._id)
      const next = response.data
      setWorkspace(next)
      setValues(next.values || next.caseForm?.fieldValues || {})
      lastSaved.current = structuredClone(next.values || next.caseForm?.fieldValues || {})
      setActiveSection((current) => current || next.template?.sections?.[0]?.key || '')
      setErrorMessage('')
    } catch (error) {
      setErrorMessage(error.response?.data?.message || 'Unable to open the interactive USCIS form')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [caseId, caseForm._id])

  useEffect(() => {
    loadWorkspace()
  }, [loadWorkspace])

  const sections = workspace?.template?.sections || []
  const pages = workspace?.renderer?.pages || workspace?.template?.pages || []
  const allFields = useMemo(() => sections.flatMap((section) => (section.fields || []).filter((field) => !field.hidden).map((field) => ({ ...field, sectionKey: section.key, sectionTitle: section.title }))), [sections])
  const selectedField = useMemo(() => allFields.find((field) => field.fieldName === selectedFieldName), [allFields, selectedFieldName])
  const validationErrors = workspace?.caseForm?.validationErrors?.fields || workspace?.validationErrors || {}
  const permissions = workspace?.permissions || {}
  const locked = Boolean(workspace?.caseForm?.isLocked || workspace?.caseForm?.status === 'locked' || workspace?.caseForm?.status === 'filed')
  const canEdit = Boolean(permissions.canEdit && !locked)
  const completion = workspace?.caseForm?.completion || workspace?.completion || {}
  const visibleSections = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return sections
    return sections.map((section) => ({
      ...section,
      fields: (section.fields || []).filter((field) => !field.hidden && [field.fieldName, field.fieldId, field.label, field.fieldLabel, field.sourceField].some((value) => String(value || '').toLowerCase().includes(term))),
    })).filter((section) => section.title.toLowerCase().includes(term) || section.fields.length)
  }, [search, sections])

  useEffect(() => {
    if (!selectedFieldName && allFields.length) setSelectedFieldName(allFields[0].fieldName)
  }, [allFields, selectedFieldName])

  const action = async (key, callback, successMessage, reload = true) => {
    setBusy(key)
    setErrorMessage('')
    try {
      await callback()
      setNotice(successMessage)
      if (reload) await loadWorkspace(true)
      onSaved?.()
    } catch (error) {
      setErrorMessage(error.response?.data?.message || error.message || 'The action could not be completed')
    } finally {
      setBusy('')
    }
  }

  const updateField = (field, nextValue) => {
    const previousValue = getByPath(values, field.fieldName)
    if (!sameValue(previousValue, nextValue)) {
      setUndoStack((current) => [...current.slice(-49), { fieldName: field.fieldName, value: previousValue, sectionKey: field.sectionKey }])
      setRedoStack([])
      setValues((current) => setByPath(current, field.fieldName, nextValue))
    }
  }

  const saveField = async (field, explicitValue) => {
    if (!field || !canEdit) return
    const value = explicitValue !== undefined ? explicitValue : getByPath(values, field.fieldName)
    const previous = getByPath(lastSaved.current, field.fieldName)
    if (sameValue(previous, value)) return
    await action(`field:${field.fieldName}`, () => uscisFormsApi.saveWorkspaceField(caseId, caseForm._id, {
      fieldName: field.fieldName,
      sectionKey: field.sectionKey,
      value,
      reason: 'Interactive USCIS form review',
    }), `${field.label || field.fieldLabel} saved`)
  }

  const undo = async () => {
    const entry = undoStack[undoStack.length - 1]
    if (!entry) return
    const field = allFields.find((item) => item.fieldName === entry.fieldName)
    const currentValue = getByPath(values, entry.fieldName)
    setUndoStack((current) => current.slice(0, -1))
    setRedoStack((current) => [...current, { ...entry, value: currentValue }])
    setValues((current) => setByPath(current, entry.fieldName, entry.value))
    await saveField(field, entry.value)
  }

  const redo = async () => {
    const entry = redoStack[redoStack.length - 1]
    if (!entry) return
    const field = allFields.find((item) => item.fieldName === entry.fieldName)
    const currentValue = getByPath(values, entry.fieldName)
    setRedoStack((current) => current.slice(0, -1))
    setUndoStack((current) => [...current, { ...entry, value: currentValue }])
    setValues((current) => setByPath(current, entry.fieldName, entry.value))
    await saveField(field, entry.value)
  }

  const saveSection = async (section) => {
    const fieldValues = Object.fromEntries((section.fields || []).map((field) => [field.fieldName, getByPath(values, field.fieldName)]))
    await action(`section:${section.key}`, () => uscisFormsApi.saveWorkspaceSection(caseId, caseForm._id, { sectionKey: section.key, fieldValues }), `${section.title} saved`)
  }

  const reviewField = (status) => {
    if (!selectedField) return
    action(`review:${selectedField.fieldName}`, () => uscisFormsApi.reviewWorkspaceField(caseId, caseForm._id, {
      fieldName: selectedField.fieldName,
      sectionKey: selectedField.sectionKey,
      status,
      comment: comment || undefined,
    }), `Field marked ${labelize(status).toLowerCase()}`)
  }

  const reviewSection = (status) => {
    const section = sections.find((item) => item.key === activeSection)
    if (!section) return
    action(`section-review:${section.key}`, () => uscisFormsApi.reviewWorkspaceSection(caseId, caseForm._id, {
      sectionKey: section.key,
      status,
      comment: comment || undefined,
    }), `${section.title} marked ${labelize(status).toLowerCase()}`)
  }

  const decideForm = (decision) => {
    action(`decision:${decision}`, () => uscisFormsApi.decideWorkspaceForm(caseId, caseForm._id, {
      action: decision,
      reason: decisionReason || undefined,
      approvalStatement: decision === 'approve' ? 'I reviewed this form and approve it for official PDF generation.' : undefined,
    }), decision === 'approve' ? 'Form approved and ready for PDF generation' : 'Review decision saved')
  }

  const addComment = () => {
    if (!comment.trim()) return
    action('comment', () => uscisFormsApi.addWorkspaceComment(caseId, caseForm._id, {
      scope: selectedField ? 'field' : 'section',
      fieldName: selectedField?.fieldName,
      sectionKey: selectedField?.sectionKey || activeSection,
      comment,
      internalOnly: true,
    }), 'Internal review comment added')
    setComment('')
  }

  const createTask = () => {
    if (!selectedField) return
    action('task', () => uscisFormsApi.createWorkspaceTask(caseId, caseForm._id, {
      title: `Review ${selectedField.label || selectedField.fieldLabel}`,
      description: `Verify ${selectedField.fieldName} in ${workspace.template.formCode}.`,
      assignedTo: workspace.caseForm.lastModifiedBy || undefined,
      priority: validationErrors[selectedField.fieldName]?.length ? 'high' : 'medium',
      fieldName: selectedField.fieldName,
      sectionKey: selectedField.sectionKey,
    }), 'Review task created')
  }

  const resetField = () => {
    if (!selectedField) return
    action('reset', () => uscisFormsApi.resetWorkspace(caseId, caseForm._id, { fieldName: selectedField.fieldName }), 'Field reset to the latest canonical value')
  }

  const useCanonicalValue = () => {
    if (!selectedField) return
    action('resolve-conflict', () => uscisFormsApi.resolveWorkspaceConflict(caseId, caseForm._id, {
      fieldName: selectedField.fieldName,
      sectionKey: selectedField.sectionKey,
      sourceField: selectedField.sourceField,
      resolution: 'canonical',
      reason: 'Reviewer selected canonical profile value',
    }), 'Conflict resolved with the canonical value')
  }

  const generatePdf = () => {
    action('generate-pdf', () => formGenerationApi.generatePdf(caseForm._id, { watermark: 'FINAL', flatten: true }), 'Official USCIS PDF generated')
  }

  const openPdf = async () => {
    setBusy('preview-pdf')
    setErrorMessage('')
    try {
      const response = await formGenerationApi.previewPdf(caseForm._id)
      const url = URL.createObjectURL(response.data)
      window.open(url, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (error) {
      setErrorMessage(error.response?.data?.message || 'Unable to preview the generated PDF')
    } finally {
      setBusy('')
    }
  }

  const downloadPdf = async () => {
    setBusy('download-pdf')
    setErrorMessage('')
    try {
      const response = await formGenerationApi.downloadPdf(caseForm._id)
      const url = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = `${caseForm.formCode || 'uscis-form'}-${caseForm._id}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (error) {
      setErrorMessage(error.response?.data?.message || 'Unable to download the generated PDF')
    } finally {
      setBusy('')
    }
  }

  const nextProblem = () => {
    const problemFields = allFields.filter((field) => validationErrors[field.fieldName]?.length || !hasValue(getByPath(values, field.fieldName)) && field.required)
    if (!problemFields.length) return
    const currentIndex = problemFields.findIndex((field) => field.fieldName === selectedFieldName)
    const next = problemFields[(currentIndex + 1) % problemFields.length]
    setSelectedFieldName(next.fieldName)
    setActiveSection(next.sectionKey)
    document.getElementById(`uscis-field-${CSS.escape(next.fieldName)}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        const section = sections.find((item) => item.key === activeSection)
        if (section && canEdit) saveSection(section)
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault()
        undo()
      }
      if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || event.shiftKey && event.key.toLowerCase() === 'z')) {
        event.preventDefault()
        redo()
      }
      if (event.key === 'F8') {
        event.preventDefault()
        nextProblem()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  if (loading) {
    return <div className="flex min-h-[520px] items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500"><RefreshCw className="mr-2 h-5 w-5 animate-spin" />Opening interactive USCIS form...</div>
  }
  if (!workspace) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">{errorMessage || 'Unable to load this form.'}</div>
  }

  const selectedComments = (workspace.comments || []).filter((item) => !selectedField || item.fieldName === selectedField.fieldName || item.sectionKey === selectedField.sectionKey && item.scope === 'section')

  return (
    <div className="overflow-hidden rounded-xl border border-slate-300 bg-slate-100 shadow-sm">
      <header className="border-b border-slate-300 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={onClose} className="rounded-md border border-slate-300 p-2 text-slate-600 hover:bg-slate-50" aria-label="Back to forms"><ArrowLeft className="h-4 w-4" /></button>
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#12365b] text-white"><FileText className="h-5 w-5" /></div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-lg font-bold text-slate-950">{workspace.template.formCode} · {workspace.template.title}</h2>
                <StatusBadge status={workspace.caseForm.status} />
                {locked && <StatusBadge status="locked"><Lock className="mr-1 h-3 w-3" />Locked</StatusBadge>}
              </div>
              <p className="text-xs text-slate-500">Edition {workspace.template.version || 'Current'} · Case {workspace.caseSummary.caseNumber} · {permissions.mode.replaceAll('_', ' ')} review</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={undo} disabled={!undoStack.length || !canEdit} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40">Undo</button>
            <button type="button" onClick={redo} disabled={!redoStack.length || !canEdit} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40">Redo</button>
            <button type="button" onClick={() => action('refresh', () => uscisFormsApi.refreshWorkspace(caseId, caseForm._id), 'Form refreshed from canonical data')} disabled={!canEdit || busy === 'refresh'} className="flex items-center gap-1 rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40"><RefreshCw className={`h-3.5 w-3.5 ${busy === 'refresh' ? 'animate-spin' : ''}`} />Refresh</button>
            {permissions.canApprove && !locked && <button type="button" onClick={() => decideForm('approve')} className="flex items-center gap-1 rounded-md bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800"><ShieldCheck className="h-4 w-4" />Approve Form</button>}
            {['approved', 'ready_for_pdf', 'locked'].includes(workspace.caseForm.status) && <button type="button" onClick={generatePdf} disabled={busy === 'generate-pdf'} className="flex items-center gap-1 rounded-md bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"><FileCheck2 className="h-4 w-4" />{busy === 'generate-pdf' ? 'Generating…' : 'Generate PDF'}</button>}
            {workspace.caseForm.generatedPdfDocument && <button type="button" onClick={openPdf} disabled={busy === 'preview-pdf'} className="rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">Preview PDF</button>}
            {workspace.caseForm.generatedPdfDocument && <button type="button" onClick={downloadPdf} disabled={busy === 'download-pdf'} className="flex items-center gap-1 rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800 disabled:opacity-50"><Download className="h-3.5 w-3.5" />{busy === 'download-pdf' ? 'Downloading…' : 'Download PDF'}</button>}
            {permissions.canLock && !locked && ['approved', 'ready_for_pdf', 'generated'].includes(workspace.caseForm.status) && <button type="button" onClick={() => action('lock', () => uscisFormsApi.lockWorkspaceForm(caseId, caseForm._id, { locked: true }), 'Form locked')} className="rounded-md border border-slate-800 px-3 py-2 text-xs font-semibold text-slate-800"><Lock className="inline h-3.5 w-3.5" /> Lock</button>}
            {permissions.canUnlock && locked && <button type="button" onClick={() => action('unlock', () => uscisFormsApi.lockWorkspaceForm(caseId, caseForm._id, { locked: false, reason: decisionReason }), 'Form unlocked')} className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800"><Unlock className="inline h-3.5 w-3.5" /> Unlock</button>}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-blue-600 transition-all" style={{ width: `${completion.percent || 0}%` }} /></div>
          <span className="text-xs font-bold text-slate-700">{completion.percent || 0}% complete</span>
          <span className="hidden text-xs text-slate-500 sm:inline">{completion.missingRequiredFields || 0} required fields missing</span>
        </div>
        {(notice || errorMessage) && <div className={`mt-2 rounded-md px-3 py-2 text-xs ${errorMessage ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>{errorMessage || notice}</div>}
        {workspace.caseForm.syncState?.stale && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <span><strong>New canonical data is available.</strong> Refresh to update auto-filled fields; manual overrides stay protected.</span>
            {canEdit && <button type="button" onClick={() => action('refresh', () => uscisFormsApi.refreshWorkspace(caseId, caseForm._id), 'Form refreshed from canonical data')} className="rounded bg-amber-800 px-2.5 py-1.5 font-semibold text-white">Review updates</button>}
          </div>
        )}
      </header>

      <div className="grid min-h-[680px] grid-cols-1 xl:grid-cols-[250px_minmax(500px,1fr)_330px]">
        <aside className="border-b border-slate-300 bg-white xl:border-b-0 xl:border-r">
          <div className="border-b border-slate-200 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-600" placeholder="Search form fields" />
            </div>
          </div>
          <div className="border-b border-slate-200 p-3 text-xs text-slate-600">
            <div className="grid grid-cols-2 gap-2">
              <div><span className="block text-[10px] uppercase text-slate-400">Beneficiary</span><strong className="text-slate-800">{workspace.caseSummary.beneficiary ? [workspace.caseSummary.beneficiary.firstName, workspace.caseSummary.beneficiary.lastName].filter(Boolean).join(' ') : workspace.caseSummary.clientName || 'Not assigned'}</strong></div>
              <div><span className="block text-[10px] uppercase text-slate-400">Petitioner</span><strong className="text-slate-800">{workspace.caseSummary.petitioner?.legalName || workspace.caseSummary.petitioner?.name || 'Not assigned'}</strong></div>
            </div>
          </div>
          {pages.length > 0 && (
            <div className="border-b border-slate-200 p-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">USCIS Pages</p>
              <div className="grid grid-cols-3 gap-1.5">
                {pages.slice(0, 24).map((page) => {
                  const firstSectionKey = page.sections?.[0]
                  const active = page.sections?.includes(activeSection)
                  return (
                    <button
                      key={page.pageNumber}
                      type="button"
                      onClick={() => firstSectionKey && setActiveSection(firstSectionKey)}
                      className={`rounded border px-2 py-1 text-[10px] font-semibold ${active ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                    >
                      Pg {page.pageNumber}
                      <span className="ml-1 text-slate-400">{page.percent ?? 0}%</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          <nav className="max-h-[590px] overflow-y-auto p-2">
            {visibleSections.map((section, sectionIndex) => {
              const progress = workspace.caseForm.sectionProgress?.[section.key] || {}
              const review = workspace.caseForm.sectionReviews?.[section.key] || section.review || {}
              const active = activeSection === section.key
              return (
                <button
                  type="button"
                  key={section.key}
                  onClick={() => {
                    setActiveSection(section.key)
                    setSelectedFieldName((section.fields || []).find((field) => !field.hidden)?.fieldName || '')
                  }}
                  className={`mb-1 w-full rounded-md border px-3 py-2.5 text-left transition ${active ? 'border-blue-300 bg-blue-50' : 'border-transparent hover:bg-slate-50'}`}
                >
                  <div className="flex items-start gap-2">
                    <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${progress.percent === 100 ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'}`}>{progress.percent === 100 ? <Check className="h-3 w-3" /> : sectionIndex + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-slate-900">{section.title}</span>
                      <span className="mt-1 flex items-center justify-between text-[10px] text-slate-500"><span>{progress.percent || 0}%</span><StatusBadge status={review.status} /></span>
                    </span>
                    {active ? <ChevronDown className="h-4 w-4 text-blue-700" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                  </div>
                </button>
              )
            })}
          </nav>
          <div className="border-t border-slate-200 p-3">
            <button type="button" onClick={nextProblem} className="flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white"><AlertCircle className="h-4 w-4" />Next issue <span className="text-slate-400">F8</span></button>
          </div>
        </aside>

        <main className="max-h-[680px] overflow-y-auto bg-slate-200/60 p-3 sm:p-5">
          {visibleSections.filter((section) => section.key === activeSection || search).map((section) => (
            <section key={section.key} className="mx-auto mb-5 max-w-4xl overflow-hidden border border-slate-400 bg-white shadow-sm">
              <div className="border-b-4 border-[#12365b] bg-slate-50 px-5 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#12365b]">Department of Homeland Security · U.S. Citizenship and Immigration Services</p>
                    <h3 className="mt-1 text-base font-black text-slate-950">{section.title}</h3>
                    {section.description && <p className="mt-1 text-xs text-slate-600">{section.description}</p>}
                  </div>
                  <div className="flex gap-2">
                    {permissions.canReview && <button type="button" onClick={() => reviewSection('approved')} className="rounded border border-blue-300 bg-blue-50 px-2.5 py-1.5 text-[11px] font-semibold text-blue-800">Approve Section</button>}
                    {permissions.canReview && <button type="button" onClick={() => reviewSection('needs_revision')} className="rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800">Needs Revision</button>}
                    {canEdit && <button type="button" onClick={() => saveSection(section)} disabled={busy === `section:${section.key}`} className="flex items-center gap-1 rounded bg-[#12365b] px-2.5 py-1.5 text-[11px] font-semibold text-white"><Save className="h-3 w-3" />Save</button>}
                  </div>
                </div>
              </div>
              <div className="divide-y divide-slate-300">
                {(section.fields || []).filter((field) => !field.hidden).map((field, fieldIndex) => {
                  const value = getByPath(values, field.fieldName)
                  const errors = validationErrors[field.fieldName] || []
                  const selected = selectedFieldName === field.fieldName
                  const reviewStatus = field.review?.status || field.verificationStatus
                  const fieldTone = errors.length ? 'border-l-red-500 bg-red-50/40' : field.conflicts?.length ? 'border-l-amber-500 bg-amber-50/40' : field.manualOverride ? 'border-l-violet-500' : reviewStatus === 'approved' || reviewStatus === 'verified' ? 'border-l-blue-500' : 'border-l-blue-400'
                  return (
                    <div
                      id={`uscis-field-${field.fieldName}`}
                      key={field.fieldName}
                      onClick={() => setSelectedFieldName(field.fieldName)}
                      className={`grid cursor-pointer grid-cols-1 border-l-4 px-4 py-4 transition md:grid-cols-[42px_minmax(180px,0.8fr)_minmax(260px,1.2fr)] ${fieldTone} ${selected ? 'ring-2 ring-inset ring-blue-300' : ''}`}
                    >
                      <div className="mb-2 text-xs font-bold text-slate-500 md:mb-0">{field.order ?? fieldIndex + 1}.</div>
                      <div className="pr-4">
                        <label className="text-xs font-bold leading-5 text-slate-900">{field.label || field.fieldLabel}{field.required && <span className="ml-1 text-red-600">*</span>}</label>
                        {field.helpText && <p className="mt-1 text-[11px] leading-4 text-slate-500">{field.helpText}</p>}
                        <div className="mt-2 flex flex-wrap gap-1">
                          <StatusBadge status={reviewStatus} />
                          {field.manualOverride && <StatusBadge status="manual_override">Manual</StatusBadge>}
                          {field.conflicts?.length > 0 && <StatusBadge status="needs_revision">Conflict</StatusBadge>}
                        </div>
                      </div>
                      <div>
                        {comparison && field.canonicalValue !== undefined && !sameValue(value, field.canonicalValue) && (
                          <div className="mb-2 grid grid-cols-2 gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px]">
                            <div><span className="block font-semibold text-amber-900">Canonical</span>{displayValue(field.canonicalValue)}</div>
                            <div><span className="block font-semibold text-amber-900">Current form</span>{displayValue(value)}</div>
                          </div>
                        )}
                        <FieldInput field={field} value={value} disabled={!canEdit} invalid={errors.length > 0} onChange={(nextValue) => updateField(field, nextValue)} onBlur={() => saveField(field)} />
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
                          <span className="font-semibold text-slate-600">{field.source || 'Unmapped source'}</span>
                          {field.confidence !== undefined && <span>{field.confidence}% confidence</span>}
                          <span className="truncate">{field.sourceField || field.fieldName}</span>
                          {busy === `field:${field.fieldName}` && <span className="text-blue-700">Saving…</span>}
                        </div>
                        {errors.map((item) => <p key={String(item)} className="mt-1 flex items-center gap-1 text-[11px] font-medium text-red-700"><AlertTriangle className="h-3 w-3" />{typeof item === 'string' ? item : item.message}</p>)}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="border-t border-slate-300 bg-slate-50 px-5 py-2 text-center text-[10px] text-slate-500">Form {workspace.template.formCode} · Edition {workspace.template.version || 'Current'} · Internal Review Copy</div>
            </section>
          ))}
        </main>

        <aside className="border-t border-slate-300 bg-white xl:border-l xl:border-t-0">
          <div className="grid grid-cols-4 border-b border-slate-200">
            {[
              ['review', ClipboardCheck, 'Review'],
              ['validation', AlertTriangle, 'Issues'],
              ['history', History, 'History'],
              ['comments', MessageSquare, 'Notes'],
            ].map(([key, Icon, label]) => (
              <button key={key} type="button" onClick={() => setRightTab(key)} className={`flex flex-col items-center gap-1 border-b-2 px-1 py-2 text-[10px] font-semibold ${rightTab === key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500'}`}><Icon className="h-4 w-4" />{label}</button>
            ))}
          </div>
          <div className="max-h-[620px] overflow-y-auto p-4">
            {rightTab === 'review' && (
              <div className="space-y-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Selected USCIS Field</p>
                  <h4 className="mt-1 text-sm font-bold text-slate-900">{selectedField?.label || selectedField?.fieldLabel || 'Select a field'}</h4>
                  <p className="break-all text-[11px] text-slate-500">{selectedField?.fieldName}</p>
                </div>
                {selectedField && (
                  <>
                    <div className="rounded-lg border border-slate-200 p-3">
                      <div className="mb-2 flex items-center justify-between"><span className="text-xs font-bold text-slate-800">Source traceability</span><Link2 className="h-4 w-4 text-slate-400" /></div>
                      <dl className="grid grid-cols-[90px_1fr] gap-y-2 text-[11px]">
                        <dt className="text-slate-500">Source</dt><dd className="font-semibold text-slate-800">{selectedField.source || 'Unmapped'}</dd>
                        <dt className="text-slate-500">Canonical field</dt><dd className="break-all font-semibold text-slate-800">{selectedField.sourceField || 'None'}</dd>
                        <dt className="text-slate-500">Confidence</dt><dd className="font-semibold text-slate-800">{selectedField.confidence ?? 'N/A'}{selectedField.confidence !== undefined ? '%' : ''}</dd>
                        <dt className="text-slate-500">Last updated</dt><dd className="font-semibold text-slate-800">{selectedField.lastUpdated ? new Date(selectedField.lastUpdated).toLocaleString() : 'Not available'}</dd>
                      </dl>
                    </div>
                    {selectedField.conflicts?.length > 0 && (
                      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                        <p className="flex items-center gap-1 text-xs font-bold text-amber-900"><AlertTriangle className="h-4 w-4" />Source conflict</p>
                        <p className="mt-1 text-[11px] text-amber-800">Compare the canonical value and current form value before verifying this field.</p>
                        {canEdit && <button type="button" onClick={useCanonicalValue} className="mt-2 rounded-md border border-amber-400 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-amber-900">Use canonical value</button>}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      {permissions.canReview && <button type="button" onClick={() => reviewField('approved')} className="flex items-center justify-center gap-1 rounded-md bg-blue-700 px-2 py-2 text-xs font-semibold text-white"><CheckCircle2 className="h-4 w-4" />Verify</button>}
                      {permissions.canReview && <button type="button" onClick={() => reviewField('needs_review')} className="flex items-center justify-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-2 text-xs font-semibold text-amber-800"><AlertCircle className="h-4 w-4" />Needs Review</button>}
                      {canEdit && <button type="button" onClick={resetField} className="flex items-center justify-center gap-1 rounded-md border border-slate-300 px-2 py-2 text-xs font-semibold text-slate-700"><RotateCcw className="h-4 w-4" />Reset Auto Fill</button>}
                      {permissions.canCreateTask && <button type="button" onClick={createTask} className="flex items-center justify-center gap-1 rounded-md border border-slate-300 px-2 py-2 text-xs font-semibold text-slate-700"><UserCheck className="h-4 w-4" />Create Task</button>}
                    </div>
                    <button type="button" onClick={() => setComparison((current) => !current)} className={`flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold ${comparison ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-300 text-slate-700'}`}><SplitSquareHorizontal className="h-4 w-4" />{comparison ? 'Hide' : 'Show'} canonical comparison</button>
                    <div>
                      <p className="mb-2 text-xs font-bold text-slate-800">Supporting evidence</p>
                      {selectedField.documents?.length ? selectedField.documents.map((document) => (
                        <a key={document._id} href={document.documentUrl || document.filePath} target="_blank" rel="noreferrer" className="mb-2 flex items-center gap-2 rounded-md border border-slate-200 p-2 text-xs text-blue-700 hover:bg-blue-50"><FileCheck2 className="h-4 w-4" /><span className="truncate">{document.originalName || document.fileName}</span></a>
                      )) : <p className="rounded-md bg-slate-50 p-2 text-[11px] text-slate-500">No supporting document linked to this field.</p>}
                    </div>
                    <div>
                      <p className="mb-2 text-xs font-bold text-slate-800">Review tasks</p>
                      {(workspace.tasks || []).filter((task) => (task.tags || []).includes(`field:${selectedField.fieldName}`)).map((task) => (
                        <div key={task._id} className="mb-2 rounded-md border border-slate-200 p-2">
                          <div className="flex items-center justify-between gap-2"><span className="truncate text-[11px] font-semibold text-slate-800">{task.title}</span><StatusBadge status={task.status} /></div>
                          <p className="mt-1 text-[10px] text-slate-500">{task.assignedTo?.name || [task.assignedTo?.firstName, task.assignedTo?.lastName].filter(Boolean).join(' ') || 'Assigned reviewer'}</p>
                        </div>
                      ))}
                      {!(workspace.tasks || []).some((task) => (task.tags || []).includes(`field:${selectedField.fieldName}`)) && <p className="rounded-md bg-slate-50 p-2 text-[11px] text-slate-500">No open review task for this field.</p>}
                    </div>
                  </>
                )}
              </div>
            )}

            {rightTab === 'validation' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-red-50 p-3"><span className="block text-xl font-black text-red-700">{Object.keys(validationErrors).length}</span><span className="text-[11px] text-red-700">Blocking issues</span></div>
                  <div className="rounded-lg bg-amber-50 p-3"><span className="block text-xl font-black text-amber-700">{workspace.canonical?.validation?.warnings?.length || 0}</span><span className="text-[11px] text-amber-700">Warnings</span></div>
                </div>
                {Object.entries(validationErrors).map(([fieldName, errors]) => {
                  const field = allFields.find((item) => item.fieldName === fieldName)
                  return (
                    <button key={fieldName} type="button" onClick={() => { setSelectedFieldName(fieldName); if (field) setActiveSection(field.sectionKey) }} className="w-full rounded-lg border border-red-200 bg-red-50 p-3 text-left">
                      <p className="text-xs font-bold text-red-900">{field?.label || fieldName}</p>
                      {(Array.isArray(errors) ? errors : [errors]).map((item) => <p key={String(item)} className="mt-1 text-[11px] text-red-700">{typeof item === 'string' ? item : item.message}</p>)}
                    </button>
                  )
                })}
                {!Object.keys(validationErrors).length && <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-center"><CheckCircle2 className="mx-auto h-7 w-7 text-blue-600" /><p className="mt-2 text-xs font-bold text-blue-800">No blocking USCIS field errors</p></div>}
                <button type="button" onClick={nextProblem} className="w-full rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white">Go to next issue</button>
              </div>
            )}

            {rightTab === 'history' && (
              <div className="space-y-3">
                <p className="text-xs font-bold text-slate-800">Field history</p>
                {(selectedField?.history || []).map((entry) => (
                  <div key={entry._id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between"><StatusBadge status={entry.action}>{labelize(entry.action)}</StatusBadge><span className="text-[10px] text-slate-400">{new Date(entry.changedAt).toLocaleString()}</span></div>
                    <p className="mt-2 text-[11px] text-slate-500">From</p><p className="break-all text-xs text-slate-700">{displayValue(entry.previousValue)}</p>
                    <p className="mt-1 text-[11px] text-slate-500">To</p><p className="break-all text-xs font-semibold text-slate-900">{displayValue(entry.newValue)}</p>
                    {canEdit && <button type="button" onClick={() => action(`rollback:${entry._id}`, () => uscisFormsApi.rollbackWorkspaceField(caseId, caseForm._id, entry._id), 'Field history restored')} className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-blue-700"><History className="h-3 w-3" />Restore previous value</button>}
                  </div>
                ))}
                {!selectedField?.history?.length && <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-500">No recorded changes for this field.</p>}
              </div>
            )}

            {rightTab === 'comments' && (
              <div className="space-y-3">
                <p className="text-xs font-bold text-slate-800">Internal review discussion</p>
                {selectedComments.map((item) => (
                  <div key={item._id} className={`rounded-lg border p-3 ${item.resolved ? 'border-slate-200 bg-slate-50 opacity-70' : 'border-blue-200 bg-blue-50'}`}>
                    <div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase text-blue-700">{item.scope || 'form'} note</span><span className="text-[10px] text-slate-400">{new Date(item.createdAt).toLocaleString()}</span></div>
                    <p className="mt-1 text-xs text-slate-800">{item.comment}</p>
                    {!item.resolved && permissions.canReview && <button type="button" onClick={() => action(`resolve:${item._id}`, () => uscisFormsApi.resolveWorkspaceComment(caseId, caseForm._id, item._id), 'Comment resolved')} className="mt-2 text-[11px] font-semibold text-blue-700">Mark resolved</button>}
                  </div>
                ))}
                <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} className="w-full rounded-md border border-slate-300 p-2 text-xs outline-none focus:border-blue-600" placeholder="Add an internal field comment..." />
                <button type="button" onClick={addComment} disabled={!comment.trim()} className="w-full rounded-md bg-blue-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Add internal comment</button>
              </div>
            )}

            {permissions.canApprove && (
              <div className="mt-5 border-t border-slate-200 pt-4">
                <p className="mb-2 text-xs font-bold text-slate-800">Review decision</p>
                <textarea value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} rows={2} className="w-full rounded-md border border-slate-300 p-2 text-xs outline-none focus:border-blue-600" placeholder="Decision notes or requested changes" />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => decideForm('request_changes')} className="flex items-center justify-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-2 text-[11px] font-semibold text-amber-800"><AlertTriangle className="h-3.5 w-3.5" />Request Changes</button>
                  <button type="button" onClick={() => decideForm('reject')} className="flex items-center justify-center gap-1 rounded-md border border-red-300 bg-red-50 px-2 py-2 text-[11px] font-semibold text-red-800"><XCircle className="h-3.5 w-3.5" />Reject</button>
                </div>
              </div>
            )}

            <div className="mt-5 border-t border-slate-200 pt-4 text-[10px] text-slate-400">
              <p className="flex items-center gap-1"><Clock3 className="h-3 w-3" />Last activity {workspace.caseForm.reviewState?.lastActivityAt ? new Date(workspace.caseForm.reviewState.lastActivityAt).toLocaleString() : 'not recorded'}</p>
              <p className="mt-1 flex items-center gap-1"><PanelRight className="h-3 w-3" />Keyboard: Ctrl+S save section · F8 next issue</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
